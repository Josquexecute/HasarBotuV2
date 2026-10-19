param(
  [Parameter(Mandatory=$true)][string]$SourceRefreshDirectory,
  [Parameter(Mandatory=$true)][string]$BackupDirectory,
  [switch]$Apply
)
$ErrorActionPreference='Stop'
if(-not [IO.Path]::IsPathRooted($SourceRefreshDirectory) -or -not [IO.Path]::IsPathRooted($BackupDirectory) -or $SourceRefreshDirectory.Contains('"')){throw 'ABSOLUTE_SAFE_DIRECTORIES_REQUIRED'}
$launcher=Join-Path $SourceRefreshDirectory 'run-office-source-refresh.exe'
$source=Join-Path $SourceRefreshDirectory 'office-source-refresh-launcher.cs'
$metadata=$launcher+'.json'
foreach($file in @($source,(Join-Path $SourceRefreshDirectory 'run-office-source-refresh.ps1'))){if(-not(Test-Path -LiteralPath $file -PathType Leaf)){throw 'SOURCE_REFRESH_LAUNCHER_FILES_REQUIRED'}}
$sourceHash=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
$current=$false
if((Test-Path -LiteralPath $launcher) -and (Test-Path -LiteralPath $metadata)){
  $saved=Get-Content -LiteralPath $metadata -Encoding UTF8 -Raw|ConvertFrom-Json
  $current=$saved.sourceHash -eq $sourceHash -and $saved.binaryHash -eq (Get-FileHash -LiteralPath $launcher -Algorithm SHA256).Hash
}
$names=@{'HasarBotu-Office-Pending-Source-Attestations'='pending';'HasarBotu-Office-Source-Attestations'='all'}
$plans=@(foreach($name in $names.Keys){
  $task=Get-ScheduledTask -TaskName $name -ErrorAction Stop
  if($task.Actions.Count -ne 1){throw 'UNEXPECTED_SOURCE_REFRESH_ACTIONS'}
  $configured=$task.Actions[0].Execute -eq $launcher -and $task.Actions[0].Arguments -eq $names[$name]
  if(-not $configured -and $task.Actions[0].Arguments -notmatch 'run-office-source-refresh\.(ps1|vbs)'){throw 'UNEXPECTED_SOURCE_REFRESH_TASK'}
  [pscustomobject]@{Name=$name;Mode=$names[$name];Configured=$configured;Xml=(Export-ScheduledTask -TaskName $name)}
})
if($current -and @($plans|Where-Object {-not $_.Configured}).Count -eq 0){@{status='already_configured'}|ConvertTo-Json -Compress;return}
if(-not $Apply){@{status='preview';taskCount=$plans.Count;buildRequired=(-not $current)}|ConvertTo-Json -Compress;return}
if(Test-Path -LiteralPath $BackupDirectory){throw 'SOURCE_REFRESH_BACKUP_ALREADY_EXISTS'}
New-Item -ItemType Directory -Path $BackupDirectory|Out-Null
foreach($plan in $plans){[IO.File]::WriteAllText((Join-Path $BackupDirectory ($plan.Name+'.xml')),$plan.Xml,[Text.Encoding]::Unicode)}
foreach($file in @($launcher,$metadata)){if(Test-Path -LiteralPath $file){Copy-Item -LiteralPath $file -Destination (Join-Path $BackupDirectory ([IO.Path]::GetFileName($file)))}}
$temporary=$launcher+'.'+[Guid]::NewGuid().ToString('N')+'.exe'
$changed=@()
try{
  if(-not $current){
    Add-Type -TypeDefinition ([IO.File]::ReadAllText($source)) -OutputAssembly $temporary -OutputType WindowsApplication
    if(Test-Path -LiteralPath $launcher){[IO.File]::Replace($temporary,$launcher,$null)}else{[IO.File]::Move($temporary,$launcher)}
    @{sourceHash=$sourceHash;binaryHash=(Get-FileHash -LiteralPath $launcher -Algorithm SHA256).Hash}|ConvertTo-Json|Set-Content -LiteralPath $metadata -Encoding UTF8
  }
  foreach($plan in $plans){
    if($plan.Configured){continue}
    $changed+=,$plan
    $action=New-ScheduledTaskAction -Execute $launcher -Argument $plan.Mode
    Set-ScheduledTask -TaskName $plan.Name -Action $action|Out-Null
    $actual=Get-ScheduledTask -TaskName $plan.Name
    if($actual.Actions.Count -ne 1 -or $actual.Actions[0].Execute -ne $launcher -or $actual.Actions[0].Arguments -ne $plan.Mode){throw 'SOURCE_REFRESH_TASK_VERIFICATION_FAILED'}
  }
  @{status='configured';taskCount=$plans.Count;vbscriptRequired=$false}|ConvertTo-Json -Compress
}catch{
  $failure=$_
  foreach($plan in $changed){Register-ScheduledTask -TaskName $plan.Name -Xml $plan.Xml -Force|Out-Null}
  foreach($file in @($launcher,$metadata)){
    $backup=Join-Path $BackupDirectory ([IO.Path]::GetFileName($file))
    if(Test-Path -LiteralPath $backup){Copy-Item -LiteralPath $backup -Destination $file -Force}
    elseif(Test-Path -LiteralPath $file){Remove-Item -LiteralPath $file -Force}
  }
  throw $failure
}finally{if(Test-Path -LiteralPath $temporary){Remove-Item -LiteralPath $temporary -Force}}
