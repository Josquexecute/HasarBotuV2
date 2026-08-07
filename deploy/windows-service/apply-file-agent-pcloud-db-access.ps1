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

# File Agent -> pCloud local DB cross-account READ-ONLY access -- APPLY +
# ROLLBACK (HB-2026-164, follow-up to the HB-2026-163 plan+preview).
#
# This tool NEVER invents its own ACE list: it only ever applies the EXACT
# PlannedMinimumAces array from an already-produced, hash-verified
# preview-file-agent-pcloud-db-access.ps1 report (HB-2026-163). Every ACE
# from that report is independently re-validated against a hard-coded
# rights WHITELIST (Traverse | ReadData | ReadAttributes |
# ReadExtendedAttributes | ReadPermissions | Synchronize) before being
# applied -- Write/Modify/Delete/Create/AppendData/TakeOwnership/
# ChangePermissions are structurally impossible to apply through this tool
# (checked bit-by-bit, not just by trusting the source report).
#
# Model (AGENTS.md SS7): Planla (the earlier preview) -> Onizle (this
# script without -Apply: fully re-validates + re-scans, applies nothing)
# -> Onay (user passes -Apply) -> Uygula -> Dogrula (post-apply ACL
# re-read + a real NTFS-inheritance proof) -> Kesinlestir (evidence
# report) -> Audit (admin-only hashed report, every phase).
#
# Fail-closed at every stage:
#   - Preview report must be Administrators-only + hash-verified.
#   - Every planned ACE must survive the rights whitelist, Identity match,
#     AccessControlType=Allow, and independently-recomputed-chain path
#     checks -- ANY violation aborts with zero mutation.
#   - The ORIGINAL preview script is re-invoked FRESH, right here, right
#     now -- if its fresh plan does not exactly match the report's plan,
#     abort (PREVIEW_DRIFT_SINCE_REPORT). This is a real subprocess call
#     to the same, unmodified preview tool -- not a re-implementation that
#     could silently diverge from it.
#   - Every node's CURRENT real ACL is compared, node by node, against the
#     SDDL the preview report recorded as ITS baseline -- any difference
#     aborts with zero mutation (ACL_DRIFT_SINCE_PREVIEW_REPORT).
#   - Apply only ADDS the validated ACEs (AddAccessRule) -- never resets
#     or replaces the existing ACL (SetAccessRuleProtection is never
#     called against a real target node in Apply mode).
#   - Any failure partway through Apply rolls back every already-applied
#     change, in reverse order, by restoring the EXACT pre-apply SDDL
#     captured moments earlier (byte-for-byte, not "guess which ACE to
#     remove").
#   - Post-apply, a REAL (not simulated) NTFS-inheritance proof is run: a
#     throwaway file is created inside the pCloud folder as Administrator,
#     its ACL is checked for the inherited service-account Read entry,
#     then it is deleted -- this is the exact mechanism WAL/SHM
#     regeneration continuity depends on, proven directly rather than
#     assumed. Failure here triggers the same rollback.
#   - Post-apply, real Scheduled-Task-based verification IN THE SERVICE
#     ACCOUNT'S OWN SECURITY CONTEXT is attempted (mirrors the proven
#     probe-p-drive-system-context.ps1 pattern). On THIS class of machine
#     this was found, by direct real testing, to require either
#     SeBatchLogonRight (currently absent -- svc-hb-fileagent only has
#     SeServiceLogonRight per HB-2026-113) or the File Agent Windows
#     service itself being enabled/started (blocked on D9 progress) --
#     NEITHER of which this tool grants or performs, since both are
#     changes outside the "exactly these 6 ACEs" mandate and need their
#     own explicit decision. If the real context test cannot run for this
#     reason, that is reported honestly as PARTIAL, not silently skipped
#     or faked as success; it does NOT roll back the (independently
#     confirmed correct) ACL changes.

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
    # NOTE: FullControl is deliberately NOT OR'd in here -- it is a
    # COMBINED flag that already includes ReadData/ReadAttributes/etc, so
    # including it would make this mask overlap with the ALLOWED bits and
    # reject every legitimate Read ACE too (confirmed by a real test
    # failure while building this tool). The individual write/delete/
    # ownership bits below, plus the separate "any bit outside the allowed
    # set" check in Test-AceWithinWhitelist, already catch a FullControl-
    # sized (or any other too-broad) grant correctly.
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
    return [ordered]@{
        Path = $Path
        Owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
        AreAccessRulesProtected = $acl.AreAccessRulesProtected
        Sddl = $acl.GetSecurityDescriptorSddlForm([System.Security.AccessControl.AccessControlSections]::Access -bor [System.Security.AccessControl.AccessControlSections]::Owner)
    }
}

function Restore-NodeSddl {
    # Exact rollback primitive: rebuild a fresh security object from a
    # PREVIOUSLY-RECORDED Sddl string and apply it wholesale -- restores
    # the precise pre-change state rather than attempting to identify and
    # remove only the ACEs this tool itself added.
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
        if ($evidence.SchemaVersion -ne 'hasarbotu-file-agent-pcloud-db-access-apply/1.0.0') { Throw-SafeApplyError 'APPLY_EVIDENCE_SCHEMA_INVALID' }
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
            SchemaVersion = 'hasarbotu-file-agent-pcloud-db-access-rollback/1.0.0'
            GeneratedAtUtc = [DateTime]::UtcNow.ToString('o')
            SourceApplyEvidenceFile = [System.IO.Path]::GetFileName([System.IO.Path]::GetFullPath($ApplyEvidenceReportPath))
            SourceApplyEvidenceSha256 = $ApplyEvidenceReportSha256.ToLowerInvariant()
            Nodes = $rollbackResults
            AllNodesRestoredExactly = -not @($rollbackResults | Where-Object { -not $_.RestoredExactly })
        }
        $reportRef = Write-AdminOnlyEvidence -NamePrefix 'file-agent-pcloud-db-access-rollback' -ReportObject $rollbackReport
        Write-Output ([ordered]@{
            SchemaVersion = 'hasarbotu-file-agent-pcloud-db-access-rollback-wrapper/1.0.0'
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
    if ($report.SchemaVersion -ne 'hasarbotu-file-agent-pcloud-db-access-preview/1.0.0') { Throw-SafeApplyError 'PREVIEW_REPORT_SCHEMA_INVALID' }
    if ($report.ServiceAccountName -ne $ServiceAccountName) { Throw-SafeApplyError 'PREVIEW_REPORT_SERVICE_ACCOUNT_MISMATCH' }
    if ($report.OverallStatus -eq 'blocked') { Throw-SafeApplyError 'PREVIEW_REPORT_STATUS_BLOCKED' }
    $plannedAces = @($report.PlannedMinimumAces)
    if ($report.OverallStatus -eq 'already_sufficient' -or $plannedAces.Count -eq 0) {
        Write-Output ([ordered]@{
            SchemaVersion = 'hasarbotu-file-agent-pcloud-db-access-apply-wrapper/1.0.0'
            Mode = if ($Apply) { 'apply' } else { 'dry-run' }
            OverallStatus = 'nothing_to_apply'
        } | ConvertTo-Json -Depth 4)
        exit 0
    }

    # 1) Structural whitelist validation of every planned ACE -- BEFORE
    #    touching anything, before even re-running preview. Only Allow
    #    ACEs whose rights are a strict subset of Traverse|Read|Synchronize
    #    and whose Identity matches the intended service account are ever
    #    considered further.
    $expectedDbPath = [System.IO.Path]::GetFullPath($report.DatabasePath)
    $expectedPCloudFolder = [System.IO.Path]::GetFullPath($report.PCloudFolder)
    foreach ($ace in $plannedAces) {
        if ($ace.AccessControlType -ne 'Allow') { Throw-SafeApplyError 'PLANNED_ACE_NOT_ALLOW_TYPE' }
        if ($ace.Identity -ne $ServiceAccountName) { Throw-SafeApplyError 'PLANNED_ACE_IDENTITY_MISMATCH' }
        if (-not (Test-AceWithinWhitelist -RightsValue ([int64]$ace.RightsValue))) { Throw-SafeApplyError 'PLANNED_ACE_OUTSIDE_WHITELIST' }
        # Same bare-drive-letter disambiguation as Get-NodeAclSnapshot:
        # GetFullPath("C:") resolves against this PROCESS's current
        # directory on that drive, not the drive root -- a real bug caught
        # here by a real test failure while building this tool.
        $rawAcePath = [string]$ace.Path
        if ($rawAcePath -match '^[A-Za-z]:$') { $rawAcePath = "$rawAcePath\" }
        $acePath = [System.IO.Path]::GetFullPath($rawAcePath).TrimEnd('\')
        # Exact match, or a true ancestor at a real path-separator boundary
        # (not just a shared string prefix like "C:\Users\use" vs
        # "C:\Users\user...").
        $isUnderPCloudChain = ($acePath -eq $expectedPCloudFolder) -or
            $expectedPCloudFolder.StartsWith("$acePath\", [StringComparison]::OrdinalIgnoreCase) -or
            ($acePath.Length -eq 2 -and $acePath -match '^[A-Za-z]:$' -and $expectedPCloudFolder.StartsWith($acePath, [StringComparison]::OrdinalIgnoreCase))
        if (-not $isUnderPCloudChain) { Throw-SafeApplyError 'PLANNED_ACE_PATH_OUTSIDE_EXPECTED_CHAIN' }
    }

    # 2) Re-run the ORIGINAL, unmodified preview script FRESH, right now.
    $previewScriptPath = Join-Path $PSScriptRoot 'preview-file-agent-pcloud-db-access.ps1'
    if (-not [System.IO.File]::Exists($previewScriptPath)) { Throw-SafeApplyError 'PREVIEW_SCRIPT_NOT_FOUND' }
    $freshOutputRaw = & $previewScriptPath -ServiceAccountName $ServiceAccountName -PCloudSyncAccount $report.PCloudSyncAccount -PCloudLocalDatabasePath $expectedDbPath 2>&1 | Out-String
    $freshWrapper = $null
    try { $freshWrapper = $freshOutputRaw | ConvertFrom-Json } catch { Throw-SafeApplyError 'FRESH_PREVIEW_OUTPUT_INVALID' }
    # The preview wrapper's SUCCESS output has no "Status" property at all
    # (only its error path does) -- check for presence first under
    # StrictMode rather than assuming the field exists.
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
    if ($originalBaselineByPath.ContainsKey($report.PCloudFolder) -eq $false) {
        # PCloudFolder's own snapshot lives in AncestorChain too (it is the
        # last entry) -- guard defensively in case of an unexpected shape.
        Throw-SafeApplyError 'PREVIEW_REPORT_MISSING_PCLOUD_FOLDER_BASELINE'
    }
    $freshSnapshotsBeforeApply = [ordered]@{}
    foreach ($path in $touchedPaths) {
        $freshSnapshotsBeforeApply[$path] = Get-NodeAclSnapshot -Path $path -IsDirectory $true
        if ($null -eq $freshSnapshotsBeforeApply[$path]) { Throw-SafeApplyError "TOUCHED_NODE_NOT_FOUND_$([System.IO.Path]::GetFileName($path))" }
        $originalBaseline = $originalBaselineByPath[$path]
        if ($null -eq $originalBaseline) { Throw-SafeApplyError "NO_ORIGINAL_BASELINE_FOR_NODE_$([System.IO.Path]::GetFileName($path))" }
        if ($freshSnapshotsBeforeApply[$path].Sddl -ne $originalBaseline.Sddl) { Throw-SafeApplyError 'ACL_DRIFT_SINCE_PREVIEW_REPORT' }
    }

    if (-not $Apply) {
        Write-Output ([ordered]@{
            SchemaVersion = 'hasarbotu-file-agent-pcloud-db-access-apply-wrapper/1.0.0'
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
        foreach ($path in $touchedPaths) {
            $acesForThisPath = @($plannedAces | Where-Object { $_.Path -eq $path })
            $security = [System.IO.Directory]::GetAccessControl($(if ($path -match '^[A-Za-z]:$') { "$path\" } else { $path }))
            foreach ($ace in $acesForThisPath) {
                $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
                    $ServiceAccountName,
                    [System.Security.AccessControl.FileSystemRights]([int64]$ace.RightsValue),
                    [System.Security.AccessControl.InheritanceFlags]$ace.InheritanceFlags,
                    [System.Security.AccessControl.PropagationFlags]$ace.PropagationFlags,
                    [System.Security.AccessControl.AccessControlType]::Allow)
                $security.AddAccessRule($rule)
            }
            [System.IO.Directory]::SetAccessControl($(if ($path -match '^[A-Za-z]:$') { "$path\" } else { $path }), $security)
            $appliedNodes.Add([pscustomobject]@{ Path = $path; IsDirectory = $true; Sddl = $freshSnapshotsBeforeApply[$path].Sddl })
        }

        # Post-apply confirmation: re-read each node, confirm the exact
        # planned rights are now present for the service account.
        foreach ($path in $touchedPaths) {
            $after = Get-NodeAclSnapshot -Path $path -IsDirectory $true
            $acesForThisPath = @($plannedAces | Where-Object { $_.Path -eq $path })
            $afterAcl = if ($path -match '^[A-Za-z]:$') { [System.IO.Directory]::GetAccessControl("$path\") } else { [System.IO.Directory]::GetAccessControl($path) }
            $matchingRules = @($afterAcl.GetAccessRules($true, $false, [System.Security.Principal.SecurityIdentifier]) | Where-Object { $_.IdentityReference.Value -eq (([System.Security.Principal.NTAccount]$ServiceAccountName).Translate([System.Security.Principal.SecurityIdentifier]).Value) })
            foreach ($ace in $acesForThisPath) {
                $found = @($matchingRules | Where-Object { ([int64]$_.FileSystemRights -band [int64]$ace.RightsValue) -eq [int64]$ace.RightsValue -and $_.InheritanceFlags.ToString() -eq $ace.InheritanceFlags })
                if ($found.Count -eq 0) { Throw-SafeApplyError "POST_APPLY_ACE_NOT_CONFIRMED_$([System.IO.Path]::GetFileName($path))" }
            }
        }

        # WAL/SHM regeneration continuity -- REAL proof, not a simulation:
        # create a throwaway file directly in the pCloud folder, confirm it
        # inherited the service-account Read ACE, then delete it.
        $continuityTestName = "hasarbotu-wal-shm-continuity-test-$([Guid]::NewGuid().ToString('N').Substring(0,8)).tmp"
        $continuityTestPath = Join-Path $expectedPCloudFolder $continuityTestName
        $continuityResult = [ordered]@{ TestFileName = $continuityTestName; Created = $false; InheritedReadAceFound = $false; Deleted = $false }
        try {
            [System.IO.File]::WriteAllText($continuityTestPath, 'hasarbotu-continuity-probe', [System.Text.UTF8Encoding]::new($false))
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
        if (-not $continuityResult.InheritedReadAceFound) { Throw-SafeApplyError 'WAL_SHM_CONTINUITY_INHERITANCE_NOT_CONFIRMED' }

        # Real service-account-context verification (best-effort, does NOT
        # roll back on failure -- see header notes on the known,
        # documented SeBatchLogonRight / disabled-service limitation).
        $contextVerification = [ordered]@{ Attempted = $true; Succeeded = $false; Detail = $null }
        $taskName = 'HasarBotuFileAgentPCloudDbAccessProbe'
        $probeStamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
        $probeResultPath = Join-Path $ReportDirectory "context-probe-result-$probeStamp.json"
        $probeInnerPath = Join-Path $ReportDirectory "context-probe-inner-$probeStamp.ps1"
        $probeLines = @(
            '$r = [ordered]@{}',
            '$r.whoami = (whoami)',
            "`$r.dbReadable = Test-Path -LiteralPath '$expectedDbPath'",
            'try {',
            "  `$bytes = [System.IO.File]::ReadAllBytes('$expectedDbPath')",
            '  $r.dbReadOk = $true; $r.dbBytesRead = $bytes.Length',
            '} catch { $r.dbReadOk = $false; $r.dbReadError = $_.Exception.Message }',
            "`$json = `$r | ConvertTo-Json",
            "[System.IO.File]::WriteAllText('$probeResultPath', `$json, [System.Text.UTF8Encoding]::new(`$false))"
        )
        [System.IO.File]::WriteAllText($probeInnerPath, ($probeLines -join "`r`n"), [System.Text.UTF8Encoding]::new($false))
        try {
            Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false -ErrorAction SilentlyContinue
            $service = New-Object -ComObject 'Schedule.Service'
            $service.Connect()
            $rootFolder = $service.GetFolder('\')
            $taskDef = $service.NewTask(0)
            $taskDef.Principal.UserId = $ServiceAccountName
            $taskDef.Principal.LogonType = 5  # TASK_LOGON_SERVICE_ACCOUNT
            $taskDef.Settings.Enabled = $true
            $action = $taskDef.Actions.Create(0)
            $action.Path = 'powershell.exe'
            $action.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$probeInnerPath`""
            $null = $rootFolder.RegisterTaskDefinition($taskName, $taskDef, 6, $ServiceAccountName, $null, 5)
            $registeredTask = $rootFolder.GetTask($taskName)
            $registeredTask.Run($null) | Out-Null
            $deadline = (Get-Date).AddSeconds(20)
            while ((Get-Date) -lt $deadline -and -not (Test-Path -LiteralPath $probeResultPath)) { Start-Sleep -Milliseconds 500 }
            if (Test-Path -LiteralPath $probeResultPath) {
                $probeResult = Get-Content -Raw -LiteralPath $probeResultPath | ConvertFrom-Json
                $contextVerification.Succeeded = ($probeResult.dbReadOk -eq $true)
                $contextVerification.Detail = $probeResult
            }
            else {
                $contextVerification.Detail = 'TASK_DID_NOT_PRODUCE_RESULT_WITHIN_TIMEOUT -- known limitation: TASK_LOGON_SERVICE_ACCOUNT requires either SeBatchLogonRight (not granted by this tool) or the File Agent service being enabled (blocked on D9 progress). See HB-2026-164 decision log entry for the real diagnostic evidence.'
            }
        }
        catch {
            $contextVerification.Detail = "COM_TASK_REGISTRATION_FAILED: $($_.Exception.Message) -- known limitation, see HB-2026-164."
        }
        finally {
            try { $rootFolder.DeleteTask($taskName, 0) } catch {}
            Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false -ErrorAction SilentlyContinue
        }

        $applyReport = [ordered]@{
            SchemaVersion = 'hasarbotu-file-agent-pcloud-db-access-apply/1.0.0'
            GeneratedAtUtc = [DateTime]::UtcNow.ToString('o')
            Applied = $true
            ServiceAccountName = $ServiceAccountName
            SourcePreviewReport = [System.IO.Path]::GetFileName($previewReportFullPath)
            SourcePreviewReportSha256 = $PreviewReportSha256.ToLowerInvariant()
            FreshPreviewReportAtApplyTime = $freshWrapper.Report
            PlannedAces = $plannedAces
            PreApplySnapshots = @($appliedNodes | ForEach-Object { [ordered]@{ Path = $_.Path; IsDirectory = $_.IsDirectory; Sddl = $_.Sddl } })
            WalShmContinuityTest = $continuityResult
            ServiceAccountContextVerification = $contextVerification
        }
        $reportRef = Write-AdminOnlyEvidence -NamePrefix 'file-agent-pcloud-db-access-apply' -ReportObject $applyReport

        Write-Output ([ordered]@{
            SchemaVersion = 'hasarbotu-file-agent-pcloud-db-access-apply-wrapper/1.0.0'
            Mode = 'apply'
            OverallStatus = 'applied'
            AppliedAceCount = @($plannedAces).Count
            WalShmContinuityConfirmed = $continuityResult.InheritedReadAceFound
            ServiceAccountContextVerificationSucceeded = $contextVerification.Succeeded
            ServiceAccountContextVerificationNote = if (-not $contextVerification.Succeeded) { 'Real impersonated read NOT confirmed this run -- see report for the exact reason (known SeBatchLogonRight/disabled-service limitation, not silently skipped). ACL changes remain applied and were independently confirmed via direct ACL re-read + the WAL/SHM inheritance proof.' } else { 'Confirmed: a real process running as the service account read data.db successfully.' }
            Report = $reportRef
        } | ConvertTo-Json -Depth 8)
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
            SchemaVersion = 'hasarbotu-file-agent-pcloud-db-access-apply/1.0.0'
            GeneratedAtUtc = [DateTime]::UtcNow.ToString('o')
            Applied = $false
            ServiceAccountName = $ServiceAccountName
            ErrorCode = if ($null -ne $applyError.Exception.Data -and $applyError.Exception.Data.Contains('SafeCode')) { [string]$applyError.Exception.Data['SafeCode'] } else { 'APPLY_RUNTIME_ERROR' }
            ErrorMessage = $applyError.Exception.Message
            AutoRollback = $rollbackOnFailureResults
            AllAutoRolledBack = -not @($rollbackOnFailureResults | Where-Object { -not $_.RolledBack })
        }
        Write-AdminOnlyEvidence -NamePrefix 'file-agent-pcloud-db-access-apply-failed' -ReportObject $failureReport | Out-Null
        throw
    }
}
catch {
    $safeError = [ordered]@{
        SchemaVersion = 'hasarbotu-file-agent-pcloud-db-access-apply-wrapper/1.0.0'
        Status = 'error'
        ErrorCode = if ($null -ne $_.Exception.Data -and $_.Exception.Data.Contains('SafeCode')) { [string]$_.Exception.Data['SafeCode'] } else { 'FILE_AGENT_PCLOUD_DB_ACCESS_APPLY_RUNTIME_ERROR' }
        ErrorType = $_.Exception.GetType().Name
        ErrorLine = $_.InvocationInfo.ScriptLineNumber
    }
    $safeError | ConvertTo-Json -Depth 4
    exit 1
}
