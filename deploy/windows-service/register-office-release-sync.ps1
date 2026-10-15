param(
  [Parameter(Mandatory=$true)][string]$Configuration,
  [Parameter(Mandatory=$true)][string]$NodeExecutable,
  [Parameter(Mandatory=$true)][string]$SyncScript
)
$ErrorActionPreference='Stop'
foreach($path in @($Configuration,$NodeExecutable,$SyncScript)) {
  if(-not [IO.Path]::IsPathRooted($path) -or -not (Test-Path -LiteralPath $path -PathType Leaf)){throw 'ABSOLUTE_EXISTING_SYNC_PATH_REQUIRED'}
}
$config=Get-Content -LiteralPath $Configuration -Raw -Encoding UTF8|ConvertFrom-Json
if(-not [IO.Path]::IsPathRooted($config.githubExecutable) -or -not (Test-Path -LiteralPath $config.githubExecutable -PathType Leaf)){throw 'GITHUB_CLI_REQUIRED'}
$runner=Join-Path $PSScriptRoot 'run-office-release-sync.ps1'
& $runner -Configuration $Configuration -NodeExecutable $NodeExecutable -SyncScript $SyncScript -CheckAccess
$taskName='HasarBotu-GitHub-Release-Sync'
if(Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue){throw 'RELEASE_SYNC_TASK_ALREADY_REGISTERED'}
$account=[Security.Principal.WindowsIdentity]::GetCurrent().Name
if($account -ne (Get-CimInstance Win32_ComputerSystem).UserName){throw 'REGISTER_FROM_OFFICE_INTERACTIVE_WINDOWS_USER'}
foreach($path in @($Configuration,$NodeExecutable,$SyncScript,$runner)){if($path.Contains('"')){throw 'UNSAFE_SYNC_PATH'}}
$arguments="-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`" -Configuration `"$Configuration`" -NodeExecutable `"$NodeExecutable`" -SyncScript `"$SyncScript`""
$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
$triggers=@((New-ScheduledTaskTrigger -AtLogOn -User $account),(New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)))
$principal=New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Highest
$settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 4) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Principal $principal -Settings $settings|Out-Null
Start-ScheduledTask -TaskName $taskName
@{status='STARTED';task=$taskName;intervalMinutes=5;requiresOfficeWindowsLogin=$true;credentialsInTaskArguments=$false}|ConvertTo-Json
