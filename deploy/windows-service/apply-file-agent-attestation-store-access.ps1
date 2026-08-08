[CmdletBinding(DefaultParameterSetName = 'Apply')]
param(
    [Parameter(ParameterSetName = 'Apply', Mandatory)]
    [Parameter(ParameterSetName = 'DryRun', Mandatory)]
    [string]$PreviewReportPath,

    [Parameter(ParameterSetName = 'Apply', Mandatory)]
    [Parameter(ParameterSetName = 'DryRun', Mandatory)]
    [ValidatePattern('^[a-fA-F0-9]{64}$')]
    [string]$PreviewReportSha256,

    [Parameter(ParameterSetName = 'Apply')]
    [Parameter(ParameterSetName = 'DryRun')]
    [string]$ServiceAccountName = 'svc-hb-fileagent',

    [Parameter(ParameterSetName = 'Apply')]
    [switch]$Apply,

    [Parameter(ParameterSetName = 'Rollback', Mandatory)]
    [switch]$Rollback,

    [Parameter(ParameterSetName = 'Rollback', Mandatory)]
    [string]$ApplyEvidenceReportPath,

    [Parameter(ParameterSetName = 'Rollback', Mandatory)]
    [ValidatePattern('^[a-fA-F0-9]{64}$')]
    [string]$ApplyEvidenceReportSha256
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# File Agent -> attestation store minimum READ-ONLY ACL -- APPLY + ROLLBACK
# (HB-2026-172, follow-up to the HB-2026-169 plan+preview). Same discipline
# and structure as apply-file-agent-pcloud-db-access.ps1 (HB-2026-164),
# adapted for the attestation store (a folder of many small per-file
# attestation records, not a fixed 3-file DB set).
#
# This tool NEVER invents its own ACE list: it only ever applies the EXACT
# PlannedMinimumAces array from an already-produced, hash-verified
# preview-file-agent-attestation-store-access.ps1 report (HB-2026-169).
# Every ACE is independently re-validated against a hard-coded rights
# WHITELIST (Traverse | Read | Synchronize) before being applied --
# Write/Modify/Delete/Create/AppendData/TakeOwnership/ChangePermissions are
# structurally impossible to apply through this tool.
#
# Model (AGENTS.md SS7): Planla (HB-2026-169 preview) -> Onizle (this
# script without -Apply: fully re-validates + re-scans, applies nothing)
# -> Onay (user passes -Apply) -> Uygula -> Dogrula (post-apply ACL re-read
# + a real inheritance-to-a-new-file proof + SID-simulation Read=yes/
# Write=no) -> Kesinlestir (evidence report) -> Audit (admin-only hashed
# report, every phase).
#
# Fail-closed at every stage (same as HB-2026-164):
#   - Preview report must be Administrators-only + hash-verified.
#   - Every planned ACE must survive the rights whitelist, Identity match,
#     AccessControlType=Allow, and independently-recomputed-chain path
#     checks -- ANY violation aborts with zero mutation.
#   - The ORIGINAL preview script is re-invoked FRESH, right here, right
#     now -- if its fresh plan does not exactly match the report's plan,
#     abort (PREVIEW_DRIFT_SINCE_REPORT).
#   - Every node's CURRENT real ACL is compared, node by node, against the
#     SDDL the preview report recorded as ITS baseline -- any difference
#     aborts with zero mutation (ACL_DRIFT_SINCE_PREVIEW_REPORT).
#   - Apply only ADDS the validated ACEs (AddAccessRule) -- never resets or
#     replaces the existing ACL.
#   - Any failure partway through Apply rolls back every already-applied
#     change, in reverse order, by restoring the EXACT pre-apply SDDL.
#   - Post-apply, a REAL (not simulated) inheritance proof is run: a
#     throwaway file is created inside the attestation store folder,
#     confirmed to have inherited the service-account Read ACE, then
#     deleted -- proving every FUTURE attestation record file will be
#     readable without a new per-file grant.
#   - Post-apply, a SID/effective-access SIMULATION (same model as the
#     preview tool) is run against the store folder's own real post-apply
#     ACL, proving Read is granted and no write/delete/ownership bit is
#     granted. If any existing attestation record files are already
#     present, the SAME simulation is additionally run against each of
#     them directly (best-effort, informational -- the folder-level check
#     is what gates rollback, since a store with zero files today is a
#     normal, valid state).
#   - Post-apply, the rollback PACKAGE itself is re-read through the exact
#     hash-verified path a separate -Rollback invocation would use, and
#     its schema is confirmed complete -- WITHOUT executing a rollback.

$AdministratorSidValue = 'S-1-5-32-544'
$AuthenticatedUsersSidValue = 'S-1-5-11'
$EveryoneSidValue = 'S-1-1-0'
$ReportDirectory = 'C:\ProgramData\HasarBotu\migration-preflight'
$AllowedRightsMask = [int64](
    [System.Security.AccessControl.FileSystemRights]::Traverse -bor
    [System.Security.AccessControl.FileSystemRights]::Read -bor
    [System.Security.AccessControl.FileSystemRights]::Synchronize
)
$ForbiddenRightsMask = [int64](
    # NOTE: FullControl is deliberately NOT OR'd in here -- see
    # apply-file-agent-pcloud-db-access.ps1's identical note (a COMBINED
    # flag would overlap with the allowed bits and reject legitimate Read
    # ACEs too).
    [System.Security.AccessControl.FileSystemRights]::WriteData -bor
    [System.Security.AccessControl.FileSystemRights]::AppendData -bor
    [System.Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
    [System.Security.AccessControl.FileSystemRights]::WriteAttributes -bor
    [System.Security.AccessControl.FileSystemRights]::Delete -bor
    [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
    [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
    [System.Security.AccessControl.FileSystemRights]::TakeOwnership
)

function Throw-SafeApplyError {
    param([string]$Code)
    $exception = [System.InvalidOperationException]::new($Code)
    $exception.Data['SafeCode'] = $Code
    throw $exception
}

function Test-AdministratorsOnlyFile {
    param([string]$Path)
    try {
        if (-not [System.IO.File]::Exists($Path)) { return $false }
        $acl = Get-Acl -LiteralPath $Path
        if (-not $acl.AreAccessRulesProtected) { return $false }
        $ownerSid = ([System.Security.Principal.NTAccount]$acl.Owner).Translate([System.Security.Principal.SecurityIdentifier]).Value
        if ($ownerSid -ne $AdministratorSidValue) { return $false }
        $rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
        if ($rules.Count -ne 1) { return $false }
        $rule = $rules[0]
        $fullControl = [System.Security.AccessControl.FileSystemRights]::FullControl
        return (
            $rule.IdentityReference.Value -eq $AdministratorSidValue -and
            $rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
            -not $rule.IsInherited -and
            ($rule.FileSystemRights -band $fullControl) -eq $fullControl
        )
    }
    catch { return $false }
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
    if (-not (Test-AdminOnlyAcl $Path $false)) { Throw-SafeApplyError 'ADMIN_ONLY_ACL_APPLY_FAILED' }
}

function Read-HashVerifiedReport {
    param([string]$Path, [string]$ExpectedSha256, [string]$MissingCode, [string]$HashMismatchCode, [string]$InvalidJsonCode)
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    if (-not (Test-AdministratorsOnlyFile $fullPath)) { Throw-SafeApplyError $MissingCode }
    $actualHash = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $ExpectedSha256.ToLowerInvariant()) { Throw-SafeApplyError $HashMismatchCode }
    try {
        return [System.IO.File]::ReadAllText($fullPath) | ConvertFrom-Json
    }
    catch {
        Throw-SafeApplyError $InvalidJsonCode
    }
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
            FileSystemRightsValue = [int64]$_.FileSystemRights
            AccessControlType = $_.AccessControlType.ToString()
            IsInherited = $_.IsInherited
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

function Restore-NodeSddl {
    # Exact rollback primitive: rebuild a fresh security object from a
    # PREVIOUSLY-RECORDED Sddl string and apply it wholesale.
    param([string]$Path, [bool]$IsDirectory, [string]$Sddl)
    if ($IsDirectory) {
        if ($Path -match '^[A-Za-z]:$') { $Path = "$Path\" }
        $security = [System.Security.AccessControl.DirectorySecurity]::new()
        $security.SetSecurityDescriptorSddlForm($Sddl)
        [System.IO.Directory]::SetAccessControl($Path, $security)
    }
    else {
        $security = [System.Security.AccessControl.FileSecurity]::new()
        $security.SetSecurityDescriptorSddlForm($Sddl)
        [System.IO.File]::SetAccessControl($Path, $security)
    }
}

function Write-AdminOnlyEvidence {
    param([string]$NamePrefix, [object]$ReportObject)
    if (-not [System.IO.Directory]::Exists($ReportDirectory)) { [System.IO.Directory]::CreateDirectory($ReportDirectory) | Out-Null }
    [System.IO.Directory]::SetAccessControl($ReportDirectory, (New-AdminOnlySecurity $true))
    $timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
    $suffix = [Guid]::NewGuid().ToString('N').Substring(0, 8)
    $fileName = "$NamePrefix-$timestamp-$suffix.json"
    $finalPath = Join-Path $ReportDirectory $fileName
    $json = $ReportObject | ConvertTo-Json -Depth 16
    [System.IO.File]::WriteAllText($finalPath, $json, [System.Text.UTF8Encoding]::new($false))
    Set-AdminOnlyFileSecurity $finalPath
    $reportHash = (Get-FileHash -LiteralPath $finalPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $sidecarPath = "$finalPath.sha256"
    [System.IO.File]::WriteAllText($sidecarPath, "$reportHash  $fileName", [System.Text.UTF8Encoding]::new($false))
    Set-AdminOnlyFileSecurity $sidecarPath
    return [ordered]@{ FileName = $fileName; Sha256 = $reportHash; AdminOnly = $true }
}

function Test-AceWithinWhitelist {
    param([int64]$RightsValue)
    if (($RightsValue -band $ForbiddenRightsMask) -ne 0) { return $false }
    if (($RightsValue -band (-bnot $AllowedRightsMask)) -ne 0) { return $false }
    return $true
}

function Test-SimulatedEffectiveAccess {
    param($AclSnapshot, [string]$TargetSid, [int64]$RequiredRightsValue)
    if ($null -eq $AclSnapshot) {
        return [ordered]@{ Granted = $false; Reason = 'NODE_NOT_FOUND' }
    }
    $relevantSids = @($TargetSid, $AuthenticatedUsersSidValue, $EveryoneSidValue)
    $matching = @($AclSnapshot.Aces | Where-Object { $relevantSids -contains $_.IdentitySid })
    $explicitDeny = @($matching | Where-Object { $_.AccessControlType -eq 'Deny' -and -not $_.IsInherited -and ([int64]$_.FileSystemRightsValue -band $RequiredRightsValue) -ne 0 })
    if ($explicitDeny.Count -gt 0) {
        return [ordered]@{ Granted = $false; Reason = 'EXPLICIT_DENY_PRESENT' }
    }
    $grantedBits = 0
    foreach ($ace in ($matching | Where-Object { $_.AccessControlType -eq 'Allow' })) {
        $grantedBits = $grantedBits -bor [int64]$ace.FileSystemRightsValue
    }
    $granted = (($grantedBits -band $RequiredRightsValue) -eq $RequiredRightsValue)
    return [ordered]@{ Granted = $granted; Reason = if ($granted) { 'ALLOW_ACE_COVERS_REQUIRED_RIGHTS' } else { 'NO_MATCHING_GRANT' } }
}

function Test-SimulatedForbiddenAccessAbsent {
    param($AclSnapshot, [string]$TargetSid, [int64]$ForbiddenRightsMask)
    if ($null -eq $AclSnapshot) {
        return [ordered]@{ ForbiddenAccessGranted = $false; Reason = 'NODE_NOT_FOUND' }
    }
    $relevantSids = @($TargetSid, $AuthenticatedUsersSidValue, $EveryoneSidValue)
    $matching = @($AclSnapshot.Aces | Where-Object { $relevantSids -contains $_.IdentitySid })
    $denyBits = 0
    foreach ($ace in ($matching | Where-Object { $_.AccessControlType -eq 'Deny' -and -not $_.IsInherited })) { $denyBits = $denyBits -bor [int64]$ace.FileSystemRightsValue }
    $allowBits = 0
    foreach ($ace in ($matching | Where-Object { $_.AccessControlType -eq 'Allow' })) { $allowBits = $allowBits -bor [int64]$ace.FileSystemRightsValue }
    $effectiveBits = $allowBits -band (-bnot $denyBits)
    $forbiddenGranted = (($effectiveBits -band $ForbiddenRightsMask) -ne 0)
    return [ordered]@{ ForbiddenAccessGranted = $forbiddenGranted; Reason = if ($forbiddenGranted) { 'FORBIDDEN_BIT_EFFECTIVELY_GRANTED' } else { 'NO_FORBIDDEN_BIT_GRANTED' } }
}

try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [System.Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Throw-SafeApplyError 'ADMINISTRATOR_REQUIRED'
    }

    if ($Rollback) {
        $evidence = Read-HashVerifiedReport -Path $ApplyEvidenceReportPath -ExpectedSha256 $ApplyEvidenceReportSha256 `
            -MissingCode 'APPLY_EVIDENCE_ADMIN_ACL_REQUIRED' -HashMismatchCode 'APPLY_EVIDENCE_HASH_MISMATCH' -InvalidJsonCode 'APPLY_EVIDENCE_JSON_INVALID'
        if ($evidence.SchemaVersion -ne 'hasarbotu-file-agent-attestation-store-access-apply/1.0.0') { Throw-SafeApplyError 'APPLY_EVIDENCE_SCHEMA_INVALID' }
        if ($evidence.Applied -ne $true) { Throw-SafeApplyError 'APPLY_EVIDENCE_WAS_NOT_A_SUCCESSFUL_APPLY' }

        $rollbackResults = @()
        foreach ($node in $evidence.PreApplySnapshots) {
            $isDir = $node.IsDirectory
            $before = Get-NodeAclSnapshot -Path $node.Path -IsDirectory $isDir
            Restore-NodeSddl -Path $node.Path -IsDirectory $isDir -Sddl $node.Sddl
            $after = Get-NodeAclSnapshot -Path $node.Path -IsDirectory $isDir
            $restoredExactly = ($null -ne $after -and $after.Sddl -eq $node.Sddl)
            $rollbackResults += [ordered]@{
                Path = $node.Path
                SddlBeforeRollback = if ($before) { $before.Sddl } else { $null }
                TargetSddl = $node.Sddl
                SddlAfterRollback = if ($after) { $after.Sddl } else { $null }
                RestoredExactly = $restoredExactly
            }
            if (-not $restoredExactly) { Throw-SafeApplyError "ROLLBACK_NODE_MISMATCH_$([System.IO.Path]::GetFileName($node.Path))" }
        }

        $rollbackReport = [ordered]@{
            SchemaVersion = 'hasarbotu-file-agent-attestation-store-access-rollback/1.0.0'
            GeneratedAtUtc = [DateTime]::UtcNow.ToString('o')
            SourceApplyEvidenceFile = [System.IO.Path]::GetFileName([System.IO.Path]::GetFullPath($ApplyEvidenceReportPath))
            SourceApplyEvidenceSha256 = $ApplyEvidenceReportSha256.ToLowerInvariant()
            Nodes = $rollbackResults
            AllNodesRestoredExactly = -not @($rollbackResults | Where-Object { -not $_.RestoredExactly })
        }
        $reportRef = Write-AdminOnlyEvidence -NamePrefix 'file-agent-attestation-store-access-rollback' -ReportObject $rollbackReport
        Write-Output ([ordered]@{
            SchemaVersion = 'hasarbotu-file-agent-attestation-store-access-rollback-wrapper/1.0.0'
            Mode = 'rollback'
            AllNodesRestoredExactly = $rollbackReport.AllNodesRestoredExactly
            NodeCount = @($rollbackResults).Count
            Report = $reportRef
        } | ConvertTo-Json -Depth 6)
        exit 0
    }

    # --- Apply / DryRun shared path ---
    $previewReportFullPath = [System.IO.Path]::GetFullPath($PreviewReportPath)
    $report = Read-HashVerifiedReport -Path $previewReportFullPath -ExpectedSha256 $PreviewReportSha256 `
        -MissingCode 'PREVIEW_REPORT_ADMIN_ACL_REQUIRED' -HashMismatchCode 'PREVIEW_REPORT_HASH_MISMATCH' -InvalidJsonCode 'PREVIEW_REPORT_JSON_INVALID'
    if ($report.SchemaVersion -ne 'hasarbotu-file-agent-attestation-store-access-preview/1.0.0') { Throw-SafeApplyError 'PREVIEW_REPORT_SCHEMA_INVALID' }
    if ($report.ServiceAccountName -ne $ServiceAccountName) { Throw-SafeApplyError 'PREVIEW_REPORT_SERVICE_ACCOUNT_MISMATCH' }
    if ($report.OverallStatus -eq 'blocked') { Throw-SafeApplyError 'PREVIEW_REPORT_STATUS_BLOCKED' }
    $plannedAces = @($report.PlannedMinimumAces)
    if ($report.OverallStatus -eq 'already_sufficient' -or $plannedAces.Count -eq 0) {
        Write-Output ([ordered]@{
            SchemaVersion = 'hasarbotu-file-agent-attestation-store-access-apply-wrapper/1.0.0'
            Mode = if ($Apply) { 'apply' } else { 'dry-run' }
            OverallStatus = 'nothing_to_apply'
        } | ConvertTo-Json -Depth 4)
        exit 0
    }

    # 1) Structural whitelist validation of every planned ACE -- BEFORE
    #    touching anything, before even re-running preview.
    $expectedStorePath = [System.IO.Path]::GetFullPath($report.AttestationStoreDirectory).TrimEnd('\')
    foreach ($ace in $plannedAces) {
        if ($ace.AccessControlType -ne 'Allow') { Throw-SafeApplyError 'PLANNED_ACE_NOT_ALLOW_TYPE' }
        if ($ace.Identity -ne $ServiceAccountName) { Throw-SafeApplyError 'PLANNED_ACE_IDENTITY_MISMATCH' }
        if (-not (Test-AceWithinWhitelist -RightsValue ([int64]$ace.RightsValue))) { Throw-SafeApplyError 'PLANNED_ACE_OUTSIDE_WHITELIST' }
        $rawAcePath = [string]$ace.Path
        if ($rawAcePath -match '^[A-Za-z]:$') { $rawAcePath = "$rawAcePath\" }
        $acePath = [System.IO.Path]::GetFullPath($rawAcePath).TrimEnd('\')
        $isUnderStoreChain = ($acePath -eq $expectedStorePath) -or
            $expectedStorePath.StartsWith("$acePath\", [StringComparison]::OrdinalIgnoreCase) -or
            ($acePath.Length -eq 2 -and $acePath -match '^[A-Za-z]:$' -and $expectedStorePath.StartsWith($acePath, [StringComparison]::OrdinalIgnoreCase))
        if (-not $isUnderStoreChain) { Throw-SafeApplyError 'PLANNED_ACE_PATH_OUTSIDE_EXPECTED_CHAIN' }
    }

    # 2) Re-run the ORIGINAL, unmodified preview script FRESH, right now.
    $previewScriptPath = Join-Path $PSScriptRoot 'preview-file-agent-attestation-store-access.ps1'
    if (-not [System.IO.File]::Exists($previewScriptPath)) { Throw-SafeApplyError 'PREVIEW_SCRIPT_NOT_FOUND' }
    $freshOutputRaw = & $previewScriptPath -ServiceAccountName $ServiceAccountName -AttestationStoreDirectory $expectedStorePath 2>&1 | Out-String
    $freshWrapper = $null
    try { $freshWrapper = $freshOutputRaw | ConvertFrom-Json } catch { Throw-SafeApplyError 'FRESH_PREVIEW_OUTPUT_INVALID' }
    $freshHasStatusField = $null -ne $freshWrapper.PSObject.Properties['Status']
    if ($freshHasStatusField -and $freshWrapper.Status -eq 'error') { Throw-SafeApplyError "FRESH_PREVIEW_FAILED_$([string]$freshWrapper.ErrorCode)" }
    $freshReport = Read-HashVerifiedReport -Path (Join-Path $ReportDirectory $freshWrapper.Report.FileName) -ExpectedSha256 $freshWrapper.Report.Sha256 `
        -MissingCode 'FRESH_PREVIEW_REPORT_ADMIN_ACL_REQUIRED' -HashMismatchCode 'FRESH_PREVIEW_REPORT_HASH_MISMATCH' -InvalidJsonCode 'FRESH_PREVIEW_REPORT_JSON_INVALID'
    $freshAces = @($freshReport.PlannedMinimumAces)
    $originalAceKeys = @($plannedAces | ForEach-Object { "$($_.Path)|$($_.RightsValue)|$($_.InheritanceFlags)" } | Sort-Object)
    $freshAceKeys = @($freshAces | ForEach-Object { "$($_.Path)|$($_.RightsValue)|$($_.InheritanceFlags)" } | Sort-Object)
    if (($originalAceKeys -join "`n") -ne ($freshAceKeys -join "`n")) { Throw-SafeApplyError 'PREVIEW_DRIFT_SINCE_REPORT' }

    # 3) Fresh ACL snapshot of every touched node, compared against the
    #    ORIGINAL report's recorded baseline for that same node.
    $touchedPaths = @($plannedAces | ForEach-Object { $_.Path } | Select-Object -Unique)
    $originalBaselineByPath = @{}
    foreach ($entry in $report.AncestorChain) { $originalBaselineByPath[$entry.Path] = $entry.AclSnapshot }
    $freshSnapshotsBeforeApply = [ordered]@{}
    foreach ($path in $touchedPaths) {
        $freshSnapshotsBeforeApply[$path] = Get-NodeAclSnapshot -Path $path -IsDirectory $true
        $originalBaseline = $originalBaselineByPath[$path]
        # A node that did not exist yet at preview time (the store folder
        # itself, first run) has a null baseline AND currently does not
        # exist either -- that is a legitimate, expected match, not drift.
        if ($null -eq $freshSnapshotsBeforeApply[$path] -and $null -eq $originalBaseline) { continue }
        if ($null -eq $freshSnapshotsBeforeApply[$path]) { Throw-SafeApplyError "TOUCHED_NODE_NOT_FOUND_$([System.IO.Path]::GetFileName($path))" }
        if ($null -eq $originalBaseline) { Throw-SafeApplyError "NO_ORIGINAL_BASELINE_FOR_NODE_$([System.IO.Path]::GetFileName($path))" }
        if ($freshSnapshotsBeforeApply[$path].Sddl -ne $originalBaseline.Sddl) { Throw-SafeApplyError 'ACL_DRIFT_SINCE_PREVIEW_REPORT' }
    }

    if (-not $Apply) {
        Write-Output ([ordered]@{
            SchemaVersion = 'hasarbotu-file-agent-attestation-store-access-apply-wrapper/1.0.0'
            Mode = 'dry-run'
            OverallStatus = 'validated_ready_for_apply'
            PlannedAceCount = @($plannedAces).Count
            Note = 'Fresh preview re-verified, zero drift, all ACEs pass the rights whitelist. Nothing was applied (no -Apply switch given).'
        } | ConvertTo-Json -Depth 6)
        exit 0
    }

    # === -Apply from here on: this is the only point in the script where
    #     a real ACL mutation can occur. ===
    $appliedNodes = [System.Collections.Generic.List[object]]::new()
    $applyError = $null
    try {
        # The store folder itself may not exist yet (first-ever run before
        # any attestation was generated) -- create it, Administrators-only,
        # BEFORE applying the planned ACEs onto it, exactly as
        # generate-pcloud-source-attestation.ps1 would on its own first
        # write. If it already exists, this is a no-op read.
        if (-not [System.IO.Directory]::Exists($expectedStorePath)) {
            [System.IO.Directory]::CreateDirectory($expectedStorePath) | Out-Null
            [System.IO.Directory]::SetAccessControl($expectedStorePath, (New-AdminOnlySecurity $true))
        }

        foreach ($path in $touchedPaths) {
            $acesForThisPath = @($plannedAces | Where-Object { $_.Path -eq $path })
            $realPath = $(if ($path -match '^[A-Za-z]:$') { "$path\" } else { $path })
            $preApplySnapshot = Get-NodeAclSnapshot -Path $path -IsDirectory $true
            if ($null -eq $preApplySnapshot) { Throw-SafeApplyError "TOUCHED_NODE_MISSING_AT_APPLY_TIME_$([System.IO.Path]::GetFileName($path))" }
            $security = [System.IO.Directory]::GetAccessControl($realPath)
            foreach ($ace in $acesForThisPath) {
                $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
                    $ServiceAccountName,
                    [System.Security.AccessControl.FileSystemRights]([int64]$ace.RightsValue),
                    [System.Security.AccessControl.InheritanceFlags]$ace.InheritanceFlags,
                    [System.Security.AccessControl.PropagationFlags]$ace.PropagationFlags,
                    [System.Security.AccessControl.AccessControlType]::Allow)
                $security.AddAccessRule($rule)
            }
            [System.IO.Directory]::SetAccessControl($realPath, $security)
            $appliedNodes.Add([pscustomobject]@{ Path = $path; IsDirectory = $true; Sddl = $preApplySnapshot.Sddl })
        }

        # Post-apply confirmation: re-read each node, confirm the exact
        # planned rights are now present for the service account.
        $postApplySnapshots = [System.Collections.Generic.List[object]]::new()
        foreach ($path in $touchedPaths) {
            $after = Get-NodeAclSnapshot -Path $path -IsDirectory $true
            if ($null -eq $after) { Throw-SafeApplyError "POST_APPLY_NODE_NOT_FOUND_$([System.IO.Path]::GetFileName($path))" }
            $acesForThisPath = @($plannedAces | Where-Object { $_.Path -eq $path })
            $realPath = $(if ($path -match '^[A-Za-z]:$') { "$path\" } else { $path })
            $afterAcl = [System.IO.Directory]::GetAccessControl($realPath)
            $matchingRules = @($afterAcl.GetAccessRules($true, $false, [System.Security.Principal.SecurityIdentifier]) | Where-Object { $_.IdentityReference.Value -eq (([System.Security.Principal.NTAccount]$ServiceAccountName).Translate([System.Security.Principal.SecurityIdentifier]).Value) })
            foreach ($ace in $acesForThisPath) {
                $found = @($matchingRules | Where-Object { ([int64]$_.FileSystemRights -band [int64]$ace.RightsValue) -eq [int64]$ace.RightsValue -and $_.InheritanceFlags.ToString() -eq $ace.InheritanceFlags })
                if ($found.Count -eq 0) { Throw-SafeApplyError "POST_APPLY_ACE_NOT_CONFIRMED_$([System.IO.Path]::GetFileName($path))" }
            }
            $postApplySnapshots.Add([ordered]@{ Path = $path; Sddl = $after.Sddl; Aces = $after.Aces })
        }

        # Future-file inheritance continuity -- REAL proof, not a
        # simulation: create a throwaway file directly in the attestation
        # store folder, confirm it inherited the service-account Read ACE,
        # then delete it. Proves every future attestation record file will
        # be readable without a new per-file grant.
        $continuityTestName = "hasarbotu-attestation-store-continuity-test-$([Guid]::NewGuid().ToString('N').Substring(0,8)).tmp"
        $continuityTestPath = Join-Path $expectedStorePath $continuityTestName
        $continuityResult = [ordered]@{ TestFileName = $continuityTestName; Created = $false; InheritedReadAceFound = $false; Deleted = $false }
        try {
            [System.IO.File]::WriteAllText($continuityTestPath, 'hasarbotu-attestation-store-continuity-probe', [System.Text.UTF8Encoding]::new($false))
            $continuityResult.Created = $true
            $fileAcl = [System.IO.File]::GetAccessControl($continuityTestPath)
            $serviceSid = ([System.Security.Principal.NTAccount]$ServiceAccountName).Translate([System.Security.Principal.SecurityIdentifier]).Value
            $inheritedRule = @($fileAcl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | Where-Object { $_.IdentityReference.Value -eq $serviceSid -and $_.IsInherited -eq $true -and ([int64]$_.FileSystemRights -band [int64][System.Security.AccessControl.FileSystemRights]::Read) -eq [int64][System.Security.AccessControl.FileSystemRights]::Read })
            $continuityResult.InheritedReadAceFound = ($inheritedRule.Count -gt 0)
        }
        finally {
            if ([System.IO.File]::Exists($continuityTestPath)) {
                [System.IO.File]::Delete($continuityTestPath)
                $continuityResult.Deleted = -not [System.IO.File]::Exists($continuityTestPath)
            }
        }
        if (-not $continuityResult.InheritedReadAceFound) { Throw-SafeApplyError 'ATTESTATION_STORE_CONTINUITY_INHERITANCE_NOT_CONFIRMED' }

        # SID/effective-access simulation against the store folder's own
        # REAL post-apply ACL (mandatory, gates rollback) plus, best-effort,
        # against any attestation record files (*.json / *.sha256) already
        # present in the store today -- proving Read is granted AND no
        # write/delete/ownership bit is granted, on real, already-existing
        # files, not just newly-created ones.
        $readRights = [int64]([System.Security.AccessControl.FileSystemRights]::Read -bor [System.Security.AccessControl.FileSystemRights]::Synchronize)
        $serviceSidForSimulation = ([System.Security.Principal.NTAccount]$ServiceAccountName).Translate([System.Security.Principal.SecurityIdentifier]).Value
        $storeSnapshotAfterApply = Get-NodeAclSnapshot -Path $expectedStorePath -IsDirectory $true
        $storeReadCheck = Test-SimulatedEffectiveAccess -AclSnapshot $storeSnapshotAfterApply -TargetSid $serviceSidForSimulation -RequiredRightsValue $readRights
        $storeForbiddenCheck = Test-SimulatedForbiddenAccessAbsent -AclSnapshot $storeSnapshotAfterApply -TargetSid $serviceSidForSimulation -ForbiddenRightsMask $ForbiddenRightsMask
        if (-not $storeReadCheck.Granted) { Throw-SafeApplyError 'STORE_FOLDER_READ_NOT_CONFIRMED_BY_SIMULATION' }
        if ($storeForbiddenCheck.ForbiddenAccessGranted) { Throw-SafeApplyError 'STORE_FOLDER_FORBIDDEN_ACCESS_GRANTED_BY_SIMULATION' }

        $existingFileSimulationResults = [System.Collections.Generic.List[object]]::new()
        $existingFiles = @(Get-ChildItem -LiteralPath $expectedStorePath -File -ErrorAction SilentlyContinue)
        foreach ($file in $existingFiles) {
            $snapshot = Get-NodeAclSnapshot -Path $file.FullName -IsDirectory $false
            $readCheck = Test-SimulatedEffectiveAccess -AclSnapshot $snapshot -TargetSid $serviceSidForSimulation -RequiredRightsValue $readRights
            $forbiddenCheck = Test-SimulatedForbiddenAccessAbsent -AclSnapshot $snapshot -TargetSid $serviceSidForSimulation -ForbiddenRightsMask $ForbiddenRightsMask
            $existingFileSimulationResults.Add([ordered]@{
                Path = $file.FullName
                ReadGranted = $readCheck.Granted
                ReadReason = $readCheck.Reason
                ForbiddenAccessGranted = $forbiddenCheck.ForbiddenAccessGranted
                ForbiddenAccessReason = $forbiddenCheck.Reason
            })
        }
        $existingFileMismatches = @($existingFileSimulationResults | Where-Object { -not $_.ReadGranted -or $_.ForbiddenAccessGranted })
        if ($existingFileMismatches.Count -gt 0) { Throw-SafeApplyError 'EXISTING_ATTESTATION_FILE_ACCESS_MISMATCH' }

        $applyReport = [ordered]@{
            SchemaVersion = 'hasarbotu-file-agent-attestation-store-access-apply/1.0.0'
            GeneratedAtUtc = [DateTime]::UtcNow.ToString('o')
            Applied = $true
            ServiceAccountName = $ServiceAccountName
            SourcePreviewReport = [System.IO.Path]::GetFileName($previewReportFullPath)
            SourcePreviewReportSha256 = $PreviewReportSha256.ToLowerInvariant()
            FreshPreviewReportAtApplyTime = $freshWrapper.Report
            PlannedAces = $plannedAces
            PreApplySnapshots = @($appliedNodes | ForEach-Object { [ordered]@{ Path = $_.Path; IsDirectory = $_.IsDirectory; Sddl = $_.Sddl } })
            PostApplySnapshots = @($postApplySnapshots)
            ContinuityInheritanceTest = $continuityResult
            StoreFolderEffectiveAccessSimulation = [ordered]@{
                ReadGranted = $storeReadCheck.Granted
                ReadReason = $storeReadCheck.Reason
                ForbiddenAccessGranted = $storeForbiddenCheck.ForbiddenAccessGranted
                ForbiddenAccessReason = $storeForbiddenCheck.Reason
            }
            ExistingAttestationFileEffectiveAccessSimulation = @($existingFileSimulationResults)
        }
        $reportRef = Write-AdminOnlyEvidence -NamePrefix 'file-agent-attestation-store-access-apply' -ReportObject $applyReport

        # Verify the rollback PACKAGE itself is genuinely usable -- same
        # model as HB-2026-164: re-read via the exact hash-verified path a
        # separate -Rollback invocation would use, confirm schema
        # completeness, do NOT execute a rollback here.
        $rollbackPackageCheck = [ordered]@{ Verified = $false; Detail = $null }
        $reEvidence = Read-HashVerifiedReport -Path (Join-Path $ReportDirectory $reportRef.FileName) -ExpectedSha256 $reportRef.Sha256 `
            -MissingCode 'ROLLBACK_PACKAGE_ADMIN_ACL_REQUIRED' -HashMismatchCode 'ROLLBACK_PACKAGE_HASH_MISMATCH' -InvalidJsonCode 'ROLLBACK_PACKAGE_JSON_INVALID'
        $preApplyCount = @($reEvidence.PreApplySnapshots).Count
        $hasAllSddl = -not @($reEvidence.PreApplySnapshots | Where-Object { [string]::IsNullOrWhiteSpace($_.Sddl) })
        if ($reEvidence.SchemaVersion -eq 'hasarbotu-file-agent-attestation-store-access-apply/1.0.0' -and $reEvidence.Applied -eq $true -and $preApplyCount -eq @($touchedPaths).Count -and $hasAllSddl) {
            $rollbackPackageCheck.Verified = $true
            $rollbackPackageCheck.Detail = "Re-read via the exact hash-verified path -Rollback uses; $preApplyCount pre-apply SDDL snapshot(s) present, schema valid. Rollback NOT executed here (would undo the grant just applied)."
        }
        else {
            Throw-SafeApplyError 'ROLLBACK_PACKAGE_SCHEMA_INCOMPLETE'
        }
        $rollbackPackageCheckReport = [ordered]@{
            SchemaVersion = 'hasarbotu-file-agent-attestation-store-access-rollback-package-check/1.0.0'
            GeneratedAtUtc = [DateTime]::UtcNow.ToString('o')
            SourceApplyEvidenceFile = $reportRef.FileName
            SourceApplyEvidenceSha256 = $reportRef.Sha256
            Verified = $rollbackPackageCheck.Verified
            Detail = $rollbackPackageCheck.Detail
        }
        $rollbackPackageCheckRef = Write-AdminOnlyEvidence -NamePrefix 'file-agent-attestation-store-access-rollback-package-check' -ReportObject $rollbackPackageCheckReport

        Write-Output ([ordered]@{
            SchemaVersion = 'hasarbotu-file-agent-attestation-store-access-apply-wrapper/1.0.0'
            Mode = 'apply'
            OverallStatus = 'applied'
            AppliedAceCount = @($plannedAces).Count
            ContinuityInheritanceConfirmed = $continuityResult.InheritedReadAceFound
            StoreFolderReadGranted = $storeReadCheck.Granted
            StoreFolderForbiddenAccessGranted = $storeForbiddenCheck.ForbiddenAccessGranted
            ExistingAttestationFileCount = @($existingFileSimulationResults).Count
            RollbackPackageVerified = $rollbackPackageCheck.Verified
            RollbackPackageCheckReport = $rollbackPackageCheckRef
            Report = $reportRef
        } | ConvertTo-Json -Depth 10)
        exit 0
    }
    catch {
        $applyError = $_
        # Roll back every already-applied node, in reverse order, to its
        # exact pre-apply SDDL.
        $rollbackOnFailureResults = @()
        for ($i = $appliedNodes.Count - 1; $i -ge 0; $i--) {
            $node = $appliedNodes[$i]
            try {
                Restore-NodeSddl -Path $node.Path -IsDirectory $node.IsDirectory -Sddl $node.Sddl
                $rollbackOnFailureResults += [ordered]@{ Path = $node.Path; RolledBack = $true }
            }
            catch {
                $rollbackOnFailureResults += [ordered]@{ Path = $node.Path; RolledBack = $false; RollbackError = $_.Exception.Message }
            }
        }
        $failureReport = [ordered]@{
            SchemaVersion = 'hasarbotu-file-agent-attestation-store-access-apply/1.0.0'
            GeneratedAtUtc = [DateTime]::UtcNow.ToString('o')
            Applied = $false
            ServiceAccountName = $ServiceAccountName
            ErrorCode = if ($null -ne $applyError.Exception.Data -and $applyError.Exception.Data.Contains('SafeCode')) { [string]$applyError.Exception.Data['SafeCode'] } else { 'APPLY_RUNTIME_ERROR' }
            ErrorMessage = $applyError.Exception.Message
            AutoRollback = $rollbackOnFailureResults
            AllAutoRolledBack = -not @($rollbackOnFailureResults | Where-Object { -not $_.RolledBack })
        }
        Write-AdminOnlyEvidence -NamePrefix 'file-agent-attestation-store-access-apply-failed' -ReportObject $failureReport | Out-Null
        throw
    }
}
catch {
    $safeError = [ordered]@{
        SchemaVersion = 'hasarbotu-file-agent-attestation-store-access-apply-wrapper/1.0.0'
        Status = 'error'
        ErrorCode = if ($null -ne $_.Exception.Data -and $_.Exception.Data.Contains('SafeCode')) { [string]$_.Exception.Data['SafeCode'] } else { 'FILE_AGENT_ATTESTATION_STORE_ACCESS_APPLY_RUNTIME_ERROR' }
        ErrorType = $_.Exception.GetType().Name
        ErrorLine = $_.InvocationInfo.ScriptLineNumber
    }
    $safeError | ConvertTo-Json -Depth 4
    exit 1
}
