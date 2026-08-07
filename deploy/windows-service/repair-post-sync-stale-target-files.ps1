[CmdletBinding()]
param(
    [string]$SourceRoot,

    [string]$TargetRoot,

    [string]$GhostExclusionManifestPath,

    [string]$PCloudLocalDatabasePath,

    [Parameter(Mandatory)]
    [string]$ForensicsReportPath,

    [Parameter(Mandatory)]
    [ValidatePattern('^[a-fA-F0-9]{64}$')]
    [string]$ForensicsReportSha256,

    [string]$BackupDirectory,

    [ValidateRange(0, 5)]
    [int]$MaxIdentityRetries = 1,

    [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# D8 post-sync stale-target-file repair (HB-2026-130).
#
# This is the FIRST tool in the D7/D8 migration toolchain with a real WRITE
# path to source/target file content. Every other tool in this directory is
# deliberately measure-only. Because of that, this script follows the SAME
# Planla -> Onizle -> Apply model already used by install-services.ps1 and
# setup-file-agent-service-account.ps1: without -Apply it performs every
# read-only check and prints exactly what WOULD happen, and writes NOTHING
# (no backup, no staged temp file, no replace). Only -Apply performs real
# I/O, and only for the exact relative paths named in a hashed,
# Administrators-only forensics report that classified them
# 'source_current_valid' (see analyze the case's HASAR photos, HB-2026-130
# decision log entry). No other file is ever touched.
#
# Per file, in order, ALL of the following must hold fresh (re-checked at
# repair time, never trusted from the possibly-stale forensics report)
# before any write is attempted for that file:
#   - current SOURCE SHA-256 == the report's recorded Source.Sha256
#     (source has not changed since the forensic snapshot)
#   - current TARGET SHA-256 == the report's recorded Target.Sha256
#     (target is still exactly the known superseded version -- if anything,
#     including pCloud itself, has already changed target, this tool backs
#     off rather than overwrite an unknown state)
#   - pCloud diff flow running, and this file id has ZERO rows in task or
#     fstask (no pending work, no recorded conflict/error against it)
#   - pCloud's CURRENT file row (size + mtime-in-seconds) matches source's
#     current (size, LastWriteTimeUtc) -- pCloud's own bookkeeping agrees
#     source is the current object
#   - the OLDEST filerevision's size matches target's current size --
#     target really is a genuine prior revision, not unrelated content
#   - target is not open for write/delete by anything else right now
#     (best-effort FileShare.Read probe; Windows has no simple
#     "who holds this handle" API without Sysinternals tooling)
#   - source is a structurally intact JPEG (SOI/EOI present)
#
# Only if every one of those holds does -Apply: back up target
# (Administrators-only, hashed) outside the sync root, stage source's bytes
# into a same-volume temp file next to target, verify the staged copy's
# SHA-256 and JPEG integrity, atomically replace target's content
# ([System.IO.File]::Replace), then re-verify target's SHA-256 equals
# source's. pCloud settings, Add Sync, the sync mapping, env and services
# are never touched. Any file that fails a check is left completely alone
# and reported BLOCKED/SKIPPED with the reason; failure on one file never
# stops processing of the others.

$AdministratorSidValue = 'S-1-5-32-544'
$ReportDirectory = 'C:\ProgramData\HasarBotu\migration-preflight'
$LegacyForensicsSchemaVersion = 'hasarbotu-56aag629-hasar-version-forensics/1.0.0'
$DiffForensicsSchemaVersion = 'pcloud-post-sync-diff-forensics/1.0.0'
$CaseReconciliationSchemaVersion = 'hasarbotu-pcloud-case-reconciliation/1.0.0'

function Throw-SafeRepairError {
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
    if (-not (Test-AdminOnlyAcl $Path $false)) { Throw-SafeRepairError 'ADMIN_ONLY_ACL_APPLY_FAILED' }
}

function Get-JpegIntegrityOk {
    param([string]$Path)
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $len = $bytes.Length
    if ($len -lt 4) { return $false }
    return ($bytes[0] -eq 0xFF -and $bytes[1] -eq 0xD8 -and $bytes[$len - 2] -eq 0xFF -and $bytes[$len - 1] -eq 0xD9)
}

function Get-PngIntegrityOk {
    param([string]$Path)
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -lt 8) { return $false }
    $pngSignature = @(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
    for ($i = 0; $i -lt 8; $i++) {
        if ($bytes[$i] -ne $pngSignature[$i]) { return $false }
    }
    return $true
}

function Test-SourceIntegrityOk {
    # HB-2026-162: the original JPEG SOI/EOI check above (Get-JpegIntegrityOk)
    # is UNCHANGED and still used verbatim for .jpg/.jpeg -- the two original
    # schemas only ever process real HASAR-photo JPEGs, and this dispatcher
    # preserves the exact same call and the exact same blocker code
    # (SOURCE_JPEG_INTEGRITY_FAILED / STAGED_JPEG_INTEGRITY_FAILED) for that
    # path. The new case-reconciliation schema can surface stale_target
    # candidates of any extension (PDFs, PNGs, etc. -- confirmed against
    # real data). PNG gets an equivalent signature check; anything else
    # falls back to a minimal non-zero-length check -- deep per-format
    # corruption detection beyond the SHA-256 hash-match already performed
    # elsewhere is NOT implemented for other types (documented limitation,
    # not a silent gap).
    param([string]$Path)
    $extension = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()
    if ($extension -eq '.jpg' -or $extension -eq '.jpeg') {
        return [pscustomobject]@{ Ok = (Get-JpegIntegrityOk $Path); Code = 'JPEG_INTEGRITY_FAILED' }
    }
    if ($extension -eq '.png') {
        return [pscustomobject]@{ Ok = (Get-PngIntegrityOk $Path); Code = 'PNG_INTEGRITY_FAILED' }
    }
    return [pscustomobject]@{ Ok = (([System.IO.FileInfo]::new($Path)).Length -gt 0); Code = 'MINIMAL_INTEGRITY_CHECK_FAILED' }
}

function Get-NormalizedJsonArray {
    # Windows PowerShell 5.1's ConvertFrom-Json/ConvertTo-Json round-trip can
    # wrap a previously-deserialized array reassigned as a property of a NEW
    # object into { value: [...], Count: N } instead of a plain JSON array
    # (confirmed against a real forensics report produced earlier in this
    # same investigation). Accept either shape without altering the
    # historical evidence file itself.
    param($Value)
    if ($null -eq $Value) { return @() }
    if ($Value.PSObject.Properties.Match('value').Count -gt 0 -and $Value.PSObject.Properties.Match('Count').Count -gt 0) {
        return @($Value.value)
    }
    return @($Value)
}

function Get-CandidateEntries56aag629 {
    # Original HB-2026-130 candidate derivation, extracted verbatim --
    # behavior UNCHANGED: a file is a candidate only if the report's own
    # Classification map marks it 'source_current_valid'.
    param($report)
    $names = @($report.Classification.PSObject.Properties | Where-Object { $_.Value -eq 'source_current_valid' } | ForEach-Object { $_.Name })
    if ($names.Count -eq 0) { Throw-SafeRepairError 'NO_SOURCE_CURRENT_VALID_ENTRIES' }
    $normalizedFiles = Get-NormalizedJsonArray $report.Files
    $fileEntries = @()
    foreach ($name in $names) {
        $entry = $normalizedFiles | Where-Object { $_.Name -eq $name } | Select-Object -First 1
        if ($null -eq $entry) { Throw-SafeRepairError 'FORENSICS_REPORT_ENTRY_MISSING' }
        $fileEntries += $entry
    }
    return , $fileEntries
}

function Get-CandidateEntriesDiffForensics {
    # HB-2026-149 adapter for the general pcloud-post-sync-diff-forensics/1.0.0
    # report schema (produced by pcloud-post-sync-diff-forensics.mjs), ADDED
    # alongside the original 56AAG629-specific path above -- that path is
    # untouched.
    #
    # Fail-closed classification, one report entry at a time:
    #   - 'extra' (target has no source counterpart): NEVER a candidate --
    #     always ClassificationBlocked. This tool only ever copies
    #     source -> target; with no source there is nothing safe to copy,
    #     and the file is never deleted or modified.
    #   - 'metadata_only' (content identical, only mtime/flags differ):
    #     OutOfScope -- not a data problem, never processed.
    #   - 'content_mismatch': a candidate ONLY if ALL of the following hold
    #     from the report's OWN recorded evidence (the generic per-file loop
    #     further below re-verifies the SHA-256/pCloud state FRESH
    #     regardless -- this gate is additional, not a replacement for it):
    #       * Currency == 'source_current_target_superseded' (never the
    #         reverse -- if source were the stale side, copying it over
    #         target would destroy the correct content)
    #       * PCloud.found is true and PCloud.TaskReferenceCount is 0
    #       * PCloud.CurrentRow.size matches Source.Size (pCloud's own
    #         bookkeeping agrees source is the live object)
    #       * PCloud.Revisions contains a DISTINCT entry (different hash
    #         than CurrentRow) whose size matches Target.Size -- proof that
    #         target's content is a genuine prior pCloud revision, not
    #         unrelated/random content ("revision kaniti")
    #   - anything else (unrecognized classification, missing Source/Target/
    #     PCloud data, or any of the above checks failing): ClassificationBlocked,
    #     fail-closed -- never a candidate.
    param($report)
    $entries = Get-NormalizedJsonArray $report.Entries
    $candidates = @()
    $outOfScope = @()
    $blocked = @()
    foreach ($entry in $entries) {
        $name = [string]$entry.RelativePath
        $classification = [string]$entry.Classification

        if ($classification -eq 'metadata_only') {
            $outOfScope += [pscustomobject]@{ Name = $name; Reason = 'METADATA_ONLY_CONTENT_IDENTICAL' }
            continue
        }
        if ($classification -eq 'extra') {
            $blocked += [pscustomobject]@{ Name = $name; Reason = 'TARGET_ONLY_NO_SOURCE_COUNTERPART' }
            continue
        }
        if ($classification -ne 'content_mismatch') {
            $blocked += [pscustomobject]@{ Name = $name; Reason = "UNKNOWN_OR_UNSUPPORTED_CLASSIFICATION_$classification" }
            continue
        }
        if ([string]$entry.Currency -ne 'source_current_target_superseded') {
            $blocked += [pscustomobject]@{ Name = $name; Reason = 'CURRENCY_NOT_SOURCE_CURRENT_TARGET_SUPERSEDED' }
            continue
        }
        if ($null -eq $entry.Source -or $null -eq $entry.Target) {
            $blocked += [pscustomobject]@{ Name = $name; Reason = 'SOURCE_OR_TARGET_DATA_MISSING' }
            continue
        }
        if ($null -eq $entry.PCloud -or $entry.PCloud.found -ne $true) {
            $blocked += [pscustomobject]@{ Name = $name; Reason = 'PCLOUD_FILE_NOT_FOUND' }
            continue
        }
        if ([int64]$entry.PCloud.TaskReferenceCount -ne 0) {
            $blocked += [pscustomobject]@{ Name = $name; Reason = 'PCLOUD_TASK_REFERENCE_FOUND' }
            continue
        }
        if ($null -eq $entry.PCloud.CurrentRow -or [int64]$entry.PCloud.CurrentRow.size -ne [int64]$entry.Source.Size) {
            $blocked += [pscustomobject]@{ Name = $name; Reason = 'PCLOUD_CURRENT_ROW_SIZE_MISMATCH_SOURCE' }
            continue
        }

        $currentHash = [string]$entry.PCloud.CurrentRow.hash
        $revisions = Get-NormalizedJsonArray $entry.PCloud.Revisions
        $supersededMatch = @($revisions | Where-Object { [int64]$_.size -eq [int64]$entry.Target.Size -and [string]$_.hash -ne $currentHash })
        if ($supersededMatch.Count -lt 1) {
            $blocked += [pscustomobject]@{ Name = $name; Reason = 'NO_DISTINCT_SUPERSEDED_REVISION_MATCHING_TARGET' }
            continue
        }

        $candidates += [pscustomobject]@{
            Name   = $name
            Source = [pscustomobject]@{ FullPath = [string]$entry.Source.FullPath; Sha256 = [string]$entry.Source.Sha256 }
            Target = [pscustomobject]@{ FullPath = [string]$entry.Target.FullPath; Sha256 = [string]$entry.Target.Sha256 }
        }
    }
    return [pscustomobject]@{ Candidates = @($candidates); OutOfScope = @($outOfScope); Blocked = @($blocked) }
}

function Get-CandidateEntriesCaseReconciliation {
    # HB-2026-162 adapter for the hasarbotu-pcloud-case-reconciliation/1.0.0
    # report schema (produced by run-pcloud-case-reconciliation.ps1 /
    # pcloud-case-reconciliation.mjs), ADDED alongside the two original
    # paths above -- neither is touched.
    #
    # The case-reconciliation report's Entries[] shares the EXACT same
    # Source/Target/PCloud shape as the diff-forensics schema (it wraps
    # buildDiffForensicsReport's own output and adds PatternClassification/
    # PatternNote on top) -- so the same fail-closed proof checks apply,
    # gated on PatternClassification == 'stale_target' (the case
    # module's own classification, which already covers BOTH the classic
    # genuine-prior-revision pattern AND the zero-byte/incomplete-download
    # placeholder variant first identified in this same investigation)
    # instead of Currency alone:
    #   - 'extra' (any, including rename_artifact-paired ones): NEVER a
    #     candidate -- this tool only ever copies source -> target; a
    #     rename/move is not safely resolved by a blind byte overwrite.
    #   - 'missing': NEVER a candidate -- there is no existing target file
    #     for [System.IO.File]::Replace to replace.
    #   - 'metadata_only': OutOfScope -- not a data problem.
    #   - 'content_mismatch' with PatternClassification != 'stale_target'
    #     (i.e. 'unknown' or 'rename_artifact'): ClassificationBlocked.
    #   - 'content_mismatch' with PatternClassification == 'stale_target':
    #     a candidate ONLY if ALL of the same evidentiary checks the
    #     diff-forensics adapter requires also hold (PCloud.found,
    #     TaskReferenceCount == 0, CurrentRow.size == Source.Size, a
    #     DISTINCT revision matching Target.Size) -- the per-file loop
    #     further below re-verifies everything fresh regardless.
    param($report)
    $entries = Get-NormalizedJsonArray $report.Entries
    $candidates = @()
    $outOfScope = @()
    $blocked = @()
    foreach ($entry in $entries) {
        $name = [string]$entry.RelativePath
        $classification = [string]$entry.Classification

        if ($classification -eq 'metadata_only') {
            $outOfScope += [pscustomobject]@{ Name = $name; Reason = 'METADATA_ONLY_CONTENT_IDENTICAL' }
            continue
        }
        if ($classification -eq 'extra') {
            $blocked += [pscustomobject]@{ Name = $name; Reason = 'TARGET_ONLY_NO_SOURCE_COUNTERPART' }
            continue
        }
        if ($classification -ne 'content_mismatch') {
            $blocked += [pscustomobject]@{ Name = $name; Reason = "UNKNOWN_OR_UNSUPPORTED_CLASSIFICATION_$classification" }
            continue
        }
        if ([string]$entry.PatternClassification -ne 'stale_target') {
            $blocked += [pscustomobject]@{ Name = $name; Reason = "PATTERN_CLASSIFICATION_NOT_STALE_TARGET_$([string]$entry.PatternClassification)" }
            continue
        }
        if ($null -eq $entry.Source -or $null -eq $entry.Target) {
            $blocked += [pscustomobject]@{ Name = $name; Reason = 'SOURCE_OR_TARGET_DATA_MISSING' }
            continue
        }
        if ($null -eq $entry.PCloud -or $entry.PCloud.found -ne $true) {
            $blocked += [pscustomobject]@{ Name = $name; Reason = 'PCLOUD_FILE_NOT_FOUND' }
            continue
        }
        if ([int64]$entry.PCloud.TaskReferenceCount -ne 0) {
            $blocked += [pscustomobject]@{ Name = $name; Reason = 'PCLOUD_TASK_REFERENCE_FOUND' }
            continue
        }
        if ($null -eq $entry.PCloud.CurrentRow -or [int64]$entry.PCloud.CurrentRow.size -ne [int64]$entry.Source.Size) {
            $blocked += [pscustomobject]@{ Name = $name; Reason = 'PCLOUD_CURRENT_ROW_SIZE_MISMATCH_SOURCE' }
            continue
        }

        $currentHash = [string]$entry.PCloud.CurrentRow.hash
        $revisions = Get-NormalizedJsonArray $entry.PCloud.Revisions
        $supersededMatch = @($revisions | Where-Object { [int64]$_.size -eq [int64]$entry.Target.Size -and [string]$_.hash -ne $currentHash })
        if ($supersededMatch.Count -lt 1) {
            $blocked += [pscustomobject]@{ Name = $name; Reason = 'NO_DISTINCT_SUPERSEDED_REVISION_MATCHING_TARGET' }
            continue
        }

        $candidates += [pscustomobject]@{
            Name   = $name
            Source = [pscustomobject]@{ FullPath = [string]$entry.Source.FullPath; Sha256 = [string]$entry.Source.Sha256 }
            Target = [pscustomobject]@{ FullPath = [string]$entry.Target.FullPath; Sha256 = [string]$entry.Target.Sha256 }
        }
    }
    return [pscustomobject]@{ Candidates = @($candidates); OutOfScope = @($outOfScope); Blocked = @($blocked) }
}

function Test-FileNotLockedForWrite {
    param([string]$Path)
    try {
        $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
        $stream.Dispose()
        return $true
    }
    catch [System.IO.IOException] {
        return $false
    }
}

try {
    if ([string]::IsNullOrWhiteSpace($SourceRoot) -or [string]::IsNullOrWhiteSpace($TargetRoot)) {
        $companyFolder = 'BARAN GLOBAL EKSPERT' + [char]0x0130 + 'Z'
        if ([string]::IsNullOrWhiteSpace($SourceRoot)) { $SourceRoot = Join-Path 'P:\' $companyFolder }
        if ([string]::IsNullOrWhiteSpace($TargetRoot)) { $TargetRoot = Join-Path 'C:\HasarBotuStorage' $companyFolder }
    }
    $source = [System.IO.Path]::GetFullPath($SourceRoot).TrimEnd('\')
    $target = [System.IO.Path]::GetFullPath($TargetRoot).TrimEnd('\')

    if ([string]::IsNullOrWhiteSpace($GhostExclusionManifestPath)) { Throw-SafeRepairError 'GHOST_EXCLUSION_MANIFEST_REQUIRED' }
    $manifestPath = [System.IO.Path]::GetFullPath($GhostExclusionManifestPath)
    $manifestSidecarPath = "$manifestPath.sha256"
    if (-not (Test-AdministratorsOnlyFile $manifestPath) -or -not (Test-AdministratorsOnlyFile $manifestSidecarPath)) {
        Throw-SafeRepairError 'GHOST_EXCLUSION_ADMIN_ACL_REQUIRED'
    }
    $manifestSidecarText = [System.IO.File]::ReadAllText($manifestSidecarPath).Trim()
    $manifestSidecarMatch = [System.Text.RegularExpressions.Regex]::Match($manifestSidecarText, '^([a-f0-9]{64})  ([^\r\n]+)$')
    if (-not $manifestSidecarMatch.Success -or $manifestSidecarMatch.Groups[2].Value -ne [System.IO.Path]::GetFileName($manifestPath)) {
        Throw-SafeRepairError 'GHOST_EXCLUSION_SIDECAR_INVALID'
    }
    $manifestHash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($manifestHash -ne $manifestSidecarMatch.Groups[1].Value) { Throw-SafeRepairError 'GHOST_EXCLUSION_HASH_MISMATCH' }

    if ([string]::IsNullOrWhiteSpace($PCloudLocalDatabasePath)) {
        if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) { Throw-SafeRepairError 'PCLOUD_LOCAL_DATABASE_NOT_CONFIGURED' }
        $PCloudLocalDatabasePath = Join-Path $env:LOCALAPPDATA 'pCloud\data.db'
    }
    $pcloudDatabaseFullPath = [System.IO.Path]::GetFullPath($PCloudLocalDatabasePath)
    if (-not [System.IO.File]::Exists($pcloudDatabaseFullPath)) { Throw-SafeRepairError 'PCLOUD_LOCAL_DATABASE_NOT_FOUND' }

    $reportFullPath = [System.IO.Path]::GetFullPath($ForensicsReportPath)
    if (-not (Test-AdministratorsOnlyFile $reportFullPath)) { Throw-SafeRepairError 'FORENSICS_REPORT_ADMIN_ACL_REQUIRED' }
    $reportActualHash = (Get-FileHash -LiteralPath $reportFullPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($reportActualHash -ne $ForensicsReportSha256.ToLowerInvariant()) { Throw-SafeRepairError 'FORENSICS_REPORT_HASH_MISMATCH' }
    try {
        $report = [System.IO.File]::ReadAllText($reportFullPath) | ConvertFrom-Json
    }
    catch {
        Throw-SafeRepairError 'FORENSICS_REPORT_JSON_INVALID'
    }
    if ($report.SchemaVersion -ne $LegacyForensicsSchemaVersion -and $report.SchemaVersion -ne $DiffForensicsSchemaVersion -and $report.SchemaVersion -ne $CaseReconciliationSchemaVersion) {
        Throw-SafeRepairError 'FORENSICS_REPORT_SCHEMA_INVALID'
    }

    $nodeCommand = Get-Command node -CommandType Application -ErrorAction SilentlyContinue
    if ($null -eq $nodeCommand) { Throw-SafeRepairError 'NODE_RUNTIME_NOT_FOUND' }
    $statePath = Join-Path $PSScriptRoot 'pcloud-stale-target-file-state.mjs'
    if (-not [System.IO.File]::Exists($statePath)) { Throw-SafeRepairError 'STALE_TARGET_STATE_TOOL_NOT_FOUND' }

    if ([string]::IsNullOrWhiteSpace($BackupDirectory)) {
        $backupTimestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
        $BackupDirectory = Join-Path $ReportDirectory (Join-Path 'pre-repair-backups' $backupTimestamp)
    }
    $backupDirectoryFullPath = [System.IO.Path]::GetFullPath($BackupDirectory)

    $outOfScopeEntries = @()
    $classificationBlockedEntries = @()
    if ($report.SchemaVersion -eq $LegacyForensicsSchemaVersion) {
        $fileEntries = Get-CandidateEntries56aag629 $report
    }
    else {
        $adapterResult = if ($report.SchemaVersion -eq $CaseReconciliationSchemaVersion) {
            Get-CandidateEntriesCaseReconciliation $report
        }
        else {
            Get-CandidateEntriesDiffForensics $report
        }
        $fileEntries = $adapterResult.Candidates
        $outOfScopeEntries = $adapterResult.OutOfScope
        $classificationBlockedEntries = $adapterResult.Blocked
        # Zero candidates is a legitimate outcome (e.g. every entry turned
        # out to be 'extra'/'metadata_only', or unproven) and must NOT throw
        # -- only a structurally empty report (no Entries at all: neither a
        # candidate, a blocker, nor an out-of-scope item) is treated as a
        # malformed/wrong-file input.
        if ($fileEntries.Count -eq 0 -and $outOfScopeEntries.Count -eq 0 -and $classificationBlockedEntries.Count -eq 0) {
            Throw-SafeRepairError 'NO_ENTRIES_IN_FORENSICS_REPORT'
        }
    }

    if ($Apply -and -not [System.IO.Directory]::Exists($backupDirectoryFullPath)) {
        [System.IO.Directory]::CreateDirectory($backupDirectoryFullPath) | Out-Null
        [System.IO.Directory]::SetAccessControl($backupDirectoryFullPath, (New-AdminOnlySecurity $true))
    }

    $results = @()
    foreach ($entry in $fileEntries) {
        $name = $entry.Name
        $sourcePath = [string]$entry.Source.FullPath
        $targetPath = [string]$entry.Target.FullPath
        $expectedSourceSha256 = ([string]$entry.Source.Sha256).ToLowerInvariant()
        $expectedTargetSha256 = ([string]$entry.Target.Sha256).ToLowerInvariant()

        $blockers = [System.Collections.Generic.List[string]]::new()
        $applied = $false
        $backupPath = $null
        $backupSha256 = $null
        $finalTargetSha256 = $null
        $identityRetryCount = 0

        if (-not $sourcePath.StartsWith($source, [StringComparison]::OrdinalIgnoreCase) -or
            -not $targetPath.StartsWith($target, [StringComparison]::OrdinalIgnoreCase)) {
            $blockers.Add('PATH_OUTSIDE_EXPECTED_ROOT')
        }
        if (-not [System.IO.File]::Exists($sourcePath)) { $blockers.Add('SOURCE_FILE_NOT_FOUND') }
        if (-not [System.IO.File]::Exists($targetPath)) { $blockers.Add('TARGET_FILE_NOT_FOUND') }

        $currentSourceSha256 = $null
        $currentTargetSha256 = $null
        if ($blockers.Count -eq 0) {
            $currentSourceSha256 = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
            $currentTargetSha256 = (Get-FileHash -LiteralPath $targetPath -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($currentSourceSha256 -ne $expectedSourceSha256) { $blockers.Add('SOURCE_CHANGED_SINCE_FORENSICS') }
            if ($currentTargetSha256 -ne $expectedTargetSha256) { $blockers.Add('TARGET_NOT_KNOWN_SUPERSEDED_VERSION') }
            $sourceIntegrity = Test-SourceIntegrityOk $sourcePath
            if (-not $sourceIntegrity.Ok) { $blockers.Add("SOURCE_$($sourceIntegrity.Code)") }
        }

        $relativePath = $null
        $state = $null
        if ($blockers.Count -eq 0) {
            $relativePath = $sourcePath.Substring($source.Length).TrimStart('\', '/')
            try {
                $stateStdout = & $nodeCommand.Source $statePath `
                    '--source-root' $source `
                    '--ghost-manifest' $manifestPath `
                    '--ghost-manifest-sha256' $manifestHash `
                    '--pcloud-db' $pcloudDatabaseFullPath `
                    '--relative-path' $relativePath | Out-String
                $stateExitCode = $LASTEXITCODE
                $state = $stateStdout | ConvertFrom-Json
            }
            catch {
                $blockers.Add('PCLOUD_STATE_PROBE_FAILED')
            }
            if ($null -ne $state) {
                if ($stateExitCode -ne 0 -or $state.Status -ne 'ok') {
                    $blockers.Add("PCLOUD_STATE_PROBE_ERROR_$([string]$state.ErrorCode)")
                }
                elseif (-not $state.found) {
                    $blockers.Add('PCLOUD_FILE_NOT_FOUND')
                }
                else {
                    if ($state.taskReferenceCount -ne 0) { $blockers.Add('PCLOUD_TASK_REFERENCE_FOUND') }
                    $sourceInfo = [System.IO.FileInfo]::new($sourcePath)
                    $expectedMtimeUnix = [long][Math]::Floor(([DateTimeOffset]$sourceInfo.LastWriteTimeUtc).ToUnixTimeSeconds())
                    if ([int64]$state.currentRow.size -ne [int64]$sourceInfo.Length -or [int64]$state.currentRow.mtime -ne $expectedMtimeUnix) {
                        $blockers.Add('PCLOUD_CURRENT_OBJECT_MISMATCH')
                    }
                    # HB-2026-149: pCloud does not guarantee filerevision row
                    # order (confirmed against real B10 data -- several files
                    # return the CURRENT revision at index 0, not the
                    # superseded one, when both revisions share the same
                    # ctime). Checking index 0 only is a positional
                    # assumption, not proof; check for ANY revision whose
                    # size matches target's AND whose hash differs from the
                    # current row's (a genuinely distinct, superseded
                    # revision). Strictly more permissive than the old
                    # index-0 check for cases that already passed it (index 0
                    # matching was always itself "a revision matching"), and
                    # strictly safer for the coincidental case where index 0
                    # would have matched size while actually BEING the
                    # current revision.
                    $revisions = @($state.revisions)
                    $targetSize = [int64]([System.IO.FileInfo]::new($targetPath)).Length
                    $currentRevisionHash = [string]$state.currentRow.hash
                    $supersededRevisionMatch = @($revisions | Where-Object { [int64]$_.size -eq $targetSize -and [string]$_.hash -ne $currentRevisionHash })
                    if ($supersededRevisionMatch.Count -lt 1) {
                        $blockers.Add('TARGET_NOT_PRIOR_REVISION')
                    }
                }
            }
        }

        if ($blockers.Count -eq 0 -and -not (Test-FileNotLockedForWrite $targetPath)) {
            $blockers.Add('TARGET_FILE_LOCKED')
        }

        if ($blockers.Count -eq 0 -and $Apply) {
            try {
                $safeName = ($name -replace '[\\/:*?"<>|]', '_')
                $backupPath = Join-Path $backupDirectoryFullPath "$safeName.superseded.bak"
                [System.IO.File]::Copy($targetPath, $backupPath, $true)
                Set-AdminOnlyFileSecurity $backupPath
                $backupSha256 = (Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash.ToLowerInvariant()
                if ($backupSha256 -ne $currentTargetSha256) { Throw-SafeRepairError 'BACKUP_HASH_MISMATCH' }
                $backupSidecarPath = "$backupPath.sha256"
                [System.IO.File]::WriteAllText($backupSidecarPath, "$backupSha256  $safeName.superseded.bak", [System.Text.UTF8Encoding]::new($false))
                Set-AdminOnlyFileSecurity $backupSidecarPath

                $guidSuffix = [Guid]::NewGuid().ToString('N').Substring(0, 8)
                $stagedPath = "$targetPath.hasarbotu-repair-$guidSuffix.tmp"
                # .NET Framework's File.Replace throws ArgumentException on a
                # literal null destinationBackupFileName (PowerShell 5.1 /
                # .NET Framework quirk, confirmed by isolated repro) -- give
                # it a real same-directory throwaway path and delete that
                # copy ourselves right after; our OWN admin-only backup
                # above is already the durable, hashed, ACL'd one.
                $replaceBackupPath = "$targetPath.hasarbotu-replace-backup-$guidSuffix.tmp"
                try {
                    [System.IO.File]::Copy($sourcePath, $stagedPath, $false)
                    $stagedSha256 = (Get-FileHash -LiteralPath $stagedPath -Algorithm SHA256).Hash.ToLowerInvariant()
                    if ($stagedSha256 -ne $currentSourceSha256) { Throw-SafeRepairError 'STAGED_HASH_MISMATCH' }
                    $stagedIntegrity = Test-SourceIntegrityOk $stagedPath
                    if (-not $stagedIntegrity.Ok) { Throw-SafeRepairError "STAGED_$($stagedIntegrity.Code)" }

                    # Test-only, opt-in-only deterministic sync point: real
                    # operator use NEVER sets this env var, so this block is
                    # always a no-op in production. Exists solely so the
                    # test suite can land a source-identity change in the
                    # exact window between staging and the fence check
                    # without relying on wall-clock timing races.
                    if ($env:HASARBOTU_TEST_IDENTITY_FENCE_SYNC_MARKER) {
                        $syncMarkerPath = $env:HASARBOTU_TEST_IDENTITY_FENCE_SYNC_MARKER
                        [System.IO.File]::WriteAllText($syncMarkerPath, 'ready')
                        $syncDeadline = (Get-Date).AddSeconds(10)
                        while ((Get-Date) -lt $syncDeadline -and [System.IO.File]::Exists($syncMarkerPath)) {
                            Start-Sleep -Milliseconds 20
                        }
                    }

                    # HB-2026-162 identity fence: re-probe pCloud's LIVE state
                    # immediately before the atomic replace and compare
                    # against $state (captured moments earlier in this same
                    # per-file pass, before staging began). If source's live
                    # pCloud identity (fileId/current hash/current size)
                    # moved during staging -- a real possibility in a live
                    # office, which is the whole point of this package --
                    # do NOT commit a copy that is stale-since-we-started;
                    # re-fetch fresh source bytes and retry THIS FILE ONLY,
                    # up to MaxIdentityRetries times. Exhausting retries
                    # blocks only this file; every other file in the batch
                    # is unaffected (unchanged per-file isolation).
                    $identityFenceOk = $false
                    $identityAttempt = 0
                    while (-not $identityFenceOk) {
                        $identityAttempt += 1
                        $refreshStdout = & $nodeCommand.Source $statePath `
                            '--source-root' $source `
                            '--ghost-manifest' $manifestPath `
                            '--ghost-manifest-sha256' $manifestHash `
                            '--pcloud-db' $pcloudDatabaseFullPath `
                            '--relative-path' $relativePath | Out-String
                        $refreshExitCode = $LASTEXITCODE
                        $refreshState = $refreshStdout | ConvertFrom-Json
                        $identityMatches = (
                            $refreshExitCode -eq 0 -and $refreshState.Status -eq 'ok' -and $refreshState.found -eq $true -and
                            [string]$refreshState.fileId -eq [string]$state.fileId -and
                            [string]$refreshState.currentRow.hash -eq [string]$state.currentRow.hash -and
                            [int64]$refreshState.currentRow.size -eq [int64]$state.currentRow.size
                        )
                        if ($identityMatches) {
                            $identityFenceOk = $true
                        }
                        elseif ($identityAttempt -gt $MaxIdentityRetries) {
                            Throw-SafeRepairError 'SOURCE_IDENTITY_CHANGED_DURING_REPAIR'
                        }
                        else {
                            $currentSourceSha256 = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
                            [System.IO.File]::Copy($sourcePath, $stagedPath, $true)
                            $stagedSha256 = (Get-FileHash -LiteralPath $stagedPath -Algorithm SHA256).Hash.ToLowerInvariant()
                            if ($stagedSha256 -ne $currentSourceSha256) { Throw-SafeRepairError 'STAGED_HASH_MISMATCH' }
                            $retryIntegrity = Test-SourceIntegrityOk $stagedPath
                            if (-not $retryIntegrity.Ok) { Throw-SafeRepairError "STAGED_$($retryIntegrity.Code)" }
                            $state = $refreshState
                            $identityRetryCount += 1
                        }
                    }

                    [System.IO.File]::Replace($stagedPath, $targetPath, $replaceBackupPath)

                    $finalTargetSha256 = (Get-FileHash -LiteralPath $targetPath -Algorithm SHA256).Hash.ToLowerInvariant()
                    $sourceRecheckSha256 = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
                    if ($finalTargetSha256 -ne $currentSourceSha256 -or $sourceRecheckSha256 -ne $currentSourceSha256) {
                        Throw-SafeRepairError 'POST_REPLACE_HASH_MISMATCH'
                    }
                    $applied = $true
                }
                finally {
                    foreach ($leftover in @($stagedPath, $replaceBackupPath)) {
                        if ([System.IO.File]::Exists($leftover)) { [System.IO.File]::Delete($leftover) }
                    }
                }
            }
            catch {
                $code = if ($null -ne $_.Exception.Data -and $_.Exception.Data.Contains('SafeCode')) { [string]$_.Exception.Data['SafeCode'] } else { 'REPAIR_APPLY_RUNTIME_ERROR' }
                $blockers.Add($code)
                $blockers.Add("EXCEPTION_MESSAGE: $($_.Exception.Message)")
            }
        }

        $results += [pscustomobject]@{
            Name = $name
            Mode = if ($Apply) { 'apply' } else { 'preview' }
            Status = if ($blockers.Count -gt 0) { 'blocked' } elseif ($Apply) { if ($applied) { 'applied' } else { 'blocked' } } else { 'would_apply' }
            Blockers = @($blockers)
            SourcePath = $sourcePath
            TargetPath = $targetPath
            ExpectedSourceSha256 = $expectedSourceSha256
            ExpectedTargetSha256 = $expectedTargetSha256
            CurrentSourceSha256AtCheckTime = $currentSourceSha256
            CurrentTargetSha256AtCheckTime = $currentTargetSha256
            PCloudState = $state
            BackupPath = $backupPath
            BackupSha256 = $backupSha256
            FinalTargetSha256 = $finalTargetSha256
            IdentityRetryCount = $identityRetryCount
        }
    }

    $overallStatus = if (@($results | Where-Object { $_.Status -eq 'blocked' }).Count -gt 0) { 'partial_or_blocked' }
        elseif ($Apply) { 'applied' } else { 'preview_ok' }

    $output = [ordered]@{
        SchemaVersion = 'hasarbotu-stale-target-file-repair/1.0.0'
        Mode = if ($Apply) { 'apply' } else { 'preview' }
        GeneratedAtUtc = [DateTime]::UtcNow.ToString('o')
        ForensicsReportSchemaVersion = [string]$report.SchemaVersion
        ForensicsReportPath = $reportFullPath
        ForensicsReportSha256 = $reportActualHash
        BackupDirectory = $backupDirectoryFullPath
        OverallStatus = $overallStatus
        Files = $results
        ClassificationBlocked = @($classificationBlockedEntries | ForEach-Object { [ordered]@{ Name = $_.Name; Reason = $_.Reason } })
        OutOfScope = @($outOfScopeEntries | ForEach-Object { [ordered]@{ Name = $_.Name; Reason = $_.Reason } })
    }

    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [System.Security.Principal.WindowsPrincipal]::new($identity)
    if ($Apply -and -not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Throw-SafeRepairError 'ADMINISTRATOR_REQUIRED_FOR_APPLY'
    }

    if ($Apply) {
        if (-not [System.IO.Directory]::Exists($ReportDirectory)) { [System.IO.Directory]::CreateDirectory($ReportDirectory) | Out-Null }
        [System.IO.Directory]::SetAccessControl($ReportDirectory, (New-AdminOnlySecurity $true))
        $timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
        $suffix = [Guid]::NewGuid().ToString('N').Substring(0, 8)
        $fileName = "stale-target-repair-$timestamp-$suffix.json"
        $finalPath = Join-Path $ReportDirectory $fileName
        $json = $output | ConvertTo-Json -Depth 12
        [System.IO.File]::WriteAllText($finalPath, $json, [System.Text.UTF8Encoding]::new($false))
        Set-AdminOnlyFileSecurity $finalPath
        $reportHash = (Get-FileHash -LiteralPath $finalPath -Algorithm SHA256).Hash.ToLowerInvariant()
        $sidecarPath = "$finalPath.sha256"
        [System.IO.File]::WriteAllText($sidecarPath, "$reportHash  $fileName", [System.Text.UTF8Encoding]::new($false))
        Set-AdminOnlyFileSecurity $sidecarPath
        Write-Output ([ordered]@{
            OverallStatus = $overallStatus
            AppliedCount = @($results | Where-Object { $_.Status -eq 'applied' }).Count
            BlockedCount = @($results | Where-Object { $_.Status -eq 'blocked' }).Count
            ClassificationBlockedCount = $classificationBlockedEntries.Count
            OutOfScopeCount = $outOfScopeEntries.Count
            Report = [ordered]@{ FileName = $fileName; Sha256 = $reportHash; AdminOnly = $true }
        } | ConvertTo-Json -Depth 4)
    }
    else {
        Write-Output ([ordered]@{
            OverallStatus = $overallStatus
            WouldApplyCount = @($results | Where-Object { $_.Status -eq 'would_apply' }).Count
            BlockedCount = @($results | Where-Object { $_.Status -eq 'blocked' }).Count
            ClassificationBlockedCount = $classificationBlockedEntries.Count
            OutOfScopeCount = $outOfScopeEntries.Count
            PerFile = @($results | ForEach-Object { [ordered]@{ Name = $_.Name; Status = $_.Status; Blockers = $_.Blockers } })
            ClassificationBlocked = @($classificationBlockedEntries | ForEach-Object { [ordered]@{ Name = $_.Name; Reason = $_.Reason } })
            OutOfScope = @($outOfScopeEntries | ForEach-Object { [ordered]@{ Name = $_.Name; Reason = $_.Reason } })
        } | ConvertTo-Json -Depth 6)
    }
    exit 0
}
catch {
    $safeError = [ordered]@{
        SchemaVersion = 'hasarbotu-stale-target-file-repair/1.0.0'
        Status = 'error'
        ErrorCode = if ($null -ne $_.Exception.Data -and $_.Exception.Data.Contains('SafeCode')) { [string]$_.Exception.Data['SafeCode'] } else { 'REPAIR_RUNTIME_ERROR' }
        ErrorType = $_.Exception.GetType().Name
        ErrorLine = $_.InvocationInfo.ScriptLineNumber
    }
    $safeError | ConvertTo-Json -Depth 4
    exit 1
}
