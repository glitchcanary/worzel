# Worzel ESP32 Client

ESP-IDF firmware for ESP32 boards with ES8311 audio codec. Connects to a Worzel server via HTTPS/WSS, sends Opus-encoded mic audio, receives and plays Opus-encoded TTS responses.

## Supported Boards

| Board | MCU | Status |
|-------|-----|--------|
| Waveshare ESP32-S3 1.8" AMOLED | ESP32-S3 (dual-core, PSRAM) | Primary target |
| xmini-c3-v3 | ESP32-C3 (RISC-V) | Pin config done |
| Waveshare ESP32-C6 1.69" LCD | ESP32-C6 (WiFi 6) | Pin config done |

All boards use the ES8311 I2C audio codec with NS4150 amplifier.

## Prerequisites

- [PlatformIO](https://platformio.org/install) (VS Code extension or CLI)
- A Worzel server running somewhere (local or via Tailscale Funnel)

## Build and Flash

```powershell
# Windows (PowerShell)
.\flash.ps1 -Clean        # First time: prompts for WiFi, clean build, flash, monitor
.\flash.ps1               # Subsequent: incremental build + flash + monitor
```

```bash
# Linux/macOS
pio run -e esp32s3-amoled -t upload
pio device monitor -e esp32s3-amoled
```

### WiFi Credentials

`flash.ps1` prompts for WiFi SSID and password on first run and saves them to `sdkconfig.local` (gitignored). To re-enter credentials, delete `sdkconfig.local` or run `.\flash.ps1 -Clean`.

For manual setup, create `sdkconfig.local`:
```
CONFIG_WORZEL_WIFI_SSID="YourNetwork"
CONFIG_WORZEL_WIFI_PASS="YourPassword"
```

WiFi must be 2.4GHz (ESP32 does not support 5GHz).

### Server Configuration

Default config in `sdkconfig.defaults` points at the Tailscale Funnel URL with TLS. For a local server, override in `sdkconfig.local`:
```
CONFIG_WORZEL_SERVER_HOST="192.168.1.100"
CONFIG_WORZEL_SERVER_PORT="3000"
CONFIG_WORZEL_USE_TLS=n
```

All config options can also be set interactively via `pio run -e esp32s3-amoled -t menuconfig`.

## Board Selection

```bash
pio run -e esp32s3-amoled -t upload    # Waveshare ESP32-S3 1.8" AMOLED
pio run -e esp32c3-xmini -t upload     # xmini-c3-v3
pio run -e esp32c6-lcd -t upload       # Waveshare ESP32-C6 1.69" LCD
```

## How It Works

1. **Boot** -- ES8311 codec init (I2C), I2S audio bus, Opus encoder/decoder, LVGL display
2. **WiFi** -- connects to configured 2.4GHz network
3. **Auth** -- HTTP(S) POST to `/api/ota` on Worzel server, receives token + WebSocket URL
4. **WebSocket** -- connects with token, sends `hello` with audio params (Opus 16kHz mono)
5. **Push-to-talk** -- hold button to record, release to stop. Mic audio is Opus-encoded and streamed.
6. **Playback** -- server responds with Opus-encoded TTS audio, decoded and played through speaker
7. **Display** -- status icons update on connect, conversation text scrolls as STT/TTS messages arrive

## Project Structure

```
esp32-client/
  platformio.ini          # Build config, board environments
  sdkconfig.defaults      # ESP-IDF defaults (committed, placeholder WiFi)
  sdkconfig.local         # Your WiFi credentials (gitignored)
  partitions_16mb.csv     # Partition table for S3 AMOLED (16MB flash)
  flash.ps1               # Windows build+flash helper
  flash.sh                # Linux/WSL2 build+flash helper
  src/
    main.c                # Application entry + WiFi/Auth/WS/Audio
    display.c             # LVGL 9.x display (manual init, no esp_lvgl_port)
    display.h             # Display abstraction API
    display_bitmap.c      # Fallback bitmap display (8x8 font, no LVGL)
    font8x8.c             # 8x8 bitmap font data
    board.h               # Per-board pin definitions
    CMakeLists.txt         # ESP-IDF component config + build workarounds
    Kconfig.projbuild     # Menuconfig options
    idf_component.yml     # ESP-IDF managed component dependencies
```

## Display

The S3 AMOLED uses LVGL 9.x with manual initialization (no `esp_lvgl_port`). The `esp_lvgl_port` abstraction was removed because it silently applies themes and registers conflicting SPI ISR callbacks that cause rendering corruption on QSPI displays.

Display layout: status bar (WiFi/Auth/WS icons, clock) | scrollable conversation area | action bar (Talk/Toggle/More buttons). Touch input via FT3168 (FT5x06-compatible).

Boards without LVGL fall back to `display_bitmap.c` (direct framebuffer + 8x8 bitmap font).

## Known Issues

- **GCC 14 ICE in esp_lcd** -- the RGB LCD panel driver crashes the compiler on ESP32-S3. Worked around with per-file `-O0` in CMakeLists.txt. The QSPI/SPI LCD drivers (used by our boards) are unaffected.
- **Touch read callback not yet wired** -- touch hardware is initialized but the LVGL input device read callback is a placeholder.

## More Info

See [`CLAUDE.md`](../../CLAUDE.md) in the project root for Opus codec pipeline details, ES8311 driver notes, board pin mappings, and security considerations.
