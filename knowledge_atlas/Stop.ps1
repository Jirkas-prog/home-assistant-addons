$ErrorActionPreference = 'Stop'
$pidPath = Join-Path $PSScriptRoot '.server.pid'
if (-not (Test-Path -LiteralPath $pidPath)) { return }
$appPid = [int](Get-Content -LiteralPath $pidPath)
$appProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $appPid"
$expectedScript = Join-Path $PSScriptRoot 'server\bootstrap.js'
if ($appProcess) {
    if ($appProcess.Name -ne 'node.exe' -or -not $appProcess.CommandLine.Contains($expectedScript)) { throw 'The process does not belong to this version.' }
    Stop-Process -Id $appPid
}
Remove-Item -LiteralPath $pidPath
