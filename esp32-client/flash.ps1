# Flash Worzel firmware to ESP32 and open serial monitor
# Usage: .\flash.ps1 [-Clean] [-Env esp32s3-amoled]
#
# WiFi and server settings are prompted if not configured, saved to sdkconfig.local (gitignored).
param(
    [switch]$Clean,
    [string]$Env = "esp32s3-amoled"
)

if ($Clean) {
    Write-Host "Cleaning build cache..." -ForegroundColor Yellow
    Remove-Item .pio -Recurse -Force -ErrorAction SilentlyContinue
}

# Read existing sdkconfig.local if present
$localConfig = @{}
if (Test-Path sdkconfig.local) {
    Get-Content sdkconfig.local | ForEach-Object {
        if ($_ -match '^(CONFIG_\w+)=(.*)$') {
            $localConfig[$Matches[1]] = $Matches[2]
        }
    }
}

# Check WiFi credentials
$hasWifi = $localConfig.ContainsKey("CONFIG_WORZEL_WIFI_SSID") -and
           $localConfig["CONFIG_WORZEL_WIFI_SSID"] -ne '"myssid"'

# Check server URL
$hasServer = $localConfig.ContainsKey("CONFIG_WORZEL_SERVER_HOST") -and
             $localConfig["CONFIG_WORZEL_SERVER_HOST"] -ne '"raz17.tailaf2e8d.ts.net"'

# Also accept the Tailscale default as valid — only prompt if no server config at all
$hasServer = $localConfig.ContainsKey("CONFIG_WORZEL_SERVER_HOST")

if (-not $hasWifi) {
    Write-Host "WiFi not configured. Enter credentials:" -ForegroundColor Yellow
    $ssid = Read-Host "  WiFi SSID"
    $pass = Read-Host "  WiFi Password"
    if (-not $ssid) {
        Write-Host "SSID is required." -ForegroundColor Red
        exit 1
    }
    $localConfig["CONFIG_WORZEL_WIFI_SSID"] = "`"$ssid`""
    $localConfig["CONFIG_WORZEL_WIFI_PASS"] = "`"$pass`""
}

if (-not $hasServer) {
    Write-Host ""
    Write-Host "Server not configured. The default is Tailscale Funnel (public HTTPS)." -ForegroundColor Yellow
    Write-Host "  Default: raz17.tailaf2e8d.ts.net:443 (TLS)" -ForegroundColor Gray
    $serverInput = Read-Host "  Server URL [host:port] (Enter for default)"
    if ($serverInput) {
        # Parse host:port
        if ($serverInput -match '^(.+):(\d+)$') {
            $localConfig["CONFIG_WORZEL_SERVER_HOST"] = "`"$($Matches[1])`""
            $localConfig["CONFIG_WORZEL_SERVER_PORT"] = "`"$($Matches[2])`""
        } else {
            $localConfig["CONFIG_WORZEL_SERVER_HOST"] = "`"$serverInput`""
            $localConfig["CONFIG_WORZEL_SERVER_PORT"] = "`"443`""
        }
        # Ask about TLS
        $tls = Read-Host "  Use TLS? (Y/n)"
        if ($tls -eq "n" -or $tls -eq "N") {
            $localConfig["CONFIG_WORZEL_USE_TLS"] = "n"
        } else {
            $localConfig["CONFIG_WORZEL_USE_TLS"] = "y"
        }
    } else {
        # Use defaults from sdkconfig.defaults (Tailscale Funnel)
        $localConfig["CONFIG_WORZEL_SERVER_HOST"] = "`"raz17.tailaf2e8d.ts.net`""
        $localConfig["CONFIG_WORZEL_SERVER_PORT"] = "`"443`""
        $localConfig["CONFIG_WORZEL_USE_TLS"] = "y"
    }
}

# Write sdkconfig.local
$lines = @("# Local config (gitignored, never committed)")
foreach ($key in $localConfig.Keys | Sort-Object) {
    $lines += "$key=$($localConfig[$key])"
}
$lines | Set-Content sdkconfig.local -Encoding UTF8
Write-Host "Config saved to sdkconfig.local" -ForegroundColor Green

# Show what we're connecting to
$host_ = $localConfig["CONFIG_WORZEL_SERVER_HOST"] -replace '"', ''
$port_ = $localConfig["CONFIG_WORZEL_SERVER_PORT"] -replace '"', ''
$tls_ = if ($localConfig["CONFIG_WORZEL_USE_TLS"] -eq "y") { "https" } else { "http" }
Write-Host "  WiFi: $($localConfig["CONFIG_WORZEL_WIFI_SSID"])" -ForegroundColor Cyan
Write-Host "  Server: ${tls_}://${host_}:${port_}" -ForegroundColor Cyan

Write-Host "Building and flashing $Env..." -ForegroundColor Cyan
pio run -e $Env -t upload
if ($LASTEXITCODE -eq 0) {
    Write-Host "Flashed OK. Starting monitor..." -ForegroundColor Green
    pio device monitor -e $Env
} else {
    Write-Host "Build/flash failed." -ForegroundColor Red
}
