param([int]$Port = 8099, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$appRoot = $PSScriptRoot
$appScript = Join-Path $appRoot 'server\bootstrap.js'
$appData = Join-Path $appRoot 'data'
$appUrl = "http://127.0.0.1:$Port"
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Choose a port from 1024 to 65535.' }
Set-Location -LiteralPath $appRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 22.13 or newer.' }
if (-not (Test-Path -LiteralPath (Join-Path $appRoot 'node_modules'))) {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
if (-not (Test-Path -LiteralPath (Join-Path $appRoot 'dist\index.html'))) {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Application build failed.' }
}
$appRunning = $false
try {
    $snapshot = Invoke-RestMethod -Uri "$appUrl/api/nodes" -TimeoutSec 2
    if ([IO.Path]::GetFullPath($snapshot.environment.dataDirectory) -ne [IO.Path]::GetFullPath($appData)) { throw 'This port belongs to another library. Stop that version or choose another port.' }
    $appRunning = $true
} catch {
    if ($_.Exception.Message -like 'This port belongs*') { throw }
}
if (-not $appRunning) {
    $env:HOST = '127.0.0.1'
    $env:PORT = [string]$Port
    $env:DATA_DIR = $appData
    $env:DOCUMENT_ROOT = Join-Path $appData 'documents'
    $env:HA_INGRESS = '0'
    $appProcess = Start-Process -FilePath (Get-Command node).Source -ArgumentList ('"{0}"' -f $appScript) -WorkingDirectory $appRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $appRoot 'server.log') -RedirectStandardError (Join-Path $appRoot 'server-error.log') -PassThru
    $appProcess.Id | Set-Content -LiteralPath (Join-Path $appRoot '.server.pid')
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 200
        try {
            $snapshot = Invoke-RestMethod -Uri "$appUrl/api/nodes" -TimeoutSec 1
            if ([IO.Path]::GetFullPath($snapshot.environment.dataDirectory) -eq [IO.Path]::GetFullPath($appData)) { $appRunning = $true; break }
        } catch {}
        if ($appProcess.HasExited) { break }
    }
}
if (-not $appRunning) { throw 'The application did not start. Check server-error.log and the selected port.' }
Write-Output "$($snapshot.environment.version) ready at $appUrl"
if (-not $NoBrowser) { Start-Process $appUrl }
