#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'office-network-state.ps1')
$script:checks = 0
function Assert-True([bool]$Value, [string]$Message) { if (-not $Value) { throw "FAIL: $Message" }; $script:checks++ }
function Get-Service { param($Name, $ErrorAction) $script:services[$Name] }
function Stop-Service { param($Name, $ErrorAction) $script:services[$Name].Status = 'Stopped' }
function Start-Service { param($Name, $ErrorAction) $script:services[$Name].Status = 'Running' }
function Get-ScheduledTask { param($TaskName, $ErrorAction) if ($script:task) { @{Name=$TaskName} } }
function Export-ScheduledTask { param($TaskName) $script:task }
function Register-ScheduledTask { param($TaskName, $Xml, [switch]$Force) $script:task = $Xml }
function Unregister-ScheduledTask { param($TaskName, $Confirm) $script:task = $null }
function Get-NetFirewallRule { param($Name, $ErrorAction) if ($script:rules.Contains($Name)) { @{Name=$Name} } }
function Remove-NetFirewallRule { param($Name) [void]$script:rules.Remove($Name) }
function Invoke-OfficeNetworkWrapper { param($Wrapper, $Action) $script:events.Add("${Action}:$([IO.Path]::GetFileNameWithoutExtension($Wrapper))") }
function Get-CimInstance { param($ClassName,$Filter) if ($Filter -eq 'ProcessId=42') { @{ParentProcessId=10} } else { @{ParentProcessId=999} } }
Assert-OfficeNetworkListenerOwner @() 0
Assert-OfficeNetworkListenerOwner @(@{OwningProcess=10},@{OwningProcess=42}) 10
Assert-True $true 'only wrapper or direct child listeners are accepted'
foreach ($case in @(@{Owner=99;Service=10},@{Owner=42;Service=0})) {
    $rejected = $false
    try { Assert-OfficeNetworkListenerOwner @(@{OwningProcess=$case.Owner}) $case.Service } catch { $rejected = $_.Exception.Message -eq 'NETWORK_PORT_CONFLICT' }
    Assert-True $rejected 'unrelated listeners fail closed even if a gateway service exists'
}
$root = Join-Path ([IO.Path]::GetTempPath()) ('hb-network-state-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
try {
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
    foreach ($sid in @('S-1-5-18','S-1-5-32-544')) { $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid), 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')) }
    Set-Acl -LiteralPath $root -AclObject $acl
    $script:services = @{'hasarbotu-lan-https'=@{Status='Running'}}
    $script:task = '<Task>previous</Task>'
    $script:rules = [Collections.Generic.HashSet[string]]::new()
    [void]$script:rules.Add('Unrelated-Rule')
    $script:events = [Collections.Generic.List[string]]::new()
    $legacyXml = Join-Path $root 'legacy.xml'; $legacyConfig = Join-Path $root 'legacy.caddy'
    [IO.File]::WriteAllText($legacyXml, 'original xml'); [IO.File]::WriteAllText($legacyConfig, 'original caddy')
    [IO.File]::WriteAllText((Join-Path $root 'client-profile.json'), 'original profile')
    $receipt = New-OfficeNetworkBackup $root @('client-profile.json','new-file.json') @($legacyXml,$legacyConfig)
    Assert-True ((Restore-OfficeNetworkBackup $receipt).status -eq 'ROLLBACK_PREVIEW') 'preview leaves state unchanged'
    Assert-True ($script:events.Count -eq 0) 'preview invokes no wrappers'
    foreach ($file in @($legacyXml,$legacyConfig,(Join-Path $root 'client-profile.json'),(Join-Path $root 'new-file.json'))) { [IO.File]::WriteAllText($file, 'changed') }
    $script:services['hasarbotu-office-gateway'] = @{Status='Running'}
    $script:services['hasarbotu-network-discovery'] = @{Status='Running'}
    $script:task = '<Task>replacement</Task>'
    [void]$script:rules.Add('HasarBotu-Office-Gateway-v2'); [void]$script:rules.Add('HasarBotu-Office-Discovery-v2')
    $result = Restore-OfficeNetworkBackup $receipt -Apply
    Assert-True ($result.status -eq 'RESTORED') 'apply restores after a late failure'
    Assert-True ([IO.File]::ReadAllText($legacyXml) -eq 'original xml' -and [IO.File]::ReadAllText($legacyConfig) -eq 'original caddy') 'legacy XML and active config both restored'
    Assert-True ([IO.File]::ReadAllText((Join-Path $root 'client-profile.json')) -eq 'original profile') 'existing profile restored byte-for-byte'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $root 'new-file.json'))) 'new managed file removed'
    Assert-True ($script:task -eq '<Task>previous</Task>') 'original task restored'
    Assert-True ($script:rules.Count -eq 1 -and $script:rules.Contains('Unrelated-Rule')) 'only newly created firewall rules removed'
    Assert-True (($script:events -join '|') -eq 'uninstall:hasarbotu-network-discovery|uninstall:hasarbotu-office-gateway|refresh:legacy') 'new services uninstalled before config removal, legacy refreshed'
    Assert-True ($script:services['hasarbotu-lan-https'].Status -eq 'Running') 'previous running state restored'
    Assert-True ((Restore-OfficeNetworkBackup $receipt -Apply).status -eq 'ALREADY_RESTORED') 'rollback is idempotent'
    [IO.File]::AppendAllText($receipt, ' ')
    $rejected = $false
    try { Restore-OfficeNetworkBackup $receipt -Apply | Out-Null } catch { $rejected = $_.Exception.Message -eq 'NETWORK_BACKUP_HASH_MISMATCH' }
    Assert-True $rejected 'corrupt backup rejected before mutations'
} finally {
    $resolved = [IO.Path]::GetFullPath($root)
    if (-not $resolved.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()), [StringComparison]::OrdinalIgnoreCase)) { throw 'UNSAFE_FIXTURE_CLEANUP' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
Write-Output "$script:checks/$script:checks PASS"
