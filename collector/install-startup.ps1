# Install the tray monitor. Cloudflare collects readings even when this PC is off.
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $MyInvocation.MyCommand.Path
$pythonw = Join-Path $project '.venv\Scripts\pythonw.exe'
if (-not (Test-Path -LiteralPath $pythonw)) { throw 'Python environment missing. Install requirements first.' }
$startup = [Environment]::GetFolderPath('Startup')
$shell = New-Object -ComObject WScript.Shell
$oldCollector = Join-Path $startup 'AFERIY P210 Collector.lnk'
if (Test-Path -LiteralPath $oldCollector) { Remove-Item -LiteralPath $oldCollector }
foreach ($entry in @(@('AFERIY P210 Tray', 'tray.py'))) {
    $link = $shell.CreateShortcut((Join-Path $startup ($entry[0] + '.lnk')))
    $link.TargetPath = $pythonw
    $link.Arguments = '"' + (Join-Path $project $entry[1]) + '"'
    $link.WorkingDirectory = $project
    $link.Description = 'AFERIY P210 battery monitoring'
    $link.Save()
}
Write-Output 'Startup shortcuts installed for the current Windows user.'
