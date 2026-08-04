#Requires -Version 5.1
# Dependency-free test script (no Pester) for provision-extra-data-references.ps1
# (D9 B8 fix, HB-2026-145). Builds synthetic scratch directories under
# $env:TEMP; never touches real HasarBotu deploy paths. Run:
#   powershell -File .\provision-extra-data-references.tests.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
} catch {}

$script:failures = 0
function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { Write-Output "FAIL: $Message"; $script:failures++ } else { Write-Output "OK: $Message" }
}

$scriptPath = Join-Path $PSScriptRoot 'provision-extra-data-references.ps1'
$realSnapshotPath = Join-Path $PSScriptRoot '..\..\reference-data\value-loss\real-market-analysis\2026-07-01\1.0.0\snapshot.json'

function New-ProvisionFixture {
    param([bool]$WithValidSnapshot = $true, [bool]$WithSourceDataDir = $true)
    # Iki AYRI kok kullanilir (gercek RepoRoot vs gercek ServiceTargetDir'in
    # FARKLI fiziksel agaclar olmasi gibi -- C:\...\HasarBotuV2\ vs
    # C:\HasarBotu\) -- boylece hesaplanan hedef, kaynakla YANLISLIKLA
    # AYNI yola COKMEZ.
    $repoRoot = Join-Path $env:TEMP ("hasarbotu-provision-test-repo-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    $deployRoot = Join-Path $env:TEMP ("hasarbotu-provision-test-deploy-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    $sourceDataDir = Join-Path $repoRoot 'extra-data\sub\v1'
    if ($WithSourceDataDir) {
        New-Item -ItemType Directory -Path $sourceDataDir -Force | Out-Null
        if ($WithValidSnapshot) {
            Copy-Item -LiteralPath $realSnapshotPath -Destination (Join-Path $sourceDataDir 'snapshot.json')
        }
        else {
            [System.IO.File]::WriteAllText((Join-Path $sourceDataDir 'snapshot.json'), '{"identity":"wrong/identity/9.9.9","tampered":true}')
        }
        [System.IO.File]::WriteAllText((Join-Path $sourceDataDir 'sibling.json'), '{"note":"generic sha256 manifest coverage only, no identity constant"}')
    }
    else {
        New-Item -ItemType Directory -Path $repoRoot -Force | Out-Null
    }

    # ServiceTargetDir GERCEK convention'i yansitir (C:\HasarBotu\services\api
    # gibi -- servis dizininin ebeveyni "services", ONUN ebeveyni deploy koku).
    # Boylece TEST 12'nin "servis dagitim koku yok" senaryosu icin
    # "services\" alt dizinini silmek, kapanis manifestini (deployRoot'ta
    # duran) ETKILEMEZ.
    $serviceTargetDir = Join-Path $deployRoot 'services\service-target'
    New-Item -ItemType Directory -Path (Join-Path $serviceTargetDir 'dist') -Force | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $serviceTargetDir 'dist\some-module.js'), '// referencing module placeholder')

    $closureObject = [ordered]@{
        SchemaVersion = 'hasarbotu-runtime-dependency-closure/1.0.0'
        Status = 'ok'
        Workspace = 'services/fake'
        WorkspaceInternal = @()
        External = @()
        SkippedIncompatibleOptional = @()
        ExtraDataReferences = @(
            [ordered]@{
                distRelativePath = 'dist/some-module.js'
                literal = '../../../extra-data/sub/v1/snapshot.json'
                resolvedRepoRelativePath = 'extra-data/sub/v1/snapshot.json'
            }
        )
    }
    $closureManifestPath = Join-Path $deployRoot 'fake-closure.json'
    [System.IO.File]::WriteAllText($closureManifestPath, ($closureObject | ConvertTo-Json -Depth 8), [System.Text.UTF8Encoding]::new($false))

    return [pscustomobject]@{
        RepoRoot = $repoRoot
        DeployRoot = $deployRoot
        ClosureManifestPath = $closureManifestPath
        ServiceTargetDir = $serviceTargetDir
        SourceDataDir = $sourceDataDir
        ExpectedTargetDir = Join-Path $deployRoot 'extra-data\sub\v1'
    }
}

function New-EmptyReferencesClosureFixture {
    $deployRoot = Join-Path $env:TEMP ("hasarbotu-provision-test-empty-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $deployRoot -Force | Out-Null
    $closureObject = [ordered]@{
        SchemaVersion = 'hasarbotu-runtime-dependency-closure/1.0.0'
        Status = 'ok'
        Workspace = 'services/fake-empty'
        WorkspaceInternal = @()
        External = @()
        SkippedIncompatibleOptional = @()
        ExtraDataReferences = @()
    }
    $closureManifestPath = Join-Path $deployRoot 'empty-closure.json'
    [System.IO.File]::WriteAllText($closureManifestPath, ($closureObject | ConvertTo-Json -Depth 8), [System.Text.UTF8Encoding]::new($false))
    return [pscustomobject]@{ DeployRoot = $deployRoot; ClosureManifestPath = $closureManifestPath }
}

function New-MultiGroupClosureFixture {
    # Iki farkli ExtraDataReferences girdisi, iki farkli hedef koke cozulur
    # (bugun gercekte olmayan ama betigin fail-closed reddetmesi gereken
    # bir durum).
    $repoRoot = Join-Path $env:TEMP ("hasarbotu-provision-test-multi-repo-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    $deployRoot = Join-Path $env:TEMP ("hasarbotu-provision-test-multi-deploy-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path (Join-Path $repoRoot 'group-a') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $repoRoot 'group-b') -Force | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $repoRoot 'group-a\file-a.json'), '{}')
    [System.IO.File]::WriteAllText((Join-Path $repoRoot 'group-b\file-b.json'), '{}')
    $serviceTargetDir = Join-Path $deployRoot 'service-target'
    New-Item -ItemType Directory -Path (Join-Path $serviceTargetDir 'dist') -Force | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $serviceTargetDir 'dist\module-a.js'), '// a')
    [System.IO.File]::WriteAllText((Join-Path $serviceTargetDir 'dist\module-b.js'), '// b')
    $closureObject = [ordered]@{
        SchemaVersion = 'hasarbotu-runtime-dependency-closure/1.0.0'
        Status = 'ok'
        Workspace = 'services/fake-multi'
        WorkspaceInternal = @()
        External = @()
        SkippedIncompatibleOptional = @()
        ExtraDataReferences = @(
            [ordered]@{ distRelativePath = 'dist/module-a.js'; literal = '../../group-a/file-a.json'; resolvedRepoRelativePath = 'group-a/file-a.json' }
            [ordered]@{ distRelativePath = 'dist/module-b.js'; literal = '../../group-b/file-b.json'; resolvedRepoRelativePath = 'group-b/file-b.json' }
        )
    }
    $closureManifestPath = Join-Path $deployRoot 'multi-closure.json'
    [System.IO.File]::WriteAllText($closureManifestPath, ($closureObject | ConvertTo-Json -Depth 8), [System.Text.UTF8Encoding]::new($false))
    return [pscustomobject]@{ RepoRoot = $repoRoot; DeployRoot = $deployRoot; ClosureManifestPath = $closureManifestPath; ServiceTargetDir = $serviceTargetDir }
}

function Invoke-ProvisionJson {
    # HASHTABLE splat (bkz. deploy-service-artifacts.tests.ps1 -- bu ortamda
    # array splat isimli parametreleri POZISYONEL bagliyor).
    param([hashtable]$Params)
    $out = & $scriptPath @Params
    $exitCode = $LASTEXITCODE
    return [pscustomobject]@{ Json = ($out | ConvertFrom-Json); ExitCode = $exitCode }
}

function Remove-FixtureTree {
    param($Fixture)
    foreach ($propertyName in @('RepoRoot', 'DeployRoot')) {
        $prop = $Fixture.PSObject.Properties[$propertyName]
        if ($null -ne $prop -and (Test-Path $prop.Value)) {
            Remove-Item $prop.Value -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

Write-Output '=== TEST 1: Onizleme (-Apply yok), gecerli kapanis+snapshot -- would_apply, kimlik dogrulamasi GECER ==='
$f1 = New-ProvisionFixture
$r1 = Invoke-ProvisionJson -Params @{ RepoRoot = $f1.RepoRoot; DependencyClosureManifestPath = $f1.ClosureManifestPath; ServiceTargetDir = $f1.ServiceTargetDir; DataLabel = 'test1' }
Assert-True ($r1.ExitCode -eq 0) 'Exit code 0'
Assert-True ($r1.Json.Status -eq 'would_apply') 'Status would_apply'
Assert-True ($r1.Json.SourceFileCount -eq 2) 'Kaynak dosya sayisi TAM 2 (snapshot.json + sibling.json)'
Assert-True ($r1.Json.IdentityVerifiedFileCount -eq 1) 'Kimlik dogrulamasi TAM 1 dosyada (snapshot.json) calisti'
Assert-True (-not (Test-Path $f1.ExpectedTargetDir)) 'Onizlemede hedef dizin OLUSTURULMADI'
Remove-FixtureTree $f1

Write-Output "`n=== TEST 2: kaynak veri dizini yoksa BLOCKED ==="
$f2 = New-ProvisionFixture -WithSourceDataDir $false
$r2 = Invoke-ProvisionJson -Params @{ RepoRoot = $f2.RepoRoot; DependencyClosureManifestPath = $f2.ClosureManifestPath; ServiceTargetDir = $f2.ServiceTargetDir; DataLabel = 'test2' }
Assert-True ($r2.ExitCode -eq 2) 'Exit code 2 (blocked)'
Assert-True ((@($r2.Json.Blockers) -match 'Kaynak veri dizini yok').Count -gt 0) 'Kaynak veri dizini eksikligi dogru raporlandi'
Remove-FixtureTree $f2

Write-Output "`n=== TEST 3: yanlis/tahrif edilmis identity SNAPSHOT_IDENTITY_MISMATCH ile BLOCKED (uygulama koduna gore GECERSIZ surum) ==="
$f3 = New-ProvisionFixture -WithValidSnapshot $false
$r3 = Invoke-ProvisionJson -Params @{ RepoRoot = $f3.RepoRoot; DependencyClosureManifestPath = $f3.ClosureManifestPath; ServiceTargetDir = $f3.ServiceTargetDir; DataLabel = 'test3' }
Assert-True ($r3.ExitCode -eq 2) 'Exit code 2 (blocked)'
Assert-True ((@($r3.Json.Blockers) -match 'Kimlik/sürüm doğrulaması BAŞARISIZ').Count -gt 0) 'Kimlik dogrulamasi basarisizligi dogru raporlandi'
Assert-True ((@($r3.Json.Blockers) -match 'SNAPSHOT_IDENTITY_MISMATCH').Count -gt 0) 'Dogru hata kodu (SNAPSHOT_IDENTITY_MISMATCH) raporlandi'
Remove-FixtureTree $f3

Write-Output "`n=== TEST 4: kapanista ExtraDataReferences BOSSA nothing_to_provision (dosya-agent gibi) ==="
$f4 = New-EmptyReferencesClosureFixture
$r4 = Invoke-ProvisionJson -Params @{ RepoRoot = $f4.DeployRoot; DependencyClosureManifestPath = $f4.ClosureManifestPath; ServiceTargetDir = (Join-Path $f4.DeployRoot 'irrelevant'); DataLabel = 'test4' }
Assert-True ($r4.ExitCode -eq 0) 'Exit code 0'
Assert-True ($r4.Json.Status -eq 'nothing_to_provision') 'Status nothing_to_provision'
Remove-FixtureTree $f4

Write-Output "`n=== TEST 5: birden fazla FARKLI hedef kok grubu bulunursa BLOCKED (henuz desteklenmiyor) ==="
$f5 = New-MultiGroupClosureFixture
$r5 = Invoke-ProvisionJson -Params @{ RepoRoot = $f5.RepoRoot; DependencyClosureManifestPath = $f5.ClosureManifestPath; ServiceTargetDir = $f5.ServiceTargetDir; DataLabel = 'test5' }
Assert-True ($r5.ExitCode -eq 2) 'Exit code 2 (blocked)'
Assert-True ((@($r5.Json.Blockers) -match 'farklı ek veri kök dizini bulundu').Count -gt 0) 'Coklu-grup destegi eksikligi dogru raporlandi'
Remove-FixtureTree $f5

Write-Output "`n=== TEST 6: -Apply ile gercek saglama basarili, dogru hedef konumuna, allowlist DISINDAKI hicbir sey kopyalanmadan ==="
$f6 = New-ProvisionFixture
$r6 = Invoke-ProvisionJson -Params @{ RepoRoot = $f6.RepoRoot; DependencyClosureManifestPath = $f6.ClosureManifestPath; ServiceTargetDir = $f6.ServiceTargetDir; DataLabel = 'test6'; Apply = $true }
Assert-True ($r6.ExitCode -eq 0) 'Exit code 0'
Assert-True ($r6.Json.Status -eq 'applied') 'Status applied'
Assert-True (Test-Path (Join-Path $f6.ExpectedTargetDir 'snapshot.json')) 'snapshot.json GERCEKTEN hesaplanan hedef konumunda'
Assert-True (Test-Path (Join-Path $f6.ExpectedTargetDir 'sibling.json')) 'sibling.json GERCEKTEN hesaplanan hedef konumunda'
Assert-True ($r6.Json.PostApplyVerificationMismatches.Count -eq 0) 'Bagimsiz dogrulama sifir uyumsuzluk buldu'
Assert-True ($null -eq $r6.Json.BackupPath) 'Ilk saglamada BackupPath null (yedeklenecek onceki icerik yok)'
$targetSnapshotHash = (Get-FileHash -LiteralPath (Join-Path $f6.ExpectedTargetDir 'snapshot.json') -Algorithm SHA256).Hash.ToLowerInvariant()
$sourceSnapshotHash = (Get-FileHash -LiteralPath (Join-Path $f6.SourceDataDir 'snapshot.json') -Algorithm SHA256).Hash.ToLowerInvariant()
Assert-True ($targetSnapshotHash -eq $sourceSnapshotHash) 'Hedefteki snapshot.json icerigi kaynakla BIREBIR ayni'

Write-Output "`n=== TEST 7: ayni kaynakla tekrar -Apply -- idempotent, already_up_to_date, yeniden yazma yok ==="
$targetBefore = (Get-Item (Join-Path $f6.ExpectedTargetDir 'snapshot.json')).LastWriteTimeUtc
Start-Sleep -Milliseconds 50
$r7 = Invoke-ProvisionJson -Params @{ RepoRoot = $f6.RepoRoot; DependencyClosureManifestPath = $f6.ClosureManifestPath; ServiceTargetDir = $f6.ServiceTargetDir; DataLabel = 'test6'; Apply = $true }
Assert-True ($r7.ExitCode -eq 0) 'Exit code 0'
Assert-True ($r7.Json.Status -eq 'already_up_to_date') 'Status already_up_to_date'
$targetAfter = (Get-Item (Join-Path $f6.ExpectedTargetDir 'snapshot.json')).LastWriteTimeUtc
Assert-True ($targetBefore -eq $targetAfter) 'Dosya YENIDEN yazilmadi (mtime degismedi -- gercekten idempotent)'

Write-Output "`n=== TEST 8: kaynak degisince -Apply -- ESKI icerik ADMIN-ONLY, ZAMAN DAMGALI yedege TASINIR, yeni icerik saglanir ==="
[System.IO.File]::WriteAllText((Join-Path $f6.SourceDataDir 'sibling.json'), '{"note":"changed content, version 2"}')
$oldSiblingSha256 = (Get-FileHash -LiteralPath (Join-Path $f6.ExpectedTargetDir 'sibling.json') -Algorithm SHA256).Hash.ToLowerInvariant()
$r8 = Invoke-ProvisionJson -Params @{ RepoRoot = $f6.RepoRoot; DependencyClosureManifestPath = $f6.ClosureManifestPath; ServiceTargetDir = $f6.ServiceTargetDir; DataLabel = 'test6'; Apply = $true }
Assert-True ($r8.ExitCode -eq 0) 'Exit code 0'
Assert-True ($r8.Json.Status -eq 'applied') 'Status applied (degisiklik gercekten uygulandi)'
Assert-True ($null -ne $r8.Json.BackupPath) 'BackupPath doldu'
Assert-True (Test-Path $r8.Json.BackupPath) 'Yedek dizini gercekten var'
Assert-True (Test-Path $r8.Json.BackupManifestPath) 'Yedek manifest dosyasi gercekten var'
$backupSiblingSha256 = (Get-FileHash -LiteralPath (Join-Path $r8.Json.BackupPath 'sibling.json') -Algorithm SHA256).Hash.ToLowerInvariant()
Assert-True ($backupSiblingSha256 -eq $oldSiblingSha256) 'Yedeklenen dosya ESKI icerigi BIREBIR koruyor'
$newTargetSiblingSha256 = (Get-FileHash -LiteralPath (Join-Path $f6.ExpectedTargetDir 'sibling.json') -Algorithm SHA256).Hash.ToLowerInvariant()
Assert-True ($newTargetSiblingSha256 -ne $oldSiblingSha256) 'Hedef artik YENI icerigi tasiyor'
$backupAcl = Get-Acl -LiteralPath $r8.Json.BackupPath
Assert-True ($backupAcl.AreAccessRulesProtected) 'Yedek dizini ACL korumali (miras kesilmis)'
Assert-True (@($backupAcl.Access | Where-Object { $_.IdentityReference -match 'Administrators' }).Count -gt 0) 'Yedek dizini Administrators ACE tasiyor'

Write-Output "`n=== TEST 9: rollback onizlemesi (-Apply yok) -- would_rollback, hicbir sey degismez ==="
$backupPathForRollback = $r8.Json.BackupPath
$r9out = & $scriptPath -DataLabel 'test6' -ServiceTargetDir $f6.ExpectedTargetDir -Rollback -RollbackBackupPath $backupPathForRollback
$r9 = $r9out | ConvertFrom-Json
Assert-True ($LASTEXITCODE -eq 0) 'Rollback onizleme exit 0'
Assert-True ($r9.Status -eq 'would_rollback') 'Status would_rollback'
Assert-True ((Get-FileHash -LiteralPath (Join-Path $f6.ExpectedTargetDir 'sibling.json') -Algorithm SHA256).Hash.ToLowerInvariant() -eq $newTargetSiblingSha256) 'Onizlemede hedef HALA yeni icerikte (degismedi)'

Write-Output "`n=== TEST 10: gercek rollback (-Apply) -- eski icerik geri gelir, guncel icerik pre-rollback yedegine tasinir ==="
$r10out = & $scriptPath -DataLabel 'test6' -ServiceTargetDir $f6.ExpectedTargetDir -Rollback -RollbackBackupPath $backupPathForRollback -Apply
$r10 = $r10out | ConvertFrom-Json
Assert-True ($LASTEXITCODE -eq 0) 'Gercek rollback exit 0'
Assert-True ($r10.Status -eq 'rolled_back') 'Status rolled_back'
$restoredSha256 = (Get-FileHash -LiteralPath (Join-Path $f6.ExpectedTargetDir 'sibling.json') -Algorithm SHA256).Hash.ToLowerInvariant()
Assert-True ($restoredSha256 -eq $oldSiblingSha256) 'Rollback sonrasi hedef ESKI (rollback edilen) icerige birebir esit'
Assert-True ($null -ne $r10.PreRollbackBackupPath -and (Test-Path $r10.PreRollbackBackupPath)) 'Rollback ONCESI guncel icerik de AYRICA yedeklendi (hicbir veri kaybolmadi)'
$preRollbackSha256 = (Get-FileHash -LiteralPath (Join-Path $r10.PreRollbackBackupPath 'sibling.json') -Algorithm SHA256).Hash.ToLowerInvariant()
Assert-True ($preRollbackSha256 -eq $newTargetSiblingSha256) 'Pre-rollback yedegi rollback ONCESI (yeni) icerigi koruyor'
Remove-FixtureTree $f6
if (Test-Path $f6.ExpectedTargetDir) { Remove-Item $f6.ExpectedTargetDir -Recurse -Force -ErrorAction SilentlyContinue }

Write-Output "`n=== TEST 11: hedef zaten (elle/paylasilan bir adimla) dogru icerikle sagliyorsa idempotent -- ilk calistirmada bile already_up_to_date ==="
$f11 = New-ProvisionFixture
New-Item -ItemType Directory -Path $f11.ExpectedTargetDir -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $f11.SourceDataDir 'snapshot.json') -Destination (Join-Path $f11.ExpectedTargetDir 'snapshot.json')
Copy-Item -LiteralPath (Join-Path $f11.SourceDataDir 'sibling.json') -Destination (Join-Path $f11.ExpectedTargetDir 'sibling.json')
$r11 = Invoke-ProvisionJson -Params @{ RepoRoot = $f11.RepoRoot; DependencyClosureManifestPath = $f11.ClosureManifestPath; ServiceTargetDir = $f11.ServiceTargetDir; DataLabel = 'test11'; Apply = $true }
Assert-True ($r11.ExitCode -eq 0) 'Exit code 0'
Assert-True ($r11.Json.Status -eq 'already_up_to_date') 'Status already_up_to_date (elle saglanmis icerik taniniyor)'
Remove-FixtureTree $f11
if (Test-Path $f11.ExpectedTargetDir) { Remove-Item $f11.ExpectedTargetDir -Recurse -Force -ErrorAction SilentlyContinue }

Write-Output "`n=== TEST 12: servisin kendi dagitim koku (ServiceTargetDir'in ebeveyni) yoksa BLOCKED ==="
$f12 = New-ProvisionFixture
Remove-Item (Split-Path $f12.ServiceTargetDir -Parent) -Recurse -Force -ErrorAction SilentlyContinue
$r12 = Invoke-ProvisionJson -Params @{ RepoRoot = $f12.RepoRoot; DependencyClosureManifestPath = $f12.ClosureManifestPath; ServiceTargetDir = $f12.ServiceTargetDir; DataLabel = 'test12' }
Assert-True ($r12.ExitCode -eq 2) 'Exit code 2 (blocked)'
Assert-True ((@($r12.Json.Blockers) -match 'Servis dağıtım köküne ait üst dizin yok').Count -gt 0) 'Servis dagitim koku eksikligi dogru raporlandi'
Remove-FixtureTree $f12

Write-Output "`n=== SUMMARY: $($script:failures) failure(s) ==="
if ($script:failures -gt 0) { exit 1 } else { exit 0 }
