param([Parameter(Mandatory=$true)][string]$Configuration)
$ErrorActionPreference='Stop'
if(-not [IO.Path]::IsPathRooted($Configuration) -or -not (Test-Path -LiteralPath $Configuration -PathType Leaf)){throw 'ABSOLUTE_EXISTING_SYNC_CONFIGURATION_REQUIRED'}
$credential=Join-Path ([IO.Path]::GetDirectoryName($Configuration)) 'github-token.dpapi'
if(Test-Path -LiteralPath $credential){throw 'SYNC_CREDENTIAL_ALREADY_EXISTS'}
# Run as the same office Windows user that owns the scheduled task. Never paste this value into chat.
$secret=Read-Host 'HasarBotuV2 Contents:Read ve Actions:Read token (gizli)' -AsSecureString
if($secret.Length -eq 0){throw 'EMPTY_GITHUB_CREDENTIAL'}
[IO.File]::WriteAllText($credential,($secret|ConvertFrom-SecureString),[Text.UTF8Encoding]::new($false))
$secret.Dispose()
Write-Output 'CREDENTIAL_SAVED_FOR_CURRENT_WINDOWS_USER'
