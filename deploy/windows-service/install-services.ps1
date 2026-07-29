#Requires -Version 5.1
<#
.SYNOPSIS
    HasarBotu V2 API ve File Agent'ı WinSW ile Windows servisi olarak kurar
    (D5, HB-2026-108). PLANLA -> ÖNİZLE -> ONAY -> UYGULA -> DOĞRULA modeli.

.DESCRIPTION
    `-Apply` verilmeden bu betik HİÇBİR kalıcı değişiklik yapmaz; yalnız
    ön koşulları denetler ve YAPILACAK işlemleri yazdırır (dry run). Bu,
    AGENTS.md §7 "kritik işlem standardı"nın kuruluma uygulanmasıdır.

    Ön koşullar (betik hepsini denetler, eksikse `-Apply` ile bile KURULUM
    YAPMAZ):
      1. Yönetici (Administrator) oturumu.
      2. WinSW ikili dosyası (`-WinSwExe` ile verilir; bu repo WinSW'yi
         DAĞITMAZ — resmi https://github.com/winsw/winsw/releases adresinden
         indirilip yerelde bulundurulmalıdır).
      3. `-ApiDir` ve `-FileAgentDir` altında GERÇEKTEN `dist\index.js`
         (yani `npm run build` zaten çalıştırılmış).
      4. `postgresql-x64-17` servisi kurulu (API bağımlılığı).
      5. File Agent için: pCloud senkronize klasör geçişi TAMAMLANMIŞ olmalı
         (bkz. RUNBOOK §2 ve `probe-p-drive-system-context.ps1`). Bu betik
         bunu OTOMATİK doğrulamaz — RUNBOOK'ta ayrı, açık bir insan
         onay adımıdır.

    Şablon XML dosyalarındaki `__NODE_EXE__`/`__APP_DIR__` yer tutucuları
    burada ÇÖZÜLÜR; repo'daki şablonlar HİÇBİR ZAMAN değiştirilmez, yalnız
    kurulum hedefine RENDER edilmiş bir kopya yazılır.

.PARAMETER ApiDir
    `services/api` dağıtım dizininin mutlak yolu (içinde `dist\index.js`
    ve WinSW ikilisi/XML'i bulunacak).

.PARAMETER FileAgentDir
    `services/file-agent` dağıtım dizininin mutlak yolu.

.PARAMETER WinSwExe
    Önceden indirilmiş WinSW ikili dosyasının mutlak yolu.

.PARAMETER NodeExe
    node.exe mutlak yolu. Verilmezse PATH'ten tespit edilir.

.PARAMETER Apply
    Verilmezse yalnız plan yazdırılır, hiçbir dosya kopyalanmaz/servis
    kurulmaz. Gerçek kurulum için AÇIKÇA verilmelidir.

    Not: PowerShell'in kendi `-Confirm` ortak parametresiyle (bu betik
    `SupportsShouldProcess` kullanır — kurulum adımından hemen önce ayrıca
    tek tek onay sorar) KARIŞTIRILMAMALIDIR; bu yüzden ayrı bir isim
    (`-Apply`) seçildi.

.EXAMPLE
    # Önizleme (hiçbir şey değişmez):
    .\install-services.ps1 -ApiDir C:\HasarBotu\services\api -FileAgentDir C:\HasarBotu\services\file-agent -WinSwExe C:\Tools\WinSW-x64.exe

    # Gerçek kurulum:
    .\install-services.ps1 -ApiDir C:\HasarBotu\services\api -FileAgentDir C:\HasarBotu\services\file-agent -WinSwExe C:\Tools\WinSW-x64.exe -Apply
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)][string]$ApiDir,
    [Parameter(Mandatory = $true)][string]$FileAgentDir,
    [Parameter(Mandatory = $true)][string]$WinSwExe,
    [string]$NodeExe,
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$templateRoot = $PSScriptRoot

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

$issues = New-Object System.Collections.Generic.List[string]

# Yükseltme yalnız GERÇEK kurulum (`-Apply`) için gereklidir; salt PLAN
# görüntüleme yükseltme OLMADAN da çalışır (operatör önce güvenle önizler).
if ($Apply -and -not (Test-IsElevated)) { $issues.Add('Yönetici (Administrator) oturumu gerekli (yalnız -Apply ile).') }
if (-not (Test-Path -LiteralPath $WinSwExe)) { $issues.Add("WinSW ikili dosyası bulunamadı: $WinSwExe") }
if (-not (Test-Path -LiteralPath (Join-Path $ApiDir 'dist\index.js'))) {
    $issues.Add("API build çıktısı yok: $(Join-Path $ApiDir 'dist\index.js') (önce 'npm run build --workspace @hasarbotu/api')")
}
if (-not (Test-Path -LiteralPath (Join-Path $FileAgentDir 'dist\index.js'))) {
    $issues.Add("File Agent build çıktısı yok: $(Join-Path $FileAgentDir 'dist\index.js') (önce 'npm run build --workspace @hasarbotu/file-agent')")
}
$postgresService = Get-Service -Name 'postgresql-x64-17' -ErrorAction SilentlyContinue
if ($null -eq $postgresService) { $issues.Add('postgresql-x64-17 servisi bulunamadı (API bağımlılığı).') }

try { $resolvedNode = Resolve-NodeExe -Explicit $NodeExe } catch { $issues.Add($_.Exception.Message); $resolvedNode = $null }

Write-Host '--- HasarBotu V2 Windows servis kurulumu: PLAN ---' -ForegroundColor Cyan
Write-Host "  API dizini          : $ApiDir"
Write-Host "  File Agent dizini   : $FileAgentDir"
Write-Host "  WinSW ikili dosyası : $WinSwExe"
Write-Host "  node.exe            : $resolvedNode"
Write-Host "  Postgres servisi    : $(if ($postgresService) { $postgresService.Status } else { 'BULUNAMADI' })"
Write-Host ''

if ($issues.Count -gt 0) {
    Write-Host '--- Ön koşul HATALARI (kurulum yapılamaz) ---' -ForegroundColor Red
    foreach ($issue in $issues) { Write-Host "  - $issue" -ForegroundColor Red }
    exit 1
}

Write-Host 'Ön koşullar karşılandı.' -ForegroundColor Green
Write-Host ''
Write-Host 'Uygulanacak adımlar (sıra ÖNEMLİDİR):' -ForegroundColor Yellow
Write-Host "  1. $WinSwExe -> $ApiDir\hasarbotu-api.exe olarak kopyalanır"
Write-Host "  2. Şablon render edilir -> $ApiDir\hasarbotu-api.xml"
Write-Host "  3. '$ApiDir\hasarbotu-api.exe install' çalıştırılır (hasarbotu-api servisi kurulur)"
Write-Host "  4. $WinSwExe -> $FileAgentDir\hasarbotu-file-agent.exe olarak kopyalanır"
Write-Host "  5. Şablon render edilir -> $FileAgentDir\hasarbotu-file-agent.xml"
Write-Host "  6. '$FileAgentDir\hasarbotu-file-agent.exe install' çalıştırılır"
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

Install-OneService -AppDir $ApiDir -ServiceBaseName 'hasarbotu-api' -TemplateName 'hasarbotu-api.winsw.xml'
Install-OneService -AppDir $FileAgentDir -ServiceBaseName 'hasarbotu-file-agent' -TemplateName 'hasarbotu-file-agent.winsw.xml'

Write-Host ''
Write-Host 'Kurulum tamamlandı. Servisler HENÜZ BAŞLATILMADI.' -ForegroundColor Green
Write-Host 'Başlatma sırası ve sağlık doğrulaması için RUNBOOK §4''ü izleyin.'
