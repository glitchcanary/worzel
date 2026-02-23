# Flash Worzel firmware to ESP32 and open serial monitor
# Usage: .\flash.ps1 [-Clean] [-Env esp32s3-amoled]
#
# WiFi credentials are prompted if not configured and saved to sdkconfig.local (gitignored).
param(
    [switch]$Clean,
    [string]$Env = "esp32s3-amoled"
)

if ($Clean) {
    Write-Host "Cleaning build cache..." -ForegroundColor Yellow
    Remove-Item .pio -Recurse -Force -ErrorAction SilentlyContinue
}

# Check if real WiFi credentials are configured (in sdkconfig.local or sdkconfig.defaults)
$needCreds = $true
foreach ($f in @("sdkconfig.local", "sdkconfig.defaults")) {
    if (Test-Path $f) {
        $content = Get-Content $f -Raw
        if ($content -match 'CONFIG_WORZEL_WIFI_SSID="(?!myssid")[^"]+' -and
            $content -match 'CONFIG_WORZEL_WIFI_PASS="(?!mypassword")[^"]+') {
            $needCreds = $false
            break
        }
    }
}

if ($needCreds) {
    Write-Host "WiFi not configured (still using placeholders). Enter credentials:" -ForegroundColor Yellow
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
