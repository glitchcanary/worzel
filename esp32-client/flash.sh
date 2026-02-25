#!/usr/bin/env bash
# Flash Worzel firmware to ESP32 and open serial monitor (WSL2/Linux version)
#
# Usage: ./flash.sh [--clean] [--env esp32s3-amoled] [--log [path]]
#
# Prerequisites (one-time setup):
#   pip install platformio
#   sudo usermod -aG dialout $USER  (then re-login)
#   Windows side: winget install usbipd
#   WSL2 side: sudo apt install linux-tools-generic hwdata
#
# USB passthrough (each time device is plugged in, from admin PowerShell):
#   usbipd list
#   usbipd bind --busid <BUSID>       # first time only
#   usbipd attach --wsl --busid <BUSID>
#
# The ESP32-S3 appears as /dev/ttyACM0 in WSL2 after attach.

set -euo pipefail
cd "$(dirname "$0")"

# Defaults
ENV="esp32s3-amoled"
CLEAN=0
LOG=""
LOG_SET=0

# Parse args
while [[ $# -gt 0 ]]; do
    case "$1" in
        --clean|-c)
            CLEAN=1; shift ;;
        --env|-e)
            ENV="$2"; shift 2 ;;
        --log|-l)
            LOG_SET=1
            if [[ $# -gt 1 && ! "$2" =~ ^- ]]; then
                LOG="$2"; shift 2
            else
                LOG="./esp32-log.txt"; shift
            fi
            ;;
        *)
            echo "Unknown option: $1" >&2
            echo "Usage: ./flash.sh [--clean] [--env name] [--log [path]]" >&2
            exit 1 ;;
    esac
done

# Check pio is available
if ! command -v pio &>/dev/null; then
    echo "ERROR: PlatformIO not found. Install with: pip install platformio" >&2
    exit 1
fi

# Check USB device is available
if ! ls /dev/ttyACM* /dev/ttyUSB* &>/dev/null; then
    echo "WARNING: No serial device found (/dev/ttyACM* or /dev/ttyUSB*)." >&2
    echo "  Have you attached the ESP32 via usbipd?" >&2
    echo "  From admin PowerShell: usbipd attach --wsl --busid <BUSID>" >&2
    echo ""
    read -rp "Continue with build only (no flash)? [y/N] " ans
    if [[ "$ans" != "y" && "$ans" != "Y" ]]; then
        exit 1
    fi
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
      "${localConfig[CONFIG_WORZEL_WIFI_SSID]:-}" != '"myssid"' ]]; then
    has_wifi=1
fi

# Check server
has_server=0
if [[ -n "${localConfig[CONFIG_WORZEL_SERVER_HOST]:-}" ]]; then
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

# Log setup
log_cmd=""
if [[ $LOG_SET -eq 1 ]]; then
    LOG="$(realpath "$LOG")"
    echo -e "\033[33mLogging to: $LOG\033[0m"
    log_cmd="tee $LOG"
fi

# Build and flash
echo -e "\033[36mBuilding and flashing $ENV...\033[0m"
if [[ -n "$log_cmd" ]]; then
    pio run -e "$ENV" -t upload 2>&1 | $log_cmd
else
    pio run -e "$ENV" -t upload
fi

if [[ $? -eq 0 ]]; then
    echo -e "\033[32mFlashed OK. Starting monitor...\033[0m"
    if [[ -n "$log_cmd" ]]; then
        pio device monitor -e "$ENV" 2>&1 | tee -a "$LOG"
    else
        pio device monitor -e "$ENV"
    fi
else
    echo -e "\033[31mBuild/flash failed.\033[0m"
    exit 1
fi
