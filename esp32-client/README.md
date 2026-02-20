# ESP32 Client for Worzel

Two options for connecting an ESP32 to the worzel server:

## Option A: Clean-Room Client (Recommended)

A minimal, auditable ESP32 client that implements the worzel WebSocket protocol.
No code from the xiaozhi firmware is used.

### Features
- WiFi connection with WPA2
- OTA authentication via HTTP POST
- WebSocket connection with token auth
- Hello handshake and ping keepalive
- Push-to-talk audio recording (I2S INMP441 microphone)
- Audio playback (I2S MAX98357A amplifier)
- Button-triggered recording

### Hardware Requirements
- ESP32-S3 or ESP32-C3 development board
- INMP441 I2S MEMS microphone
- MAX98357A I2S amplifier + speaker
- Push-to-talk button (GPIO)

### Building
Requires ESP-IDF v5.x or Arduino IDE with ESP32 board support.

See `worzel-client.ino` for the Arduino implementation.

## Option B: Redirect Existing Xiaozhi Firmware

If you already have a device running xiaozhi firmware, you can redirect it
to point at your worzel server instead of the original Chinese backend.

### Steps

1. **Flash the xiaozhi firmware** to your ESP32 as normal
2. **During WiFi setup** (captive portal), configure your WiFi credentials
3. **Modify the OTA endpoint** — the firmware's OTA URL is configured via:
   - The captive portal web interface at setup time
   - Or via the `websocket_url` setting in NVS storage

4. **Point it at worzel**: Set the OTA URL to `http://YOUR_WORZEL_IP:3000/api/ota`

### Important Security Note

The xiaozhi firmware was not designed with security in mind. While worzel
provides a hardened server, the firmware itself has known issues:
- No Secure Boot (physical access = full compromise)
- No flash encryption (credentials extractable via UART)
- JTAG debug interfaces remain active
- No OTA firmware signature verification

For production use, the clean-room client (Option A) is strongly recommended.
