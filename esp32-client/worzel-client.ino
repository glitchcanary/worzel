/**
 * Worzel ESP32 Client — Clean-room minimal implementation.
 *
 * Connects to a worzel server via:
 * 1. HTTP POST to /api/ota for authentication
 * 2. WebSocket for bidirectional communication
 *
 * Hardware:
 * - ESP32-S3 or ESP32-C3
 * - INMP441 I2S microphone (or any I2S mic)
 * - MAX98357A I2S amplifier (or any I2S DAC)
 * - Push-to-talk button on GPIO 0
 *
 * This is a proof-of-concept. For production, add:
 * - TLS certificate validation
 * - Secure Boot + Flash Encryption
 * - Proper error recovery
 * - OTA firmware updates with signature verification
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <driver/i2s.h>

// ======== Configuration ========
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";
const char* WORZEL_SERVER = "192.168.1.100";  // Your worzel server IP
const int   WORZEL_PORT = 3000;
const char* DEVICE_ID = "esp32-worzel-001";

// ======== Pin Configuration ========
// I2S Microphone (INMP441)
#define I2S_MIC_PORT     I2S_NUM_0
#define I2S_MIC_SCK      14   // Serial Clock
#define I2S_MIC_WS       15   // Word Select
#define I2S_MIC_SD       32   // Serial Data

// I2S Speaker (MAX98357A)
#define I2S_SPK_PORT     I2S_NUM_1
#define I2S_SPK_SCK      26
#define I2S_SPK_WS       25
#define I2S_SPK_SD       22

// Button
#define BUTTON_PIN       0    // BOOT button on most ESP32 boards

// ======== Audio Configuration ========
#define SAMPLE_RATE      16000
#define SAMPLE_BITS      16
#define CHANNELS         1
#define FRAME_DURATION   60   // ms
#define FRAME_SAMPLES    (SAMPLE_RATE * FRAME_DURATION / 1000)  // 960

// ======== State ========
WebSocketsClient ws;
String authToken = "";
String wsUrl = "";
bool connected = false;
bool recording = false;
int16_t audioBuffer[FRAME_SAMPLES];

// ======== Setup ========
void setup() {
  Serial.begin(115200);
  Serial.println("\n[worzel] Starting...");

  pinMode(BUTTON_PIN, INPUT_PULLUP);

  // Connect to WiFi
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("[worzel] Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.printf("\n[worzel] Connected! IP: %s\n", WiFi.localIP().toString().c_str());

  // Setup I2S microphone
  setupMicrophone();

  // Setup I2S speaker
  setupSpeaker();

  // Authenticate with worzel server
  if (authenticate()) {
    Serial.println("[worzel] Authenticated successfully");
    connectWebSocket();
  } else {
    Serial.println("[worzel] Authentication failed!");
  }
}

// ======== Main Loop ========
void loop() {
  ws.loop();

  // Push-to-talk button
  bool buttonPressed = (digitalRead(BUTTON_PIN) == LOW);

  if (buttonPressed && !recording && connected) {
    startRecording();
  } else if (!buttonPressed && recording) {
    stopRecording();
  }

  // Read and send audio while recording
  if (recording) {
    readAndSendAudio();
  }
}

// ======== Authentication ========
bool authenticate() {
  HTTPClient http;
  String url = String("http://") + WORZEL_SERVER + ":" + WORZEL_PORT + "/api/ota";

  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  // Build JSON body
  JsonDocument doc;
  doc["device_id"] = DEVICE_ID;
  doc["board"] = "esp32-s3";
  doc["app_version"] = "0.1.0";

  String body;
  serializeJson(doc, body);

  int httpCode = http.POST(body);

  if (httpCode == 200) {
    String response = http.getString();
    JsonDocument respDoc;
    deserializeJson(respDoc, response);

    authToken = respDoc["token"].as<String>();
    wsUrl = respDoc["server_url"].as<String>();

    Serial.printf("[worzel] Got token, WS URL: %s\n", wsUrl.c_str());
    http.end();
    return true;
  }

  Serial.printf("[worzel] OTA failed: HTTP %d\n", httpCode);
  http.end();
  return false;
}

// ======== WebSocket ========
void connectWebSocket() {
  // Parse WS URL and add token
  // URL format: ws://host:port/ws
  String fullUrl = "/ws?token=" + authToken;

  ws.begin(WORZEL_SERVER, WORZEL_PORT, fullUrl);
  ws.onEvent(wsEvent);
  ws.setReconnectInterval(5000);

  Serial.println("[worzel] Connecting WebSocket...");
}

void wsEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      Serial.println("[worzel] WS Disconnected");
      connected = false;
      break;

    case WStype_CONNECTED:
      Serial.println("[worzel] WS Connected - sending hello");
      connected = true;
      sendHello();
      break;

    case WStype_TEXT:
      handleTextMessage((char*)payload, length);
      break;

    case WStype_BIN:
      // Audio data from server — play through speaker
      playAudio(payload, length);
      break;

    case WStype_PING:
      // Library handles pong automatically
      break;

    default:
      break;
  }
}

void sendHello() {
  JsonDocument doc;
  doc["type"] = "hello";
  doc["version"] = 1;
  doc["transport"] = "websocket";

  JsonObject audio = doc["audio_params"].to<JsonObject>();
  audio["format"] = "opus";
  audio["sample_rate"] = SAMPLE_RATE;
  audio["channels"] = CHANNELS;
  audio["frame_duration"] = FRAME_DURATION;

  JsonArray features = doc["features"].to<JsonArray>();
  features.add("tts");
  features.add("stt");

  String msg;
  serializeJson(doc, msg);
  ws.sendTXT(msg);
}

void handleTextMessage(char* payload, size_t length) {
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, payload, length);

  if (error) {
    Serial.printf("[worzel] JSON parse error: %s\n", error.c_str());
    return;
  }

  const char* type = doc["type"];

  if (strcmp(type, "hello") == 0) {
    const char* sessionId = doc["session_id"];
    Serial.printf("[worzel] Server hello, session: %s\n", sessionId);

  } else if (strcmp(type, "stt") == 0) {
    const char* text = doc["text"];
    Serial.printf("[worzel] STT: %s\n", text);

  } else if (strcmp(type, "tts") == 0) {
    const char* state = doc["state"];
    const char* text = doc["text"] | "";
    Serial.printf("[worzel] TTS %s: %s\n", state, text);

  } else if (strcmp(type, "pong") == 0) {
    // Keepalive response
  } else if (strcmp(type, "error") == 0) {
    const char* message = doc["message"];
    Serial.printf("[worzel] Error: %s\n", message);
  }
}

// ======== Audio Recording ========
void startRecording() {
  recording = true;
  Serial.println("[worzel] Recording started");

  // Send listen start
  JsonDocument doc;
  doc["type"] = "listen";
  doc["state"] = "start";
  doc["mode"] = "manual";
  String msg;
  serializeJson(doc, msg);
  ws.sendTXT(msg);
}

void stopRecording() {
  recording = false;
  Serial.println("[worzel] Recording stopped");

  // Send listen stop
  JsonDocument doc;
  doc["type"] = "listen";
  doc["state"] = "stop";
  String msg;
  serializeJson(doc, msg);
  ws.sendTXT(msg);
}

void readAndSendAudio() {
  size_t bytesRead = 0;
  i2s_read(I2S_MIC_PORT, audioBuffer, sizeof(audioBuffer), &bytesRead, portMAX_DELAY);

  if (bytesRead > 0) {
    // Send raw PCM as binary WebSocket frame
    // In production, encode to Opus first
    ws.sendBIN((uint8_t*)audioBuffer, bytesRead);
  }
}

void playAudio(uint8_t* data, size_t length) {
  size_t bytesWritten = 0;
  i2s_write(I2S_SPK_PORT, data, length, &bytesWritten, portMAX_DELAY);
}

// ======== I2S Setup ========
void setupMicrophone() {
  i2s_config_t config = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate = SAMPLE_RATE,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 4,
    .dma_buf_len = FRAME_SAMPLES,
    .use_apll = false,
    .tx_desc_auto_clear = false,
    .fixed_mclk = 0
  };

  i2s_pin_config_t pins = {
    .bck_io_num = I2S_MIC_SCK,
    .ws_io_num = I2S_MIC_WS,
    .data_out_num = I2S_PIN_NO_CHANGE,
    .data_in_num = I2S_MIC_SD
  };

  i2s_driver_install(I2S_MIC_PORT, &config, 0, NULL);
  i2s_set_pin(I2S_MIC_PORT, &pins);
  i2s_zero_dma_buffer(I2S_MIC_PORT);
}

void setupSpeaker() {
  i2s_config_t config = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX),
    .sample_rate = SAMPLE_RATE,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 4,
    .dma_buf_len = FRAME_SAMPLES,
    .use_apll = false,
    .tx_desc_auto_clear = true,
    .fixed_mclk = 0
  };

  i2s_pin_config_t pins = {
    .bck_io_num = I2S_SPK_SCK,
    .ws_io_num = I2S_SPK_WS,
    .data_out_num = I2S_SPK_SD,
    .data_in_num = I2S_PIN_NO_CHANGE
  };

  i2s_driver_install(I2S_SPK_PORT, &config, 0, NULL);
  i2s_set_pin(I2S_SPK_PORT, &pins);
  i2s_zero_dma_buffer(I2S_SPK_PORT);
}
