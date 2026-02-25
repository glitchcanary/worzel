# Flash Worzel firmware to ESP32 and open serial monitor
# Usage: .\flash.ps1 [-Clean] [-Env esp32s3-amoled] [-Log [path]]
#
# WiFi and server settings are prompted if not configured, saved to sdkconfig.local (gitignored).
# -Log captures build output and serial monitor to a log file (default: .\esp32-log.txt).
param(
    [switch]$Clean,
    [string]$Env = "esp32s3-amoled",
    [string]$Log
)

if ($Clean) {
    Write-Host "Cleaning build cache..." -ForegroundColor Yellow
    Remove-Item .pio -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item sdkconfig.esp32s3-amoled* -Force -ErrorAction SilentlyContinue
    Remove-Item sdkconfig.esp32c3-xmini* -Force -ErrorAction SilentlyContinue
    Remove-Item sdkconfig.esp32c6-lcd* -Force -ErrorAction SilentlyContinue
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
             $localConfig["CONFIG_WORZEL_SERVER_HOST"] -ne '"myserver.example.com"'

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
    Write-Host "Server not configured." -ForegroundColor Yellow
    Write-Host "  Example: yourhost.ts.net:443 (Tailscale Funnel) or 192.168.1.100:3000" -ForegroundColor Gray
    $serverInput = Read-Host "  Server URL [host:port]"
    if (-not $serverInput) {
        Write-Host "Server URL is required." -ForegroundColor Red
        exit 1
    }
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

# Resolve log file path
$logFile = $null
if ($PSBoundParameters.ContainsKey('Log')) {
    $logFile = if ($Log) { $Log } else { ".\esp32-log.txt" }
    $logFile = [System.IO.Path]::GetFullPath($logFile)
    Write-Host "Logging to: $logFile" -ForegroundColor Yellow
}

Write-Host "Building and flashing $Env..." -ForegroundColor Cyan
if ($logFile) {
    pio run -e $Env -t upload 2>&1 | Tee-Object -FilePath $logFile
} else {
    pio run -e $Env -t upload
}
if ($LASTEXITCODE -eq 0) {
    Write-Host "Flashed OK. Starting monitor..." -ForegroundColor Green
    if ($logFile) {
        pio device monitor -e $Env 2>&1 | Tee-Object -Append -FilePath $logFile
    } else {
        pio device monitor -e $Env
    }
} else {
    Write-Host "Build/flash failed." -ForegroundColor Red
}
