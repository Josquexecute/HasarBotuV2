#Requires -Version 5.1
# Dependency-free test script (no Pester) for install-services.ps1's
# -Services single-service selector (D9/HB-2026-142). Builds synthetic
# scratch directories under $env:TEMP; never touches real HasarBotu
# services. Run: powershell -File .\install-services.tests.ps1
#
# IMPORTANT: this suite NEVER passes -Apply. install-services.ps1's
# Install-OneService always targets the fixed production service names
# (hasarbotu-api / hasarbotu-file-agent) -- there is no way to redirect a
# real WinSW install to a scratch service name, so exercising the real
# install path here would install a REAL Windows service on whatever
# machine runs this test. Instead this suite exhaustively covers the
# PLAN/precondition logic (which service(s) are read/validated/reported)
# in preview mode, plus real, read-only assertions against this
# machine's actual hasarbotu-file-agent service where it genuinely
# helps (skipped, not failed, if that service happens to be absent).

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# MUST be the first console-touching statement in this process: .NET caches
# the console writer on first use, so setting OutputEncoding after any
# earlier Write-Host/Write-Output in this same process (e.g. in a caller)
# silently has no effect on it (confirmed empirically). Matches the same
# fix already used in setup-file-agent-service-account.ps1 / install-services.ps1.
try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
} catch {
    # Read-only in some hosted consoles; harmless, only affects display.
}

$script:failures = 0

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { Write-Output "FAIL: $Message"; $script:failures++ } else { Write-Output "OK: $Message" }
}

function New-Fixture {
    param([bool]$WithApiDist = $true, [bool]$WithFileAgentDist = $true)
    $root = Join-Path $env:TEMP ("hasarbotu-install-services-test-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    $apiDir = Join-Path $root 'api'
    $fileAgentDir = Join-Path $root 'file-agent'
    New-Item -ItemType Directory -Path (Join-Path $apiDir 'dist') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $fileAgentDir 'dist') -Force | Out-Null
    if ($WithApiDist) { [System.IO.File]::WriteAllText((Join-Path $apiDir 'dist\index.js'), '// stub') }
    if ($WithFileAgentDist) { [System.IO.File]::WriteAllText((Join-Path $fileAgentDir 'dist\index.js'), '// stub') }
    # WinSwExe only needs to exist as a file for preview-mode tests (never
    # invoked -- Install-OneService is only reached with -Apply, which this
    # suite never passes).
    $winSwExe = Join-Path $root 'WinSW-fake.exe'
    [System.IO.File]::WriteAllText($winSwExe, 'not a real binary, preview-only')
    return [pscustomobject]@{ Root = $root; ApiDir = $apiDir; FileAgentDir = $fileAgentDir; WinSwExe = $winSwExe }
}

$scriptPath = Join-Path $PSScriptRoot 'install-services.ps1'
$realFileAgentService = Get-Service -Name 'hasarbotu-file-agent' -ErrorAction SilentlyContinue
$realApiService = Get-Service -Name 'hasarbotu-api' -ErrorAction SilentlyContinue

Write-Output '=== TEST 1: -Services verilmezse (varsayilan) hem ApiDir hem FileAgentDir eksikse ikisi de sikayet edilir (davranis DEGISMEDI) ==='
$f1 = New-Fixture
$out1 = & $scriptPath -WinSwExe $f1.WinSwExe *>&1 | Out-String
Assert-True ($LASTEXITCODE -eq 1) 'Exit code 1 (on kosul hatasi)'
Assert-True ($out1 -match [regex]::Escape('-Services listesi Api içeriyor ama -ApiDir verilmedi')) 'ApiDir eksikligi bildirildi'
Assert-True ($out1 -match [regex]::Escape('-Services listesi FileAgent içeriyor ama -FileAgentDir verilmedi')) 'FileAgentDir eksikligi bildirildi'
Remove-Item $f1.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 2: -Services Api ile FileAgentDir hic gerekmez ve File Agent hicbir sekilde kontrol edilmez ==="
$f2 = New-Fixture -WithFileAgentDist $false
$out2 = & $scriptPath -ApiDir $f2.ApiDir -WinSwExe $f2.WinSwExe -Services Api *>&1 | Out-String
Assert-True ($out2 -notmatch 'FileAgentDir verilmedi') 'FileAgentDir eksikligi HICBIR ZAMAN sikayet edilmedi'
Assert-True ($out2 -notmatch 'File Agent build') 'File Agent build ciktisi hic kontrol edilmedi (dist yok ama secilmedigi icin sikayet yok)'
if ($null -eq $realApiService) {
    # "File Agent SEÇİLMEDİ" mesajı yalnız "steps" bloğunda basılır (issues=0
    # olduğunda ulaşılır); bu makinede API zaten kuruluysa idempotency
    # blocker'ı bu bloğa hiç ulaşılmadan zaten test ediyor (Test 5), o yüzden
    # burada tekrar test edilmesi gerekmez -- TEST 3'teki "API SEÇİLMEDİ"
    # ile AYNI, simetrik guard (HB-2026-175'te bulunan gerçek asimetri
    # düzeltildi: bu satır önceden guard'sızdı, TEST 3'ün kendisi zaten
    # doğruydu).
    Assert-True ($out2 -match 'File Agent SEÇİLMEDİ') 'Plan aciklamada File Agent secilmedigini belirtti'
    Assert-True ($LASTEXITCODE -eq 0) 'hasarbotu-api gercekten kurulu degilken plan basariyla gosterildi (exit 0)'
    Assert-True ($out2 -match [regex]::Escape('-Apply verilmedi: yalnız plan gösterildi')) 'Onizleme mesaji dogru'
}
else {
    Write-Output 'SKIP: hasarbotu-api bu makinede zaten kurulu, preview-basari yolu test edilemedi (idempotency Test 5 bunu ayrica kapsiyor)'
}
Remove-Item $f2.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 3: -Services FileAgent ile ApiDir/Postgres hic kontrol edilmez ==="
$f3 = New-Fixture -WithApiDist $false
$out3 = & $scriptPath -FileAgentDir $f3.FileAgentDir -WinSwExe $f3.WinSwExe -Services FileAgent *>&1 | Out-String
Assert-True ($out3 -notmatch 'ApiDir verilmedi') 'ApiDir eksikligi HICBIR ZAMAN sikayet edilmedi'
Assert-True ($out3 -notmatch 'API build') 'API build ciktisi hic kontrol edilmedi'
Assert-True ($out3 -notmatch 'postgresql-x64-17') 'Postgres servisi FileAgent-only modda hic kontrol edilmedi'
if ($null -eq $realFileAgentService) {
    # "API SEÇİLMEDİ" mesajı yalnız "steps" bloğunda basılır (issues=0
    # olduğunda ulaşılır); bu makinede file-agent zaten kuruluysa
    # idempotency blocker'ı bu bloğa hiç ulaşılmadan zaten test ediyor
    # (Test 5), o yüzden burada tekrar test edilmesi gerekmez.
    Assert-True ($out3 -match 'API SEÇİLMEDİ') 'Plan aciklamada API secilmedigini belirtti'
}
else {
    Write-Output 'SKIP: hasarbotu-file-agent zaten kurulu oldugundan bu senaryoda "steps" blogu hic basilmiyor (idempotency zaten Test 5te dogrulaniyor)'
}
Remove-Item $f3.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 4: bos -Services dizisi fail-closed reddedilir ==="
$f4 = New-Fixture
$out4 = & $scriptPath -ApiDir $f4.ApiDir -FileAgentDir $f4.FileAgentDir -WinSwExe $f4.WinSwExe -Services @() *>&1 | Out-String
Assert-True ($LASTEXITCODE -eq 1) 'Bos -Services exit 1 doner'
Assert-True ($out4 -match [regex]::Escape('-Services boş olamaz')) 'Bos -Services dogru mesajla reddedildi'
Remove-Item $f4.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 5: idempotency - zaten kurulu bir servis secilirse -Apply OLMADAN BILE BLOCKED (gercek makine durumuyla) ==="
if ($null -ne $realFileAgentService) {
    $f5 = New-Fixture
    $out5 = & $scriptPath -FileAgentDir $f5.FileAgentDir -WinSwExe $f5.WinSwExe -Services FileAgent *>&1 | Out-String
    Assert-True ($LASTEXITCODE -eq 1) 'Zaten kurulu hasarbotu-file-agent secilince exit 1'
    Assert-True ($out5 -match [regex]::Escape('hasarbotu-file-agent servisi ZATEN kurulu')) 'Idempotency blocker dogru mesajla raporlandi'
    Remove-Item $f5.Root -Recurse -Force -ErrorAction SilentlyContinue
}
else {
    Write-Output 'SKIP: hasarbotu-file-agent bu makinede kurulu degil, gercek idempotency dogrulamasi atlandi (sentetik mock guvenilir olmadigi icin bilinen bosluk)'
}

Write-Output "`n=== TEST 6: varsayilan (-Services verilmez) modda da idempotency korumasi devrede (yalniz File Agent gercekten kuruluysa) ==="
if ($null -ne $realFileAgentService -and $null -eq $realApiService) {
    $f6 = New-Fixture
    $out6 = & $scriptPath -ApiDir $f6.ApiDir -FileAgentDir $f6.FileAgentDir -WinSwExe $f6.WinSwExe *>&1 | Out-String
    Assert-True ($LASTEXITCODE -eq 1) 'Varsayilan modda da zaten-kurulu File Agent blocker verir'
    Assert-True ($out6 -match [regex]::Escape('hasarbotu-file-agent servisi ZATEN kurulu')) 'Varsayilan modda idempotency mesaji dogru'
    Remove-Item $f6.Root -Recurse -Force -ErrorAction SilentlyContinue
}
else {
    Write-Output 'SKIP: bu makinenin gercek servis durumu bu senaryoya uymuyor (File Agent kurulu + API kurulu degil bekleniyordu)'
}

Write-Output "`n=== TEST 7: gecersiz servis adi ValidateSet tarafindan reddedilir ==="
$f7 = New-Fixture
try {
    & $scriptPath -ApiDir $f7.ApiDir -FileAgentDir $f7.FileAgentDir -WinSwExe $f7.WinSwExe -Services 'Bogus' *>&1 | Out-Null
    $exitCode7 = $LASTEXITCODE
}
catch {
    $exitCode7 = 1
}
Assert-True ($exitCode7 -ne 0) 'Gecersiz -Services degeri basariyla calismadi (ValidateSet reddi)'
Remove-Item $f7.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 8: her iki servis de secilip her ikisinin de build ciktisi eksikse HER IKI hata da raporlanir (tekrar dogrulama) ==="
$f8 = New-Fixture -WithApiDist $false -WithFileAgentDist $false
$out8 = & $scriptPath -ApiDir $f8.ApiDir -FileAgentDir $f8.FileAgentDir -WinSwExe $f8.WinSwExe -Services @('Api', 'FileAgent') *>&1 | Out-String
Assert-True ($out8 -match 'API build çıktısı yok') 'API build eksikligi raporlandi'
Assert-True ($out8 -match 'File Agent build çıktısı yok') 'File Agent build eksikligi raporlandi'
Remove-Item $f8.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== SUMMARY: $($script:failures) failure(s) ==="
if ($script:failures -gt 0) { exit 1 } else { exit 0 }
