param([ValidateSet('all','pending','preview')][string]$Mode='all')
$ErrorActionPreference='Stop'
if($env:COMPUTERNAME -ne 'DESKTOP-EFN2G33'){throw 'SOURCE_REFRESH_TARGET_MISMATCH'}
$runtime='C:/ProgramData/HasarBotu/runtime-20261011'
$directory='C:/ProgramData/HasarBotu/office-management/source-refresh'
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
  & "$runtime/runtime/node.exe" "$directory/refresh-source.cjs"
  if($LASTEXITCODE -ne 0){throw 'SOURCE_REFRESH_FAILED; see the protected source-refresh status report'}
} finally {
  if($acquired){$mutex.ReleaseMutex()}
  $mutex.Dispose()
}
