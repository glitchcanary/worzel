#!/usr/bin/env bash
# Flash Worzel firmware to ESP32 from WSL2
#
# Build happens in WSL2 (fast, native Linux filesystem).
# Flash + monitor happen via Windows esptool/serial (no usbipd needed).
# WSL2 can call Windows .exe directly — the USB device stays on the Windows side.
#
# Usage: ./flash.sh [--clean] [--env esp32s3-amoled] [--no-log] [--build-only]
#
# Prerequisites:
#   WSL2:    pip install platformio   (or pipx install platformio)
#   Windows: pip install esptool      (already installed if you have PlatformIO on Windows)
#
# No usbipd, no USB passthrough, no dialout group needed.

set -euo pipefail
cd "$(dirname "$0")"

# Log directory (outside git repo, shared with server logs)
LOGDIR="$(cd "$(dirname "$0")/../.." && pwd)/logs"

# Defaults
ENV="esp32s3-amoled"
CLEAN=0
NO_LOG=0
BUILD_ONLY=0
WIN_PORT=""

# Flash offsets per board (from partition tables + ESP-IDF defaults for ESP32-S3)
# bootloader @ 0x0, partitions @ 0x8000, app @ 0x10000
BOOTLOADER_OFFSET="0x0"
PARTITION_OFFSET="0x8000"
APP_OFFSET="0x10000"

# Parse args
while [[ $# -gt 0 ]]; do
    case "$1" in
        --clean|-c)
            CLEAN=1; shift ;;
        --env|-e)
            ENV="$2"; shift 2 ;;
        --no-log)
            NO_LOG=1; shift ;;
        --build-only|-b)
            BUILD_ONLY=1; shift ;;
        --port|-p)
            WIN_PORT="$2"; shift 2 ;;
        *)
            echo "Unknown option: $1" >&2
            echo "Usage: ./flash.sh [--clean] [--env name] [--no-log] [--build-only] [--port COMx]" >&2
            exit 1 ;;
    esac
done

# Check pio is available (WSL2 side, for building)
if ! command -v pio &>/dev/null; then
    echo "ERROR: PlatformIO not found. Install with: pipx install platformio" >&2
    exit 1
fi

# Detect Windows esptool (needed for flash, not for build-only)
WIN_ESPTOOL=""
if [[ $BUILD_ONLY -eq 0 ]]; then
    # Try standalone esptool first, then PlatformIO's bundled one
    for candidate in \
        "esptool.exe" \
        "/mnt/c/Users/$(cmd.exe /c "echo %USERNAME%" 2>/dev/null | tr -d '\r')/anaconda3/Scripts/esptool.exe" \
        "/mnt/c/Users/$(cmd.exe /c "echo %USERNAME%" 2>/dev/null | tr -d '\r')/.platformio/packages/tool-esptoolpy/esptool.py"; do
        if [[ -x "$(command -v "$candidate" 2>/dev/null || echo "$candidate")" ]] || [[ -f "$candidate" ]]; then
            WIN_ESPTOOL="$candidate"
            break
        fi
    done

    if [[ -z "$WIN_ESPTOOL" ]]; then
        echo -e "\033[31mERROR: Windows esptool not found.\033[0m" >&2
        echo "  Install with: pip install esptool (from Windows/PowerShell)" >&2
        echo "  Or use --build-only to just compile without flashing." >&2
        exit 1
    fi
    echo -e "\033[90mUsing esptool: $WIN_ESPTOOL\033[0m"
fi

# Clean
if [[ $CLEAN -eq 1 ]]; then
    echo -e "\033[33mCleaning build cache...\033[0m"
    rm -rf .pio
    rm -f sdkconfig.esp32s3-amoled* sdkconfig.esp32c3-xmini* sdkconfig.esp32c6-lcd*
fi

# Read existing sdkconfig.local
declare -A localConfig
if [[ -f sdkconfig.local ]]; then
    while IFS='=' read -r key value; do
        if [[ "$key" =~ ^CONFIG_ ]]; then
            localConfig["$key"]="$value"
        fi
    done < sdkconfig.local
fi

# Check WiFi
has_wifi=0
if [[ -n "${localConfig[CONFIG_WORZEL_WIFI_SSID]:-}" && \
      "${localConfig[CONFIG_WORZEL_WIFI_SSID]:-}" != '"myssid"' && \
      "${localConfig[CONFIG_WORZEL_WIFI_SSID]:-}" != '"placeholder"' ]]; then
    has_wifi=1
fi

# Check server
has_server=0
if [[ -n "${localConfig[CONFIG_WORZEL_SERVER_HOST]:-}" && \
      "${localConfig[CONFIG_WORZEL_SERVER_HOST]:-}" != '"myserver.example.com"' ]]; then
    has_server=1
fi

if [[ $has_wifi -eq 0 ]]; then
    echo -e "\033[33mWiFi not configured. Enter credentials:\033[0m"
    read -rp "  WiFi SSID: " ssid
    read -rp "  WiFi Password: " pass
    if [[ -z "$ssid" ]]; then
        echo -e "\033[31mSSID is required.\033[0m" >&2
        exit 1
    fi
    localConfig[CONFIG_WORZEL_WIFI_SSID]="\"$ssid\""
    localConfig[CONFIG_WORZEL_WIFI_PASS]="\"$pass\""
fi

if [[ $has_server -eq 0 ]]; then
    echo ""
    echo -e "\033[33mServer not configured.\033[0m"
    echo -e "\033[90m  Example: yourhost.ts.net:443 (Tailscale Funnel) or 192.168.1.100:3000\033[0m"
    read -rp "  Server URL [host:port]: " server_input
    if [[ -z "$server_input" ]]; then
        echo -e "\033[31mServer URL is required.\033[0m" >&2
        exit 1
    fi
    if [[ "$server_input" =~ ^(.+):([0-9]+)$ ]]; then
        localConfig[CONFIG_WORZEL_SERVER_HOST]="\"${BASH_REMATCH[1]}\""
        localConfig[CONFIG_WORZEL_SERVER_PORT]="\"${BASH_REMATCH[2]}\""
    else
        localConfig[CONFIG_WORZEL_SERVER_HOST]="\"$server_input\""
        localConfig[CONFIG_WORZEL_SERVER_PORT]="\"443\""
    fi
    read -rp "  Use TLS? (Y/n): " tls
    if [[ "$tls" == "n" || "$tls" == "N" ]]; then
        localConfig[CONFIG_WORZEL_USE_TLS]="n"
    else
        localConfig[CONFIG_WORZEL_USE_TLS]="y"
    fi
fi

# Write sdkconfig.local
{
    echo "# Local config (gitignored, never committed)"
    for key in $(echo "${!localConfig[@]}" | tr ' ' '\n' | sort); do
        echo "$key=${localConfig[$key]}"
    done
} > sdkconfig.local

echo -e "\033[32mConfig saved to sdkconfig.local\033[0m"

# Show config
host_="${localConfig[CONFIG_WORZEL_SERVER_HOST]//\"/}"
port_="${localConfig[CONFIG_WORZEL_SERVER_PORT]//\"/}"
tls_="http"
[[ "${localConfig[CONFIG_WORZEL_USE_TLS]:-y}" == "y" ]] && tls_="https"
echo -e "\033[36m  WiFi: ${localConfig[CONFIG_WORZEL_WIFI_SSID]}\033[0m"
echo -e "\033[36m  Server: ${tls_}://${host_}:${port_}\033[0m"

# Log setup (default: on, to shared logs directory)
LOG=""
log_cmd=""
if [[ $NO_LOG -eq 0 ]]; then
    mkdir -p "$LOGDIR"
    LOG="$LOGDIR/flash-$(date +%Y%m%d-%H%M%S).log"
    echo -e "\033[33mLogging to: $LOG\033[0m"
    log_cmd="tee $LOG"
fi

# ── Build (WSL2 PlatformIO) ──────────────────────────────────────────────────
echo ""
echo -e "\033[36mBuilding $ENV (WSL2)...\033[0m"
if [[ -n "$log_cmd" ]]; then
    pio run -e "$ENV" 2>&1 | $log_cmd
else
    pio run -e "$ENV"
fi

BUILD_DIR=".pio/build/$ENV"
if [[ ! -f "$BUILD_DIR/firmware.bin" ]]; then
    echo -e "\033[31mBuild failed — no firmware.bin found.\033[0m" >&2
    exit 1
fi

echo -e "\033[32mBuild OK.\033[0m"
echo -e "\033[90m  $(ls -lh "$BUILD_DIR/firmware.bin" | awk '{print $5}') firmware.bin\033[0m"

if [[ $BUILD_ONLY -eq 1 ]]; then
    echo -e "\033[32mDone (build only).\033[0m"
    exit 0
fi

# ── Flash (Windows esptool via WSL2→exe bridge) ──────────────────────────────
echo ""

# Auto-detect COM port on Windows if not specified
if [[ -z "$WIN_PORT" ]]; then
    echo -e "\033[90mDetecting COM port...\033[0m"
    # Ask PowerShell to list serial ports
    detected=$(powershell.exe -Command "[System.IO.Ports.SerialPort]::GetPortNames()" 2>/dev/null | tr -d '\r' | head -1)
    if [[ -n "$detected" ]]; then
        WIN_PORT="$detected"
        echo -e "\033[90mFound: $WIN_PORT\033[0m"
    else
        echo -e "\033[33mNo COM port detected. Is the ESP32 plugged in?\033[0m"
        read -rp "  Enter COM port (e.g. COM3): " WIN_PORT
        if [[ -z "$WIN_PORT" ]]; then
            echo -e "\033[31mCOM port required for flashing.\033[0m" >&2
            exit 1
        fi
    fi
fi

# Convert WSL paths to Windows paths for esptool
win_path() {
    wslpath -w "$1"
}

BOOTLOADER_WIN=$(win_path "$BUILD_DIR/bootloader.bin")
PARTITIONS_WIN=$(win_path "$BUILD_DIR/partitions.bin")
FIRMWARE_WIN=$(win_path "$BUILD_DIR/firmware.bin")

# Determine chip type from env name
case "$ENV" in
    *s3*) CHIP="esp32s3" ;;
    *c3*) CHIP="esp32c3" ;;
    *c6*) CHIP="esp32c6" ;;
    *)    CHIP="esp32s3" ;;
esac

echo -e "\033[36mFlashing $CHIP on $WIN_PORT...\033[0m"

FLASH_CMD="$WIN_ESPTOOL --chip $CHIP --port $WIN_PORT --baud 460800 write-flash \
    $BOOTLOADER_OFFSET $BOOTLOADER_WIN \
    $PARTITION_OFFSET $PARTITIONS_WIN \
    $APP_OFFSET $FIRMWARE_WIN"

if [[ -n "$log_cmd" ]]; then
    $FLASH_CMD 2>&1 | $log_cmd
else
    $FLASH_CMD
fi

if [[ $? -ne 0 ]]; then
    echo -e "\033[31mFlash failed.\033[0m" >&2
    exit 1
fi

echo -e "\033[32mFlashed OK.\033[0m"

# ── Serial monitor (Windows mode.com or PlatformIO) ──────────────────────────
echo ""
echo -e "\033[36mStarting serial monitor on $WIN_PORT (115200 baud)...\033[0m"
echo -e "\033[90mPress Ctrl+C to exit.\033[0m"

# Use PlatformIO monitor if available on Windows, otherwise python serial
if command -v /mnt/c/Users/*/anaconda3/Scripts/pyserial-miniterm.exe &>/dev/null 2>&1; then
    MINITERM=$(ls /mnt/c/Users/*/anaconda3/Scripts/pyserial-miniterm.exe 2>/dev/null | head -1)
    if [[ -n "$log_cmd" ]]; then
        "$MINITERM" "$WIN_PORT" 115200 2>&1 | tee -a "$LOG"
    else
        "$MINITERM" "$WIN_PORT" 115200
    fi
else
    # Fallback: use PowerShell to read serial
    echo -e "\033[90mUsing PowerShell serial reader (install pyserial for better experience)\033[0m"
    powershell.exe -Command "
        \$port = New-Object System.IO.Ports.SerialPort('$WIN_PORT', 115200)
        \$port.Open()
        try { while (\$true) { Write-Host \$port.ReadLine() } }
        finally { \$port.Close() }
    " 2>&1 | if [[ -n "$log_cmd" ]]; then tee -a "$LOG"; else cat; fi
fi
