#Requires -Version 5.1
<#
.SYNOPSIS
    HasarBotu V2 API ve/veya File Agent'ı WinSW ile Windows servisi olarak
    kurar (D5, HB-2026-108; tek-servis seçici D9/HB-2026-142). PLANLA ->
    ÖNİZLE -> ONAY -> UYGULA -> DOĞRULA modeli.

.DESCRIPTION
    `-Apply` verilmeden bu betik HİÇBİR kalıcı değişiklik yapmaz; yalnız
    ön koşulları denetler ve YAPILACAK işlemleri yazdırır (dry run). Bu,
    AGENTS.md §7 "kritik işlem standardı"nın kuruluma uygulanmasıdır.

    HB-2026-142 (D9 ilk küçük paketi): `-Services` parametresi eklendi.
    VERİLMEZSE davranış TAMAMEN AYNIDIR (varsayılan: hem API hem File
    Agent — HB-2026-108'deki orijinal davranış). `-Services Api` verilirse
    yalnız `hasarbotu-api` kurulur; `-FileAgentDir`, File Agent build
    çıktısı, File Agent WinSW şablonu, File Agent servis kurulumu dahil
    File Agent'a ait HİÇBİR alana dokunulmaz/bakılmaz (`-FileAgentDir`
    bu modda GEREKMEZ). Simetrik olarak `-Services FileAgent` yalnız File
    Agent'a dokunur. Bu, D6'da (`setup-file-agent-service-account.ps1`,
    HB-2026-119/120) GERÇEKTEN kurulmuş, kasıtlı `Disabled` başlangıç
    türünde bırakılmış File Agent servisinin, API kurulumu sırasında
    yanlışlıkla yeniden `install` edilip WinSW şablonundaki
    `<startmode>Automatic</startmode>`e sıfırlanmasını ÖNLEMEK için
    eklendi (bkz. `docs/D9_OPERATIONAL_CUTOVER_PLAN.md` blocker B3).

    İDEMPOTENCY (HB-2026-142, yeni): seçilen servislerden HERHANGİ biri
    SCM'de ZATEN kuruluysa (`Get-Service` ile), bu artık `-Apply` OLSA
    BİLE fail-closed bir ön-koşul HATASIdır — betik VAR OLAN bir servisi
    asla yeniden `install` etmez/üzerine yazmaz (aynı desen
    `setup-file-agent-service-account.ps1`'in kendi "zaten kurulu"
    reddiyle tutarlı). Bu kontrol, `-Services` hiç verilmese BİLE her iki
    servis için de çalışır: bu betik daha önce hiçbir gerçek servise karşı
    `-Apply` ile çalıştırılmamıştı (yalnız File Agent, TAMAMEN AYRI bir
    araçla kuruldu) — yani bu, önceden GÜVENLİ olduğu KANITLANMIŞ hiçbir
    yolu bozmaz; yalnız daha önce hiç denenmemiş "zaten kurulu servise
    tekrar -Apply" durumunu şimdi açıkça REDDEDER (önceden bu durumun
    gerçek sonucu tanımsızdı).

    Ön koşullar (betik hepsini denetler, eksikse `-Apply` ile bile KURULUM
    YAPMAZ; yalnız SEÇİLEN servis(ler) için değerlendirilir):
      1. Yönetici (Administrator) oturumu (yalnız `-Apply` için).
      2. WinSW ikili dosyası (`-WinSwExe` ile verilir; bu repo WinSW'yi
         DAĞITMAZ — resmi https://github.com/winsw/winsw/releases adresinden
         indirilip yerelde bulundurulmalıdır).
      3. Seçilen her servis için ilgili dizin altında GERÇEKTEN
         `dist\index.js` (yani `npm run build` zaten çalıştırılmış).
      4. `Api` seçiliyse: `postgresql-x64-17` servisi kurulu (API
         bağımlılığı).
      5. Seçilen her servis SCM'de HENÜZ kurulu OLMAMALI (idempotency,
         yukarıda).
      6. File Agent için: pCloud senkronize klasör geçişi TAMAMLANMIŞ olmalı
         (bkz. RUNBOOK §2 ve `probe-p-drive-system-context.ps1`). Bu betik
         bunu OTOMATİK doğrulamaz — RUNBOOK'ta ayrı, açık bir insan
         onay adımıdır.

    Şablon XML dosyalarındaki `__NODE_EXE__`/`__APP_DIR__` yer tutucuları
    burada ÇÖZÜLÜR; repo'daki şablonlar HİÇBİR ZAMAN değiştirilmez, yalnız
    kurulum hedefine RENDER edilmiş bir kopya yazılır.

.PARAMETER ApiDir
    `services/api` dağıtım dizininin mutlak yolu (içinde `dist\index.js`
    ve WinSW ikilisi/XML'i bulunacak). `-Services` içinde `Api` yoksa
    GEREKMEZ ve HİÇ okunmaz/doğrulanmaz.

.PARAMETER FileAgentDir
    `services/file-agent` dağıtım dizininin mutlak yolu. `-Services`
    içinde `FileAgent` yoksa GEREKMEZ ve HİÇ okunmaz/doğrulanmaz.

.PARAMETER WinSwExe
    Önceden indirilmiş WinSW ikili dosyasının mutlak yolu.

.PARAMETER NodeExe
    node.exe mutlak yolu. Verilmezse PATH'ten tespit edilir.

.PARAMETER Services
    Hangi servis(ler)in kurulacağı: `Api`, `FileAgent` veya ikisi.
    VARSAYILAN (verilmezse): ikisi de — HB-2026-108'deki orijinal
    davranışla BİREBİR aynı. Yalnız `Api` verilirse File Agent'a ait
    HİÇBİR dosya/dizin okunmaz, doğrulanmaz veya değiştirilmez.

.PARAMETER Apply
    Verilmezse yalnız plan yazdırılır, hiçbir dosya kopyalanmaz/servis
    kurulmaz. Gerçek kurulum için AÇIKÇA verilmelidir.

    Not: PowerShell'in kendi `-Confirm` ortak parametresiyle (bu betik
    `SupportsShouldProcess` kullanır — kurulum adımından hemen önce ayrıca
    tek tek onay sorar) KARIŞTIRILMAMALIDIR; bu yüzden ayrı bir isim
    (`-Apply`) seçildi.

.EXAMPLE
    # Önizleme, her iki servis (varsayılan davranış, hiçbir şey değişmez):
    .\install-services.ps1 -ApiDir C:\HasarBotu\services\api -FileAgentDir C:\HasarBotu\services\file-agent -WinSwExe C:\Tools\WinSW-x64.exe

    # Önizleme, yalnız API (File Agent'a hiç dokunulmaz/bakılmaz):
    .\install-services.ps1 -ApiDir C:\HasarBotu\services\api -WinSwExe C:\Tools\WinSW-x64.exe -Services Api

    # Gerçek kurulum, yalnız API:
    .\install-services.ps1 -ApiDir C:\HasarBotu\services\api -WinSwExe C:\Tools\WinSW-x64.exe -Services Api -Apply
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$ApiDir,
    [string]$FileAgentDir,
    [Parameter(Mandatory = $true)][string]$WinSwExe,
    [string]$NodeExe,
    [ValidateSet('Api', 'FileAgent')]
    [string[]]$Services = @('Api', 'FileAgent'),
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$templateRoot = $PSScriptRoot

try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
} catch {
    # Bazi barindirilmis konsollarda OutputEncoding salt-okunur olabilir;
    # bu yalniz GORUNTUYU etkiler, dosya yazimlarini etkilemez.
}

function Test-IsElevated {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Resolve-NodeExe {
    param([string]$Explicit)
    if ($Explicit) { return $Explicit }
    $found = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($null -eq $found) {
        throw 'node.exe PATH''te bulunamadı. -NodeExe ile mutlak yol verin.'
    }
    return $found.Source
}

function New-RenderedServiceConfig {
    param(
        [string]$TemplatePath,
        [string]$NodeExePath,
        [string]$AppDirPath,
        [string]$OutputPath
    )
    $xml = Get-Content -Raw -LiteralPath $TemplatePath
    $xml = $xml.Replace('__NODE_EXE__', $NodeExePath).Replace('__APP_DIR__', $AppDirPath)
    if ($xml.Contains('__NODE_EXE__') -or $xml.Contains('__APP_DIR__')) {
        throw "Yer tutucu çözümlenemedi: $TemplatePath"
    }
    # Geçerli XML olduğunu KURULUMDAN ÖNCE doğrula; bozuk config asla yazılmaz.
    [xml]$parsed = $xml
    if ($null -eq $parsed) { throw "Render edilen XML geçersiz: $TemplatePath" }
    Set-Content -LiteralPath $OutputPath -Value $xml -Encoding utf8
}

# Sıra ve içerik SABİT: bunlar dışında hiçbir isim asla kabul edilmez.
$selectedServices = @($Services | Select-Object -Unique)
$installApi = $selectedServices -contains 'Api'
$installFileAgent = $selectedServices -contains 'FileAgent'

$issues = New-Object System.Collections.Generic.List[string]

if ($selectedServices.Count -eq 0) {
    $issues.Add('-Services boş olamaz: en az biri Api veya FileAgent olmalı.')
}

# Yükseltme yalnız GERÇEK kurulum (`-Apply`) için gereklidir; salt PLAN
# görüntüleme yükseltme OLMADAN da çalışır (operatör önce güvenle önizler).
if ($Apply -and -not (Test-IsElevated)) { $issues.Add('Yönetici (Administrator) oturumu gerekli (yalnız -Apply ile).') }
if (-not (Test-Path -LiteralPath $WinSwExe)) { $issues.Add("WinSW ikili dosyası bulunamadı: $WinSwExe") }

if ($installApi) {
    if ([string]::IsNullOrWhiteSpace($ApiDir)) {
        $issues.Add('-Services listesi Api içeriyor ama -ApiDir verilmedi.')
    }
    elseif (-not (Test-Path -LiteralPath (Join-Path $ApiDir 'dist\index.js'))) {
        $issues.Add("API build çıktısı yok: $(Join-Path $ApiDir 'dist\index.js') (önce 'npm run build --workspace @hasarbotu/api')")
    }
    $existingApiService = Get-Service -Name 'hasarbotu-api' -ErrorAction SilentlyContinue
    if ($null -ne $existingApiService) {
        $issues.Add('hasarbotu-api servisi ZATEN kurulu - bu betik VAR OLAN bir servisi güncellemez/yeniden kurmaz.')
    }
}
if ($installFileAgent) {
    if ([string]::IsNullOrWhiteSpace($FileAgentDir)) {
        $issues.Add('-Services listesi FileAgent içeriyor ama -FileAgentDir verilmedi.')
    }
    elseif (-not (Test-Path -LiteralPath (Join-Path $FileAgentDir 'dist\index.js'))) {
        $issues.Add("File Agent build çıktısı yok: $(Join-Path $FileAgentDir 'dist\index.js') (önce 'npm run build --workspace @hasarbotu/file-agent')")
    }
    $existingFileAgentService = Get-Service -Name 'hasarbotu-file-agent' -ErrorAction SilentlyContinue
    if ($null -ne $existingFileAgentService) {
        $issues.Add('hasarbotu-file-agent servisi ZATEN kurulu - bu betik VAR OLAN bir servisi güncellemez/yeniden kurmaz.')
    }
}

$postgresService = $null
if ($installApi) {
    $postgresService = Get-Service -Name 'postgresql-x64-17' -ErrorAction SilentlyContinue
    if ($null -eq $postgresService) { $issues.Add('postgresql-x64-17 servisi bulunamadı (API bağımlılığı).') }
}

try { $resolvedNode = Resolve-NodeExe -Explicit $NodeExe } catch { $issues.Add($_.Exception.Message); $resolvedNode = $null }

Write-Host '--- HasarBotu V2 Windows servis kurulumu: PLAN ---' -ForegroundColor Cyan
Write-Host "  Seçilen servisler   : $($selectedServices -join ', ')"
if ($installApi) { Write-Host "  API dizini          : $ApiDir" }
if ($installFileAgent) { Write-Host "  File Agent dizini   : $FileAgentDir" }
Write-Host "  WinSW ikili dosyası : $WinSwExe"
Write-Host "  node.exe            : $resolvedNode"
if ($installApi) { Write-Host "  Postgres servisi    : $(if ($postgresService) { $postgresService.Status } else { 'BULUNAMADI' })" }
Write-Host ''

if ($issues.Count -gt 0) {
    Write-Host '--- Ön koşul HATALARI (kurulum yapılamaz) ---' -ForegroundColor Red
    foreach ($issue in $issues) { Write-Host "  - $issue" -ForegroundColor Red }
    exit 1
}

Write-Host 'Ön koşullar karşılandı.' -ForegroundColor Green
Write-Host ''
Write-Host 'Uygulanacak adımlar (sıra ÖNEMLİDİR):' -ForegroundColor Yellow
$stepNumber = 1
if ($installApi) {
    Write-Host "  $stepNumber. $WinSwExe -> $ApiDir\hasarbotu-api.exe olarak kopyalanır"; $stepNumber++
    Write-Host "  $stepNumber. Şablon render edilir -> $ApiDir\hasarbotu-api.xml"; $stepNumber++
    Write-Host "  $stepNumber. '$ApiDir\hasarbotu-api.exe install' çalıştırılır (hasarbotu-api servisi kurulur)"; $stepNumber++
}
if ($installFileAgent) {
    Write-Host "  $stepNumber. $WinSwExe -> $FileAgentDir\hasarbotu-file-agent.exe olarak kopyalanır"; $stepNumber++
    Write-Host "  $stepNumber. Şablon render edilir -> $FileAgentDir\hasarbotu-file-agent.xml"; $stepNumber++
    Write-Host "  $stepNumber. '$FileAgentDir\hasarbotu-file-agent.exe install' çalıştırılır"; $stepNumber++
}
if (-not $installFileAgent) {
    Write-Host '  (File Agent SEÇİLMEDİ: hiçbir File Agent dosyası/dizini okunmaz, doğrulanmaz veya değiştirilmez.)' -ForegroundColor DarkGray
}
if (-not $installApi) {
    Write-Host '  (API SEÇİLMEDİ: hiçbir API dosyası/dizini okunmaz, doğrulanmaz veya değiştirilmez.)' -ForegroundColor DarkGray
}
Write-Host ''
Write-Host 'Servisler bu betikle BAŞLATILMAZ. Başlatma sırası ve doğrulama için' -ForegroundColor Yellow
Write-Host 'docs/RUNBOOK_FAZ_A_WINDOWS_SERVICE_DEPLOYMENT.md §4''ü izleyin.' -ForegroundColor Yellow
Write-Host ''

if (-not $Apply) {
    Write-Host '-Apply verilmedi: yalnız plan gösterildi, HİÇBİR değişiklik yapılmadı.' -ForegroundColor Cyan
    exit 0
}

if (-not $PSCmdlet.ShouldProcess('HasarBotu Windows servisleri', 'Kur')) {
    exit 0
}

function Install-OneService {
    param([string]$AppDir, [string]$ServiceBaseName, [string]$TemplateName)
    $exeDestination = Join-Path $AppDir "$ServiceBaseName.exe"
    $xmlDestination = Join-Path $AppDir "$ServiceBaseName.xml"
    Copy-Item -LiteralPath $WinSwExe -Destination $exeDestination -Force
    New-RenderedServiceConfig -TemplatePath (Join-Path $templateRoot $TemplateName) `
        -NodeExePath $resolvedNode -AppDirPath $AppDir -OutputPath $xmlDestination
    & $exeDestination install
    if ($LASTEXITCODE -ne 0) { throw "$ServiceBaseName kurulumu başarısız oldu (kod $LASTEXITCODE)." }
    Write-Host "Kuruldu: $ServiceBaseName" -ForegroundColor Green
}

if ($installApi) {
    Install-OneService -AppDir $ApiDir -ServiceBaseName 'hasarbotu-api' -TemplateName 'hasarbotu-api.winsw.xml'
}
if ($installFileAgent) {
    Install-OneService -AppDir $FileAgentDir -ServiceBaseName 'hasarbotu-file-agent' -TemplateName 'hasarbotu-file-agent.winsw.xml'
}

Write-Host ''
Write-Host 'Kurulum tamamlandı. Servisler HENÜZ BAŞLATILMADI.' -ForegroundColor Green
Write-Host 'Başlatma sırası ve sağlık doğrulaması için RUNBOOK §4''ü izleyin.'
