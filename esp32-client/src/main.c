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

    // Clock config — MCLK from I2S, 16kHz sample rate
    // REG01: MCLK from MCLK pin, enable all clocks
    es8311_write_reg(0x01, 0x3F);
    // REG02: pre_div=1, pre_multi=x2  (for MCLK=4.096MHz = 16000*256)
    es8311_write_reg(0x02, 0x08);
    // REG03: single speed, ADC OSR=16
    es8311_write_reg(0x03, 0x10);
    // REG04: DAC OSR=16
    es8311_write_reg(0x04, 0x10);
    // REG05: ADC div=1, DAC div=1
    es8311_write_reg(0x05, 0x00);
    // REG06: BCLK divider=4
    es8311_write_reg(0x06, 0x04);
    // REG07-08: LRCK divider=255 (MCLK/256 = sample rate)
    es8311_write_reg(0x07, 0x00);
    es8311_write_reg(0x08, 0xFF);

    // I2S format: 16-bit, I2S standard
    es8311_write_reg(0x09, 0x0C);  // SDP_IN (DAC): 16-bit I2S
    es8311_write_reg(0x0A, 0x0C);  // SDP_OUT (ADC): 16-bit I2S

    // Power up analog
    es8311_write_reg(0x0D, 0x01);
    // Enable PGA + ADC modulator
    es8311_write_reg(0x0E, 0x02);
    // Power up DAC
    es8311_write_reg(0x12, 0x00);
    // Enable HP output driver
    es8311_write_reg(0x13, 0x10);

    // Mic input: analog mic (MIC1P-MIC1N), PGA gain 24dB
    es8311_write_reg(0x14, 0x18);

    // ADC digital config
    es8311_write_reg(0x16, 0x24);  // ADC gain scale
    es8311_write_reg(0x17, 0xC8);  // ADC volume (~0dB)
    es8311_write_reg(0x1C, 0x6A);  // Bypass ADC EQ

    // DAC config
    es8311_write_reg(0x31, 0x00);  // Unmute DAC
    es8311_write_reg(0x32, 0xBF);  // DAC volume 0dB
    es8311_write_reg(0x37, 0x08);  // Bypass DAC EQ

    // GPIO config
    es8311_write_reg(0x44, 0x08);

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

    // Encoder: 16kHz mono VOIP (mic → server)
    opus_enc = opus_encoder_create(16000, 1, OPUS_APPLICATION_VOIP, &err);
    if (err != OPUS_OK || !opus_enc) {
        ESP_LOGE(TAG, "Opus encoder create failed: %d", err);
        return ESP_FAIL;
    }
    opus_encoder_ctl(opus_enc, OPUS_SET_BITRATE(OPUS_BITRATE));
    opus_encoder_ctl(opus_enc, OPUS_SET_SIGNAL(OPUS_SIGNAL_VOICE));
    opus_encoder_ctl(opus_enc, OPUS_SET_DTX(1));
    opus_encoder_ctl(opus_enc, OPUS_SET_COMPLEXITY(5));  /* moderate for ESP32 */
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
    esp_netif_create_default_wifi_sta();

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

    ESP_LOGI(TAG, "Waiting for WiFi...");
    xEventGroupWaitBits(wifi_events, WIFI_CONNECTED_BIT, pdFALSE, pdTRUE, portMAX_DELAY);
}

// ======== HTTP Authentication (OTA endpoint) ========

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

    // HTTP response buffer
    char response_buf[512] = {0};
    int response_len = 0;

    esp_http_client_config_t http_cfg = {
        .url = url,
        .method = HTTP_METHOD_POST,
        .timeout_ms = 10000,
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
        response_len = esp_http_client_get_content_length(client);
        if (response_len > 0 && response_len < (int)sizeof(response_buf)) {
            esp_http_client_read(client, response_buf, response_len);
        }

        if (status == 200) {
            cJSON *resp = cJSON_Parse(response_buf);
            if (resp) {
                cJSON *token = cJSON_GetObjectItem(resp, "token");
                cJSON *server_url = cJSON_GetObjectItem(resp, "server_url");
                if (token && server_url) {
                    strncpy(auth_token, token->valuestring, sizeof(auth_token) - 1);
                    strncpy(ws_url, server_url->valuestring, sizeof(ws_url) - 1);
                    ESP_LOGI(TAG, "Authenticated. WS URL: %s", ws_url);
                    ok = true;
                }
                cJSON_Delete(resp);
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
        send_hello();
        break;

    case WEBSOCKET_EVENT_DISCONNECTED:
        ESP_LOGW(TAG, "WebSocket disconnected");
        ws_connected = false;
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
                        } else if (strcmp(type->valuestring, "tts") == 0) {
                            cJSON *s = cJSON_GetObjectItem(msg, "state");
                            cJSON *t = cJSON_GetObjectItem(msg, "text");
                            ESP_LOGI(TAG, "TTS %s: %s",
                                     s ? s->valuestring : "?",
                                     t ? t->valuestring : "");
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

    // Init I2S (after codec, so MCLK feeds into initialized codec)
    ESP_ERROR_CHECK(setup_i2s());

    // Init Opus encoder/decoder
    ESP_ERROR_CHECK(setup_opus());

    // Enable amplifier
    amp_enable(true);

    // Connect WiFi
    setup_wifi();

    // Authenticate with Worzel server
    if (!authenticate()) {
        ESP_LOGE(TAG, "Authentication failed. Halting.");
        return;
    }

    // Connect WebSocket
    connect_websocket();

    // Start audio capture task
    xTaskCreatePinnedToCore(audio_task, "audio", 8192, NULL, 5, NULL,
                            1 /* core 1 if available, else 0 on single-core */);

    // Button handling on main core
    button_task(NULL);  // Blocks forever
}
