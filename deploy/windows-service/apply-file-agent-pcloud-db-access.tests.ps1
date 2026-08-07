#Requires -Version 5.1
# Dependency-free test script (no Pester) for
# apply-file-agent-pcloud-db-access.ps1. Builds a synthetic tree and a
# REAL preview report (by actually invoking the unmodified
# preview-file-agent-pcloud-db-access.ps1 against it, exactly as that
# tool's own tests do) so the apply tool is always exercised against a
# genuinely-shaped report, never a hand-guessed one. Uses the built-in,
# always-present NT AUTHORITY\LOCAL SERVICE account as the target identity
# -- no new local account, and never touches svc-hb-fileagent or any real
# pCloud data. Every synthetic tree lives under $env:TEMP and is removed
# after each test.
# Run: powershell -File .\apply-file-agent-pcloud-db-access.tests.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:failures = 0

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { Write-Output "FAIL: $Message"; $script:failures++ } else { Write-Output "OK: $Message" }
}

$targetAccountName = 'NT AUTHORITY\LOCAL SERVICE'
$targetSid = ([System.Security.Principal.NTAccount]$targetAccountName).Translate([System.Security.Principal.SecurityIdentifier]).Value
$previewScriptPath = Join-Path $PSScriptRoot 'preview-file-agent-pcloud-db-access.ps1'
$applyScriptPath = Join-Path $PSScriptRoot 'apply-file-agent-pcloud-db-access.ps1'
$adminOnlyDir = 'C:\ProgramData\HasarBotu\migration-preflight'

function New-SyntheticPCloudTree {
    $root = Join-Path $env:TEMP ("hasarbotu-fa-apply-fixture-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    $userDir = Join-Path $root 'FakeProfile'
    $pcloudDir = Join-Path $userDir 'AppData\Local\pCloud'
    New-Item -ItemType Directory -Path $pcloudDir -Force | Out-Null
    $dbPath = Join-Path $pcloudDir 'data.db'
    [System.IO.File]::WriteAllBytes($dbPath, [byte[]]@(1, 2, 3))
    [System.IO.File]::WriteAllBytes("$dbPath-wal", [byte[]]@(4, 5))
    [System.IO.File]::WriteAllBytes("$dbPath-shm", [byte[]]@(6))
    return [pscustomobject]@{ Root = $root; UserDir = $userDir; PCloudDir = $pcloudDir; DbPath = $dbPath }
}

function Invoke-RealPreview {
    param([string]$DbPath)
    $out = & $previewScriptPath -ServiceAccountName $targetAccountName -PCloudSyncAccount "$env:COMPUTERNAME\$env:USERNAME" -PCloudLocalDatabasePath $DbPath 2>&1
    return ($out | Out-String | ConvertFrom-Json)
}

function Get-AllTouchedAncestorPaths {
    param($PreviewWrapper)
    $reportPath = Join-Path $adminOnlyDir $PreviewWrapper.Report.FileName
    $fullReport = Get-Content -Raw -LiteralPath $reportPath | ConvertFrom-Json
    return @($fullReport.PlannedMinimumAces | ForEach-Object { $_.Path } | Select-Object -Unique)
}

Write-Output '=== TEST 1: full synthetic Apply -> ACEs really applied + WAL/SHM continuity real proof + confirmed -- then Rollback -> exact restoration ==='
$f1 = New-SyntheticPCloudTree
$preview1 = Invoke-RealPreview -DbPath $f1.DbPath
Assert-True ($preview1.OverallStatus -eq 'grant_required') "TEST1: preview shows grant_required (got: $($preview1.OverallStatus))"
$touchedPaths1 = Get-AllTouchedAncestorPaths -PreviewWrapper $preview1
$beforeAcls1 = @{}
foreach ($p in $touchedPaths1) { $beforeAcls1[$p] = (Get-Acl -LiteralPath $(if ($p -match '^[A-Za-z]:$') { "$p\" } else { $p })).Sddl }

$applyOut1 = & $applyScriptPath -PreviewReportPath (Join-Path $adminOnlyDir $preview1.Report.FileName) -PreviewReportSha256 $preview1.Report.Sha256 -ServiceAccountName $targetAccountName -Apply 2>&1
$applyJson1 = $applyOut1 | Out-String | ConvertFrom-Json
Assert-True ($applyJson1.OverallStatus -eq 'applied') "TEST1: Apply reports OverallStatus=applied (got: $($applyJson1.OverallStatus))"
Assert-True ($applyJson1.WalShmContinuityConfirmed -eq $true) "TEST1: WAL/SHM inheritance continuity REALLY confirmed (throwaway file inherited the ACE)"
Assert-True ($applyJson1.RollbackPackageVerified -eq $true) "TEST1: rollback package re-verified via hash-verified re-read (got: $($applyJson1.RollbackPackageVerified))"

$dbSimResults1 = @($applyJson1.DbFileEffectiveAccessSimulation)
$dbDataFileSim1 = @($dbSimResults1 | Where-Object { $_.Path -eq $f1.DbPath })
Assert-True ($dbDataFileSim1.Count -eq 1) "TEST1: DB-file effective-access simulation covers data.db"
Assert-True ($dbDataFileSim1[0].ReadGranted -eq $true) "TEST1: SID simulation confirms Read=granted on the REAL data.db after Apply (got: $($dbDataFileSim1[0].ReadGranted))"
Assert-True ($dbDataFileSim1[0].ForbiddenAccessGranted -eq $false) "TEST1: SID simulation confirms Write/Delete/Ownership=NOT granted on the REAL data.db after Apply (got: $($dbDataFileSim1[0].ForbiddenAccessGranted))"
$dbWalFileSim1 = @($dbSimResults1 | Where-Object { $_.Path -eq "$($f1.DbPath)-wal" })
Assert-True ($dbWalFileSim1.Count -eq 1 -and $dbWalFileSim1[0].ReadGranted -eq $true -and $dbWalFileSim1[0].ForbiddenAccessGranted -eq $false) "TEST1: SID simulation confirms Read=granted/Write=not-granted on the REAL data.db-wal after Apply"

# NOTE: Get-Acl's .Access returns IdentityReference as a friendly NTAccount
# name (e.g. "NT AUTHORITY\Local Service"), not a SID -- comparing that
# against $targetSid would never match. GetAccessRules($true,$true,
# [SecurityIdentifier]) forces SID-typed identities, matching how the
# apply tool itself validates (found via a real test failure).
foreach ($p in $touchedPaths1) {
    $realPath = $(if ($p -match '^[A-Za-z]:$') { "$p\" } else { $p })
    $acl = [System.IO.Directory]::GetAccessControl($realPath)
    $rule = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | Where-Object { $_.IdentityReference.Value -eq $targetSid -and -not $_.IsInherited })
    Assert-True ($rule.Count -gt 0) "TEST1: $p really has a new, explicit ACE for the target account on disk"
}
$pcloudAcl1 = [System.IO.Directory]::GetAccessControl($f1.PCloudDir)
$writeBits1 = [int64](
    [System.Security.AccessControl.FileSystemRights]::WriteData -bor [System.Security.AccessControl.FileSystemRights]::Delete -bor
    [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor [System.Security.AccessControl.FileSystemRights]::TakeOwnership)
$targetRules1 = @($pcloudAcl1.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | Where-Object { $_.IdentityReference.Value -eq $targetSid })
foreach ($rule in $targetRules1) {
    Assert-True ((([int64]$rule.FileSystemRights) -band $writeBits1) -eq 0) "TEST1: applied ACE on pCloud folder contains ZERO write/delete/ownership bits (independently re-checked on the REAL applied ACL, not just the plan)"
}

$applyReportPath1 = Join-Path $adminOnlyDir $applyJson1.Report.FileName
$rollbackOut1 = & $applyScriptPath -Rollback -ApplyEvidenceReportPath $applyReportPath1 -ApplyEvidenceReportSha256 $applyJson1.Report.Sha256 2>&1
$rollbackJson1 = $rollbackOut1 | Out-String | ConvertFrom-Json
Assert-True ($rollbackJson1.AllNodesRestoredExactly -eq $true) "TEST1: Rollback reports AllNodesRestoredExactly=true"
foreach ($p in $touchedPaths1) {
    $aclAfterRollback = (Get-Acl -LiteralPath $(if ($p -match '^[A-Za-z]:$') { "$p\" } else { $p })).Sddl
    Assert-True ($aclAfterRollback -eq $beforeAcls1[$p]) "TEST1: $p ACL restored to the EXACT pre-apply SDDL byte-for-byte"
}
Remove-Item $f1.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 2: without -Apply (dry-run) -- fully validates, changes NOTHING on disk ==="
$f2 = New-SyntheticPCloudTree
$preview2 = Invoke-RealPreview -DbPath $f2.DbPath
$touchedPaths2 = Get-AllTouchedAncestorPaths -PreviewWrapper $preview2
$beforeAcls2 = @{}
foreach ($p in $touchedPaths2) { $beforeAcls2[$p] = (Get-Acl -LiteralPath $(if ($p -match '^[A-Za-z]:$') { "$p\" } else { $p })).Sddl }
$dryRunOut2 = & $applyScriptPath -PreviewReportPath (Join-Path $adminOnlyDir $preview2.Report.FileName) -PreviewReportSha256 $preview2.Report.Sha256 -ServiceAccountName $targetAccountName 2>&1
$dryRunJson2 = $dryRunOut2 | Out-String | ConvertFrom-Json
Assert-True ($dryRunJson2.OverallStatus -eq 'validated_ready_for_apply') "TEST2: dry-run (no -Apply) reports validated_ready_for_apply (got: $($dryRunJson2.OverallStatus))"
foreach ($p in $touchedPaths2) {
    $aclAfter2 = (Get-Acl -LiteralPath $(if ($p -match '^[A-Za-z]:$') { "$p\" } else { $p })).Sddl
    Assert-True ($aclAfter2 -eq $beforeAcls2[$p]) "TEST2: $p ACL is STILL unchanged after dry-run (no -Apply means zero mutation)"
}
Remove-Item $f2.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 3: tampered report (a disallowed WriteData bit injected into one planned ACE) -- rejected fail-closed, zero mutation ==="
$f3 = New-SyntheticPCloudTree
$preview3 = Invoke-RealPreview -DbPath $f3.DbPath
$reportPath3 = Join-Path $adminOnlyDir $preview3.Report.FileName
$reportObj3 = Get-Content -Raw -LiteralPath $reportPath3 | ConvertFrom-Json
$writeDataBit = [int64][System.Security.AccessControl.FileSystemRights]::WriteData
$reportObj3.PlannedMinimumAces[0].RightsValue = ([int64]$reportObj3.PlannedMinimumAces[0].RightsValue) -bor $writeDataBit
$tamperedPath3 = Join-Path $f3.Root 'tampered-report.json'
[System.IO.File]::WriteAllText($tamperedPath3, ($reportObj3 | ConvertTo-Json -Depth 16), [System.Text.UTF8Encoding]::new($false))
$tamperedAcl3 = [System.Security.AccessControl.FileSecurity]::new()
$tamperedAcl3.SetAccessRuleProtection($true, $false)
$adminSid3 = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
$tamperedAcl3.SetOwner($adminSid3)
$tamperedAcl3.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($adminSid3, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.InheritanceFlags]::None, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow))
[System.IO.File]::SetAccessControl($tamperedPath3, $tamperedAcl3)
$tamperedHash3 = (Get-FileHash -LiteralPath $tamperedPath3 -Algorithm SHA256).Hash.ToLowerInvariant()
$touchedPaths3 = @($reportObj3.PlannedMinimumAces | ForEach-Object { $_.Path } | Select-Object -Unique)
$beforeAcls3 = @{}
foreach ($p in $touchedPaths3) { $beforeAcls3[$p] = (Get-Acl -LiteralPath $(if ($p -match '^[A-Za-z]:$') { "$p\" } else { $p })).Sddl }
$out3 = & $applyScriptPath -PreviewReportPath $tamperedPath3 -PreviewReportSha256 $tamperedHash3 -ServiceAccountName $targetAccountName -Apply 2>&1
$json3 = $out3 | Out-String | ConvertFrom-Json
Assert-True ($json3.Status -eq 'error' -and $json3.ErrorCode -eq 'PLANNED_ACE_OUTSIDE_WHITELIST') "TEST3: tampered (WriteData-injected) ACE rejected with PLANNED_ACE_OUTSIDE_WHITELIST (got: $($json3.ErrorCode))"
foreach ($p in $touchedPaths3) {
    $aclAfter3 = (Get-Acl -LiteralPath $(if ($p -match '^[A-Za-z]:$') { "$p\" } else { $p })).Sddl
    Assert-True ($aclAfter3 -eq $beforeAcls3[$p]) "TEST3: $p ACL unchanged -- tampered report never reached the mutation step"
}
Remove-Item $f3.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 4: ACL drift since the preview report (unrelated ACE added to a touched node between preview and apply) -- rejected fail-closed ==="
$f4 = New-SyntheticPCloudTree
$preview4 = Invoke-RealPreview -DbPath $f4.DbPath
$touchedPaths4 = Get-AllTouchedAncestorPaths -PreviewWrapper $preview4
$driftPath4 = $touchedPaths4[0]
$driftAcl4 = Get-Acl -LiteralPath $driftPath4
$driftAcl4.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
    'NT AUTHORITY\NETWORK SERVICE', [System.Security.AccessControl.FileSystemRights]::Traverse,
    [System.Security.AccessControl.InheritanceFlags]::None, [System.Security.AccessControl.PropagationFlags]::None,
    [System.Security.AccessControl.AccessControlType]::Allow))
Set-Acl -LiteralPath $driftPath4 -AclObject $driftAcl4
$beforeAcls4 = @{}
foreach ($p in $touchedPaths4) { $beforeAcls4[$p] = (Get-Acl -LiteralPath $(if ($p -match '^[A-Za-z]:$') { "$p\" } else { $p })).Sddl }
$out4 = & $applyScriptPath -PreviewReportPath (Join-Path $adminOnlyDir $preview4.Report.FileName) -PreviewReportSha256 $preview4.Report.Sha256 -ServiceAccountName $targetAccountName -Apply 2>&1
$json4 = $out4 | Out-String | ConvertFrom-Json
Assert-True ($json4.Status -eq 'error' -and $json4.ErrorCode -eq 'ACL_DRIFT_SINCE_PREVIEW_REPORT') "TEST4: unrelated ACL change since the report is detected and rejected (got: $($json4.ErrorCode))"
foreach ($p in $touchedPaths4) {
    $aclAfter4 = (Get-Acl -LiteralPath $(if ($p -match '^[A-Za-z]:$') { "$p\" } else { $p })).Sddl
    Assert-True ($aclAfter4 -eq $beforeAcls4[$p]) "TEST4: $p ACL unchanged by the rejected apply attempt (the injected drift ACE is still there, nothing further was added/removed)"
}
Remove-Item $f4.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 5: report Identity does not match the -ServiceAccountName parameter -- rejected fail-closed ==="
$f5 = New-SyntheticPCloudTree
$preview5 = Invoke-RealPreview -DbPath $f5.DbPath
$out5 = & $applyScriptPath -PreviewReportPath (Join-Path $adminOnlyDir $preview5.Report.FileName) -PreviewReportSha256 $preview5.Report.Sha256 -ServiceAccountName 'NT AUTHORITY\NETWORK SERVICE' -Apply 2>&1
$json5 = $out5 | Out-String | ConvertFrom-Json
Assert-True ($json5.Status -eq 'error' -and $json5.ErrorCode -eq 'PREVIEW_REPORT_SERVICE_ACCOUNT_MISMATCH') "TEST5: mismatched -ServiceAccountName vs report is rejected (got: $($json5.ErrorCode))"
Remove-Item $f5.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== SUMMARY: $script:failures failure(s) ==="
if ($script:failures -gt 0) { exit 1 }
exit 0
