#Requires -Version 5.1
# Dependency-free test script (no Pester) for
# preview-file-agent-attestation-store-access.ps1. Never touches the real
# svc-hb-fileagent ACL or the real attestation store -- uses a synthetic
# path under $env:TEMP and the built-in NT AUTHORITY\LOCAL SERVICE account.
# Run: powershell -File .\preview-file-agent-attestation-store-access.tests.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:failures = 0

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { Write-Output "FAIL: $Message"; $script:failures++ } else { Write-Output "OK: $Message" }
}

$scriptPath = Join-Path $PSScriptRoot 'preview-file-agent-attestation-store-access.ps1'
$adminOnlyDir = 'C:\ProgramData\HasarBotu\migration-preflight'
$targetAccountName = 'NT AUTHORITY\LOCAL SERVICE'
# Match the preview's canonical paths even when TEMP contains a Windows 8.3 alias.
$fixtureTempRoot = [System.IO.Path]::GetFullPath($env:TEMP)

Write-Output '=== TEST 1: attestation store folder does NOT exist yet -> still plans Traverse+Read into it, zero mutation ==='
$missingStore1 = Join-Path $fixtureTempRoot ("hasarbotu-attest-acl-test-missing-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$out1 = & $scriptPath -ServiceAccountName $targetAccountName -AttestationStoreDirectory $missingStore1 2>&1
$json1 = $out1 | Out-String | ConvertFrom-Json
Assert-True ($json1.OverallStatus -eq 'grant_required') "TEST1: OverallStatus=grant_required for a not-yet-created store (got: $($json1.OverallStatus))"
Assert-True (-not [System.IO.Directory]::Exists($missingStore1)) "TEST1: the nonexistent store path was NOT created by this run (zero mutation)"
$storeEntry1 = @($json1.AncestorChainSummary | Where-Object { $_.Path -eq $missingStore1.TrimEnd('\') })
Assert-True ($storeEntry1.Count -eq 1 -and $storeEntry1[0].Reason -eq 'NODE_NOT_FOUND') "TEST1: store folder itself reported NODE_NOT_FOUND (honest, not silently skipped)"
Assert-True ($json1.PlannedAceCount -ge 2) "TEST1: at least Traverse+Read planned for the store folder itself (got: $($json1.PlannedAceCount))"

Write-Output "`n=== TEST 2: synthetic ancestor chain WITH correct Traverse grants + store folder with Read+Synchronize -> already_sufficient ==="
$syntheticRoot2 = Join-Path $fixtureTempRoot ("hasarbotu-attest-acl-test-root-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$syntheticStore2 = Join-Path $syntheticRoot2 'attestations'
New-Item -ItemType Directory -Path $syntheticStore2 -Force | Out-Null
$targetSid = ([System.Security.Principal.NTAccount]$targetAccountName).Translate([System.Security.Principal.SecurityIdentifier]).Value
# Grant Traverse on the synthetic root (ancestor) and Read+Synchronize
# (ObjectInherit) on the store folder itself -- exactly the planned shape.
$rootAcl2 = [System.IO.Directory]::GetAccessControl($syntheticRoot2)
$rootAcl2.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
    $targetAccountName, [System.Security.AccessControl.FileSystemRights]::Traverse,
    [System.Security.AccessControl.InheritanceFlags]::None, [System.Security.AccessControl.PropagationFlags]::None,
    [System.Security.AccessControl.AccessControlType]::Allow))
[System.IO.Directory]::SetAccessControl($syntheticRoot2, $rootAcl2)
$storeAcl2 = [System.IO.Directory]::GetAccessControl($syntheticStore2)
$storeAcl2.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
    $targetAccountName, ([System.Security.AccessControl.FileSystemRights]::Read -bor [System.Security.AccessControl.FileSystemRights]::Synchronize),
    ([System.Security.AccessControl.InheritanceFlags]::ObjectInherit), [System.Security.AccessControl.PropagationFlags]::None,
    [System.Security.AccessControl.AccessControlType]::Allow))
[System.IO.Directory]::SetAccessControl($syntheticStore2, $storeAcl2)
$out2 = & $scriptPath -ServiceAccountName $targetAccountName -AttestationStoreDirectory $syntheticStore2 2>&1
$json2 = $out2 | Out-String | ConvertFrom-Json
$storeEntry2 = @($json2.AncestorChainSummary | Where-Object { $_.Path -eq $syntheticStore2.TrimEnd('\') })
Assert-True ($storeEntry2.Count -eq 1 -and $storeEntry2[0].CurrentlyGranted -eq $true) "TEST2: store folder itself shows CurrentlyGranted=true with the correct Read+Synchronize ACE"
Remove-Item -LiteralPath $syntheticRoot2 -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 3: planned ACEs never contain a write/delete/ownership bit ==="
$out3 = & $scriptPath -ServiceAccountName $targetAccountName -AttestationStoreDirectory (Join-Path $fixtureTempRoot ("hasarbotu-attest-acl-test-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))) 2>&1
$json3 = $out3 | Out-String | ConvertFrom-Json
$reportPath3 = Join-Path $adminOnlyDir $json3.Report.FileName
$fullReport3 = Get-Content -Raw -LiteralPath $reportPath3 | ConvertFrom-Json
$forbiddenMask3 = [int64](2 -bor 4 -bor 16 -bor 256 -bor 65536 -bor 64 -bor 262144 -bor 524288)
$anyForbidden3 = $false
foreach ($ace in $fullReport3.PlannedMinimumAces) { if (([int64]$ace.RightsValue -band $forbiddenMask3) -ne 0) { $anyForbidden3 = $true } }
Assert-True (-not $anyForbidden3) "TEST3: zero write/delete/ownership bits in any planned ACE"
Assert-True ($fullReport3.PlannedAcesContainNoWriteOrDeleteBits -eq $true) "TEST3: report explicitly declares PlannedAcesContainNoWriteOrDeleteBits=true"

Write-Output "`n=== TEST 4: evidence report is Administrators-only + hash-verified ==="
$actualHash4 = (Get-FileHash -LiteralPath $reportPath3 -Algorithm SHA256).Hash.ToLowerInvariant()
Assert-True ($actualHash4 -eq $json3.Report.Sha256) "TEST4: reported Sha256 matches the actual evidence file hash"
$rules4 = @([System.IO.File]::GetAccessControl($reportPath3).GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
Assert-True ($rules4.Count -eq 1 -and $rules4[0].IdentityReference.Value -eq 'S-1-5-32-544') "TEST4: evidence report ACL is Administrators-only"

Write-Output "`n=== SUMMARY: $script:failures failure(s) ==="
if ($script:failures -gt 0) { exit 1 }
exit 0
