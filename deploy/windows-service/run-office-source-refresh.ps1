param([ValidateSet('all','pending','preview')][string]$Mode='all',[string]$SourceRefreshDirectory=$PSScriptRoot)
$ErrorActionPreference='Stop'
$directory=[IO.Path]::GetFullPath($SourceRefreshDirectory)
$config=Get-Content -LiteralPath (Join-Path $directory 'configuration.json') -Encoding UTF8 -Raw|ConvertFrom-Json
if(-not $config.expectedComputerName -or $env:COMPUTERNAME -ine $config.expectedComputerName){throw 'SOURCE_REFRESH_TARGET_MISMATCH'}
if(-not $config.runtimeRoot -or -not [IO.Path]::IsPathRooted($config.runtimeRoot) -or $config.runtimeRoot.Contains('"')){throw 'SOURCE_REFRESH_RUNTIME_ROOT_REQUIRED'}
$runtime=[IO.Path]::GetFullPath($config.runtimeRoot)
$mutex=[Threading.Mutex]::new($false,'Global\HasarBotu-Office-Source-Attestations')
$acquired=$false
try {
  try {$acquired=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$acquired=$true}
  if(-not $acquired){exit 0}
  $keys=@('DATABASE_URL','HASARBOTU_AGENT_ROOTS','HASARBOTU_AGENT_PCLOUD_DB_PATH','HASARBOTU_AGENT_PCLOUD_TOP_LEVEL_FOLDER','HASARBOTU_AGENT_ATTESTATION_STORE')
  foreach($key in $keys){[Environment]::SetEnvironmentVariable($key,[Environment]::GetEnvironmentVariable($key,'Machine'),'Process')}
  [xml]$wrapper=[IO.File]::ReadAllText("$runtime/wrappers/file-agent/hasarbotu-file-agent.xml")
  foreach($entry in $wrapper.service.env){if($entry.name -in $keys){[Environment]::SetEnvironmentVariable([string]$entry.name,[string]$entry.value,'Process')}}
  $env:HB_SOURCE_REFRESH_PENDING_ONLY=if($Mode -eq 'pending'){'1'}else{'0'}
  $env:HB_SOURCE_REFRESH_PLAN_ONLY=if($Mode -eq 'preview'){'1'}else{'0'}
  $env:HASARBOTU_SOURCE_REFRESH_DIRECTORY=$directory
  & "$runtime/runtime/node.exe" "$directory/office-source-refresh.cjs"
  if($LASTEXITCODE -ne 0){throw 'SOURCE_REFRESH_FAILED; see the protected source-refresh status report'}
} finally {
  if($acquired){$mutex.ReleaseMutex()}
  $mutex.Dispose()
}
