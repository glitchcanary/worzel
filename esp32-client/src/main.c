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

#include "board.h"
#include "display.h"

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
#define OPUS_BITRATE       16000   /* 16 kbps */
#define MAX_OPUS_PACKET    512     /* generous upper bound for encoded Opus frame */

// ======== State ========
static i2s_chan_handle_t i2s_rx_chan = NULL;  /* mic */
static i2s_chan_handle_t i2s_tx_chan = NULL;  /* speaker */
static i2c_master_bus_handle_t i2c_bus = NULL;
static i2c_master_dev_handle_t es8311_dev = NULL;
static esp_websocket_client_handle_t ws_client = NULL;

static OpusEncoder *opus_enc = NULL;
static OpusDecoder *opus_dec = NULL;

static char auth_token[256] = {0};
static char ws_url[256] = {0};
static bool ws_connected = false;
static bool recording = false;

static EventGroupHandle_t wifi_events;
#define WIFI_CONNECTED_BIT BIT0

// ======== ES8311 codec (I2C register writes) ========

static esp_err_t es8311_write_reg(uint8_t reg, uint8_t val) {
    uint8_t buf[2] = {reg, val};
    return i2c_master_transmit(es8311_dev, buf, 2, 100);
}

static esp_err_t es8311_init_codec(void) {
    esp_err_t ret;

    // Reset
    ret = es8311_write_reg(0x00, 0x1F);  // Assert all resets
    vTaskDelay(pdMS_TO_TICKS(20));
    ret = es8311_write_reg(0x00, 0x00);  // Deassert resets
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "ES8311 not responding on I2C");
        return ret;
    }

    // Clock config — MCLK from I2S master, 16kHz sample rate.
    // Values from Espressif ESP-ADF coefficient table for MCLK=4.096MHz, fs=16kHz.
    // REG01: MCLK from MCLK pin, enable MCLK+ADC+DAC clocks
    es8311_write_reg(0x01, 0x3F);
    // REG02: pre_div=1 (bits 7:5=0), pre_multi=0 (bits 4:3=0)
    es8311_write_reg(0x02, 0x00);
    // REG03: ADC OSR=16
    es8311_write_reg(0x03, 0x10);
    // REG04: DAC OSR=16 (matches official esp-adf driver for 16kHz)
    es8311_write_reg(0x04, 0x10);
    // REG05: ADC div=1, DAC div=1
    es8311_write_reg(0x05, 0x00);
    // REG06: BCLK divider=4
    es8311_write_reg(0x06, 0x04);
    // REG07-08: LRCK divider=255 (MCLK/256 = 16kHz)
    es8311_write_reg(0x07, 0x00);
    es8311_write_reg(0x08, 0xFF);

    // I2S format: 16-bit, I2S standard
    es8311_write_reg(0x09, 0x0C);  // SDP_IN (DAC): 16-bit I2S
    es8311_write_reg(0x0A, 0x0C);  // SDP_OUT (ADC): 16-bit I2S

    // System config (from esp-adf/esp-bsp official drivers)
    es8311_write_reg(0x0B, 0x00);
    es8311_write_reg(0x0C, 0x00);
    es8311_write_reg(0x10, 0x1F);
    es8311_write_reg(0x11, 0x7F);

    // Power up analog (VMID/VREF ramp)
    es8311_write_reg(0x0D, 0x01);
    // ADC analog power: PGA + ADC modulator enabled.
    // Bits are ACTIVE-LOW: 0=enable, 1=power down.
    // Bit 6 (PDN_PGA)=0, Bit 5 (PDN_MOD)=0, Bit 1=1 (per official drivers).
    es8311_write_reg(0x0E, 0x02);
    // Power up DAC
    es8311_write_reg(0x12, 0x00);
    // Enable HP output driver
    es8311_write_reg(0x13, 0x10);

    // Mic input: analog mic (MIC1P-MIC1N), PGA gain 30dB (matches official drivers)
    es8311_write_reg(0x14, 0x1A);

    // ADC digital config
    es8311_write_reg(0x15, 0x40);  // ADC ramp rate
    es8311_write_reg(0x16, 0x24);  // ADC gain scale
    es8311_write_reg(0x17, 0xC8);  // ADC volume (~0dB)
    es8311_write_reg(0x1B, 0x0A);  // ADC EQ config
    es8311_write_reg(0x1C, 0x6A);  // Bypass ADC EQ, cancel DC offset

    // DAC config
    es8311_write_reg(0x31, 0x00);  // Unmute DAC
    es8311_write_reg(0x32, 0xBF);  // DAC volume 0dB
    es8311_write_reg(0x37, 0x08);  // Bypass DAC EQ

    // GPIO config
    es8311_write_reg(0x44, 0x08);
    es8311_write_reg(0x45, 0x00);

    // Start codec state machine
    es8311_write_reg(0x00, 0x80);
    vTaskDelay(pdMS_TO_TICKS(50));

    ESP_LOGI(TAG, "ES8311 initialized (16kHz, 16-bit, I2S slave)");
    return ESP_OK;
}

static void es8311_set_volume(uint8_t vol) __attribute__((unused));
static void es8311_set_volume(uint8_t vol) {
    es8311_write_reg(0x32, vol);  // 0x00=-95.5dB, 0xBF=0dB, 0xFF=+32dB
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
    // Shared I2S clock config
    i2s_std_config_t std_cfg = {
        .clk_cfg = {
            .sample_rate_hz = I2S_SAMPLE_RATE,
            .clk_src = I2S_CLK_SRC_DEFAULT,
            .mclk_multiple = I2S_MCLK_MULTIPLE_256,
        },
        .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_MONO),
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

    /* Override default LEFT-only slot mask. Mono mode defaults to I2S_STD_SLOT_LEFT
       but the ES8311 DAC may read from either slot. Writing to BOTH ensures the
       codec gets data regardless of which slot it expects. */
    std_cfg.slot_cfg.slot_mask = I2S_STD_SLOT_BOTH;

    // Create both TX+RX channels on the same I2S port (full-duplex)
    i2s_chan_config_t chan_cfg = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);
    chan_cfg.dma_desc_num = 4;
    chan_cfg.dma_frame_num = FRAME_SAMPLES;
    ESP_RETURN_ON_ERROR(i2s_new_channel(&chan_cfg, &i2s_tx_chan, &i2s_rx_chan), TAG, "I2S channel create failed");

    ESP_RETURN_ON_ERROR(i2s_channel_init_std_mode(i2s_tx_chan, &std_cfg), TAG, "I2S TX init failed");
    ESP_RETURN_ON_ERROR(i2s_channel_init_std_mode(i2s_rx_chan, &std_cfg), TAG, "I2S RX init failed");

    ESP_RETURN_ON_ERROR(i2s_channel_enable(i2s_tx_chan), TAG, "I2S TX enable failed");
    ESP_RETURN_ON_ERROR(i2s_channel_enable(i2s_rx_chan), TAG, "I2S RX enable failed");

    ESP_LOGI(TAG, "I2S initialized (16kHz, 16-bit, mono, full-duplex)");
    return ESP_OK;
}

// ======== Amplifier enable ========

static void amp_enable(bool on) {
#if PIN_AMP_ENABLE != GPIO_NUM_NC
    gpio_config_t io_conf = {
        .pin_bit_mask = (1ULL << PIN_AMP_ENABLE),
        .mode = GPIO_MODE_OUTPUT,
    };
    gpio_config(&io_conf);
    gpio_set_level(PIN_AMP_ENABLE, on ? 1 : 0);
    ESP_LOGI(TAG, "Amplifier %s", on ? "ON" : "OFF");
#endif
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
    display_status(5, "WiFi: DHCP failed", COLOR_RED);
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

// ======== WebSocket event handler ========

static void ws_event_handler(void *arg, esp_event_base_t base, int32_t id, void *data) {
    esp_websocket_event_data_t *ev = (esp_websocket_event_data_t *)data;

    switch (id) {
    case WEBSOCKET_EVENT_CONNECTED:
        ESP_LOGI(TAG, "WebSocket connected");
        ws_connected = true;
        display_status(9, "WebSocket: connected", COLOR_GREEN);
        send_hello();
        break;

    case WEBSOCKET_EVENT_DISCONNECTED:
        ESP_LOGW(TAG, "WebSocket disconnected");
        ws_connected = false;
        display_status(9, "WebSocket: disconnected", COLOR_RED);
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
                                display_status(13, t->valuestring, COLOR_CYAN);
                            }
                        } else if (strcmp(type->valuestring, "tts") == 0) {
                            cJSON *s = cJSON_GetObjectItem(msg, "state");
                            cJSON *t = cJSON_GetObjectItem(msg, "text");
                            ESP_LOGI(TAG, "TTS %s: %s",
                                     s ? s->valuestring : "?",
                                     t ? t->valuestring : "");
                            if (t && t->valuestring) {
                                display_status(15, t->valuestring, COLOR_GREEN);
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
            // Binary message — Opus audio from server, decode and play
            if (i2s_tx_chan && opus_dec && ev->data_len > 0) {
                int16_t pcm_buf[FRAME_SAMPLES];
                int decoded = opus_decode(opus_dec, (const unsigned char *)ev->data_ptr,
                                          ev->data_len, pcm_buf, FRAME_SAMPLES, 0);
                if (decoded > 0) {
                    size_t written = 0;
                    i2s_channel_write(i2s_tx_chan, pcm_buf, decoded * sizeof(int16_t),
                                      &written, 100);
                } else {
                    ESP_LOGW(TAG, "Opus decode error: %d", decoded);
                }
            }
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

    while (true) {
        if (recording && ws_connected && i2s_rx_chan && opus_enc) {
            size_t bytes_read = 0;
            esp_err_t ret = i2s_channel_read(i2s_rx_chan, pcm_buf, FRAME_BYTES,
                                              &bytes_read, pdMS_TO_TICKS(100));
            if (ret == ESP_OK && bytes_read >= FRAME_BYTES) {
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
    ESP_LOGI(TAG, "Worzel client starting on %s", BOARD_NAME);

    // Init NVS (required for WiFi)
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ESP_ERROR_CHECK(nvs_flash_init());
    }

    // Init I2C → ES8311 codec
    ESP_ERROR_CHECK(setup_i2c());
    ESP_ERROR_CHECK(es8311_init_codec());

    // Init display (uses same I2C bus for IO expander)
    if (display_init(i2c_bus) != ESP_OK) {
        ESP_LOGW(TAG, "Display init failed (continuing without display)");
    }

    // Init I2S (after codec, so MCLK feeds into initialized codec)
    ESP_ERROR_CHECK(setup_i2s());
    display_status(2, "Audio: OK", COLOR_GREEN);

    // Init Opus encoder/decoder
    ESP_ERROR_CHECK(setup_opus());
    display_status(3, "Opus: OK", COLOR_GREEN);

    // Enable amplifier
    amp_enable(true);

    // Startup beep — verifies speaker hardware path (I2S → ES8311 DAC → amp)
    {
        const int tone_hz = 1000;
        const int duration_ms = 500;
        const int samples = I2S_SAMPLE_RATE * duration_ms / 1000;  /* 8000 samples */
        int16_t *tone_buf = malloc(samples * sizeof(int16_t));
        if (tone_buf) {
            for (int i = 0; i < samples; i++) {
                /* 1kHz sine at ~75% volume (24000/32767) */
                float t = (float)i / I2S_SAMPLE_RATE;
                tone_buf[i] = (int16_t)(24000.0f * sinf(2.0f * 3.14159f * tone_hz * t));
            }
            size_t written = 0;
            i2s_channel_write(i2s_tx_chan, tone_buf, samples * sizeof(int16_t),
                              &written, pdMS_TO_TICKS(1000));
            ESP_LOGI(TAG, "Startup beep: %d/%d samples written",
                     (int)(written / sizeof(int16_t)), samples);
            free(tone_buf);
        }
    }

    // Connect WiFi
    display_status(5, "WiFi: connecting...", COLOR_YELLOW);
    setup_wifi();

    // Show IP (re-read from netif)
    {
        esp_netif_t *netif = esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");
        esp_netif_ip_info_t ip_info;
        if (netif && esp_netif_get_ip_info(netif, &ip_info) == ESP_OK) {
            char ip_str[48];
            snprintf(ip_str, sizeof(ip_str), "IP: " IPSTR, IP2STR(&ip_info.ip));
            display_status(5, "WiFi: connected", COLOR_GREEN);
            display_status(6, ip_str, COLOR_CYAN);
        }
    }

    // Authenticate with Worzel server
    display_status(8, "Auth: connecting...", COLOR_YELLOW);
    if (!authenticate()) {
        ESP_LOGE(TAG, "Authentication failed. Halting.");
        display_status(8, "Auth: FAILED", COLOR_RED);
        return;
    }
    display_status(8, "Auth: OK", COLOR_GREEN);

    // Connect WebSocket
    display_status(9, "WebSocket: connecting...", COLOR_YELLOW);
    connect_websocket();

    // Start audio capture task
    xTaskCreatePinnedToCore(audio_task, "audio", 32768, NULL, 5, NULL,
                            1 /* core 1 if available, else 0 on single-core */);

    display_status(11, "Ready - hold button to talk", COLOR_WHITE);

    // Button handling on main core
    button_task(NULL);  // Blocks forever
}
