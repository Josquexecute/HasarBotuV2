#Requires -Version 5.1
<#
.SYNOPSIS
    HasarBotu V2 servis build çıktısını (yalnız `dist\` + `package.json`)
    kontrollü biçimde bir dağıtım dizinine hazırlar (D9 ikinci küçük
    paketi, HB-2026-143). PLANLA -> ÖNİZLE -> ONAY -> UYGULA -> DOĞRULA
    modeli.

.DESCRIPTION
    Bu betik servis KURMAZ, ortam değişkeni YAZMAZ, servis BAŞLATMAZ —
    yalnız `-SourceDir` altındaki ALLOWLIST'teki dosyaları (`dist\`
    tamamı + `package.json`, başka HİÇBİR ŞEY) `-TargetDir`e güvenli,
    fail-closed, idempotent bir şekilde kopyalar. Sonraki adımlar
    (`install-services.ps1 -Services Api`, secret/env ayarlama, servis
    başlatma) RUNBOOK'ta ayrı, açık adımlardır.

    `-Apply` VERİLMEDEN hiçbir kalıcı değişiklik yapılmaz; yalnız mevcut
    durum + plan yazdırılır (AGENTS.md §7).

    ÖNKOŞULLAR (hepsi fail-closed; eksikse `-Apply` ile bile UYGULANMAZ):
      - `-SourceDir\dist\index.js` ve `-SourceDir\package.json` gerçekten
        var.
      - `dist\` altında hiçbir reparse point/symlink yok.
      - Hedef birimde yeterli boş alan var (`-RequiredFreeSpaceMultiplier`
        çarpanıyla).
      - Hedef dizinin ebeveynine yazma izni var (gerçek bir prob dosyasıyla
        doğrulanır).
      - `-Apply` için Yönetici (Administrator) oturumu.

    İDEMPOTENCY: `-TargetDir`de ZATEN aynı içerik (aynı göreli yol
    kümesi + aynı SHA-256'lar) varsa, `-Apply` bile hiçbir şey
    DEĞİŞTİRMEZ — `already_up_to_date` ile başarıyla biter (yedek/
    değiştirme adımları tamamen ATLANIR).

    YEDEKLEME: `-TargetDir` zaten mevcutsa (önceki bir dağıtım), UYGULAMA
    öncesi bu dizin OLDUĞU GİBİ (kopyalama değil, atomik `Directory.Move`
    ile — bayt bayt aynı, anlık) Administrators-only, zaman damgalı bir
    yedek konumuna taşınır; yedeğin göreli-yol+SHA-256 haritası ayrı bir
    JSON manifest dosyasına yazılır.

    ATOMİK DEĞİŞTİRME: Yeni içerik önce `-TargetDir` ile AYNI birimde bir
    staging dizinine kopyalanır, HER dosyanın hash'i kaynakla karşılaştırılıp
    doğrulanır; yalnız hepsi geçerse staging dizini `-TargetDir`e
    `Directory.Move` ile (aynı birimde tek bir atomik yeniden adlandırma)
    taşınır. Uygulama sonrası, `-TargetDir`deki HER dosya YENİDEN diskten
    okunup hash'i kaynağın ORİJİNAL (staging'e değil) hash'iyle bağımsız
    olarak tekrar doğrulanır.

    ROLLBACK: `-Rollback -RollbackBackupPath <tam yol>` ile, belirtilen
    yedek dizini (önce kendi manifest'ine karşı bütünlüğü doğrulanarak)
    `-TargetDir`e geri taşınır; o sırada `-TargetDir`de bulunan içerik de
    (varsa) AYNI şekilde yeni bir "pre-rollback" yedeğine taşınır — hiçbir
    veri asla silinmez, yalnız taşınır. Rollback da `-Apply` GEREKTİRİR.

.PARAMETER SourceDir
    Build edilmiş servis paketinin kök dizini (içinde `dist\index.js` ve
    `package.json` bulunmalı). Örn. `services/api` (repo içi).

.PARAMETER TargetDir
    Dağıtım hedef dizini. Örn. `C:\HasarBotu\services\api`.

.PARAMETER ServiceLabel
    Yedek/manifest dosya adlarında kullanılan güvenli tanımlayıcı
    (yalnız `[a-zA-Z0-9_-]`, ör. `api`).

.PARAMETER RequiredFreeSpaceMultiplier
    Hedef birimde, toplam dağıtım boyutunun kaç katı boş alan
    gerektiği (varsayılan 3 — mevcut D7/D8 araçlarıyla aynı kural).

.PARAMETER Apply
    Verilmezse yalnız plan yazdırılır, hiçbir dosya kopyalanmaz/
    taşınmaz. Gerçek uygulama için AÇIKÇA verilmelidir.

.PARAMETER Rollback
    Verilirse betik dağıtım YERİNE `-RollbackBackupPath`teki yedeği geri
    yükleme PLANINI/İŞLEMİNİ çalıştırır (yine `-Apply` gerektirir).

.PARAMETER RollbackBackupPath
    `-Rollback` ile ZORUNLU: geri yüklenecek Administrators-only yedek
    dizininin TAM yolu (asla otomatik/en-son-olan seçilmez).

.EXAMPLE
    # Önizleme (hiçbir şey değişmez):
    .\deploy-service-artifacts.ps1 -SourceDir C:\...\services\api -TargetDir C:\HasarBotu\services\api -ServiceLabel api

    # Gerçek uygulama:
    .\deploy-service-artifacts.ps1 -SourceDir C:\...\services\api -TargetDir C:\HasarBotu\services\api -ServiceLabel api -Apply

    # Rollback önizlemesi:
    .\deploy-service-artifacts.ps1 -TargetDir C:\HasarBotu\services\api -ServiceLabel api -Rollback -RollbackBackupPath 'C:\ProgramData\HasarBotu\migration-preflight\pre-deploy-backups\api-20260804T120000000Z-abcd1234'
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$SourceDir,

    [Parameter(Mandatory = $true)]
    [string]$TargetDir,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-zA-Z0-9_-]+$')]
    [string]$ServiceLabel,

    [ValidateRange(1, 100)]
    [double]$RequiredFreeSpaceMultiplier = 3,

    [switch]$Apply,

    [switch]$Rollback,

    [string]$RollbackBackupPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# MUST be the first console-touching statement in this process (confirmed
# empirically, HB-2026-142): .NET caches the console writer on first use,
# so setting OutputEncoding after any earlier output in this same process
# silently has no effect on it.
try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
} catch {
    # Bazi barindirilmis konsollarda OutputEncoding salt-okunur olabilir;
    # bu yalniz GORUNTUYU etkiler, dosya yazimlarini etkilemez.
}

$AdministratorSidValue = 'S-1-5-32-544'
$BackupRootDirectory = 'C:\ProgramData\HasarBotu\migration-preflight\pre-deploy-backups'
$AllowlistTopLevelDir = 'dist'
$AllowlistTopLevelFile = 'package.json'
$exitCode = 1

function Throw-SafeError {
    param([string]$Code)
    $exception = [System.InvalidOperationException]::new($Code)
    $exception.Data['SafeCode'] = $Code
    throw $exception
}

function Test-IsElevated {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function New-AdminOnlySecurity {
    param([bool]$Directory)
    $administratorSid = [System.Security.Principal.SecurityIdentifier]::new($AdministratorSidValue)
    $security = if ($Directory) { [System.Security.AccessControl.DirectorySecurity]::new() } else { [System.Security.AccessControl.FileSecurity]::new() }
    $security.SetAccessRuleProtection($true, $false)
    $security.SetOwner($administratorSid)
    $inheritance = if ($Directory) { ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit) } else { [System.Security.AccessControl.InheritanceFlags]::None }
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($administratorSid, [System.Security.AccessControl.FileSystemRights]::FullControl, $inheritance, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
    $security.AddAccessRule($rule)
    return $security
}

function Set-AdminOnlySecurityOn {
    param([string]$Path, [bool]$Directory)
    if ($Directory) {
        [System.IO.Directory]::SetAccessControl($Path, (New-AdminOnlySecurity $true))
    }
    else {
        [System.IO.File]::SetAccessControl($Path, (New-AdminOnlySecurity $false))
    }
}

function Get-Sha256 {
    param([string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

# Allowlist enumerasyonu YAPISAL olarak sınırlıdır: yalnız $AllowlistTopLevelDir
# (özyinelemeli) ve $AllowlistTopLevelFile taranır -- kaynak kökte başka ne
# olursa olsun (node_modules, src, test-support, .env vb.) bu fonksiyon
# ONLARI HİÇ GÖRMEZ, HİÇ OKUMAZ.
function Get-AllowlistedManifest {
    param([string]$Root)
    $entries = [System.Collections.Generic.List[object]]::new()
    $distRoot = Join-Path $Root $AllowlistTopLevelDir
    if ([System.IO.Directory]::Exists($distRoot)) {
        $distRootInfo = [System.IO.DirectoryInfo]::new($distRoot)
        if ($distRootInfo.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
            Throw-SafeError 'SOURCE_DIST_REPARSE_POINT'
        }
        $stack = [System.Collections.Generic.Stack[string]]::new()
        $stack.Push($distRoot)
        while ($stack.Count -gt 0) {
            $current = $stack.Pop()
            foreach ($dir in [System.IO.Directory]::GetDirectories($current)) {
                $dirInfo = [System.IO.DirectoryInfo]::new($dir)
                if ($dirInfo.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
                    Throw-SafeError 'SOURCE_DIST_REPARSE_POINT'
                }
                $stack.Push($dir)
            }
            foreach ($file in [System.IO.Directory]::GetFiles($current)) {
                $fileInfo = [System.IO.FileInfo]::new($file)
                if ($fileInfo.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
                    Throw-SafeError 'SOURCE_DIST_REPARSE_POINT'
                }
                $relativePath = $file.Substring($Root.Length).TrimStart('\', '/')
                $entries.Add([pscustomobject]@{
                    RelativePath = $relativePath
                    FullPath = $file
                    Sha256 = Get-Sha256 $file
                    Size = $fileInfo.Length
                })
            }
        }
    }
    $packageJsonPath = Join-Path $Root $AllowlistTopLevelFile
    if ([System.IO.File]::Exists($packageJsonPath)) {
        $entries.Add([pscustomobject]@{
            RelativePath = $AllowlistTopLevelFile
            FullPath = $packageJsonPath
            Sha256 = Get-Sha256 $packageJsonPath
            Size = ([System.IO.FileInfo]::new($packageJsonPath)).Length
        })
    }
    return @($entries | Sort-Object RelativePath)
}

function Test-ManifestsIdentical {
    param([object[]]$Left, [object[]]$Right)
    if ($Left.Count -ne $Right.Count) { return $false }
    for ($i = 0; $i -lt $Left.Count; $i++) {
        if ($Left[$i].RelativePath -ne $Right[$i].RelativePath -or $Left[$i].Sha256 -ne $Right[$i].Sha256) {
            return $false
        }
    }
    return $true
}

function Test-WriteAccessProbe {
    param([string]$DirectoryPath)
    try {
        if (-not [System.IO.Directory]::Exists($DirectoryPath)) {
            [System.IO.Directory]::CreateDirectory($DirectoryPath) | Out-Null
        }
        $probePath = Join-Path $DirectoryPath (".hasarbotu-deploy-write-probe-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
        [System.IO.File]::WriteAllText($probePath, 'probe')
        [System.IO.File]::Delete($probePath)
        return $true
    }
    catch {
        return $false
    }
}

try {
    if ($Rollback) {
        # ------------------------------------------------------------
        # ROLLBACK MODU
        # ------------------------------------------------------------
        if ([string]::IsNullOrWhiteSpace($RollbackBackupPath)) { Throw-SafeError 'ROLLBACK_BACKUP_PATH_REQUIRED' }
        $target = [System.IO.Path]::GetFullPath($TargetDir).TrimEnd('\')
        $backupPath = [System.IO.Path]::GetFullPath($RollbackBackupPath).TrimEnd('\')
        $backupManifestPath = "$backupPath.manifest.json"

        $issues = [System.Collections.Generic.List[string]]::new()
        if (-not [System.IO.Directory]::Exists($backupPath)) { $issues.Add("Belirtilen yedek dizini yok: $backupPath") }
        if (-not [System.IO.File]::Exists($backupManifestPath)) { $issues.Add("Yedek manifest dosyası yok: $backupManifestPath") }

        $recordedManifest = $null
        if ($issues.Count -eq 0) {
            $recordedManifest = (Get-Content -LiteralPath $backupManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json).Entries
            $currentBackupManifest = Get-AllowlistedManifest $backupPath
            if (-not (Test-ManifestsIdentical @($recordedManifest | ForEach-Object { [pscustomobject]@{ RelativePath = $_.RelativePath; Sha256 = $_.Sha256 } }) @($currentBackupManifest | ForEach-Object { [pscustomobject]@{ RelativePath = $_.RelativePath; Sha256 = $_.Sha256 } }))) {
                $issues.Add('Yedek dizininin içeriği kayıtlı manifest ile eşleşmiyor (bütünlük hatası) — rollback GÜVENLİ DEĞİL.')
            }
        }

        $mode = if ($Apply) { 'rollback-apply' } else { 'rollback-preview' }
        Write-Host "--- HasarBotu V2 servis dağıtımı ROLLBACK: $mode ---" -ForegroundColor Cyan
        Write-Host "  Hedef dizin  : $target"
        Write-Host "  Yedek dizini : $backupPath"
        Write-Host ''

        if ($issues.Count -gt 0) {
            Write-Host '--- Ön koşul HATALARI (rollback yapılamaz) ---' -ForegroundColor Red
            foreach ($issue in $issues) { Write-Host "  - $issue" -ForegroundColor Red }
            $result = [ordered]@{
                SchemaVersion = 'hasarbotu-deploy-service-artifacts/1.0.0'
                Mode = $mode
                Status = 'blocked'
                Blockers = @($issues)
            }
            $result | ConvertTo-Json -Depth 6
            exit 2
        }

        Write-Host 'Ön koşullar karşılandı. Yedek bütünlüğü doğrulandı.' -ForegroundColor Green
        if (-not $Apply) {
            Write-Host '-Apply verilmedi: yalnız plan gösterildi, HİÇBİR değişiklik yapılmadı.' -ForegroundColor Cyan
            $result = [ordered]@{
                SchemaVersion = 'hasarbotu-deploy-service-artifacts/1.0.0'
                Mode = $mode
                Status = 'would_rollback'
                Blockers = @()
            }
            $result | ConvertTo-Json -Depth 6
            exit 0
        }
        if (-not (Test-IsElevated)) { Throw-SafeError 'ADMINISTRATOR_REQUIRED_FOR_APPLY' }
        if (-not $PSCmdlet.ShouldProcess($target, 'Rollback')) { exit 0 }

        $preRollbackBackupPath = $null
        if ([System.IO.Directory]::Exists($target)) {
            $timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
            $suffix = [Guid]::NewGuid().ToString('N').Substring(0, 8)
            [System.IO.Directory]::CreateDirectory($BackupRootDirectory) | Out-Null
            Set-AdminOnlySecurityOn $BackupRootDirectory $true
            $preRollbackBackupPath = Join-Path $BackupRootDirectory "$ServiceLabel-pre-rollback-$timestamp-$suffix"
            [System.IO.Directory]::Move($target, $preRollbackBackupPath)
            Set-AdminOnlySecurityOn $preRollbackBackupPath $true
            $preRollbackManifest = Get-AllowlistedManifest $preRollbackBackupPath
            $preRollbackManifestJson = [ordered]@{ GeneratedAtUtc = [DateTime]::UtcNow.ToString('o'); Entries = $preRollbackManifest } | ConvertTo-Json -Depth 6
            $preRollbackManifestPath = "$preRollbackBackupPath.manifest.json"
            [System.IO.File]::WriteAllText($preRollbackManifestPath, $preRollbackManifestJson, [System.Text.UTF8Encoding]::new($false))
            Set-AdminOnlySecurityOn $preRollbackManifestPath $false
        }
        [System.IO.Directory]::Move($backupPath, $target)
        [System.IO.File]::Delete($backupManifestPath)

        $finalManifest = Get-AllowlistedManifest $target
        $verifyMismatches = @()
        foreach ($entry in $recordedManifest) {
            $match = $finalManifest | Where-Object { $_.RelativePath -eq $entry.RelativePath }
            if ($null -eq $match -or $match.Sha256 -ne $entry.Sha256) { $verifyMismatches += $entry.RelativePath }
        }

        $result = [ordered]@{
            SchemaVersion = 'hasarbotu-deploy-service-artifacts/1.0.0'
            Mode = $mode
            Status = if ($verifyMismatches.Count -eq 0) { 'rolled_back' } else { 'error' }
            PreRollbackBackupPath = $preRollbackBackupPath
            PostRollbackVerificationMismatches = @($verifyMismatches)
            Blockers = @()
        }
        $result | ConvertTo-Json -Depth 6
        exit $(if ($verifyMismatches.Count -eq 0) { 0 } else { 1 })
    }

    # ------------------------------------------------------------
    # DEPLOY MODU (varsayılan)
    # ------------------------------------------------------------
    if ([string]::IsNullOrWhiteSpace($SourceDir)) { Throw-SafeError 'SOURCE_DIR_REQUIRED' }
    $source = [System.IO.Path]::GetFullPath($SourceDir).TrimEnd('\')
    $target = [System.IO.Path]::GetFullPath($TargetDir).TrimEnd('\')
    if ([string]::Equals($source, $target, [StringComparison]::OrdinalIgnoreCase)) { Throw-SafeError 'SOURCE_TARGET_MUST_DIFFER' }

    $issues = [System.Collections.Generic.List[string]]::new()

    if (-not [System.IO.Directory]::Exists($source)) { $issues.Add("Kaynak dizin yok: $source") }
    $sourceDistIndex = Join-Path $source (Join-Path $AllowlistTopLevelDir 'index.js')
    if ([System.IO.Directory]::Exists($source) -and -not [System.IO.File]::Exists($sourceDistIndex)) {
        $issues.Add("Build çıktısı yok: $sourceDistIndex (önce 'npm run build' çalıştırılmalı)")
    }
    $sourcePackageJson = Join-Path $source $AllowlistTopLevelFile
    if ([System.IO.Directory]::Exists($source) -and -not [System.IO.File]::Exists($sourcePackageJson)) {
        $issues.Add("package.json yok: $sourcePackageJson")
    }

    $sourceManifest = @()
    if ($issues.Count -eq 0) {
        try { $sourceManifest = Get-AllowlistedManifest $source }
        catch { $issues.Add("Kaynak envanteri okunamadı: $($_.Exception.Data['SafeCode'])") }
    }
    $totalBytes = 0
    if ($sourceManifest.Count -gt 0) {
        $totalBytes = ($sourceManifest | Measure-Object -Property Size -Sum).Sum
    }

    $targetParent = Split-Path -Path $target -Parent
    if (-not [System.IO.Directory]::Exists($targetParent)) {
        $issues.Add("Hedef dizinin ebeveyni yok: $targetParent")
    }
    elseif (-not (Test-WriteAccessProbe $targetParent)) {
        $issues.Add("Hedef dizinin ebeveynine yazma izni yok: $targetParent")
    }

    $targetDriveRoot = $null
    $capacityPass = $false
    if ([System.IO.Directory]::Exists($targetParent)) {
        $targetDriveRoot = [System.IO.Path]::GetPathRoot($target)
        $targetDrive = [System.IO.DriveInfo]::new($targetDriveRoot)
        $requiredFreeBytes = [decimal]$totalBytes * [decimal]$RequiredFreeSpaceMultiplier
        $capacityPass = [decimal]$targetDrive.AvailableFreeSpace -ge $requiredFreeBytes
        if (-not $capacityPass) { $issues.Add("Hedef birimde ($targetDriveRoot) yeterli boş alan yok (gerekli: ${RequiredFreeSpaceMultiplier}x = $requiredFreeBytes bayt).") }
    }

    $targetExists = [System.IO.Directory]::Exists($target)
    $targetManifest = @()
    $alreadyUpToDate = $false
    if ($targetExists -and $issues.Count -eq 0) {
        $targetManifest = Get-AllowlistedManifest $target
        $alreadyUpToDate = Test-ManifestsIdentical $sourceManifest $targetManifest
    }

    if ($Apply -and -not $alreadyUpToDate -and -not (Test-IsElevated)) {
        $issues.Add('Yönetici (Administrator) oturumu gerekli (yalnız -Apply ile, zaten güncel değilse).')
    }

    $mode = if ($Apply) { 'apply' } else { 'preview' }
    Write-Host "--- HasarBotu V2 servis dağıtımı: $mode ($ServiceLabel) ---" -ForegroundColor Cyan
    Write-Host "  Kaynak dizin        : $source"
    Write-Host "  Hedef dizin         : $target"
    Write-Host "  Allowlist dosya sayısı : $($sourceManifest.Count)"
    Write-Host "  Toplam bayt         : $totalBytes"
    Write-Host "  Hedef zaten var mı  : $targetExists"
    if ($targetExists -and $issues.Count -eq 0) { Write-Host "  Hedef zaten güncel mi : $alreadyUpToDate" }
    Write-Host ''

    if ($issues.Count -gt 0) {
        Write-Host '--- Ön koşul HATALARI (dağıtım yapılamaz) ---' -ForegroundColor Red
        foreach ($issue in $issues) { Write-Host "  - $issue" -ForegroundColor Red }
        $result = [ordered]@{
            SchemaVersion = 'hasarbotu-deploy-service-artifacts/1.0.0'
            Mode = $mode
            Status = 'blocked'
            ServiceLabel = $ServiceLabel
            AllowlistFileCount = $sourceManifest.Count
            TotalBytes = [int64]$totalBytes
            Blockers = @($issues)
        }
        $result | ConvertTo-Json -Depth 8
        exit 2
    }

    if ($alreadyUpToDate) {
        Write-Host 'Hedef zaten kaynakla BİREBİR aynı — hiçbir değişiklik gerekmiyor (idempotent).' -ForegroundColor Green
        $result = [ordered]@{
            SchemaVersion = 'hasarbotu-deploy-service-artifacts/1.0.0'
            Mode = $mode
            Status = 'already_up_to_date'
            ServiceLabel = $ServiceLabel
            AllowlistFileCount = $sourceManifest.Count
            TotalBytes = [int64]$totalBytes
            Blockers = @()
        }
        $result | ConvertTo-Json -Depth 8
        exit 0
    }

    Write-Host 'Ön koşullar karşılandı.' -ForegroundColor Green
    Write-Host ''
    Write-Host 'Uygulanacak adımlar (sıra ÖNEMLİDİR):' -ForegroundColor Yellow
    $stepNumber = 1
    Write-Host "  $stepNumber. Yeni içerik staging dizinine kopyalanır ve hash doğrulanır"; $stepNumber++
    if ($targetExists) {
        Write-Host "  $stepNumber. Mevcut hedef Administrators-only, zaman damgalı yedeğe TAŞINIR (kopya değil)"; $stepNumber++
    }
    Write-Host "  $stepNumber. Staging dizini atomik olarak hedefe TAŞINIR"; $stepNumber++
    Write-Host "  $stepNumber. Hedefteki her dosya YENİDEN okunup kaynak hash'iyle bağımsız doğrulanır"; $stepNumber++
    Write-Host ''
    Write-Host 'Servis kurulmaz, ortam değişkeni yazılmaz, servis başlatılmaz.' -ForegroundColor Yellow
    Write-Host ''

    if (-not $Apply) {
        Write-Host '-Apply verilmedi: yalnız plan gösterildi, HİÇBİR değişiklik yapılmadı.' -ForegroundColor Cyan
        $result = [ordered]@{
            SchemaVersion = 'hasarbotu-deploy-service-artifacts/1.0.0'
            Mode = $mode
            Status = 'would_apply'
            ServiceLabel = $ServiceLabel
            AllowlistFileCount = $sourceManifest.Count
            TotalBytes = [int64]$totalBytes
            Manifest = $sourceManifest | Select-Object RelativePath, Sha256, Size
            Blockers = @()
        }
        $result | ConvertTo-Json -Depth 8
        exit 0
    }

    if (-not $PSCmdlet.ShouldProcess($target, 'Dağıt')) { exit 0 }

    # --- UYGULA ---
    $stagingPath = "$target.staging-$([Guid]::NewGuid().ToString('N').Substring(0, 8))"
    [System.IO.Directory]::CreateDirectory($stagingPath) | Out-Null
    try {
        foreach ($entry in $sourceManifest) {
            $stagedFilePath = Join-Path $stagingPath $entry.RelativePath
            $stagedFileDir = Split-Path -Path $stagedFilePath -Parent
            if (-not [System.IO.Directory]::Exists($stagedFileDir)) { [System.IO.Directory]::CreateDirectory($stagedFileDir) | Out-Null }
            [System.IO.File]::Copy($entry.FullPath, $stagedFilePath, $true)
            $stagedHash = Get-Sha256 $stagedFilePath
            if ($stagedHash -ne $entry.Sha256) { Throw-SafeError "STAGING_HASH_MISMATCH_$($entry.RelativePath)" }
        }

        $backupPath = $null
        $backupManifestPath = $null
        if ($targetExists) {
            $timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
            $suffix = [Guid]::NewGuid().ToString('N').Substring(0, 8)
            [System.IO.Directory]::CreateDirectory($BackupRootDirectory) | Out-Null
            Set-AdminOnlySecurityOn $BackupRootDirectory $true
            $backupPath = Join-Path $BackupRootDirectory "$ServiceLabel-$timestamp-$suffix"
            [System.IO.Directory]::Move($target, $backupPath)
            Set-AdminOnlySecurityOn $backupPath $true
            $backupManifest = Get-AllowlistedManifest $backupPath
            $backupManifestJson = [ordered]@{ GeneratedAtUtc = [DateTime]::UtcNow.ToString('o'); SourceTargetDir = $target; Entries = $backupManifest } | ConvertTo-Json -Depth 8
            $backupManifestPath = "$backupPath.manifest.json"
            [System.IO.File]::WriteAllText($backupManifestPath, $backupManifestJson, [System.Text.UTF8Encoding]::new($false))
            Set-AdminOnlySecurityOn $backupManifestPath $false
        }

        [System.IO.Directory]::Move($stagingPath, $target)
    }
    catch {
        if ([System.IO.Directory]::Exists($stagingPath)) { [System.IO.Directory]::Delete($stagingPath, $true) }
        throw
    }

    # --- BAĞIMSIZ DOĞRULAMA (staging'e değil, kaynağın orijinal hash'ine karşı) ---
    $finalManifest = Get-AllowlistedManifest $target
    $verifyMismatches = [System.Collections.Generic.List[string]]::new()
    foreach ($entry in $sourceManifest) {
        $match = $finalManifest | Where-Object { $_.RelativePath -eq $entry.RelativePath }
        if ($null -eq $match -or $match.Sha256 -ne $entry.Sha256) { $verifyMismatches.Add($entry.RelativePath) }
    }
    if ($finalManifest.Count -ne $sourceManifest.Count) {
        $verifyMismatches.Add("FILE_COUNT_MISMATCH_expected_$($sourceManifest.Count)_actual_$($finalManifest.Count)")
    }

    $result = [ordered]@{
        SchemaVersion = 'hasarbotu-deploy-service-artifacts/1.0.0'
        Mode = $mode
        Status = if ($verifyMismatches.Count -eq 0) { 'applied' } else { 'error' }
        ServiceLabel = $ServiceLabel
        AllowlistFileCount = $sourceManifest.Count
        TotalBytes = [int64]$totalBytes
        BackupPath = $backupPath
        BackupManifestPath = $backupManifestPath
        PostApplyVerificationMismatches = @($verifyMismatches)
        Blockers = @()
    }
    $result | ConvertTo-Json -Depth 8
    exit $(if ($verifyMismatches.Count -eq 0) { 0 } else { 1 })
}
catch {
    $safeError = [ordered]@{
        SchemaVersion = 'hasarbotu-deploy-service-artifacts/1.0.0'
        Status = 'error'
        ErrorCode = if ($null -ne $_.Exception.Data -and $_.Exception.Data.Contains('SafeCode')) { [string]$_.Exception.Data['SafeCode'] } else { 'DEPLOY_RUNTIME_ERROR' }
        ErrorType = $_.Exception.GetType().Name
        ErrorLine = $_.InvocationInfo.ScriptLineNumber
    }
    $safeError | ConvertTo-Json -Depth 4
    exit 1
}
