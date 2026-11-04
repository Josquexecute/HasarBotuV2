#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding()]
param([string]$RuntimeDirectory, [string]$CandidateDirectory='C:\HB0191\candidate-ready-20261104\services\api', [string]$WinSwXml, [switch]$RestoreAdmin, [string]$RestoreEvidencePath, [string]$RestoreEvidenceSha256, [switch]$Apply, [switch]$Rollback)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$StateDirectory = 'C:\ProgramData\HasarBotu\transition-manager-0191'
$stage = 'package_integrity'; $lock = $null; $credential = $null
try {
    if ($Apply -and $Rollback) { throw 'TRANSITION_MODE_CONFLICT' }
    if (($RestoreAdmin -and ($RestoreEvidencePath -or $RestoreEvidenceSha256)) -or ([bool]$RestoreEvidencePath -ne [bool]$RestoreEvidenceSha256)) { throw 'RESTORE_MODE_CONFLICT' }
    # Verify modules before importing any code from the delivery package.
    $manifest = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'manager-manifest.json')) | ConvertFrom-Json
    foreach ($entry in $manifest.files) {
        $path = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot $entry.path))
        if (-not $path.StartsWith($PSScriptRoot+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'MANAGER_MANIFEST_INVALID' }
        if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ine $entry.sha256 -or (Get-Item -LiteralPath $path).Length -ne $entry.size) { throw 'MANAGER_PACKAGE_HASH_MISMATCH' }
    }
    if ([Environment]::MachineName -ine 'DESKTOP-EFN2G33') { throw 'OFFICE_SERVER_REQUIRED' }
    Import-Module (Join-Path $PSScriptRoot 'api-transition-secrets.psm1') -Force -DisableNameChecking
    Import-Module (Join-Path $PSScriptRoot 'api-transition-manager.psm1') -Force -DisableNameChecking
    Assert-TransitionPath $PSScriptRoot
    $stage = 'operator_state'
    $parent = Split-Path $StateDirectory -Parent
    Assert-TransitionPath $parent
    [IO.Directory]::CreateDirectory($StateDirectory) | Out-Null
    Assert-TransitionPath $StateDirectory
    Protect-ApiTransitionPath $StateDirectory ''
    $lock = [IO.File]::Open((Join-Path $StateDirectory 'operator.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    $activePath = Join-Path $StateDirectory 'active.json'
    if (Test-Path -LiteralPath $activePath) {
        $active = [IO.File]::ReadAllText($activePath) | ConvertFrom-Json
        Assert-Transition ($active.host -ieq [Environment]::MachineName -and $active.backup.StartsWith($StateDirectory+'\run-',[StringComparison]::OrdinalIgnoreCase)) 'RECEIPT_TARGET_MISMATCH'
        Write-Host 'ONCEKI_ISLEM_KAYDI_BULUNDU'
        if ($active.status -notin @('ROLLED_BACK_PILOT_PENDING','ABORTED_ORIGINAL_API_RUNNING')) {
            Assert-Transition ([bool]$Rollback) 'RECOVERY_REQUIRES_EXPLICIT_ROLLBACK'
            $context = Get-TransitionRollbackContext $active $WinSwXml
            $expected = 'GERI 0.1.90 '+$active.id
            Write-Host ('Kayitli yedekle geri donmek icin yazin: '+$expected+'; bos = dur')
            Assert-TransitionApproval (Read-Host 'Ayri rollback onayi') $expected
            $stage = 'rollback'
            if ($active.snapshotReady) { Restore-TransitionRuntime $context $active }
            else {
                Assert-Transition ((Get-TransitionHash $context.Xml) -eq $active.xmlHash -and (Get-TransitionTreeHash $context.Api) -eq $active.runtimeHash) 'NO_VERIFIED_ROLLBACK_BACKUP'
                Start-Service hasarbotu-api
                (Get-Service hasarbotu-api).WaitForStatus('Running',[TimeSpan]::FromSeconds(45))
                Wait-TransitionHealth $context $false
                $active.status = 'ABORTED_ORIGINAL_API_RUNNING'
            }
            Write-TransitionJson $activePath $active
            Write-Host $active.status
            exit 0
        }
    }
    Assert-Transition (-not $Rollback) 'NO_ACTIVE_TRANSITION_TO_ROLLBACK'
    $stage = 'service_discovery'
    $context = Get-TransitionContext $RuntimeDirectory $CandidateDirectory $StateDirectory $WinSwXml
    if ($RestoreAdmin) { $stage='restore_admin_input'; $credential=Read-TransitionRestoreCredential }
    $context.RestoreAdminCredential = $credential
    if ($RestoreEvidencePath) { $context.RestoreEvidence = @{path=$RestoreEvidencePath;sha256=$RestoreEvidenceSha256} }
    $stage = 'read_only_preflight'
    Invoke-TransitionSession $context $StateDirectory -Apply:$Apply
} catch {
    $code = 'TRANSITION_UNEXPECTED_FAILURE'
    if ($_.Exception.Data.Contains('SafeCode')) { $code = [string]$_.Exception.Data['SafeCode'] }
    elseif ($_.Exception.Message -in @('OFFICE_SERVER_REQUIRED','MANAGER_MANIFEST_INVALID','MANAGER_PACKAGE_HASH_MISMATCH','TRANSITION_MODE_CONFLICT','RESTORE_MODE_CONFLICT')) { $code = $_.Exception.Message }
    if (Get-Command Get-TransitionDiagnostic -ErrorAction SilentlyContinue) {
        $safe = Get-TransitionDiagnostic $_ $stage $code
        Write-Host ('STOP stage='+$safe.stage+' code='+$safe.code+' kind='+$safe.kind+' line='+$safe.line)
    } else { Write-Host ('STOP stage='+$stage+' code='+$code) }
    Write-Host 'Uretim kabul sonucu PASS sayilmadi. Gizli hata ayrintilari yazdirilmadi.'
    exit 1
} finally { if ($lock) { $lock.Dispose() }; if ($credential) { $credential.Password.Dispose() } }
