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

    [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# D9 B10 target-only orphan cleanup (HB-2026-157).
#
# This tool has a real DELETE path -- it exists specifically for files that
# a pcloud-post-sync-diff-forensics/1.0.0 report classified 'extra'
# (target_only_no_source_counterpart): the target (C:\HasarBotuStorage\...)
# holds a file that no longer has ANY source (P:\...) counterpart at that
# relative path, and pCloud's own live tree has no current object there
# either. This tool NEVER touches any other classification -- content_mismatch
# and metadata_only entries in the same report are silently ignored (they are
# repair-post-sync-stale-target-files.ps1's concern, not this tool's).
#
# Same Planla -> Onizle -> Apply model as every other write-capable tool in
# this directory: without -Apply this performs every read-only check and
# prints exactly what WOULD happen, writing NOTHING (no backup, no delete).
#
# Per file, in order, ALL of the following must hold FRESH (re-checked at
# cleanup time, never trusted from the possibly-stale forensics report)
# before any delete is attempted for that file:
#   - current TARGET SHA-256 == the report's recorded Target.Sha256
#     (target is still exactly the known orphan content -- if anything has
#     already changed it, this tool backs off rather than delete an unknown
#     state)
#   - SOURCE still does not exist at the same relative path under SourceRoot
#     (if a source has since appeared -- e.g. the file was re-added or the
#     classification was wrong -- this is no longer a safe delete candidate)
#   - pCloud's live tree still has NO current file object at that exact
#     relative path (found:false) -- if pCloud now reports a live object
#     there, something changed and this tool backs off
#   - target is not open for write/delete by anything else right now
#     (best-effort FileShare.Read probe)
#
# Only if every one of those holds does -Apply: back up the target's CURRENT
# content (Administrators-only, hashed) to a directory OUTSIDE the sync root
# (C:\HasarBotuStorage\...), verify the backup's SHA-256, delete the target
# file, then verify it no longer exists. pCloud settings, Add Sync, the sync
# mapping, source content, env and services are never touched. Any file that
# fails a check is left completely alone and reported BLOCKED with the
# reason; failure on one file never stops processing of the others.

$AdministratorSidValue = 'S-1-5-32-544'
$ReportDirectory = 'C:\ProgramData\HasarBotu\migration-preflight'
$DiffForensicsSchemaVersion = 'pcloud-post-sync-diff-forensics/1.0.0'

function Throw-SafeCleanupError {
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
    if (-not (Test-AdminOnlyAcl $Path $false)) { Throw-SafeCleanupError 'ADMIN_ONLY_ACL_APPLY_FAILED' }
}

function Get-NormalizedJsonArray {
    # Same PowerShell 5.1 ConvertFrom-Json/ConvertTo-Json round-trip quirk
    # guard as repair-post-sync-stale-target-files.ps1 (HB-2026-130).
    param($Value)
    if ($null -eq $Value) { return @() }
    if ($Value.PSObject.Properties.Match('value').Count -gt 0 -and $Value.PSObject.Properties.Match('Count').Count -gt 0) {
        return @($Value.value)
    }
    return @($Value)
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

function Get-OrphanCandidateEntries {
    # Only 'extra' (target_only_no_source_counterpart) entries are ever
    # candidates. Everything else in the report (content_mismatch,
    # metadata_only, missing, or any unrecognized classification) is
    # completely out of scope for this tool and is neither touched nor
    # reported as blocked -- it simply is not this tool's concern.
    param($report)
    $entries = Get-NormalizedJsonArray $report.Entries
    $candidates = @()
    foreach ($entry in $entries) {
        if ([string]$entry.Classification -ne 'extra') { continue }
        if ($null -eq $entry.Target) { continue }
        $candidates += [pscustomobject]@{
            Name   = [string]$entry.RelativePath
            Target = [pscustomobject]@{ FullPath = [string]$entry.Target.FullPath; Sha256 = [string]$entry.Target.Sha256 }
        }
    }
    return , $candidates
}

try {
    if ([string]::IsNullOrWhiteSpace($SourceRoot) -or [string]::IsNullOrWhiteSpace($TargetRoot)) {
        $companyFolder = 'BARAN GLOBAL EKSPERT' + [char]0x0130 + 'Z'
        if ([string]::IsNullOrWhiteSpace($SourceRoot)) { $SourceRoot = Join-Path 'P:\' $companyFolder }
        if ([string]::IsNullOrWhiteSpace($TargetRoot)) { $TargetRoot = Join-Path 'C:\HasarBotuStorage' $companyFolder }
    }
    $source = [System.IO.Path]::GetFullPath($SourceRoot).TrimEnd('\')
    $target = [System.IO.Path]::GetFullPath($TargetRoot).TrimEnd('\')

    if ([string]::IsNullOrWhiteSpace($GhostExclusionManifestPath)) { Throw-SafeCleanupError 'GHOST_EXCLUSION_MANIFEST_REQUIRED' }
    $manifestPath = [System.IO.Path]::GetFullPath($GhostExclusionManifestPath)
    $manifestSidecarPath = "$manifestPath.sha256"
    if (-not (Test-AdministratorsOnlyFile $manifestPath) -or -not (Test-AdministratorsOnlyFile $manifestSidecarPath)) {
        Throw-SafeCleanupError 'GHOST_EXCLUSION_ADMIN_ACL_REQUIRED'
    }
    $manifestSidecarText = [System.IO.File]::ReadAllText($manifestSidecarPath).Trim()
    $manifestSidecarMatch = [System.Text.RegularExpressions.Regex]::Match($manifestSidecarText, '^([a-f0-9]{64})  ([^\r\n]+)$')
    if (-not $manifestSidecarMatch.Success -or $manifestSidecarMatch.Groups[2].Value -ne [System.IO.Path]::GetFileName($manifestPath)) {
        Throw-SafeCleanupError 'GHOST_EXCLUSION_SIDECAR_INVALID'
    }
    $manifestHash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($manifestHash -ne $manifestSidecarMatch.Groups[1].Value) { Throw-SafeCleanupError 'GHOST_EXCLUSION_HASH_MISMATCH' }

    if ([string]::IsNullOrWhiteSpace($PCloudLocalDatabasePath)) {
        if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) { Throw-SafeCleanupError 'PCLOUD_LOCAL_DATABASE_NOT_CONFIGURED' }
        $PCloudLocalDatabasePath = Join-Path $env:LOCALAPPDATA 'pCloud\data.db'
    }
    $pcloudDatabaseFullPath = [System.IO.Path]::GetFullPath($PCloudLocalDatabasePath)
    if (-not [System.IO.File]::Exists($pcloudDatabaseFullPath)) { Throw-SafeCleanupError 'PCLOUD_LOCAL_DATABASE_NOT_FOUND' }

    $reportFullPath = [System.IO.Path]::GetFullPath($ForensicsReportPath)
    if (-not (Test-AdministratorsOnlyFile $reportFullPath)) { Throw-SafeCleanupError 'FORENSICS_REPORT_ADMIN_ACL_REQUIRED' }
    $reportActualHash = (Get-FileHash -LiteralPath $reportFullPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($reportActualHash -ne $ForensicsReportSha256.ToLowerInvariant()) { Throw-SafeCleanupError 'FORENSICS_REPORT_HASH_MISMATCH' }
    try {
        $report = [System.IO.File]::ReadAllText($reportFullPath) | ConvertFrom-Json
    }
    catch {
        Throw-SafeCleanupError 'FORENSICS_REPORT_JSON_INVALID'
    }
    if ($report.SchemaVersion -ne $DiffForensicsSchemaVersion) {
        Throw-SafeCleanupError 'FORENSICS_REPORT_SCHEMA_INVALID'
    }

    $nodeCommand = Get-Command node -CommandType Application -ErrorAction SilentlyContinue
    if ($null -eq $nodeCommand) { Throw-SafeCleanupError 'NODE_RUNTIME_NOT_FOUND' }
    $statePath = Join-Path $PSScriptRoot 'pcloud-stale-target-file-state.mjs'
    if (-not [System.IO.File]::Exists($statePath)) { Throw-SafeCleanupError 'STALE_TARGET_STATE_TOOL_NOT_FOUND' }

    if ([string]::IsNullOrWhiteSpace($BackupDirectory)) {
        $backupTimestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
        $BackupDirectory = Join-Path $ReportDirectory (Join-Path 'pre-delete-backups' $backupTimestamp)
    }
    $backupDirectoryFullPath = [System.IO.Path]::GetFullPath($BackupDirectory)
    if ($backupDirectoryFullPath.StartsWith($target, [StringComparison]::OrdinalIgnoreCase)) {
        Throw-SafeCleanupError 'BACKUP_DIRECTORY_INSIDE_SYNC_ROOT'
    }

    $candidateEntries = Get-OrphanCandidateEntries $report
    if ($candidateEntries.Count -eq 0) { Throw-SafeCleanupError 'NO_EXTRA_ENTRIES_IN_FORENSICS_REPORT' }

    if ($Apply -and -not [System.IO.Directory]::Exists($backupDirectoryFullPath)) {
        [System.IO.Directory]::CreateDirectory($backupDirectoryFullPath) | Out-Null
        [System.IO.Directory]::SetAccessControl($backupDirectoryFullPath, (New-AdminOnlySecurity $true))
    }

    $results = @()
    foreach ($entry in $candidateEntries) {
        $name = $entry.Name
        $targetPath = [string]$entry.Target.FullPath
        $expectedTargetSha256 = ([string]$entry.Target.Sha256).ToLowerInvariant()

        $blockers = [System.Collections.Generic.List[string]]::new()
        $applied = $false
        $backupPath = $null
        $backupSha256 = $null

        if (-not $targetPath.StartsWith($target, [StringComparison]::OrdinalIgnoreCase)) {
            $blockers.Add('PATH_OUTSIDE_EXPECTED_ROOT')
        }
        if (-not [System.IO.File]::Exists($targetPath)) { $blockers.Add('TARGET_FILE_NOT_FOUND') }

        $currentTargetSha256 = $null
        if ($blockers.Count -eq 0) {
            $currentTargetSha256 = (Get-FileHash -LiteralPath $targetPath -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($currentTargetSha256 -ne $expectedTargetSha256) { $blockers.Add('TARGET_CHANGED_SINCE_FORENSICS') }
        }

        $relativePath = $null
        $state = $null
        if ($blockers.Count -eq 0) {
            $relativePath = $targetPath.Substring($target.Length).TrimStart('\', '/')
            $sourceCandidatePath = Join-Path $source $relativePath
            if ([System.IO.File]::Exists($sourceCandidatePath)) {
                $blockers.Add('SOURCE_NOW_EXISTS')
            }
            else {
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
                    elseif ($state.found) {
                        # pCloud now has a live object at this exact path --
                        # no longer a proven orphan, back off.
                        $blockers.Add('PCLOUD_OBJECT_NOW_FOUND')
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
                $backupPath = Join-Path $backupDirectoryFullPath "$safeName.orphan-target.bak"
                [System.IO.File]::Copy($targetPath, $backupPath, $true)
                Set-AdminOnlyFileSecurity $backupPath
                $backupSha256 = (Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash.ToLowerInvariant()
                if ($backupSha256 -ne $currentTargetSha256) { Throw-SafeCleanupError 'BACKUP_HASH_MISMATCH' }
                $backupSidecarPath = "$backupPath.sha256"
                [System.IO.File]::WriteAllText($backupSidecarPath, "$backupSha256  $safeName.orphan-target.bak", [System.Text.UTF8Encoding]::new($false))
                Set-AdminOnlyFileSecurity $backupSidecarPath

                [System.IO.File]::Delete($targetPath)
                if ([System.IO.File]::Exists($targetPath)) { Throw-SafeCleanupError 'POST_DELETE_FILE_STILL_EXISTS' }
                $applied = $true
            }
            catch {
                $code = if ($null -ne $_.Exception.Data -and $_.Exception.Data.Contains('SafeCode')) { [string]$_.Exception.Data['SafeCode'] } else { 'CLEANUP_APPLY_RUNTIME_ERROR' }
                $blockers.Add($code)
                $blockers.Add("EXCEPTION_MESSAGE: $($_.Exception.Message)")
            }
        }

        $results += [pscustomobject]@{
            Name = $name
            Mode = if ($Apply) { 'apply' } else { 'preview' }
            Status = if ($blockers.Count -gt 0) { 'blocked' } elseif ($Apply) { if ($applied) { 'applied' } else { 'blocked' } } else { 'would_apply' }
            Blockers = @($blockers)
            TargetPath = $targetPath
            ExpectedTargetSha256 = $expectedTargetSha256
            CurrentTargetSha256AtCheckTime = $currentTargetSha256
            PCloudState = $state
            BackupPath = $backupPath
            BackupSha256 = $backupSha256
        }
    }

    $overallStatus = if (@($results | Where-Object { $_.Status -eq 'blocked' }).Count -gt 0) { 'partial_or_blocked' }
        elseif ($Apply) { 'applied' } else { 'preview_ok' }

    $output = [ordered]@{
        SchemaVersion = 'hasarbotu-target-only-orphan-cleanup/1.0.0'
        Mode = if ($Apply) { 'apply' } else { 'preview' }
        GeneratedAtUtc = [DateTime]::UtcNow.ToString('o')
        ForensicsReportSchemaVersion = [string]$report.SchemaVersion
        ForensicsReportPath = $reportFullPath
        ForensicsReportSha256 = $reportActualHash
        BackupDirectory = $backupDirectoryFullPath
        OverallStatus = $overallStatus
        Files = $results
    }

    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [System.Security.Principal.WindowsPrincipal]::new($identity)
    if ($Apply -and -not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Throw-SafeCleanupError 'ADMINISTRATOR_REQUIRED_FOR_APPLY'
    }

    if ($Apply) {
        if (-not [System.IO.Directory]::Exists($ReportDirectory)) { [System.IO.Directory]::CreateDirectory($ReportDirectory) | Out-Null }
        [System.IO.Directory]::SetAccessControl($ReportDirectory, (New-AdminOnlySecurity $true))
        $timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
        $suffix = [Guid]::NewGuid().ToString('N').Substring(0, 8)
        $fileName = "target-only-orphan-cleanup-$timestamp-$suffix.json"
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
            DeletedCount = @($results | Where-Object { $_.Status -eq 'applied' }).Count
            BlockedCount = @($results | Where-Object { $_.Status -eq 'blocked' }).Count
            Report = [ordered]@{ FileName = $fileName; Sha256 = $reportHash; AdminOnly = $true }
        } | ConvertTo-Json -Depth 4)
    }
    else {
        Write-Output ([ordered]@{
            OverallStatus = $overallStatus
            WouldDeleteCount = @($results | Where-Object { $_.Status -eq 'would_apply' }).Count
            BlockedCount = @($results | Where-Object { $_.Status -eq 'blocked' }).Count
            PerFile = @($results | ForEach-Object { [ordered]@{ Name = $_.Name; Status = $_.Status; Blockers = $_.Blockers } })
        } | ConvertTo-Json -Depth 6)
    }
    exit 0
}
catch {
    $safeError = [ordered]@{
        SchemaVersion = 'hasarbotu-target-only-orphan-cleanup/1.0.0'
        Status = 'error'
        ErrorCode = if ($null -ne $_.Exception.Data -and $_.Exception.Data.Contains('SafeCode')) { [string]$_.Exception.Data['SafeCode'] } else { 'CLEANUP_RUNTIME_ERROR' }
        ErrorType = $_.Exception.GetType().Name
        ErrorLine = $_.InvocationInfo.ScriptLineNumber
    }
    $safeError | ConvertTo-Json -Depth 4
    exit 1
}
