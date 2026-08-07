[CmdletBinding()]
param(
    [string]$SourceRoot,

    [string]$TopLevelFolderName,

    [Parameter(Mandatory)]
    [string]$CaseRelativePath,

    [string]$PCloudLocalDatabasePath,

    [string]$AttestationStoreDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Source SHA-256 attestation generator (HB-2026-167, Karar 1).
#
# ADMIN/interactive-context tool: needs REAL access to pCloud's source
# (P:\ by default, same as run-pcloud-case-reconciliation.ps1) -- this is
# exactly why it exists as a SEPARATE, offline step, run by an
# administrator who has that access, rather than something a Windows
# service could ever do itself (P:\ is invisible in Session 0, see
# docs/D9_PER_CASE_RECONCILIATION_ARCHITECTURE.md HB-2026-166 finding).
# The resulting attestation store is what pcloud-session0-freshness-gate.mjs
# (fully Session-0-safe) later consults, without ever touching P:\ itself.
#
# Fully read-only toward pCloud/source: only ever READS source file bytes
# (to compute a real SHA-256) and READS the pCloud local DB (via the
# established withConsistentPcloudDatabase snapshot discipline). The only
# thing this script WRITES is its own attestation store (new files only,
# never modifies/deletes an existing case's real data) and its own
# Administrators-only evidence report.
#
# ACL note (NOT applied by this script): the attestation store is created
# Administrators-only, same as every other evidence directory in this
# repo. Granting svc-hb-fileagent READ-ONLY access to it (so the Session-0
# gate can actually consult it in production) is a SEPARATE, NOT-yet-
# applied decision requiring its own preview+apply cycle, mirroring the
# pCloud DB access work (HB-2026-163/164/165) -- this script does not
# grant it.

$AdministratorSidValue = 'S-1-5-32-544'
$ReportDirectory = 'C:\ProgramData\HasarBotu\migration-preflight'

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

$exitCode = 1
try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [System.Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Throw-SafeError 'ADMINISTRATOR_REQUIRED'
    }

    if ([string]::IsNullOrWhiteSpace($CaseRelativePath)) { Throw-SafeError 'CASE_RELATIVE_PATH_REQUIRED' }

    if ([string]::IsNullOrWhiteSpace($TopLevelFolderName)) { $TopLevelFolderName = 'BARAN GLOBAL EKSPERT' + [char]0x0130 + 'Z' }
    if ([string]::IsNullOrWhiteSpace($SourceRoot)) { $SourceRoot = Join-Path 'P:\' $TopLevelFolderName }
    $sourceCaseRoot = [System.IO.Path]::GetFullPath((Join-Path $SourceRoot $CaseRelativePath)).TrimEnd('\')
    if (-not [System.IO.Directory]::Exists($sourceCaseRoot)) { Throw-SafeError 'SOURCE_CASE_ROOT_NOT_FOUND' }

    if ([string]::IsNullOrWhiteSpace($PCloudLocalDatabasePath)) {
        if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) { Throw-SafeError 'PCLOUD_LOCAL_DATABASE_NOT_CONFIGURED' }
        $PCloudLocalDatabasePath = Join-Path $env:LOCALAPPDATA 'pCloud\data.db'
    }
    $databasePath = [System.IO.Path]::GetFullPath($PCloudLocalDatabasePath)
    if (-not [System.IO.File]::Exists($databasePath)) { Throw-SafeError 'PCLOUD_LOCAL_DATABASE_NOT_FOUND' }

    if ([string]::IsNullOrWhiteSpace($AttestationStoreDirectory)) { $AttestationStoreDirectory = 'C:\ProgramData\HasarBotu\pcloud-attestations' }
    $attestationStore = [System.IO.Path]::GetFullPath($AttestationStoreDirectory)
    if (-not [System.IO.Directory]::Exists($attestationStore)) { [System.IO.Directory]::CreateDirectory($attestationStore) | Out-Null }
    # Administrators-only WRITE boundary for the store itself -- a
    # svc-hb-fileagent READ grant is a separate, not-yet-applied decision
    # (see header note above); this script never widens it.
    [System.IO.Directory]::SetAccessControl($attestationStore, (New-AdminOnlySecurity $true))

    $nodeCommand = Get-Command node -CommandType Application -ErrorAction SilentlyContinue
    if ($null -eq $nodeCommand) { Throw-SafeError 'NODE_RUNTIME_NOT_FOUND' }
    $toolPath = Join-Path $PSScriptRoot 'generate-pcloud-source-attestation.mjs'
    if (-not [System.IO.File]::Exists($toolPath)) { Throw-SafeError 'ATTESTATION_TOOLING_NOT_FOUND' }

    $attestedBy = "$env:COMPUTERNAME\$env:USERNAME"
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $toolOutput = & $nodeCommand.Source `
            $toolPath `
            '--source-case-root' $sourceCaseRoot `
            '--pcloud-db' $databasePath `
            '--top-level-folder-name' $TopLevelFolderName `
            '--case-relative-path' $CaseRelativePath `
            '--attestation-store' $attestationStore `
            '--attested-by' $attestedBy | Out-String
        $toolExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    try {
        $result = $toolOutput | ConvertFrom-Json
    }
    catch {
        Throw-SafeError 'ATTESTATION_OUTPUT_INVALID'
    }
    $resultHasStatusField = $null -ne $result.PSObject.Properties['Status']
    if ($toolExitCode -ne 0 -or ($resultHasStatusField -and $result.Status -eq 'error')) {
        $errorCode = if ($resultHasStatusField) { [string]$result.ErrorCode } else { $null }
        if ([string]::IsNullOrWhiteSpace($errorCode) -or $errorCode -cnotmatch '^[A-Z0-9_]+$') { $errorCode = 'ATTESTATION_GENERATION_FAILED' }
        Throw-SafeError $errorCode
    }

    if (-not [System.IO.Directory]::Exists($ReportDirectory)) { [System.IO.Directory]::CreateDirectory($ReportDirectory) | Out-Null }
    [System.IO.Directory]::SetAccessControl($ReportDirectory, (New-AdminOnlySecurity $true))
    $timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
    $suffix = [Guid]::NewGuid().ToString('N').Substring(0, 8)
    $fileName = "pcloud-source-attestation-$timestamp-$suffix.json"
    $finalPath = Join-Path $ReportDirectory $fileName
    $canonicalJson = $result | ConvertTo-Json -Depth 16 -Compress
    [System.IO.File]::WriteAllText($finalPath, $canonicalJson, [System.Text.UTF8Encoding]::new($false))
    Set-AdminOnlyFileSecurity $finalPath
    $reportHash = (Get-FileHash -LiteralPath $finalPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $sidecarPath = "$finalPath.sha256"
    [System.IO.File]::WriteAllText($sidecarPath, "$reportHash  $fileName", [System.Text.UTF8Encoding]::new($false))
    Set-AdminOnlyFileSecurity $sidecarPath

    $safeConsole = [ordered]@{
        SchemaVersion = 'hasarbotu-pcloud-source-attestation-wrapper/1.0.0'
        ReadOnlyTowardSourceAndPCloud = $true
        CaseRelativePath = $CaseRelativePath
        AttestedFileCount = @($result.Records).Count
        AttestationStoreDirectory = $attestationStore
        Report = [ordered]@{
            FileName = $fileName
            Sha256 = $reportHash
            AdminOnly = $true
        }
    }
    $safeConsole | ConvertTo-Json -Depth 8
    $exitCode = 0
}
catch {
    $safeError = [ordered]@{
        SchemaVersion = 'hasarbotu-pcloud-source-attestation-wrapper/1.0.0'
        Status = 'error'
        ErrorCode = if ($null -ne $_.Exception.Data -and $_.Exception.Data.Contains('SafeCode')) { [string]$_.Exception.Data['SafeCode'] } else { 'ATTESTATION_WRAPPER_RUNTIME_ERROR' }
        ErrorType = $_.Exception.GetType().Name
        ErrorLine = $_.InvocationInfo.ScriptLineNumber
    }
    $safeError | ConvertTo-Json -Depth 4
    $exitCode = 1
}

exit $exitCode
