#Requires -Version 5.1
# Dependency-free test script (no Pester) for
# preview-file-agent-pcloud-db-access.ps1. Builds a synthetic
# source/target tree with crafted ACLs under $env:TEMP; never touches any
# real HasarBotu/pCloud data or account. Uses the built-in, always-present
# NT AUTHORITY\LOCAL SERVICE account (a real, stable, well-known SID) as
# the stand-in "target service account" so no new local account is ever
# created as a side effect of running these tests.
# Run: powershell -File .\preview-file-agent-pcloud-db-access.tests.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:failures = 0

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { Write-Output "FAIL: $Message"; $script:failures++ } else { Write-Output "OK: $Message" }
}

$targetAccountName = 'NT AUTHORITY\LOCAL SERVICE'
$targetSid = ([System.Security.Principal.NTAccount]$targetAccountName).Translate([System.Security.Principal.SecurityIdentifier]).Value
$scriptPath = Join-Path $PSScriptRoot 'preview-file-agent-pcloud-db-access.ps1'
$fixtureTempRoot = [System.IO.Path]::GetFullPath($env:TEMP)

function New-SyntheticPCloudTree {
    param([bool]$GrantTraverseAtLocal, [bool]$IncludeWalShm = $true, [bool]$ExplicitDenyAtUser = $false)
    $root = Join-Path $fixtureTempRoot ("hasarbotu-fa-pcloud-acl-fixture-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    $userDir = Join-Path $root 'FakeProfile'
    $appDataDir = Join-Path $userDir 'AppData'
    $localDir = Join-Path $appDataDir 'Local'
    $pcloudDir = Join-Path $localDir 'pCloud'
    New-Item -ItemType Directory -Path $pcloudDir -Force | Out-Null

    $dbPath = Join-Path $pcloudDir 'data.db'
    [System.IO.File]::WriteAllBytes($dbPath, [byte[]]@(1, 2, 3))
    if ($IncludeWalShm) {
        [System.IO.File]::WriteAllBytes("$dbPath-wal", [byte[]]@(4, 5))
        [System.IO.File]::WriteAllBytes("$dbPath-shm", [byte[]]@(6))
    }

    if ($ExplicitDenyAtUser) {
        $acl = Get-Acl -LiteralPath $userDir
        $denyRule = [System.Security.AccessControl.FileSystemAccessRule]::new(
            $targetAccountName, [System.Security.AccessControl.FileSystemRights]::Traverse,
            [System.Security.AccessControl.InheritanceFlags]::None, [System.Security.AccessControl.PropagationFlags]::None,
            [System.Security.AccessControl.AccessControlType]::Deny)
        $acl.AddAccessRule($denyRule)
        $allowRule = [System.Security.AccessControl.FileSystemAccessRule]::new(
            $targetAccountName, [System.Security.AccessControl.FileSystemRights]::Traverse,
            [System.Security.AccessControl.InheritanceFlags]::None, [System.Security.AccessControl.PropagationFlags]::None,
            [System.Security.AccessControl.AccessControlType]::Allow)
        $acl.AddAccessRule($allowRule)
        Set-Acl -LiteralPath $userDir -AclObject $acl
    }

    if ($GrantTraverseAtLocal) {
        $acl = Get-Acl -LiteralPath $localDir
        $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
            $targetAccountName, [System.Security.AccessControl.FileSystemRights]::Traverse,
            [System.Security.AccessControl.InheritanceFlags]::None, [System.Security.AccessControl.PropagationFlags]::None,
            [System.Security.AccessControl.AccessControlType]::Allow)
        $acl.AddAccessRule($rule)
        Set-Acl -LiteralPath $localDir -AclObject $acl
    }

    return [pscustomobject]@{ Root = $root; UserDir = $userDir; LocalDir = $localDir; PCloudDir = $pcloudDir; DbPath = $dbPath }
}

$forbiddenBitsMask = [int64](
    [System.Security.AccessControl.FileSystemRights]::WriteData -bor
    [System.Security.AccessControl.FileSystemRights]::AppendData -bor
    [System.Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
    [System.Security.AccessControl.FileSystemRights]::WriteAttributes -bor
    [System.Security.AccessControl.FileSystemRights]::Delete -bor
    [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
    [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
    [System.Security.AccessControl.FileSystemRights]::TakeOwnership
)

Write-Output '=== TEST 1: fresh synthetic tree, no grants anywhere -- full plan generated, zero write/delete bits, no changes made ==='
$f1 = New-SyntheticPCloudTree -GrantTraverseAtLocal $false
$out1 = & $scriptPath -ServiceAccountName $targetAccountName -PCloudSyncAccount "$env:COMPUTERNAME\$env:USERNAME" -PCloudLocalDatabasePath $f1.DbPath 2>&1
$json1 = $out1 | Out-String | ConvertFrom-Json
Assert-True ($json1.OverallStatus -eq 'grant_required') "Fresh tree: OverallStatus is grant_required (got: $($json1.OverallStatus))"
Assert-True ($json1.Blockers.Count -eq 0) "Fresh tree: no blockers (unexpected DENY etc.)"
$syntheticSpecificNodes1 = @($json1.AncestorChainSummary | Where-Object { $_.RelativeDepth.StartsWith($f1.UserDir) -or $_.RelativeDepth -eq $f1.UserDir })
Assert-True ($syntheticSpecificNodes1.Count -ge 4) "Fresh tree: fixture-specific nodes (UserDir downward) are present in the chain (got: $($syntheticSpecificNodes1.Count))"
$grantedSyntheticNodes1 = @($syntheticSpecificNodes1 | Where-Object { $_.CurrentlyGranted -eq $true })
Assert-True ($grantedSyntheticNodes1.Count -eq 0) "Fresh tree: zero FIXTURE-SPECIFIC ancestors (UserDir downward, never touched by any real grant) already granted -- real ancestors above the fixture (e.g. C:\Users via Everyone) are correctly excluded from this check since they legitimately pre-date the fixture"
$adminReport1 = Get-Content -Raw (Join-Path 'C:\ProgramData\HasarBotu\migration-preflight' $json1.Report.FileName) | ConvertFrom-Json
$paths1 = @($adminReport1.AncestorChain | ForEach-Object { $_.Path })
Assert-True (($paths1 | Select-Object -Unique).Count -eq $paths1.Count) "Fresh tree: no duplicate ancestor path in the chain (drive-root dedup holds)"
foreach ($ace in $adminReport1.PlannedMinimumAces) {
    Assert-True (([int64]$ace.RightsValue -band $forbiddenBitsMask) -eq 0) "Fresh tree: planned ACE on $($ace.Path) ($($ace.Rights)) contains ZERO write/delete/modify bits (independently recomputed, not just trusting the self-reported flag)"
}
Assert-True (-not [string]::IsNullOrWhiteSpace($adminReport1.RollbackPlan)) "Fresh tree: RollbackPlan documented"
Assert-True (-not [string]::IsNullOrWhiteSpace($adminReport1.DriftCheckPlan)) "Fresh tree: DriftCheckPlan documented"
Assert-True (-not [string]::IsNullOrWhiteSpace($adminReport1.WalShmContinuityReasoning)) "Fresh tree: WAL/SHM continuity reasoning documented"
# Structural proof this is preview-only: verify NOTHING was actually changed.
$aclAfter1 = Get-Acl -LiteralPath $f1.LocalDir
$stillNoGrant1 = @($aclAfter1.Access | Where-Object { $_.IdentityReference.Value -eq $targetSid })
Assert-True ($stillNoGrant1.Count -eq 0) "Fresh tree: real ACL on disk is STILL unchanged after running preview (no Apply happened)"
Remove-Item $f1.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 2: one ancestor (Local) already grants Traverse to the target account -- that node (and only that node) reports Granted ==="
$f2 = New-SyntheticPCloudTree -GrantTraverseAtLocal $true
$out2 = & $scriptPath -ServiceAccountName $targetAccountName -PCloudSyncAccount "$env:COMPUTERNAME\$env:USERNAME" -PCloudLocalDatabasePath $f2.DbPath 2>&1
$json2 = $out2 | Out-String | ConvertFrom-Json
$localEntry2 = @($json2.AncestorChainSummary | Where-Object { $_.RelativeDepth -eq $f2.LocalDir })
Assert-True ($localEntry2.Count -eq 1 -and $localEntry2[0].CurrentlyGranted -eq $true) "Local dir (explicitly granted) reports CurrentlyGranted=true"
$userEntry2 = @($json2.AncestorChainSummary | Where-Object { $_.RelativeDepth -eq $f2.UserDir })
Assert-True ($userEntry2.Count -eq 1 -and $userEntry2[0].CurrentlyGranted -eq $false) "User dir (NOT granted) still reports CurrentlyGranted=false"
$adminReport2 = Get-Content -Raw (Join-Path 'C:\ProgramData\HasarBotu\migration-preflight' $json2.Report.FileName) | ConvertFrom-Json
$localPlanned2 = @($adminReport2.PlannedMinimumAces | Where-Object { $_.Path -eq $f2.LocalDir })
Assert-True ($localPlanned2.Count -eq 0) "Already-granted Local dir is correctly EXCLUDED from the planned-ACE list (no redundant grant planned)"
Remove-Item $f2.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 3: explicit DENY on the user profile root beats an explicit ALLOW at the same node -- reported as blocked, flagged ==="
$f3 = New-SyntheticPCloudTree -GrantTraverseAtLocal $false -ExplicitDenyAtUser $true
$out3 = & $scriptPath -ServiceAccountName $targetAccountName -PCloudSyncAccount "$env:COMPUTERNAME\$env:USERNAME" -PCloudLocalDatabasePath $f3.DbPath 2>&1
$json3 = $out3 | Out-String | ConvertFrom-Json
$userEntry3 = @($json3.AncestorChainSummary | Where-Object { $_.RelativeDepth -eq $f3.UserDir })
Assert-True ($userEntry3.Count -eq 1 -and $userEntry3[0].CurrentlyGranted -eq $false -and $userEntry3[0].Reason -eq 'EXPLICIT_DENY_PRESENT') "Explicit DENY correctly wins over an explicit ALLOW at the same node (got reason: $($userEntry3[0].Reason))"
Assert-True ($json3.Blockers -contains 'EXPLICIT_DENY_ACE_PRESENT_ON_ANCESTOR') "Explicit DENY is surfaced as a Blocker requiring separate handling"
Remove-Item $f3.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 4: data.db-wal/-shm absent (non-WAL-mode-observed snapshot) -- reported Exists=false, no crash ==="
$f4 = New-SyntheticPCloudTree -GrantTraverseAtLocal $false -IncludeWalShm $false
$out4 = & $scriptPath -ServiceAccountName $targetAccountName -PCloudSyncAccount "$env:COMPUTERNAME\$env:USERNAME" -PCloudLocalDatabasePath $f4.DbPath 2>&1
$json4 = $out4 | Out-String | ConvertFrom-Json
Assert-True ($json4.OverallStatus -eq 'grant_required') "Missing -wal/-shm: script still completes cleanly (got: $($json4.OverallStatus))"
$walEntry4 = @($json4.DatabaseFilesSummary | Where-Object { $_.Name -like '*-wal' })
$shmEntry4 = @($json4.DatabaseFilesSummary | Where-Object { $_.Name -like '*-shm' })
Assert-True ($walEntry4.Count -eq 1 -and $walEntry4[0].Exists -eq $false) "data.db-wal correctly reported Exists=false, not a crash"
Assert-True ($shmEntry4.Count -eq 1 -and $shmEntry4[0].Exists -eq $false) "data.db-shm correctly reported Exists=false, not a crash"
Remove-Item $f4.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 5: service account name that does not exist -- fail-closed, no plan produced ==="
$f5 = New-SyntheticPCloudTree -GrantTraverseAtLocal $false
$out5 = & $scriptPath -ServiceAccountName 'this-account-does-not-exist-hasarbotu-test' -PCloudSyncAccount "$env:COMPUTERNAME\$env:USERNAME" -PCloudLocalDatabasePath $f5.DbPath 2>&1
$json5 = $out5 | Out-String | ConvertFrom-Json
Assert-True ($json5.Status -eq 'error' -and $json5.ErrorCode -eq 'SERVICE_ACCOUNT_NOT_FOUND') "Nonexistent service account name fails closed with SERVICE_ACCOUNT_NOT_FOUND (got: $($json5.ErrorCode))"
Remove-Item $f5.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== SUMMARY: $script:failures failure(s) ==="
if ($script:failures -gt 0) { exit 1 }
exit 0
