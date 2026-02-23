# Flash Worzel firmware to ESP32 and open serial monitor
# Usage: .\flash.ps1 [-Clean] [-Env esp32s3-amoled]
param(
    [switch]$Clean,
    [string]$Env = "esp32s3-amoled"
)

if ($Clean) {
    Write-Host "Cleaning build cache..." -ForegroundColor Yellow
    Remove-Item .pio -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Building and flashing $Env..." -ForegroundColor Cyan
pio run -e $Env -t upload
if ($LASTEXITCODE -eq 0) {
    Write-Host "Flashed OK. Starting monitor..." -ForegroundColor Green
    pio device monitor -e $Env
} else {
    Write-Host "Build/flash failed." -ForegroundColor Red
}
