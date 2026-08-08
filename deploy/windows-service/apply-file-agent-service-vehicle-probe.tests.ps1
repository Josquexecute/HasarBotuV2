#Requires -Version 5.1
# Dependency-free test script (no Pester) for
# apply-file-agent-service-vehicle-probe.ps1. Builds a REAL, throwaway
# WinSW-based test service (NEVER hasarbotu-file-agent) running as the
# built-in NT AUTHORITY\LOCAL SERVICE account (no password needed) and
# exercises the FULL real repurpose -> start -> probe -> restore cycle
# against it, then uninstalls it. Never touches svc-hb-fileagent, never
# touches real pCloud data, never touches the real hasarbotu-file-agent
# service.
# Run (Administrator required -- real service install/start/stop):
#   powershell -File .\apply-file-agent-service-vehicle-probe.tests.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:failures = 0

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { Write-Output "FAIL: $Message"; $script:failures++ } else { Write-Output "OK: $Message" }
}

$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [System.Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Output 'SKIPPED: Administrator required for real service install/start/stop tests.'
    exit 0
}

$winswSourcePath = 'C:\Tools\WinSW-x64.exe'
if (-not (Test-Path -LiteralPath $winswSourcePath)) {
    Write-Output "SKIPPED: WinSW binary not found at $winswSourcePath on this machine."
    exit 0
}

$toolPath = Join-Path $PSScriptRoot 'apply-file-agent-service-vehicle-probe.ps1'
$adminOnlyDir = 'C:\ProgramData\HasarBotu\migration-preflight'
$testServiceName = 'hasarbotu-test-vehicle-probe'
$testAccountName = 'NT AUTHORITY\LOCAL SERVICE'
# Deliberately NOT under $env:TEMP (the interactive user's own per-profile
# AppData\Local\Temp) -- LOCAL SERVICE has no access there by design, and
# a real service account has no access to another account's profile
# either. C:\ProgramData mirrors the REAL production shape
# (C:\HasarBotu\services\file-agent, system-wide, ACL'd explicitly for
# svc-hb-fileagent) -- found as a real test-setup bug via a real
# Start-Service failure, not assumed.
$testDir = Join-Path 'C:\ProgramData' ("HasarBotuTestVehicleProbe-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$testExePath = Join-Path $testDir "$testServiceName.exe"
$testXmlPath = Join-Path $testDir "$testServiceName.xml"

function Remove-TestServiceIfPresent {
    $existing = Get-CimInstance -ClassName Win32_Service -Filter "Name='$testServiceName'" -ErrorAction SilentlyContinue
    if ($null -ne $existing) {
        if ($existing.State -eq 'Running') { Stop-Service -Name $testServiceName -Force -ErrorAction SilentlyContinue }
        Start-Sleep -Milliseconds 500
        try { & $testExePath uninstall 2>&1 | Out-Null } catch {}
        try { sc.exe delete $testServiceName | Out-Null } catch {}
        Start-Sleep -Milliseconds 500
    }
}

# Always clean up, even if an assertion throws mid-test.
try {
    Remove-TestServiceIfPresent
    New-Item -ItemType Directory -Path $testDir -Force | Out-Null
    # Mirror the REAL production ACL shape exactly (RX on the app dir,
    # Modify on the logs subdir) rather than leaving the test account with
    # no explicit grant at all -- this is what actually let Start-Service
    # succeed once discovered.
    $testAcl = [System.IO.Directory]::GetAccessControl($testDir)
    $testAcl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
        $testAccountName, [System.Security.AccessControl.FileSystemRights]::ReadAndExecute,
        ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit),
        [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow))
    [System.IO.Directory]::SetAccessControl($testDir, $testAcl)
    New-Item -ItemType Directory -Path (Join-Path $testDir 'logs') -Force | Out-Null
    $logsAcl = [System.IO.Directory]::GetAccessControl((Join-Path $testDir 'logs'))
    $logsAcl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
        $testAccountName, [System.Security.AccessControl.FileSystemRights]::Modify,
        ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit),
        [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow))
    [System.IO.Directory]::SetAccessControl((Join-Path $testDir 'logs'), $logsAcl)
    Copy-Item -LiteralPath $winswSourcePath -Destination $testExePath -Force

    # Initial XML: harmless placeholder payload (cmd.exe /c exit 0),
    # LOCAL SERVICE account (built-in, no password needed). The
    # dependency is a NON-EXISTENT service name (mirroring the real
    # hasarbotu-file-agent -> hasarbotu-api dependency, which is not
    # installed) -- deliberately NOT a real, always-present service like
    # EventLog. A real, always-present dependency would mask a real
    # clearing bug entirely (start would still succeed even if clearing
    # silently failed) -- this exact gap was found via a real failure
    # against the real service (SC_START_FAILED_1075, dependency not
    # found, because `sc.exe config ... depend= ''` does NOT reliably
    # clear dependencies -- the documented syntax is `depend= /`) and is
    # now covered here so it cannot regress silently again.
    $initialXml = @"
<service>
  <id>$testServiceName</id>
  <name>HasarBotu TEST -- disposable, not a real product service</name>
  <description>Throwaway test service for apply-file-agent-service-vehicle-probe.tests.ps1 -- always uninstalled at the end of the test run.</description>
  <executable>cmd.exe</executable>
  <arguments>/c exit 0</arguments>
  <depend>HasarBotuTestNonExistentDependency</depend>
  <startmode>Manual</startmode>
  <onfailure action="none"/>
  <logpath>%BASE%\logs</logpath>
  <serviceaccount>
    <domain>NT AUTHORITY</domain>
    <user>LOCAL SERVICE</user>
    <allowservicelogon>true</allowservicelogon>
  </serviceaccount>
</service>
"@
    [System.IO.File]::WriteAllText($testXmlPath, $initialXml, [System.Text.UTF8Encoding]::new($false))
    & $testExePath install 2>&1 | Out-Null
    Start-Sleep -Milliseconds 500
    # Baseline expected by the tool: Disabled + Stopped.
    sc.exe config $testServiceName start= disabled | Out-Null
    $baselineSvc = Get-CimInstance -ClassName Win32_Service -Filter "Name='$testServiceName'"
    Assert-True ($null -ne $baselineSvc -and $baselineSvc.State -eq 'Stopped' -and $baselineSvc.StartMode -eq 'Disabled') "SETUP: synthetic test service installed, Disabled/Stopped baseline confirmed"
    $originalXmlBytes = [System.IO.File]::ReadAllBytes($testXmlPath)
    $originalXmlHash = (Get-FileHash -LiteralPath $testXmlPath -Algorithm SHA256).Hash.ToLowerInvariant()

    # Synthetic pCloud DB + target case fixture for the probe's freshness
    # gate call (structural exercise -- CaseStatus=unknown is a fine,
    # expected outcome here; what matters is the probe RAN as the service
    # account and completed).
    $fixtureRoot = Join-Path $testDir 'fixture'
    $targetRoot = Join-Path $fixtureRoot 'HEDEF\KAYNAK'
    $targetCaseRoot = Join-Path $targetRoot '00AAA000'
    New-Item -ItemType Directory -Path $targetCaseRoot -Force | Out-Null
    $attestDir = Join-Path $fixtureRoot 'attestations'
    New-Item -ItemType Directory -Path $attestDir -Force | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $targetCaseRoot 'v.pdf'), 'vehicle-probe-fixture-icerik')
    $dbBuildScript = @'
import { DatabaseSync } from "node:sqlite"
const db = new DatabaseSync(process.argv[2])
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE folder (id INTEGER PRIMARY KEY, parentfolderid INTEGER NOT NULL, name TEXT NOT NULL, flags INTEGER NOT NULL, ctime INTEGER NOT NULL, mtime INTEGER NOT NULL, subdircnt INTEGER NOT NULL);
  CREATE TABLE file (id INTEGER PRIMARY KEY, parentfolderid INTEGER NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL, hash INTEGER NOT NULL, flags INTEGER NOT NULL, ctime INTEGER NOT NULL, mtime INTEGER NOT NULL);
  CREATE TABLE task (id INTEGER, itemid INTEGER, localitemid INTEGER, newitemid INTEGER);
  CREATE TABLE fstask (id INTEGER, fileid INTEGER);
  INSERT INTO folder VALUES (100, 0, 'KAYNAK', 0, 1, 1, 1);
  INSERT INTO folder VALUES (200, 100, '00AAA000', 0, 1, 1, 0);
  INSERT INTO file VALUES (9099, 200, 'v.pdf', 28, 99, 0, 1, 1);
`)
db.close()
'@
    $dbScriptPath = Join-Path $fixtureRoot 'build-db.mjs'
    [System.IO.File]::WriteAllText($dbScriptPath, $dbBuildScript)
    $dbPath = Join-Path $fixtureRoot 'data.db'
    node $dbScriptPath $dbPath

    Write-Output '=== TEST 1: dry-run (no -Apply) -- snapshot captured, zero mutation ==='
    $out1 = & $toolPath -ServiceName $testServiceName -ProbeInnerScriptPath (Join-Path $PSScriptRoot 'file-agent-disposable-probe-inner.ps1') -PCloudLocalDatabasePath $dbPath -TargetRoot $targetRoot -TopLevelFolderName 'KAYNAK' -TestCaseRelativePath '00AAA000' -AttestationStoreDirectory $attestDir 2>&1
    $json1 = $out1 | Out-String | ConvertFrom-Json
    Assert-True ($json1.Mode -eq 'dry-run' -and $json1.OverallStatus -eq 'validated_ready_for_apply') "TEST1: dry-run validated (got Mode=$($json1.Mode) Status=$($json1.OverallStatus))"
    $xmlAfterDryRun = (Get-FileHash -LiteralPath $testXmlPath -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-True ($xmlAfterDryRun -eq $originalXmlHash) "TEST1: WinSW XML unchanged after dry-run"
    $svcAfterDryRun = Get-CimInstance -ClassName Win32_Service -Filter "Name='$testServiceName'"
    Assert-True ($svcAfterDryRun.StartMode -eq 'Disabled' -and $svcAfterDryRun.State -eq 'Stopped') "TEST1: service StartMode/State unchanged after dry-run"

    Write-Output "`n=== TEST 2: REAL -Apply -- repurpose -> start -> probe runs as the service account -> stop -> EXACT restore ==="
    $out2 = & $toolPath -ServiceName $testServiceName -ProbeInnerScriptPath (Join-Path $PSScriptRoot 'file-agent-disposable-probe-inner.ps1') -PCloudLocalDatabasePath $dbPath -TargetRoot $targetRoot -TopLevelFolderName 'KAYNAK' -TestCaseRelativePath '00AAA000' -AttestationStoreDirectory $attestDir -TimeoutSeconds 20 -Apply 2>&1
    $exitCode2 = $LASTEXITCODE
    $json2 = $out2 | Out-String | ConvertFrom-Json
    Assert-True ($exitCode2 -eq 0) "TEST2: apply exits 0 (got: $exitCode2)"
    Assert-True ($json2.RestoredExactly -eq $true) "TEST2: RestoredExactly=true (got: $($json2.RestoredExactly))"
    Assert-True ($null -ne $json2.ProbeOverallSucceeded) "TEST2: probe actually ran and reported a result (ProbeOverallSucceeded is not null)"

    $xmlAfterApply = (Get-FileHash -LiteralPath $testXmlPath -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-True ($xmlAfterApply -eq $originalXmlHash) "TEST2: WinSW XML restored to the EXACT original bytes (hash match)"
    $xmlTextAfterApply = [System.IO.File]::ReadAllText($testXmlPath)
    Assert-True ($xmlTextAfterApply -match '<depend>HasarBotuTestNonExistentDependency</depend>') "TEST2: original (non-existent-service) dependency restored in XML (was stripped for the probe run, then put back)"
    $scQcAfter2 = sc.exe qc $testServiceName
    Assert-True (($scQcAfter2 -join "`n") -match 'HasarBotuTestNonExistentDependency') "TEST2: SCM-level DEPENDENCIES value (not just the XML) restored to the non-existent dependency -- proves the clearing bug (depend='''' vs depend=/) cannot regress silently"
    Assert-True ($xmlTextAfterApply -match '<executable>cmd\.exe</executable>') "TEST2: original <executable>cmd.exe</executable> restored (was repointed at the probe, then put back)"

    $svcAfterApply = Get-CimInstance -ClassName Win32_Service -Filter "Name='$testServiceName'"
    Assert-True ($svcAfterApply.StartMode -eq 'Disabled') "TEST2: service StartMode restored to Disabled (baseline)"
    Assert-True ($svcAfterApply.State -eq 'Stopped') "TEST2: service left Stopped (never left Running)"

    $probeResultPath = Join-Path $testDir 'logs\disposable-probe-result.json'
    Assert-True (Test-Path -LiteralPath $probeResultPath) "TEST2: probe result file exists in the service's OWN logs directory (no new write ACL needed)"
    if (Test-Path -LiteralPath $probeResultPath) {
        $probeResultContent = Get-Content -Raw -LiteralPath $probeResultPath | ConvertFrom-Json
        Assert-True ($probeResultContent.RanAsIdentity -imatch 'local service') "TEST2: probe genuinely ran AS the service account (RanAsIdentity=$($probeResultContent.RanAsIdentity))"
    }

    Write-Output "`n=== TEST 3: standalone -Rollback path (defense in depth) -- deliberately corrupt XML, then restore via the separate -Rollback invocation using the snapshot evidence ==="
    $snapshotReportPath = Join-Path $adminOnlyDir $json2.Report.FileName
    $applyEvidence = Get-Content -Raw -LiteralPath $snapshotReportPath | ConvertFrom-Json
    $snapshotReportPath2 = Join-Path $adminOnlyDir $applyEvidence.SnapshotReport.FileName
    $snapshotReportSha2 = $applyEvidence.SnapshotReport.Sha256
    [System.IO.File]::WriteAllText($testXmlPath, '<service><id>corrupted-for-test</id></service>', [System.Text.UTF8Encoding]::new($false))
    sc.exe config $testServiceName start= demand | Out-Null
    $out3 = & $toolPath -Rollback -SnapshotEvidenceReportPath $snapshotReportPath2 -SnapshotEvidenceReportSha256 $snapshotReportSha2 2>&1
    $exitCode3 = $LASTEXITCODE
    $json3 = $out3 | Out-String | ConvertFrom-Json
    Assert-True ($exitCode3 -eq 0 -and $json3.RestoredExactly -eq $true) "TEST3: standalone -Rollback restores exactly after deliberate corruption (exit=$exitCode3, RestoredExactly=$($json3.RestoredExactly))"
    $xmlAfterRollback = (Get-FileHash -LiteralPath $testXmlPath -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-True ($xmlAfterRollback -eq $originalXmlHash) "TEST3: XML content matches the ORIGINAL bytes after standalone rollback"
    $svcAfterRollback = Get-CimInstance -ClassName Win32_Service -Filter "Name='$testServiceName'"
    Assert-True ($svcAfterRollback.StartMode -eq 'Disabled') "TEST3: StartMode restored to Disabled after standalone rollback"

    Write-Output "`n=== TEST 4: refuses to touch a Running service ==="
    sc.exe config $testServiceName start= demand | Out-Null
    Start-Service -Name $testServiceName -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 300
    $runningState = (Get-CimInstance -ClassName Win32_Service -Filter "Name='$testServiceName'").State
    if ($runningState -eq 'Running') {
        $out4 = & $toolPath -ServiceName $testServiceName -Apply 2>&1
        $json4 = $out4 | Out-String | ConvertFrom-Json
        Assert-True ($json4.Status -eq 'error' -and $json4.ErrorCode -eq 'SERVICE_NOT_STOPPED_REFUSING_TO_TOUCH') "TEST4: a Running service is refused outright (got: $($json4.ErrorCode))"
        Stop-Service -Name $testServiceName -Force -ErrorAction SilentlyContinue
    }
    else {
        Write-Output "SKIPPED TEST4: cmd.exe /c exit 0 completed too fast to observe Running state (not a tool defect)."
    }
    sc.exe config $testServiceName start= disabled | Out-Null
}
finally {
    Remove-TestServiceIfPresent
    Remove-Item -LiteralPath $testDir -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Output "`n=== SUMMARY: $script:failures failure(s) ==="
if ($script:failures -gt 0) { exit 1 }
exit 0
