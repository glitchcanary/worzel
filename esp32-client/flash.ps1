# Flash Worzel firmware to ESP32 and open serial monitor
# Usage: .\flash.ps1 [-Clean] [-Env esp32s3-amoled]
#
# WiFi credentials are prompted on first run and saved to sdkconfig.local (gitignored).
# Use -Clean to also clear saved credentials and re-prompt.
param(
    [switch]$Clean,
    [string]$Env = "esp32s3-amoled"
)

if ($Clean) {
    Write-Host "Cleaning build cache..." -ForegroundColor Yellow
    Remove-Item .pio -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item sdkconfig.local -Force -ErrorAction SilentlyContinue
}

# Prompt for WiFi credentials if sdkconfig.local doesn't exist
if (-not (Test-Path sdkconfig.local)) {
    Write-Host "No sdkconfig.local found. Enter WiFi credentials:" -ForegroundColor Yellow
    $ssid = Read-Host "  WiFi SSID"
    $pass = Read-Host "  WiFi Password"
    if (-not $ssid) {
        Write-Host "SSID is required." -ForegroundColor Red
        exit 1
    }
    @(
        "# Local WiFi credentials (gitignored, never committed)"
        "CONFIG_WORZEL_WIFI_SSID=`"$ssid`""
        "CONFIG_WORZEL_WIFI_PASS=`"$pass`""
    ) | Set-Content sdkconfig.local -Encoding UTF8
    Write-Host "Saved to sdkconfig.local (gitignored)" -ForegroundColor Green
}

Write-Host "Building and flashing $Env..." -ForegroundColor Cyan
pio run -e $Env -t upload
if ($LASTEXITCODE -eq 0) {
    Write-Host "Flashed OK. Starting monitor..." -ForegroundColor Green
    pio device monitor -e $Env
} else {
    Write-Host "Build/flash failed." -ForegroundColor Red
}
