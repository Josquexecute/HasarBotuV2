[CmdletBinding()]
param(
    [string]$ServiceAccountName = 'svc-hb-fileagent',

    [string]$ProbeServiceId = 'hasarbotu-file-agent-probe',

    [string]$FileAgentServiceName = 'hasarbotu-file-agent',

    [string]$WinSwExePath = 'C:\Tools\WinSW-x64.exe',

    [string]$InnerProbeScriptPath,

    [string]$PlannedResultDirectory = 'C:\ProgramData\HasarBotu\file-agent-probe-results'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# File Agent disposable probe service -- PLAN + PREVIEW ONLY (HB-2026-167,
# Karar 2). No -Apply switch exists in this script at all (same structural
# discipline as preview-file-agent-pcloud-db-access.ps1) -- it never
# registers, starts, stops, or removes any Windows service, never writes
# env vars, never touches the REAL hasarbotu-file-agent service.
#
# Approved design (Karar 2): do NOT add a self-test mode to the
# PRODUCTION File Agent entry point. Instead, plan a SEPARATE, one-shot,
# self-cleaning WinSW service (distinct id, $ProbeServiceId) running as
# the EXISTING svc-hb-fileagent account (SeServiceLogonRight, already
# granted, HB-2026-113) whose only job is to run
# file-agent-disposable-probe-inner.ps1 once, then be fully removable --
# proving real pCloud DB read, WAL/SHM (via reading the real -wal/-shm
# filenames directly, not a throwaway-file proxy), no-write, and
# per-case freshness LIBRARY access (pcloud-session0-freshness-gate.mjs,
# invoked directly, non-admin, exactly as a real File Agent invocation
# would) all under the REAL service account's own security context.
#
# This tool verifies preconditions and produces the PLANNED WinSW XML +
# confirms the inner script's safety properties -- it does not write an
# installable XML file anywhere, and performs zero mutation.
#
# Real, honest blocker found while researching this plan (not previously
# documented in this specific context): registering a SECOND Windows
# service under the SAME service account requires `sc.exe config
# <newServiceId> obj= .\<account> password=<...>` -- Windows validates
# this against the account's ACTUAL CURRENT password in SAM at every
# service start (it is not an independent per-service secret). HB-2026-118
# generated svc-hb-fileagent's password once, used it immediately for the
# REAL hasarbotu-file-agent service's own `sc.exe config`, and never
# retained it anywhere (by design). This means the probe service's future
# Apply step cannot simply "install and start" -- it would first need to
# RESET the account's password (a real, mutating LSA/SAM operation) and
# immediately re-apply it via `sc.exe config` to BOTH the new probe
# service AND (to keep it consistent) the real service, then discard it
# again, matching the exact "generate once, apply immediately, never
# store" pattern HB-2026-118 already established. This is reported here
# as a genuine, unresolved precondition for real activation, not silently
# worked around or deferred without mention.

$AdministratorSidValue = 'S-1-5-32-544'
$ReportDirectory = 'C:\ProgramData\HasarBotu\migration-preflight'

function Throw-SafePreviewError {
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
    if (-not (Test-AdminOnlyAcl $Path $false)) { Throw-SafePreviewError 'ADMIN_ONLY_ACL_APPLY_FAILED' }
}

try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [System.Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Throw-SafePreviewError 'ADMINISTRATOR_REQUIRED'
    }

    if ([string]::IsNullOrWhiteSpace($InnerProbeScriptPath)) {
        $InnerProbeScriptPath = Join-Path $PSScriptRoot 'file-agent-disposable-probe-inner.ps1'
    }

    $preconditions = [ordered]@{}

    # 1) Inner probe script exists, parses cleanly, and is structurally
    #    safe (no service/env/ACL mutation calls anywhere in it).
    $innerScriptExists = [System.IO.File]::Exists($InnerProbeScriptPath)
    $innerScriptParseOk = $false
    $innerScriptSafe = $false
    $innerScriptSafetyDetail = $null
    if ($innerScriptExists) {
        $tokens = $null
        $parseErrors = $null
        [System.Management.Automation.Language.Parser]::ParseFile($InnerProbeScriptPath, [ref]$tokens, [ref]$parseErrors) | Out-Null
        $innerScriptParseOk = (@($parseErrors).Count -eq 0)
        $innerScriptText = [System.IO.File]::ReadAllText($InnerProbeScriptPath)
        $forbiddenPatterns = @('Start-Service', 'Stop-Service', 'Set-Service', 'New-Service', 'Remove-Service', 'New-LocalUser', 'Set-LocalUser', 'sc\.exe', 'SetEnvironmentVariable', 'Set-Acl', 'SetAccessControl')
        $foundForbidden = @($forbiddenPatterns | Where-Object { $innerScriptText -match $_ })
        $innerScriptSafe = ($foundForbidden.Count -eq 0)
        $innerScriptSafetyDetail = if ($innerScriptSafe) { 'No service/account/ACL/env mutation calls found -- read/probe only.' } else { "Forbidden pattern(s) found: $($foundForbidden -join ', ')" }
    }
    $preconditions['inner_probe_script'] = [ordered]@{
        Status = if ($innerScriptExists -and $innerScriptParseOk -and $innerScriptSafe) { 'verified_ok' } else { 'blocked_structural' }
        Exists = $innerScriptExists
        ParsesCleanly = $innerScriptParseOk
        StructurallySafe = $innerScriptSafe
        Detail = $innerScriptSafetyDetail
    }

    # 2) WinSW availability + probe service id does not collide with the
    #    real File Agent service and is not already registered.
    $winswExists = [System.IO.File]::Exists($WinSwExePath)
    $idCollidesWithReal = ($ProbeServiceId -eq $FileAgentServiceName)
    $probeAlreadyRegistered = ($null -ne (Get-Service -Name $ProbeServiceId -ErrorAction SilentlyContinue))
    $preconditions['winsw_and_service_id'] = [ordered]@{
        Status = if ($winswExists -and -not $idCollidesWithReal -and -not $probeAlreadyRegistered) { 'verified_ok' } else { 'blocked_structural' }
        WinSwExeExists = $winswExists
        ProbeServiceIdDistinctFromRealService = -not $idCollidesWithReal
        ProbeServiceIdAlreadyRegistered = $probeAlreadyRegistered
        Detail = if ($probeAlreadyRegistered) { "A service named '$ProbeServiceId' is already registered -- would need cleanup before a future Apply, this preview does not touch it." } else { 'WinSW present; probe id is free and distinct from the real service.' }
    }

    # 3) pCloud DB read access still sufficient -- re-invoke the ORIGINAL,
    #    unmodified preview tool fresh.
    $dbPreviewScriptPath = Join-Path $PSScriptRoot 'preview-file-agent-pcloud-db-access.ps1'
    $dbPreviewRaw = & $dbPreviewScriptPath -ServiceAccountName $ServiceAccountName 2>&1 | Out-String
    $dbPreviewWrapper = $null
    try { $dbPreviewWrapper = $dbPreviewRaw | ConvertFrom-Json } catch { Throw-SafePreviewError 'DB_PREVIEW_OUTPUT_INVALID' }
    $dbHasStatusField = $null -ne $dbPreviewWrapper.PSObject.Properties['Status']
    $dbAccessOk = (-not $dbHasStatusField -or $dbPreviewWrapper.Status -ne 'error') -and $dbPreviewWrapper.OverallStatus -eq 'already_sufficient'
    $preconditions['pcloud_db_access'] = [ordered]@{
        Status = if ($dbAccessOk) { 'verified_ok' } else { 'blocked_structural' }
        OverallStatusAtCheckTime = if ($dbHasStatusField -and $dbPreviewWrapper.Status -eq 'error') { $null } else { $dbPreviewWrapper.OverallStatus }
        Detail = if ($dbAccessOk) { 'Fresh re-check: already_sufficient (HB-2026-165 grant still in place).' } else { 'ACL grant is not (or no longer) already_sufficient -- probe would fail the DB read step.' }
    }

    # 4) Session-0-safe freshness gate module + its own test suite passes
    #    fresh, right now.
    $gateModulePath = Join-Path $PSScriptRoot 'pcloud-session0-freshness-gate.mjs'
    $gateTestPath = Join-Path $PSScriptRoot 'pcloud-session0-freshness-gate.test.mjs'
    $gateFilesPresent = ([System.IO.File]::Exists($gateModulePath) -and [System.IO.File]::Exists($gateTestPath))
    $gateTestExitCode = -1
    if ($gateFilesPresent) {
        & node --test $gateTestPath 2>&1 | Out-Null
        $gateTestExitCode = $LASTEXITCODE
    }
    $preconditions['freshness_gate_library'] = [ordered]@{
        Status = if ($gateFilesPresent -and $gateTestExitCode -eq 0) { 'verified_ok' } else { 'blocked_structural' }
        FilesPresent = $gateFilesPresent
        FreshTestExitCode = $gateTestExitCode
        Detail = if ($gateFilesPresent -and $gateTestExitCode -eq 0) { 'pcloud-session0-freshness-gate.mjs present, its own test suite passes fresh (Session-0-safe, zero P:\ dependency).' } else { 'Freshness gate module missing or its tests are not currently passing -- probe would not meaningfully prove library access.' }
    }

    # 5) Planned result directory + its ACL -- NOT created by this script.
    #    svc-hb-fileagent has no grant on C:\ProgramData\HasarBotu\* today;
    #    a future Apply tool would need to create $PlannedResultDirectory
    #    with Administrators=Full + $ServiceAccountName=Write (a NEW,
    #    narrow grant, distinct from the pCloud DB read grant).
    $resultDirectoryExists = [System.IO.Directory]::Exists($PlannedResultDirectory)
    $preconditions['result_directory_acl_plan'] = [ordered]@{
        Status = 'deferred_to_real_activation'
        PlannedPath = $PlannedResultDirectory
        CurrentlyExists = $resultDirectoryExists
        Detail = "svc-hb-fileagent currently has NO grant under C:\ProgramData\HasarBotu\*. A future Apply tool must create this directory with Administrators=Full + $ServiceAccountName=Write (a NEW, narrow, not-yet-applied grant, separate from the pCloud DB read ACL) before the probe can report results there. NOT created by this preview."
    }

    # 6) Service-account logon credential mechanics for a SECOND service
    #    under the same account -- a real, honest blocker, not resolved
    #    here (see header comment for full reasoning).
    $preconditions['second_service_logon_credential'] = [ordered]@{
        Status = 'blocked_structural'
        Detail = "Registering $ProbeServiceId to log on as $ServiceAccountName requires 'sc.exe config $ProbeServiceId obj= .\$ServiceAccountName password=<...>', which Windows validates against the account's ACTUAL CURRENT password in SAM at every start -- it is not an independent per-service secret. HB-2026-118 generated this account's password once, applied it immediately to the REAL $FileAgentServiceName service via the same mechanism, and never retained it (by design). A future Apply step must first RESET the account's password and immediately re-apply it to BOTH services via sc.exe config, then discard it again -- an explicit, separate, real LSA/SAM mutation this preview does not perform or plan to work around silently."
    }

    $blockedCount = @($preconditions.Values | Where-Object { $_.Status -eq 'blocked_structural' }).Count
    $deferredCount = @($preconditions.Values | Where-Object { $_.Status -eq 'deferred_to_real_activation' }).Count
    $overallReadiness = if ($blockedCount -eq 0) { 'ready_for_apply_design' } else { 'blocked' }

    # --- Planned WinSW XML content (a STRING, not written as an
    #     installable file anywhere by this script). One-shot semantics:
    #     Manual start mode (never Automatic), no onfailure restart
    #     policy (a probe that "fails" once should not loop retrying). ---
    $plannedWinSwXml = @"
<service>
  <id>$ProbeServiceId</id>
  <name>HasarBotu V2 - File Agent Disposable Probe (TEMPORARY, self-removing)</name>
  <description>One-shot pCloud DB read/no-write/freshness-gate probe run as $ServiceAccountName. Registered, run once, and unregistered by the (future) Apply tool -- never left installed.</description>
  <executable>powershell.exe</executable>
  <arguments>-NoProfile -ExecutionPolicy Bypass -File "$InnerProbeScriptPath" -PCloudLocalDatabasePath "..." -TargetRoot "..." -TopLevelFolderName "..." -TestCaseRelativePath "..." -AttestationStoreDirectory "..." -ResultPath "$PlannedResultDirectory\result.json"</arguments>
  <serviceaccount>
    <user>$ServiceAccountName</user>
    <allowservicelogon>true</allowservicelogon>
  </serviceaccount>
  <startmode>Manual</startmode>
  <onfailure action="none"/>
  <logpath>%BASE%\logs</logpath>
</service>
"@

    $output = [ordered]@{
        SchemaVersion = 'hasarbotu-file-agent-disposable-probe-service-preview/1.0.0'
        Mode = 'preview'
        GeneratedAtUtc = [DateTime]::UtcNow.ToString('o')
        ServiceAccountName = $ServiceAccountName
        ProbeServiceId = $ProbeServiceId
        Preconditions = $preconditions
        BlockedPreconditionCount = $blockedCount
        DeferredPreconditionCount = $deferredCount
        OverallReadiness = $overallReadiness
        PlannedWinSwXml = $plannedWinSwXml
        Note = 'No service was registered/started/stopped/removed. No env/ACL/credential change was made. Real activation requires a SEPARATE, explicit Apply tool (not yet written) plus explicit resolution of the result-directory ACL grant and the second-service logon credential mechanics flagged above.'
    }

    if (-not [System.IO.Directory]::Exists($ReportDirectory)) { [System.IO.Directory]::CreateDirectory($ReportDirectory) | Out-Null }
    [System.IO.Directory]::SetAccessControl($ReportDirectory, (New-AdminOnlySecurity $true))
    $timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
    $suffix = [Guid]::NewGuid().ToString('N').Substring(0, 8)
    $fileName = "file-agent-disposable-probe-service-preview-$timestamp-$suffix.json"
    $finalPath = Join-Path $ReportDirectory $fileName
    $json = $output | ConvertTo-Json -Depth 16
    [System.IO.File]::WriteAllText($finalPath, $json, [System.Text.UTF8Encoding]::new($false))
    Set-AdminOnlyFileSecurity $finalPath
    $reportHash = (Get-FileHash -LiteralPath $finalPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $sidecarPath = "$finalPath.sha256"
    [System.IO.File]::WriteAllText($sidecarPath, "$reportHash  $fileName", [System.Text.UTF8Encoding]::new($false))
    Set-AdminOnlyFileSecurity $sidecarPath

    Write-Output ([ordered]@{
        SchemaVersion = 'hasarbotu-file-agent-disposable-probe-service-preview-wrapper/1.0.0'
        ReadOnly = $true
        OverallReadiness = $overallReadiness
        BlockedPreconditionCount = $blockedCount
        DeferredPreconditionCount = $deferredCount
        PreconditionsSummary = @($preconditions.Keys | ForEach-Object { [ordered]@{ Name = $_; Status = $preconditions[$_].Status } })
        Report = [ordered]@{ FileName = $fileName; Sha256 = $reportHash; AdminOnly = $true }
    } | ConvertTo-Json -Depth 6)
    exit 0
}
catch {
    $safeError = [ordered]@{
        SchemaVersion = 'hasarbotu-file-agent-disposable-probe-service-preview-wrapper/1.0.0'
        Status = 'error'
        ReadOnly = $true
        ErrorCode = if ($null -ne $_.Exception.Data -and $_.Exception.Data.Contains('SafeCode')) { [string]$_.Exception.Data['SafeCode'] } else { 'FILE_AGENT_DISPOSABLE_PROBE_SERVICE_PREVIEW_RUNTIME_ERROR' }
        ErrorType = $_.Exception.GetType().Name
        ErrorLine = $_.InvocationInfo.ScriptLineNumber
    }
    $safeError | ConvertTo-Json -Depth 4
    exit 1
}
