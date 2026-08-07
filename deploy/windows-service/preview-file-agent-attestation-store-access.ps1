[CmdletBinding()]
param(
    [string]$ServiceAccountName = 'svc-hb-fileagent',

    [string]$AttestationStoreDirectory = 'C:\ProgramData\HasarBotu\pcloud-attestations'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# File Agent -> attestation store minimum READ-ONLY ACL -- PLAN + PREVIEW
# ONLY (HB-2026-169, Oncelik 4). Same discipline, same simulation model,
# and the SAME real-SID-based approach as preview-file-agent-pcloud-db-
# access.ps1 (HB-2026-163) -- adapted for the attestation store instead
# of pCloud's local DB.
#
# This script NEVER modifies anything: no ACL write, no directory
# creation beyond what read-only inspection needs, no file write outside
# its own Administrators-only evidence report. There is no -Apply switch
# in this script at all -- a deliberate, structural choice.
#
# Why this is needed: the attestation store (pcloud-source-attestation.mjs
# / generate-pcloud-source-attestation.ps1) is written by an ADMIN-context
# tool today, Administrators-only. For pcloud-session0-freshness-gate.mjs
# to actually READ attestations when invoked BY svc-hb-fileagent (e.g.
# from inside the disposable probe, or eventually a real File Agent
# integration), that account needs its own READ grant -- a NEW, separate
# ACL surface from the pCloud DB access work (HB-2026-163/164/165),
# flagged as `deferred_to_real_activation` in HB-2026-167's controlled-
# activation preview and left unresolved until now.
#
# Answers, with REAL evidence from THIS machine:
#   1. The full ancestor chain from the drive root down to the
#      attestation store folder, and which nodes already grant
#      svc-hb-fileagent sufficient Traverse (BUILTIN\Users' inherited
#      grant on C:\ProgramData does NOT count -- svc-hb-fileagent was
#      deliberately removed from that group, HB-2026-113/163 -- so each
#      node is checked by real SID, not assumed).
#   2. The exact minimum ACE set: Traverse-only (this-folder-only, no
#      inheritance) on each blocking ancestor + a single Read+Synchronize
#      (ObjectInherit) ACE on the attestation store folder itself, so
#      every current AND future attestation file automatically inherits
#      read access without a new per-file grant. Never Write/Modify/
#      Delete/Create/AppendData/TakeOwnership/ChangePermissions.
#   3. A rollback anchor (exact pre-existing SDDL per node, same as
#      HB-2026-163) for a future, separate, explicit Apply package
#      (mirroring apply-file-agent-pcloud-db-access.ps1's own design).

$AdministratorSidValue = 'S-1-5-32-544'
$AuthenticatedUsersSidValue = 'S-1-5-11'
$EveryoneSidValue = 'S-1-1-0'
$ReportDirectory = 'C:\ProgramData\HasarBotu\migration-preflight'

function Throw-SafePreviewError {
    param([string]$Code)
    $exception = [System.InvalidOperationException]::new($Code)
    $exception.Data['SafeCode'] = $Code
    throw $exception
}

function New-AdminOnlySecurity {
    param([bool]$Directory)
    $administratorSid = [System.Security.Principal.SecurityIdentifier]::new($AdministratorSidValue)
    $security = if ($Directory) { [System.Security.AccessControl.DirectorySecurity]::new() } else { [System.Security.AccessControl.FileSecurity]::new() }
    $security.SetAccessRuleProtection($true, $false)
    $security.SetOwner($administratorSid)
    $inheritance = if ($Directory) { ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit) } else { [System.Security.AccessControl.InheritanceFlags]::None }
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($administratorSid, [System.Security.AccessControl.FileSystemRights]::FullControl, $inheritance, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
    $security.AddAccessRule($rule)
    return $security
}

function Test-AdminOnlyAcl {
    param([string]$Path, [bool]$Directory)
    $security = if ($Directory) { [System.IO.Directory]::GetAccessControl($Path) } else { [System.IO.File]::GetAccessControl($Path) }
    $rules = @($security.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
    $ownerSid = $security.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
    $validRules = @($rules | Where-Object { $_.IdentityReference.Value -eq $AdministratorSidValue -and $_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and $_.FileSystemRights -eq [System.Security.AccessControl.FileSystemRights]::FullControl })
    return ($security.AreAccessRulesProtected -and $ownerSid -eq $AdministratorSidValue -and $rules.Count -eq 1 -and $validRules.Count -eq 1)
}

function Set-AdminOnlyFileSecurity {
    param([string]$Path)
    [System.IO.File]::SetAccessControl($Path, (New-AdminOnlySecurity $false))
    if (-not (Test-AdminOnlyAcl $Path $false)) { Throw-SafePreviewError 'ADMIN_ONLY_ACL_APPLY_FAILED' }
}

function Get-NodeAclSnapshot {
    param([string]$Path, [bool]$IsDirectory)
    if ($IsDirectory) {
        if ($Path -match '^[A-Za-z]:$') { $Path = "$Path\" }
        if (-not [System.IO.Directory]::Exists($Path)) { return $null }
        $acl = [System.IO.Directory]::GetAccessControl($Path)
    }
    else {
        if (-not [System.IO.File]::Exists($Path)) { return $null }
        $acl = [System.IO.File]::GetAccessControl($Path)
    }
    $aces = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object {
        [ordered]@{
            IdentitySid = $_.IdentityReference.Value
            FileSystemRights = $_.FileSystemRights.ToString()
            FileSystemRightsValue = [int64]$_.FileSystemRights
            AccessControlType = $_.AccessControlType.ToString()
            IsInherited = $_.IsInherited
            InheritanceFlags = $_.InheritanceFlags.ToString()
            PropagationFlags = $_.PropagationFlags.ToString()
        }
    })
    return [ordered]@{
        Path = $Path
        Owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
        AreAccessRulesProtected = $acl.AreAccessRulesProtected
        Sddl = $acl.GetSecurityDescriptorSddlForm([System.Security.AccessControl.AccessControlSections]::Access -bor [System.Security.AccessControl.AccessControlSections]::Owner)
        Aces = $aces
    }
}

function Test-SimulatedEffectiveAccess {
    param($AclSnapshot, [string]$TargetSid, [int64]$RequiredRightsValue)
    if ($null -eq $AclSnapshot) {
        return [ordered]@{ Granted = $false; Reason = 'NODE_NOT_FOUND'; MatchingAces = @() }
    }
    $relevantSids = @($TargetSid, $AuthenticatedUsersSidValue, $EveryoneSidValue)
    $matching = @($AclSnapshot.Aces | Where-Object { $relevantSids -contains $_.IdentitySid })
    $explicitDeny = @($matching | Where-Object { $_.AccessControlType -eq 'Deny' -and -not $_.IsInherited -and ([int64]$_.FileSystemRightsValue -band $RequiredRightsValue) -ne 0 })
    if ($explicitDeny.Count -gt 0) {
        return [ordered]@{ Granted = $false; Reason = 'EXPLICIT_DENY_PRESENT'; MatchingAces = $matching }
    }
    $grantedBits = 0
    foreach ($ace in ($matching | Where-Object { $_.AccessControlType -eq 'Allow' })) {
        $grantedBits = $grantedBits -bor [int64]$ace.FileSystemRightsValue
    }
    $granted = (($grantedBits -band $RequiredRightsValue) -eq $RequiredRightsValue)
    return [ordered]@{
        Granted = $granted
        Reason = if ($granted) { 'ALLOW_ACE_COVERS_REQUIRED_RIGHTS' } else { 'NO_MATCHING_GRANT' }
        MatchingAces = $matching
    }
}

try {
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [System.Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Throw-SafePreviewError 'ADMINISTRATOR_REQUIRED'
    }

    try {
        $serviceAccount = [System.Security.Principal.NTAccount]::new($ServiceAccountName)
        $serviceAccountSid = $serviceAccount.Translate([System.Security.Principal.SecurityIdentifier]).Value
    }
    catch {
        Throw-SafePreviewError 'SERVICE_ACCOUNT_NOT_FOUND'
    }

    $storePath = [System.IO.Path]::GetFullPath($AttestationStoreDirectory).TrimEnd('\')

    $driveRootNormalized = [System.IO.Path]::GetPathRoot($storePath).TrimEnd('\')
    $chainDirs = [System.Collections.Generic.List[string]]::new()
    $cursor = $storePath
    while ($true) {
        if (-not ($chainDirs -contains $cursor)) { $chainDirs.Insert(0, $cursor) }
        if ($cursor -eq $driveRootNormalized) { break }
        $parent = (Split-Path $cursor -Parent)
        if ([string]::IsNullOrWhiteSpace($parent)) { $parent = $driveRootNormalized }
        $parent = $parent.TrimEnd('\')
        if ($parent -eq $cursor) { break }
        $cursor = $parent
    }

    $traverseRights = [int64][System.Security.AccessControl.FileSystemRights]::Traverse
    $readRights = [int64]([System.Security.AccessControl.FileSystemRights]::Read -bor [System.Security.AccessControl.FileSystemRights]::Synchronize)
    $forbiddenBits = [int64](
        [System.Security.AccessControl.FileSystemRights]::WriteData -bor
        [System.Security.AccessControl.FileSystemRights]::AppendData -bor
        [System.Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
        [System.Security.AccessControl.FileSystemRights]::WriteAttributes -bor
        [System.Security.AccessControl.FileSystemRights]::Delete -bor
        [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
        [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
        [System.Security.AccessControl.FileSystemRights]::TakeOwnership
    )
    if (($traverseRights -band $forbiddenBits) -ne 0 -or ($readRights -band $forbiddenBits) -ne 0) {
        Throw-SafePreviewError 'PLANNED_RIGHTS_CONTAIN_FORBIDDEN_BITS'
    }

    $directorySnapshots = [ordered]@{}
    foreach ($dir in $chainDirs) { $directorySnapshots[$dir] = Get-NodeAclSnapshot -Path $dir -IsDirectory $true }

    $directoryAccessResults = [ordered]@{}
    foreach ($dir in $chainDirs) {
        $requiredRights = if ($dir -eq $storePath) { $readRights } else { $traverseRights }
        $directoryAccessResults[$dir] = Test-SimulatedEffectiveAccess -AclSnapshot $directorySnapshots[$dir] -TargetSid $serviceAccountSid -RequiredRightsValue $requiredRights
    }

    $plannedAces = @()
    foreach ($dir in $chainDirs) {
        if ($dir -eq $storePath) { continue }
        if (-not $directoryAccessResults[$dir].Granted) {
            $plannedAces += [ordered]@{
                Path = $dir; Type = 'Directory'; Identity = $ServiceAccountName; Rights = 'Traverse'
                RightsValue = $traverseRights; AccessControlType = 'Allow'; InheritanceFlags = 'None'; PropagationFlags = 'None'
                Purpose = 'Pass-through only -- does not allow listing this directory''s contents or reading any file in it.'
            }
        }
    }
    if (-not $directorySnapshots.Contains($storePath) -or $null -eq $directorySnapshots[$storePath]) {
        # Store folder does not exist yet -- still plan Traverse into it
        # (it will be created by generate-pcloud-source-attestation.ps1's
        # first real run, Administrators-only at creation time).
        $plannedAces += [ordered]@{
            Path = $storePath; Type = 'Directory'; Identity = $ServiceAccountName; Rights = 'Traverse'
            RightsValue = $traverseRights; AccessControlType = 'Allow'; InheritanceFlags = 'None'; PropagationFlags = 'None'
            Purpose = 'Pass-through into the attestation store folder itself.'
        }
        $plannedAces += [ordered]@{
            Path = $storePath; Type = 'Directory'; Identity = $ServiceAccountName; Rights = 'Read, Synchronize'
            RightsValue = $readRights; AccessControlType = 'Allow'; InheritanceFlags = 'ObjectInherit'; PropagationFlags = 'None'
            Purpose = 'Propagates Read to every CURRENT AND FUTURE attestation record file in this folder.'
        }
    }
    else {
        $plannedAces += [ordered]@{
            Path = $storePath; Type = 'Directory'; Identity = $ServiceAccountName; Rights = 'Traverse'
            RightsValue = $traverseRights; AccessControlType = 'Allow'; InheritanceFlags = 'None'; PropagationFlags = 'None'
            Purpose = 'Pass-through into the attestation store folder itself.'
        }
        $plannedAces += [ordered]@{
            Path = $storePath; Type = 'Directory'; Identity = $ServiceAccountName; Rights = 'Read, Synchronize'
            RightsValue = $readRights; AccessControlType = 'Allow'; InheritanceFlags = 'ObjectInherit'; PropagationFlags = 'None'
            Purpose = 'Propagates Read to every CURRENT AND FUTURE attestation record file in this folder.'
        }
    }

    $blockers = [System.Collections.Generic.List[string]]::new()
    $unexpectedDenyNodes = @()
    foreach ($dir in $chainDirs) {
        if ($null -eq $directorySnapshots[$dir]) { continue }
        $explicitDenies = @($directorySnapshots[$dir].Aces | Where-Object { $_.AccessControlType -eq 'Deny' -and -not $_.IsInherited })
        if ($explicitDenies.Count -gt 0) { $unexpectedDenyNodes += $dir }
    }
    if ($unexpectedDenyNodes.Count -gt 0) { $blockers.Add('EXPLICIT_DENY_ACE_PRESENT_ON_ANCESTOR') }

    $storeAlreadySufficient = ($directoryAccessResults.Contains($storePath) -and $directoryAccessResults[$storePath].Granted)
    $ancestorsAlreadySufficient = -not @($chainDirs | Where-Object { $_ -ne $storePath -and -not $directoryAccessResults[$_].Granted }).Count -gt 0
    $overallStatus = if ($blockers.Count -gt 0) { 'blocked' } elseif ($storeAlreadySufficient -and $ancestorsAlreadySufficient -and $directorySnapshots.Contains($storePath) -and $null -ne $directorySnapshots[$storePath]) { 'already_sufficient' } else { 'grant_required' }

    $output = [ordered]@{
        SchemaVersion = 'hasarbotu-file-agent-attestation-store-access-preview/1.0.0'
        Mode = 'preview'
        GeneratedAtUtc = [DateTime]::UtcNow.ToString('o')
        ServiceAccountName = $ServiceAccountName
        ServiceAccountSid = $serviceAccountSid
        AttestationStoreDirectory = $storePath
        AncestorChain = @($chainDirs | ForEach-Object {
            [ordered]@{ Path = $_; CurrentlyGranted = $directoryAccessResults[$_].Granted; Reason = $directoryAccessResults[$_].Reason; AclSnapshot = $directorySnapshots[$_] }
        })
        PlannedMinimumAces = $plannedAces
        PlannedAcesContainNoWriteOrDeleteBits = $true
        RollbackPlan = 'None of these ACEs have been applied. If a FUTURE, separate, explicit Apply step adds them (mirroring apply-file-agent-pcloud-db-access.ps1''s design), rollback is: restore the EXACT pre-change SDDL recorded in AncestorChain[].AclSnapshot.Sddl above for each touched node.'
        Blockers = @($blockers)
        OverallStatus = $overallStatus
    }

    if (-not [System.IO.Directory]::Exists($ReportDirectory)) { [System.IO.Directory]::CreateDirectory($ReportDirectory) | Out-Null }
    [System.IO.Directory]::SetAccessControl($ReportDirectory, (New-AdminOnlySecurity $true))
    $timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
    $suffix = [Guid]::NewGuid().ToString('N').Substring(0, 8)
    $fileName = "file-agent-attestation-store-access-preview-$timestamp-$suffix.json"
    $finalPath = Join-Path $ReportDirectory $fileName
    $json = $output | ConvertTo-Json -Depth 14
    [System.IO.File]::WriteAllText($finalPath, $json, [System.Text.UTF8Encoding]::new($false))
    Set-AdminOnlyFileSecurity $finalPath
    $reportHash = (Get-FileHash -LiteralPath $finalPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $sidecarPath = "$finalPath.sha256"
    [System.IO.File]::WriteAllText($sidecarPath, "$reportHash  $fileName", [System.Text.UTF8Encoding]::new($false))
    Set-AdminOnlyFileSecurity $sidecarPath

    Write-Output ([ordered]@{
        SchemaVersion = 'hasarbotu-file-agent-attestation-store-access-preview-wrapper/1.0.0'
        ReadOnly = $true
        OverallStatus = $output.OverallStatus
        ServiceAccountName = $ServiceAccountName
        AncestorChainSummary = @($output.AncestorChain | ForEach-Object { [ordered]@{ Path = $_.Path; CurrentlyGranted = $_.CurrentlyGranted; Reason = $_.Reason } })
        PlannedAceCount = @($plannedAces).Count
        Blockers = @($blockers)
        Report = [ordered]@{ FileName = $fileName; Sha256 = $reportHash; AdminOnly = $true }
    } | ConvertTo-Json -Depth 6)
    exit 0
}
catch {
    $safeError = [ordered]@{
        SchemaVersion = 'hasarbotu-file-agent-attestation-store-access-preview-wrapper/1.0.0'
        Status = 'error'
        ReadOnly = $true
        ErrorCode = if ($null -ne $_.Exception.Data -and $_.Exception.Data.Contains('SafeCode')) { [string]$_.Exception.Data['SafeCode'] } else { 'FILE_AGENT_ATTESTATION_STORE_ACCESS_PREVIEW_RUNTIME_ERROR' }
        ErrorType = $_.Exception.GetType().Name
        ErrorLine = $_.InvocationInfo.ScriptLineNumber
    }
    $safeError | ConvertTo-Json -Depth 4
    exit 1
}
