[CmdletBinding(DefaultParameterSetName = 'Apply')]
param(
    [Parameter(ParameterSetName = 'Apply')]
    [Parameter(ParameterSetName = 'DryRun')]
    [string]$ServiceName = 'hasarbotu-file-agent',

    [Parameter(ParameterSetName = 'Apply')]
    [Parameter(ParameterSetName = 'DryRun')]
    [string]$ProbeInnerScriptPath,

    [Parameter(ParameterSetName = 'Apply')]
    [Parameter(ParameterSetName = 'DryRun')]
    [string]$PCloudLocalDatabasePath,

    [Parameter(ParameterSetName = 'Apply')]
    [Parameter(ParameterSetName = 'DryRun')]
    [string]$TargetRoot,

    [Parameter(ParameterSetName = 'Apply')]
    [Parameter(ParameterSetName = 'DryRun')]
    [string]$TopLevelFolderName,

    [Parameter(ParameterSetName = 'Apply')]
    [Parameter(ParameterSetName = 'DryRun')]
    [string]$TestCaseRelativePath,

    [Parameter(ParameterSetName = 'Apply')]
    [Parameter(ParameterSetName = 'DryRun')]
    [string]$AttestationStoreDirectory,

    [Parameter(ParameterSetName = 'Apply')]
    [Parameter(ParameterSetName = 'DryRun')]
    [ValidateRange(5, 120)]
    [int]$TimeoutSeconds = 30,

    [Parameter(ParameterSetName = 'Apply')]
    [switch]$Apply,

    [Parameter(ParameterSetName = 'Rollback', Mandatory)]
    [switch]$Rollback,

    [Parameter(ParameterSetName = 'Rollback', Mandatory)]
    [string]$SnapshotEvidenceReportPath,

    [Parameter(ParameterSetName = 'Rollback', Mandatory)]
    [ValidatePattern('^[a-fA-F0-9]{64}$')]
    [string]$SnapshotEvidenceReportSha256
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# File Agent service-vehicle probe -- APPLY + ROLLBACK (HB-2026-168 follow-
# up to HB-2026-167 Karar 2's "second_service_logon_credential" blocker).
#
# Resolves the blocker HB-2026-167 found (registering a SECOND service
# under svc-hb-fileagent needs its actual SAM password, which was
# deliberately never retained, HB-2026-118) by NOT creating a second
# service at all: it TEMPORARILY repurposes the EXISTING, already-
# registered $ServiceName -- which already has a working SCM-stored logon
# credential for its own registration (set once by HB-2026-118, never
# touched again) -- to run the disposable probe payload instead of its
# normal dist\index.js, for one bounded run, then restores EVERY touched
# piece of configuration to its EXACT prior state and verifies the
# restoration byte-for-byte. Never resets the account's password. Never
# grants SeBatchLogonRight or any new right.
#
# Model (AGENTS.md SS7): Planla -> Onizle (this script without -Apply:
# validates + snapshots, mutates nothing) -> Onay (user passes -Apply) ->
# Uygula -> Dogrula (post-restore hash comparison against the pre-mutation
# snapshot) -> Kesinlestir (evidence) -> Audit.
#
# Fail-closed preconditions before ANY mutation:
#   - $ServiceName must currently be Stopped (never touches a Running
#     service -- refuses outright rather than risk interrupting a real
#     in-flight critical operation).
#   - A full snapshot (WinSW XML raw bytes + SCM ImagePath/StartMode/
#     StartName/dependencies via the registry, not lossy sc.exe text
#     parsing) is captured and written to admin-only evidence BEFORE the
#     first mutation.
#
# Mutation sequence (all real, all reversed unconditionally afterward,
# same discipline as probe-p-drive-system-context.ps1's finally-block
# task cleanup and every Apply/Rollback tool built this session):
#   1. Rewrite the service's OWN WinSW XML: <executable>/<arguments> ->
#      powershell.exe running the probe inner script; DependOnService
#      (e.g. hasarbotu-api, if that dependency service is not currently
#      installed -- SCM refuses StartService otherwise) temporarily
#      cleared. The service's <serviceaccount>/logon credential is NEVER
#      touched -- SCM already has it stored for this exact registration.
#   2. sc.exe config start= demand (temporarily Manual -- the untouched
#      baseline is Disabled and is restored exactly afterward).
#   3. Start-Service -- the ONE thing no read-only preview can substitute
#      for: this is what actually exercises SeServiceLogonRight for real,
#      under the account's own already-stored credential.
#   4. Poll (bounded, $TimeoutSeconds) for the probe's own result file.
#   5. Stop-Service (always) -> restore original XML bytes (always) ->
#      sc.exe config start= disabled (always) -> re-snapshot and assert
#      byte-for-byte equality with step 0's snapshot (ImagePath/
#      StartMode/StartName/DependOnService/XML hash all re-checked, not
#      just trusted) -- ANY mismatch is reported as a loud, unresolved
#      finding, never silently accepted.

$AdministratorSidValue = 'S-1-5-32-544'
$ReportDirectory = 'C:\ProgramData\HasarBotu\migration-preflight'

function Throw-SafeVehicleError {
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
    if (-not (Test-AdminOnlyAcl $Path $false)) { Throw-SafeVehicleError 'ADMIN_ONLY_ACL_APPLY_FAILED' }
}

function Read-HashVerifiedJson {
    param([string]$Path, [string]$ExpectedSha256)
    if (-not (Test-AdminOnlyAcl $Path $false)) { Throw-SafeVehicleError 'REFERENCED_REPORT_ADMIN_ACL_REQUIRED' }
    $actualHash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $ExpectedSha256.ToLowerInvariant()) { Throw-SafeVehicleError 'REFERENCED_REPORT_HASH_MISMATCH' }
    return [System.IO.File]::ReadAllText($Path) | ConvertFrom-Json
}

function Write-AdminOnlyEvidence {
    param([string]$NamePrefix, [object]$ReportObject)
    if (-not [System.IO.Directory]::Exists($ReportDirectory)) { [System.IO.Directory]::CreateDirectory($ReportDirectory) | Out-Null }
    [System.IO.Directory]::SetAccessControl($ReportDirectory, (New-AdminOnlySecurity $true))
    $timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
    $suffix = [Guid]::NewGuid().ToString('N').Substring(0, 8)
    $fileName = "$NamePrefix-$timestamp-$suffix.json"
    $finalPath = Join-Path $ReportDirectory $fileName
    $json = $ReportObject | ConvertTo-Json -Depth 16
    [System.IO.File]::WriteAllText($finalPath, $json, [System.Text.UTF8Encoding]::new($false))
    Set-AdminOnlyFileSecurity $finalPath
    $reportHash = (Get-FileHash -LiteralPath $finalPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $sidecarPath = "$finalPath.sha256"
    [System.IO.File]::WriteAllText($sidecarPath, "$reportHash  $fileName", [System.Text.UTF8Encoding]::new($false))
    Set-AdminOnlyFileSecurity $sidecarPath
    return [ordered]@{ FileName = $fileName; Sha256 = $reportHash; AdminOnly = $true }
}

function Get-ServiceConfigSnapshot {
    param([string]$Name)
    $svc = Get-CimInstance -ClassName Win32_Service -Filter "Name='$Name'" -ErrorAction SilentlyContinue
    if ($null -eq $svc) { return $null }
    $regPath = "HKLM:\SYSTEM\CurrentControlSet\Services\$Name"
    $regProps = Get-ItemProperty -LiteralPath $regPath -ErrorAction Stop
    $dependOnService = @()
    if ($null -ne $regProps.PSObject.Properties['DependOnService']) { $dependOnService = @($regProps.DependOnService) }
    $imagePath = [string]$regProps.ImagePath
    $exeDir = $null
    $xmlPath = $null
    $xmlContentBase64 = $null
    $xmlSha256 = $null
    # WinSW-pattern services expose their exe at <dir>\<id>.exe with the
    # XML config alongside as <dir>\<id>.xml -- resolve from ImagePath.
    $imagePathTrimmed = $imagePath.Trim('"')
    if ($imagePathTrimmed -match '\.exe$') {
        $exeDir = Split-Path $imagePathTrimmed -Parent
        $candidateXml = Join-Path $exeDir "$Name.xml"
        if ([System.IO.File]::Exists($candidateXml)) {
            $xmlPath = $candidateXml
            $xmlBytes = [System.IO.File]::ReadAllBytes($xmlPath)
            $xmlContentBase64 = [Convert]::ToBase64String($xmlBytes)
            $xmlSha256 = (Get-FileHash -LiteralPath $xmlPath -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }
    return [ordered]@{
        ServiceName = $Name
        State = $svc.State
        StartMode = $svc.StartMode
        StartName = $svc.StartName
        PathName = $svc.PathName
        DependOnService = @($dependOnService)
        WinSwXmlPath = $xmlPath
        WinSwXmlSha256 = $xmlSha256
        WinSwXmlContentBase64 = $xmlContentBase64
        CapturedAtUtc = [DateTime]::UtcNow.ToString('o')
    }
}

function Get-SnapshotFieldValue {
    # Type-agnostic accessor: Before/After can be an [ordered] hashtable
    # (the in-process Apply path) OR a PSCustomObject freshly deserialized
    # from JSON (the standalone -Rollback path, evidence.Snapshot) -- a
    # hashtable indexer ($obj['Key']) throws on a PSCustomObject, and dot
    # access doesn't work uniformly either, so branch on actual type
    # (found via a real -Rollback run failing with a RuntimeException,
    # not assumed).
    param($Obj, [string]$Field)
    if ($Obj -is [System.Collections.IDictionary]) { return $Obj[$Field] }
    return $Obj.$Field
}

function Assert-SnapshotsMatch {
    param($Before, $After)
    $mismatches = @()
    foreach ($field in @('StartMode', 'StartName', 'PathName', 'WinSwXmlSha256')) {
        $beforeValue = Get-SnapshotFieldValue -Obj $Before -Field $field
        $afterValue = Get-SnapshotFieldValue -Obj $After -Field $field
        if ($beforeValue -ne $afterValue) { $mismatches += "$field : before=[$beforeValue] after=[$afterValue]" }
    }
    $beforeDepends = (@(Get-SnapshotFieldValue -Obj $Before -Field 'DependOnService') -join '|')
    $afterDepends = (@(Get-SnapshotFieldValue -Obj $After -Field 'DependOnService') -join '|')
    if ($beforeDepends -ne $afterDepends) { $mismatches += "DependOnService : before=[$beforeDepends] after=[$afterDepends]" }
    return $mismatches
}

function Restore-ServiceFromSnapshot {
    param($Snapshot)
    $restoreErrors = @()
    try {
        if ($null -ne $Snapshot.WinSwXmlPath -and $null -ne $Snapshot.WinSwXmlContentBase64) {
            $originalBytes = [Convert]::FromBase64String($Snapshot.WinSwXmlContentBase64)
            [System.IO.File]::WriteAllBytes($Snapshot.WinSwXmlPath, $originalBytes)
        }
    } catch { $restoreErrors += "XML restore failed: $($_.Exception.Message)" }
    try {
        $startModeArg = switch ($Snapshot.StartMode) { 'Disabled' { 'disabled' } 'Manual' { 'demand' } 'Auto' { 'auto' } default { 'demand' } }
        & sc.exe config $Snapshot.ServiceName start= $startModeArg | Out-Null
        if ($LASTEXITCODE -ne 0) { $restoreErrors += "sc.exe config start= $startModeArg failed (code $LASTEXITCODE)" }
    } catch { $restoreErrors += "StartMode restore failed: $($_.Exception.Message)" }
    try {
        if (@($Snapshot.DependOnService).Count -gt 0) {
            $dependArg = ($Snapshot.DependOnService -join '/')
            & sc.exe config $Snapshot.ServiceName depend= $dependArg | Out-Null
            if ($LASTEXITCODE -ne 0) { $restoreErrors += "sc.exe config depend= failed (code $LASTEXITCODE)" }
        }
    } catch { $restoreErrors += "Dependency restore failed: $($_.Exception.Message)" }
    return $restoreErrors
}

try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [System.Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Throw-SafeVehicleError 'ADMINISTRATOR_REQUIRED'
    }

    if ($Rollback) {
        $evidence = Read-HashVerifiedJson -Path $SnapshotEvidenceReportPath -ExpectedSha256 $SnapshotEvidenceReportSha256
        if ($evidence.SchemaVersion -ne 'hasarbotu-file-agent-service-vehicle-probe/1.0.0') { Throw-SafeVehicleError 'SNAPSHOT_EVIDENCE_SCHEMA_INVALID' }

        # Same live-state guard as the Apply path (line ~295): a stale
        # evidence report from BEFORE a real cutover must never be able to
        # silently force a currently-Running service back to the probe's
        # baseline (Disabled/dependency-stripped) StartMode. Checked against
        # the evidence's OWN recorded ServiceName, not the -ServiceName
        # parameter default (that parameter is not even part of the
        # Rollback parameter set).
        $rollbackTargetCheck = Get-CimInstance -ClassName Win32_Service -Filter "Name='$($evidence.Snapshot.ServiceName)'" -ErrorAction SilentlyContinue
        if ($null -eq $rollbackTargetCheck) { Throw-SafeVehicleError 'ROLLBACK_TARGET_SERVICE_NOT_FOUND' }
        if ($rollbackTargetCheck.State -ne 'Stopped') { Throw-SafeVehicleError 'SERVICE_NOT_STOPPED_REFUSING_ROLLBACK' }

        $snapshotForRestore = [ordered]@{
            ServiceName = $evidence.Snapshot.ServiceName
            StartMode = $evidence.Snapshot.StartMode
            WinSwXmlPath = $evidence.Snapshot.WinSwXmlPath
            WinSwXmlContentBase64 = $evidence.Snapshot.WinSwXmlContentBase64
            DependOnService = @($evidence.Snapshot.DependOnService)
        }
        $restoreErrors = Restore-ServiceFromSnapshot -Snapshot $snapshotForRestore
        $afterRestore = Get-ServiceConfigSnapshot -Name $evidence.Snapshot.ServiceName
        $mismatches = Assert-SnapshotsMatch -Before $evidence.Snapshot -After $afterRestore
        $rollbackReport = [ordered]@{
            SchemaVersion = 'hasarbotu-file-agent-service-vehicle-probe-rollback/1.0.0'
            GeneratedAtUtc = [DateTime]::UtcNow.ToString('o')
            RestoreErrors = $restoreErrors
            Mismatches = $mismatches
            RestoredExactly = (@($restoreErrors).Count -eq 0 -and @($mismatches).Count -eq 0)
        }
        $ref = Write-AdminOnlyEvidence -NamePrefix 'file-agent-service-vehicle-probe-rollback' -ReportObject $rollbackReport
        Write-Output ([ordered]@{ Mode = 'rollback'; RestoredExactly = $rollbackReport.RestoredExactly; Report = $ref } | ConvertTo-Json -Depth 6)
        exit $(if ($rollbackReport.RestoredExactly) { 0 } else { 1 })
    }

    # --- Apply / DryRun shared path ---
    $svcCheck = Get-CimInstance -ClassName Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
    if ($null -eq $svcCheck) { Throw-SafeVehicleError 'SERVICE_NOT_FOUND' }
    if ($svcCheck.State -ne 'Stopped') { Throw-SafeVehicleError 'SERVICE_NOT_STOPPED_REFUSING_TO_TOUCH' }

    if ([string]::IsNullOrWhiteSpace($ProbeInnerScriptPath)) { $ProbeInnerScriptPath = Join-Path $PSScriptRoot 'file-agent-disposable-probe-inner.ps1' }
    if (-not [System.IO.File]::Exists($ProbeInnerScriptPath)) { Throw-SafeVehicleError 'PROBE_INNER_SCRIPT_NOT_FOUND' }

    $beforeSnapshot = Get-ServiceConfigSnapshot -Name $ServiceName
    if ($null -eq $beforeSnapshot -or $null -eq $beforeSnapshot.WinSwXmlPath) { Throw-SafeVehicleError 'SERVICE_WINSW_XML_NOT_RESOLVED' }

    if (-not $Apply) {
        Write-Output ([ordered]@{
            Mode = 'dry-run'
            OverallStatus = 'validated_ready_for_apply'
            ServiceName = $ServiceName
            CurrentState = $svcCheck.State
            CurrentStartMode = $beforeSnapshot.StartMode
            WinSwXmlPath = $beforeSnapshot.WinSwXmlPath
            WinSwXmlSha256 = $beforeSnapshot.WinSwXmlSha256
            DependOnService = $beforeSnapshot.DependOnService
            Note = 'Fresh snapshot captured, zero mutation. Nothing was applied (no -Apply switch given).'
        } | ConvertTo-Json -Depth 6)
        exit 0
    }

    # === -Apply from here on ===
    $snapshotRef = Write-AdminOnlyEvidence -NamePrefix 'file-agent-service-vehicle-probe-snapshot' -ReportObject ([ordered]@{
        SchemaVersion = 'hasarbotu-file-agent-service-vehicle-probe/1.0.0'
        GeneratedAtUtc = [DateTime]::UtcNow.ToString('o')
        Snapshot = $beforeSnapshot
    })

    $mutationApplied = $false
    $probeResult = $null
    $probeResultPath = $null
    $restoreErrors = @()
    $mismatches = @()
    try {
        # 1) Rewrite WinSW XML: point executable/arguments at the probe,
        #    strip <depend> (dependency service may not be installed).
        [xml]$xmlDoc = Get-Content -Raw -LiteralPath $beforeSnapshot.WinSwXmlPath
        $serviceNode = $xmlDoc.service
        $serviceNode.executable = 'powershell.exe'
        if ($serviceNode.SelectSingleNode('arguments')) { $serviceNode.RemoveChild($serviceNode.SelectSingleNode('arguments')) | Out-Null }
        $argsNode = $xmlDoc.CreateElement('arguments')
        $logsDir = Join-Path (Split-Path $beforeSnapshot.WinSwXmlPath -Parent) 'logs'
        $probeResultPath = Join-Path $logsDir 'disposable-probe-result.json'
        $argsText = "-NoProfile -ExecutionPolicy Bypass -File `"$ProbeInnerScriptPath`" -PCloudLocalDatabasePath `"$PCloudLocalDatabasePath`" -TargetRoot `"$TargetRoot`" -TopLevelFolderName `"$TopLevelFolderName`" -TestCaseRelativePath `"$TestCaseRelativePath`" -AttestationStoreDirectory `"$AttestationStoreDirectory`" -ResultPath `"$probeResultPath`""
        $argsNode.InnerText = $argsText
        $serviceNode.AppendChild($argsNode) | Out-Null
        foreach ($dependNode in @($serviceNode.SelectNodes('depend'))) { $serviceNode.RemoveChild($dependNode) | Out-Null }
        $xmlDoc.Save($beforeSnapshot.WinSwXmlPath)
        $mutationApplied = $true

        if ([System.IO.File]::Exists($probeResultPath)) { Remove-Item -LiteralPath $probeResultPath -Force }

        # 2) Manual start type (baseline is Disabled, restored after).
        & sc.exe config $ServiceName start= demand | Out-Null
        if ($LASTEXITCODE -ne 0) { Throw-SafeVehicleError 'SC_CONFIG_START_DEMAND_FAILED' }
        if (@($beforeSnapshot.DependOnService).Count -gt 0) {
            # sc.exe's documented syntax for CLEARING dependencies is a
            # lone forward slash (depend= /) -- an empty string does NOT
            # reliably clear the field (found via a REAL failure against
            # the real hasarbotu-file-agent service: the synthetic test's
            # own dependency, EventLog, is always installed, so the same
            # bug never surfaced there -- clearing silently failed but
            # start still succeeded because EventLog genuinely exists).
            & sc.exe config $ServiceName depend= '/' | Out-Null
            if ($LASTEXITCODE -ne 0) { Throw-SafeVehicleError 'SC_CONFIG_DEPEND_CLEAR_FAILED' }
        }

        # 3) Start -- exercises the account's real, already-stored SCM
        #    logon credential for real (no password reset, no new right).
        #    Uses sc.exe start (fire-and-forget) rather than the
        #    Start-Service cmdlet: the latter's own internal wait-for-
        #    Running logic threw ServiceCommandException on a REAL run
        #    against the real WinSW-wrapped probe (found via a real
        #    failure, not assumed) -- a genuinely short-lived probe (that
        #    runs once and exits) can legitimately transition through
        #    Running and back to Stopped faster than that cmdlet's
        #    built-in tolerance expects, even though the service itself
        #    started and ran successfully. What actually matters here is
        #    whether the probe's OWN result file appears, not the precise
        #    timing of the SCM status transition -- so this proceeds
        #    straight to the existing result-file poll below regardless
        #    of exactly when/whether Running was observed.
        & sc.exe start $ServiceName | Out-Null
        if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 1056) {
            # 1056 = ERROR_SERVICE_ALREADY_RUNNING -- harmless race with a
            # probe that starts and finishes very fast; anything else is
            # a real start failure.
            Throw-SafeVehicleError "SC_START_FAILED_$LASTEXITCODE"
        }

        # 4) Poll for probe completion (bounded).
        $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
        while ((Get-Date) -lt $deadline -and -not [System.IO.File]::Exists($probeResultPath)) { Start-Sleep -Milliseconds 500 }
        if ([System.IO.File]::Exists($probeResultPath)) {
            try { $probeResult = Get-Content -Raw -LiteralPath $probeResultPath | ConvertFrom-Json } catch { $probeResult = $null }
        }
    }
    finally {
        # 5) ALWAYS stop + restore, regardless of what happened above.
        try { Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue } catch {}
        Start-Sleep -Milliseconds 500
        if ($mutationApplied) {
            $restoreErrors = Restore-ServiceFromSnapshot -Snapshot $beforeSnapshot
        }
    }

    $afterSnapshot = Get-ServiceConfigSnapshot -Name $ServiceName
    $mismatches = Assert-SnapshotsMatch -Before $beforeSnapshot -After $afterSnapshot
    $restoredExactly = (@($restoreErrors).Count -eq 0 -and @($mismatches).Count -eq 0)

    $applyReport = [ordered]@{
        SchemaVersion = 'hasarbotu-file-agent-service-vehicle-probe-apply/1.0.0'
        GeneratedAtUtc = [DateTime]::UtcNow.ToString('o')
        ServiceName = $ServiceName
        SnapshotReport = $snapshotRef
        ProbeResult = $probeResult
        ProbeResultPath = $probeResultPath
        RestoreErrors = $restoreErrors
        Mismatches = $mismatches
        RestoredExactly = $restoredExactly
    }
    $ref = Write-AdminOnlyEvidence -NamePrefix 'file-agent-service-vehicle-probe-apply' -ReportObject $applyReport

    Write-Output ([ordered]@{
        Mode = 'apply'
        OverallStatus = if ($restoredExactly) { 'applied_and_restored' } else { 'RESTORE_INCOMPLETE_MANUAL_REVIEW_REQUIRED' }
        RestoredExactly = $restoredExactly
        ProbeOverallSucceeded = if ($null -ne $probeResult -and $null -ne $probeResult.PSObject.Properties['OverallSucceeded']) { $probeResult.OverallSucceeded } else { $null }
        Report = $ref
    } | ConvertTo-Json -Depth 8)
    exit $(if ($restoredExactly) { 0 } else { 1 })
}
catch {
    $safeError = [ordered]@{
        Status = 'error'
        ErrorCode = if ($null -ne $_.Exception.Data -and $_.Exception.Data.Contains('SafeCode')) { [string]$_.Exception.Data['SafeCode'] } else { 'FILE_AGENT_SERVICE_VEHICLE_PROBE_RUNTIME_ERROR' }
        ErrorType = $_.Exception.GetType().Name
        ErrorLine = $_.InvocationInfo.ScriptLineNumber
    }
    $safeError | ConvertTo-Json -Depth 4
    exit 1
}
