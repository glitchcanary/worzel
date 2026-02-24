/**
 * Worzel ESP32 Client — ESP-IDF implementation.
 *
 * Connects to a Worzel server via:
 *   1. HTTP POST to /api/ota for authentication
 *   2. WebSocket for bidirectional audio + control
 *
 * Audio: ES8311 codec (I2C control + I2S data), all boards.
 *
 * This is a proof-of-concept. For production, add:
 *   - TLS certificate validation
 *   - Secure Boot + Flash Encryption
 *   - NVS-encrypted WiFi credential storage (captive portal)
 *   - OTA firmware updates with signature verification
 *   - Opus codec tuning (complexity vs battery life)
 */

#include <string.h>
#include <math.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "esp_log.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_http_client.h"
#include "esp_websocket_client.h"
#include "nvs_flash.h"
#include "driver/i2s_std.h"
#include "driver/i2c_master.h"
#include "driver/gpio.h"
#include "esp_check.h"
#include "esp_crt_bundle.h"
#include "cJSON.h"

#include <opus.h>  /* esphome/micro-opus (Apache 2.0 + libopus BSD) */

#include "esp_sntp.h"

#include "board.h"
#include "display.h"
#include "../easteregg/melody.h"

static const char *TAG = "worzel";

// ======== Configuration (hardcoded for PoC; future: NVS + captive portal) ========
#define WIFI_SSID       CONFIG_WORZEL_WIFI_SSID
#define WIFI_PASS       CONFIG_WORZEL_WIFI_PASS
#define SERVER_HOST     CONFIG_WORZEL_SERVER_HOST
#define SERVER_PORT     CONFIG_WORZEL_SERVER_PORT
#define DEVICE_ID       "esp32-worzel-001"

// ======== Audio ========
// I2S runs at 16kHz (single rate for ES8311 shared bus).
// Mic: capture 16kHz → Opus encode 16kHz → server.
// Speaker: server sends Opus 24kHz → opus_decode at 16kHz (libopus resamples) → I2S 16kHz.
#define FRAME_DURATION_MS  60
#define I2S_SAMPLE_RATE    16000
#define FRAME_SAMPLES      (I2S_SAMPLE_RATE * FRAME_DURATION_MS / 1000)  /* 960 @ 16kHz */
#define FRAME_BYTES        (FRAME_SAMPLES * sizeof(int16_t))             /* 1920 bytes */
#define OPUS_BITRATE       32000   /* 32 kbps — 16kbps CELT loses speech formants */
#define MAX_OPUS_PACKET    512     /* generous upper bound for encoded Opus frame */

// ======== State ========
static i2s_chan_handle_t i2s_rx_chan = NULL;  /* mic */
static i2s_chan_handle_t i2s_tx_chan = NULL;  /* speaker */
static i2c_master_bus_handle_t i2c_bus = NULL;
static i2c_master_dev_handle_t es8311_dev = NULL;
static i2c_master_dev_handle_t axp2101_dev = NULL;
static esp_websocket_client_handle_t ws_client = NULL;

static OpusEncoder *opus_enc = NULL;
static OpusDecoder *opus_dec = NULL;

static char auth_token[256] = {0};
static char ws_url[256] = {0};
static volatile bool ws_connected = false;
static volatile bool recording = false;

static EventGroupHandle_t wifi_events;
#define WIFI_CONNECTED_BIT BIT0

// ======== ES8311 codec (I2C register writes) ========

static esp_err_t es8311_write_reg(uint8_t reg, uint8_t val) {
    uint8_t buf[2] = {reg, val};
    return i2c_master_transmit(es8311_dev, buf, 2, 100);
}

static uint8_t es8311_read_reg(uint8_t reg) {
    uint8_t val = 0;
    i2c_master_transmit_receive(es8311_dev, &reg, 1, &val, 1, 100);
    return val;
}

static esp_err_t es8311_init_codec(void) {
    esp_err_t ret;

    // Reset — configure all registers BEFORE enabling the codec state machine (CSM).
    // The CSM must not run while registers are being written (caused mic regression).
    ret = es8311_write_reg(0x00, 0x1F);  // Assert all resets
    vTaskDelay(pdMS_TO_TICKS(20));
    ret = es8311_write_reg(0x00, 0x00);  // Deassert resets (CSM still off)
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "ES8311 not responding on I2C");
        return ret;
    }

    // Clock config — MCLK from I2S master, 16kHz sample rate
    es8311_write_reg(0x01, 0x3F);  // MCLK from pin, enable all clocks
    es8311_write_reg(0x02, 0x00);  // pre_div=1, pre_multi=0
    es8311_write_reg(0x03, 0x10);  // ADC OSR=16
    es8311_write_reg(0x04, 0x10);  // DAC OSR=16
    es8311_write_reg(0x05, 0x00);  // ADC div=1, DAC div=1
    es8311_write_reg(0x06, 0x04);  // BCLK divider=4
    es8311_write_reg(0x07, 0x00);  // LRCK divider high
    es8311_write_reg(0x08, 0xFF);  // LRCK divider low (MCLK/256 = 16kHz)

    // I2S format: 16-bit, I2S standard
    es8311_write_reg(0x09, 0x0C);  // SDP_IN (DAC)
    es8311_write_reg(0x0A, 0x0C);  // SDP_OUT (ADC)

    // System config
    es8311_write_reg(0x0B, 0x00);
    es8311_write_reg(0x0C, 0x00);
    es8311_write_reg(0x10, 0x1F);
    es8311_write_reg(0x11, 0x7F);

    // Power up analog (VMID/VREF ramp)
    es8311_write_reg(0x0D, 0x01);
    // ADC analog power: PGA + modulator enabled (active-low bits)
    es8311_write_reg(0x0E, 0x02);
    // DAC power
    es8311_write_reg(0x12, 0x00);
    // HP output driver
    es8311_write_reg(0x13, 0x10);

    // Mic input: analog MIC1P-MIC1N, PGA gain 30dB
    es8311_write_reg(0x14, 0x1A);

    // ADC digital config
    es8311_write_reg(0x15, 0x40);  // ADC ramp rate
    es8311_write_reg(0x16, 0x24);  // ADC gain scale
    es8311_write_reg(0x17, 0xC8);  // ADC volume (~0dB)
    es8311_write_reg(0x1B, 0x0A);  // ADC EQ config
    es8311_write_reg(0x1C, 0x6A);  // Bypass ADC EQ, cancel DC offset

    // DAC config
    es8311_write_reg(0x31, 0x00);  // Unmute DAC
    es8311_write_reg(0x32, 0xD8);  // DAC volume ~+12.5dB (0xBF=0dB, 0xFF=+32dB)
    es8311_write_reg(0x37, 0x08);  // Bypass DAC EQ

    // GPIO/analog reference — 0x58 enables DAC analog reference (CRITICAL for output).
    // Without the 0x50 bits, DAC has no bias and produces silence.
    es8311_write_reg(0x44, 0x58);
    es8311_write_reg(0x45, 0x00);

    // Start codec state machine LAST (after all registers configured)
    es8311_write_reg(0x00, 0x80);
    vTaskDelay(pdMS_TO_TICKS(50));

    ESP_LOGI(TAG, "ES8311 initialized (16kHz, 16-bit, I2S slave, DAC ref=0x58)");

    // Full register dump for debugging DAC output issues
    ESP_LOGI(TAG, "ES8311 regs 00-0F: %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x",
             es8311_read_reg(0x00), es8311_read_reg(0x01), es8311_read_reg(0x02), es8311_read_reg(0x03),
             es8311_read_reg(0x04), es8311_read_reg(0x05), es8311_read_reg(0x06), es8311_read_reg(0x07),
             es8311_read_reg(0x08), es8311_read_reg(0x09), es8311_read_reg(0x0A), es8311_read_reg(0x0B),
             es8311_read_reg(0x0C), es8311_read_reg(0x0D), es8311_read_reg(0x0E), es8311_read_reg(0x0F));
    ESP_LOGI(TAG, "ES8311 regs 10-1F: %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x",
             es8311_read_reg(0x10), es8311_read_reg(0x11), es8311_read_reg(0x12), es8311_read_reg(0x13),
             es8311_read_reg(0x14), es8311_read_reg(0x15), es8311_read_reg(0x16), es8311_read_reg(0x17),
             es8311_read_reg(0x18), es8311_read_reg(0x19), es8311_read_reg(0x1A), es8311_read_reg(0x1B),
             es8311_read_reg(0x1C), es8311_read_reg(0x1D), es8311_read_reg(0x1E), es8311_read_reg(0x1F));
    ESP_LOGI(TAG, "ES8311 regs 30-3F: %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x",
             es8311_read_reg(0x30), es8311_read_reg(0x31), es8311_read_reg(0x32), es8311_read_reg(0x33),
             es8311_read_reg(0x34), es8311_read_reg(0x35), es8311_read_reg(0x36), es8311_read_reg(0x37),
             es8311_read_reg(0x38), es8311_read_reg(0x39), es8311_read_reg(0x3A), es8311_read_reg(0x3B),
             es8311_read_reg(0x3C), es8311_read_reg(0x3D), es8311_read_reg(0x3E), es8311_read_reg(0x3F));
    ESP_LOGI(TAG, "ES8311 regs 40-45: %02x %02x %02x %02x %02x %02x",
             es8311_read_reg(0x40), es8311_read_reg(0x41), es8311_read_reg(0x42),
             es8311_read_reg(0x43), es8311_read_reg(0x44), es8311_read_reg(0x45));

    return ESP_OK;
}

static void es8311_set_volume(uint8_t vol) __attribute__((unused));
static void es8311_set_volume(uint8_t vol) {
    es8311_write_reg(0x32, vol);  // 0x00=-95.5dB, 0xBF=0dB, 0xFF=+32dB
}

// ======== AXP2101 PMIC (power management) ========
// The Waveshare ESP32-S3 AMOLED 1.8" has an AXP2101 PMIC that controls
// power rails. ALDO1 provides 3.3V for the microphone. Without PMIC init,
// audio power rails may be in an undefined state.

#define AXP2101_I2C_ADDR 0x34

static esp_err_t axp2101_write_reg(uint8_t reg, uint8_t val) {
    uint8_t buf[2] = {reg, val};
    return i2c_master_transmit(axp2101_dev, buf, 2, 100);
}

static uint8_t axp2101_read_reg(uint8_t reg) {
    uint8_t val = 0;
    i2c_master_transmit_receive(axp2101_dev, &reg, 1, &val, 1, 100);
    return val;
}

static esp_err_t setup_pmic(void) {
    i2c_device_config_t dev_cfg = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = AXP2101_I2C_ADDR,
        .scl_speed_hz = 400000,
    };
    esp_err_t ret = i2c_master_bus_add_device(i2c_bus, &dev_cfg, &axp2101_dev);
    if (ret != ESP_OK) {
        ESP_LOGW(TAG, "AXP2101 PMIC not found on I2C (board may not have one)");
        return ESP_OK;  // Non-fatal: not all boards have a PMIC
    }

    // Verify chip is present by reading status register
    uint8_t chip_id = axp2101_read_reg(0x03);
    ESP_LOGI(TAG, "AXP2101 chip ID register: 0x%02x", chip_id);

    // Power off source config
    axp2101_write_reg(0x22, 0x06);  // PWRON > OFFLEVEL as power-off source
    axp2101_write_reg(0x27, 0x10);  // Hold 4s to power off

    // DC outputs: enable DC1 only (main 3.3V rail)
    axp2101_write_reg(0x80, 0x01);

    // Disable all LDOs initially, then selectively enable
    axp2101_write_reg(0x90, 0x00);  // ALDO1-4, BLDO1-2 off
    axp2101_write_reg(0x91, 0x00);  // DLDO1-2, CPUSLDO off

    // DC1 voltage: 3.3V = (3300-1500)/100 = 18 = 0x12
    axp2101_write_reg(0x82, 0x12);

    // ALDO1 voltage: 3.3V = (3300-500)/100 = 28 = 0x1C
    axp2101_write_reg(0x92, 0x1C);

    // Enable ALDO1 (microphone power)
    axp2101_write_reg(0x90, 0x01);

    // Battery charger config
    axp2101_write_reg(0x64, 0x02);  // CV voltage 4.1V
    axp2101_write_reg(0x61, 0x02);  // Precharge current 50mA
    axp2101_write_reg(0x62, 0x08);  // Charge current 400mA
    axp2101_write_reg(0x63, 0x01);  // Termination current 25mA

    // Read back to verify
    ESP_LOGI(TAG, "AXP2101 PMIC: DC_EN=0x%02x LDO_EN=0x%02x DC1_V=0x%02x ALDO1_V=0x%02x",
             axp2101_read_reg(0x80), axp2101_read_reg(0x90),
             axp2101_read_reg(0x82), axp2101_read_reg(0x92));

    ESP_LOGI(TAG, "AXP2101 PMIC initialized (DC1=3.3V, ALDO1=3.3V)");
    return ESP_OK;
}

// ======== Opus codec setup ========

static esp_err_t setup_opus(void) {
    int err;

    // Encoder: 16kHz mono, CELT-only via RESTRICTED_LOWDELAY.
    // VOIP mode uses SILK which is too slow in floating-point on ESP32-S3
    // (triggers task watchdog). CELT is ~10x faster, fine for voice at 16kbps.
    opus_enc = opus_encoder_create(16000, 1, OPUS_APPLICATION_RESTRICTED_LOWDELAY, &err);
    if (err != OPUS_OK || !opus_enc) {
        ESP_LOGE(TAG, "Opus encoder create failed: %d", err);
        return ESP_FAIL;
    }
    opus_encoder_ctl(opus_enc, OPUS_SET_BITRATE(OPUS_BITRATE));
    opus_encoder_ctl(opus_enc, OPUS_SET_SIGNAL(OPUS_SIGNAL_VOICE));
    opus_encoder_ctl(opus_enc, OPUS_SET_DTX(1));
    opus_encoder_ctl(opus_enc, OPUS_SET_COMPLEXITY(1));  /* minimum — float SILK is slow on ESP32 */
    ESP_LOGI(TAG, "Opus encoder ready (16kHz, 60ms, 16kbps, DTX)");

    // Decoder: 16kHz mono (server sends 24kHz Opus, but we decode at 16kHz;
    // libopus resamples internally to match the decoder's configured rate)
    opus_dec = opus_decoder_create(16000, 1, &err);
    if (err != OPUS_OK || !opus_dec) {
        ESP_LOGE(TAG, "Opus decoder create failed: %d", err);
        return ESP_FAIL;
    }
    ESP_LOGI(TAG, "Opus decoder ready (16kHz output)");

    return ESP_OK;
}

// ======== I2C bus + ES8311 device setup ========

static esp_err_t setup_i2c(void) {
    i2c_master_bus_config_t bus_cfg = {
        .i2c_port = I2C_NUM_0,
        .sda_io_num = PIN_I2C_SDA,
        .scl_io_num = PIN_I2C_SCL,
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .flags.enable_internal_pullup = true,
    };
    ESP_RETURN_ON_ERROR(i2c_new_master_bus(&bus_cfg, &i2c_bus), TAG, "I2C bus init failed");

    i2c_device_config_t dev_cfg = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = ES8311_I2C_ADDR,
        .scl_speed_hz = 400000,
    };
    ESP_RETURN_ON_ERROR(i2c_master_bus_add_device(i2c_bus, &dev_cfg, &es8311_dev), TAG, "ES8311 I2C device add failed");

    return ESP_OK;
}

// ======== I2S setup (full-duplex via separate RX/TX channels) ========

static esp_err_t setup_i2s(void) {
    // I2S config — STEREO mode (matches ES8311 standard I2S expectations).
    // Both the Arduino reference and XiaoZhi firmware use stereo mode.
    // The mono audio data is duplicated to both L+R channels during write.
    i2s_std_config_t std_cfg = {
        .clk_cfg = {
            .sample_rate_hz = I2S_SAMPLE_RATE,
            .clk_src = I2S_CLK_SRC_DEFAULT,
            .mclk_multiple = I2S_MCLK_MULTIPLE_256,
        },
        .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO),
        .gpio_cfg = {
            .mclk = PIN_I2S_MCLK,
            .bclk = PIN_I2S_BCLK,
            .ws = PIN_I2S_WS,
            .dout = PIN_I2S_DOUT,
            .din = PIN_I2S_DIN,
            .invert_flags = {
                .mclk_inv = false,
                .bclk_inv = false,
                .ws_inv = false,
            },
        },
    };

    // Create both TX+RX channels on the same I2S port (full-duplex)
    i2s_chan_config_t chan_cfg = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);
    chan_cfg.dma_desc_num = 4;
    chan_cfg.dma_frame_num = FRAME_SAMPLES;
    ESP_RETURN_ON_ERROR(i2s_new_channel(&chan_cfg, &i2s_tx_chan, &i2s_rx_chan), TAG, "I2S channel create failed");

    // TX (speaker): stereo, both slots active
    std_cfg.slot_cfg.slot_mask = I2S_STD_SLOT_BOTH;
    ESP_RETURN_ON_ERROR(i2s_channel_init_std_mode(i2s_tx_chan, &std_cfg), TAG, "I2S TX init failed");

    // RX (mic): LEFT slot only — in stereo mode this gives us just the mono mic data
    std_cfg.slot_cfg.slot_mask = I2S_STD_SLOT_LEFT;
    ESP_RETURN_ON_ERROR(i2s_channel_init_std_mode(i2s_rx_chan, &std_cfg), TAG, "I2S RX init failed");

    ESP_RETURN_ON_ERROR(i2s_channel_enable(i2s_tx_chan), TAG, "I2S TX enable failed");
    ESP_RETURN_ON_ERROR(i2s_channel_enable(i2s_rx_chan), TAG, "I2S RX enable failed");

    ESP_LOGI(TAG, "I2S initialized (16kHz, 16-bit, stereo, full-duplex)");
    return ESP_OK;
}

// ======== Amplifier enable ========

static bool amp_gpio_initialized = false;

static void amp_enable(bool on) {
    if ((int)PIN_AMP_ENABLE < 0) return;  // GPIO_NUM_NC = -1

    if (!amp_gpio_initialized) {
        gpio_reset_pin(PIN_AMP_ENABLE);
        gpio_config_t io_conf = {
            .pin_bit_mask = (1ULL << PIN_AMP_ENABLE),
            .mode = GPIO_MODE_OUTPUT,
            .pull_up_en = GPIO_PULLUP_DISABLE,
            .pull_down_en = GPIO_PULLDOWN_DISABLE,
        };
        esp_err_t ret = gpio_config(&io_conf);
        if (ret != ESP_OK) {
            ESP_LOGE(TAG, "GPIO%d config FAILED: %s", PIN_AMP_ENABLE, esp_err_to_name(ret));
            return;
        }
        amp_gpio_initialized = true;
    }
    gpio_set_level(PIN_AMP_ENABLE, on ? 1 : 0);
    ESP_LOGI(TAG, "Amplifier %s", on ? "ON" : "OFF");
}

// ======== WiFi ========

static void wifi_event_handler(void *arg, esp_event_base_t base, int32_t id, void *data) {
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        ESP_LOGW(TAG, "WiFi disconnected, reconnecting...");
        esp_wifi_connect();
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *event = (ip_event_got_ip_t *)data;
        ESP_LOGI(TAG, "Got IP: " IPSTR, IP2STR(&event->ip_info.ip));
        xEventGroupSetBits(wifi_events, WIFI_CONNECTED_BIT);
    }
}

static void setup_wifi(void) {
    wifi_events = xEventGroupCreate();

    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_t *netif = esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, NULL, NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &wifi_event_handler, NULL, NULL));

    wifi_config_t wifi_cfg = {
        .sta = {
            .threshold.authmode = WIFI_AUTH_WPA2_PSK,
        },
    };
    strncpy((char *)wifi_cfg.sta.ssid, WIFI_SSID, sizeof(wifi_cfg.sta.ssid));
    strncpy((char *)wifi_cfg.sta.password, WIFI_PASS, sizeof(wifi_cfg.sta.password));

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_cfg));
    ESP_ERROR_CHECK(esp_wifi_start());
    ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));  /* Disable power save — helps with weak signals */

    /* Wait for DHCP with timeout + retry. The ESP32-S3 can send DHCP discover
       before the radio is fully associated, then not retry properly. We
       disconnect cleanly before each retry to release any stale DHCP state
       and avoid leaking addresses from the pool. */
    const int max_retries = 5;
    const TickType_t dhcp_timeout = pdMS_TO_TICKS(9000);

    for (int attempt = 1; attempt <= max_retries; attempt++) {
        ESP_LOGI(TAG, "Waiting for IP (attempt %d/%d)...", attempt, max_retries);
        EventBits_t bits = xEventGroupWaitBits(wifi_events, WIFI_CONNECTED_BIT,
                                                pdFALSE, pdTRUE, dhcp_timeout);
        if (bits & WIFI_CONNECTED_BIT) {
            return;  /* Got IP */
        }

        ESP_LOGW(TAG, "DHCP timeout after 9s, retrying...");

        /* Stop DHCP client cleanly before disconnecting so any in-flight
           lease request is released, not left dangling in the pool */
        esp_netif_dhcpc_stop(netif);
        esp_wifi_disconnect();
        vTaskDelay(pdMS_TO_TICKS(500));

        /* Restart DHCP and reconnect */
        esp_netif_dhcpc_start(netif);
        esp_wifi_connect();
    }

    ESP_LOGE(TAG, "Failed to get IP after %d attempts. Rebooting.", max_retries);
    display_status(2, "WiFi: DHCP failed", COLOR_RED);
    vTaskDelay(pdMS_TO_TICKS(2000));
    esp_restart();
}

// ======== HTTP Authentication (OTA endpoint) ========

/* HTTP response accumulator for esp_http_client event handler */
static char http_response_buf[512];
static int http_response_pos = 0;

static esp_err_t http_event_handler(esp_http_client_event_t *evt) {
    if (evt->event_id == HTTP_EVENT_ON_DATA) {
        int copy = evt->data_len;
        if (http_response_pos + copy >= (int)sizeof(http_response_buf))
            copy = sizeof(http_response_buf) - http_response_pos - 1;
        if (copy > 0) {
            memcpy(http_response_buf + http_response_pos, evt->data, copy);
            http_response_pos += copy;
            http_response_buf[http_response_pos] = '\0';
        }
    }
    return ESP_OK;
}

static bool authenticate(void) {
    char url[256];
#ifdef CONFIG_WORZEL_USE_TLS
    snprintf(url, sizeof(url), "https://%s:%s/api/ota", SERVER_HOST, SERVER_PORT);
#else
    snprintf(url, sizeof(url), "http://%s:%s/api/ota", SERVER_HOST, SERVER_PORT);
#endif
    ESP_LOGI(TAG, "Authenticating via %s", url);

    // Build JSON body
    cJSON *body = cJSON_CreateObject();
    cJSON_AddStringToObject(body, "device_id", DEVICE_ID);
    cJSON_AddStringToObject(body, "board", BOARD_NAME);
    cJSON_AddStringToObject(body, "app_version", "0.1.0");
    char *body_str = cJSON_PrintUnformatted(body);

    // Reset response buffer
    http_response_pos = 0;
    http_response_buf[0] = '\0';

    esp_http_client_config_t http_cfg = {
        .url = url,
        .method = HTTP_METHOD_POST,
        .timeout_ms = 10000,
        .event_handler = http_event_handler,
#ifdef CONFIG_WORZEL_USE_TLS
        .crt_bundle_attach = esp_crt_bundle_attach,
#endif
    };

    esp_http_client_handle_t client = esp_http_client_init(&http_cfg);
    esp_http_client_set_header(client, "Content-Type", "application/json");
    esp_http_client_set_post_field(client, body_str, strlen(body_str));

    esp_err_t err = esp_http_client_perform(client);
    bool ok = false;

    if (err == ESP_OK) {
        int status = esp_http_client_get_status_code(client);
        ESP_LOGI(TAG, "OTA response: HTTP %d, body: %s", status, http_response_buf);

        if (status == 200) {
            cJSON *resp = cJSON_Parse(http_response_buf);
            if (resp) {
                cJSON *token = cJSON_GetObjectItem(resp, "token");
                cJSON *server_url = cJSON_GetObjectItem(resp, "server_url");
                if (token && server_url) {
                    strncpy(auth_token, token->valuestring, sizeof(auth_token) - 1);
                    /* Server may return ws://localhost — override with our configured host */
                    snprintf(ws_url, sizeof(ws_url), "%s://%s:%s/ws",
#ifdef CONFIG_WORZEL_USE_TLS
                             "wss",
#else
                             "ws",
#endif
                             SERVER_HOST, SERVER_PORT);
                    ESP_LOGI(TAG, "Authenticated. WS URL: %s", ws_url);
                    ok = true;
                }
                cJSON_Delete(resp);
            } else {
                ESP_LOGE(TAG, "Failed to parse OTA response JSON");
            }
        } else {
            ESP_LOGE(TAG, "OTA auth failed: HTTP %d", status);
        }
    } else {
        ESP_LOGE(TAG, "HTTP request failed: %s", esp_err_to_name(err));
    }

    esp_http_client_cleanup(client);
    cJSON_free(body_str);
    cJSON_Delete(body);
    return ok;
}

// ======== Worzel Protocol Messages ========

static void send_hello(void) {
    cJSON *msg = cJSON_CreateObject();
    cJSON_AddStringToObject(msg, "type", "hello");
    cJSON_AddNumberToObject(msg, "version", 1);
    cJSON_AddStringToObject(msg, "transport", "websocket");

    cJSON *audio = cJSON_AddObjectToObject(msg, "audio_params");
    cJSON_AddStringToObject(audio, "format", "opus");
    cJSON_AddNumberToObject(audio, "sample_rate", 16000);
    cJSON_AddNumberToObject(audio, "channels", 1);
    cJSON_AddNumberToObject(audio, "frame_duration", FRAME_DURATION_MS);

    cJSON *features = cJSON_AddArrayToObject(msg, "features");
    cJSON_AddItemToArray(features, cJSON_CreateString("tts"));
    cJSON_AddItemToArray(features, cJSON_CreateString("stt"));

    char *str = cJSON_PrintUnformatted(msg);
    esp_websocket_client_send_text(ws_client, str, strlen(str), portMAX_DELAY);
    ESP_LOGI(TAG, "Sent hello");
    cJSON_free(str);
    cJSON_Delete(msg);
}

static void send_listen(const char *state) {
    cJSON *msg = cJSON_CreateObject();
    cJSON_AddStringToObject(msg, "type", "listen");
    cJSON_AddStringToObject(msg, "state", state);
    cJSON_AddStringToObject(msg, "mode", "manual");

    char *str = cJSON_PrintUnformatted(msg);
    esp_websocket_client_send_text(ws_client, str, strlen(str), portMAX_DELAY);
    cJSON_free(str);
    cJSON_Delete(msg);
}

// ======== Display text queue (decoupled from WebSocket handler) ========
// The WS handler must NEVER call display_conversation() directly because
// it blocks on the LVGL mutex (up to 500ms). While blocked, the WS task
// can't receive frames — TCP buffers fill, the playback queue drains,
// and I2S DMA replays stale audio (= stutter). Especially bad during
// touch-scroll when LVGL holds its mutex continuously.
//
// Instead, the WS handler posts text to this queue (non-blocking), and a
// separate display_task consumes it at its own pace on core 0.

#define DISPLAY_QUEUE_LEN 8

typedef struct {
    char text[256];
    uint16_t color;
} display_text_item_t;

static QueueHandle_t display_text_queue = NULL;

static void display_update_task(void *arg) {
    display_text_item_t item;
    while (true) {
        if (xQueueReceive(display_text_queue, &item, portMAX_DELAY) == pdTRUE) {
            display_conversation(item.text, item.color);
        }
    }
}

/* Post text to display queue (non-blocking, safe from any task context) */
static void queue_display_text(const char *text, uint16_t color) {
    if (!display_text_queue || !text || !text[0]) return;
    display_text_item_t item = { .color = color };
    strncpy(item.text, text, sizeof(item.text) - 1);
    item.text[sizeof(item.text) - 1] = '\0';
    if (xQueueSend(display_text_queue, &item, 0) != pdTRUE) {
        ESP_LOGW(TAG, "Display queue full, dropping text update");
    }
}

// ======== Audio playback task (decoupled from WebSocket handler) ========
// Binary Opus frames are queued by the WS handler and decoded+played here.
// This prevents JSON parsing in the WS handler from starving the I2S DMA.

#define PLAYBACK_QUEUE_LEN 30   /* 30 × 60ms = 1.8s buffer */

#define PKT_TYPE_AUDIO     0
#define PKT_TYPE_TTS_START 1    /* reset decoder, flush silence, unmute DAC */
#define PKT_TYPE_TTS_STOP  2    /* mute DAC */
#define PKT_TYPE_SENT_END  3    /* sentence boundary: insert silence gap */

typedef struct {
    uint16_t len;
    uint8_t  type;
    uint8_t  data[MAX_OPUS_PACKET];
} playback_item_t;

static QueueHandle_t playback_queue = NULL;

static void playback_task(void *arg) {
    /* Force internal SRAM — PSRAM has 15-30x higher latency than SRAM,
     * and the mono→stereo loop + Opus decode cause cache misses in PSRAM
     * that accumulate into audible stutter after heap fragmentation. */
    int16_t *pcm_buf = heap_caps_malloc(FRAME_SAMPLES * sizeof(int16_t), MALLOC_CAP_INTERNAL);
    int16_t *stereo_buf = heap_caps_malloc(FRAME_SAMPLES * 2 * sizeof(int16_t), MALLOC_CAP_INTERNAL);
    if (!pcm_buf || !stereo_buf) {
        ESP_LOGE(TAG, "Playback task: buffer alloc failed (need 5.7KB internal SRAM)");
        vTaskDelete(NULL);
        return;
    }

    playback_item_t item;
    int play_frame = 0;
    bool playing = false;  /* true between TTS_START and TTS_STOP */
    ESP_LOGI(TAG, "Playback task started");

    while (true) {
        /* When actively playing, use a short timeout so we can write silence
         * if the queue empties (prevents I2S DMA from replaying the last
         * buffer = stutter). When idle, block forever to save CPU. */
        TickType_t timeout = playing ? pdMS_TO_TICKS(40) : portMAX_DELAY;
        if (xQueueReceive(playback_queue, &item, timeout) != pdTRUE) {
            /* Queue empty during active playback — write silence to prevent
             * I2S DMA circular replay (which sounds like a repeating fragment).
             * This turns network jitter into brief pauses instead of stutter. */
            if (playing) {
                memset(stereo_buf, 0, FRAME_SAMPLES * 2 * sizeof(int16_t));
                size_t wr = 0;
                i2s_channel_write(i2s_tx_chan, stereo_buf,
                                  FRAME_SAMPLES * 2 * sizeof(int16_t),
                                  &wr, pdMS_TO_TICKS(100));
            }
            continue;
        }

        switch (item.type) {
        case PKT_TYPE_TTS_START:
            if (opus_dec) opus_decoder_ctl(opus_dec, OPUS_RESET_STATE);
            /* Brief silence flush to clear stale I2S DMA data before unmuting. */
            {
                int16_t silence[256] = {0};
                size_t wr = 0;
                for (int i = 0; i < 3; i++) {
                    i2s_channel_write(i2s_tx_chan, silence, sizeof(silence),
                                      &wr, pdMS_TO_TICKS(50));
                }
            }
            es8311_write_reg(0x31, 0x00);  /* Unmute DAC */
            play_frame = 0;
            playing = true;
            ESP_LOGI(TAG, "Playback: TTS start");
            break;

        case PKT_TYPE_TTS_STOP:
            /* Let I2S DMA drain its last buffers before muting. */
            vTaskDelay(pdMS_TO_TICKS(150));
            es8311_write_reg(0x31, 0x40);  /* Mute DAC */
            playing = false;
            ESP_LOGI(TAG, "Playback: TTS stop (played %d frames)", play_frame);
            break;

        case PKT_TYPE_SENT_END: {
            int16_t silence[256] = {0};
            size_t wr = 0;
            for (int i = 0; i < 2; i++) {
                i2s_channel_write(i2s_tx_chan, silence, sizeof(silence),
                                  &wr, pdMS_TO_TICKS(50));
            }
            break;
        }

        case PKT_TYPE_AUDIO:
            if (opus_dec && item.len > 0) {
                int decoded = opus_decode(opus_dec, item.data, item.len,
                                          pcm_buf, FRAME_SAMPLES, 0);
                if (decoded > 0) {
                    for (int i = 0; i < decoded; i++) {
                        stereo_buf[i * 2] = pcm_buf[i];
                        stereo_buf[i * 2 + 1] = pcm_buf[i];
                    }
                    size_t written = 0;
                    i2s_channel_write(i2s_tx_chan, stereo_buf,
                                      decoded * 2 * sizeof(int16_t),
                                      &written, pdMS_TO_TICKS(1000));
                    if (play_frame % 50 == 0) {
                        ESP_LOGI(TAG, "Play frame %d: opus=%d decoded=%d written=%zu",
                                 play_frame, item.len, decoded, written);
                    }
                    play_frame++;
                } else {
                    ESP_LOGW(TAG, "Opus decode error: %d (len=%d)", decoded, item.len);
                }
            }
            break;
        }
    }
}

/* Queue a playback command (non-blocking from WS handler context) */
static void queue_playback(uint8_t type, const uint8_t *data, int len) {
    if (!playback_queue) return;
    playback_item_t item = { .type = type, .len = 0 };
    if (data && len > 0 && len <= MAX_OPUS_PACKET) {
        memcpy(item.data, data, len);
        item.len = len;
    }
    if (xQueueSend(playback_queue, &item, 0) != pdTRUE) {
        ESP_LOGW(TAG, "Playback queue full, dropping packet (type=%d)", type);
    }
}

// ======== WebSocket event handler ========

static void ws_event_handler(void *arg, esp_event_base_t base, int32_t id, void *data) {
    esp_websocket_event_data_t *ev = (esp_websocket_event_data_t *)data;

    switch (id) {
    case WEBSOCKET_EVENT_CONNECTED:
        ESP_LOGI(TAG, "WebSocket connected");
        ws_connected = true;
        display_status(5, "WebSocket: connected", COLOR_GREEN);
        send_hello();
        break;

    case WEBSOCKET_EVENT_DISCONNECTED:
        ESP_LOGW(TAG, "WebSocket disconnected");
        ws_connected = false;
        display_status(5, "WebSocket: disconnected", COLOR_RED);
        break;

    case WEBSOCKET_EVENT_DATA:
        if (ev->op_code == 0x01) {
            // Text message — parse JSON
            char *text = strndup((char *)ev->data_ptr, ev->data_len);
            if (text) {
                cJSON *msg = cJSON_Parse(text);
                if (msg) {
                    cJSON *type = cJSON_GetObjectItem(msg, "type");
                    if (type && type->valuestring) {
                        if (strcmp(type->valuestring, "hello") == 0) {
                            cJSON *sid = cJSON_GetObjectItem(msg, "session_id");
                            ESP_LOGI(TAG, "Server hello, session: %s",
                                     sid ? sid->valuestring : "?");
                        } else if (strcmp(type->valuestring, "stt") == 0) {
                            cJSON *t = cJSON_GetObjectItem(msg, "text");
                            ESP_LOGI(TAG, "STT: %s", t ? t->valuestring : "");
                            if (t && t->valuestring) {
                                char prefixed[512];
                                snprintf(prefixed, sizeof(prefixed), "> %s", t->valuestring);
                                queue_display_text(prefixed, COLOR_CYAN);
                            }
                        } else if (strcmp(type->valuestring, "tts") == 0) {
                            cJSON *s = cJSON_GetObjectItem(msg, "state");
                            cJSON *t = cJSON_GetObjectItem(msg, "text");
                            ESP_LOGI(TAG, "TTS %s: %s",
                                     s ? s->valuestring : "?",
                                     t ? t->valuestring : "");
                            if (t && t->valuestring) {
                                queue_display_text(t->valuestring, COLOR_GREEN);
                            }
                            // Queue DAC control to playback task (non-blocking)
                            if (s && s->valuestring) {
                                if (strcmp(s->valuestring, "start") == 0) {
                                    queue_playback(PKT_TYPE_TTS_START, NULL, 0);
                                } else if (strcmp(s->valuestring, "sentence_end") == 0) {
                                    queue_playback(PKT_TYPE_SENT_END, NULL, 0);
                                } else if (strcmp(s->valuestring, "stop") == 0) {
                                    queue_playback(PKT_TYPE_TTS_STOP, NULL, 0);
                                }
                            }
                        } else if (strcmp(type->valuestring, "error") == 0) {
                            cJSON *m = cJSON_GetObjectItem(msg, "message");
                            ESP_LOGE(TAG, "Server error: %s", m ? m->valuestring : "?");
                        }
                    }
                    cJSON_Delete(msg);
                }
                free(text);
            }
        } else if (ev->op_code == 0x02) {
            // Binary message — queue Opus frame for playback task (non-blocking)
            queue_playback(PKT_TYPE_AUDIO,
                           (const uint8_t *)ev->data_ptr, ev->data_len);
        }
        break;

    case WEBSOCKET_EVENT_ERROR:
        ESP_LOGE(TAG, "WebSocket error");
        break;

    default:
        break;
    }
}

static void connect_websocket(void) {
    // Build WS URL with auth token
    char full_url[768];
    snprintf(full_url, sizeof(full_url), "%s?token=%s", ws_url, auth_token);
    ESP_LOGI(TAG, "WebSocket URL: %s", full_url);

    esp_websocket_client_config_t ws_cfg = {
        .uri = full_url,
        .buffer_size = 4096,
        .task_stack = 12288,  /* 12KB — TLS needs much more than the 3KB default */
#ifdef CONFIG_WORZEL_USE_TLS
        .crt_bundle_attach = esp_crt_bundle_attach,
#endif
    };

    ws_client = esp_websocket_client_init(&ws_cfg);
    esp_websocket_register_events(ws_client, WEBSOCKET_EVENT_ANY, ws_event_handler, NULL);
    esp_websocket_client_start(ws_client);

    ESP_LOGI(TAG, "WebSocket connecting...");
}

// ======== Audio recording task ========

static void audio_task(void *arg) {
    int16_t *pcm_buf = heap_caps_malloc(FRAME_BYTES, MALLOC_CAP_DMA);
    uint8_t *opus_buf = malloc(MAX_OPUS_PACKET);
    if (!pcm_buf || !opus_buf) {
        ESP_LOGE(TAG, "Failed to allocate audio buffers");
        vTaskDelete(NULL);
        return;
    }

    ESP_LOGI(TAG, "Audio task started (frame=%d samples, %d bytes)",
             FRAME_SAMPLES, FRAME_BYTES);

    int frame_count = 0;
    while (true) {
        if (recording && ws_connected && i2s_rx_chan && opus_enc) {
            size_t bytes_read = 0;
            esp_err_t ret = i2s_channel_read(i2s_rx_chan, pcm_buf, FRAME_BYTES,
                                              &bytes_read, pdMS_TO_TICKS(100));
            if (ret == ESP_OK && bytes_read >= FRAME_BYTES) {
                // Log PCM stats every 5th frame to diagnose mic signal level
                if (frame_count % 5 == 0) {
                    int16_t mn = 0, mx = 0;
                    for (int i = 0; i < FRAME_SAMPLES; i++) {
                        if (pcm_buf[i] < mn) mn = pcm_buf[i];
                        if (pcm_buf[i] > mx) mx = pcm_buf[i];
                    }
                    ESP_LOGI(TAG, "PCM frame %d: min=%d max=%d (bytes_read=%zu)",
                             frame_count, mn, mx, bytes_read);
                }
                frame_count++;

                int encoded = opus_encode(opus_enc, pcm_buf, FRAME_SAMPLES,
                                          opus_buf, MAX_OPUS_PACKET);
                if (encoded > 0) {
                    esp_websocket_client_send_bin(ws_client, (char *)opus_buf,
                                                   encoded, portMAX_DELAY);
                } else {
                    ESP_LOGW(TAG, "Opus encode error: %d", encoded);
                }
            }
            /* Delay 1 tick to let IDLE task run — prevents task watchdog.
               taskYIELD() only yields to equal/higher priority tasks;
               IDLE is priority 0, so it never gets CPU time from yield. */
            vTaskDelay(1);
        } else {
            vTaskDelay(pdMS_TO_TICKS(50));
        }
    }

    heap_caps_free(pcm_buf);
    free(opus_buf);
    vTaskDelete(NULL);
}

// ======== Button handling ========

static void button_task(void *arg) {
    gpio_config_t btn_cfg = {
        .pin_bit_mask = (1ULL << PIN_BUTTON),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
    };
    gpio_config(&btn_cfg);

    bool was_pressed = false;

    while (true) {
        bool pressed = (gpio_get_level(PIN_BUTTON) == 0);

        if (pressed && !was_pressed && ws_connected) {
            // Button down — start recording
            // Flush any stale TTS audio from the playback queue so the
            // queue has room for the new response after recording stops.
            // This replaces the old xQueueReset() in the tts:start handler,
            // which killed filler audio mid-stream and caused stutter.
            if (playback_queue) xQueueReset(playback_queue);
            es8311_write_reg(0x31, 0x40);  // Mute DAC immediately
            recording = true;
            send_listen("start");
            amp_enable(false);  // Mute speaker while recording
            ESP_LOGI(TAG, "Recording started (button down)");
        } else if (!pressed && was_pressed && recording) {
            // Button up — stop recording
            recording = false;
            send_listen("stop");
            amp_enable(true);   // Unmute speaker for playback
            ESP_LOGI(TAG, "Recording stopped (button up)");
        }

        was_pressed = pressed;
        vTaskDelay(pdMS_TO_TICKS(20));  // 50Hz polling
    }
}

// ======== Main ========

void app_main(void) {
    // Delay so USB serial monitor has time to connect before boot logs
    vTaskDelay(pdMS_TO_TICKS(2000));
    ESP_LOGI(TAG, "Worzel client starting on %s", BOARD_NAME);

    // Init NVS (required for WiFi)
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ESP_ERROR_CHECK(nvs_flash_init());
    }

    // Init I2C → PMIC → ES8311 codec
    ESP_ERROR_CHECK(setup_i2c());
    setup_pmic();  // Non-fatal if PMIC absent; must run before codec
    ESP_ERROR_CHECK(es8311_init_codec());

    // Init display (uses same I2C bus for IO expander)
    if (display_init(i2c_bus) != ESP_OK) {
        ESP_LOGW(TAG, "Display init failed (continuing without display)");
    }

    // Init I2S (after codec, so MCLK feeds into initialized codec)
    ESP_ERROR_CHECK(setup_i2s());
    display_status(0, "Audio: OK", COLOR_GREEN);

    // Init Opus encoder/decoder
    ESP_ERROR_CHECK(setup_opus());
    display_status(1, "Opus: OK", COLOR_GREEN);

    // Enable amplifier
    amp_enable(true);

    // Startup melody — verifies speaker hardware path (I2S → ES8311 DAC → amp)
    ESP_LOGI(TAG, "Playing startup melody...");
    melody_play(i2s_tx_chan, I2S_SAMPLE_RATE);
    ESP_LOGI(TAG, "Startup melody done");

    // Mute DAC after melody. Do NOT disable I2S TX — in full-duplex,
    // TX and RX share the clock. Disabling TX kills the mic.
    // The DMA may replay stale data but the DAC is muted so no sound.
    es8311_write_reg(0x31, 0x40);  // Mute DAC
    ESP_LOGI(TAG, "DAC muted after melody");

    // Post-melody diagnostic: re-read key DAC registers to verify config
    ESP_LOGI(TAG, "DAC diag: REG00=0x%02x REG01=0x%02x REG0D=0x%02x REG12=0x%02x "
             "REG13=0x%02x REG31=0x%02x REG32=0x%02x REG44=0x%02x",
             es8311_read_reg(0x00), es8311_read_reg(0x01), es8311_read_reg(0x0D),
             es8311_read_reg(0x12), es8311_read_reg(0x13), es8311_read_reg(0x31),
             es8311_read_reg(0x32), es8311_read_reg(0x44));
    ESP_LOGI(TAG, "Amp GPIO%d level=%d", PIN_AMP_ENABLE, gpio_get_level(PIN_AMP_ENABLE));

    // Connect WiFi
    display_status(2, "WiFi: connecting...", COLOR_YELLOW);
    setup_wifi();

    // Show IP (re-read from netif)
    {
        esp_netif_t *netif = esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");
        esp_netif_ip_info_t ip_info;
        if (netif && esp_netif_get_ip_info(netif, &ip_info) == ESP_OK) {
            char ip_str[48];
            snprintf(ip_str, sizeof(ip_str), "IP: " IPSTR, IP2STR(&ip_info.ip));
            display_status(2, "WiFi: connected", COLOR_GREEN);
            display_status(3, ip_str, COLOR_CYAN);
        }
    }

    // Start NTP time sync (for clock display)
    esp_sntp_setoperatingmode(ESP_SNTP_OPMODE_POLL);
    esp_sntp_setservername(0, "pool.ntp.org");
    esp_sntp_init();

    // Authenticate with Worzel server
    display_status(4, "Auth: connecting...", COLOR_YELLOW);
    if (!authenticate()) {
        ESP_LOGE(TAG, "Authentication failed. Halting.");
        display_status(4, "Auth: FAILED", COLOR_RED);
        return;
    }
    display_status(4, "Auth: OK", COLOR_GREEN);

    // Create queues (must exist before WS connects and sends audio/text)
    playback_queue = xQueueCreate(PLAYBACK_QUEUE_LEN, sizeof(playback_item_t));
    if (!playback_queue) {
        ESP_LOGE(TAG, "FAILED to create playback queue!");
    }
    display_text_queue = xQueueCreate(DISPLAY_QUEUE_LEN, sizeof(display_text_item_t));
    if (!display_text_queue) {
        ESP_LOGE(TAG, "FAILED to create display text queue!");
    }

    // Connect WebSocket
    display_status(5, "WebSocket: connecting...", COLOR_YELLOW);
    connect_websocket();

    // Heap diagnostics before task creation
    ESP_LOGI(TAG, "Heap free: %lu total, %lu largest block, %lu DMA-capable, %lu internal",
             (unsigned long)esp_get_free_heap_size(),
             (unsigned long)heap_caps_get_largest_free_block(MALLOC_CAP_DEFAULT),
             (unsigned long)heap_caps_get_free_size(MALLOC_CAP_DMA),
             (unsigned long)heap_caps_get_free_size(MALLOC_CAP_INTERNAL));

    // Start audio capture task (mic → Opus → server)
    BaseType_t audio_ok = xTaskCreatePinnedToCore(audio_task, "audio", 16384, NULL, 5, NULL,
                            1 /* core 1 if available, else 0 on single-core */);
    if (audio_ok != pdPASS) {
        ESP_LOGE(TAG, "FAILED to create audio task! (heap exhausted?)");
    }

    // Start playback task (server → Opus decode → I2S speaker)
    // Runs on core 1 at priority 5. Writes silence on queue underrun
    // to prevent I2S DMA from replaying the last buffer (= stutter).
    BaseType_t play_ok = xTaskCreatePinnedToCore(playback_task, "playback", 8192, NULL, 5, NULL, 1);
    if (play_ok != pdPASS) {
        ESP_LOGE(TAG, "FAILED to create playback task!");
    }

    // Start display update task — processes text from display_text_queue.
    // Runs on core 0 (where LVGL runs) at priority 3 (above LVGL's 2,
    // below WiFi). This task is the ONLY one that calls display_conversation(),
    // so the LVGL mutex never blocks the WS handler or audio tasks.
    BaseType_t disp_ok = xTaskCreatePinnedToCore(display_update_task, "disp_text", 4096, NULL, 3, NULL, 0);
    if (disp_ok != pdPASS) {
        ESP_LOGE(TAG, "FAILED to create display update task!");
    }

    display_status(6, "Push to talk", COLOR_WHITE);

    // Button handling on main core
    button_task(NULL);  // Blocks forever
}
