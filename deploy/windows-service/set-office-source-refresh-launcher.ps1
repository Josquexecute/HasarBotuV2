param(
  [Parameter(Mandatory=$true)][string]$SourceRefreshDirectory,
  [Parameter(Mandatory=$true)][string]$BackupDirectory
)
$ErrorActionPreference='Stop'
$launcher=Join-Path $SourceRefreshDirectory 'run-office-source-refresh.vbs'
if(-not [IO.Path]::IsPathRooted($SourceRefreshDirectory) -or -not [IO.Path]::IsPathRooted($BackupDirectory) -or $SourceRefreshDirectory.Contains('"')){throw 'ABSOLUTE_SAFE_DIRECTORIES_REQUIRED'}
if(-not(Test-Path -LiteralPath $launcher) -or -not(Test-Path -LiteralPath (Join-Path $SourceRefreshDirectory 'run-office-source-refresh.ps1'))){throw 'SOURCE_REFRESH_LAUNCHER_FILES_REQUIRED'}
$hostFile=Join-Path $env:SystemRoot 'System32/wscript.exe'
if(-not(Test-Path -LiteralPath $hostFile)){throw 'WINDOWS_SCRIPT_HOST_REQUIRED'}
$names=@{'HasarBotu-Office-Pending-Source-Attestations'='pending';'HasarBotu-Office-Source-Attestations'='all'}
New-Item -ItemType Directory -Path $BackupDirectory -Force|Out-Null
foreach($name in $names.Keys){
  $task=Get-ScheduledTask -TaskName $name -ErrorAction Stop
  $arguments='//B //Nologo "'+$launcher+'" '+$names[$name]
  if($task.Actions.Count -ne 1){throw 'UNEXPECTED_SOURCE_REFRESH_ACTIONS'}
  if($task.Actions[0].Execute -eq $hostFile -and $task.Actions[0].Arguments -eq $arguments){continue}
  if($task.Actions[0].Arguments -notlike '*run-office-source-refresh.ps1*'){throw 'UNEXPECTED_SOURCE_REFRESH_TASK'}
  $backup=Join-Path $BackupDirectory ($name+'.xml')
  if(Test-Path -LiteralPath $backup){throw 'SOURCE_REFRESH_BACKUP_ALREADY_EXISTS'}
  Export-ScheduledTask -TaskName $name|Set-Content -LiteralPath $backup -Encoding Unicode
  $action=New-ScheduledTaskAction -Execute $hostFile -Argument $arguments
  Set-ScheduledTask -TaskName $name -Action $action|Out-Null
}
