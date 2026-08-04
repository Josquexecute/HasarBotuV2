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

Write-Output "`n=== SUMMARY: $($script:failures) failure(s) ==="
if ($script:failures -gt 0) { exit 1 } else { exit 0 }
