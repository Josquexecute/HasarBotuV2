[CmdletBinding()]
param(
    [string]$SourceRoot,

    [string]$TargetRoot,

    [string]$GhostExclusionManifestPath,

    [string]$PCloudLocalDatabasePath,

    [ValidateRange(0, 10000)]
    [int]$ProgressInterval = 500
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# D8 post-sync source/target diff forensics wrapper (HB-2026-131 follow-up).
#
# Fully read-only: never writes to pCloud's database, source, target, env or
# services. Runs pcloud-post-sync-diff-forensics.mjs (per-file SHA-256 diff +
# pCloud current-object/revision/task-reference lookup for every non-
# identical entry) and writes the FULL result — including absolute source/
# target paths — only to the Administrators-only evidence directory. Console
# output is redacted to relative paths and classification/currency only,
# never an absolute P:\ or C:\HasarBotuStorage\ path.

$AdministratorSidValue = 'S-1-5-32-544'
$ReportDirectory = 'C:\ProgramData\HasarBotu\migration-preflight'
$exitCode = 1

function Throw-SafeError {
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
    if (-not (Test-AdminOnlyAcl $Path $false)) { Throw-SafeError 'ADMIN_ONLY_ACL_APPLY_FAILED' }
}

try {
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [System.Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Throw-SafeError 'ADMINISTRATOR_REQUIRED'
    }

    if ([string]::IsNullOrWhiteSpace($SourceRoot) -or [string]::IsNullOrWhiteSpace($TargetRoot)) {
        $companyFolder = 'BARAN GLOBAL EKSPERT' + [char]0x0130 + 'Z'
        if ([string]::IsNullOrWhiteSpace($SourceRoot)) { $SourceRoot = Join-Path 'P:\' $companyFolder }
        if ([string]::IsNullOrWhiteSpace($TargetRoot)) { $TargetRoot = Join-Path 'C:\HasarBotuStorage' $companyFolder }
    }
    $source = [System.IO.Path]::GetFullPath($SourceRoot).TrimEnd('\')
    $target = [System.IO.Path]::GetFullPath($TargetRoot).TrimEnd('\')
    if (-not [System.IO.Directory]::Exists($source)) { Throw-SafeError 'SOURCE_ROOT_NOT_FOUND' }
    if (-not [System.IO.Directory]::Exists($target)) { Throw-SafeError 'TARGET_ROOT_NOT_FOUND' }

    if ([string]::IsNullOrWhiteSpace($GhostExclusionManifestPath)) { Throw-SafeError 'GHOST_EXCLUSION_MANIFEST_REQUIRED' }
    $manifestPath = [System.IO.Path]::GetFullPath($GhostExclusionManifestPath)
    $manifestSidecarPath = "$manifestPath.sha256"
    if (-not (Test-AdministratorsOnlyFile $manifestPath) -or -not (Test-AdministratorsOnlyFile $manifestSidecarPath)) {
        Throw-SafeError 'GHOST_EXCLUSION_ADMIN_ACL_REQUIRED'
    }
    $manifestSidecarText = [System.IO.File]::ReadAllText($manifestSidecarPath).Trim()
    $manifestSidecarMatch = [System.Text.RegularExpressions.Regex]::Match($manifestSidecarText, '^([a-f0-9]{64})  ([^\r\n]+)$')
    if (-not $manifestSidecarMatch.Success -or $manifestSidecarMatch.Groups[2].Value -ne [System.IO.Path]::GetFileName($manifestPath)) {
        Throw-SafeError 'GHOST_EXCLUSION_SIDECAR_INVALID'
    }
    $manifestHash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($manifestHash -ne $manifestSidecarMatch.Groups[1].Value) { Throw-SafeError 'GHOST_EXCLUSION_HASH_MISMATCH' }

    if ([string]::IsNullOrWhiteSpace($PCloudLocalDatabasePath)) {
        if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) { Throw-SafeError 'PCLOUD_LOCAL_DATABASE_NOT_CONFIGURED' }
        $PCloudLocalDatabasePath = Join-Path $env:LOCALAPPDATA 'pCloud\data.db'
    }
    $databasePath = [System.IO.Path]::GetFullPath($PCloudLocalDatabasePath)
    if (-not [System.IO.File]::Exists($databasePath)) { Throw-SafeError 'PCLOUD_LOCAL_DATABASE_NOT_FOUND' }

    $nodeCommand = Get-Command node -CommandType Application -ErrorAction SilentlyContinue
    if ($null -eq $nodeCommand) { Throw-SafeError 'NODE_RUNTIME_NOT_FOUND' }
    $toolPath = Join-Path $PSScriptRoot 'pcloud-post-sync-diff-forensics.mjs'
    if (-not [System.IO.File]::Exists($toolPath)) { Throw-SafeError 'DIFF_FORENSICS_TOOLING_NOT_FOUND' }

    # The Node core writes DIFF_HASH_PROGRESS lines to stderr while it hashes
    # both trees (mirrors HB-2026-126/130); under PS5.1 those become
    # terminating records with $ErrorActionPreference='Stop'.
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $toolOutput = & $nodeCommand.Source `
            $toolPath `
            '--source-root' $source `
            '--target-root' $target `
            '--ghost-manifest' $manifestPath `
            '--ghost-manifest-sha256' $manifestHash `
            '--pcloud-db' $databasePath `
            '--progress-interval' $ProgressInterval | Out-String
        $toolExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    try {
        $report = $toolOutput | ConvertFrom-Json
    }
    catch {
        Throw-SafeError 'DIFF_FORENSICS_OUTPUT_INVALID'
    }
    if ($toolExitCode -eq 1 -or $report.Status -eq 'error') {
        $errorCode = [string]$report.ErrorCode
        if ($errorCode -cnotmatch '^[A-Z0-9_]+$') { $errorCode = 'DIFF_FORENSICS_FAILED' }
        Throw-SafeError $errorCode
    }
    if ($toolExitCode -notin @(0, 2)) { Throw-SafeError 'DIFF_FORENSICS_EXIT_CODE_INVALID' }

    if (-not [System.IO.Directory]::Exists($ReportDirectory)) { [System.IO.Directory]::CreateDirectory($ReportDirectory) | Out-Null }
    [System.IO.Directory]::SetAccessControl($ReportDirectory, (New-AdminOnlySecurity $true))
    $timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
    $suffix = [Guid]::NewGuid().ToString('N').Substring(0, 8)
    $fileName = "pcloud-post-sync-diff-forensics-$timestamp-$suffix.json"
    $finalPath = Join-Path $ReportDirectory $fileName
    $canonicalJson = $report | ConvertTo-Json -Depth 16 -Compress
    [System.IO.File]::WriteAllText($finalPath, $canonicalJson, [System.Text.UTF8Encoding]::new($false))
    Set-AdminOnlyFileSecurity $finalPath
    $reportHash = (Get-FileHash -LiteralPath $finalPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $sidecarPath = "$finalPath.sha256"
    [System.IO.File]::WriteAllText($sidecarPath, "$reportHash  $fileName", [System.Text.UTF8Encoding]::new($false))
    Set-AdminOnlyFileSecurity $sidecarPath

    $perFile = @($report.Entries | ForEach-Object {
        [ordered]@{
            RelativePath = $_.RelativePath
            Classification = $_.Classification
            Currency = $_.Currency
            SourceSha256 = if ($_.Source) { $_.Source.Sha256 } else { $null }
            TargetSha256 = if ($_.Target) { $_.Target.Sha256 } else { $null }
            PCloudTaskReferenceCount = if ($_.PCloud.found -ne $false) { $_.PCloud.TaskReferenceCount } else { $null }
        }
    })
    $safeConsole = [ordered]@{
        SchemaVersion = 'pcloud-post-sync-diff-forensics-wrapper/1.0.0'
        ReadOnly = $true
        Summary = $report.Summary
        PCloudQueueState = $report.PCloudQueueState
        ConflictNamesFoundCount = @($report.ConflictNamesFound).Count
        PerFile = $perFile
        Report = [ordered]@{
            FileName = $fileName
            Sha256 = $reportHash
            AdminOnly = $true
        }
    }
    $safeConsole | ConvertTo-Json -Depth 8
    $exitCode = if ($toolExitCode -eq 0) { 0 } else { 2 }
}
catch {
    $safeError = [ordered]@{
        SchemaVersion = 'pcloud-post-sync-diff-forensics-wrapper/1.0.0'
        Status = 'error'
        ReadOnly = $true
        ErrorCode = if ($null -ne $_.Exception.Data -and $_.Exception.Data.Contains('SafeCode')) { [string]$_.Exception.Data['SafeCode'] } else { 'DIFF_FORENSICS_WRAPPER_RUNTIME_ERROR' }
        ErrorType = $_.Exception.GetType().Name
        ErrorLine = $_.InvocationInfo.ScriptLineNumber
    }
    $safeError | ConvertTo-Json -Depth 4
    $exitCode = 1
}

exit $exitCode
