# Run once with administrator rights after installing Eclipse Mosquitto.
param([string]$LanAddress = '192.168.1.101')

$ErrorActionPreference = 'Stop'
$configPath = 'C:\Program Files\mosquitto\mosquitto.conf'
$workDir = 'C:\ProgramData\AferiyMonitor'
$resultPath = Join-Path $workDir 'broker-setup-result.txt'

New-Item -ItemType Directory -Force -Path $workDir | Out-Null
try {
    if (-not (Test-Path -LiteralPath $configPath)) { throw "Mosquitto configuration was not found" }
    $backup = Join-Path $workDir 'mosquitto.conf.original'
    if (-not (Test-Path -LiteralPath $backup)) { Copy-Item -LiteralPath $configPath -Destination $backup }

    Get-CimInstance Win32_Process -Filter "name='mosquitto.exe'" |
        Where-Object { $_.CommandLine -like '*AferiyMonitor*mosquitto.conf*' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

    Stop-Service -Name mosquitto -ErrorAction Stop
    @(
        'listener 1883 127.0.0.1',
        "listener 1883 $LanAddress",
        'allow_anonymous true'
    ) | Set-Content -LiteralPath $configPath -Encoding ascii
    Start-Service -Name mosquitto -ErrorAction Stop

    $rule = Get-NetFirewallRule -Name 'AferiyP210MqttPrivate' -ErrorAction SilentlyContinue
    if (-not $rule) {
        New-NetFirewallRule -Name 'AferiyP210MqttPrivate' -DisplayName 'AFERIY P210 local MQTT' `
            -Direction Inbound -Action Allow -Enabled True -Profile Private -Protocol TCP `
            -LocalPort 1883 -LocalAddress $LanAddress -RemoteAddress LocalSubnet `
            -Program 'C:\Program Files\mosquitto\mosquitto.exe' | Out-Null
    }
    "SUCCESS: Mosquitto service listening on localhost and $LanAddress port 1883; firewall limited to Private/LocalSubnet." |
        Set-Content -LiteralPath $resultPath
} catch {
    try {
        if (Test-Path -LiteralPath $backup) {
            Copy-Item -LiteralPath $backup -Destination $configPath -Force
            Start-Service -Name mosquitto -ErrorAction SilentlyContinue
        }
    } catch { }
    ('FAILED: ' + $_.Exception.Message) | Set-Content -LiteralPath $resultPath
    throw
}
