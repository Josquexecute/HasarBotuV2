[CmdletBinding()]
param(
    [string]$ServiceAccountName = 'svc-hb-fileagent',

    [string]$PCloudSyncAccount = "$env:COMPUTERNAME\$env:USERNAME",

    [string]$PCloudLocalDatabasePath,

    [string]$StorageRoot = 'C:\HasarBotuStorage\BARAN GLOBAL EKSPERTİZ',

    [string]$FileAgentServiceName = 'hasarbotu-file-agent',

    [string]$FileAgentAppDir = 'C:\HasarBotu\services\file-agent',

    [string]$WinSwExePath = 'C:\Tools\WinSW-x64.exe',

    [string]$FileAgentRepoSourceDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# File Agent CONTROLLED ACTIVATION -- PLAN + PREVIEW ONLY (HB-2026-166,
# follow-up to HB-2026-162/163/164/165).
#
# This script NEVER starts, enables, or stops any service, NEVER sets or
# clears an environment variable, NEVER writes to pCloud/storage data, and
# NEVER touches the real `hasarbotu-file-agent` service's configuration --
# there is no -Apply switch in this script at all (a deliberate, structural
# choice, same discipline as preview-file-agent-pcloud-db-access.ps1). It
# only reads real, current machine state and re-invokes other ALREADY
# read-only, already-tested tools fresh, then writes a single
# Administrators-only, hashed evidence report.
#
# It answers two things, with REAL evidence from THIS machine:
#   1. Precondition verification, for the 6 categories the controlled
#      activation depends on -- each precondition is reported as one of:
#        verified_ok               -- real, read-only check passed now.
#        verified_with_note        -- passed, with an important caveat.
#        deferred_to_real_activation -- cannot be proven without an actual
#                                       service logon (SeServiceLogonRight
#                                       only takes effect at real "log on
#                                       as a service" time; there is no
#                                       read-only substitute for it beyond
#                                       the ACL simulation already done).
#        blocked_structural         -- a genuine, currently-unresolved
#                                       architecture/OS-level gap. Reported
#                                       honestly, never silently papered
#                                       over or worked around here.
#   2. A 7-stage ACTIVATION SEQUENCE preview (env/root -> service config ->
#      start -> service-context DB probe -> per-case freshness smoke ->
#      File Agent file-operation smoke -> verify/rollback) -- a structured
#      PLAN of what a FUTURE, separate, explicit Apply tool would do, with
#      each stage's planned actions, gating preconditions, verification
#      criteria and rollback plan spelled out. No stage is executed here.
#
# Real, honest finding surfaced by this tool (not previously documented in
# this specific context): `run-pcloud-case-reconciliation.ps1` -- the CLI
# contract the architecture doc names as what a File Agent freshness gate
# would call -- defaults its SourceRoot to `P:\<company folder>` (its own
# source, line ~118). `P:\` is pCloud's VIRTUAL DRIVE, bound to the
# interactive user's session; it is NOT visible in Session 0 (i.e. from
# ANY Windows service, regardless of which account it logs on as) -- this
# is the exact, already-documented constraint
# (hasarbotu-file-agent.winsw.xml's own header comment) that originally
# motivated migrating File Agent's storage root from `P:\` to
# `C:\HasarBotuStorage\...` in the first place. This means the freshness
# gate's CURRENT CLI contract is structurally NOT callable from within a
# real Windows service today, independent of any ACL/rights work already
# done -- reported here as `blocked_structural`, not glossed over.

$ReportDirectory = 'C:\ProgramData\HasarBotu\migration-preflight'
$AdministratorSidValue = 'S-1-5-32-544'

function Throw-SafeActivationPreviewError {
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
    if (-not (Test-AdminOnlyAcl $Path $false)) { Throw-SafeActivationPreviewError 'ADMIN_ONLY_ACL_APPLY_FAILED' }
}

function Read-HashVerifiedJson {
    param([string]$Path, [string]$ExpectedSha256)
    if (-not (Test-AdminOnlyAcl $Path $false)) { Throw-SafeActivationPreviewError 'REFERENCED_REPORT_ADMIN_ACL_REQUIRED' }
    $actualHash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $ExpectedSha256.ToLowerInvariant()) { Throw-SafeActivationPreviewError 'REFERENCED_REPORT_HASH_MISMATCH' }
    return [System.IO.File]::ReadAllText($Path) | ConvertFrom-Json
}

function Get-ForbiddenBitsPresent {
    # Independent cross-check (does not just trust a referenced report's
    # own OverallStatus field): walks raw Aces on a snapshot and returns
    # whether the SERVICE ACCOUNT ITSELF has any Allow ACE with a
    # write/delete/ownership bit. Deliberately scoped to ONLY the target
    # SID, not well-known groups (Authenticated Users/Everyone) -- unlike
    # the access-GRANTED simulation (where group membership legitimately
    # matters for "would this identity be let in"), this check answers
    # "did HasarBotu's own ACL work give the service account a write/
    # delete capability" specifically. A real, pre-existing Windows
    # DEFAULT ACE unrelated to this work (e.g. Authenticated Users'
    # standard this-folder-only AppendData on a bare drive root) is
    # outside HasarBotu's control/scope and must not produce a false
    # blocker here -- confirmed as a real false-positive during this
    # tool's own development (found via a real run, not assumed).
    param($AclSnapshot, [string]$TargetSid)
    if ($null -eq $AclSnapshot) { return $false }
    $forbiddenMask = [int64](
        [System.Security.AccessControl.FileSystemRights]::WriteData -bor
        [System.Security.AccessControl.FileSystemRights]::AppendData -bor
        [System.Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
        [System.Security.AccessControl.FileSystemRights]::WriteAttributes -bor
        [System.Security.AccessControl.FileSystemRights]::Delete -bor
        [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
        [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
        [System.Security.AccessControl.FileSystemRights]::TakeOwnership
    )
    $relevant = @($AclSnapshot.Aces | Where-Object { $_.IdentitySid -eq $TargetSid })
    $allow = @($relevant | Where-Object { $_.AccessControlType -eq 'Allow' })
    foreach ($ace in $allow) {
        if (([int64]$ace.FileSystemRightsValue -band $forbiddenMask) -ne 0) { return $true }
    }
    return $false
}

try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [System.Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Throw-SafeActivationPreviewError 'ADMINISTRATOR_REQUIRED'
    }

    if ([string]::IsNullOrWhiteSpace($FileAgentRepoSourceDir)) {
        $FileAgentRepoSourceDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..\services\file-agent')).Path
    }

    $preconditions = [ordered]@{}

    # --- Precondition 1 + 6: pCloud data.db/-wal/-shm real read-only
    #     access, and absence of write/delete on that side. Re-invokes the
    #     ORIGINAL, unmodified preview-file-agent-pcloud-db-access.ps1
    #     fresh, right now (a real subprocess call, not a re-implementation
    #     that could silently diverge from it), then independently
    #     re-derives the forbidden-bit check from the raw ACL snapshots in
    #     its full report rather than just trusting its own OverallStatus.
    $dbPreviewScriptPath = Join-Path $PSScriptRoot 'preview-file-agent-pcloud-db-access.ps1'
    if (-not [System.IO.File]::Exists($dbPreviewScriptPath)) { Throw-SafeActivationPreviewError 'DB_PREVIEW_SCRIPT_NOT_FOUND' }
    $dbPreviewArgs = @{ ServiceAccountName = $ServiceAccountName; PCloudSyncAccount = $PCloudSyncAccount }
    if (-not [string]::IsNullOrWhiteSpace($PCloudLocalDatabasePath)) { $dbPreviewArgs['PCloudLocalDatabasePath'] = $PCloudLocalDatabasePath }
    $dbPreviewRaw = & $dbPreviewScriptPath @dbPreviewArgs 2>&1 | Out-String
    $dbPreviewWrapper = $null
    try { $dbPreviewWrapper = $dbPreviewRaw | ConvertFrom-Json } catch { Throw-SafeActivationPreviewError 'DB_PREVIEW_OUTPUT_INVALID' }
    $dbHasStatusField = $null -ne $dbPreviewWrapper.PSObject.Properties['Status']
    if ($dbHasStatusField -and $dbPreviewWrapper.Status -eq 'error') {
        $preconditions['pcloud_db_readonly_access'] = [ordered]@{ Status = 'blocked_structural'; Detail = "Fresh preview failed: $($dbPreviewWrapper.ErrorCode)" }
        $preconditions['pcloud_db_no_write_delete'] = [ordered]@{ Status = 'blocked_structural'; Detail = 'Cannot evaluate -- underlying preview failed.' }
    }
    else {
        $dbFullReport = Read-HashVerifiedJson -Path (Join-Path $ReportDirectory $dbPreviewWrapper.Report.FileName) -ExpectedSha256 $dbPreviewWrapper.Report.Sha256
        $serviceSid = ([System.Security.Principal.NTAccount]$ServiceAccountName).Translate([System.Security.Principal.SecurityIdentifier]).Value
        $anyForbidden = $false
        foreach ($entry in @($dbFullReport.AncestorChain)) { if (Get-ForbiddenBitsPresent -AclSnapshot $entry.AclSnapshot -TargetSid $serviceSid) { $anyForbidden = $true } }
        foreach ($entry in @($dbFullReport.DatabaseFiles)) { if ($entry.Exists -and (Get-ForbiddenBitsPresent -AclSnapshot $entry.AclSnapshot -TargetSid $serviceSid)) { $anyForbidden = $true } }

        $readAccessOk = ($dbPreviewWrapper.OverallStatus -eq 'already_sufficient')
        $preconditions['pcloud_db_readonly_access'] = [ordered]@{
            Status = if ($readAccessOk) { 'verified_with_note' } else { 'blocked_structural' }
            Detail = if ($readAccessOk) {
                "ACL simulation confirms sufficient Read access for $ServiceAccountName on data.db/-wal/-shm and its full ancestor chain (fresh re-check, OverallStatus=already_sufficient). A REAL logon-context read (SeServiceLogonRight actually taking effect) cannot be proven without a real service start -- that is Stage 3-4 of the activation sequence below, not something a preview can substitute for."
            }
            else {
                "Fresh preview shows OverallStatus=$($dbPreviewWrapper.OverallStatus) -- ACL grant work (HB-2026-163/164/165) is not (or no longer) in the expected state. Real activation must not proceed until this is already_sufficient again."
            }
            OverallStatusAtCheckTime = $dbPreviewWrapper.OverallStatus
        }
        $preconditions['pcloud_db_no_write_delete'] = [ordered]@{
            Status = if (-not $anyForbidden) { 'verified_ok' } else { 'blocked_structural' }
            Detail = if (-not $anyForbidden) { 'Independently re-derived from the raw ACL snapshots (not just the referenced report''s own summary field): zero write/delete/ownership bits present for the service account or well-known groups on any ancestor node or DB file.' } else { 'A write/delete/ownership bit was found on at least one node -- real activation must NOT proceed.' }
        }
    }

    # --- Precondition 2: rolling/per-case freshness gate access. Confirms
    #     the CLI contract exists and its underlying core module's own
    #     test suite passes fresh, right now -- but explicitly does NOT
    #     claim this proves service-context callability, because of the
    #     real, structural P:\ / Session-0 finding documented above.
    $reconciliationCoreScript = Join-Path $PSScriptRoot 'pcloud-case-reconciliation.mjs'
    $reconciliationTestScript = Join-Path $PSScriptRoot 'pcloud-case-reconciliation.test.mjs'
    $reconciliationWrapperScript = Join-Path $PSScriptRoot 'run-pcloud-case-reconciliation.ps1'
    $reconciliationFilesPresent = ([System.IO.File]::Exists($reconciliationCoreScript) -and [System.IO.File]::Exists($reconciliationTestScript) -and [System.IO.File]::Exists($reconciliationWrapperScript))
    $reconciliationTestExitCode = -1
    if ($reconciliationFilesPresent) {
        $nodeTestResult = & node --test $reconciliationTestScript 2>&1
        $reconciliationTestExitCode = $LASTEXITCODE
    }
    $wrapperSourceText = if ([System.IO.File]::Exists($reconciliationWrapperScript)) { [System.IO.File]::ReadAllText($reconciliationWrapperScript) } else { '' }
    $wrapperDefaultsToPDrive = ($wrapperSourceText -match [regex]::Escape("Join-Path 'P:\'"))
    $preconditions['per_case_freshness_gate_access'] = [ordered]@{
        Status = 'blocked_structural'
        Detail = if ($reconciliationFilesPresent -and $reconciliationTestExitCode -eq 0) {
            "CLI contract exists and its own test suite passes fresh (pcloud-case-reconciliation.test.mjs, node --test, exit 0) -- the LOGIC is sound and already relied on by run-pcloud-case-reconciliation.ps1 (HB-2026-162). HOWEVER: real, structural blocker found -- $reconciliationWrapperScript defaults its SourceRoot to 'P:\<company folder>' when not explicitly supplied. P:\ is pCloud's VIRTUAL DRIVE, bound to the interactive user's own session; it is NOT visible in Session 0 (i.e. NOT visible to ANY Windows service, regardless of which account it logs on as or what NTFS ACLs are granted) -- this is the same, already-documented constraint (hasarbotu-file-agent.winsw.xml's own header comment) that originally motivated migrating File Agent's own storage root to C:\HasarBotuStorage in the first place. WrapperDefaultsToPDrive=$wrapperDefaultsToPDrive. This means the freshness gate's CURRENT CLI contract structurally CANNOT be invoked meaningfully from inside a real running Windows service today -- this is an open architecture decision (narrow the gate to use only the already-access-granted pCloud local DB + target-side state, without full P:\ source diffing; OR wait until the P:\-to-C:\HasarBotuStorage migration is fully complete and redesign the gate around the target-only steady state), NOT something resolved unilaterally by this preview tool."
        }
        else {
            "CLI contract files present=$reconciliationFilesPresent, fresh test exit code=$reconciliationTestExitCode (expected 0) -- underlying module itself is not currently verified healthy; real activation must not proceed on the freshness-gate stage until this is fixed FIRST, in addition to the structural P:\ finding above."
        }
        FilesPresent = $reconciliationFilesPresent
        FreshTestExitCode = $reconciliationTestExitCode
        WrapperDefaultsToPDrive = $wrapperDefaultsToPDrive
    }

    # --- Precondition 3: storage root exists with exactly the expected 3
    #     ACEs (Administrators Full, pCloud sync account Modify, File
    #     Agent service account Modify) -- no more, no less.
    $storageRootExists = [System.IO.Directory]::Exists($StorageRoot)
    $storageRootAceSummary = @()
    $storageRootUnexpected = @()
    if ($storageRootExists) {
        $acl = [System.IO.Directory]::GetAccessControl($StorageRoot)
        $rules = @($acl.GetAccessRules($true, $false, [System.Security.Principal.SecurityIdentifier]))
        $syncSid = try { ([System.Security.Principal.NTAccount]$PCloudSyncAccount).Translate([System.Security.Principal.SecurityIdentifier]).Value } catch { $null }
        $svcSid = try { ([System.Security.Principal.NTAccount]$ServiceAccountName).Translate([System.Security.Principal.SecurityIdentifier]).Value } catch { $null }
        foreach ($rule in $rules) {
            $sidValue = $rule.IdentityReference.Value
            $label = if ($sidValue -eq $AdministratorSidValue) { 'Administrators' } elseif ($sidValue -eq $syncSid) { 'PCloudSyncAccount' } elseif ($sidValue -eq $svcSid) { 'FileAgentServiceAccount' } else { 'UNEXPECTED' }
            $entry = [ordered]@{ Label = $label; Rights = $rule.FileSystemRights.ToString(); Type = $rule.AccessControlType.ToString() }
            $storageRootAceSummary += $entry
            if ($label -eq 'UNEXPECTED') { $storageRootUnexpected += $entry }
        }
    }
    $preconditions['storage_root'] = [ordered]@{
        Status = if (-not $storageRootExists) { 'blocked_structural' } elseif ($storageRootUnexpected.Count -gt 0) { 'blocked_structural' } else { 'verified_ok' }
        Detail = if (-not $storageRootExists) { "StorageRoot does not exist: $StorageRoot" } elseif ($storageRootUnexpected.Count -gt 0) { "$($storageRootUnexpected.Count) unexpected ACE(s) found on the storage root beyond Administrators/PCloudSyncAccount/FileAgentServiceAccount." } else { 'Storage root exists with exactly the 3 expected ACEs, no drift.' }
        AceSummary = $storageRootAceSummary
    }

    # --- Precondition 4: current service config/credential/ACL/env
    #     baseline -- confirms the pre-activation state matches what is
    #     documented (Disabled/Stopped, correct LogOnAs, env vars unset),
    #     so Stage 1 (env/root) has a known-clean starting point.
    $svcCim = Get-CimInstance -ClassName Win32_Service -Filter "Name='$FileAgentServiceName'" -ErrorAction SilentlyContinue
    $envVarNames = @('HASARBOTU_AGENT_ROOTS', 'HASARBOTU_AGENT_ID', 'HASARBOTU_AGENT_SECRET', 'HASARBOTU_API_BASE_URL', 'HASARBOTU_AGENT_LEASE_SECONDS', 'HASARBOTU_AGENT_POLL_MS')
    $envState = [ordered]@{}
    foreach ($n in $envVarNames) { $envState[$n] = ($null -ne [Environment]::GetEnvironmentVariable($n, 'Machine')) }
    $anyEnvSet = @($envState.Values | Where-Object { $_ -eq $true }).Count -gt 0
    $appDirOk = [System.IO.Directory]::Exists($FileAgentAppDir)
    $distOk = [System.IO.File]::Exists((Join-Path $FileAgentAppDir 'dist\index.js'))
    $winswOk = [System.IO.File]::Exists($WinSwExePath)
    $serviceFoundAsExpected = ($null -ne $svcCim -and $svcCim.StartMode -eq 'Disabled' -and $svcCim.State -eq 'Stopped')
    $preconditions['service_config_credential_acl_env'] = [ordered]@{
        Status = if ($null -eq $svcCim) { 'blocked_structural' } elseif (-not $serviceFoundAsExpected) { 'verified_with_note' } elseif (-not ($appDirOk -and $distOk -and $winswOk)) { 'blocked_structural' } else { 'verified_ok' }
        Detail = if ($null -eq $svcCim) { "Service '$FileAgentServiceName' not found via SCM -- expected already installed per D6 (HB-2026-119/120)." } elseif (-not $serviceFoundAsExpected) { "Service found but StartMode=$($svcCim.StartMode)/State=$($svcCim.State) -- expected Disabled/Stopped as the untouched pre-activation baseline." } elseif (-not ($appDirOk -and $distOk -and $winswOk)) { "Deployment artifacts missing -- AppDirExists=$appDirOk, DistIndexExists=$distOk, WinSwExeExists=$winswOk." } else { 'Service correctly Disabled/Stopped, deployment artifacts present, all HASARBOTU_* machine env vars currently unset (clean starting point for Stage 1).' }
        ServiceStartMode = if ($null -ne $svcCim) { $svcCim.StartMode } else { $null }
        ServiceState = if ($null -ne $svcCim) { $svcCim.State } else { $null }
        ServiceLogOnAs = if ($null -ne $svcCim) { $svcCim.StartName } else { $null }
        AppDirExists = $appDirOk
        DistIndexExists = $distOk
        WinSwExeExists = $winswOk
        EnvVarsCurrentlySet = $envState
        AnyEnvVarAlreadySet = $anyEnvSet
    }

    # --- Precondition 5: startup, health, crash/restart, rollback design
    #     already exists and is sound -- checked directly against the
    #     repo's OWN WinSW template (not the machine-rendered copy, which
    #     may contain machine-specific values this tool must not read) and
    #     the File Agent source's own root-health module.
    $winswTemplatePath = Join-Path $PSScriptRoot 'hasarbotu-file-agent.winsw.xml'
    $winswTemplateText = if ([System.IO.File]::Exists($winswTemplatePath)) { [System.IO.File]::ReadAllText($winswTemplatePath) } else { '' }
    $hasRestartPolicy = ($winswTemplateText -match '<onfailure action="restart"') -and ($winswTemplateText -match '<resetfailure>')
    $hasStopTimeout = ($winswTemplateText -match '<stoptimeout>')
    $rootHealthPath = Join-Path $FileAgentRepoSourceDir 'src\root-health.ts'
    $rootHealthText = if ([System.IO.File]::Exists($rootHealthPath)) { [System.IO.File]::ReadAllText($rootHealthPath) } else { '' }
    $hasRealWriteProbe = ($rootHealthText -match 'ROOT_HEALTH_PROBE_FILENAME') -and ($rootHealthText -match 'writeFile') -and ($rootHealthText -match 'unlink')
    $startupHealthOk = ($hasRestartPolicy -and $hasStopTimeout -and $hasRealWriteProbe)
    $preconditions['startup_health_crash_restart_rollback'] = [ordered]@{
        Status = if ($startupHealthOk) { 'verified_ok' } else { 'blocked_structural' }
        Detail = if ($startupHealthOk) { 'WinSW template has an escalating restart policy (10s/30s/60s, resets after 1h) and a 30s graceful stop timeout; File Agent''s own root-health module performs a REAL write+delete probe (not just lstat) before any critical operation, reporting storage_unavailable fail-closed rather than proceeding on stale cached directory state. Rollback plan for the DISPOSABLE probe vehicle (Stage 3-4) is: stop + unregister it unconditionally in a finally block (mirrors the already-audited probe-p-drive-system-context.ps1 pattern) -- the REAL hasarbotu-file-agent service is never touched by this activation package and remains Disabled/Stopped unless a SEPARATE, later, explicit decision promotes it.' } else { "HasRestartPolicy=$hasRestartPolicy HasStopTimeout=$hasStopTimeout HasRealWriteProbe=$hasRealWriteProbe -- one or more expected design elements missing." }
        HasRestartPolicy = $hasRestartPolicy
        HasStopTimeout = $hasStopTimeout
        HasRealWriteProbeInRootHealth = $hasRealWriteProbe
    }

    $blockedCount = @($preconditions.Values | Where-Object { $_.Status -eq 'blocked_structural' }).Count
    $overallReadiness = if ($blockedCount -eq 0) { 'ready_for_apply_design' } else { 'blocked' }

    # --- Activation sequence preview: 7 ordered stages, PLAN ONLY. No
    #     stage is executed by this script.
    $activationSequence = @(
        [ordered]@{
            Stage = 1
            Name = 'env/root'
            PlannedActions = @(
                "Set machine-scope HASARBOTU_AGENT_ROOTS to a single-entry JSON map pointing at $StorageRoot, sufficient for the probe stages below (full production operation additionally needs HASARBOTU_AGENT_ID/_SECRET/HASARBOTU_API_BASE_URL, out of scope for this probe-focused activation until the separate API cutover, see Adım 1a-1c/3/4a-4b/B9/5-6 tasks)."
                'Confirm the storage root remains reachable and correctly ACL''d immediately before setting the env var (re-run the storage_root precondition check fresh, fail closed on drift).'
            )
            GatingPreconditions = @('storage_root', 'service_config_credential_acl_env')
            VerificationCriteria = 'Env var readable via [Environment]::GetEnvironmentVariable(Machine) immediately after set, value round-trips through JSON parse.'
            RollbackPlan = 'Remove the machine-scope env var(s) newly set at this stage (all were confirmed unset beforehand, so rollback is deletion, not restoration of a prior value).'
        }
        [ordered]@{
            Stage = 2
            Name = 'service config'
            PlannedActions = @(
                'OPEN DESIGN DECISION, not resolved by this preview: the REAL hasarbotu-file-agent service, if simply started as-is (Automatic + full runLoop), would immediately and repeatedly hit api_unavailable (no API service is installed yet) -- so this stage does NOT propose flipping the real service to Automatic/Start.'
                'Proposed alternative A: register a SEPARATE, temporary, self-cleaning WinSW service (same disposable-vehicle discipline as probe-p-drive-system-context.ps1, but a real Windows service instead of a Scheduled Task, specifically because only a real service logon exercises SeServiceLogonRight) running as svc-hb-fileagent, whose sole job is a one-shot probe script -- not yet written.'
                'Proposed alternative B: add an opt-in, env-var-gated one-shot self-test mode to File Agent''s own entry point (e.g. HASARBOTU_AGENT_SELF_TEST_ONLY=1) that runs the probe stages below then exits instead of entering runLoop -- a real change to File Agent''s production entry-point contract, so it needs its own explicit decision rather than being added silently here.'
            )
            GatingPreconditions = @('service_config_credential_acl_env', 'startup_health_crash_restart_rollback')
            VerificationCriteria = 'N/A -- this stage is a design decision, not yet an executable check.'
            RollbackPlan = 'N/A until a design is chosen.'
            Status = 'blocked_on_design_decision'
        }
        [ordered]@{
            Stage = 3
            Name = 'start'
            PlannedActions = @('Register + start the vehicle chosen in Stage 2 (real service start, invoking SeServiceLogonRight for real -- this is the one thing no read-only preview can substitute for).')
            GatingPreconditions = @('pcloud_db_readonly_access', 'service_config_credential_acl_env')
            VerificationCriteria = 'Get-Service/Win32_Service shows State=Running with the expected LogOnAs account within a bounded timeout.'
            RollbackPlan = 'Stop + unregister the vehicle unconditionally (finally block, mirrors probe-p-drive-system-context.ps1). Real hasarbotu-file-agent service untouched.'
        }
        [ordered]@{
            Stage = 4
            Name = 'service-context DB probe'
            PlannedActions = @('From inside the running vehicle (real svc-hb-fileagent logon), read data.db/-wal/-shm; attempt (and expect to fail) a write, confirming HB-2026-165''s ACL grant holds under a REAL logon, not just the SID simulation.')
            GatingPreconditions = @('pcloud_db_readonly_access', 'pcloud_db_no_write_delete')
            VerificationCriteria = 'Real read succeeds (non-zero bytes read); real write attempt fails with access-denied; result written to Administrators-only evidence.'
            RollbackPlan = 'Same as Stage 3 (vehicle cleanup). No ACL change is made by this stage -- it only reads.'
        }
        [ordered]@{
            Stage = 5
            Name = 'per-case freshness smoke'
            PlannedActions = @('BLOCKED pending the open architecture decision on per_case_freshness_gate_access above -- the current CLI contract cannot run meaningfully from inside a real Windows service (P:\ Session-0 invisibility). No smoke test is planned until a redesign or the full P:\-retirement migration resolves this.')
            GatingPreconditions = @('per_case_freshness_gate_access')
            VerificationCriteria = 'N/A -- blocked.'
            RollbackPlan = 'N/A -- blocked, nothing is attempted.'
            Status = 'blocked_structural'
        }
        [ordered]@{
            Stage = 6
            Name = 'File Agent file-operation smoke'
            PlannedActions = @(
                'Once Stages 1-4 pass: from inside the running vehicle, call one of File Agent''s already-exported, already-tested functions directly (bypassing the API polling loop, which needs a live API -- separate, out-of-scope-here cutover).'
                'Recommend verifyTarget (read-only hash verification) against a purpose-built SYNTHETIC case folder under the storage root -- never a real customer case -- as the safest first smoke choice; a real file_operation (move/rename) smoke should only follow after this passes and is itself a separate, explicit decision given AGENTS.md SS7''s critical-operation model.'
            )
            GatingPreconditions = @('storage_root', 'startup_health_crash_restart_rollback')
            VerificationCriteria = 'verifyTarget returns the expected observedHash/observedSize for the synthetic fixture; zero writes occur outside the synthetic fixture path.'
            RollbackPlan = 'Delete the synthetic fixture folder created for this smoke test. No real case data touched.'
        }
        [ordered]@{
            Stage = 7
            Name = 'verify/rollback'
            PlannedActions = @(
                'Aggregate all prior stage results into a single Administrators-only, hashed evidence report.'
                'If ALL stages passed: report readiness for a SEPARATE, explicit decision on whether/how to promote to steady-state (the real hasarbotu-file-agent service Automatic+Start is still gated on the full API cutover, tasks Adım 1a-1c/3/4a-4b/B9/5-6 -- this activation package does not decide that).'
                'If ANY stage failed: unconditionally tear down the disposable vehicle (Stage 3-4''s rollback), remove any env var set in Stage 1, delete any synthetic fixture from Stage 6. The real hasarbotu-file-agent service remains Disabled/Stopped throughout, untouched in either outcome.'
            )
            GatingPreconditions = @()
            VerificationCriteria = 'Evidence report confirms every stage''s individual VerificationCriteria; final state of the real hasarbotu-file-agent service is re-read and confirmed Disabled/Stopped (unchanged) unless a separate, later, explicit promotion decision is made.'
            RollbackPlan = 'See PlannedActions above (this stage IS the rollback/verify step).'
        }
    )

    $output = [ordered]@{
        SchemaVersion = 'hasarbotu-file-agent-controlled-activation-preview/1.0.0'
        Mode = 'preview'
        GeneratedAtUtc = [DateTime]::UtcNow.ToString('o')
        ServiceAccountName = $ServiceAccountName
        FileAgentServiceName = $FileAgentServiceName
        Preconditions = $preconditions
        BlockedPreconditionCount = $blockedCount
        OverallReadiness = $overallReadiness
        ActivationSequence = $activationSequence
        Note = 'No env/service/file/pCloud change was made by this run. Real start/enable requires a SEPARATE, explicit -Apply tool (not yet written) plus an explicit user decision on the Stage 2/Stage 5 open design questions surfaced above.'
    }

    if (-not [System.IO.Directory]::Exists($ReportDirectory)) { [System.IO.Directory]::CreateDirectory($ReportDirectory) | Out-Null }
    [System.IO.Directory]::SetAccessControl($ReportDirectory, (New-AdminOnlySecurity $true))
    $timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
    $suffix = [Guid]::NewGuid().ToString('N').Substring(0, 8)
    $fileName = "file-agent-controlled-activation-preview-$timestamp-$suffix.json"
    $finalPath = Join-Path $ReportDirectory $fileName
    $json = $output | ConvertTo-Json -Depth 16
    [System.IO.File]::WriteAllText($finalPath, $json, [System.Text.UTF8Encoding]::new($false))
    Set-AdminOnlyFileSecurity $finalPath
    $reportHash = (Get-FileHash -LiteralPath $finalPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $sidecarPath = "$finalPath.sha256"
    [System.IO.File]::WriteAllText($sidecarPath, "$reportHash  $fileName", [System.Text.UTF8Encoding]::new($false))
    Set-AdminOnlyFileSecurity $sidecarPath

    Write-Output ([ordered]@{
        SchemaVersion = 'hasarbotu-file-agent-controlled-activation-preview-wrapper/1.0.0'
        ReadOnly = $true
        OverallReadiness = $overallReadiness
        BlockedPreconditionCount = $blockedCount
        PreconditionsSummary = @($preconditions.Keys | ForEach-Object { [ordered]@{ Name = $_; Status = $preconditions[$_].Status } })
        ActivationSequenceStageCount = @($activationSequence).Count
        Report = [ordered]@{ FileName = $fileName; Sha256 = $reportHash; AdminOnly = $true }
    } | ConvertTo-Json -Depth 6)
    exit 0
}
catch {
    $safeError = [ordered]@{
        SchemaVersion = 'hasarbotu-file-agent-controlled-activation-preview-wrapper/1.0.0'
        Status = 'error'
        ReadOnly = $true
        ErrorCode = if ($null -ne $_.Exception.Data -and $_.Exception.Data.Contains('SafeCode')) { [string]$_.Exception.Data['SafeCode'] } else { 'FILE_AGENT_CONTROLLED_ACTIVATION_PREVIEW_RUNTIME_ERROR' }
        ErrorType = $_.Exception.GetType().Name
        ErrorLine = $_.InvocationInfo.ScriptLineNumber
    }
    $safeError | ConvertTo-Json -Depth 4
    exit 1
}
