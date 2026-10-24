param([string]$Destination)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$include = @('config.yaml','Dockerfile','.dockerignore','install.py','LICENSE','THIRD_PARTY.md','README.md','DOCS.md','CHANGELOG.md','package.json','package.ps1','custom_components','www','examples','tests','preview')
if (-not $Destination) { $Destination = Join-Path $projectRoot 'releases\workflow_timers' }
$target = [IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $target) { throw "Destination already exists: $target. Choose a new empty destination." }
New-Item -ItemType Directory -Path $target -Force | Out-Null
foreach ($name in $include) {
    $source = Join-Path $projectRoot $name
    if (Test-Path -LiteralPath $source -PathType Leaf) {
        Copy-Item -LiteralPath $source -Destination (Join-Path $target $name)
    } else {
        Get-ChildItem -LiteralPath $source -Recurse -File | Where-Object { $_.FullName -notmatch '[\\/]__pycache__[\\/]' -and $_.Extension -notin @('.pyc','.log','.png') } | ForEach-Object {
            $relative = [IO.Path]::GetRelativePath($projectRoot, $_.FullName)
            $output = Join-Path $target $relative
            New-Item -ItemType Directory -Path (Split-Path $output -Parent) -Force | Out-Null
            Copy-Item -LiteralPath $_.FullName -Destination $output
        }
    }
}
Write-Output "Prepared add-on: $target"
