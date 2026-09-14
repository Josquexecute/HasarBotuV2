#Requires -Version 5.1
# Dependency-free test script (no Pester) for
# preview-file-agent-disposable-probe-service.ps1. Never registers,
# starts, stops, or removes any real service; never touches the real
# hasarbotu-file-agent service or real pCloud data.
# Run: powershell -File .\preview-file-agent-disposable-probe-service.tests.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:failures = 0

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { Write-Output "FAIL: $Message"; $script:failures++ } else { Write-Output "OK: $Message" }
}

$scriptPath = Join-Path $PSScriptRoot 'preview-file-agent-disposable-probe-service.ps1'
$adminOnlyDir = 'C:\ProgramData\HasarBotu\migration-preflight'

Write-Output '=== TEST 1: real machine run -- structural checks preserve actual prerequisite readiness; missing production prerequisites stay blocked ==='
$out1 = & $scriptPath 2>&1
$json1 = $out1 | Out-String | ConvertFrom-Json
Assert-True ($json1.ReadOnly -eq $true) "TEST1: wrapper declares ReadOnly=true"
$innerScriptEntry1 = @($json1.PreconditionsSummary | Where-Object { $_.Name -eq 'inner_probe_script' })
Assert-True ($innerScriptEntry1.Count -eq 1 -and $innerScriptEntry1[0].Status -eq 'verified_ok') "TEST1: inner_probe_script verified_ok (real file, parses cleanly, structurally safe)"
$winswEntry1 = @($json1.PreconditionsSummary | Where-Object { $_.Name -eq 'winsw_and_service_id' })
$expectedWinswStatus = if ([System.IO.File]::Exists('C:\Tools\WinSW-x64.exe') -and $null -eq (Get-Service -Name 'hasarbotu-file-agent-probe' -ErrorAction SilentlyContinue)) { 'verified_ok' } else { 'blocked_structural' }
Assert-True ($winswEntry1.Count -eq 1 -and $winswEntry1[0].Status -eq $expectedWinswStatus) 'TEST1: WinSW readiness matches independent file/service inspection'
if ($expectedWinswStatus -ne 'verified_ok') { Write-Output 'SKIP: positive WinSW readiness requires the real WinSW binary and a free probe service id.' }
$dbEntry1 = @($json1.PreconditionsSummary | Where-Object { $_.Name -eq 'pcloud_db_access' })
$dbPreviewScript = Join-Path $PSScriptRoot 'preview-file-agent-pcloud-db-access.ps1'
$independentDbPreview = (& $dbPreviewScript -ServiceAccountName 'svc-hb-fileagent' 2>&1 | Out-String | ConvertFrom-Json)
$dbPreviewHasError = $null -ne $independentDbPreview.PSObject.Properties['Status'] -and $independentDbPreview.Status -eq 'error'
$expectedDbStatus = if (-not $dbPreviewHasError -and $independentDbPreview.OverallStatus -eq 'already_sufficient') { 'verified_ok' } else { 'blocked_structural' }
Assert-True ($dbEntry1.Count -eq 1 -and $dbEntry1[0].Status -eq $expectedDbStatus) 'TEST1: composed DB readiness preserves the independently observed ACL preflight result'
if ($expectedDbStatus -ne 'verified_ok') { Write-Output 'SKIP: positive pCloud DB readiness requires the real service account, DB path and grants.' }
$gateEntry1 = @($json1.PreconditionsSummary | Where-Object { $_.Name -eq 'freshness_gate_library' })
Assert-True ($gateEntry1.Count -eq 1 -and $gateEntry1[0].Status -eq 'verified_ok') "TEST1: freshness_gate_library verified_ok (module present, its own test suite passes fresh)"
$resultDirEntry1 = @($json1.PreconditionsSummary | Where-Object { $_.Name -eq 'result_directory_acl_plan' })
Assert-True ($resultDirEntry1.Count -eq 1 -and $resultDirEntry1[0].Status -eq 'deferred_to_real_activation') "TEST1: result_directory_acl_plan honestly deferred (a new grant, not yet applied) -- not silently marked ok"
$credEntry1 = @($json1.PreconditionsSummary | Where-Object { $_.Name -eq 'second_service_logon_credential' })
Assert-True ($credEntry1.Count -eq 1 -and $credEntry1[0].Status -eq 'blocked_structural') "TEST1: second_service_logon_credential honestly blocked_structural (real sc.exe/SAM password mechanics, not glossed over)"

Write-Output "`n=== TEST 2: nonexistent inner probe script path -> blocked_structural, zero mutation ==="
$out2 = & $scriptPath -InnerProbeScriptPath (Join-Path $env:TEMP 'hasarbotu-does-not-exist.ps1') 2>&1
$json2 = $out2 | Out-String | ConvertFrom-Json
$innerScriptEntry2 = @($json2.PreconditionsSummary | Where-Object { $_.Name -eq 'inner_probe_script' })
Assert-True ($innerScriptEntry2.Count -eq 1 -and $innerScriptEntry2[0].Status -eq 'blocked_structural') "TEST2: missing inner probe script reported blocked_structural (got: $($innerScriptEntry2[0].Status))"
Assert-True ($json2.OverallReadiness -eq 'blocked') "TEST2: OverallReadiness=blocked when the inner script is missing"

Write-Output "`n=== TEST 3: probe service id collides with the real File Agent service name -> blocked_structural ==="
$out3 = & $scriptPath -ProbeServiceId 'hasarbotu-file-agent' -FileAgentServiceName 'hasarbotu-file-agent' 2>&1
$json3 = $out3 | Out-String | ConvertFrom-Json
$winswEntry3 = @($json3.PreconditionsSummary | Where-Object { $_.Name -eq 'winsw_and_service_id' })
Assert-True ($winswEntry3.Count -eq 1 -and $winswEntry3[0].Status -eq 'blocked_structural') "TEST3: probe id colliding with the real service name is rejected (got: $($winswEntry3[0].Status))"

Write-Output "`n=== TEST 4: planned WinSW XML is Manual startmode + no restart-on-failure loop (one-shot, never persistent/Automatic) ==="
$reportPath4 = Join-Path $adminOnlyDir $json1.Report.FileName
$fullReport4 = Get-Content -Raw -LiteralPath $reportPath4 | ConvertFrom-Json
Assert-True ($fullReport4.PlannedWinSwXml -match '<startmode>Manual</startmode>') "TEST4: planned WinSW XML uses Manual startmode (never Automatic -- this is a one-shot probe, not a persistent service)"
Assert-True ($fullReport4.PlannedWinSwXml -notmatch '<onfailure action="restart"') "TEST4: planned WinSW XML has no restart-on-failure policy (a failed one-shot probe should not loop retrying)"
Assert-True ($fullReport4.PlannedWinSwXml -match [regex]::Escape('<id>hasarbotu-file-agent-probe</id>')) "TEST4: planned WinSW XML uses the distinct probe service id, not the real service id"
Assert-True ($fullReport4.PlannedWinSwXml -notmatch '<password>') "TEST4: planned WinSW XML never contains a <password> element (matches the established HB-2026-118 sc.exe-config-only discipline)"

Write-Output "`n=== TEST 5: zero mutation -- no service registered/started, no env change, real hasarbotu-file-agent service untouched ==="
$realSvcBefore5 = Get-CimInstance -ClassName Win32_Service -Filter "Name='hasarbotu-file-agent'" -ErrorAction SilentlyContinue
$probeSvcBefore5 = Get-Service -Name 'hasarbotu-file-agent-probe' -ErrorAction SilentlyContinue
$envBefore5 = [Environment]::GetEnvironmentVariable('HASARBOTU_AGENT_ROOTS', 'Machine')
& $scriptPath 2>&1 | Out-Null
$realSvcAfter5 = Get-CimInstance -ClassName Win32_Service -Filter "Name='hasarbotu-file-agent'" -ErrorAction SilentlyContinue
$probeSvcAfter5 = Get-Service -Name 'hasarbotu-file-agent-probe' -ErrorAction SilentlyContinue
$envAfter5 = [Environment]::GetEnvironmentVariable('HASARBOTU_AGENT_ROOTS', 'Machine')
Assert-True (($null -eq $realSvcBefore5) -eq ($null -eq $realSvcAfter5) -and ($null -eq $realSvcBefore5 -or ($realSvcBefore5.StartMode -eq $realSvcAfter5.StartMode -and $realSvcBefore5.State -eq $realSvcAfter5.State))) "TEST5: real hasarbotu-file-agent service StartMode/State unchanged"
Assert-True (($null -eq $probeSvcBefore5) -and ($null -eq $probeSvcAfter5)) "TEST5: no probe service was ever registered (still does not exist after this run)"
Assert-True ($envBefore5 -eq $envAfter5) "TEST5: HASARBOTU_AGENT_ROOTS machine env var unchanged"

Write-Output "`n=== TEST 6: evidence report is Administrators-only + hash-verified ==="
$actualHash6 = (Get-FileHash -LiteralPath $reportPath4 -Algorithm SHA256).Hash.ToLowerInvariant()
Assert-True ($actualHash6 -eq $json1.Report.Sha256) "TEST6: reported Sha256 matches the actual evidence file hash"
$rules6 = @([System.IO.File]::GetAccessControl($reportPath4).GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
Assert-True ($rules6.Count -eq 1 -and $rules6[0].IdentityReference.Value -eq 'S-1-5-32-544') "TEST6: evidence report ACL is Administrators-only"

Write-Output "`n=== SUMMARY: $script:failures failure(s) ==="
if ($script:failures -gt 0) { exit 1 }
exit 0
