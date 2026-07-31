[CmdletBinding()]
param(
    [ValidateSet('BeforeSync', 'AfterSync')]
    [string]$Stage = 'BeforeSync',

    [string]$SourceRoot,

    [string]$TargetRoot,

    [ValidateRange(1, 10)]
    [int]$RequiredFreeMultiplier = 3,

    [ValidateRange(0, 10000)]
    [int]$ProgressInterval = 500
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
# - BeforeSync: hedefin boslugunu, 3x kapasiteyi ve kaynaktaki HER dosyanin
#   SHA-256 ile gercekten okunabildigini fail-closed dogrular.
# - AfterSync: iki kokteki HER dosyayi goreli-yol eslemeli SHA-256 ile
#   karsilastirir; eksik/fazla/hash farki veya tarama sirasinda kaynak/hedef
#   degisimi varsa fail-closed durur.

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
    param([string]$Root)

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
        $Before.ReparsePointCount -ne $After.ReparsePointCount
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

    $sourceBefore = Get-TreeSnapshot $source
    $targetBefore = Get-TreeSnapshot $target

    $targetDriveRoot = [System.IO.Path]::GetPathRoot($target)
    $targetDrive = [System.IO.DriveInfo]::new($targetDriveRoot)
    $requiredFreeBytesDecimal = [decimal]$sourceBefore.Bytes * [decimal]$RequiredFreeMultiplier
    $capacityPass = [decimal]$targetDrive.AvailableFreeSpace -ge $requiredFreeBytesDecimal

    if ($sourceBefore.ReparsePointCount -gt 0) {
        Add-Blocker $blockers 'SOURCE_REPARSE_POINT_FOUND'
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

    $sourceAfter = Get-TreeSnapshot $source
    $targetAfter = Get-TreeSnapshot $target
    $sourceStable = Test-SnapshotEqual $sourceBefore $sourceAfter
    $targetStable = Test-SnapshotEqual $targetBefore $targetAfter
    $sourceDelta = Get-SnapshotDelta $sourceBefore $sourceAfter
    $targetDelta = Get-SnapshotDelta $targetBefore $targetAfter

    if (-not $sourceStable) {
        Add-Blocker $blockers 'SOURCE_CHANGED_DURING_PREFLIGHT'
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
        SchemaVersion = 'storage-sync-migration-preflight/1.0.0'
        Stage = $Stage
        Status = $status
        ReadOnly = $true
        StartedAtUtc = $startedAtUtc.ToString('o')
        CompletedAtUtc = [DateTime]::UtcNow.ToString('o')
        Source = [ordered]@{
            FileCount = $sourceBefore.FileCount
            DirectoryCount = $sourceBefore.DirectoryCount
            Bytes = $sourceBefore.Bytes
            ReparsePointCount = $sourceBefore.ReparsePointCount
            HashedFileCount = $sourceHashResult.HashedFileCount
            HashErrorCount = $sourceHashResult.ErrorCount
            HashErrors = $sourceHashResult.Errors
            ManifestSha256 = $sourceHashResult.ManifestSha256
            SnapshotStable = $sourceStable
            FinalFileCount = $sourceAfter.FileCount
            FinalDirectoryCount = $sourceAfter.DirectoryCount
            FinalBytes = $sourceAfter.Bytes
            Delta = $sourceDelta
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
        SchemaVersion = 'storage-sync-migration-preflight/1.0.0'
        Stage = $Stage
        Status = 'error'
        ReadOnly = $true
        StartedAtUtc = $startedAtUtc.ToString('o')
        CompletedAtUtc = [DateTime]::UtcNow.ToString('o')
        ErrorCode = 'PREFLIGHT_RUNTIME_ERROR'
        ErrorType = $_.Exception.GetType().Name
        ErrorLine = $_.InvocationInfo.ScriptLineNumber
    }
    $safeError | ConvertTo-Json -Depth 4
    $exitCode = 1
}

exit $exitCode
