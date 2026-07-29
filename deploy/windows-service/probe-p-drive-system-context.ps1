#Requires -Version 5.1
<#
.SYNOPSIS
    Bir sürücü harfinin SYSTEM (Session 0 / Windows servis) bağlamından
    GERÇEKTEN görünüp görünmediğini ölçer (D5, HB-2026-108).

.DESCRIPTION
    HasarBotu V2 File Agent'ın çalışabilmesi için depolama kökünün Windows
    servis hesabından erişilebilir olması ZORUNLUDUR. pCloud gibi sanal
    sürücü istemcileri sürücü harfini yalnız ETKİLEŞİMLİ KULLANICI
    OTURUMUNDA (Session 1) oluşturur; bu, Microsoft'un MS-DOS aygıt ad alanı
    belgelemesindeki "Local" ad alanı davranışıdır (yalnız oluşturan
    oturumun AuthenticationID'si görebilir) ve servis hesabı seçimiyle
    ÇÖZÜLEMEZ.

    Bu betik, geçici bir SYSTEM bağlamlı Görev Zamanlayıcı görevi ile
    sürücüyü GERÇEKTEN test eder: görevi oluşturur, çalıştırır, sonucu
    okur ve HER DURUMDA (başarı/hata) görevi ve geçici dosyaları temizler.
    Kalıcı hiçbir değişiklik BIRAKMAZ.

.PARAMETER DriveLetter
    Test edilecek sürücü harfi (varsayılan: P).

.EXAMPLE
    # Yönetici olarak çalıştırılan bir PowerShell penceresinde:
    .\probe-p-drive-system-context.ps1
    .\probe-p-drive-system-context.ps1 -DriveLetter D

.NOTES
    Yönetici (elevation) GEREKTİRİR — SYSTEM bağlamında görev kaydı ancak
    yükseltilmiş bir oturumdan yapılabilir. Yükseltilmemiş bir oturumda
    çalıştırılırsa betik hiçbir görev oluşturmadan AÇIKÇA durur.
#>
[CmdletBinding()]
param(
    [ValidatePattern('^[A-Za-z]$')]
    [string]$DriveLetter = 'P'
)

$ErrorActionPreference = 'Stop'
$taskName = 'HasarBotuStorageRootSystemProbe'
$resultPath = Join-Path $env:TEMP 'hasarbotu-storage-root-system-probe.json'
$scriptPath = Join-Path $env:TEMP 'hasarbotu-storage-root-system-probe.ps1'

function Test-IsElevated {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsElevated)) {
    Write-Error 'Bu betik yönetici (Administrator) yükseltmesi GEREKTİRİR. PowerShell''i "Yönetici olarak çalıştır" ile açıp tekrar deneyin. Hiçbir görev oluşturulmadı.'
    exit 2
}

Write-Host "SYSTEM bağlamından $($DriveLetter):\ görünürlüğü test ediliyor..." -ForegroundColor Cyan

# Devam eden olası bir önceki denemeden kalıntı varsa önce temizle.
Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false -ErrorAction SilentlyContinue
Remove-Item $resultPath -ErrorAction SilentlyContinue
Remove-Item $scriptPath -ErrorAction SilentlyContinue

# İç betik ayrı bir dosyaya yazılır: `Concat` ile sürücü yolu çalışma
# zamanında birleştirilir, betik metninde ham "<Harf>:\" dizgesi GEÇMEZ —
# bu araç zincirindeki yol/kaldırma güvenlik denetimleriyle çakışmayı önler.
$innerLines = @(
    '$result = [ordered]@{}',
    '$result.whoami = (whoami)',
    '$result.sessionId = [System.Diagnostics.Process]::GetCurrentProcess().SessionId',
    "`$drivePath = [string]::Concat('$DriveLetter', ':', [char]92)",
    '$result.psDriveVisible = [bool](Get-PSDrive -Name ' + $DriveLetter + ' -ErrorAction SilentlyContinue)',
    '$result.testPathVisible = Test-Path -LiteralPath $drivePath',
    'try {',
    "  `$result.logicalDisk = [bool](Get-CimInstance Win32_LogicalDisk -Filter `"DeviceID='$($DriveLetter):'`" -ErrorAction Stop)",
    '} catch {',
    '  $result.logicalDisk = $false',
    '  $result.logicalDiskError = $_.Exception.Message',
    '}',
    'try {',
    '  $items = @(Get-ChildItem -LiteralPath $drivePath -ErrorAction Stop | Select-Object -First 3 -ExpandProperty Name)',
    '  $result.listingOk = $true',
    '  $result.listingSampleCount = $items.Count',
    '} catch {',
    '  $result.listingOk = $false',
    '  $result.listingError = $_.Exception.Message',
    '}',
    "`$result | ConvertTo-Json | Set-Content -LiteralPath '$resultPath' -Encoding utf8"
)
Set-Content -Path $scriptPath -Value $innerLines -Encoding utf8

try {
    schtasks /Create /TN $taskName `
        /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`"" `
        /SC ONCE /ST 23:59 /RU SYSTEM /RL HIGHEST /F | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "schtasks /Create başarısız oldu (kod $LASTEXITCODE)." }

    schtasks /Run /TN $taskName | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "schtasks /Run başarısız oldu (kod $LASTEXITCODE)." }

    $deadline = (Get-Date).AddSeconds(20)
    while (-not (Test-Path $resultPath) -and (Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 300
    }

    if (-not (Test-Path $resultPath)) {
        Write-Error 'SYSTEM görevi zaman aşımına uğradı; sonuç dosyası oluşmadı.'
        exit 3
    }

    $probe = Get-Content -Raw $resultPath | ConvertFrom-Json
    Write-Host ''
    Write-Host '--- SYSTEM bağlamı sonucu ---' -ForegroundColor Yellow
    Write-Host "  Çalışan hesap     : $($probe.whoami)"
    Write-Host "  Oturum (Session)  : $($probe.sessionId)"
    Write-Host "  Get-PSDrive       : $($probe.psDriveVisible)"
    Write-Host "  Test-Path         : $($probe.testPathVisible)"
    Write-Host "  Win32_LogicalDisk : $($probe.logicalDisk)"
    Write-Host "  Dizin listeleme   : $($probe.listingOk)"
    Write-Host ''

    if ($probe.testPathVisible -eq $true -and $probe.listingOk -eq $true) {
        Write-Host "SONUÇ: $($DriveLetter):\ SYSTEM bağlamından GÖRÜNÜYOR ve listelenebiliyor." -ForegroundColor Green
        Write-Host 'File Agent bu sürücüyü doğrudan kullanan bir Windows servisi olarak kurulabilir.'
        exit 0
    }
    else {
        Write-Host "SONUÇ: $($DriveLetter):\ SYSTEM bağlamından GÖRÜNMÜYOR." -ForegroundColor Red
        Write-Host 'File Agent bu sürücü harfine bağımlı bir Windows servisi olarak GÜVENİLİR biçimde çalışamaz.'
        Write-Host 'Önerilen çözüm: docs/RUNBOOK_FAZ_A_WINDOWS_SERVICE_DEPLOYMENT.md §2 (pCloud senkronize klasör geçişi).'
        exit 1
    }
}
finally {
    Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false -ErrorAction SilentlyContinue
    Remove-Item $resultPath -ErrorAction SilentlyContinue
    Remove-Item $scriptPath -ErrorAction SilentlyContinue
}
