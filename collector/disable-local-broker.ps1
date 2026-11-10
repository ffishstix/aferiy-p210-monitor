# Retire the temporary LAN broker now that cloud collection is the intended path.
$ErrorActionPreference = 'Stop'
$resultPath = 'C:\ProgramData\AferiyMonitor\broker-cleanup-result.txt'
$original = 'C:\ProgramData\AferiyMonitor\mosquitto.conf.original'
$config = 'C:\Program Files\mosquitto\mosquitto.conf'
try {
    if (-not (Test-Path -LiteralPath $original)) { throw 'Original Mosquitto configuration backup is missing' }
    Stop-Service -Name mosquitto -ErrorAction Stop
    Copy-Item -LiteralPath $original -Destination $config -Force
    Set-Service -Name mosquitto -StartupType Manual
    Get-NetFirewallRule -Name 'AferiyP210MqttPrivate' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    'SUCCESS: LAN MQTT listener stopped; original configuration restored; firewall rule removed.' | Set-Content -LiteralPath $resultPath
} catch {
    ('FAILED: ' + $_.Exception.Message) | Set-Content -LiteralPath $resultPath
    throw
}
