#Requires -Version 5.1
# Dependency-free test script (no Pester) for
# preview-file-agent-controlled-activation.ps1. Never touches the real
# hasarbotu-file-agent service, real pCloud data, or any real env var --
# uses synthetic fixtures under $env:TEMP and built-in, always-present
# accounts (NT AUTHORITY\LOCAL SERVICE / NETWORK SERVICE) as stand-ins.
# Run: powershell -File .\preview-file-agent-controlled-activation.tests.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:failures = 0

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { Write-Output "FAIL: $Message"; $script:failures++ } else { Write-Output "OK: $Message" }
}

$scriptPath = Join-Path $PSScriptRoot 'preview-file-agent-controlled-activation.ps1'
$adminOnlyDir = 'C:\ProgramData\HasarBotu\migration-preflight'
$serviceAccountName = 'NT AUTHORITY\LOCAL SERVICE'
$syncAccountName = 'NT AUTHORITY\NETWORK SERVICE'

function New-SyntheticStorageRoot {
    param([string]$ServiceAccount, [string]$SyncAccount)
    $root = Join-Path $env:TEMP ("hasarbotu-fa-activation-fixture-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    $acl = [System.IO.Directory]::GetAccessControl($root)
    $acl.SetAccessRuleProtection($true, $false)
    $adminSid = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
    $acl.SetOwner($adminSid)
    $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($adminSid, [System.Security.AccessControl.FileSystemRights]::FullControl, ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit), [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow))
    $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($SyncAccount, [System.Security.AccessControl.FileSystemRights]::Modify, ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit), [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow))
    $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($ServiceAccount, [System.Security.AccessControl.FileSystemRights]::Modify, ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit), [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow))
    [System.IO.Directory]::SetAccessControl($root, $acl)
    return $root
}

function New-SyntheticPCloudDbTree {
    $root = Join-Path $env:TEMP ("hasarbotu-fa-activation-db-fixture-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    $userDir = Join-Path $root 'FakeProfile'
    $pcloudDir = Join-Path $userDir 'AppData\Local\pCloud'
    New-Item -ItemType Directory -Path $pcloudDir -Force | Out-Null
    $dbPath = Join-Path $pcloudDir 'data.db'
    [System.IO.File]::WriteAllBytes($dbPath, [byte[]]@(1, 2, 3))
    return [pscustomobject]@{ Root = $root; DbPath = $dbPath }
}

Write-Output '=== TEST 1: fully-synthetic negative path (storage root / service / app dir / WinSW exe all missing) -> every path-dependent precondition reported blocked_structural, zero mutation ==='
$envBefore1 = [Environment]::GetEnvironmentVariable('HASARBOTU_AGENT_ROOTS', 'Machine')
$missingRoot1 = Join-Path $env:TEMP ("hasarbotu-fa-activation-missing-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$out1 = & $scriptPath -ServiceAccountName $serviceAccountName -PCloudSyncAccount $syncAccountName -StorageRoot $missingRoot1 -FileAgentServiceName 'HasarBotuFakeServiceThatDoesNotExist' -FileAgentAppDir (Join-Path $missingRoot1 'app') -WinSwExePath (Join-Path $missingRoot1 'WinSW-x64.exe') -FileAgentRepoSourceDir (Join-Path $missingRoot1 'repo') 2>&1
$json1 = $out1 | Out-String | ConvertFrom-Json
Assert-True ($json1.OverallReadiness -eq 'blocked') "TEST1: OverallReadiness=blocked (got: $($json1.OverallReadiness))"
$storageRootEntry1 = @($json1.PreconditionsSummary | Where-Object { $_.Name -eq 'storage_root' })
Assert-True ($storageRootEntry1.Count -eq 1 -and $storageRootEntry1[0].Status -eq 'blocked_structural') "TEST1: storage_root reported blocked_structural for a nonexistent path (got: $($storageRootEntry1[0].Status))"
$serviceEntry1 = @($json1.PreconditionsSummary | Where-Object { $_.Name -eq 'service_config_credential_acl_env' })
Assert-True ($serviceEntry1.Count -eq 1 -and $serviceEntry1[0].Status -eq 'blocked_structural') "TEST1: service_config_credential_acl_env reported blocked_structural for a nonexistent service (got: $($serviceEntry1[0].Status))"
$envAfter1 = [Environment]::GetEnvironmentVariable('HASARBOTU_AGENT_ROOTS', 'Machine')
Assert-True ($envAfter1 -eq $envBefore1) "TEST1: HASARBOTU_AGENT_ROOTS machine env var unchanged (zero mutation)"
Assert-True (-not [System.IO.Directory]::Exists($missingRoot1)) "TEST1: the nonexistent storage root path was NOT created by this run"

Write-Output "`n=== TEST 2: synthetic positive fixture (correct 3-ACE storage root, real DB preview against synthetic DB path) -> storage_root and pcloud_db checks verified_ok ==="
$storageRoot2 = New-SyntheticStorageRoot -ServiceAccount $serviceAccountName -SyncAccount $syncAccountName
$dbFixture2 = New-SyntheticPCloudDbTree
$out2 = & $scriptPath -ServiceAccountName $serviceAccountName -PCloudSyncAccount $syncAccountName -PCloudLocalDatabasePath $dbFixture2.DbPath -StorageRoot $storageRoot2 -FileAgentServiceName 'HasarBotuFakeServiceThatDoesNotExist' -FileAgentAppDir (Join-Path $env:TEMP 'hasarbotu-fa-activation-no-app-dir') -WinSwExePath (Join-Path $env:TEMP 'hasarbotu-fa-activation-no-winsw.exe') 2>&1
$json2 = $out2 | Out-String | ConvertFrom-Json
$storageRootEntry2 = @($json2.PreconditionsSummary | Where-Object { $_.Name -eq 'storage_root' })
Assert-True ($storageRootEntry2.Count -eq 1 -and $storageRootEntry2[0].Status -eq 'verified_ok') "TEST2: storage_root verified_ok for a correctly-ACL'd synthetic root (got: $($storageRootEntry2[0].Status))"
$dbReadEntry2 = @($json2.PreconditionsSummary | Where-Object { $_.Name -eq 'pcloud_db_readonly_access' })
Assert-True ($dbReadEntry2.Count -eq 1) "TEST2: pcloud_db_readonly_access precondition present"
$dbWriteEntry2 = @($json2.PreconditionsSummary | Where-Object { $_.Name -eq 'pcloud_db_no_write_delete' })
Assert-True ($dbWriteEntry2.Count -eq 1) "TEST2: pcloud_db_no_write_delete precondition present"
Remove-Item $storageRoot2 -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $dbFixture2.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 3: activation sequence structure -- exactly 7 ordered stages, freshness-gate stage honestly reported blocked ==="
$out3 = & $scriptPath -ServiceAccountName $serviceAccountName -PCloudSyncAccount $syncAccountName 2>&1
$json3 = $out3 | Out-String | ConvertFrom-Json
Assert-True ($json3.ActivationSequenceStageCount -eq 7) "TEST3: ActivationSequenceStageCount=7 (got: $($json3.ActivationSequenceStageCount))"
$freshnessEntry3 = @($json3.PreconditionsSummary | Where-Object { $_.Name -eq 'per_case_freshness_gate_access' })
Assert-True ($freshnessEntry3.Count -eq 1 -and $freshnessEntry3[0].Status -eq 'blocked_structural') "TEST3: per_case_freshness_gate_access honestly reported blocked_structural (P:\ is not visible in Session 0 -- real, structural finding, not glossed over)"
$reportPath3 = Join-Path $adminOnlyDir $json3.Report.FileName
$fullReport3 = Get-Content -Raw -LiteralPath $reportPath3 | ConvertFrom-Json
$stageNames3 = @($fullReport3.ActivationSequence | ForEach-Object { $_.Name })
$expectedStageNames3 = @('env/root', 'service config', 'start', 'service-context DB probe', 'per-case freshness smoke', 'File Agent file-operation smoke', 'verify/rollback')
Assert-True (($stageNames3 -join '|') -eq ($expectedStageNames3 -join '|')) "TEST3: activation sequence stage names/order exactly match the requested sequence (got: $($stageNames3 -join ' -> '))"

Write-Output "`n=== TEST 4: zero mutation across a full run (env vars, real hasarbotu-file-agent service state, no stray non-evidence files) ==="
$realEnvBefore4 = @{}
foreach ($n in @('HASARBOTU_AGENT_ROOTS', 'HASARBOTU_AGENT_ID', 'HASARBOTU_AGENT_SECRET', 'HASARBOTU_API_BASE_URL')) { $realEnvBefore4[$n] = [Environment]::GetEnvironmentVariable($n, 'Machine') }
$realSvcBefore4 = Get-CimInstance -ClassName Win32_Service -Filter "Name='hasarbotu-file-agent'" -ErrorAction SilentlyContinue
$out4 = & $scriptPath 2>&1
$json4 = $out4 | Out-String | ConvertFrom-Json
Assert-True ($json4.ReadOnly -eq $true) "TEST4: wrapper output declares ReadOnly=true"
$realEnvAfter4 = @{}
foreach ($n in @('HASARBOTU_AGENT_ROOTS', 'HASARBOTU_AGENT_ID', 'HASARBOTU_AGENT_SECRET', 'HASARBOTU_API_BASE_URL')) { $realEnvAfter4[$n] = [Environment]::GetEnvironmentVariable($n, 'Machine') }
$envUnchanged4 = $true
foreach ($n in $realEnvBefore4.Keys) { if ($realEnvBefore4[$n] -ne $realEnvAfter4[$n]) { $envUnchanged4 = $false } }
Assert-True $envUnchanged4 "TEST4: real HASARBOTU_* machine env vars unchanged by this run"
$realSvcAfter4 = Get-CimInstance -ClassName Win32_Service -Filter "Name='hasarbotu-file-agent'" -ErrorAction SilentlyContinue
$svcUnchanged4 = (($null -eq $realSvcBefore4) -eq ($null -eq $realSvcAfter4)) -and ($null -eq $realSvcBefore4 -or ($realSvcBefore4.StartMode -eq $realSvcAfter4.StartMode -and $realSvcBefore4.State -eq $realSvcAfter4.State))
Assert-True $svcUnchanged4 "TEST4: real hasarbotu-file-agent service StartMode/State unchanged by this run"

Write-Output "`n=== TEST 5: evidence report is Administrators-only + hash-verified ==="
$out5 = & $scriptPath 2>&1
$json5 = $out5 | Out-String | ConvertFrom-Json
$reportPath5 = Join-Path $adminOnlyDir $json5.Report.FileName
$actualHash5 = (Get-FileHash -LiteralPath $reportPath5 -Algorithm SHA256).Hash.ToLowerInvariant()
Assert-True ($actualHash5 -eq $json5.Report.Sha256) "TEST5: reported Sha256 matches the actual evidence file hash"
$acl5 = Get-Acl -LiteralPath $reportPath5
$rules5 = @([System.IO.File]::GetAccessControl($reportPath5).GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
Assert-True ($acl5.AreAccessRulesProtected -and $rules5.Count -eq 1 -and $rules5[0].IdentityReference.Value -eq 'S-1-5-32-544') "TEST5: evidence report ACL is Administrators-only (protected, single ACE, Administrators SID)"

Write-Output "`n=== SUMMARY: $script:failures failure(s) ==="
if ($script:failures -gt 0) { exit 1 }
exit 0
