#Requires -Version 5.1
<#
.SYNOPSIS
    Bir sürücü harfinin SYSTEM (Session 0 / Windows servis) bağlamından
    GERÇEKTEN görünüp görünmediğini ölçer (D5, HB-2026-108/109).

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
    okur ve GÖREVİ HER DURUMDA (başarı/hata) kaldırır. Sonuç/log dosyaları
    KALICI olarak `C:\ProgramData\HasarBotu\probe`e yazılır (zaman damgalı,
    üzerine YAZILMAZ) — audit kanıtı ve sonradan inceleme için.

.PARAMETER DriveLetter
    Test edilecek sürücü harfi (varsayılan: P).

.PARAMETER TimeoutSeconds
    Görevin tamamlanmasını bekleme üst sınırı (varsayılan: 90). İlk
    SYSTEM bağlamlı görev çalıştırması Görev Zamanlayıcı/AV taraması
    nedeniyle birkaç saniyeden fazla sürebilir; HB-2026-108'in ilk
    sürümündeki sabit 20 saniyelik sınır bu yüzden gerçek ortamda zaman
    aşımına uğradı (HB-2026-109).

.EXAMPLE
    # Yönetici olarak çalıştırılan bir PowerShell penceresinde:
    .\probe-p-drive-system-context.ps1
    .\probe-p-drive-system-context.ps1 -DriveLetter D -TimeoutSeconds 120

.NOTES
    Yönetici (elevation) GEREKTİRİR — SYSTEM bağlamında görev kaydı ancak
    yükseltilmiş bir oturumdan yapılabilir. Yükseltilmemiş bir oturumda
    çalıştırılırsa betik hiçbir görev oluşturmadan AÇIKÇA durur.
#>
[CmdletBinding()]
param(
    [ValidatePattern('^[A-Za-z]$')]
    [string]$DriveLetter = 'P',

    [ValidateRange(20, 600)]
    [int]$TimeoutSeconds = 90
)

$ErrorActionPreference = 'Stop'

# HB-2026-109: PowerShell 5.1 konsolunda Türkçe karakterlerin bozuk
# görünmesini (mojibake) önler. Dosyalar AYRICA açıkça BOM'suz UTF-8 ile
# okunur/yazılır (aşağıda `Write-Utf8NoBom`/`Read-Utf8`) — konsol kod
# sayfasından TAMAMEN bağımsız, güvenilir bir ikinci katmandır.
try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
} catch {
    # Bazı barındırılmış konsollarda (ör. ISE) OutputEncoding salt-okunur
    # olabilir; bu durumda yalnız görüntü etkilenir, dosya içeriği
    # etkilenmez (bkz. Write-Utf8NoBom).
}

$taskName = 'HasarBotuStorageRootSystemProbe'

function Test-IsElevated {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Write-Utf8NoBom {
    param([string]$Path, [string]$Content)
    $encoding = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Read-Utf8 {
    param([string]$Path)
    return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

# Yükseltme kontrolü, HERHANGİ bir dosya/dizin yan etkisinden ÖNCE yapılır
# (aşağıdaki ProgramData dizini standart bir kullanıcı için de oluşturulabilir
# olsa dahi, "yükseltme yoksa hiçbir iz bırakma" ilkesi korunur).
if (-not (Test-IsElevated)) {
    Write-Error 'Bu betik yönetici (Administrator) yükseltmesi GEREKTİRİR. PowerShell''i "Yönetici olarak çalıştır" ile açıp tekrar deneyin. Hiçbir görev oluşturulmadı.'
    exit 2
}

# HB-2026-109: sonuç/log artık kullanıcı profiline (`$env:TEMP`) DEĞİL,
# makine genelinde her hesabın erişebildiği ProgramData'ya yazılır. Önceki
# sürümün `$env:TEMP`i ÇAĞIRAN (yönetici) oturumun kullanıcı profilinde
# çözüyordu; SYSTEM bağlamındaki görev o profile erişse bile bu, iki farklı
# güvenlik bağlamı arasında gereksiz bir bağımlılıktı ve zaman aşımı
# ayıklamasını zorlaştırıyordu (log YOKTU). ProgramData hem daha doğru hem
# tanılaması daha kolay bir seçimdir.
$workDir = 'C:\ProgramData\HasarBotu\probe'
New-Item -ItemType Directory -Path $workDir -Force | Out-Null

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$resultPath = Join-Path $workDir "probe-result-$stamp.json"
$scriptPath = Join-Path $workDir "probe-inner-$stamp.ps1"
$logPath = Join-Path $workDir "probe-log-$stamp.log"

Write-Host "SYSTEM bağlamından $($DriveLetter):\ görünürlüğü test ediliyor (üst sınır: $TimeoutSeconds sn)..." -ForegroundColor Cyan
Write-Host "Çalışma dizini: $workDir" -ForegroundColor DarkGray

# Devam eden olası bir önceki DENEME (görev) varsa önce temizle. Önceki
# çalıştırmaların sonuç/log dosyaları BİLEREK silinmez (audit izi).
Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false -ErrorAction SilentlyContinue

# İç betik ayrı bir dosyaya yazılır: `Concat` ile sürücü yolu çalışma
# zamanında birleştirilir, betik metninde ham "<Harf>:\" dizgesi GEÇMEZ —
# bu araç zincirindeki yol/kaldırma güvenlik denetimleriyle çakışmayı önler.
#
# HB-2026-109: Görev Zamanlayıcı eylem çıktısını KENDİLİĞİNDEN yakalamaz;
# önceki sürümde bir hata olsa bile HİÇBİR iz kalmıyordu, yalnız "zaman
# aşımı" görünüyordu. `cmd /c ... > log 2>&1` ile dıştan yönlendirme,
# betik yolundaki alan/Unicode karakterlerle iç içe tırnaklama riski
# taşıdığı için TERCİH EDİLMEDİ; bunun yerine iç betiğin KENDİSİ
# `Start-Transcript` ile kendi tüm çıktısını (ve olası istisnaları)
# log dosyasına yazar — dış komut satırı SADE kalır, tırnaklama riski YOK.
$innerLines = @(
    'try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch {}',
    "Start-Transcript -Path '$logPath' -Force | Out-Null",
    'try {',
    '  $result = [ordered]@{}',
    '  $result.whoami = (whoami)',
    '  $result.sessionId = [System.Diagnostics.Process]::GetCurrentProcess().SessionId',
    "  `$drivePath = [string]::Concat('$DriveLetter', ':', [char]92)",
    '  $result.psDriveVisible = [bool](Get-PSDrive -Name ' + $DriveLetter + ' -ErrorAction SilentlyContinue)',
    '  $result.testPathVisible = Test-Path -LiteralPath $drivePath',
    '  try {',
    "    `$result.logicalDisk = [bool](Get-CimInstance Win32_LogicalDisk -Filter `"DeviceID='$($DriveLetter):'`" -ErrorAction Stop)",
    '  } catch {',
    '    $result.logicalDisk = $false',
    '    $result.logicalDiskError = $_.Exception.Message',
    '  }',
    '  try {',
    '    $items = @(Get-ChildItem -LiteralPath $drivePath -ErrorAction Stop | Select-Object -First 3 -ExpandProperty Name)',
    '    $result.listingOk = $true',
    '    $result.listingSampleCount = $items.Count',
    '  } catch {',
    '    $result.listingOk = $false',
    '    $result.listingError = $_.Exception.Message',
    '  }',
    '  $json = $result | ConvertTo-Json',
    '  $resultEncoding = [System.Text.UTF8Encoding]::new($false)',
    "  [System.IO.File]::WriteAllText('$resultPath', `$json, `$resultEncoding)",
    "  Write-Output 'probe tamamlandi'",
    '} catch {',
    '  Write-Output "PROBE HATASI: $($_.Exception.Message)"',
    '} finally {',
    '  Stop-Transcript | Out-Null',
    '}'
)
Write-Utf8NoBom -Path $scriptPath -Content ($innerLines -join "`r`n")

try {
    schtasks /Create /TN $taskName `
        /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`"" `
        /SC ONCE /ST 23:59 /RU SYSTEM /RL HIGHEST /F | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "schtasks /Create başarısız oldu (kod $LASTEXITCODE)." }

    schtasks /Run /TN $taskName | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "schtasks /Run başarısız oldu (kod $LASTEXITCODE)." }

    # HB-2026-109: yalnız sonuç dosyasının VARLIĞINA değil, görevin GERÇEKTEN
    # bitmiş olduğuna (`State -eq 'Ready'`, yani artık çalışmıyor) bakılır —
    # bu, "dosya henüz oluşmadı ama görev de bitti" (kalıcı hata) durumunu
    # "hâlâ çalışıyor" durumundan ayırır ve döngüyü erken sonlandırabilir.
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $taskFinished = $false
    while ((Get-Date) -lt $deadline) {
        if (Test-Path -LiteralPath $resultPath) { break }
        $current = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        if ($null -ne $current -and $current.State -eq 'Ready') { $taskFinished = $true; break }
        Start-Sleep -Milliseconds 500
    }

    $info = Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction SilentlyContinue
    Write-Host ''
    Write-Host '--- Görev Zamanlayıcı tanı bilgisi ---' -ForegroundColor Yellow
    Write-Host "  LastRunTime    : $($info.LastRunTime)"
    Write-Host "  LastTaskResult : $($info.LastTaskResult) (0 = başarı; diğer değerler için: https://learn.microsoft.com/windows/win32/taskschd/task-scheduler-error-and-success-constants)"
    Write-Host "  NumberOfMissedRuns : $($info.NumberOfMissedRuns)"
    if (Test-Path -LiteralPath $logPath) {
        $logContent = (Read-Utf8 -Path $logPath).Trim()
        Write-Host "  Eylem çıktısı (log): $(if ([string]::IsNullOrWhiteSpace($logContent)) { '(boş)' } else { $logContent })"
    } else {
        Write-Host '  Eylem çıktısı (log): (log dosyası henüz oluşmadı)'
    }
    Write-Host "  Sonuç dosyası  : $resultPath"
    Write-Host "  Log dosyası    : $logPath"
    Write-Host ''

    if (-not (Test-Path -LiteralPath $resultPath)) {
        Write-Error "SYSTEM görevi $TimeoutSeconds sn içinde sonuç üretmedi (görev bitti mi: $taskFinished). Yukarıdaki LastTaskResult ve log içeriğini inceleyin; dosyalar $workDir altında kalıcıdır."
        exit 3
    }

    $probe = Read-Utf8 -Path $resultPath | ConvertFrom-Json
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
    # Yalnız GÖREV kaydı kaldırılır (geçici Görev Zamanlayıcı durumu);
    # sonuç/log/iç betik dosyaları KALICI kanıt olarak $workDir'de kalır.
    Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false -ErrorAction SilentlyContinue
}
