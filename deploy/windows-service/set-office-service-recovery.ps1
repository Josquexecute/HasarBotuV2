#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [string]$Directory = 'C:\ProgramData\HasarBotu\office-network',
    [string[]]$Services = @('postgresql-x64-17','hasarbotu-api','hasarbotu-lan-https','hasarbotu-field-portal','hasarbotu-file-agent','hasarbotu-folder-discovery','hasarbotu-office-gateway','hasarbotu-network-discovery'),
    [string]$RollbackReceipt,
    [switch]$Apply
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'office-network-state.ps1')
if (-not ('OfficeServiceRecovery' -as [type])) { Add-Type -Path (Join-Path $PSScriptRoot 'office-service-recovery.cs') }
function ConvertTo-RecoveryPolicy($Value) {
    $policy = [OfficeServiceRecovery+Policy]::new()
    $policy.ResetSeconds = $Value.ResetSeconds
    $policy.RebootMessage = $Value.RebootMessage; $policy.Command = $Value.Command
    $policy.Actions = @($Value.Actions | ForEach-Object { $item=[OfficeServiceRecovery+Action]::new(); $item.Type=$_.Type; $item.Delay=$_.Delay; $item })
    return $policy
}
function Get-BoundedRecoveryPolicy($Original) {
    return ConvertTo-RecoveryPolicy @{ResetSeconds=3600;RebootMessage=$Original.RebootMessage;Command=$Original.Command;Actions=@(@{Type=1;Delay=10000},@{Type=1;Delay=30000},@{Type=1;Delay=60000},@{Type=0;Delay=0})}
}
function Get-RecoveryPolicyKey($Policy) {
    # SCM represents cleared optional strings as either null or empty; their effective policy is identical.
    return ([ordered]@{ResetSeconds=$Policy.ResetSeconds;RebootMessage=[string]$Policy.RebootMessage;Command=[string]$Policy.Command;Actions=@($Policy.Actions | Select-Object Type,Delay)} | ConvertTo-Json -Depth 6 -Compress)
}
function Restore-RecoveryEntries($Entries) {
    foreach ($entry in $Entries) {
        if ($entry.xmlPath) { [IO.File]::WriteAllBytes($entry.xmlPath, [Convert]::FromBase64String($entry.xmlBytes)) }
        [OfficeServiceRecovery]::Write($entry.name, (ConvertTo-RecoveryPolicy $entry.policy))
        if ((Get-RecoveryPolicyKey ([OfficeServiceRecovery]::Read($entry.name))) -ne (Get-RecoveryPolicyKey $entry.policy)) { throw 'SERVICE_RECOVERY_ROLLBACK_VERIFICATION_FAILED' }
    }
}
if ($RollbackReceipt) {
    Assert-OfficeNetworkPath $RollbackReceipt
    Assert-OfficeNetworkProtectedFile $RollbackReceipt
    Assert-OfficeNetworkProtectedFile ($RollbackReceipt + '.sha256')
    if ((Get-FileHash -LiteralPath $RollbackReceipt -Algorithm SHA256).Hash -ne [IO.File]::ReadAllText($RollbackReceipt + '.sha256').Trim()) { throw 'SERVICE_RECOVERY_BACKUP_HASH_MISMATCH' }
    $saved = [IO.File]::ReadAllText($RollbackReceipt) | ConvertFrom-Json
    if ($saved.schemaVersion -ne 1 -or $saved.machine -ne $env:COMPUTERNAME) { throw 'SERVICE_RECOVERY_BACKUP_IDENTITY_MISMATCH' }
    foreach ($entry in $saved.entries) {
        $current = Get-RecoveryPolicyKey ([OfficeServiceRecovery]::Read($entry.name))
        if ($current -notin @((Get-RecoveryPolicyKey $entry.policy),(Get-RecoveryPolicyKey (Get-BoundedRecoveryPolicy $entry.policy)))) { throw 'SERVICE_RECOVERY_POLICY_CHANGED_SINCE_APPLY' }
        if ($entry.xmlPath) { Assert-OfficeNetworkPath $entry.xmlPath }
        if ($entry.xmlPath -and [Convert]::ToBase64String([IO.File]::ReadAllBytes($entry.xmlPath)) -notin @($entry.xmlBytes,$entry.xmlNextBytes)) { throw 'SERVICE_XML_CHANGED_SINCE_APPLY' }
    }
    if ($Apply) { Restore-RecoveryEntries $saved.entries }
    @{status=$(if($Apply){'RESTORED'}else{'ROLLBACK_PREVIEW'});receipt=$RollbackReceipt;servicesRestarted=$false} | ConvertTo-Json -Compress
    return
}
$entries = @()
foreach ($name in $Services) {
    if ($name -notmatch '^(hasarbotu-|postgresql-)[a-z0-9-]+$') { throw 'UNSUPPORTED_SERVICE_NAME' }
    $service = Get-CimInstance Win32_Service -Filter ("Name='" + $name + "'")
    if (-not $service) { throw "SERVICE_MISSING:$name" }
    $xmlPath = $null; $xmlBytes = $null; $xmlNextBytes = $null
    if ($name.StartsWith('hasarbotu-')) {
        if ($service.PathName -notmatch '^"?([^"\r\n]+?\.exe)"?(?:\s|$)') { throw 'SERVICE_WRAPPER_PATH_UNSUPPORTED' }
        $xmlPath = [IO.Path]::ChangeExtension($Matches[1], '.xml')
        Assert-OfficeNetworkPath $xmlPath
        [xml]$definition = [IO.File]::ReadAllText($xmlPath)
        if ($definition.service.id -ne $name) { throw 'SERVICE_WRAPPER_ID_MISMATCH' }
        $xmlBytes = [Convert]::ToBase64String([IO.File]::ReadAllBytes($xmlPath))
        foreach ($node in @($definition.service.SelectNodes('onfailure|resetfailure'))) { [void]$definition.service.RemoveChild($node) }
        foreach ($seconds in @(10,30,60,0)) {
            $node = $definition.CreateElement('onfailure'); $node.SetAttribute('action', $(if($seconds){'restart'}else{'none'}))
            if ($seconds) { $node.SetAttribute('delay', "$seconds sec") }; [void]$definition.service.AppendChild($node)
        }
        $node = $definition.CreateElement('resetfailure'); $node.InnerText='1 hour'; [void]$definition.service.AppendChild($node)
        $xmlNextBytes = [Convert]::ToBase64String([Text.UTF8Encoding]::new($false).GetBytes($definition.OuterXml))
    }
    $policy = [OfficeServiceRecovery]::Read($name)
    if (@($policy.Actions | Where-Object { $_.Type -gt 1 }).Count) { throw "RECOVERY_POLICY_REQUIRES_MANUAL_REVIEW:$name" }
    $entries += @{name=$name;policy=$policy;xmlPath=$xmlPath;xmlBytes=$xmlBytes;xmlNextBytes=$xmlNextBytes}
}
if (-not $Apply) { @{status='PREVIEW';services=@($Services);restartDelaysSeconds=@(10,30,60);finalAction='none';servicesRestarted=$false} | ConvertTo-Json -Compress; return }
Assert-OfficeNetworkPath $Directory
Assert-OfficeNetworkProtectedFile $Directory
$backup = Join-Path $Directory ('backups\service-recovery-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $backup -Force | Out-Null
$receipt = Join-Path $backup 'state.json'
[IO.File]::WriteAllText($receipt, (@{schemaVersion=1;machine=$env:COMPUTERNAME;entries=$entries} | ConvertTo-Json -Depth 10), [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText(($receipt + '.sha256'), (Get-FileHash -LiteralPath $receipt -Algorithm SHA256).Hash)
try {
    foreach ($entry in $entries) {
        if ($entry.xmlPath) {
            [IO.File]::WriteAllBytes($entry.xmlPath, [Convert]::FromBase64String($entry.xmlNextBytes))
        }
        $policy = Get-BoundedRecoveryPolicy $entry.policy
        [OfficeServiceRecovery]::Write($entry.name, $policy)
        if ((Get-RecoveryPolicyKey ([OfficeServiceRecovery]::Read($entry.name))) -ne (Get-RecoveryPolicyKey $policy)) { throw 'SERVICE_RECOVERY_VERIFICATION_FAILED' }
    }
    @{status='APPLIED';rollbackReceipt=$receipt;servicesRestarted=$false;startModesChanged=$false} | ConvertTo-Json -Compress
} catch {
    $failure = $_
    try { Restore-RecoveryEntries $entries }
    catch { throw "SERVICE_RECOVERY_ROLLBACK_FAILED: $receipt; original=$($failure.Exception.Message); rollback=$($_.Exception.Message)" }
    throw $failure
}
