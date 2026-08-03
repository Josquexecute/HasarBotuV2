[CmdletBinding()]
param(
    [string]$SourceRoot,

    [string]$TargetRoot,

    [string]$GhostExclusionManifestPath,

    [string]$PCloudLocalDatabasePath,

    [ValidateRange(1, 60)]
    [int]$PollSeconds = 15,

    [ValidateRange(10, 120)]
    [int]$MaximumMinutes = 30,

    [ValidateRange(0, 10000)]
    [int]$ProgressInterval = 500,

    [switch]$ProbeOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# D8 post-sync rebaseline gate (HB-2026-129).
#
# - Source, target and pCloud database are read-only.
# - pCloud settings, the sync mapping itself, env and services are never
#   changed. Unlike pcloud-maintenance-window-gate.ps1, this gate REQUIRES
#   an active sync mapping (exactly one syncfolder row matching the
#   expected remote root and target path) instead of rejecting one; it is
#   the tool for establishing a fresh migration baseline AFTER Add Sync has
#   already run, without ever touching the mapping.
# - A production PASS always requires at least 600 seconds of simultaneous
#   quiet on source, target AND the remote root, zero pending pCloud queue
#   entries (task/fstask/upload_tasks/localfileupload/uptask_fileupload/
#   pagecachetask/localfolder.taskcnt), zero delayed sync items, zero
#   conflict-name artifacts, and a final full source==target SHA-256 match.
#   There is no shortened production/test duration parameter.
# - Gate reports are written only under the Administrators-only evidence
#   directory. ProbeOnly writes no report and can never authorize a
#   rebaseline.

$AdministratorSidValue = 'S-1-5-32-544'
$ReportDirectory = 'C:\ProgramData\HasarBotu\migration-preflight'
$exitCode = 1

function Throw-SafeGateError {
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
        $ownerSid = ([System.Security.Principal.NTAccount]$acl.Owner).Translate(
            [System.Security.Principal.SecurityIdentifier]
        ).Value
        $rules = @($acl.GetAccessRules(
            $true,
            $true,
            [System.Security.Principal.SecurityIdentifier]
        ))
        if ($ownerSid -ne $AdministratorSidValue -or $rules.Count -ne 1) {
            return $false
        }
        $rule = $rules[0]
        $fullControl = [System.Security.AccessControl.FileSystemRights]::FullControl
        return (
            $rule.IdentityReference.Value -eq $AdministratorSidValue -and
            $rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
            -not $rule.IsInherited -and
            ($rule.FileSystemRights -band $fullControl) -eq $fullControl
        )
    }
    catch {
        return $false
    }
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
    $rules = @($security.GetAccessRules(
        $true,
        $true,
        [System.Security.Principal.SecurityIdentifier]
    ))
    $ownerSid = $security.GetOwner(
        [System.Security.Principal.SecurityIdentifier]
    ).Value
    $validRules = @($rules | Where-Object {
        $_.IdentityReference.Value -eq $AdministratorSidValue -and
        $_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
        $_.FileSystemRights -eq [System.Security.AccessControl.FileSystemRights]::FullControl
    })
    return (
        $security.AreAccessRulesProtected -and
        $ownerSid -eq $AdministratorSidValue -and
        $rules.Count -eq 1 -and
        $validRules.Count -eq 1
    )
}

function Initialize-SecureReportDirectory {
    $expected = [System.IO.Path]::GetFullPath(
        'C:\ProgramData\HasarBotu\migration-preflight'
    ).TrimEnd('\')
    $actual = [System.IO.Path]::GetFullPath($ReportDirectory).TrimEnd('\')
    if (-not [string]::Equals($expected, $actual, [StringComparison]::OrdinalIgnoreCase)) {
        Throw-SafeGateError 'REPORT_DIRECTORY_NOT_ALLOWLISTED'
    }
    foreach ($parentPath in @('C:\ProgramData', 'C:\ProgramData\HasarBotu')) {
        if (-not [System.IO.Directory]::Exists($parentPath)) {
            Throw-SafeGateError 'REPORT_PARENT_NOT_FOUND'
        }
        $parent = [System.IO.DirectoryInfo]::new($parentPath)
        $parent.Refresh()
        if ($parent.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
            Throw-SafeGateError 'REPORT_PARENT_REPARSE_POINT'
        }
    }
    if (-not [System.IO.Directory]::Exists($actual)) {
        [System.IO.Directory]::CreateDirectory($actual) | Out-Null
    }
    $directoryInfo = [System.IO.DirectoryInfo]::new($actual)
    $directoryInfo.Refresh()
    if ($directoryInfo.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        Throw-SafeGateError 'REPORT_DIRECTORY_REPARSE_POINT'
    }
    [System.IO.Directory]::SetAccessControl($actual, (New-AdminOnlySecurity $true))
    if (-not (Test-AdminOnlyAcl $actual $true)) {
        Throw-SafeGateError 'REPORT_DIRECTORY_ACL_INVALID'
    }
}

function Write-SecureGateReport {
    param([string]$Json)

    $timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
    $suffix = [Guid]::NewGuid().ToString('N').Substring(0, 8)
    $fileName = "pcloud-post-sync-rebaseline-$timestamp-$suffix.json"
    $finalPath = Join-Path $ReportDirectory $fileName
    $sidecarPath = $finalPath + '.sha256'
    $tempPath = Join-Path $ReportDirectory (".tmp-rebaseline-$suffix")
    $tempSidecarPath = $tempPath + '.sha256'
    $encoding = [System.Text.UTF8Encoding]::new($false)

    try {
        [System.IO.File]::WriteAllText($tempPath, $Json, $encoding)
        [System.IO.File]::SetAccessControl($tempPath, (New-AdminOnlySecurity $false))
        if (-not (Test-AdminOnlyAcl $tempPath $false)) {
            Throw-SafeGateError 'TEMP_REPORT_ACL_INVALID'
        }
        $reportHash = (Get-FileHash -LiteralPath $tempPath -Algorithm SHA256).Hash.ToLowerInvariant()
        $sidecarText = $reportHash + '  ' + $fileName
        [System.IO.File]::WriteAllText($tempSidecarPath, $sidecarText, $encoding)
        [System.IO.File]::SetAccessControl(
            $tempSidecarPath,
            (New-AdminOnlySecurity $false)
        )
        if (-not (Test-AdminOnlyAcl $tempSidecarPath $false)) {
            Throw-SafeGateError 'TEMP_SIDECAR_ACL_INVALID'
        }

        [System.IO.File]::Move($tempPath, $finalPath)
        [System.IO.File]::Move($tempSidecarPath, $sidecarPath)
        [System.IO.File]::SetAccessControl($finalPath, (New-AdminOnlySecurity $false))
        [System.IO.File]::SetAccessControl($sidecarPath, (New-AdminOnlySecurity $false))
        if (
            -not (Test-AdminOnlyAcl $finalPath $false) -or
            -not (Test-AdminOnlyAcl $sidecarPath $false)
        ) {
            Throw-SafeGateError 'FINAL_REPORT_ACL_INVALID'
        }

        return [pscustomobject]@{
            FileName = $fileName
            Sha256 = $reportHash
        }
    }
    finally {
        foreach ($temporaryPath in @($tempPath, $tempSidecarPath)) {
            if ([System.IO.File]::Exists($temporaryPath)) {
                [System.IO.File]::Delete($temporaryPath)
            }
        }
    }
}

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
    if ([string]::IsNullOrWhiteSpace($PCloudLocalDatabasePath)) {
        if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
            Throw-SafeGateError 'PCLOUD_LOCAL_DATABASE_NOT_CONFIGURED'
        }
        $PCloudLocalDatabasePath = Join-Path $env:LOCALAPPDATA 'pCloud\data.db'
    }
    if ([string]::IsNullOrWhiteSpace($GhostExclusionManifestPath)) {
        Throw-SafeGateError 'GHOST_EXCLUSION_MANIFEST_REQUIRED'
    }

    $source = [System.IO.Path]::GetFullPath($SourceRoot)
    $target = [System.IO.Path]::GetFullPath($TargetRoot)
    $databasePath = [System.IO.Path]::GetFullPath($PCloudLocalDatabasePath)
    $manifestPath = [System.IO.Path]::GetFullPath($GhostExclusionManifestPath)
    $manifestSidecarPath = $manifestPath + '.sha256'
    if (-not [System.IO.Directory]::Exists($source)) {
        Throw-SafeGateError 'SOURCE_ROOT_NOT_FOUND'
    }
    if (-not [System.IO.Directory]::Exists($target)) {
        Throw-SafeGateError 'TARGET_ROOT_NOT_FOUND'
    }
    if ([string]::Equals($source, $target, [StringComparison]::OrdinalIgnoreCase)) {
        Throw-SafeGateError 'ROOTS_MUST_BE_DIFFERENT'
    }
    if (-not [System.IO.File]::Exists($databasePath)) {
        Throw-SafeGateError 'PCLOUD_LOCAL_DATABASE_NOT_FOUND'
    }
    if (
        -not (Test-AdministratorsOnlyFile $manifestPath) -or
        -not (Test-AdministratorsOnlyFile $manifestSidecarPath)
    ) {
        Throw-SafeGateError 'GHOST_EXCLUSION_ADMIN_ACL_REQUIRED'
    }
    $sidecarText = [System.IO.File]::ReadAllText($manifestSidecarPath).Trim()
    $sidecarMatch = [System.Text.RegularExpressions.Regex]::Match(
        $sidecarText,
        '^([a-f0-9]{64})  ([^\r\n]+)$',
        [System.Text.RegularExpressions.RegexOptions]::CultureInvariant
    )
    if (
        -not $sidecarMatch.Success -or
        $sidecarMatch.Groups[2].Value -ne [System.IO.Path]::GetFileName($manifestPath)
    ) {
        Throw-SafeGateError 'GHOST_EXCLUSION_SIDECAR_INVALID'
    }
    $manifestHash = (
        Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256
    ).Hash.ToLowerInvariant()
    if ($manifestHash -ne $sidecarMatch.Groups[1].Value) {
        Throw-SafeGateError 'GHOST_EXCLUSION_HASH_MISMATCH'
    }

    $pcloudProcesses = @(Get-Process -Name 'pCloud' -ErrorAction SilentlyContinue)
    if ($pcloudProcesses.Count -eq 0) {
        Throw-SafeGateError 'PCLOUD_DIFF_FLOW_PROCESS_NOT_RUNNING'
    }
    $nodeCommand = Get-Command node -CommandType Application -ErrorAction SilentlyContinue
    if ($null -eq $nodeCommand) {
        Throw-SafeGateError 'NODE_RUNTIME_NOT_FOUND'
    }
    $gatePath = Join-Path $PSScriptRoot 'pcloud-post-sync-rebaseline-gate.mjs'
    if (-not [System.IO.File]::Exists($gatePath)) {
        Throw-SafeGateError 'REBASELINE_TOOLING_NOT_FOUND'
    }

    $mode = if ($ProbeOnly) { 'probe' } else { 'gate' }
    $maximumSeconds = $MaximumMinutes * 60
    # Mirrors HB-2026-126: the Node core intentionally writes progress
    # (HASH_PROGRESS / MAINTENANCE_WINDOW_PROGRESS-equivalent) to stderr
    # while it waits/hashes. Under PS5.1 native stderr lines become
    # terminating records with $ErrorActionPreference='Stop'; relax it only
    # for this call.
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $gateOutput = & $nodeCommand.Source `
            $gatePath `
            '--mode' $mode `
            '--source-root' $source `
            '--target-root' $target `
            '--ghost-manifest' $manifestPath `
            '--ghost-manifest-sha256' $manifestHash `
            '--pcloud-db' $databasePath `
            '--poll-seconds' $PollSeconds `
            '--maximum-seconds' $maximumSeconds `
            '--progress-interval' $ProgressInterval | Out-String
        $gateExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    try {
        $gateResult = $gateOutput | ConvertFrom-Json
    }
    catch {
        Throw-SafeGateError 'REBASELINE_OUTPUT_INVALID'
    }
    if ($gateExitCode -eq 1 -or $gateResult.Status -eq 'error') {
        $gateErrorCode = [string]$gateResult.ErrorCode
        if ($gateErrorCode -cnotmatch '^[A-Z0-9_]+$') {
            $gateErrorCode = 'REBASELINE_GATE_FAILED'
        }
        Throw-SafeGateError $gateErrorCode
    }
    if ($gateExitCode -notin @(0, 2)) {
        Throw-SafeGateError 'REBASELINE_EXIT_CODE_INVALID'
    }

    if ($ProbeOnly) {
        $gateResult | ConvertTo-Json -Depth 12
        $exitCode = 2
    }
    else {
        $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
        $principal = [System.Security.Principal.WindowsPrincipal]::new($identity)
        if (-not $principal.IsInRole(
            [System.Security.Principal.WindowsBuiltInRole]::Administrator
        )) {
            Throw-SafeGateError 'ADMINISTRATOR_REQUIRED_FOR_GATE_REPORT'
        }
        Initialize-SecureReportDirectory
        $canonicalJson = $gateResult | ConvertTo-Json -Depth 16 -Compress
        $written = Write-SecureGateReport $canonicalJson
        $safeConsole = [ordered]@{
            SchemaVersion = 'pcloud-post-sync-rebaseline-wrapper/1.0.0'
            Status = [string]$gateResult.Status
            ReadOnly = $true
            EligibleForRebaseline = [bool]$gateResult.EligibleForRebaseline
            MinimumQuietSeconds = 600
            ObservedQuietSeconds = $gateResult.ObservedQuietSeconds
            WindowResetCount = $gateResult.WindowResetCount
            SourceTargetHashMatch = $gateResult.SourceTargetHashMatch
            Report = [ordered]@{
                FileName = $written.FileName
                Sha256 = $written.Sha256
                AdminOnly = $true
            }
            Blockers = @($gateResult.Blockers)
        }
        $safeConsole | ConvertTo-Json -Depth 8
        $exitCode = if ($gateExitCode -eq 0 -and $gateResult.Status -eq 'pass') {
            0
        }
        elseif ($gateExitCode -eq 2 -and $gateResult.Status -eq 'blocked') {
            2
        }
        else {
            1
        }
    }
}
catch {
    $safeError = [ordered]@{
        SchemaVersion = 'pcloud-post-sync-rebaseline-wrapper/1.0.0'
        Status = 'error'
        ReadOnly = $true
        EligibleForRebaseline = $false
        ErrorCode = if (
            $null -ne $_.Exception.Data -and
            $_.Exception.Data.Contains('SafeCode')
        ) {
            [string]$_.Exception.Data['SafeCode']
        }
        else {
            'REBASELINE_WRAPPER_RUNTIME_ERROR'
        }
        ErrorType = $_.Exception.GetType().Name
        ErrorLine = $_.InvocationInfo.ScriptLineNumber
    }
    $safeError | ConvertTo-Json -Depth 4
    $exitCode = 1
}

exit $exitCode
