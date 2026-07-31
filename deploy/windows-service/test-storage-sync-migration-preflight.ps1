[CmdletBinding()]
param(
    [ValidateSet('BeforeSync', 'AfterSync')]
    [string]$Stage = 'BeforeSync',

    [string]$SourceRoot,

    [string]$TargetRoot,

    [ValidateRange(1, 10)]
    [int]$RequiredFreeMultiplier = 3,

    [ValidateRange(0, 10000)]
    [int]$ProgressInterval = 500,

    [string]$GhostExclusionManifestPath,

    [string]$PCloudLocalDatabasePath,

    [string]$BeforeSyncReportPath,

    [ValidatePattern('^[a-fA-F0-9]{64}$')]
    [string]$BeforeSyncReportSha256
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# D7 salt-okunur gecis preflight araci.
#
# Guvenlik siniri:
# - Dosya/klasor/ACL/registry/environment/service DEGISIKLIGI YAPMAZ.
# - Kaynak veya hedefte gecici kanit dosyasi OLUSTURMAZ.
# - Gercek dosya adlarini, goreli/mutlak yollari veya hata mesajlarini
#   ciktiya YAZMAZ.
# - Hash + Administrators-only ACL ile korunan exact ghost exclusion manifesti
#   olmadan taramaya BASLAMAZ. Yalniz manifestteki 10 exact path/fileId cifti,
#   canli yerel pCloud DB kaydi da birebir eslesirse kaynak snapshot'indan
#   cikarilir. Wildcard, uzanti veya klasor kurali YOKTUR.
# - BeforeSync: hedefin boslugunu, 3x kapasiteyi ve kaynaktaki HER dosyanin
#   SHA-256 ile gercekten okunabildigini fail-closed dogrular.
# - AfterSync: hashli ve Administrators-only BeforeSync PASS raporunu zorunlu
#   kilar. Guncel kaynagin tam manifesti bu sabit baseline ile ayni kalmali;
#   ayrica iki kokteki HER dosya goreli-yol eslemeli SHA-256 ile eslesmelidir.
#   Eksik/fazla/hash farki veya tarama sirasinda kaynak/hedef degisimi varsa
#   fail-closed durur.

function Add-Blocker {
    param(
        [System.Collections.Generic.List[string]]$List,
        [string]$Code
    )

    if (-not $List.Contains($Code)) {
        $List.Add($Code)
    }
}

function Add-ErrorCount {
    param(
        [System.Collections.Generic.Dictionary[string, int]]$Counts,
        [string]$Code
    )

    if ($Counts.ContainsKey($Code)) {
        $Counts[$Code] = $Counts[$Code] + 1
    }
    else {
        $Counts.Add($Code, 1)
    }
}

function Throw-SafePreflightError {
    param([string]$Code)

    $exception = [System.InvalidOperationException]::new($Code)
    $exception.Data['SafeCode'] = $Code
    throw $exception
}

function Test-AdministratorsOnlyFile {
    param([string]$Path)

    try {
        if (-not [System.IO.File]::Exists($Path)) {
            return $false
        }

        $acl = Get-Acl -LiteralPath $Path
        if (-not $acl.AreAccessRulesProtected) {
            return $false
        }

        $administratorsSid = 'S-1-5-32-544'
        $ownerSid = ([System.Security.Principal.NTAccount]$acl.Owner).Translate(
            [System.Security.Principal.SecurityIdentifier]
        ).Value
        if ($ownerSid -ne $administratorsSid) {
            return $false
        }

        $rules = @($acl.GetAccessRules(
            $true,
            $true,
            [System.Security.Principal.SecurityIdentifier]
        ))
        if ($rules.Count -ne 1) {
            return $false
        }

        $rule = $rules[0]
        $fullControl = [System.Security.AccessControl.FileSystemRights]::FullControl
        return (
            $rule.IdentityReference.Value -eq $administratorsSid -and
            $rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
            -not $rule.IsInherited -and
            ($rule.FileSystemRights -band $fullControl) -eq $fullControl
        )
    }
    catch {
        return $false
    }
}

function Test-JsonProperty {
    param(
        $Object,
        [string]$Name
    )

    return (
        $null -ne $Object -and
        $null -ne $Object.PSObject.Properties[$Name]
    )
}

function Get-ValidatedBeforeSyncBaseline {
    param(
        [string]$ReportPath,
        [string]$ExpectedSha256
    )

    if ([string]::IsNullOrWhiteSpace($ReportPath)) {
        Throw-SafePreflightError 'BEFORE_SYNC_REPORT_REQUIRED'
    }
    if ($ExpectedSha256 -cnotmatch '^[a-fA-F0-9]{64}$') {
        Throw-SafePreflightError 'BEFORE_SYNC_REPORT_SHA256_REQUIRED'
    }

    $reportFullPath = [System.IO.Path]::GetFullPath($ReportPath)
    if (-not (Test-AdministratorsOnlyFile $reportFullPath)) {
        Throw-SafePreflightError 'BEFORE_SYNC_REPORT_ADMIN_ACL_REQUIRED'
    }

    $actualHash = (
        Get-FileHash -LiteralPath $reportFullPath -Algorithm SHA256
    ).Hash.ToLowerInvariant()
    if ($actualHash -ne $ExpectedSha256.ToLowerInvariant()) {
        Throw-SafePreflightError 'BEFORE_SYNC_REPORT_HASH_MISMATCH'
    }

    try {
        $report = [System.IO.File]::ReadAllText($reportFullPath) | ConvertFrom-Json
    }
    catch {
        Throw-SafePreflightError 'BEFORE_SYNC_REPORT_JSON_INVALID'
    }

    foreach ($propertyName in @(
        'SchemaVersion',
        'Stage',
        'Status',
        'ReadOnly',
        'Source',
        'GhostExclusion',
        'Target',
        'Blockers'
    )) {
        if (-not (Test-JsonProperty $report $propertyName)) {
            Throw-SafePreflightError 'BEFORE_SYNC_REPORT_SHAPE_INVALID'
        }
    }

    if (
        $report.SchemaVersion -notin @(
            'storage-sync-migration-preflight/1.1.0',
            'storage-sync-migration-preflight/1.2.0'
        ) -or
        $report.Stage -ne 'BeforeSync' -or
        $report.Status -ne 'pass' -or
        $report.ReadOnly -ne $true -or
        @($report.Blockers).Count -ne 0
    ) {
        Throw-SafePreflightError 'BEFORE_SYNC_REPORT_NOT_PASS'
    }

    foreach ($propertyName in @(
        'FileCount',
        'DirectoryCount',
        'Bytes',
        'ReparsePointCount',
        'HashedFileCount',
        'HashErrorCount',
        'ManifestSha256',
        'SnapshotStable'
    )) {
        if (-not (Test-JsonProperty $report.Source $propertyName)) {
            Throw-SafePreflightError 'BEFORE_SYNC_REPORT_SOURCE_INVALID'
        }
    }
    foreach ($propertyName in @('ManifestSha256', 'EntryCount')) {
        if (-not (Test-JsonProperty $report.GhostExclusion $propertyName)) {
            Throw-SafePreflightError 'BEFORE_SYNC_REPORT_EXCLUSION_INVALID'
        }
    }
    foreach ($propertyName in @('IsEmpty', 'SnapshotStable')) {
        if (-not (Test-JsonProperty $report.Target $propertyName)) {
            Throw-SafePreflightError 'BEFORE_SYNC_REPORT_TARGET_INVALID'
        }
    }

    if (
        $report.Source.ManifestSha256 -cnotmatch '^[a-f0-9]{64}$' -or
        $report.Source.FileCount -ne $report.Source.HashedFileCount -or
        $report.Source.HashErrorCount -ne 0 -or
        $report.Source.ReparsePointCount -ne 0 -or
        $report.Source.SnapshotStable -ne $true -or
        $report.GhostExclusion.ManifestSha256 -cnotmatch '^[a-f0-9]{64}$' -or
        $report.GhostExclusion.EntryCount -ne 10 -or
        $report.Target.IsEmpty -ne $true -or
        $report.Target.SnapshotStable -ne $true
    ) {
        Throw-SafePreflightError 'BEFORE_SYNC_REPORT_BASELINE_INVALID'
    }

    return [pscustomobject]@{
        ReportSha256 = $actualHash
        SourceFileCount = [int64]$report.Source.FileCount
        SourceDirectoryCount = [int64]$report.Source.DirectoryCount
        SourceBytes = [int64]$report.Source.Bytes
        SourceManifestSha256 = [string]$report.Source.ManifestSha256
        GhostManifestSha256 = [string]$report.GhostExclusion.ManifestSha256
    }
}

function Get-ValidatedGhostExclusion {
    param(
        [string]$ManifestPath,
        [string]$SourceRoot,
        [string]$PCloudDatabasePath
    )

    if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
        Throw-SafePreflightError 'GHOST_EXCLUSION_MANIFEST_REQUIRED'
    }

    $manifestFullPath = [System.IO.Path]::GetFullPath($ManifestPath)
    $sidecarPath = $manifestFullPath + '.sha256'
    if (
        -not (Test-AdministratorsOnlyFile $manifestFullPath) -or
        -not (Test-AdministratorsOnlyFile $sidecarPath)
    ) {
        Throw-SafePreflightError 'GHOST_EXCLUSION_ADMIN_ACL_REQUIRED'
    }

    $sidecarText = [System.IO.File]::ReadAllText($sidecarPath).Trim()
    $sidecarMatch = [System.Text.RegularExpressions.Regex]::Match(
        $sidecarText,
        '^([a-f0-9]{64})  ([^\r\n]+)$',
        [System.Text.RegularExpressions.RegexOptions]::CultureInvariant
    )
    if (
        -not $sidecarMatch.Success -or
        $sidecarMatch.Groups[2].Value -ne [System.IO.Path]::GetFileName($manifestFullPath)
    ) {
        Throw-SafePreflightError 'GHOST_EXCLUSION_SIDECAR_INVALID'
    }

    $actualHash = (Get-FileHash -LiteralPath $manifestFullPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $sidecarMatch.Groups[1].Value) {
        Throw-SafePreflightError 'GHOST_EXCLUSION_HASH_MISMATCH'
    }

    if ([string]::IsNullOrWhiteSpace($PCloudDatabasePath)) {
        if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
            Throw-SafePreflightError 'PCLOUD_LOCAL_DATABASE_NOT_CONFIGURED'
        }
        $PCloudDatabasePath = Join-Path $env:LOCALAPPDATA 'pCloud\data.db'
    }
    $pcloudDatabaseFullPath = [System.IO.Path]::GetFullPath($PCloudDatabasePath)
    if (-not [System.IO.File]::Exists($pcloudDatabaseFullPath)) {
        Throw-SafePreflightError 'PCLOUD_LOCAL_DATABASE_NOT_FOUND'
    }

    $validatorPath = Join-Path $PSScriptRoot 'validate-storage-ghost-exclusion.mjs'
    if (-not [System.IO.File]::Exists($validatorPath)) {
        Throw-SafePreflightError 'GHOST_EXCLUSION_VALIDATOR_NOT_FOUND'
    }

    $nodeCommand = Get-Command node -CommandType Application -ErrorAction SilentlyContinue
    if ($null -eq $nodeCommand) {
        Throw-SafePreflightError 'NODE_RUNTIME_NOT_FOUND'
    }

    try {
        $stdout = & $nodeCommand.Source `
            $validatorPath `
            '--manifest' $manifestFullPath `
            '--source-root' $SourceRoot `
            '--pcloud-db' $pcloudDatabaseFullPath `
            2>$null | Out-String
        $validatorExitCode = $LASTEXITCODE
    }
    catch {
        Throw-SafePreflightError 'GHOST_EXCLUSION_VALIDATOR_START_FAILED'
    }

    try {
        $validation = $stdout | ConvertFrom-Json
    }
    catch {
        Throw-SafePreflightError 'GHOST_EXCLUSION_VALIDATOR_OUTPUT_INVALID'
    }

    if ($validation.Status -ne 'pass' -or $validatorExitCode -ne 0) {
        $safeCode = [string]$validation.ErrorCode
        if ($safeCode -cnotmatch '^[A-Z0-9_]+$') {
            $safeCode = 'GHOST_EXCLUSION_VALIDATION_FAILED'
        }
        Throw-SafePreflightError $safeCode
    }
    if (
        $validation.EntryCount -ne 10 -or
        $validation.ExactPathMatchedCount -ne 10 -or
        $validation.LocalDbMatchedCount -ne 10 -or
        $validation.WildcardRuleCount -ne 0 -or
        $validation.ExtensionRuleCount -ne 0 -or
        $validation.FolderRuleCount -ne 0
    ) {
        Throw-SafePreflightError 'GHOST_EXCLUSION_VALIDATION_COUNTS_INVALID'
    }

    try {
        $manifest = [System.IO.File]::ReadAllText($manifestFullPath) | ConvertFrom-Json
    }
    catch {
        Throw-SafePreflightError 'GHOST_EXCLUSION_MANIFEST_JSON_INVALID'
    }

    $relativePaths = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::OrdinalIgnoreCase
    )
    foreach ($entry in $manifest.Entries) {
        if (-not $relativePaths.Add([string]$entry.RelativePath)) {
            Throw-SafePreflightError 'GHOST_EXCLUSION_DUPLICATE_PATH'
        }
    }

    return [pscustomobject]@{
        RelativePaths = $relativePaths
        EntryCount = 10
        ManifestSha256 = $actualHash
        LocalDbMatchedCount = 10
    }
}

function ConvertTo-Hex {
    param([byte[]]$Bytes)

    return ([System.BitConverter]::ToString($Bytes)).Replace('-', '').ToLowerInvariant()
}

function Get-SafeRoot {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        throw [System.ArgumentException]::new('ROOT_NOT_CONFIGURED')
    }

    $fullPath = [System.IO.Path]::GetFullPath($Path).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )

    if (-not [System.IO.Directory]::Exists($fullPath)) {
        throw [System.IO.DirectoryNotFoundException]::new('ROOT_NOT_FOUND')
    }

    return $fullPath
}

function Get-TreeSnapshot {
    param(
        [string]$Root,
        [System.Collections.Generic.HashSet[string]]$ExcludedRelativePaths
    )

    $rootInfo = [System.IO.DirectoryInfo]::new($Root)
    $rootInfo.Refresh()

    $rootIsReparsePoint = [bool](
        $rootInfo.Attributes -band [System.IO.FileAttributes]::ReparsePoint
    )

    $files = [System.Collections.Generic.List[object]]::new()
    $fileMap = [System.Collections.Generic.Dictionary[string, object]]::new(
        [System.StringComparer]::OrdinalIgnoreCase
    )
    $directories = 0
    $reparsePoints = 0
    $bytes = [int64]0
    $observedFiles = 0
    $observedBytes = [int64]0
    $excludedFiles = 0
    $excludedBytes = [int64]0

    if ($rootIsReparsePoint) {
        $reparsePoints = 1
    }
    else {
        $stack = [System.Collections.Generic.Stack[System.IO.DirectoryInfo]]::new()
        $stack.Push($rootInfo)

        while ($stack.Count -gt 0) {
            $current = $stack.Pop()

            foreach ($entry in $current.EnumerateFileSystemInfos()) {
                $isReparsePoint = [bool](
                    $entry.Attributes -band [System.IO.FileAttributes]::ReparsePoint
                )

                if ($isReparsePoint) {
                    $reparsePoints++
                    continue
                }

                if ($entry -is [System.IO.DirectoryInfo]) {
                    $directories++
                    $stack.Push($entry)
                    continue
                }

                $file = [System.IO.FileInfo]$entry
                $relativePath = $file.FullName.Substring($Root.Length).TrimStart(
                    [System.IO.Path]::DirectorySeparatorChar,
                    [System.IO.Path]::AltDirectorySeparatorChar
                )

                $observedFiles++
                $observedBytes += [int64]$file.Length
                if (
                    $null -ne $ExcludedRelativePaths -and
                    $ExcludedRelativePaths.Contains($relativePath)
                ) {
                    $excludedFiles++
                    $excludedBytes += [int64]$file.Length
                    continue
                }

                $record = [pscustomobject]@{
                    RelativePath = $relativePath
                    FullName = $file.FullName
                    Length = [int64]$file.Length
                    LastWriteTicks = [int64]$file.LastWriteTimeUtc.Ticks
                }

                # Windows hedefi case-insensitive oldugu icin ayni goreli yolun
                # farkli buyuk/kucuk harfli tekrarini sessizce ezme.
                $fileMap.Add($relativePath, $record)
                $files.Add($record)
                $bytes += [int64]$file.Length
            }
        }
    }

    return [pscustomobject]@{
        Files = $files
        FileMap = $fileMap
        FileCount = $files.Count
        DirectoryCount = $directories
        Bytes = $bytes
        ReparsePointCount = $reparsePoints
        ObservedFileCount = $observedFiles
        ObservedBytes = $observedBytes
        ExcludedFileCount = $excludedFiles
        ExcludedBytes = $excludedBytes
    }
}

function Test-SnapshotEqual {
    param(
        $Before,
        $After
    )

    if (
        $Before.FileCount -ne $After.FileCount -or
        $Before.DirectoryCount -ne $After.DirectoryCount -or
        $Before.Bytes -ne $After.Bytes -or
        $Before.ReparsePointCount -ne $After.ReparsePointCount -or
        $Before.ObservedFileCount -ne $After.ObservedFileCount -or
        $Before.ObservedBytes -ne $After.ObservedBytes -or
        $Before.ExcludedFileCount -ne $After.ExcludedFileCount -or
        $Before.ExcludedBytes -ne $After.ExcludedBytes
    ) {
        return $false
    }

    foreach ($record in $Before.Files) {
        if (-not $After.FileMap.ContainsKey($record.RelativePath)) {
            return $false
        }

        $current = $After.FileMap[$record.RelativePath]
        if (
            $current.Length -ne $record.Length -or
            $current.LastWriteTicks -ne $record.LastWriteTicks
        ) {
            return $false
        }
    }

    return $true
}

function Get-SnapshotDelta {
    param(
        $Before,
        $After
    )

    $added = 0
    $removed = 0
    $metadataChanged = 0

    foreach ($record in $After.Files) {
        if (-not $Before.FileMap.ContainsKey($record.RelativePath)) {
            $added++
        }
    }

    foreach ($record in $Before.Files) {
        if (-not $After.FileMap.ContainsKey($record.RelativePath)) {
            $removed++
            continue
        }

        $current = $After.FileMap[$record.RelativePath]
        if (
            $current.Length -ne $record.Length -or
            $current.LastWriteTicks -ne $record.LastWriteTicks
        ) {
            $metadataChanged++
        }
    }

    return [pscustomobject]@{
        AddedFileCount = $added
        RemovedFileCount = $removed
        MetadataChangedFileCount = $metadataChanged
        FileCountDelta = $After.FileCount - $Before.FileCount
        DirectoryCountDelta = $After.DirectoryCount - $Before.DirectoryCount
        BytesDelta = $After.Bytes - $Before.Bytes
        ReparsePointCountDelta = (
            $After.ReparsePointCount - $Before.ReparsePointCount
        )
        ObservedFileCountDelta = $After.ObservedFileCount - $Before.ObservedFileCount
        ObservedBytesDelta = $After.ObservedBytes - $Before.ObservedBytes
        ExcludedFileCountDelta = $After.ExcludedFileCount - $Before.ExcludedFileCount
        ExcludedBytesDelta = $After.ExcludedBytes - $Before.ExcludedBytes
    }
}

function Get-FullHashSet {
    param(
        $Snapshot,
        [string]$Label,
        [int]$Interval
    )

    $hashes = [System.Collections.Generic.Dictionary[string, string]]::new(
        [System.StringComparer]::OrdinalIgnoreCase
    )
    $errors = [System.Collections.Generic.Dictionary[string, int]]::new(
        [System.StringComparer]::Ordinal
    )
    $manifestRows = [System.Collections.Generic.List[string]]::new()
    $processed = 0

    foreach ($record in $Snapshot.Files) {
        $stream = $null
        $sha = $null

        try {
            $stream = [System.IO.File]::Open(
                $record.FullName,
                [System.IO.FileMode]::Open,
                [System.IO.FileAccess]::Read,
                [System.IO.FileShare]::Read
            )
            $sha = [System.Security.Cryptography.SHA256]::Create()
            $hash = ConvertTo-Hex ($sha.ComputeHash($stream))

            $current = [System.IO.FileInfo]::new($record.FullName)
            $current.Refresh()
            if (
                -not $current.Exists -or
                $current.Length -ne $record.Length -or
                $current.LastWriteTimeUtc.Ticks -ne $record.LastWriteTicks
            ) {
                Add-ErrorCount $errors 'FILE_CHANGED_DURING_HASH'
            }
            else {
                $hashes.Add($record.RelativePath, $hash)
                $manifestRows.Add(
                    $record.RelativePath + [char]0 +
                    $record.Length.ToString([Globalization.CultureInfo]::InvariantCulture) +
                    [char]0 + $hash
                )
            }
        }
        catch [System.IO.IOException] {
            Add-ErrorCount $errors 'IO_ERROR'
        }
        catch [System.UnauthorizedAccessException] {
            Add-ErrorCount $errors 'ACCESS_DENIED'
        }
        catch [System.Security.SecurityException] {
            Add-ErrorCount $errors 'SECURITY_ERROR'
        }
        catch {
            Add-ErrorCount $errors 'UNEXPECTED_READ_ERROR'
        }
        finally {
            if ($null -ne $sha) {
                $sha.Dispose()
            }
            if ($null -ne $stream) {
                $stream.Dispose()
            }
        }

        $processed++
        if ($Interval -gt 0 -and ($processed % $Interval) -eq 0) {
            Write-Host (
                'HASH_PROGRESS label={0} processed={1} total={2}' -f
                $Label,
                $processed,
                $Snapshot.FileCount
            )
        }
    }

    $manifestSha256 = $null
    if ($errors.Count -eq 0 -and $hashes.Count -eq $Snapshot.FileCount) {
        $rows = $manifestRows.ToArray()
        [System.Array]::Sort($rows, [System.StringComparer]::Ordinal)
        $manifestText = [string]::Join("`n", $rows)
        $manifestBytes = [System.Text.Encoding]::UTF8.GetBytes($manifestText)
        $manifestHasher = [System.Security.Cryptography.SHA256]::Create()
        try {
            $manifestSha256 = ConvertTo-Hex ($manifestHasher.ComputeHash($manifestBytes))
        }
        finally {
            $manifestHasher.Dispose()
        }
    }

    $errorSummary = @()
    $errorCount = 0
    foreach ($entry in $errors.GetEnumerator() | Sort-Object Key) {
        $errorSummary += [pscustomobject]@{
            Code = $entry.Key
            Count = $entry.Value
        }
        $errorCount += $entry.Value
    }

    return [pscustomobject]@{
        Hashes = $hashes
        HashedFileCount = $hashes.Count
        ErrorCount = $errorCount
        Errors = $errorSummary
        ManifestSha256 = $manifestSha256
    }
}

function Get-HashComparison {
    param(
        $SourceHashes,
        $TargetHashes
    )

    $missing = 0
    $extra = 0
    $mismatch = 0

    foreach ($entry in $SourceHashes.GetEnumerator()) {
        if (-not $TargetHashes.ContainsKey($entry.Key)) {
            $missing++
        }
        elseif ($TargetHashes[$entry.Key] -ne $entry.Value) {
            $mismatch++
        }
    }

    foreach ($entry in $TargetHashes.GetEnumerator()) {
        if (-not $SourceHashes.ContainsKey($entry.Key)) {
            $extra++
        }
    }

    return [pscustomobject]@{
        MissingFileCount = $missing
        ExtraFileCount = $extra
        HashMismatchCount = $mismatch
    }
}

$startedAtUtc = [DateTime]::UtcNow
$blockers = [System.Collections.Generic.List[string]]::new()
$exitCode = 1

try {
    $beforeSyncBaseline = $null
    if ($Stage -eq 'AfterSync') {
        $beforeSyncBaseline = Get-ValidatedBeforeSyncBaseline `
            $BeforeSyncReportPath `
            $BeforeSyncReportSha256
    }

    if ([string]::IsNullOrWhiteSpace($SourceRoot) -or [string]::IsNullOrWhiteSpace($TargetRoot)) {
        $companyFolder = 'BARAN GLOBAL EKSPERT' + [char]0x0130 + 'Z'
        if ([string]::IsNullOrWhiteSpace($SourceRoot)) {
            $SourceRoot = Join-Path 'P:\' $companyFolder
        }
        if ([string]::IsNullOrWhiteSpace($TargetRoot)) {
            $TargetRoot = Join-Path 'C:\HasarBotuStorage' $companyFolder
        }
    }

    $source = Get-SafeRoot $SourceRoot
    $target = Get-SafeRoot $TargetRoot

    if ([string]::Equals($source, $target, [StringComparison]::OrdinalIgnoreCase)) {
        throw [System.ArgumentException]::new('ROOTS_MUST_BE_DIFFERENT')
    }

    $ghostExclusion = Get-ValidatedGhostExclusion `
        $GhostExclusionManifestPath `
        $source `
        $PCloudLocalDatabasePath

    if (
        $null -ne $beforeSyncBaseline -and
        $beforeSyncBaseline.GhostManifestSha256 -ne $ghostExclusion.ManifestSha256
    ) {
        Throw-SafePreflightError 'BEFORE_SYNC_EXCLUSION_MANIFEST_MISMATCH'
    }

    $sourceBefore = Get-TreeSnapshot $source $ghostExclusion.RelativePaths
    $targetBefore = Get-TreeSnapshot $target $null

    $targetDriveRoot = [System.IO.Path]::GetPathRoot($target)
    $targetDrive = [System.IO.DriveInfo]::new($targetDriveRoot)
    $requiredFreeBytesDecimal = [decimal]$sourceBefore.Bytes * [decimal]$RequiredFreeMultiplier
    $capacityPass = [decimal]$targetDrive.AvailableFreeSpace -ge $requiredFreeBytesDecimal

    if ($sourceBefore.ReparsePointCount -gt 0) {
        Add-Blocker $blockers 'SOURCE_REPARSE_POINT_FOUND'
    }
    if ($sourceBefore.ExcludedFileCount -ne $ghostExclusion.EntryCount) {
        Throw-SafePreflightError 'SOURCE_GHOST_EXCLUSION_SET_MISMATCH'
    }
    if ($targetBefore.ReparsePointCount -gt 0) {
        Add-Blocker $blockers 'TARGET_REPARSE_POINT_FOUND'
    }
    if (-not $capacityPass -and $Stage -eq 'BeforeSync') {
        Add-Blocker $blockers 'CAPACITY_BELOW_THRESHOLD'
    }
    if (
        $Stage -eq 'BeforeSync' -and
        (
            $targetBefore.FileCount -gt 0 -or
            $targetBefore.DirectoryCount -gt 0 -or
            $targetBefore.ReparsePointCount -gt 0
        )
    ) {
        Add-Blocker $blockers 'TARGET_NOT_EMPTY'
    }

    $sourceHashResult = Get-FullHashSet $sourceBefore 'source' $ProgressInterval
    if ($sourceHashResult.ErrorCount -gt 0) {
        Add-Blocker $blockers 'SOURCE_FULL_HASH_INCOMPLETE'
    }

    $sourceBaselineMatch = $null
    if ($Stage -eq 'AfterSync') {
        $sourceBaselineMatch = (
            $sourceHashResult.ErrorCount -eq 0 -and
            $sourceBefore.FileCount -eq $beforeSyncBaseline.SourceFileCount -and
            $sourceBefore.DirectoryCount -eq $beforeSyncBaseline.SourceDirectoryCount -and
            $sourceBefore.Bytes -eq $beforeSyncBaseline.SourceBytes -and
            $sourceHashResult.ManifestSha256 -eq $beforeSyncBaseline.SourceManifestSha256
        )
        if (-not $sourceBaselineMatch) {
            Add-Blocker $blockers 'SOURCE_BASELINE_CHANGED_SINCE_BEFORE_SYNC'
        }
    }

    $targetHashResult = $null
    $comparison = $null
    if ($Stage -eq 'AfterSync') {
        $targetHashResult = Get-FullHashSet $targetBefore 'target' $ProgressInterval
        if ($targetHashResult.ErrorCount -gt 0) {
            Add-Blocker $blockers 'TARGET_FULL_HASH_INCOMPLETE'
        }

        if (
            $sourceHashResult.ErrorCount -eq 0 -and
            $targetHashResult.ErrorCount -eq 0
        ) {
            $comparison = Get-HashComparison `
                $sourceHashResult.Hashes `
                $targetHashResult.Hashes

            if (
                $comparison.MissingFileCount -gt 0 -or
                $comparison.ExtraFileCount -gt 0 -or
                $comparison.HashMismatchCount -gt 0
            ) {
                Add-Blocker $blockers 'FULL_HASH_COMPARISON_FAILED'
            }
        }
        else {
            Add-Blocker $blockers 'FULL_HASH_COMPARISON_NOT_ELIGIBLE'
        }
    }

    $sourceAfter = Get-TreeSnapshot $source $ghostExclusion.RelativePaths
    $targetAfter = Get-TreeSnapshot $target $null
    $sourceStable = Test-SnapshotEqual $sourceBefore $sourceAfter
    $targetStable = Test-SnapshotEqual $targetBefore $targetAfter
    $sourceDelta = Get-SnapshotDelta $sourceBefore $sourceAfter
    $targetDelta = Get-SnapshotDelta $targetBefore $targetAfter

    if (-not $sourceStable) {
        Add-Blocker $blockers 'SOURCE_CHANGED_DURING_PREFLIGHT'
    }
    if ($sourceAfter.ExcludedFileCount -ne $ghostExclusion.EntryCount) {
        Add-Blocker $blockers 'SOURCE_GHOST_EXCLUSION_SET_CHANGED'
    }
    if (-not $targetStable) {
        Add-Blocker $blockers 'TARGET_CHANGED_DURING_PREFLIGHT'
    }

    $inventoryMatch = (
        $sourceBefore.FileCount -eq $targetBefore.FileCount -and
        $sourceBefore.DirectoryCount -eq $targetBefore.DirectoryCount -and
        $sourceBefore.Bytes -eq $targetBefore.Bytes -and
        $sourceBefore.ReparsePointCount -eq $targetBefore.ReparsePointCount
    )
    if ($Stage -eq 'AfterSync' -and -not $inventoryMatch) {
        Add-Blocker $blockers 'INVENTORY_MISMATCH'
    }

    $status = if ($blockers.Count -eq 0) { 'pass' } else { 'blocked' }
    $exitCode = if ($blockers.Count -eq 0) { 0 } else { 2 }
    $targetHashErrors = [object[]]@()
    if ($null -ne $targetHashResult) {
        $targetHashErrors = [object[]]@($targetHashResult.Errors)
    }

    $result = [ordered]@{
        SchemaVersion = 'storage-sync-migration-preflight/1.2.0'
        Stage = $Stage
        Status = $status
        ReadOnly = $true
        StartedAtUtc = $startedAtUtc.ToString('o')
        CompletedAtUtc = [DateTime]::UtcNow.ToString('o')
        Source = [ordered]@{
            ObservedFileCount = $sourceBefore.ObservedFileCount
            ObservedBytes = $sourceBefore.ObservedBytes
            ExcludedFileCount = $sourceBefore.ExcludedFileCount
            ExcludedBytes = $sourceBefore.ExcludedBytes
            FileCount = $sourceBefore.FileCount
            DirectoryCount = $sourceBefore.DirectoryCount
            Bytes = $sourceBefore.Bytes
            ReparsePointCount = $sourceBefore.ReparsePointCount
            HashedFileCount = $sourceHashResult.HashedFileCount
            HashErrorCount = $sourceHashResult.ErrorCount
            HashErrors = $sourceHashResult.Errors
            ManifestSha256 = $sourceHashResult.ManifestSha256
            SnapshotStable = $sourceStable
            FinalObservedFileCount = $sourceAfter.ObservedFileCount
            FinalObservedBytes = $sourceAfter.ObservedBytes
            FinalExcludedFileCount = $sourceAfter.ExcludedFileCount
            FinalExcludedBytes = $sourceAfter.ExcludedBytes
            FinalFileCount = $sourceAfter.FileCount
            FinalDirectoryCount = $sourceAfter.DirectoryCount
            FinalBytes = $sourceAfter.Bytes
            Delta = $sourceDelta
        }
        GhostExclusion = [ordered]@{
            Required = $true
            Policy = 'exact_windows_path_and_pcloud_file_id'
            ManifestSha256 = $ghostExclusion.ManifestSha256
            EntryCount = $ghostExclusion.EntryCount
            InitialExactPathMatchCount = $sourceBefore.ExcludedFileCount
            FinalExactPathMatchCount = $sourceAfter.ExcludedFileCount
            LocalDbMatchedCount = $ghostExclusion.LocalDbMatchedCount
            WildcardRuleCount = 0
            ExtensionRuleCount = 0
            FolderRuleCount = 0
        }
        BeforeSyncBaseline = [ordered]@{
            Required = ($Stage -eq 'AfterSync')
            ReportSha256 = if ($null -ne $beforeSyncBaseline) {
                $beforeSyncBaseline.ReportSha256
            }
            else {
                $null
            }
            SourceManifestSha256 = if ($null -ne $beforeSyncBaseline) {
                $beforeSyncBaseline.SourceManifestSha256
            }
            else {
                $null
            }
            CurrentSourceMatches = $sourceBaselineMatch
        }
        Target = [ordered]@{
            FileCount = $targetBefore.FileCount
            DirectoryCount = $targetBefore.DirectoryCount
            Bytes = $targetBefore.Bytes
            ReparsePointCount = $targetBefore.ReparsePointCount
            IsEmpty = (
                $targetBefore.FileCount -eq 0 -and
                $targetBefore.DirectoryCount -eq 0 -and
                $targetBefore.ReparsePointCount -eq 0
            )
            HashedFileCount = if ($null -ne $targetHashResult) {
                $targetHashResult.HashedFileCount
            }
            else {
                0
            }
            HashErrorCount = if ($null -ne $targetHashResult) {
                $targetHashResult.ErrorCount
            }
            else {
                0
            }
            HashErrors = $targetHashErrors
            ManifestSha256 = if ($null -ne $targetHashResult) {
                $targetHashResult.ManifestSha256
            }
            else {
                $null
            }
            SnapshotStable = $targetStable
            FinalFileCount = $targetAfter.FileCount
            FinalDirectoryCount = $targetAfter.DirectoryCount
            FinalBytes = $targetAfter.Bytes
            Delta = $targetDelta
        }
        Capacity = [ordered]@{
            TargetDriveFormat = $targetDrive.DriveFormat
            TargetDriveTotalBytes = $targetDrive.TotalSize
            TargetDriveFreeBytes = $targetDrive.AvailableFreeSpace
            RequiredFreeMultiplier = $RequiredFreeMultiplier
            RequiredFreeBytes = [int64]$requiredFreeBytesDecimal
            Pass = $capacityPass
        }
        Comparison = [ordered]@{
            InventoryMatch = $inventoryMatch
            Eligible = [bool]($null -ne $comparison)
            MissingFileCount = if ($null -ne $comparison) {
                $comparison.MissingFileCount
            }
            else {
                $null
            }
            ExtraFileCount = if ($null -ne $comparison) {
                $comparison.ExtraFileCount
            }
            else {
                $null
            }
            HashMismatchCount = if ($null -ne $comparison) {
                $comparison.HashMismatchCount
            }
            else {
                $null
            }
        }
        Blockers = @($blockers)
    }

    $result | ConvertTo-Json -Depth 8
}
catch {
    $safeError = [ordered]@{
        SchemaVersion = 'storage-sync-migration-preflight/1.2.0'
        Stage = $Stage
        Status = 'error'
        ReadOnly = $true
        StartedAtUtc = $startedAtUtc.ToString('o')
        CompletedAtUtc = [DateTime]::UtcNow.ToString('o')
        ErrorCode = if (
            $null -ne $_.Exception.Data -and
            $_.Exception.Data.Contains('SafeCode')
        ) {
            [string]$_.Exception.Data['SafeCode']
        }
        else {
            'PREFLIGHT_RUNTIME_ERROR'
        }
        ErrorType = $_.Exception.GetType().Name
        ErrorLine = $_.InvocationInfo.ScriptLineNumber
    }
    $safeError | ConvertTo-Json -Depth 4
    $exitCode = 1
}

exit $exitCode
