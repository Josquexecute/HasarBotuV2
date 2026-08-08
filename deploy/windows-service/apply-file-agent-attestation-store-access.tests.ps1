#Requires -Version 5.1
# Dependency-free test script (no Pester) for
# apply-file-agent-attestation-store-access.ps1. Mirrors
# apply-file-agent-pcloud-db-access.tests.ps1's structure: builds a
# synthetic ancestor chain and a REAL preview report (by actually invoking
# the unmodified preview-file-agent-attestation-store-access.ps1 against
# it), so the apply tool is always exercised against a genuinely-shaped
# report, never a hand-guessed one. Uses the built-in, always-present
# NT AUTHORITY\LOCAL SERVICE account as the target identity -- no new local
# account, and never touches svc-hb-fileagent or the real attestation
# store. Every synthetic tree lives under $env:TEMP and is removed after
# each test.
# Run: powershell -File .\apply-file-agent-attestation-store-access.tests.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:failures = 0

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { Write-Output "FAIL: $Message"; $script:failures++ } else { Write-Output "OK: $Message" }
}

$targetAccountName = 'NT AUTHORITY\LOCAL SERVICE'
$targetSid = ([System.Security.Principal.NTAccount]$targetAccountName).Translate([System.Security.Principal.SecurityIdentifier]).Value
$previewScriptPath = Join-Path $PSScriptRoot 'preview-file-agent-attestation-store-access.ps1'
$applyScriptPath = Join-Path $PSScriptRoot 'apply-file-agent-attestation-store-access.ps1'
$adminOnlyDir = 'C:\ProgramData\HasarBotu\migration-preflight'

function New-SyntheticFixtureRoot {
    param([bool]$PreCreateStore = $false, [int]$ExistingFileCount = 0)
    $root = Join-Path $env:TEMP ("hasarbotu-fa-attest-apply-fixture-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    $storePath = Join-Path $root 'Ancestor1\Ancestor2\attestations'
    if ($PreCreateStore) {
        New-Item -ItemType Directory -Path $storePath -Force | Out-Null
        for ($i = 0; $i -lt $ExistingFileCount; $i++) {
            [System.IO.File]::WriteAllText((Join-Path $storePath "existing-$i.json"), '{}')
        }
    }
    else {
        New-Item -ItemType Directory -Path (Split-Path $storePath -Parent) -Force | Out-Null
    }
    return [pscustomobject]@{ Root = $root; StorePath = $storePath }
}

function Invoke-RealPreview {
    param([string]$StorePath)
    $out = & $previewScriptPath -ServiceAccountName $targetAccountName -AttestationStoreDirectory $StorePath 2>&1
    return ($out | Out-String | ConvertFrom-Json)
}

function Get-AllTouchedAncestorPaths {
    param($PreviewWrapper)
    $reportPath = Join-Path $adminOnlyDir $PreviewWrapper.Report.FileName
    $fullReport = Get-Content -Raw -LiteralPath $reportPath | ConvertFrom-Json
    return @($fullReport.PlannedMinimumAces | ForEach-Object { $_.Path } | Select-Object -Unique)
}

Write-Output '=== TEST 1: first-run (store folder does not exist yet) -- Apply creates it + applies ACEs + real continuity proof + confirmed -- then Rollback -> ACL restored to admin-only ==='
$f1 = New-SyntheticFixtureRoot
$preview1 = Invoke-RealPreview -StorePath $f1.StorePath
Assert-True ($preview1.OverallStatus -eq 'grant_required') "TEST1: preview shows grant_required (got: $($preview1.OverallStatus))"
Assert-True (-not (Test-Path -LiteralPath $f1.StorePath)) "TEST1: store folder genuinely does not exist yet before Apply"
$touchedPaths1 = Get-AllTouchedAncestorPaths -PreviewWrapper $preview1
$ancestorPaths1 = @($touchedPaths1 | Where-Object { $_ -ne $f1.StorePath })
$beforeAcls1 = @{}
foreach ($p in $ancestorPaths1) { $beforeAcls1[$p] = (Get-Acl -LiteralPath $(if ($p -match '^[A-Za-z]:$') { "$p\" } else { $p })).Sddl }

$applyOut1 = & $applyScriptPath -PreviewReportPath (Join-Path $adminOnlyDir $preview1.Report.FileName) -PreviewReportSha256 $preview1.Report.Sha256 -ServiceAccountName $targetAccountName -Apply 2>&1
$applyJson1 = $applyOut1 | Out-String | ConvertFrom-Json
Assert-True ($applyJson1.OverallStatus -eq 'applied') "TEST1: Apply reports OverallStatus=applied (got: $($applyJson1.OverallStatus))"
Assert-True ($applyJson1.ContinuityInheritanceConfirmed -eq $true) "TEST1: future-file inheritance REALLY confirmed (throwaway file inherited the ACE)"
Assert-True ($applyJson1.StoreFolderReadGranted -eq $true) "TEST1: SID simulation confirms Read=granted on the store folder after Apply"
Assert-True ($applyJson1.StoreFolderForbiddenAccessGranted -eq $false) "TEST1: SID simulation confirms Write/Delete/Ownership=NOT granted on the store folder after Apply"
Assert-True ($applyJson1.RollbackPackageVerified -eq $true) "TEST1: rollback package re-verified via hash-verified re-read (got: $($applyJson1.RollbackPackageVerified))"
Assert-True (Test-Path -LiteralPath $f1.StorePath) "TEST1: store folder now exists on disk after Apply"

foreach ($p in $touchedPaths1) {
    $realPath = $(if ($p -match '^[A-Za-z]:$') { "$p\" } else { $p })
    $acl = [System.IO.Directory]::GetAccessControl($realPath)
    $rule = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | Where-Object { $_.IdentityReference.Value -eq $targetSid -and -not $_.IsInherited })
    Assert-True ($rule.Count -gt 0) "TEST1: $p really has a new, explicit ACE for the target account on disk"
}
$storeAcl1 = [System.IO.Directory]::GetAccessControl($f1.StorePath)
$writeBits1 = [int64](
    [System.Security.AccessControl.FileSystemRights]::WriteData -bor [System.Security.AccessControl.FileSystemRights]::Delete -bor
    [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor [System.Security.AccessControl.FileSystemRights]::TakeOwnership)
$targetRules1 = @($storeAcl1.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | Where-Object { $_.IdentityReference.Value -eq $targetSid })
foreach ($rule in $targetRules1) {
    Assert-True ((([int64]$rule.FileSystemRights) -band $writeBits1) -eq 0) "TEST1: applied ACE on store folder contains ZERO write/delete/ownership bits (independently re-checked on the REAL applied ACL)"
}

$applyReportPath1 = Join-Path $adminOnlyDir $applyJson1.Report.FileName
$rollbackOut1 = & $applyScriptPath -Rollback -ApplyEvidenceReportPath $applyReportPath1 -ApplyEvidenceReportSha256 $applyJson1.Report.Sha256 2>&1
$rollbackJson1 = $rollbackOut1 | Out-String | ConvertFrom-Json
Assert-True ($rollbackJson1.AllNodesRestoredExactly -eq $true) "TEST1: Rollback reports AllNodesRestoredExactly=true"
foreach ($p in $ancestorPaths1) {
    $aclAfterRollback = (Get-Acl -LiteralPath $(if ($p -match '^[A-Za-z]:$') { "$p\" } else { $p })).Sddl
    Assert-True ($aclAfterRollback -eq $beforeAcls1[$p]) "TEST1: $p ACL restored to the EXACT pre-apply SDDL byte-for-byte"
}
$storeAclAfterRollback1 = [System.IO.Directory]::GetAccessControl($f1.StorePath)
$storeRuleAfterRollback1 = @($storeAclAfterRollback1.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | Where-Object { $_.IdentityReference.Value -eq $targetSid })
Assert-True ($storeRuleAfterRollback1.Count -eq 0) "TEST1: store folder's grant ACE for the target account is gone after rollback (restored to admin-only, folder itself left on disk harmlessly)"
Remove-Item $f1.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 2: without -Apply (dry-run) -- fully validates, creates/changes NOTHING on disk ==="
$f2 = New-SyntheticFixtureRoot
$preview2 = Invoke-RealPreview -StorePath $f2.StorePath
$touchedPaths2 = Get-AllTouchedAncestorPaths -PreviewWrapper $preview2
$ancestorPaths2 = @($touchedPaths2 | Where-Object { $_ -ne $f2.StorePath })
$beforeAcls2 = @{}
foreach ($p in $ancestorPaths2) { $beforeAcls2[$p] = (Get-Acl -LiteralPath $(if ($p -match '^[A-Za-z]:$') { "$p\" } else { $p })).Sddl }
$dryRunOut2 = & $applyScriptPath -PreviewReportPath (Join-Path $adminOnlyDir $preview2.Report.FileName) -PreviewReportSha256 $preview2.Report.Sha256 -ServiceAccountName $targetAccountName 2>&1
$dryRunJson2 = $dryRunOut2 | Out-String | ConvertFrom-Json
Assert-True ($dryRunJson2.OverallStatus -eq 'validated_ready_for_apply') "TEST2: dry-run (no -Apply) reports validated_ready_for_apply (got: $($dryRunJson2.OverallStatus))"
Assert-True (-not (Test-Path -LiteralPath $f2.StorePath)) "TEST2: store folder still does NOT exist after dry-run (no -Apply means zero mutation, including no directory creation)"
foreach ($p in $ancestorPaths2) {
    $aclAfter2 = (Get-Acl -LiteralPath $(if ($p -match '^[A-Za-z]:$') { "$p\" } else { $p })).Sddl
    Assert-True ($aclAfter2 -eq $beforeAcls2[$p]) "TEST2: $p ACL is STILL unchanged after dry-run"
}
Remove-Item $f2.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 3: tampered report (a disallowed WriteData bit injected into one planned ACE) -- rejected fail-closed, zero mutation ==="
$f3 = New-SyntheticFixtureRoot
$preview3 = Invoke-RealPreview -StorePath $f3.StorePath
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
$out3 = & $applyScriptPath -PreviewReportPath $tamperedPath3 -PreviewReportSha256 $tamperedHash3 -ServiceAccountName $targetAccountName -Apply 2>&1
$json3 = $out3 | Out-String | ConvertFrom-Json
Assert-True ($json3.Status -eq 'error' -and $json3.ErrorCode -eq 'PLANNED_ACE_OUTSIDE_WHITELIST') "TEST3: tampered (WriteData-injected) ACE rejected with PLANNED_ACE_OUTSIDE_WHITELIST (got: $($json3.ErrorCode))"
Assert-True (-not (Test-Path -LiteralPath $f3.StorePath)) "TEST3: store folder never got created -- tampered report never reached the mutation step"
Remove-Item $f3.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 4: ACL drift since the preview report (unrelated ACE added to an ancestor node between preview and apply) -- rejected fail-closed ==="
$f4 = New-SyntheticFixtureRoot
$preview4 = Invoke-RealPreview -StorePath $f4.StorePath
$touchedPaths4 = Get-AllTouchedAncestorPaths -PreviewWrapper $preview4
$ancestorPaths4 = @($touchedPaths4 | Where-Object { $_ -ne $f4.StorePath })
$driftPath4 = $ancestorPaths4[0]
$driftAcl4 = Get-Acl -LiteralPath $driftPath4
$driftAcl4.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
    'NT AUTHORITY\NETWORK SERVICE', [System.Security.AccessControl.FileSystemRights]::Traverse,
    [System.Security.AccessControl.InheritanceFlags]::None, [System.Security.AccessControl.PropagationFlags]::None,
    [System.Security.AccessControl.AccessControlType]::Allow))
Set-Acl -LiteralPath $driftPath4 -AclObject $driftAcl4
$beforeAcls4 = @{}
foreach ($p in $ancestorPaths4) { $beforeAcls4[$p] = (Get-Acl -LiteralPath $(if ($p -match '^[A-Za-z]:$') { "$p\" } else { $p })).Sddl }
$out4 = & $applyScriptPath -PreviewReportPath (Join-Path $adminOnlyDir $preview4.Report.FileName) -PreviewReportSha256 $preview4.Report.Sha256 -ServiceAccountName $targetAccountName -Apply 2>&1
$json4 = $out4 | Out-String | ConvertFrom-Json
Assert-True ($json4.Status -eq 'error' -and $json4.ErrorCode -eq 'ACL_DRIFT_SINCE_PREVIEW_REPORT') "TEST4: unrelated ACL change since the report is detected and rejected (got: $($json4.ErrorCode))"
foreach ($p in $ancestorPaths4) {
    $aclAfter4 = (Get-Acl -LiteralPath $(if ($p -match '^[A-Za-z]:$') { "$p\" } else { $p })).Sddl
    Assert-True ($aclAfter4 -eq $beforeAcls4[$p]) "TEST4: $p ACL unchanged by the rejected apply attempt"
}
Remove-Item $f4.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 5: report Identity does not match the -ServiceAccountName parameter -- rejected fail-closed ==="
$f5 = New-SyntheticFixtureRoot
$preview5 = Invoke-RealPreview -StorePath $f5.StorePath
$out5 = & $applyScriptPath -PreviewReportPath (Join-Path $adminOnlyDir $preview5.Report.FileName) -PreviewReportSha256 $preview5.Report.Sha256 -ServiceAccountName 'NT AUTHORITY\NETWORK SERVICE' -Apply 2>&1
$json5 = $out5 | Out-String | ConvertFrom-Json
Assert-True ($json5.Status -eq 'error' -and $json5.ErrorCode -eq 'PREVIEW_REPORT_SERVICE_ACCOUNT_MISMATCH') "TEST5: mismatched -ServiceAccountName vs report is rejected (got: $($json5.ErrorCode))"
Remove-Item $f5.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 6: store folder ALREADY exists with 2 existing attestation-like files -- Apply confirms Read=yes/Write=no on the EXISTING files too, not just new ones ==="
$f6 = New-SyntheticFixtureRoot -PreCreateStore $true -ExistingFileCount 2
$preview6 = Invoke-RealPreview -StorePath $f6.StorePath
Assert-True ($preview6.OverallStatus -eq 'grant_required') "TEST6: preview shows grant_required for an already-existing, not-yet-granted store folder (got: $($preview6.OverallStatus))"
$applyOut6 = & $applyScriptPath -PreviewReportPath (Join-Path $adminOnlyDir $preview6.Report.FileName) -PreviewReportSha256 $preview6.Report.Sha256 -ServiceAccountName $targetAccountName -Apply 2>&1
$applyJson6 = $applyOut6 | Out-String | ConvertFrom-Json
Assert-True ($applyJson6.OverallStatus -eq 'applied') "TEST6: Apply succeeds against an already-existing store folder (got: $($applyJson6.OverallStatus))"
Assert-True ($applyJson6.ExistingAttestationFileCount -eq 2) "TEST6: both pre-existing files were found and evaluated (got: $($applyJson6.ExistingAttestationFileCount))"
$fullApplyReport6 = Get-Content -Raw -LiteralPath (Join-Path $adminOnlyDir $applyJson6.Report.FileName) | ConvertFrom-Json
foreach ($fileResult in $fullApplyReport6.ExistingAttestationFileEffectiveAccessSimulation) {
    Assert-True ($fileResult.ReadGranted -eq $true) "TEST6: existing file $($fileResult.Path) shows Read=granted after Apply (propagates to pre-existing children, not just future ones)"
    Assert-True ($fileResult.ForbiddenAccessGranted -eq $false) "TEST6: existing file $($fileResult.Path) shows Write/Delete/Ownership=NOT granted after Apply"
}
Remove-Item $f6.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== SUMMARY: $script:failures failure(s) ==="
if ($script:failures -gt 0) { exit 1 }
exit 0
