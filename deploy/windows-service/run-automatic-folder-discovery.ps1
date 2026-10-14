param(
  [Parameter(Mandatory=$true)][string]$RuntimeDirectory,
  [Parameter(Mandatory=$true)][string]$PolicyFile
)
$ErrorActionPreference = 'Stop'
$databaseConfiguration = [Environment]::GetEnvironmentVariable('DATABASE_URL', 'Machine')
if ([string]::IsNullOrWhiteSpace($databaseConfiguration)) { throw 'AUTOMATIC_FOLDER_DATABASE_NOT_CONFIGURED' }
$env:DATABASE_URL = $databaseConfiguration
$env:NODE_NO_WARNINGS = '1'
& (Join-Path $RuntimeDirectory 'runtime/node.exe') (Join-Path $PSScriptRoot 'automatic-folder-discovery.mjs') $PolicyFile
exit $LASTEXITCODE
