#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($env:COMPUTERNAME -ne 'DESKTOP-EFN2G33') { throw 'TARGET_COMPUTER_MISMATCH' }
$directory = Join-Path $env:ProgramData 'HasarBotu\office-management'
$state = Get-Content -LiteralPath (Join-Path $directory 'deployment-state.json') -Raw | ConvertFrom-Json
if ($state.SchemaVersion -ne 'hasarbotu-office-management/1.0.0' -or $state.Status -ne 'PENDING_REMOTE_KEY_ACCEPTANCE') { throw 'OWNED_MANAGEMENT_DEPLOYMENT_REQUIRED' }
$config = Join-Path $env:ProgramData 'ssh\sshd_config'
$keys = Join-Path $env:ProgramData 'ssh\administrators_authorized_keys'
if ((Get-FileHash -LiteralPath $config -Algorithm SHA256).Hash -ne $state.ConfigSha256 -or
    (Get-FileHash -LiteralPath $keys -Algorithm SHA256).Hash -ne $state.AuthorizedKeysSha256) { throw 'CHANGED_SSH_CONFIGURATION_REQUIRES_REVIEW' }
Stop-Service sshd
Set-Service sshd -StartupType Disabled
Get-NetFirewallRule -Name 'HasarBotu-Office-SSH-Tailscale' | Disable-NetFirewallRule | Out-Null
Write-Output 'HasarBotu office SSH management disabled. Application services and documents were not modified.'
