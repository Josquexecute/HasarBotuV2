[CmdletBinding()]
param(
    [string]$SourceRoot,

    [ValidateRange(0, 10000)]
    [int]$ProgressInterval = 500,

    [ValidateRange(0, 60000)]
    [int]$RetryDelayMilliseconds = 1500,

    [ValidateRange(0, 1000000)]
    [int]$ExpectedInitialErrorCount = 10
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# D7 salt-okunur yerel operator tanilamasi.
#
# Bu arac:
# - Kaynaktaki her dosyayi SHA-256 akisi ile SALT OKUNUR okur.
# - Ilk okumada hata veren dosyalar icin hata turu/HResult/native kod,
#   offline/reparse/recall bayraklari, paylasim-kilidi probu, yol uzunlugu
#   ve TAM UC kontrollu yeniden okuma sonucu toplar.
# - Hassas tam/goreli yollari yalniz
#   C:\ProgramData\HasarBotu\migration-preflight altindaki Administrators-only
#   JSON rapora yazar.
# - Konsola dosya adi, goreli yol, tam yol veya ham hata mesaji YAZMAZ.
# - Kaynak, pCloud, hedef, environment veya servis durumunu DEGISTIRMEZ.
#
# Bilincli tek yazma siniri: rapor dizini ACL'i ve bu dizindeki yeni JSON
# raporu. Rapor dizini/file ACL'i BUILTIN\Administrators disindaki tum
# erisim kurallarindan arindirilir ve miras kapatilir.

$RetryCount = 3
$ReportDirectory = 'C:\ProgramData\HasarBotu\migration-preflight'
$AdministratorSidValue = 'S-1-5-32-544'

function ConvertTo-Hex {
    param([byte[]]$Bytes)

    return ([System.BitConverter]::ToString($Bytes)).Replace('-', '').ToLowerInvariant()
}

function Get-ExceptionFact {
    param([System.Exception]$Exception)

    $chain = [System.Collections.Generic.List[object]]::new()
    $current = $Exception
    while ($null -ne $current) {
        $currentSignedHResult = [int32]$current.HResult
        $currentUnsignedHResult = [System.BitConverter]::ToUInt32(
            [System.BitConverter]::GetBytes($currentSignedHResult),
            0
        )
        $chain.Add(
            [pscustomobject]@{
                Type = $current.GetType().FullName
                HResultSigned = $currentSignedHResult
                HResultHex = ('0x{0:X8}' -f $currentUnsignedHResult)
                NativeCode = [int]($currentUnsignedHResult -band 0xFFFF)
            }
        )

        if (
            $null -eq $current.InnerException -or
            [object]::ReferenceEquals($current, $current.InnerException)
        ) {
            break
        }
        $current = $current.InnerException
    }

    $root = $chain[$chain.Count - 1]
    $wrapper = $chain[0]
    $signedHResult = [int32]$root.HResultSigned
    $unsignedHResult = [System.BitConverter]::ToUInt32(
        [System.BitConverter]::GetBytes($signedHResult),
        0
    )

    return [pscustomobject]@{
        Type = $root.Type
        HResultSigned = $signedHResult
        HResultHex = ('0x{0:X8}' -f $unsignedHResult)
        NativeCode = [int]($unsignedHResult -band 0xFFFF)
        WrapperType = $wrapper.Type
        WrapperHResultHex = $wrapper.HResultHex
        Chain = $chain
    }
}

function Get-SafeSourceRoot {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        $companyFolder = 'BARAN GLOBAL EKSPERT' + [char]0x0130 + 'Z'
        $Path = Join-Path 'P:\' $companyFolder
    }

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $pathRoot = [System.IO.Path]::GetPathRoot($fullPath)
    if ($fullPath.Length -gt $pathRoot.Length) {
        $fullPath = $fullPath.TrimEnd(
            [System.IO.Path]::DirectorySeparatorChar,
            [System.IO.Path]::AltDirectorySeparatorChar
        )
    }

    if (-not [System.IO.Directory]::Exists($fullPath)) {
        throw [System.IO.DirectoryNotFoundException]::new('SOURCE_ROOT_NOT_FOUND')
    }

    return $fullPath
}

function Get-SourceSnapshot {
    param([string]$Root)

    $rootInfo = [System.IO.DirectoryInfo]::new($Root)
    $rootInfo.Refresh()

    $files = [System.Collections.Generic.List[object]]::new()
    $fileMap = [System.Collections.Generic.Dictionary[string, object]]::new(
        [System.StringComparer]::OrdinalIgnoreCase
    )
    $directories = 0
    $reparsePoints = 0
    $bytes = [int64]0

    if ($rootInfo.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        throw [System.IO.IOException]::new('SOURCE_ROOT_REPARSE_POINT')
    }

    $stack = [System.Collections.Generic.Stack[System.IO.DirectoryInfo]]::new()
    $stack.Push($rootInfo)

    while ($stack.Count -gt 0) {
        $current = $stack.Pop()

        foreach ($entry in $current.EnumerateFileSystemInfos()) {
            if ($entry.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
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

            $fileMap.Add($relativePath, $record)
            $files.Add($record)
            $bytes += [int64]$file.Length
        }
    }

    return [pscustomobject]@{
        Files = $files
        FileMap = $fileMap
        FileCount = $files.Count
        DirectoryCount = $directories
        ReparsePointCount = $reparsePoints
        Bytes = $bytes
    }
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
        ReparsePointCountDelta = (
            $After.ReparsePointCount - $Before.ReparsePointCount
        )
        BytesDelta = $After.Bytes - $Before.Bytes
        Stable = (
            $added -eq 0 -and
            $removed -eq 0 -and
            $metadataChanged -eq 0 -and
            $After.DirectoryCount -eq $Before.DirectoryCount -and
            $After.ReparsePointCount -eq $Before.ReparsePointCount
        )
    }
}

function Invoke-FullRead {
    param([string]$Path)

    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $stream = $null
    $sha = $null

    try {
        $stream = [System.IO.File]::Open(
            $Path,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::Read,
            [System.IO.FileShare]::Read
        )
        $sha = [System.Security.Cryptography.SHA256]::Create()
        $hash = ConvertTo-Hex ($sha.ComputeHash($stream))
        $stopwatch.Stop()

        return [pscustomobject]@{
            Success = $true
            DurationMilliseconds = $stopwatch.ElapsedMilliseconds
            BytesRead = $stream.Length
            Sha256 = $hash
            Error = $null
        }
    }
    catch {
        $stopwatch.Stop()
        return [pscustomobject]@{
            Success = $false
            DurationMilliseconds = $stopwatch.ElapsedMilliseconds
            BytesRead = $null
            Sha256 = $null
            Error = Get-ExceptionFact $_.Exception
        }
    }
    finally {
        if ($null -ne $sha) {
            $sha.Dispose()
        }
        if ($null -ne $stream) {
            $stream.Dispose()
        }
    }
}

function Invoke-LockProbe {
    param([string]$Path)

    $stream = $null
    try {
        $share = (
            [System.IO.FileShare]::ReadWrite -bor
            [System.IO.FileShare]::Delete
        )
        $stream = [System.IO.File]::Open(
            $Path,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::Read,
            $share
        )

        return [pscustomobject]@{
            OpenSucceeded = $true
            Error = $null
        }
    }
    catch {
        return [pscustomobject]@{
            OpenSucceeded = $false
            Error = Get-ExceptionFact $_.Exception
        }
    }
    finally {
        if ($null -ne $stream) {
            $stream.Dispose()
        }
    }
}

function Get-PathFact {
    param(
        [string]$Path,
        [string]$Root
    )

    $segments = @(
        $Path.Substring([System.IO.Path]::GetPathRoot($Path).Length).Split(
            @(
                [System.IO.Path]::DirectorySeparatorChar,
                [System.IO.Path]::AltDirectorySeparatorChar
            ),
            [System.StringSplitOptions]::RemoveEmptyEntries
        )
    )
    $maxSegmentLength = 0
    foreach ($segment in $segments) {
        if ($segment.Length -gt $maxSegmentLength) {
            $maxSegmentLength = $segment.Length
        }
    }

    $ancestorReparseCount = 0
    $parentPath = [System.IO.Path]::GetDirectoryName($Path)
    while (
        -not [string]::IsNullOrWhiteSpace($parentPath) -and
        $parentPath.Length -ge $Root.Length
    ) {
        try {
            $parentInfo = [System.IO.DirectoryInfo]::new($parentPath)
            $parentInfo.Refresh()
            if (
                $parentInfo.Exists -and
                ($parentInfo.Attributes -band [System.IO.FileAttributes]::ReparsePoint)
            ) {
                $ancestorReparseCount++
            }
        }
        catch {
            # Metadata raporu icin best-effort; okuma siniflandirmasi ayri.
        }

        if ([string]::Equals($parentPath, $Root, [StringComparison]::OrdinalIgnoreCase)) {
            break
        }
        $parentPath = [System.IO.Path]::GetDirectoryName($parentPath)
    }

    return [pscustomobject]@{
        FullPathCharacterCount = $Path.Length
        DirectoryPathCharacterCount = (
            [System.IO.Path]::GetDirectoryName($Path).Length
        )
        SegmentCount = $segments.Count
        MaximumSegmentCharacterCount = $maxSegmentLength
        LegacyMaxPathExceeded = $Path.Length -ge 260
        ComponentLimitExceeded = $maxSegmentLength -gt 255
        AncestorReparsePointCount = $ancestorReparseCount
    }
}

function Get-FileMetadataFact {
    param(
        [string]$Path,
        [string]$Root
    )

    $pathFact = Get-PathFact $Path $Root
    try {
        $info = [System.IO.FileInfo]::new($Path)
        $info.Refresh()
        if (-not $info.Exists) {
            return [pscustomobject]@{
                Exists = $false
                Length = $null
                LastWriteTimeUtc = $null
                AttributesNumeric = $null
                AttributesText = $null
                Offline = $false
                ReparsePoint = $false
                RecallOnOpen = $false
                RecallOnDataAccess = $false
                Path = $pathFact
                MetadataError = $null
            }
        }

        $attributes = [int64]$info.Attributes
        return [pscustomobject]@{
            Exists = $true
            Length = [int64]$info.Length
            LastWriteTimeUtc = $info.LastWriteTimeUtc.ToString('o')
            AttributesNumeric = $attributes
            AttributesText = $info.Attributes.ToString()
            Offline = [bool]($attributes -band 0x1000)
            ReparsePoint = [bool]($attributes -band 0x0400)
            RecallOnOpen = [bool]($attributes -band 0x00040000)
            RecallOnDataAccess = [bool]($attributes -band 0x00400000)
            Path = $pathFact
            MetadataError = $null
        }
    }
    catch {
        return [pscustomobject]@{
            Exists = $null
            Length = $null
            LastWriteTimeUtc = $null
            AttributesNumeric = $null
            AttributesText = $null
            Offline = $false
            ReparsePoint = $false
            RecallOnOpen = $false
            RecallOnDataAccess = $false
            Path = $pathFact
            MetadataError = Get-ExceptionFact $_.Exception
        }
    }
}

function Get-PrimaryClassification {
    param(
        $InitialRead,
        $Retries,
        $LockProbe,
        $MetadataBefore,
        $MetadataAfter
    )

    $retrySuccessCount = @($Retries | Where-Object { $_.Success }).Count
    $errorFacts = [System.Collections.Generic.List[object]]::new()
    if ($null -ne $InitialRead.Error) {
        $errorFacts.Add($InitialRead.Error)
    }
    foreach ($retry in $Retries) {
        if ($null -ne $retry.Error) {
            $errorFacts.Add($retry.Error)
        }
    }
    if ($null -ne $LockProbe.Error) {
        $errorFacts.Add($LockProbe.Error)
    }

    $nativeCodes = @($errorFacts | ForEach-Object { $_.NativeCode })

    if ($MetadataAfter.Exists -eq $false) {
        return 'missing_or_removed'
    }
    if (
        $MetadataBefore.ReparsePoint -or
        $MetadataAfter.ReparsePoint -or
        $MetadataBefore.Path.AncestorReparsePointCount -gt 0 -or
        $MetadataAfter.Path.AncestorReparsePointCount -gt 0
    ) {
        return 'reparse_point'
    }
    if (
        $MetadataBefore.Offline -or
        $MetadataAfter.Offline -or
        $MetadataBefore.RecallOnOpen -or
        $MetadataAfter.RecallOnOpen -or
        $MetadataBefore.RecallOnDataAccess -or
        $MetadataAfter.RecallOnDataAccess
    ) {
        return 'offline_or_recall'
    }
    if ($nativeCodes -contains 32 -or $nativeCodes -contains 33) {
        return 'sharing_or_lock'
    }
    if ($nativeCodes -contains 5) {
        return 'access_denied'
    }
    if (
        $nativeCodes -contains 206 -or
        $MetadataBefore.Path.ComponentLimitExceeded -or
        $MetadataAfter.Path.ComponentLimitExceeded
    ) {
        return 'path_length_or_component_limit'
    }
    if ($retrySuccessCount -gt 0) {
        return 'transient_io_recovered'
    }
    if ($nativeCodes -contains 1117) {
        return 'io_device_error_persistent'
    }

    return 'persistent_read_error'
}

function New-AdminOnlySecurity {
    param([bool]$Directory)

    $administratorSid = [System.Security.Principal.SecurityIdentifier]::new(
        $AdministratorSidValue
    )
    $security = if ($Directory) {
        [System.Security.AccessControl.DirectorySecurity]::new()
    }
    else {
        [System.Security.AccessControl.FileSecurity]::new()
    }

    $security.SetAccessRuleProtection($true, $false)
    $security.SetOwner($administratorSid)

    $inheritance = if ($Directory) {
        (
            [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
            [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
        )
    }
    else {
        [System.Security.AccessControl.InheritanceFlags]::None
    }

    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
        $administratorSid,
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        $inheritance,
        [System.Security.AccessControl.PropagationFlags]::None,
        [System.Security.AccessControl.AccessControlType]::Allow
    )
    $security.AddAccessRule($rule)
    return $security
}

function Test-AdminOnlyAcl {
    param(
        [string]$Path,
        [bool]$Directory
    )

    $security = if ($Directory) {
        [System.IO.Directory]::GetAccessControl($Path)
    }
    else {
        [System.IO.File]::GetAccessControl($Path)
    }

    $rules = @(
        $security.GetAccessRules(
            $true,
            $true,
            [System.Security.Principal.SecurityIdentifier]
        )
    )
    $owner = $security.GetOwner(
        [System.Security.Principal.SecurityIdentifier]
    ).Value

    $validRuleCount = @(
        $rules | Where-Object {
            $_.IdentityReference.Value -eq $AdministratorSidValue -and
            $_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
            $_.FileSystemRights -eq [System.Security.AccessControl.FileSystemRights]::FullControl
        }
    ).Count

    return [pscustomobject]@{
        Pass = (
            $security.AreAccessRulesProtected -and
            $owner -eq $AdministratorSidValue -and
            $rules.Count -eq 1 -and
            $validRuleCount -eq 1
        )
        Protected = $security.AreAccessRulesProtected
        OwnerSid = $owner
        RuleCount = $rules.Count
        AdministratorFullControlRuleCount = $validRuleCount
    }
}

function Initialize-SecureReportDirectory {
    $expected = [System.IO.Path]::GetFullPath(
        'C:\ProgramData\HasarBotu\migration-preflight'
    ).TrimEnd('\')
    $actual = [System.IO.Path]::GetFullPath($ReportDirectory).TrimEnd('\')
    if (-not [string]::Equals($expected, $actual, [StringComparison]::OrdinalIgnoreCase)) {
        throw [System.Security.SecurityException]::new('REPORT_DIRECTORY_NOT_ALLOWLISTED')
    }

    $parentPaths = @(
        'C:\ProgramData',
        'C:\ProgramData\HasarBotu'
    )
    foreach ($parentPath in $parentPaths) {
        if (-not [System.IO.Directory]::Exists($parentPath)) {
            throw [System.IO.DirectoryNotFoundException]::new('REPORT_PARENT_NOT_FOUND')
        }
        $parent = [System.IO.DirectoryInfo]::new($parentPath)
        $parent.Refresh()
        if ($parent.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
            throw [System.Security.SecurityException]::new('REPORT_PARENT_REPARSE_POINT')
        }
    }

    if (-not [System.IO.Directory]::Exists($actual)) {
        [System.IO.Directory]::CreateDirectory($actual) | Out-Null
    }

    $directoryInfo = [System.IO.DirectoryInfo]::new($actual)
    $directoryInfo.Refresh()
    if ($directoryInfo.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        throw [System.Security.SecurityException]::new('REPORT_DIRECTORY_REPARSE_POINT')
    }

    [System.IO.Directory]::SetAccessControl(
        $actual,
        (New-AdminOnlySecurity $true)
    )
    $aclResult = Test-AdminOnlyAcl $actual $true
    if (-not $aclResult.Pass) {
        throw [System.Security.SecurityException]::new('REPORT_DIRECTORY_ACL_INVALID')
    }

    return $aclResult
}

function Write-SecureReport {
    param($Report)

    $timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
    $suffix = [Guid]::NewGuid().ToString('N').Substring(0, 8)
    $fileName = "source-io-diagnostic-$timestamp-$suffix.json"
    $finalPath = Join-Path $ReportDirectory $fileName
    $tempPath = Join-Path $ReportDirectory (".tmp-$suffix")

    try {
        $json = $Report | ConvertTo-Json -Depth 16
        $encoding = [System.Text.UTF8Encoding]::new($false)
        [System.IO.File]::WriteAllText($tempPath, $json, $encoding)
        [System.IO.File]::SetAccessControl(
            $tempPath,
            (New-AdminOnlySecurity $false)
        )

        $tempAcl = Test-AdminOnlyAcl $tempPath $false
        if (-not $tempAcl.Pass) {
            throw [System.Security.SecurityException]::new('TEMP_REPORT_ACL_INVALID')
        }

        [System.IO.File]::Move($tempPath, $finalPath)
        [System.IO.File]::SetAccessControl(
            $finalPath,
            (New-AdminOnlySecurity $false)
        )

        $finalAcl = Test-AdminOnlyAcl $finalPath $false
        if (-not $finalAcl.Pass) {
            throw [System.Security.SecurityException]::new('FINAL_REPORT_ACL_INVALID')
        }

        return [pscustomobject]@{
            FileName = $fileName
            Acl = $finalAcl
            ByteLength = [System.IO.FileInfo]::new($finalPath).Length
        }
    }
    finally {
        if ([System.IO.File]::Exists($tempPath)) {
            [System.IO.File]::Delete($tempPath)
        }
    }
}

function Add-Count {
    param(
        [System.Collections.Generic.Dictionary[string, int]]$Counts,
        [string]$Key
    )

    if ($Counts.ContainsKey($Key)) {
        $Counts[$Key] = $Counts[$Key] + 1
    }
    else {
        $Counts.Add($Key, 1)
    }
}

function Convert-CountMap {
    param([System.Collections.Generic.Dictionary[string, int]]$Counts)

    $rows = @()
    foreach ($entry in $Counts.GetEnumerator() | Sort-Object Key) {
        $rows += [pscustomobject]@{
            Key = $entry.Key
            Count = $entry.Value
        }
    }
    return $rows
}

$startedAtUtc = [DateTime]::UtcNow
$exitCode = 1

try {
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [System.Security.Principal.WindowsPrincipal]::new($identity)
    if (
        -not $principal.IsInRole(
            [System.Security.Principal.WindowsBuiltInRole]::Administrator
        )
    ) {
        throw [System.Security.SecurityException]::new('ELEVATED_ADMIN_REQUIRED')
    }

    $source = Get-SafeSourceRoot $SourceRoot
    if (
        $ReportDirectory.StartsWith(
            $source + [System.IO.Path]::DirectorySeparatorChar,
            [StringComparison]::OrdinalIgnoreCase
        )
    ) {
        throw [System.Security.SecurityException]::new('REPORT_INSIDE_SOURCE')
    }

    $directoryAcl = Initialize-SecureReportDirectory
    $longPathsEnabled = [bool](
        (Get-ItemPropertyValue `
            -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' `
            -Name 'LongPathsEnabled' `
            -ErrorAction SilentlyContinue) -eq 1
    )

    $sourceBefore = Get-SourceSnapshot $source
    $diagnostics = [System.Collections.Generic.List[object]]::new()
    $initialErrorCounts = [System.Collections.Generic.Dictionary[string, int]]::new(
        [System.StringComparer]::Ordinal
    )
    $classificationCounts = [System.Collections.Generic.Dictionary[string, int]]::new(
        [System.StringComparer]::Ordinal
    )
    $processed = 0

    foreach ($record in $sourceBefore.Files) {
        $initialRead = Invoke-FullRead $record.FullName
        $processed++

        if ($ProgressInterval -gt 0 -and ($processed % $ProgressInterval) -eq 0) {
            Write-Host (
                'DIAGNOSTIC_PROGRESS processed={0} total={1} errors={2}' -f
                $processed,
                $sourceBefore.FileCount,
                $diagnostics.Count
            )
        }

        if ($initialRead.Success) {
            continue
        }

        $errorKey = (
            '{0}|{1}|{2}' -f
            $initialRead.Error.Type,
            $initialRead.Error.HResultHex,
            $initialRead.Error.NativeCode
        )
        Add-Count $initialErrorCounts $errorKey

        $metadataBefore = Get-FileMetadataFact $record.FullName $source
        $lockProbe = Invoke-LockProbe $record.FullName
        $retries = [System.Collections.Generic.List[object]]::new()

        for ($attempt = 1; $attempt -le $RetryCount; $attempt++) {
            if ($RetryDelayMilliseconds -gt 0) {
                Start-Sleep -Milliseconds $RetryDelayMilliseconds
            }
            $retryRead = Invoke-FullRead $record.FullName
            $retries.Add(
                [pscustomobject]@{
                    Attempt = $attempt
                    Success = $retryRead.Success
                    DurationMilliseconds = $retryRead.DurationMilliseconds
                    BytesRead = $retryRead.BytesRead
                    Sha256 = $retryRead.Sha256
                    Error = $retryRead.Error
                }
            )
        }

        $metadataAfter = Get-FileMetadataFact $record.FullName $source
        $classification = Get-PrimaryClassification `
            $initialRead `
            $retries `
            $lockProbe `
            $metadataBefore `
            $metadataAfter
        Add-Count $classificationCounts $classification

        $diagnostics.Add(
            [pscustomobject]@{
                FullPath = $record.FullName
                RelativePath = $record.RelativePath
                SnapshotLength = $record.Length
                SnapshotLastWriteTicks = $record.LastWriteTicks
                InitialRead = $initialRead
                MetadataBeforeRetries = $metadataBefore
                LockProbe = $lockProbe
                Retries = $retries
                MetadataAfterRetries = $metadataAfter
                PrimaryClassification = $classification
            }
        )
    }

    $sourceAfter = Get-SourceSnapshot $source
    $snapshotDelta = Get-SnapshotDelta $sourceBefore $sourceAfter

    $recoveredFileCount = @(
        $diagnostics | Where-Object {
            @($_.Retries | Where-Object { $_.Success }).Count -gt 0
        }
    ).Count
    $persistentFileCount = @(
        $diagnostics | Where-Object {
            @($_.Retries | Where-Object { $_.Success }).Count -eq 0
        }
    ).Count
    $offlineOrRecallCount = @(
        $diagnostics | Where-Object {
            $_.MetadataBeforeRetries.Offline -or
            $_.MetadataBeforeRetries.RecallOnOpen -or
            $_.MetadataBeforeRetries.RecallOnDataAccess -or
            $_.MetadataAfterRetries.Offline -or
            $_.MetadataAfterRetries.RecallOnOpen -or
            $_.MetadataAfterRetries.RecallOnDataAccess
        }
    ).Count
    $reparseCount = @(
        $diagnostics | Where-Object {
            $_.MetadataBeforeRetries.ReparsePoint -or
            $_.MetadataAfterRetries.ReparsePoint -or
            $_.MetadataBeforeRetries.Path.AncestorReparsePointCount -gt 0 -or
            $_.MetadataAfterRetries.Path.AncestorReparsePointCount -gt 0
        }
    ).Count
    $lockCount = @(
        $diagnostics | Where-Object {
            $_.PrimaryClassification -eq 'sharing_or_lock'
        }
    ).Count
    $legacyLongPathCount = @(
        $diagnostics | Where-Object {
            $_.MetadataBeforeRetries.Path.LegacyMaxPathExceeded -or
            $_.MetadataAfterRetries.Path.LegacyMaxPathExceeded
        }
    ).Count
    $componentLimitCount = @(
        $diagnostics | Where-Object {
            $_.MetadataBeforeRetries.Path.ComponentLimitExceeded -or
            $_.MetadataAfterRetries.Path.ComponentLimitExceeded
        }
    ).Count

    $summary = [ordered]@{
        ExpectedInitialErrorCount = $ExpectedInitialErrorCount
        ActualInitialErrorCount = $diagnostics.Count
        ExpectedCountMatched = (
            $ExpectedInitialErrorCount -eq $diagnostics.Count
        )
        InitialErrorTypes = Convert-CountMap $initialErrorCounts
        Classifications = Convert-CountMap $classificationCounts
        RecoveredByControlledRetryFileCount = $recoveredFileCount
        PersistentAfterThreeRetriesFileCount = $persistentFileCount
        OfflineOrRecallFileCount = $offlineOrRecallCount
        ReparseOrAncestorReparseFileCount = $reparseCount
        SharingOrLockFileCount = $lockCount
        LegacyMaxPathExceededFileCount = $legacyLongPathCount
        ComponentLimitExceededFileCount = $componentLimitCount
    }

    $report = [ordered]@{
        SchemaVersion = 'storage-source-io-diagnostic/1.0.1'
        StartedAtUtc = $startedAtUtc.ToString('o')
        CompletedAtUtc = [DateTime]::UtcNow.ToString('o')
        Policy = [ordered]@{
            SourceReadOnly = $true
            RetryCount = $RetryCount
            RetryDelayMilliseconds = $RetryDelayMilliseconds
            ReportDirectoryAdminOnly = $true
            ConsolePathRedaction = $true
        }
        Environment = [ordered]@{
            SourceRoot = $source
            LongPathsEnabled = $longPathsEnabled
        }
        SourceBefore = [ordered]@{
            FileCount = $sourceBefore.FileCount
            DirectoryCount = $sourceBefore.DirectoryCount
            Bytes = $sourceBefore.Bytes
            ReparsePointCount = $sourceBefore.ReparsePointCount
        }
        SourceAfter = [ordered]@{
            FileCount = $sourceAfter.FileCount
            DirectoryCount = $sourceAfter.DirectoryCount
            Bytes = $sourceAfter.Bytes
            ReparsePointCount = $sourceAfter.ReparsePointCount
        }
        SourceSnapshotDelta = $snapshotDelta
        Summary = $summary
        Files = $diagnostics
    }

    $writtenReport = Write-SecureReport $report
    $status = if ($summary.ExpectedCountMatched) {
        'complete'
    }
    else {
        'complete_count_drift'
    }

    $safeConsole = [ordered]@{
        SchemaVersion = 'storage-source-io-diagnostic/1.0.1'
        Status = $status
        SourceReadOnly = $true
        StartedAtUtc = $startedAtUtc.ToString('o')
        CompletedAtUtc = [DateTime]::UtcNow.ToString('o')
        ScannedFileCount = $sourceBefore.FileCount
        SourceSnapshotStable = $snapshotDelta.Stable
        Summary = $summary
        Report = [ordered]@{
            FileName = $writtenReport.FileName
            ByteLength = $writtenReport.ByteLength
            DirectoryAclPass = $directoryAcl.Pass
            FileAclPass = $writtenReport.Acl.Pass
            AllowedSid = $AdministratorSidValue
            AccessRuleCount = $writtenReport.Acl.RuleCount
        }
    }
    $safeConsole | ConvertTo-Json -Depth 10
    $exitCode = 0
}
catch {
    $safeError = [ordered]@{
        SchemaVersion = 'storage-source-io-diagnostic/1.0.1'
        Status = 'error'
        SourceReadOnly = $true
        ErrorCode = 'DIAGNOSTIC_RUNTIME_ERROR'
        ErrorType = $_.Exception.GetType().Name
        ErrorLine = $_.InvocationInfo.ScriptLineNumber
    }
    $safeError | ConvertTo-Json -Depth 4
    $exitCode = 1
}

exit $exitCode
