param(
    [string]$Version
)

$ErrorActionPreference = "Stop"
$projectRoot = $PSScriptRoot
$addonRoot = Join-Path $projectRoot "mybrowser"
$releaseRoot = Join-Path $projectRoot "releases"
$checksumFile = Join-Path $releaseRoot "SHA256SUMS.txt"
$configFile = Join-Path $addonRoot "config.yaml"
$packageFile = Join-Path $addonRoot "package.json"
$dockerfile = Join-Path $addonRoot "Dockerfile"

if (-not (Test-Path -LiteralPath $configFile)) {
    throw "Chybí mybrowser/config.yaml"
}

$configText = Get-Content -LiteralPath $configFile -Raw
$manifestMatch = [regex]::Match($configText, '(?m)^version:\s*["'']?([^"''\s]+)')
if (-not $manifestMatch.Success) { throw "V config.yaml chybí verze." }
$manifestVersion = $manifestMatch.Groups[1].Value
if ([string]::IsNullOrWhiteSpace($Version)) { $Version = $manifestVersion }

$packageVersion = (Get-Content -LiteralPath $packageFile -Raw | ConvertFrom-Json).version
$dockerMatch = [regex]::Match((Get-Content -LiteralPath $dockerfile -Raw), '(?m)^ARG BUILD_VERSION=([^\s]+)')
if ($Version -ne $manifestVersion -or $Version -ne $packageVersion -or -not $dockerMatch.Success -or $Version -ne $dockerMatch.Groups[1].Value) {
    throw "Verze $Version nesouhlasí mezi config.yaml, package.json a Dockerfile."
}

$archive = Join-Path $releaseRoot "MyBrowser-v$Version-HA-addon.zip"
if (Test-Path -LiteralPath $archive) {
    throw "Release $Version už existuje. Zvyšte verzi; existující vydání se nepřepisují."
}

Push-Location $addonRoot
try {
    npm test
    if ($LASTEXITCODE -ne 0) { throw "Testy selhaly." }
    node --check server.js
    if ($LASTEXITCODE -ne 0) { throw "server.js není syntakticky platný." }
    node --check chromium.js
    if ($LASTEXITCODE -ne 0) { throw "chromium.js není syntakticky platný." }
    node -e "const fs=require('fs');const h=fs.readFileSync('ui.html','utf8');const a=h.indexOf('<script>')+8,b=h.lastIndexOf('</script>');if(a<8||b<a)throw Error('script missing');new Function(h.slice(a,b));"
    if ($LASTEXITCODE -ne 0) { throw "JavaScript v ui.html není syntakticky platný." }
}
finally {
    Pop-Location
}

New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
Compress-Archive -LiteralPath $addonRoot -DestinationPath $archive -CompressionLevel Optimal

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
$checksumLine = "$hash  $(Split-Path -Leaf $archive)"
if (Test-Path -LiteralPath $checksumFile) {
    Add-Content -LiteralPath $checksumFile -Encoding utf8 -Value $checksumLine
}
else {
    Set-Content -LiteralPath $checksumFile -Encoding utf8 -Value $checksumLine
}

Write-Host "Vytvořeno: $archive"
Write-Host "SHA-256: $hash"
