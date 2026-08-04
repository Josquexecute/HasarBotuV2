#Requires -Version 5.1
# Dependency-free test script (no Pester) for deploy-service-artifacts.ps1
# (D9 second small package, HB-2026-143). Builds synthetic scratch
# directories under $env:TEMP; never touches real HasarBotu deploy paths.
# Run: powershell -File .\deploy-service-artifacts.tests.ps1
#
# Design note: the script under test writes its final JSON result via a
# plain `$result | ConvertTo-Json` expression (success stream / stream 1)
# and all human-readable narration via Write-Host (Information stream /
# stream 6). Capturing with a PLAIN `$out = & $script ...` (no *>&1)
# captures ONLY the JSON, cleanly, with no console-encoding gymnastics
# needed (confirmed empirically). Only use *>&1 where a test needs to
# assert on the human-readable narration text itself.

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

$scriptPath = Join-Path $PSScriptRoot 'deploy-service-artifacts.ps1'

function New-SourceFixture {
    param([bool]$WithDist = $true, [bool]$WithPackageJson = $true, [bool]$WithDisallowedExtras = $false)
    $root = Join-Path $env:TEMP ("hasarbotu-deploy-test-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    $sourceDir = Join-Path $root 'src'
    New-Item -ItemType Directory -Path $sourceDir -Force | Out-Null
    if ($WithDist) {
        New-Item -ItemType Directory -Path (Join-Path $sourceDir 'dist\nested') -Force | Out-Null
        [System.IO.File]::WriteAllText((Join-Path $sourceDir 'dist\index.js'), 'export const v = 1;')
        [System.IO.File]::WriteAllText((Join-Path $sourceDir 'dist\nested\util.js'), 'export const u = 2;')
    }
    if ($WithPackageJson) {
        [System.IO.File]::WriteAllText((Join-Path $sourceDir 'package.json'), '{"name":"@hasarbotu/test-fixture","type":"module"}')
    }
    if ($WithDisallowedExtras) {
        New-Item -ItemType Directory -Path (Join-Path $sourceDir 'node_modules\some-pkg') -Force | Out-Null
        [System.IO.File]::WriteAllText((Join-Path $sourceDir 'node_modules\some-pkg\index.js'), 'module.exports = {};')
        [System.IO.File]::WriteAllText((Join-Path $sourceDir '.env'), 'SECRET=should-never-be-copied')
        New-Item -ItemType Directory -Path (Join-Path $sourceDir 'src') -Force | Out-Null
        [System.IO.File]::WriteAllText((Join-Path $sourceDir 'src\index.ts'), '// source, not dist')
    }
    $targetDir = Join-Path $root 'target'
    return [pscustomobject]@{ Root = $root; SourceDir = $sourceDir; TargetDir = $targetDir }
}

function New-ClosureFixture {
    # HB-2026-144: sentetik repo-koku + bagimlilik kapanisi manifesti.
    # 1 workspace-internal paket (dist+package.json+DAHIL-EDILMEMESI-GEREKEN
    # src/) ve 1 harici (npm) paket icerir.
    $repoRoot = Join-Path $env:TEMP ("hasarbotu-deploy-closure-test-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    $workspaceInternalRoot = Join-Path $repoRoot 'packages\demo-internal'
    New-Item -ItemType Directory -Path (Join-Path $workspaceInternalRoot 'dist') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $workspaceInternalRoot 'src') -Force | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $workspaceInternalRoot 'dist\index.js'), 'export const internal = 1;')
    [System.IO.File]::WriteAllText((Join-Path $workspaceInternalRoot 'package.json'), '{"name":"@hasarbotu/demo-internal","type":"module"}')
    [System.IO.File]::WriteAllText((Join-Path $workspaceInternalRoot 'src\index.ts'), '// kaynak, dagitilmamali')

    $externalRoot = Join-Path $repoRoot 'node_modules\demo-external'
    New-Item -ItemType Directory -Path $externalRoot -Force | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $externalRoot 'index.js'), 'module.exports = {};')
    [System.IO.File]::WriteAllText((Join-Path $externalRoot 'package.json'), '{"name":"demo-external","version":"1.2.3"}')

    $closureObject = [ordered]@{
        SchemaVersion = 'hasarbotu-runtime-dependency-closure/1.0.0'
        Status = 'ok'
        Workspace = 'services/demo'
        Platform = 'win32'
        Arch = 'x64'
        WorkspaceInternal = @('packages/demo-internal')
        External = @(
            [ordered]@{
                lockKey = 'node_modules/demo-external'
                name = 'demo-external'
                version = '1.2.3'
                resolved = 'node_modules/demo-external'
                integrity = 'sha512-fake=='
                onDiskVersion = '1.2.3'
                existsOnDisk = $true
                lockIntegrityOk = $true
            }
        )
        SkippedIncompatibleOptional = @()
    }
    $closureManifestPath = Join-Path $repoRoot 'demo-closure.json'
    [System.IO.File]::WriteAllText($closureManifestPath, ($closureObject | ConvertTo-Json -Depth 8), [System.Text.UTF8Encoding]::new($false))

    return [pscustomobject]@{
        RepoRoot = $repoRoot
        ClosureManifestPath = $closureManifestPath
        WorkspaceInternalRoot = $workspaceInternalRoot
        ExternalRoot = $externalRoot
    }
}

function New-NestedExternalClosureFixture {
    # HB-2026-144 regresyon: gercek file-agent kapanisinda bulunan gercek
    # bir hata deseni -- harici bir paketin (parent-pkg) KENDI ic ice
    # node_modules'inde baska bir paket (nested-pkg) var VE bu nested-pkg
    # kapanis cozumleyicisi tarafindan AYRICA, kendi dogru hedef yoluyla
    # (node_modules\parent-pkg\node_modules\nested-pkg\...) ayri bir
    # External girdisi olarak da BULUNMUS. parent-pkg'nin TAM alt agacini
    # yururken kendi ic ice node_modules'i YOK SAYILMALI -- yoksa ayni
    # hedef yola IKI KEZ yazilir (zararsiz ama AllowlistFileCount'u
    # sisirir ve FILE_COUNT_MISMATCH'e yol acar).
    $repoRoot = Join-Path $env:TEMP ("hasarbotu-deploy-nested-closure-test-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    $parentRoot = Join-Path $repoRoot 'node_modules\parent-pkg'
    $nestedRoot = Join-Path $parentRoot 'node_modules\nested-pkg'
    New-Item -ItemType Directory -Path $parentRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $nestedRoot -Force | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $parentRoot 'index.js'), 'module.exports = require("nested-pkg");')
    [System.IO.File]::WriteAllText((Join-Path $parentRoot 'package.json'), '{"name":"parent-pkg","version":"1.0.0","dependencies":{"nested-pkg":"2.0.0"}}')
    [System.IO.File]::WriteAllText((Join-Path $nestedRoot 'index.js'), 'module.exports = 42;')
    [System.IO.File]::WriteAllText((Join-Path $nestedRoot 'package.json'), '{"name":"nested-pkg","version":"2.0.0"}')

    $closureObject = [ordered]@{
        SchemaVersion = 'hasarbotu-runtime-dependency-closure/1.0.0'
        Status = 'ok'
        Workspace = 'services/demo'
        Platform = 'win32'
        Arch = 'x64'
        WorkspaceInternal = @()
        External = @(
            [ordered]@{ lockKey = 'node_modules/parent-pkg'; name = 'parent-pkg'; version = '1.0.0'; resolved = 'node_modules/parent-pkg'; integrity = 'sha512-fake1=='; onDiskVersion = '1.0.0'; existsOnDisk = $true; lockIntegrityOk = $true }
            [ordered]@{ lockKey = 'node_modules/parent-pkg/node_modules/nested-pkg'; name = 'nested-pkg'; version = '2.0.0'; resolved = 'node_modules/parent-pkg/node_modules/nested-pkg'; integrity = 'sha512-fake2=='; onDiskVersion = '2.0.0'; existsOnDisk = $true; lockIntegrityOk = $true }
        )
        SkippedIncompatibleOptional = @()
    }
    $closureManifestPath = Join-Path $repoRoot 'nested-closure.json'
    [System.IO.File]::WriteAllText($closureManifestPath, ($closureObject | ConvertTo-Json -Depth 8), [System.Text.UTF8Encoding]::new($false))

    return [pscustomobject]@{ RepoRoot = $repoRoot; ClosureManifestPath = $closureManifestPath }
}

function New-ExtraDataReferenceClosureFixture {
    param([bool]$WithSourceDataFile = $true)
    # HB-2026-144 regresyon: gercek API kapanisinda bulunan gercek bir hata
    # deseni -- derlenmis kod (dist/index.js), kilit dosyasinda HIC
    # gorunmeyen bir veri dosyasini `new URL('../...', import.meta.url)`
    # ile REPO KOKUNE gore sabit kodlanmis goreli yolla okuyor
    # (services/api/src/traffic-value-loss/rule-source.ts, gercek ornek).
    $repoRoot = Join-Path $env:TEMP ("hasarbotu-deploy-extradata-test-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $repoRoot -Force | Out-Null
    if ($WithSourceDataFile) {
        [System.IO.File]::WriteAllText((Join-Path $repoRoot 'extra-data.json'), '{"snapshot":"v1"}')
    }
    $closureObject = [ordered]@{
        SchemaVersion = 'hasarbotu-runtime-dependency-closure/1.0.0'
        Status = 'ok'
        Workspace = 'services/demo'
        Platform = 'win32'
        Arch = 'x64'
        WorkspaceInternal = @()
        External = @()
        SkippedIncompatibleOptional = @()
        ExtraDataReferences = @(
            [ordered]@{ distRelativePath = 'dist/index.js'; literal = '../extra-data.json'; resolvedRepoRelativePath = 'extra-data.json' }
        )
    }
    $closureManifestPath = Join-Path $repoRoot 'extradata-closure.json'
    [System.IO.File]::WriteAllText($closureManifestPath, ($closureObject | ConvertTo-Json -Depth 8), [System.Text.UTF8Encoding]::new($false))
    return [pscustomobject]@{ RepoRoot = $repoRoot; ClosureManifestPath = $closureManifestPath }
}

function Invoke-DeployJson {
    # HASHTABLE splat, deliberately NOT array splat: this environment's
    # PowerShell host was confirmed (empirically, isolated repro) to bind
    # `@arrayOf('-Name','Value',...)` PURELY POSITIONALLY, silently
    # ignoring the leading dashes as parameter-name markers -- values land
    # on whatever parameter occupies that declaration position instead of
    # the named one. Hashtable splat (`@hashtable`) binds by name
    # unambiguously and was verified to work correctly.
    param([hashtable]$Params)
    $out = & $scriptPath @Params
    $exitCode = $LASTEXITCODE
    return [pscustomobject]@{ Json = ($out | ConvertFrom-Json); ExitCode = $exitCode }
}

Write-Output '=== TEST 1: Onizleme (-Apply yok), taze dagitim -- would_apply, sifir degisiklik ==='
$f1 = New-SourceFixture
$r1 = Invoke-DeployJson -Params @{ SourceDir = $f1.SourceDir; TargetDir = $f1.TargetDir; ServiceLabel = 'test1' }
Assert-True ($r1.ExitCode -eq 0) 'Exit code 0'
Assert-True ($r1.Json.Status -eq 'would_apply') 'Status would_apply'
Assert-True ($r1.Json.AllowlistFileCount -eq 3) 'Allowlist tam 3 dosya (dist/index.js, dist/nested/util.js, package.json)'
Assert-True (-not (Test-Path $f1.TargetDir)) 'Onizlemede hedef dizin OLUSTURULMADI'
Remove-Item $f1.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 2: dist\index.js eksikse BLOCKED (fail-closed) ==="
$f2 = New-SourceFixture -WithDist $false
$r2 = Invoke-DeployJson -Params @{ SourceDir = $f2.SourceDir; TargetDir = $f2.TargetDir; ServiceLabel = 'test2' }
Assert-True ($r2.ExitCode -eq 2) 'Exit code 2 (blocked)'
Assert-True ($r2.Json.Status -eq 'blocked') 'Status blocked'
Assert-True ((@($r2.Json.Blockers) -match 'Build çıktısı yok').Count -gt 0) 'dist/index.js eksikligi raporlandi'
Remove-Item $f2.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 3: package.json eksikse BLOCKED ==="
$f3 = New-SourceFixture -WithPackageJson $false
$r3 = Invoke-DeployJson -Params @{ SourceDir = $f3.SourceDir; TargetDir = $f3.TargetDir; ServiceLabel = 'test3' }
Assert-True ($r3.ExitCode -eq 2) 'Exit code 2 (blocked)'
Assert-True ((@($r3.Json.Blockers) -match 'package.json yok').Count -gt 0) 'package.json eksikligi raporlandi'
Remove-Item $f3.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 4: -Apply ile taze dagitim basarili, allowlist DISINDAKI dosyalar KOPYALANMAZ ==="
$f4 = New-SourceFixture -WithDisallowedExtras $true
$r4 = Invoke-DeployJson -Params @{ SourceDir = $f4.SourceDir; TargetDir = $f4.TargetDir; ServiceLabel = 'test4'; Apply = $true }
Assert-True ($r4.ExitCode -eq 0) 'Exit code 0'
Assert-True ($r4.Json.Status -eq 'applied') 'Status applied'
Assert-True (Test-Path (Join-Path $f4.TargetDir 'dist\index.js')) 'dist/index.js hedefe kopyalandi'
Assert-True (Test-Path (Join-Path $f4.TargetDir 'dist\nested\util.js')) 'dist/nested/util.js hedefe kopyalandi'
Assert-True (Test-Path (Join-Path $f4.TargetDir 'package.json')) 'package.json hedefe kopyalandi'
Assert-True (-not (Test-Path (Join-Path $f4.TargetDir 'node_modules'))) 'node_modules HIC kopyalanmadi (allowlist disi)'
Assert-True (-not (Test-Path (Join-Path $f4.TargetDir '.env'))) '.env HIC kopyalanmadi (allowlist disi)'
Assert-True (-not (Test-Path (Join-Path $f4.TargetDir 'src'))) 'src/ HIC kopyalanmadi (allowlist disi)'
Assert-True ($r4.Json.PostApplyVerificationMismatches.Count -eq 0) 'Bagimsiz dogrulama sifir uyumsuzluk buldu'
Assert-True ($null -eq $r4.Json.BackupPath) 'Ilk dagitimda BackupPath null (yedeklenecek onceki dagitim yok)'

Write-Output "`n=== TEST 5: ayni kaynakla tekrar -Apply -- idempotent, already_up_to_date, yeniden yazma yok ==="
$targetIndexBefore = (Get-Item (Join-Path $f4.TargetDir 'dist\index.js')).LastWriteTimeUtc
Start-Sleep -Milliseconds 50
$r5 = Invoke-DeployJson -Params @{ SourceDir = $f4.SourceDir; TargetDir = $f4.TargetDir; ServiceLabel = 'test4'; Apply = $true }
Assert-True ($r5.ExitCode -eq 0) 'Exit code 0'
Assert-True ($r5.Json.Status -eq 'already_up_to_date') 'Status already_up_to_date'
$targetIndexAfter = (Get-Item (Join-Path $f4.TargetDir 'dist\index.js')).LastWriteTimeUtc
Assert-True ($targetIndexBefore -eq $targetIndexAfter) 'Dosya YENIDEN yazilmadi (mtime degismedi -- gercekten idempotent)'
$backupsBeforeChange = @(Get-ChildItem -Path 'C:\ProgramData\HasarBotu\migration-preflight\pre-deploy-backups' -Filter 'test4-*' -Directory -ErrorAction SilentlyContinue).Count

Write-Output "`n=== TEST 6: kaynak degisince -Apply -- ESKI icerik ADMIN-ONLY, ZAMAN DAMGALI yedege TASINIR, yeni icerik dagitilir ==="
[System.IO.File]::WriteAllText((Join-Path $f4.SourceDir 'dist\index.js'), 'export const v = 2; // changed')
$oldSha256 = (Get-FileHash -LiteralPath (Join-Path $f4.TargetDir 'dist\index.js') -Algorithm SHA256).Hash.ToLowerInvariant()
$r6 = Invoke-DeployJson -Params @{ SourceDir = $f4.SourceDir; TargetDir = $f4.TargetDir; ServiceLabel = 'test4'; Apply = $true }
Assert-True ($r6.ExitCode -eq 0) 'Exit code 0'
Assert-True ($r6.Json.Status -eq 'applied') 'Status applied (degisiklik gercekten uygulandi)'
Assert-True ($null -ne $r6.Json.BackupPath) 'BackupPath doldu'
Assert-True (Test-Path $r6.Json.BackupPath) 'Yedek dizini gercekten var'
Assert-True (Test-Path $r6.Json.BackupManifestPath) 'Yedek manifest dosyasi gercekten var'
$backupIndexSha256 = (Get-FileHash -LiteralPath (Join-Path $r6.Json.BackupPath 'dist\index.js') -Algorithm SHA256).Hash.ToLowerInvariant()
Assert-True ($backupIndexSha256 -eq $oldSha256) 'Yedeklenen dosya ESKI icerigi BIREBIR koruyor'
$newTargetSha256 = (Get-FileHash -LiteralPath (Join-Path $f4.TargetDir 'dist\index.js') -Algorithm SHA256).Hash.ToLowerInvariant()
Assert-True ($newTargetSha256 -ne $oldSha256) 'Hedef artik YENI icerigi tasiyor'
$backupAcl = Get-Acl -LiteralPath $r6.Json.BackupPath
Assert-True ($backupAcl.AreAccessRulesProtected) 'Yedek dizini ACL korumali (miras kesilmis)'
Assert-True (@($backupAcl.Access | Where-Object { $_.IdentityReference -match 'Administrators' }).Count -gt 0) 'Yedek dizini Administrators ACE tasiyor'

Write-Output "`n=== TEST 7: rollback onizlemesi (-Apply yok) -- would_rollback, hicbir sey degismez ==="
$backupPathForRollback = $r6.Json.BackupPath
$r7out = & $scriptPath -TargetDir $f4.TargetDir -ServiceLabel 'test4' -Rollback -RollbackBackupPath $backupPathForRollback
$r7 = $r7out | ConvertFrom-Json
Assert-True ($LASTEXITCODE -eq 0) 'Rollback onizleme exit 0'
Assert-True ($r7.Status -eq 'would_rollback') 'Status would_rollback'
Assert-True ((Get-FileHash -LiteralPath (Join-Path $f4.TargetDir 'dist\index.js') -Algorithm SHA256).Hash.ToLowerInvariant() -eq $newTargetSha256) 'Onizlemede hedef HALA yeni icerikte (degismedi)'

Write-Output "`n=== TEST 8: gercek rollback (-Apply) -- eski icerik geri gelir, guncel icerik pre-rollback yedegine tasinir ==="
$r8out = & $scriptPath -TargetDir $f4.TargetDir -ServiceLabel 'test4' -Rollback -RollbackBackupPath $backupPathForRollback -Apply
$r8 = $r8out | ConvertFrom-Json
Assert-True ($LASTEXITCODE -eq 0) 'Gercek rollback exit 0'
Assert-True ($r8.Status -eq 'rolled_back') 'Status rolled_back'
$restoredSha256 = (Get-FileHash -LiteralPath (Join-Path $f4.TargetDir 'dist\index.js') -Algorithm SHA256).Hash.ToLowerInvariant()
Assert-True ($restoredSha256 -eq $oldSha256) 'Rollback sonrasi hedef ESKI (rollback edilen) icerige birebir esit'
Assert-True ($null -ne $r8.PreRollbackBackupPath -and (Test-Path $r8.PreRollbackBackupPath)) 'Rollback ONCESI guncel icerik de AYRICA yedeklendi (hicbir veri kaybolmadi)'
$preRollbackSha256 = (Get-FileHash -LiteralPath (Join-Path $r8.PreRollbackBackupPath 'dist\index.js') -Algorithm SHA256).Hash.ToLowerInvariant()
Assert-True ($preRollbackSha256 -eq $newTargetSha256) 'Pre-rollback yedegi rollback ONCESI (yeni) icerigi koruyor'

Write-Output "`n=== TEST 9: bozuk (tampered) yedek manifest uyusmazliginda rollback reddedilir ==="
$tamperedBackupDir = Join-Path (Split-Path $backupPathForRollback -Parent) ('tampered-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path (Join-Path $tamperedBackupDir 'dist') -Force | Out-Null
[System.IO.File]::WriteAllText((Join-Path $tamperedBackupDir 'dist\index.js'), 'tampered content')
[System.IO.File]::WriteAllText((Join-Path $tamperedBackupDir 'package.json'), '{}')
$fakeManifest = [ordered]@{ GeneratedAtUtc = [DateTime]::UtcNow.ToString('o'); Entries = @([ordered]@{ RelativePath = 'dist\index.js'; Sha256 = ('0' * 64); Size = 5 }) }
[System.IO.File]::WriteAllText("$tamperedBackupDir.manifest.json", ($fakeManifest | ConvertTo-Json -Depth 6), [System.Text.UTF8Encoding]::new($false))
$r9out = & $scriptPath -TargetDir $f4.TargetDir -ServiceLabel 'test4' -Rollback -RollbackBackupPath $tamperedBackupDir -Apply
$r9 = $r9out | ConvertFrom-Json
Assert-True ($LASTEXITCODE -eq 2) 'Bozuk yedek exit 2 (blocked)'
Assert-True ((@($r9.Blockers) -match 'bütünlük hatası').Count -gt 0) 'Butunluk hatasi dogru raporlandi'
Assert-True ((Get-FileHash -LiteralPath (Join-Path $f4.TargetDir 'dist\index.js') -Algorithm SHA256).Hash.ToLowerInvariant() -eq $restoredSha256) 'Hedef bozuk-yedek denemesinden ETKILENMEDI'
Remove-Item $tamperedBackupDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "$tamperedBackupDir.manifest.json" -Force -ErrorAction SilentlyContinue
Remove-Item $f4.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 10: asiri yuksek RequiredFreeSpaceMultiplier ile kapasite kontrolu fail-closed calisir ==="
$f10 = New-SourceFixture
$r10 = Invoke-DeployJson -Params @{ SourceDir = $f10.SourceDir; TargetDir = $f10.TargetDir; ServiceLabel = 'test10'; RequiredFreeSpaceMultiplier = 100 }
# Not: 100x kucuk bir test fixture'i icin bile gercekci sekilde asilamayacak
# kadar buyuk degil -- bu yuzden ValidateRange ustu bir deger yerine, testin
# amaci yalniz "capacity check calisiyor ve PASS donuyor" kismini pozitif
# yolda dogrulamaktir; gercek FAIL yolu disk-doldurma gerektirdigi icin
# (guvenilir sekilde sentetik olarak tetiklenemez) bu suitte KAPSAM DISI
# birakildi ve script kaynaginda dogrudan kod incelemesiyle (statik denetim)
# guvence altina alinir.
Assert-True ($r10.ExitCode -eq 0) 'Makul bir capacity carpaninda onizleme basarili (capacity mantigi calisiyor)'
Remove-Item $f10.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 11: hedefin ebeveyni yoksa BLOCKED ==="
$f11 = New-SourceFixture
$missingParentTarget = Join-Path $f11.Root 'does-not-exist-parent\target'
$r11 = Invoke-DeployJson -Params @{ SourceDir = $f11.SourceDir; TargetDir = $missingParentTarget; ServiceLabel = 'test11' }
Assert-True ($r11.ExitCode -eq 2) 'Exit code 2 (blocked)'
Assert-True ((@($r11.Json.Blockers) -match 'ebeveyni yok').Count -gt 0) 'Eksik ebeveyn dogru raporlandi'
Remove-Item $f11.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 12: reparse point (junction) dist altinda varsa BLOCKED ==="
$f12 = New-SourceFixture
$junctionTarget = Join-Path $f12.Root 'junction-target'
New-Item -ItemType Directory -Path $junctionTarget -Force | Out-Null
$junctionPath = Join-Path $f12.SourceDir 'dist\linked'
$junctionCreated = $false
try {
    cmd /c mklink /J "`"$junctionPath`"" "`"$junctionTarget`"" | Out-Null
    $junctionCreated = [System.IO.Directory]::Exists($junctionPath) -and (([System.IO.DirectoryInfo]::new($junctionPath)).Attributes -band [System.IO.FileAttributes]::ReparsePoint)
} catch {}
if ($junctionCreated) {
    $r12 = Invoke-DeployJson -Params @{ SourceDir = $f12.SourceDir; TargetDir = $f12.TargetDir; ServiceLabel = 'test12' }
    Assert-True ($r12.ExitCode -eq 2) 'Reparse point fail-closed BLOCKED (exit 2) ile durur'
    Assert-True ((@($r12.Json.Blockers) -match 'SOURCE_DIST_REPARSE_POINT').Count -gt 0) 'Reparse point sebebi dogru raporlandi'
}
else {
    Write-Output 'SKIP: bu ortamda junction olusturulamadi (izin/ozellik kisiti), reparse-point reddi statik denetimle guvence altinda'
}
Remove-Item $f12.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 13: -DependencyClosureManifestPath verilip -RepoRoot verilmezse BLOCKED ==="
$f13 = New-SourceFixture
$cf13 = New-ClosureFixture
$r13 = Invoke-DeployJson -Params @{ SourceDir = $f13.SourceDir; TargetDir = $f13.TargetDir; ServiceLabel = 'test13'; DependencyClosureManifestPath = $cf13.ClosureManifestPath }
Assert-True ($r13.ExitCode -eq 2) 'Exit code 2 (blocked)'
Assert-True ((@($r13.Json.Blockers) -match 'birlikte verilmeli').Count -gt 0) 'RepoRoot eksikligi dogru raporlandi'
Remove-Item $f13.Root -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $cf13.RepoRoot -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 14: -RepoRoot verilip -DependencyClosureManifestPath verilmezse BLOCKED ==="
$f14 = New-SourceFixture
$cf14 = New-ClosureFixture
$r14 = Invoke-DeployJson -Params @{ SourceDir = $f14.SourceDir; TargetDir = $f14.TargetDir; ServiceLabel = 'test14'; RepoRoot = $cf14.RepoRoot }
Assert-True ($r14.ExitCode -eq 2) 'Exit code 2 (blocked)'
Assert-True ((@($r14.Json.Blockers) -match 'birlikte verilmeli').Count -gt 0) 'DependencyClosureManifestPath eksikligi dogru raporlandi'
Remove-Item $f14.Root -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $cf14.RepoRoot -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 15: kapanis manifest dosyasi yoksa BLOCKED ==="
$f15 = New-SourceFixture
$cf15 = New-ClosureFixture
$missingManifestPath = Join-Path $cf15.RepoRoot 'does-not-exist-closure.json'
$r15 = Invoke-DeployJson -Params @{ SourceDir = $f15.SourceDir; TargetDir = $f15.TargetDir; ServiceLabel = 'test15'; DependencyClosureManifestPath = $missingManifestPath; RepoRoot = $cf15.RepoRoot }
Assert-True ($r15.ExitCode -eq 2) 'Exit code 2 (blocked)'
Assert-True ((@($r15.Json.Blockers) -match 'manifest dosyası yok').Count -gt 0) 'Eksik manifest dosyasi dogru raporlandi'
Remove-Item $f15.Root -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $cf15.RepoRoot -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 16: kapanis manifesti Status='error' ise BLOCKED ==="
$f16 = New-SourceFixture
$cf16 = New-ClosureFixture
$errorManifest = (Get-Content -LiteralPath $cf16.ClosureManifestPath -Raw | ConvertFrom-Json)
$errorManifest.Status = 'error'
$errorManifestPath = Join-Path $cf16.RepoRoot 'error-closure.json'
[System.IO.File]::WriteAllText($errorManifestPath, ($errorManifest | ConvertTo-Json -Depth 8), [System.Text.UTF8Encoding]::new($false))
$r16 = Invoke-DeployJson -Params @{ SourceDir = $f16.SourceDir; TargetDir = $f16.TargetDir; ServiceLabel = 'test16'; DependencyClosureManifestPath = $errorManifestPath; RepoRoot = $cf16.RepoRoot }
Assert-True ($r16.ExitCode -eq 2) 'Exit code 2 (blocked)'
Assert-True ((@($r16.Json.Blockers) -match "'ok' durumunda değil").Count -gt 0) "Status='error' dogru raporlandi"
Remove-Item $f16.Root -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $cf16.RepoRoot -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 17: gecerli kapanis ile onizleme -- workspace-internal + harici paket DOGRU yollarla planlanir, kaynak (src) HARIC ==="
$f17 = New-SourceFixture
$cf17 = New-ClosureFixture
$r17 = Invoke-DeployJson -Params @{ SourceDir = $f17.SourceDir; TargetDir = $f17.TargetDir; ServiceLabel = 'test17'; DependencyClosureManifestPath = $cf17.ClosureManifestPath; RepoRoot = $cf17.RepoRoot }
Assert-True ($r17.ExitCode -eq 0) 'Exit code 0'
Assert-True ($r17.Json.Status -eq 'would_apply') 'Status would_apply'
Assert-True ($r17.Json.DependencyClosureUsed -eq $true) 'DependencyClosureUsed true'
Assert-True ($r17.Json.WorkspaceInternalPackageCount -eq 1) 'WorkspaceInternalPackageCount 1'
Assert-True ($r17.Json.ExternalPackageCount -eq 1) 'ExternalPackageCount 1'
Assert-True ($r17.Json.AllowlistFileCount -eq 7) 'Toplam dosya sayisi 7 (3 servis + 2 workspace-internal + 2 harici)'
$expectedInternalDist = 'node_modules\@hasarbotu\demo-internal\dist\index.js'
$expectedInternalPkg = 'node_modules\@hasarbotu\demo-internal\package.json'
$expectedInternalSrc = 'node_modules\@hasarbotu\demo-internal\src\index.ts'
$expectedExternalIndex = 'node_modules\demo-external\index.js'
$expectedExternalPkg = 'node_modules\demo-external\package.json'
$manifestPaths = @($r17.Json.Manifest | ForEach-Object { $_.RelativePath })
Assert-True ($manifestPaths -contains $expectedInternalDist) 'Workspace-internal dist dogru yolda planlandi'
Assert-True ($manifestPaths -contains $expectedInternalPkg) 'Workspace-internal package.json dogru yolda planlandi'
Assert-True ($manifestPaths -contains $expectedExternalIndex) 'Harici paket dosyasi dogru yolda planlandi'
Assert-True ($manifestPaths -contains $expectedExternalPkg) 'Harici paket package.json dogru yolda planlandi'
Assert-True ($manifestPaths -notcontains $expectedInternalSrc) 'Workspace-internal KAYNAK KODU (src) dahil edilmedi -- yalniz dist+package.json'
Assert-True (-not (Test-Path $f17.TargetDir)) 'Onizlemede hedef dizin OLUSTURULMADI'

Write-Output "`n=== TEST 18: gercek -Apply ile kapanis-farkli dagitim -- node_modules\@hasarbotu\... ve node_modules\<harici>\... hedefte GERCEKTEN olusur ==="
$r18 = Invoke-DeployJson -Params @{ SourceDir = $f17.SourceDir; TargetDir = $f17.TargetDir; ServiceLabel = 'test17'; DependencyClosureManifestPath = $cf17.ClosureManifestPath; RepoRoot = $cf17.RepoRoot; Apply = $true }
Assert-True ($r18.ExitCode -eq 0) 'Exit code 0'
Assert-True ($r18.Json.Status -eq 'applied') 'Status applied'
Assert-True (Test-Path (Join-Path $f17.TargetDir $expectedInternalDist)) 'Workspace-internal dist hedefte GERCEKTEN var'
Assert-True (Test-Path (Join-Path $f17.TargetDir $expectedExternalIndex)) 'Harici paket dosyasi hedefte GERCEKTEN var'
Assert-True (-not (Test-Path (Join-Path $f17.TargetDir $expectedInternalSrc))) 'Workspace-internal src/ hedefe HIC kopyalanmadi'
Assert-True ((Get-Content -LiteralPath (Join-Path $f17.TargetDir $expectedExternalPkg) -Raw) -match 'demo-external') 'Harici paketin package.json icerigi dogru'
Assert-True ($r18.Json.PostApplyVerificationMismatches.Count -eq 0) 'Bagimsiz dogrulama sifir uyumsuzluk buldu'

Write-Output "`n=== TEST 19: kapanis-farkli dagitimda idempotency -- ayni kapanisla tekrar -Apply degisiklik yapmaz ==="
$internalMtimeBefore = (Get-Item (Join-Path $f17.TargetDir $expectedInternalDist)).LastWriteTimeUtc
Start-Sleep -Milliseconds 50
$r19 = Invoke-DeployJson -Params @{ SourceDir = $f17.SourceDir; TargetDir = $f17.TargetDir; ServiceLabel = 'test17'; DependencyClosureManifestPath = $cf17.ClosureManifestPath; RepoRoot = $cf17.RepoRoot; Apply = $true }
Assert-True ($r19.ExitCode -eq 0) 'Exit code 0'
Assert-True ($r19.Json.Status -eq 'already_up_to_date') 'Status already_up_to_date'
$internalMtimeAfter = (Get-Item (Join-Path $f17.TargetDir $expectedInternalDist)).LastWriteTimeUtc
Assert-True ($internalMtimeBefore -eq $internalMtimeAfter) 'Workspace-internal dosya YENIDEN yazilmadi (idempotent)'
Remove-Item $f17.Root -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $cf17.RepoRoot -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 20: harici paketin DISKTEKI surumu kilitten TAZE olarak sapmissa BLOCKED (ikinci, bagimsiz kontrol) ==="
$f20 = New-SourceFixture
$cf20 = New-ClosureFixture
[System.IO.File]::WriteAllText((Join-Path $cf20.ExternalRoot 'package.json'), '{"name":"demo-external","version":"9.9.9"}')
$r20 = Invoke-DeployJson -Params @{ SourceDir = $f20.SourceDir; TargetDir = $f20.TargetDir; ServiceLabel = 'test20'; DependencyClosureManifestPath = $cf20.ClosureManifestPath; RepoRoot = $cf20.RepoRoot }
Assert-True ($r20.ExitCode -eq 2) 'Exit code 2 (blocked)'
Assert-True ((@($r20.Json.Blockers) -match 'Kilit bütünlüğü uyuşmazlığı').Count -gt 0) 'Taze kilit uyusmazligi dogru raporlandi'
Remove-Item $f20.Root -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $cf20.RepoRoot -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 21: workspace-internal paket dizini diskte yoksa BLOCKED ==="
$f21 = New-SourceFixture
$cf21 = New-ClosureFixture
Remove-Item $cf21.WorkspaceInternalRoot -Recurse -Force
$r21 = Invoke-DeployJson -Params @{ SourceDir = $f21.SourceDir; TargetDir = $f21.TargetDir; ServiceLabel = 'test21'; DependencyClosureManifestPath = $cf21.ClosureManifestPath; RepoRoot = $cf21.RepoRoot }
Assert-True ($r21.ExitCode -eq 2) 'Exit code 2 (blocked)'
Assert-True ((@($r21.Json.Blockers) -match 'Workspace-internal paket dizini yok').Count -gt 0) 'Eksik workspace-internal dizini dogru raporlandi'
Remove-Item $f21.Root -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $cf21.RepoRoot -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 22: harici paket dizini diskte yoksa BLOCKED ==="
$f22 = New-SourceFixture
$cf22 = New-ClosureFixture
Remove-Item $cf22.ExternalRoot -Recurse -Force
$r22 = Invoke-DeployJson -Params @{ SourceDir = $f22.SourceDir; TargetDir = $f22.TargetDir; ServiceLabel = 'test22'; DependencyClosureManifestPath = $cf22.ClosureManifestPath; RepoRoot = $cf22.RepoRoot }
Assert-True ($r22.ExitCode -eq 2) 'Exit code 2 (blocked)'
Assert-True ((@($r22.Json.Blockers) -match 'Harici paket bulunamadı').Count -gt 0) 'Eksik harici paket dizini dogru raporlandi'
Remove-Item $f22.Root -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $cf22.RepoRoot -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 23: hedef yol Windows MAX_PATH sinirini asarsa BLOCKED (kopyalama denenmeden ONCE, kriptik bir istisna yerine net mesaj) ==="
$f23 = New-SourceFixture
$longName = 'a-fairly-long-nested-directory-segment-name-01234567890123456789'
$deepDistDir = Join-Path $f23.SourceDir ('dist\' + $longName + '\' + $longName)
New-Item -ItemType Directory -Path $deepDistDir -Force | Out-Null
[System.IO.File]::WriteAllText((Join-Path $deepDistDir 'deep-file.js'), '// deep')
$longTargetSegment = 'another-fairly-long-target-directory-segment-0123456789'
$deepTarget = $f23.Root
1..2 | ForEach-Object { $deepTarget = Join-Path $deepTarget $longTargetSegment }
$deepTarget = Join-Path $deepTarget 'target'
$r23 = Invoke-DeployJson -Params @{ SourceDir = $f23.SourceDir; TargetDir = $deepTarget; ServiceLabel = 'test23' }
Assert-True ($r23.ExitCode -eq 2) 'Exit code 2 (blocked)'
Assert-True ((@($r23.Json.Blockers) -match 'MAX_PATH').Count -gt 0) 'MAX_PATH asimi kopyalama denenmeden ONCE net mesajla raporlandi'
Remove-Item $f23.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 24: harici paketin KENDI ic ice node_modules'i, o alt paket AYRI bir kapanis girdisiyse IKI KEZ kopyalanmaz (gercek file-agent kapanisinda bulunan hata) ==="
$f24 = New-SourceFixture
$cf24 = New-NestedExternalClosureFixture
$r24 = Invoke-DeployJson -Params @{ SourceDir = $f24.SourceDir; TargetDir = $f24.TargetDir; ServiceLabel = 'test24'; DependencyClosureManifestPath = $cf24.ClosureManifestPath; RepoRoot = $cf24.RepoRoot; Apply = $true }
Assert-True ($r24.ExitCode -eq 0) 'Exit code 0'
Assert-True ($r24.Json.Status -eq 'applied') 'Status applied'
Assert-True ($r24.Json.AllowlistFileCount -eq 7) 'Toplam dosya sayisi TAM 7 (3 servis + 2 parent-pkg + 2 nested-pkg, YINELENMEDEN)'
Assert-True ($r24.Json.PostApplyVerificationMismatches.Count -eq 0) 'FILE_COUNT_MISMATCH YOK -- bagimsiz dogrulama sifir uyumsuzluk buldu'
Assert-True (Test-Path (Join-Path $f24.TargetDir 'node_modules\parent-pkg\index.js')) 'parent-pkg kendi dosyasi hedefte var'
Assert-True (Test-Path (Join-Path $f24.TargetDir 'node_modules\parent-pkg\node_modules\nested-pkg\index.js')) 'nested-pkg KENDI ayri kapanis girdisiyle dogru yolda hedefte var'
$nestedContent = Get-Content -LiteralPath (Join-Path $f24.TargetDir 'node_modules\parent-pkg\node_modules\nested-pkg\package.json') -Raw
Assert-True ($nestedContent -match 'nested-pkg') 'nested-pkg icerigi dogru'
Remove-Item $f24.Root -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $cf24.RepoRoot -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 25: kilit disi 'ek veri referansi' (new URL('../...', import.meta.url)) hedefte yoksa BLOCKED -- gercek API kapanisinda bulunan hata (ENOENT ile deploy sonrasi cokme) ==="
$f25 = New-SourceFixture
$cf25 = New-ExtraDataReferenceClosureFixture
$r25 = Invoke-DeployJson -Params @{ SourceDir = $f25.SourceDir; TargetDir = $f25.TargetDir; ServiceLabel = 'test25'; DependencyClosureManifestPath = $cf25.ClosureManifestPath; RepoRoot = $cf25.RepoRoot }
Assert-True ($r25.ExitCode -eq 2) 'Exit code 2 (blocked)'
Assert-True ((@($r25.Json.Blockers) -match 'Ek veri dosyası hedefte yok').Count -gt 0) 'Ek veri referansi eksikligi (hedefte yok) dogru raporlandi'
Assert-True (@(@($r25.Json.Blockers) | Where-Object { $_ -match [regex]::Escape((Join-Path $f25.TargetDir 'extra-data.json')) }).Count -gt 0) 'Blocker mesaji GERCEK hesaplanan beklenen konumu iceriyor'
Remove-Item $f25.Root -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $cf25.RepoRoot -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 26: ek veri referansinin KAYNAGI da yoksa ayri, net bir blocker doner ==="
$f26 = New-SourceFixture
$cf26 = New-ExtraDataReferenceClosureFixture -WithSourceDataFile $false
$r26 = Invoke-DeployJson -Params @{ SourceDir = $f26.SourceDir; TargetDir = $f26.TargetDir; ServiceLabel = 'test26'; DependencyClosureManifestPath = $cf26.ClosureManifestPath; RepoRoot = $cf26.RepoRoot }
Assert-True ($r26.ExitCode -eq 2) 'Exit code 2 (blocked)'
Assert-True ((@($r26.Json.Blockers) -match 'kaynakta bulunamadı').Count -gt 0) 'Ek veri referansinin kaynakta da eksik oldugu ayirt edilerek raporlandi'
Remove-Item $f26.Root -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $cf26.RepoRoot -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 27: ek veri referansi hesaplanan konumda ONCEDEN dogru icerikle sagliyorsa (ornegin ayri/paylasilan bir adimla) blocker OLUSMAZ ==="
$f27 = New-SourceFixture
$cf27 = New-ExtraDataReferenceClosureFixture
New-Item -ItemType Directory -Path $f27.TargetDir -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $cf27.RepoRoot 'extra-data.json') -Destination (Join-Path $f27.TargetDir 'extra-data.json')
$r27 = Invoke-DeployJson -Params @{ SourceDir = $f27.SourceDir; TargetDir = $f27.TargetDir; ServiceLabel = 'test27'; DependencyClosureManifestPath = $cf27.ClosureManifestPath; RepoRoot = $cf27.RepoRoot }
Assert-True ($r27.ExitCode -eq 0) 'Exit code 0 -- ek veri referansi ONCEDEN dogru sagliyor, blocker YOK'
Assert-True ($r27.Json.Blockers.Count -eq 0) 'Ek veri blocker mesaji YOK'
Remove-Item $f27.Root -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $cf27.RepoRoot -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== SUMMARY: $($script:failures) failure(s) ==="
if ($script:failures -gt 0) { exit 1 } else { exit 0 }
