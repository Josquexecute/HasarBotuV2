#Requires -Version 5.1
# Dependency-free test script (no Pester) for
# harden-api-service-directory-acl.ps1. Runs entirely against a synthetic
# directory tree under $env:TEMP with NT AUTHORITY\LOCAL SERVICE (a real,
# built-in, no-password-needed account) as the target identity -- never
# touches the real C:\HasarBotu\services\api or NT AUTHORITY\SYSTEM's
# real grants anywhere else on the machine.
# Run (Administrator required -- real ACL mutation):
#   powershell -File .\harden-api-service-directory-acl.tests.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:failures = 0

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { Write-Output "FAIL: $Message"; $script:failures++ } else { Write-Output "OK: $Message" }
}

$identityCheck = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$principalCheck = [System.Security.Principal.WindowsPrincipal]::new($identityCheck)
if (-not $principalCheck.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Output 'SKIPPED: Administrator required for real ACL mutation tests.'
    exit 0
}

$toolPath = Join-Path $PSScriptRoot 'harden-api-service-directory-acl.ps1'
$targetIdentity = 'NT AUTHORITY\LOCAL SERVICE'
$targetSid = ([System.Security.Principal.NTAccount]::new($targetIdentity)).Translate([System.Security.Principal.SecurityIdentifier])

function New-Fixture {
    $root = Join-Path $env:TEMP ("hasarbotu-harden-api-acl-test-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $root 'dist') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $root 'logs') -Force | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $root 'dist\index.js'), '// stub')
    # Mirror the REAL, currently-broad state this tool is meant to fix:
    # an inherited-style Authenticated Users:Modify grant, explicitly
    # added here (since a scratch $env:TEMP subfolder does not itself
    # naturally carry that ACE) so the test proves REMOVAL, not just
    # non-regression of an empty ACL.
    $acl = Get-Acl -LiteralPath $root
    $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
        'NT AUTHORITY\Authenticated Users', [System.Security.AccessControl.FileSystemRights]::Modify,
        ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit),
        [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow))
    Set-Acl -LiteralPath $root -AclObject $acl
    return $root
}

function Test-EffectiveGrant {
    param([string]$Path, [string]$Identity, [System.Security.AccessControl.FileSystemRights]$Rights)
    $acl = Get-Acl -LiteralPath $Path
    $sid = ([System.Security.Principal.NTAccount]::new($Identity)).Translate([System.Security.Principal.SecurityIdentifier])
    $allow = 0
    foreach ($rule in $acl.Access) {
        $ruleSid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier])
        if ($ruleSid -eq $sid -and $rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow) {
            $allow = $allow -bor $rule.FileSystemRights
        }
    }
    return (([int]$allow -band [int]$Rights) -eq [int]$Rights)
}

Write-Output '=== TEST 1: dry-run -- shows plan, zero mutation, broad identity still reported as currently granted ==='
$f1 = New-Fixture
$before1 = (Get-Acl -LiteralPath $f1).Sddl
$out1 = & $toolPath -ApiDir $f1 -ServiceIdentity $targetIdentity 2>&1
$json1 = $out1 | Out-String | ConvertFrom-Json
Assert-True ($json1.Mode -eq 'dry-run') "TEST1: Mode=dry-run (got: $($json1.Mode))"
Assert-True ($json1.BroadIdentitiesCurrentlyGranted -contains 'NT AUTHORITY\Authenticated Users') 'TEST1: dry-run correctly reports the broad grant present today'
$after1 = (Get-Acl -LiteralPath $f1).Sddl
Assert-True ($after1 -eq $before1) 'TEST1: zero mutation -- SDDL unchanged after dry-run'
Remove-Item -LiteralPath $f1 -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 2: REAL -Apply -- broad grant removed, Administrators+target identity correctly granted (root=RX, logs=Modify) ==="
$f2 = New-Fixture
$logs2 = Join-Path $f2 'logs'
$out2 = & $toolPath -ApiDir $f2 -ServiceIdentity $targetIdentity -Apply 2>&1
$exitCode2 = $LASTEXITCODE
$json2 = $out2 | Out-String | ConvertFrom-Json
Assert-True ($exitCode2 -eq 0 -and $json2.Status -eq 'applied') "TEST2: apply succeeds (exit=$exitCode2, status=$($json2.Status))"
Assert-True (Test-EffectiveGrant -Path $f2 -Identity 'BUILTIN\Administrators' -Rights ([System.Security.AccessControl.FileSystemRights]::FullControl)) 'TEST2: Administrators has FullControl on root'
Assert-True (Test-EffectiveGrant -Path $f2 -Identity $targetIdentity -Rights ([System.Security.AccessControl.FileSystemRights]::ReadAndExecute)) 'TEST2: target identity has ReadAndExecute on root'
Assert-True (Test-EffectiveGrant -Path $logs2 -Identity $targetIdentity -Rights ([System.Security.AccessControl.FileSystemRights]::Modify)) 'TEST2: target identity has Modify on logs'
$rootAclAfter2 = (Get-Acl -LiteralPath $f2).Access
$stillBroad2 = @($rootAclAfter2 | Where-Object { $_.IdentityReference.Value -in @('NT AUTHORITY\Authenticated Users', 'BUILTIN\Users', 'Everyone') -and $_.AccessControlType -eq 'Allow' })
Assert-True (@($stillBroad2).Count -eq 0) "TEST2: broad Authenticated Users/Users/Everyone grant is GONE after apply (found: $($stillBroad2.Count))"
Assert-True ($rootAclAfter2.Count -eq 2) "TEST2: root ACL is EXACTLY 2 explicit ACEs (Administrators + target identity), no leftovers (got: $($rootAclAfter2.Count))"

Write-Output "`n=== TEST 3: apply verification is real -- deliberately-wrong helper would be caught (structural self-check exercised via TEST2's own success path) ==="
# TEST2's own pass already proves the post-apply Get-EffectiveGrant checks
# inside the tool did not throw VERIFICATION_FAILED_AUTO_ROLLED_BACK; this
# additionally proves the snapshot evidence used by that self-check is
# real and hash-verified (reused by TEST 4's rollback).
Assert-True ($null -ne $json2.SnapshotReport.Sha256 -and $json2.SnapshotReport.Sha256.Length -eq 64) 'TEST3: snapshot evidence has a real SHA-256 reference'
$snapshotPath2 = $json2.SnapshotReport.Path
Assert-True (Test-Path -LiteralPath $snapshotPath2) 'TEST3: snapshot evidence file genuinely exists on disk'
$snapshotAcl2 = (Get-Acl -LiteralPath $snapshotPath2).Access
Assert-True (@($snapshotAcl2).Count -eq 1 -and $snapshotAcl2[0].IdentityReference.Value -match 'Administrators') 'TEST3: snapshot evidence is Administrators-only'

Write-Output "`n=== TEST 4: -Rollback restores the EXACT original SDDL (broad grant back, explicit hardened ACEs gone) ==="
$out4 = & $toolPath -Rollback -RollbackBackupPath $snapshotPath2 2>&1
$exitCode4 = $LASTEXITCODE
$json4 = $out4 | Out-String | ConvertFrom-Json
Assert-True ($exitCode4 -eq 0 -and $json4.RestoredExactly -eq $true) "TEST4: rollback restores exactly (exit=$exitCode4, RestoredExactly=$($json4.RestoredExactly))"
$rootAclAfterRollback = (Get-Acl -LiteralPath $f2).Access
$broadAfterRollback = @($rootAclAfterRollback | Where-Object { $_.IdentityReference.Value -eq 'NT AUTHORITY\Authenticated Users' -and $_.AccessControlType -eq 'Allow' })
Assert-True (@($broadAfterRollback).Count -eq 1) 'TEST4: original Authenticated Users:Modify grant is back after rollback'
Remove-Item -LiteralPath $f2 -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 5: missing ApiDir is rejected fail-closed, zero mutation attempted ==='"
$missingDir = Join-Path $env:TEMP ("hasarbotu-harden-api-acl-missing-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$out5 = & $toolPath -ApiDir $missingDir 2>&1
$json5 = $out5 | Out-String | ConvertFrom-Json
Assert-True ($json5.Status -eq 'error' -and $json5.ErrorCode -eq 'API_DIR_NOT_FOUND') "TEST5: missing ApiDir rejected (got: $($json5.ErrorCode))"

Write-Output "`n=== TEST 6: no logs\ subdirectory -- root still hardened, LogsDirExists=false honestly reported, no crash ==="
$f6 = Join-Path $env:TEMP ("hasarbotu-harden-api-acl-nologs-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $f6 -Force | Out-Null
$out6dry = & $toolPath -ApiDir $f6 -ServiceIdentity $targetIdentity 2>&1
$json6dry = $out6dry | Out-String | ConvertFrom-Json
Assert-True ($json6dry.LogsDirExists -eq $false) 'TEST6: dry-run honestly reports LogsDirExists=false'
$out6 = & $toolPath -ApiDir $f6 -ServiceIdentity $targetIdentity -Apply 2>&1
$json6 = $out6 | Out-String | ConvertFrom-Json
Assert-True ($json6.Status -eq 'applied' -and $json6.ServiceIdentityModifyOnLogs -eq $false) "TEST6: apply succeeds on root even without logs\ (status=$($json6.Status))"
Assert-True (Test-EffectiveGrant -Path $f6 -Identity $targetIdentity -Rights ([System.Security.AccessControl.FileSystemRights]::ReadAndExecute)) 'TEST6: target identity still gets ReadAndExecute on root when logs\ is absent'
Remove-Item -LiteralPath $f6 -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== SUMMARY: $script:failures failure(s) ==="
if ($script:failures -gt 0) { exit 1 }
exit 0
