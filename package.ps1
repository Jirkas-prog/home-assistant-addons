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
    throw "mybrowser/config.yaml is missing"
}

$configText = Get-Content -LiteralPath $configFile -Raw
$manifestMatch = [regex]::Match($configText, '(?m)^version:\s*["'']?([^"''\s]+)')
if (-not $manifestMatch.Success) { throw "config.yaml does not contain a version." }
$manifestVersion = $manifestMatch.Groups[1].Value
if ([string]::IsNullOrWhiteSpace($Version)) { $Version = $manifestVersion }

$packageVersion = (Get-Content -LiteralPath $packageFile -Raw | ConvertFrom-Json).version
$dockerMatch = [regex]::Match((Get-Content -LiteralPath $dockerfile -Raw), '(?m)^ARG BUILD_VERSION=([^\s]+)')
if ($Version -ne $manifestVersion -or $Version -ne $packageVersion -or -not $dockerMatch.Success -or $Version -ne $dockerMatch.Groups[1].Value) {
    throw "Version $Version does not match across config.yaml, package.json, and Dockerfile."
}

$archive = Join-Path $releaseRoot "MyBrowser-v$Version-HA-addon.zip"
if (Test-Path -LiteralPath $archive) {
    throw "Release $Version already exists. Increase the version; existing releases are never overwritten."
}

Push-Location $addonRoot
try {
    npm test
    if ($LASTEXITCODE -ne 0) { throw "Tests failed." }
    node --check server.js
    if ($LASTEXITCODE -ne 0) { throw "server.js has invalid syntax." }
    node --check chromium.js
    if ($LASTEXITCODE -ne 0) { throw "chromium.js has invalid syntax." }
    node --check brave.js
    if ($LASTEXITCODE -ne 0) { throw "brave.js has invalid syntax." }
    node --check locales.js
    if ($LASTEXITCODE -ne 0) { throw "locales.js has invalid syntax." }
    node -e "const fs=require('fs'),{localizeUi}=require('./locales');const source=fs.readFileSync('ui.html','utf8');for(const language of ['en','cs']){const h=localizeUi(source,language),a=h.indexOf('<script>')+8,b=h.lastIndexOf('</script>');if(a<8||b<a)throw Error('script missing');new Function(h.slice(a,b));}"
    if ($LASTEXITCODE -ne 0) { throw "JavaScript in the English or Czech UI has invalid syntax." }
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

Write-Host "Created: $archive"
Write-Host "SHA-256: $hash"
