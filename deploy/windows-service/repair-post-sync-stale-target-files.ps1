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
    if ($report.SchemaVersion -ne 'hasarbotu-56aag629-hasar-version-forensics/1.0.0') {
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

    $names = @($report.Classification.PSObject.Properties | Where-Object { $_.Value -eq 'source_current_valid' } | ForEach-Object { $_.Name })
    if ($names.Count -eq 0) { Throw-SafeRepairError 'NO_SOURCE_CURRENT_VALID_ENTRIES' }

    $normalizedFiles = Get-NormalizedJsonArray $report.Files
    $fileEntries = @()
    foreach ($name in $names) {
        $entry = $normalizedFiles | Where-Object { $_.Name -eq $name } | Select-Object -First 1
        if ($null -eq $entry) { Throw-SafeRepairError 'FORENSICS_REPORT_ENTRY_MISSING' }
        $fileEntries += $entry
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
            if (-not (Get-JpegIntegrityOk $sourcePath)) { $blockers.Add('SOURCE_JPEG_INTEGRITY_FAILED') }
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
                    $revisions = @($state.revisions)
                    if ($revisions.Count -lt 1 -or [int64]$revisions[0].size -ne [int64]([System.IO.FileInfo]::new($targetPath)).Length) {
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
                    if (-not (Get-JpegIntegrityOk $stagedPath)) { Throw-SafeRepairError 'STAGED_JPEG_INTEGRITY_FAILED' }

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
        }
    }

    $overallStatus = if (@($results | Where-Object { $_.Status -eq 'blocked' }).Count -gt 0) { 'partial_or_blocked' }
        elseif ($Apply) { 'applied' } else { 'preview_ok' }

    $output = [ordered]@{
        SchemaVersion = 'hasarbotu-stale-target-file-repair/1.0.0'
        Mode = if ($Apply) { 'apply' } else { 'preview' }
        GeneratedAtUtc = [DateTime]::UtcNow.ToString('o')
        ForensicsReportPath = $reportFullPath
        ForensicsReportSha256 = $reportActualHash
        BackupDirectory = $backupDirectoryFullPath
        OverallStatus = $overallStatus
        Files = $results
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
            Report = [ordered]@{ FileName = $fileName; Sha256 = $reportHash; AdminOnly = $true }
        } | ConvertTo-Json -Depth 4)
    }
    else {
        Write-Output ([ordered]@{
            OverallStatus = $overallStatus
            WouldApplyCount = @($results | Where-Object { $_.Status -eq 'would_apply' }).Count
            BlockedCount = @($results | Where-Object { $_.Status -eq 'blocked' }).Count
            PerFile = @($results | ForEach-Object { [ordered]@{ Name = $_.Name; Status = $_.Status; Blockers = $_.Blockers } })
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
