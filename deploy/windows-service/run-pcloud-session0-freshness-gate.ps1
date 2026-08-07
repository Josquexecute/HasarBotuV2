[CmdletBinding()]
param(
    [string]$TargetRoot,

    [string]$PCloudLocalDatabasePath,

    [string]$AttestationStoreDirectory,

    [string]$TopLevelFolderName,

    [Parameter(Mandatory)]
    [string]$CaseRelativePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Session-0-safe per-case freshness gate CLI wrapper (HB-2026-167, Karar 1).
#
# Fully read-only: never writes to pCloud's database, target, env or
# services, and has no delete capability. UNLIKE run-pcloud-case-
# reconciliation.ps1 (HB-2026-162), this wrapper has NO -SourceRoot
# parameter at all and NEVER defaults anything to P:\ -- there is
# structurally nothing here that could resolve to pCloud's virtual drive,
# which is exactly why this CAN run from inside a real Windows service
# (Session 0), unlike its predecessor (see docs/
# D9_PER_CASE_RECONCILIATION_ARCHITECTURE.md HB-2026-166 finding: P:\ is
# invisible in Session 0 regardless of account or ACLs).
#
# Runs pcloud-session0-freshness-gate.mjs (target-tree walk + pCloud DB
# NAME-based resolution + live task-queue reference count + a separately
# generated SHA-256 source attestation lookup -- see pcloud-source-
# attestation.mjs) for EXACTLY ONE case folder and writes the FULL result
# — including the target's absolute path — only to the Administrators-only
# evidence directory. Console output is limited to relative paths and
# classification/status fields, never an absolute C:\HasarBotuStorage\
# path.
#
# Exit code contract (matches run-pcloud-case-reconciliation.ps1's
# existing contract exactly, so a future File Agent integration can treat
# both the same way): 0 = ready, 2 = not ready (syncing/unknown/conflict),
# 1 = error.

$AdministratorSidValue = 'S-1-5-32-544'
$ReportDirectory = 'C:\ProgramData\HasarBotu\migration-preflight'
$exitCode = 1

function Throw-SafeError {
    param([string]$Code)
    $exception = [System.InvalidOperationException]::new($Code)
    $exception.Data['SafeCode'] = $Code
    throw $exception
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
    # Set once, for the whole script's remaining lifetime (not restored):
    # both the node passthrough output AND this script's own final JSON
    # print can contain Turkish characters (relative case paths). Same
    # discipline as run-pcloud-case-reconciliation.ps1.
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [System.Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Throw-SafeError 'ADMINISTRATOR_REQUIRED'
    }

    if ([string]::IsNullOrWhiteSpace($CaseRelativePath)) { Throw-SafeError 'CASE_RELATIVE_PATH_REQUIRED' }

    if ([string]::IsNullOrWhiteSpace($TopLevelFolderName)) { $TopLevelFolderName = 'BARAN GLOBAL EKSPERT' + [char]0x0130 + 'Z' }
    if ([string]::IsNullOrWhiteSpace($TargetRoot)) { $TargetRoot = Join-Path (Join-Path 'C:\HasarBotuStorage' $TopLevelFolderName) $CaseRelativePath }
    $target = [System.IO.Path]::GetFullPath($TargetRoot).TrimEnd('\')
    if (-not [System.IO.Directory]::Exists($target)) { Throw-SafeError 'TARGET_ROOT_NOT_FOUND' }

    if ([string]::IsNullOrWhiteSpace($PCloudLocalDatabasePath)) {
        if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) { Throw-SafeError 'PCLOUD_LOCAL_DATABASE_NOT_CONFIGURED' }
        $PCloudLocalDatabasePath = Join-Path $env:LOCALAPPDATA 'pCloud\data.db'
    }
    $databasePath = [System.IO.Path]::GetFullPath($PCloudLocalDatabasePath)
    if (-not [System.IO.File]::Exists($databasePath)) { Throw-SafeError 'PCLOUD_LOCAL_DATABASE_NOT_FOUND' }

    if ([string]::IsNullOrWhiteSpace($AttestationStoreDirectory)) { $AttestationStoreDirectory = 'C:\ProgramData\HasarBotu\pcloud-attestations' }
    $attestationStore = [System.IO.Path]::GetFullPath($AttestationStoreDirectory)
    # Deliberately NOT required to exist yet -- an empty/missing store just
    # means every file resolves to 'unknown' (no attestation found), which
    # is the correct, honest, fail-closed behavior, not an error.

    $nodeCommand = Get-Command node -CommandType Application -ErrorAction SilentlyContinue
    if ($null -eq $nodeCommand) { Throw-SafeError 'NODE_RUNTIME_NOT_FOUND' }
    $toolPath = Join-Path $PSScriptRoot 'pcloud-session0-freshness-gate.mjs'
    if (-not [System.IO.File]::Exists($toolPath)) { Throw-SafeError 'SESSION0_FRESHNESS_GATE_TOOLING_NOT_FOUND' }

    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $toolOutput = & $nodeCommand.Source `
            $toolPath `
            '--target-root' $target `
            '--top-level-folder-name' $TopLevelFolderName `
            '--case-relative-path' $CaseRelativePath `
            '--pcloud-db' $databasePath `
            '--attestation-store' $attestationStore | Out-String
        $toolExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    try {
        $report = $toolOutput | ConvertFrom-Json
    }
    catch {
        Throw-SafeError 'SESSION0_FRESHNESS_GATE_OUTPUT_INVALID'
    }
    # The tool's SUCCESS JSON has no "Status" field at all (only its error
    # path does) -- check presence first under StrictMode rather than
    # assuming the field exists (same class of bug found and fixed in
    # apply-file-agent-pcloud-db-access.ps1, HB-2026-164).
    $reportHasStatusField = $null -ne $report.PSObject.Properties['Status']
    if ($toolExitCode -eq 1 -or ($reportHasStatusField -and $report.Status -eq 'error')) {
        $errorCode = if ($reportHasStatusField) { [string]$report.ErrorCode } else { $null }
        if ([string]::IsNullOrWhiteSpace($errorCode) -or $errorCode -cnotmatch '^[A-Z0-9_]+$') { $errorCode = 'SESSION0_FRESHNESS_GATE_FAILED' }
        Throw-SafeError $errorCode
    }
    if ($toolExitCode -notin @(0, 2)) { Throw-SafeError 'SESSION0_FRESHNESS_GATE_EXIT_CODE_INVALID' }

    if (-not [System.IO.Directory]::Exists($ReportDirectory)) { [System.IO.Directory]::CreateDirectory($ReportDirectory) | Out-Null }
    [System.IO.Directory]::SetAccessControl($ReportDirectory, (New-AdminOnlySecurity $true))
    $timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
    $suffix = [Guid]::NewGuid().ToString('N').Substring(0, 8)
    $fileName = "pcloud-session0-freshness-gate-$timestamp-$suffix.json"
    $finalPath = Join-Path $ReportDirectory $fileName
    $canonicalJson = $report | ConvertTo-Json -Depth 16 -Compress
    [System.IO.File]::WriteAllText($finalPath, $canonicalJson, [System.Text.UTF8Encoding]::new($false))
    Set-AdminOnlyFileSecurity $finalPath
    $reportHash = (Get-FileHash -LiteralPath $finalPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $sidecarPath = "$finalPath.sha256"
    [System.IO.File]::WriteAllText($sidecarPath, "$reportHash  $fileName", [System.Text.UTF8Encoding]::new($false))
    Set-AdminOnlyFileSecurity $sidecarPath

    $perFile = @($report.Entries | ForEach-Object {
        # 'ready' entries have no Reason field at all (only non-ready
        # entries do) -- check presence first under StrictMode.
        $hasReason = $null -ne $_.PSObject.Properties['Reason']
        [ordered]@{
            RelativePath = $_.RelativePath
            FileStatus = $_.FileStatus
            Reason = if ($hasReason) { $_.Reason } else { $null }
        }
    })
    $safeConsole = [ordered]@{
        SchemaVersion = 'hasarbotu-pcloud-session0-freshness-gate-wrapper/1.0.0'
        ReadOnly = $true
        CaseRelativePath = $report.CaseRelativePath
        CaseStatus = $report.CaseStatus
        Summary = $report.Summary
        ConflictNamesFoundCount = @($report.ConflictNamesFound).Count
        PerFile = $perFile
        Report = [ordered]@{
            FileName = $fileName
            Sha256 = $reportHash
            AdminOnly = $true
        }
    }
    $safeConsole | ConvertTo-Json -Depth 8
    $exitCode = if ($report.CaseStatus -eq 'ready') { 0 } else { 2 }
}
catch {
    $safeError = [ordered]@{
        SchemaVersion = 'hasarbotu-pcloud-session0-freshness-gate-wrapper/1.0.0'
        Status = 'error'
        ReadOnly = $true
        ErrorCode = if ($null -ne $_.Exception.Data -and $_.Exception.Data.Contains('SafeCode')) { [string]$_.Exception.Data['SafeCode'] } else { 'SESSION0_FRESHNESS_GATE_WRAPPER_RUNTIME_ERROR' }
        ErrorType = $_.Exception.GetType().Name
        ErrorLine = $_.InvocationInfo.ScriptLineNumber
    }
    $safeError | ConvertTo-Json -Depth 4
    $exitCode = 1
}

exit $exitCode
