#Requires -Version 5.1
<#
.SYNOPSIS
    HasarBotu V2 servis build çıktısını (`dist\` + `package.json`, ve
    isteğe bağlı olarak `resolve-runtime-dependency-closure.mjs`in
    hesapladığı GERÇEK, deterministik çalışma zamanı bağımlılık kapanışı)
    kontrollü biçimde, kendi kendine yeten (self-contained) bir dağıtım
    dizinine hazırlar (D9 ikinci küçük paketi HB-2026-143; bağımlılık
    kapanışı desteği B7 çözümü, HB-2026-144). PLANLA -> ÖNİZLE -> ONAY ->
    UYGULA -> DOĞRULA modeli.

.DESCRIPTION
    Bu betik servis KURMAZ, ortam değişkeni YAZMAZ, servis BAŞLATMAZ —
    yalnız izin verilen dosyaları `-TargetDir`e güvenli, fail-closed,
    idempotent bir şekilde kopyalar. Sonraki adımlar (`install-services.ps1
    -Services Api`, secret/env ayarlama, servis başlatma) RUNBOOK'ta ayrı,
    açık adımlardır.

    `-DependencyClosureManifestPath` VERİLMEZSE davranış HB-2026-143 ile
    BİREBİR aynıdır: yalnız `-SourceDir\dist\` + `package.json`.

    `-DependencyClosureManifestPath` VERİLİRSE (bkz.
    `resolve-runtime-dependency-closure.mjs`, `-RepoRoot` da ZORUNLU
    olur), ek olarak dahil edilir:
      - Kapanıştaki her workspace-internal paket (ör. `packages/contracts`)
        için yalnız KENDİ `dist\` + `package.json`'ı, `node_modules\
        @hasarbotu\<ad>\` altına — kaynak kodu/testleri DEĞİL.
      - Kapanıştaki her harici (npm) paket için TAM paket dizini (o
        paketin kendi iç yapısı önceden bilinemeyeceği için — bu, `npm
        install --omit=dev`in ürettiğiyle aynı "vendoring" ilkesidir),
        kilit dosyasındaki TAM göreli yoluyla (`node_modules\fastify\...`,
        iç içe geçmiş üzerine yazmalar dahil `node_modules\left-pad\
        node_modules\shared-dep\...` gibi) — Node'un KENDİ çözümleme
        sırasıyla birebir eşleşir.
      - Platform/mimari ile UYUMSUZ optional bağımlılıklar (ör. 11
        `@napi-rs/canvas-*` platform ikilisinden yalnız
        `win32-x64-msvc`) `resolve-runtime-dependency-closure.mjs`
        tarafından ZATEN elenmiştir; bu betik onları hiç görmez.
      - Kilit bütünlüğü (lock integrity) İKİ KEZ doğrulanır: (1) kapanış
        manifestinin KENDİSİ `resolve-runtime-dependency-closure.mjs`
        tarafından üretilirken her paketin diskteki sürümünü kilit
        dosyasıyla karşılaştırmıştır (`LockIntegrityOk`), (2) bu betik
        HER `-Apply`'da bunu TAZE olarak (rapor bayatlamış olabilir diye)
        her harici paketin `package.json`sını yeniden okuyarak tekrar
        doğrular.
      - Kilit dosyasında hiç görünmeyen, derlenmiş koddaki
        `new URL('../...', import.meta.url)` ile REPO KÖKÜNE göre sabit
        kodlanmış veri dosyası referansları (`ExtraDataReferences`, izole
        gerçek smoke testte bulundu) OTOMATİK KOPYALANMAZ (hedefi tek bir
        `-TargetDir`in DIŞINA çıkabilir, paylaşılabilir); bu betik yalnız
        GERÇEK hedefe göre nereye ihtiyaç duyduğunu hesaplar ve zaten doğru
        içerikle orada değilse net bir blocker ile `-Apply`'ı reddeder.

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

.PARAMETER DependencyClosureManifestPath
    (Opsiyonel, HB-2026-144) `resolve-runtime-dependency-closure.mjs`
    çıktısı olan JSON dosyasının yolu. Verilirse `-RepoRoot` da ZORUNLU
    olur. Verilmezse davranış tamamen HB-2026-143 ile aynıdır.

.PARAMETER RepoRoot
    `-DependencyClosureManifestPath` ile ZORUNLU: kapanıştaki
    workspace-internal ve harici paket yollarının (`packages/contracts`,
    `node_modules/fastify` vb.) çözüleceği repo kökü.

.EXAMPLE
    # Önizleme (hiçbir şey değişmez), yalnız dist+package.json:
    .\deploy-service-artifacts.ps1 -SourceDir C:\...\services\api -TargetDir C:\HasarBotu\services\api -ServiceLabel api

    # Onizleme, tam self-contained (node_modules kapanisi dahil):
    .\deploy-service-artifacts.ps1 -SourceDir C:\...\services\api -TargetDir C:\HasarBotu\services\api -ServiceLabel api -DependencyClosureManifestPath C:\...\api-closure.json -RepoRoot C:\...\HasarBotuV2

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

    [string]$RollbackBackupPath,

    [string]$DependencyClosureManifestPath,

    [string]$RepoRoot
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
    # HB-2026-144: Get-FileHash yerine ham .NET akış hash'i -- gerçek
    # kapanışlarda (113/20 harici paket, binlerce dosya) ölçülebilir
    # performans farkı var; algoritma/çıktı biçimi (küçük harf hex)
    # birebir aynı kalır.
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
        try {
            $hashBytes = $sha256.ComputeHash($stream)
        }
        finally {
            $stream.Dispose()
        }
    }
    finally {
        $sha256.Dispose()
    }
    return ([System.BitConverter]::ToString($hashBytes) -replace '-', '').ToLowerInvariant()
}

# Set-StrictMode -Version Latest, JSON'dan gelen bir PSCustomObject'te
# olmayan bir property'ye erişimi HATA olarak fırlatır -- bu yüzden
# `ExtraDataReferences` gibi eski (HB-2026-144 öncesi) veya sentetik test
# manifestlerinde bulunmayabilecek opsiyonel alanlara erişim HER ZAMAN bu
# fonksiyon üzerinden, güvenli varsayılan (boş dizi) ile yapılmalı.
function Get-ClosureArrayProperty {
    param([object]$Closure, [string]$Name)
    # ',' (unary virgul operatoru) KASITLI: bir fonksiyonun `return @()`
    # ile BOS bir dizi dondurmesi, PowerShell pipeline'inda SIFIR nesne
    # yazar -- cagiran tarafta bu $null'a "cozulur" (StrictMode altinda
    # sonraki bir `.Count` erisimi PropertyNotFoundException firlatir,
    # gercek calisma zamaninda bulundu). ',' ile sarmalamak fonksiyonun
    # HER ZAMAN TEK BIR dizi nesnesi (bos olsa bile) dondurmesini garanti
    # eder.
    if ($null -eq $Closure) { return , @() }
    $prop = $Closure.PSObject.Properties[$Name]
    if ($null -eq $prop) { return , @() }
    return , @($prop.Value)
}

function Test-NoReparsePoint {
    param([string]$Path, [bool]$Directory, [string]$SafeCode)
    $info = if ($Directory) { [System.IO.DirectoryInfo]::new($Path) } else { [System.IO.FileInfo]::new($Path) }
    if ($info.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        Throw-SafeError $SafeCode
    }
}

# Sınırsız, özyinelemeli dizin taraması -- reparse point kontrolüyle.
# ZATEN bu betik tarafından dağıtılmış (target/backup) dizinleri yeniden
# hash'lemek için kullanılır; içerikleri (dist+package.json mı, yoksa
# kapanış node_modules'ı da mı) ÖNCEDEN bilinmesi gerekmez -- diskte NE
# VARSA onu hash'ler.
function Get-FullTreeManifest {
    param([string]$Root)
    $entries = [System.Collections.Generic.List[object]]::new()
    if (-not [System.IO.Directory]::Exists($Root)) { return @() }
    Test-NoReparsePoint $Root $true 'TREE_ROOT_REPARSE_POINT'
    $stack = [System.Collections.Generic.Stack[string]]::new()
    $stack.Push($Root)
    while ($stack.Count -gt 0) {
        $current = $stack.Pop()
        foreach ($dir in [System.IO.Directory]::GetDirectories($current)) {
            Test-NoReparsePoint $dir $true 'TREE_REPARSE_POINT'
            $stack.Push($dir)
        }
        foreach ($file in [System.IO.Directory]::GetFiles($current)) {
            Test-NoReparsePoint $file $false 'TREE_REPARSE_POINT'
            $fileInfo = [System.IO.FileInfo]::new($file)
            $relativePath = $file.Substring($Root.Length).TrimStart('\', '/')
            $entries.Add([pscustomobject]@{
                RelativePath = $relativePath
                FullPath = $file
                Sha256 = Get-Sha256 $file
                Size = $fileInfo.Length
            })
        }
    }
    # PowerShell'in "bos dizi -> cagiranda $null olur" davranisina karsi
    # -- bkz. Get-TopLevelSegments'in ustundeki not.
    if ($entries.Count -eq 0) { return , @() }
    return @($entries | Sort-Object RelativePath)
}

# HB-2026-175: bu betiğin YÖNETTİĞİ içerik (dist/+package.json+kapanış),
# gerçek üretimde AYNI dizinde `install-services.ps1`nin yerleştirdiği,
# bu betiğin HİÇ bilmediği/yönetmediği yabancı içerikle (WinSW ikili
# dosyası+XML, canlı servisin sürekli açık tuttuğu `logs\` dizini) YAN
# YANA yaşar -- gerçek makinede, servis ZATEN kurulup ÇALIŞIRKEN yeniden
# dağıtım denenene kadar hiç ortaya çıkmayan bir senaryo (ilk dağıtım
# her zaman henüz var OLMAYAN bir hedefe yapılmıştı). Aşağıdaki 3
# fonksiyon, TÜM taşıma/karşılaştırma işlemlerini yalnız bu betiğin
# KENDİ üst-düzey segmentlerine (örn. `dist`, `package.json`,
# `node_modules`) SINIRLAR -- yabancı içerik ASLA okunmaz/taşınmaz/
# silinmez, canlı bir `logs\*.log` dosyasını açmaya ASLA çalışılmaz.

# Bir manifest'teki (kaynak/kapanış/kayıtlı yedek) TÜM göreli yolların
# İLK path segmentini (üst-düzey dosya/dizin adını) çıkarır.
function Get-TopLevelSegments {
    param([object[]]$Manifest)
    # PowerShell'in kendi "bos dizi -> pipeline'a hic yazilmaz -> cagiran
    # tarafta $null olur" davranisina (return @() TEK BASINA GUVENILMEZ)
    # karsi virgul operatoru ile ACIKCA tek bir dizi degeri olarak
    # sarilir -- boyle capture edilmezse asagi akista .Count gibi
    # cagrilar StrictMode altinda gercek bir hataya donusur.
    return , @($Manifest | ForEach-Object { ($_.RelativePath -split '[\\/]', 2)[0] } | Select-Object -Unique | Sort-Object)
}

# `Get-FullTreeManifest`nin sınırlı biçimi: `$Root` altında YALNIZ
# `$Segments`teki üst-düzey ad(lar)ın içine iner -- $Root'taki BAŞKA
# HİÇBİR üst-düzey dosya/dizin (yabancı içerik) hiç görülmez, hiç
# açılmaya çalışılmaz. RelativePath'ler `Get-FullTreeManifest`inkiyle
# BİREBİR aynı biçimdedir (segment adı dahil, $Root'a göre).
function Get-ScopedTreeManifest {
    param([string]$Root, [string[]]$Segments)
    $entries = [System.Collections.Generic.List[object]]::new()
    foreach ($segment in $Segments) {
        $segmentPath = Join-Path $Root $segment
        if ([System.IO.Directory]::Exists($segmentPath)) {
            foreach ($inner in (Get-FullTreeManifest $segmentPath)) {
                $entries.Add([pscustomobject]@{
                    RelativePath = Join-Path $segment $inner.RelativePath
                    FullPath = $inner.FullPath
                    Sha256 = $inner.Sha256
                    Size = $inner.Size
                })
            }
        }
        elseif ([System.IO.File]::Exists($segmentPath)) {
            Test-NoReparsePoint $segmentPath $false 'TREE_REPARSE_POINT'
            $fileInfo = [System.IO.FileInfo]::new($segmentPath)
            $entries.Add([pscustomobject]@{
                RelativePath = $segment
                FullPath = $segmentPath
                Sha256 = Get-Sha256 $segmentPath
                Size = $fileInfo.Length
            })
        }
        # else: segment $Root'ta hiç yok -- normal (örn. ilk dağıtımda
        # hedef henüz boş/yok), sessizce atlanır.
    }
    if ($entries.Count -eq 0) { return , @() }
    return @($entries | Sort-Object RelativePath)
}

# `$Segments`teki HER üst-düzey adı `$FromDir`den `$ToDir`e taşır --
# yalnız o adlar; `$FromDir`deki BAŞKA HİÇBİR ŞEYE dokunulmaz (yabancı
# içerik olduğu yerde kalır). Her taşıma kendi başına atomik bir
# `Directory.Move`/`File.Move` (aynı birimde yeniden adlandırma); ilk
# eksik segment sessizce atlanır (örn. ilk dağıtımda hedefte henüz
# `node_modules` yoktu).
function Move-TopLevelSegments {
    param([string]$FromDir, [string]$ToDir, [string[]]$Segments)
    if (-not [System.IO.Directory]::Exists($ToDir)) { [System.IO.Directory]::CreateDirectory($ToDir) | Out-Null }
    foreach ($segment in $Segments) {
        $fromPath = Join-Path $FromDir $segment
        $toPath = Join-Path $ToDir $segment
        if ([System.IO.Directory]::Exists($fromPath)) {
            [System.IO.Directory]::Move($fromPath, $toPath)
        }
        elseif ([System.IO.File]::Exists($fromPath)) {
            [System.IO.File]::Move($fromPath, $toPath)
        }
    }
}

# Allowlist enumerasyonu YAPISAL olarak sınırlıdır: yalnız $SourceRoot içindeki
# $AllowlistTopLevelDir (özyinelemeli) ve $AllowlistTopLevelFile taranır --
# kaynak kökte başka ne olursa olsun (node_modules, src, test-support, .env
# vb.) bu fonksiyon ONLARI HİÇ GÖRMEZ, HİÇ OKUMAZ. Sonuçlar $TargetPrefix
# altına yerleştirilir (boşsa dağıtımın köküne).
function Add-DistAndPackageJsonEntries {
    param(
        [System.Collections.Generic.List[object]]$Entries,
        [string]$SourceRoot,
        [string]$TargetPrefix
    )
    $distRoot = Join-Path $SourceRoot $AllowlistTopLevelDir
    if ([System.IO.Directory]::Exists($distRoot)) {
        Test-NoReparsePoint $distRoot $true 'SOURCE_DIST_REPARSE_POINT'
        $stack = [System.Collections.Generic.Stack[string]]::new()
        $stack.Push($distRoot)
        while ($stack.Count -gt 0) {
            $current = $stack.Pop()
            foreach ($dir in [System.IO.Directory]::GetDirectories($current)) {
                Test-NoReparsePoint $dir $true 'SOURCE_DIST_REPARSE_POINT'
                $stack.Push($dir)
            }
            foreach ($file in [System.IO.Directory]::GetFiles($current)) {
                Test-NoReparsePoint $file $false 'SOURCE_DIST_REPARSE_POINT'
                $fileInfo = [System.IO.FileInfo]::new($file)
                $relativeToSource = $file.Substring($SourceRoot.Length).TrimStart('\', '/')
                $relativePath = if ([string]::IsNullOrEmpty($TargetPrefix)) { $relativeToSource } else { Join-Path $TargetPrefix $relativeToSource }
                $Entries.Add([pscustomobject]@{
                    RelativePath = $relativePath
                    FullPath = $file
                    Sha256 = Get-Sha256 $file
                    Size = $fileInfo.Length
                })
            }
        }
    }
    $packageJsonPath = Join-Path $SourceRoot $AllowlistTopLevelFile
    if ([System.IO.File]::Exists($packageJsonPath)) {
        $relativePath = if ([string]::IsNullOrEmpty($TargetPrefix)) { $AllowlistTopLevelFile } else { Join-Path $TargetPrefix $AllowlistTopLevelFile }
        $Entries.Add([pscustomobject]@{
            RelativePath = $relativePath
            FullPath = $packageJsonPath
            Sha256 = Get-Sha256 $packageJsonPath
            Size = ([System.IO.FileInfo]::new($packageJsonPath)).Length
        })
    }
}

# Harici (npm) bir paketin TAM dizinini -- kendi iç yapısı önceden
# bilinemeyeceği için -- $TargetPrefix altına özyinelemeli olarak ekler
# (`npm install --omit=dev` vendoring ilkesiyle aynı).
#
# İSTİSNA (HB-2026-144, gerçek file-agent kapanışında bulundu): paketin
# KENDİ iç içe `node_modules\` alt dizini YOK SAYILIR. Neden: bu alt
# dizindeki her çalışma zamanı bağımlılığı, kapanış çözümleyicisi
# (`resolve-runtime-dependency-closure.mjs`) tarafından ZATEN Node'un
# KENDİ çözümleme sırasıyla ayrı, kendi doğru hedef yoluyla (aynı
# `node_modules\<paket>\node_modules\<iç-paket>\...` yoluyla) tek tek
# bulunup `External` listesine EKLENMİŞTİR -- gerçek örnek:
# `node_modules/node-fetch/node_modules/{tr46,webidl-conversions,
# whatwg-url}`. Bu alt dizini de yürüyüp AYRICA eklemek (a) birebir AYNI
# hedef yola İKİ KEZ (aynı içerikle) yazan zararsız ama YANLIŞ bir
# `AllowlistFileCount`/`FILE_COUNT_MISMATCH` üretir, (b) daha kötüsü,
# paketin KENDİ `devDependencies`'i gibi kapanışın BİLEREK dışarıda
# bıraktığı bağımlılıkları da sessizce vendor'lar -- ikisi de bu paketin
# "gereksiz taşımamalı" gereksinimini ihlal eder.
function Add-FullSubtreeEntries {
    param(
        [System.Collections.Generic.List[object]]$Entries,
        [string]$SourceRoot,
        [string]$TargetPrefix
    )
    if (-not [System.IO.Directory]::Exists($SourceRoot)) {
        Throw-SafeError "EXTERNAL_PACKAGE_DIR_MISSING"
    }
    Test-NoReparsePoint $SourceRoot $true 'EXTERNAL_PACKAGE_REPARSE_POINT'
    $stack = [System.Collections.Generic.Stack[string]]::new()
    $stack.Push($SourceRoot)
    while ($stack.Count -gt 0) {
        $current = $stack.Pop()
        foreach ($dir in [System.IO.Directory]::GetDirectories($current)) {
            if ([System.IO.Path]::GetFileName($dir) -eq 'node_modules') { continue }
            Test-NoReparsePoint $dir $true 'EXTERNAL_PACKAGE_REPARSE_POINT'
            $stack.Push($dir)
        }
        foreach ($file in [System.IO.Directory]::GetFiles($current)) {
            Test-NoReparsePoint $file $false 'EXTERNAL_PACKAGE_REPARSE_POINT'
            $fileInfo = [System.IO.FileInfo]::new($file)
            $relativeToSource = $file.Substring($SourceRoot.Length).TrimStart('\', '/')
            $relativePath = Join-Path $TargetPrefix $relativeToSource
            $Entries.Add([pscustomobject]@{
                RelativePath = $relativePath
                FullPath = $file
                Sha256 = Get-Sha256 $file
                Size = $fileInfo.Length
            })
        }
    }
}

# Fiilen DAĞITILACAK dosya kümesi: her zaman $ServiceSourceRoot'un kendi
# dist+package.json'ı; $ClosureManifest verilmişse (HB-2026-144) EK olarak
# her workspace-internal paketin kendi dist+package.json'ı
# (node_modules\@hasarbotu\<ad>\ altında) ve her harici paketin TAM dizini
# (kilit dosyasındaki göreli yoluyla). $ClosureManifest $null ise çıktı
# HB-2026-143 ile birebir aynıdır (regresyon güvenliği).
function Get-SourceDeploymentManifest {
    param(
        [string]$ServiceSourceRoot,
        [object]$ClosureManifest,
        [string]$RepoRootPath
    )
    $entries = [System.Collections.Generic.List[object]]::new()
    Add-DistAndPackageJsonEntries $entries $ServiceSourceRoot ''

    if ($null -ne $ClosureManifest) {
        foreach ($workspaceKey in @($ClosureManifest.WorkspaceInternal)) {
            $workspaceSourceRoot = Join-Path $RepoRootPath ([string]$workspaceKey -replace '/', '\')
            $workspacePackageJsonPath = Join-Path $workspaceSourceRoot 'package.json'
            $workspacePackageJson = Get-Content -LiteralPath $workspacePackageJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
            $workspacePackageName = [string]$workspacePackageJson.name
            if ([string]::IsNullOrWhiteSpace($workspacePackageName)) {
                Throw-SafeError "WORKSPACE_INTERNAL_PACKAGE_NAME_MISSING"
            }
            $targetPrefix = Join-Path 'node_modules' ($workspacePackageName -replace '/', '\')
            Add-DistAndPackageJsonEntries $entries $workspaceSourceRoot $targetPrefix
        }

        foreach ($externalEntry in @($ClosureManifest.External)) {
            $lockKeyPath = [string]$externalEntry.lockKey -replace '/', '\'
            $externalSourceRoot = Join-Path $RepoRootPath $lockKeyPath
            Add-FullSubtreeEntries $entries $externalSourceRoot $lockKeyPath
        }
    }

    if ($entries.Count -eq 0) { return , @() }
    return @($entries | Sort-Object RelativePath)
}

function Test-ManifestsIdentical {
    param([object[]]$Left, [object[]]$Right)
    # HB-2026-175: ikinci savunma katmani -- PowerShell'in "bos dizi ->
    # cagiranda $null" davranisi kaynakta (manifest fonksiyonlarinda)
    # zaten duzeltildi, ama bu fonksiyon BASKA bir cagiran tarafindan
    # yanlislikla $null ile cagirilirsa bile StrictMode altinda GERCEK
    # bir hataya (PropertyNotFoundException) DUSMEDEN, dogru sekilde
    # "bos == 0 eleman" olarak degerlendirir.
    $leftCount = if ($null -eq $Left) { 0 } else { $Left.Count }
    $rightCount = if ($null -eq $Right) { 0 } else { $Right.Count }
    if ($leftCount -ne $rightCount) { return $false }
    for ($i = 0; $i -lt $leftCount; $i++) {
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
            $currentBackupManifest = Get-FullTreeManifest $backupPath
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

        # HB-2026-175: yalnız YEDEĞİN KENDİ üst-düzey segmentleri (geri
        # yüklenecek olanlar) taşınır -- $target'ta yan yana yaşayan
        # yabancı içerik (WinSW ikili/XML, canlı `logs\`) rollback
        # boyunca da HİÇ dokunulmadan yerinde kalır.
        $rollbackSegments = Get-TopLevelSegments $recordedManifest
        $preRollbackBackupPath = $null
        if ([System.IO.Directory]::Exists($target)) {
            $timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
            $suffix = [Guid]::NewGuid().ToString('N').Substring(0, 8)
            [System.IO.Directory]::CreateDirectory($BackupRootDirectory) | Out-Null
            Set-AdminOnlySecurityOn $BackupRootDirectory $true
            $preRollbackBackupPath = Join-Path $BackupRootDirectory "$ServiceLabel-pre-rollback-$timestamp-$suffix"
            Move-TopLevelSegments -FromDir $target -ToDir $preRollbackBackupPath -Segments $rollbackSegments
            Set-AdminOnlySecurityOn $preRollbackBackupPath $true
            $preRollbackManifest = Get-FullTreeManifest $preRollbackBackupPath
            $preRollbackManifestJson = [ordered]@{ GeneratedAtUtc = [DateTime]::UtcNow.ToString('o'); Entries = $preRollbackManifest } | ConvertTo-Json -Depth 6
            $preRollbackManifestPath = "$preRollbackBackupPath.manifest.json"
            [System.IO.File]::WriteAllText($preRollbackManifestPath, $preRollbackManifestJson, [System.Text.UTF8Encoding]::new($false))
            Set-AdminOnlySecurityOn $preRollbackManifestPath $false
        }
        Move-TopLevelSegments -FromDir $backupPath -ToDir $target -Segments $rollbackSegments
        if ([System.IO.Directory]::Exists($backupPath)) { [System.IO.Directory]::Delete($backupPath, $true) }
        [System.IO.File]::Delete($backupManifestPath)

        $finalManifest = Get-ScopedTreeManifest -Root $target -Segments $rollbackSegments
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

    # --- HB-2026-144: bağımlılık kapanışı (opsiyonel) ---
    $closureManifest = $null
    $repoRootFull = $null
    $closureGiven = -not [string]::IsNullOrWhiteSpace($DependencyClosureManifestPath)
    $repoRootGiven = -not [string]::IsNullOrWhiteSpace($RepoRoot)
    if ($closureGiven -or $repoRootGiven) {
        if (-not ($closureGiven -and $repoRootGiven)) {
            $issues.Add('-DependencyClosureManifestPath ve -RepoRoot birlikte verilmeli (biri diğeri olmadan kullanılamaz).')
        }
        else {
            $repoRootFull = [System.IO.Path]::GetFullPath($RepoRoot).TrimEnd('\')
            if (-not [System.IO.Directory]::Exists($repoRootFull)) {
                $issues.Add("RepoRoot dizini yok: $repoRootFull")
            }
            elseif (-not [System.IO.File]::Exists($DependencyClosureManifestPath)) {
                $issues.Add("Bağımlılık kapanışı manifest dosyası yok: $DependencyClosureManifestPath")
            }
            else {
                try {
                    $closureManifest = Get-Content -LiteralPath $DependencyClosureManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
                }
                catch {
                    $issues.Add("Bağımlılık kapanışı manifest dosyası geçerli JSON değil: $DependencyClosureManifestPath")
                }
                if ($null -ne $closureManifest) {
                    if ([string]$closureManifest.Status -ne 'ok') {
                        $issues.Add("Bağımlılık kapanışı manifesti 'ok' durumunda değil (Status=$($closureManifest.Status)) -- önce resolve-runtime-dependency-closure.mjs başarıyla çalıştırılmalı.")
                        $closureManifest = $null
                    }
                    else {
                        foreach ($workspaceKey in @($closureManifest.WorkspaceInternal)) {
                            $workspaceSourceRoot = Join-Path $repoRootFull ([string]$workspaceKey -replace '/', '\')
                            if (-not [System.IO.Directory]::Exists($workspaceSourceRoot)) {
                                $issues.Add("Workspace-internal paket dizini yok: $workspaceKey")
                            }
                            elseif (-not [System.IO.File]::Exists((Join-Path $workspaceSourceRoot 'package.json'))) {
                                $issues.Add("Workspace-internal paketin package.json'ı yok: $workspaceKey")
                            }
                        }
                        # TAZE kilit bütünlüğü doğrulaması (manifest bayatlamış olabilir --
                        # resolve-runtime-dependency-closure.mjs KENDİ ürettiği anda bir kez
                        # doğrulamıştı, bu ikinci ve bağımsız kontroldür).
                        foreach ($externalEntry in @($closureManifest.External)) {
                            $externalPackageJsonPath = Join-Path $repoRootFull (Join-Path ([string]$externalEntry.lockKey -replace '/', '\') 'package.json')
                            if (-not [System.IO.File]::Exists($externalPackageJsonPath)) {
                                $issues.Add("Harici paket bulunamadı (disk): $($externalEntry.lockKey)")
                                continue
                            }
                            try {
                                $freshVersion = (Get-Content -LiteralPath $externalPackageJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json).version
                            }
                            catch {
                                $issues.Add("Harici paketin package.json'ı okunamadı: $($externalEntry.lockKey)")
                                continue
                            }
                            if ([string]$freshVersion -ne [string]$externalEntry.version) {
                                $issues.Add("Kilit bütünlüğü uyuşmazlığı (TAZE doğrulama): $($externalEntry.lockKey) kilit=$($externalEntry.version) disk=$freshVersion")
                            }
                        }

                        # HB-2026-144: kilit dosyasında GÖRÜNMEYEN, derlenmiş
                        # koddaki `new URL('../...', import.meta.url)` ile
                        # REPO KÖKÜNE göre sabit kodlanmış veri dosyası
                        # referansları (ör. hash doğrulamalı bir referans-veri
                        # snapshot'ı) -- bunlar paketin KENDİ dist'inin
                        # DIŞINDA kalır, normal kopyalama bunları KAPSAMAZ.
                        # Bu betik bunları OTOMATİK KOPYALAMAZ (hedef, tek bir
                        # $TargetDir'in DIŞINA -- örn. birden çok servisin
                        # paylaştığı bir üst dizine -- çıkabilir, bu da atomik
                        # tek-hedef yedekleme/rollback modelinin kapsamı
                        # DIŞINDADIR); yalnız GERÇEK hedefe göre TAZE olarak
                        # nereye ihtiyaç duyduğunu hesaplar ve zaten doğru
                        # içerikle orada değilse net, eyleme geçirilebilir bir
                        # blocker döner (izole gerçek smoke testte bulundu).
                        # NOT: `foreach ($x in FUNC-cagrisi)` bir FONKSIYON
                        # CAGRISININ CIKTI AKISINI (output stream) yineler --
                        # eger fonksiyon virgul operatoruyle TEK bir (bos da
                        # olsa) dizi nesnesi yazdiysa, foreach bunu "1 akis
                        # ogesi" olarak TEK KEZ yineler (dizinin ELEMANLARINI
                        # DEGIL) -- gercek calisma zamaninda bulundu. Once
                        # degiskene ATAMAK (`$x = FUNC`), SONRA o degisken
                        # UZERINDE foreach yapmak diziyi DOGRU sekilde
                        # yineler.
                        $extraDataReferences = Get-ClosureArrayProperty $closureManifest 'ExtraDataReferences'
                        foreach ($extraDataRef in $extraDataReferences) {
                            $referencingDeployedPath = Join-Path $target ([string]$extraDataRef.distRelativePath -replace '/', '\')
                            $expectedTargetPath = [System.IO.Path]::GetFullPath((Join-Path (Split-Path -Path $referencingDeployedPath -Parent) ([string]$extraDataRef.literal -replace '/', '\')))
                            $sourceDataPath = Join-Path $repoRootFull ([string]$extraDataRef.resolvedRepoRelativePath -replace '/', '\')
                            if (-not [System.IO.File]::Exists($sourceDataPath)) {
                                $issues.Add("Ek veri referansı kaynakta bulunamadı: $($extraDataRef.resolvedRepoRelativePath)")
                                continue
                            }
                            $sourceDataHash = Get-Sha256 $sourceDataPath
                            $alreadyProvisioned = [System.IO.File]::Exists($expectedTargetPath) -and (Get-Sha256 $expectedTargetPath) -eq $sourceDataHash
                            if (-not $alreadyProvisioned) {
                                $issues.Add("Ek veri dosyası hedefte yok/eski ($($extraDataRef.distRelativePath) içinde '$($extraDataRef.literal)' referansı) -- beklenen konum: $expectedTargetPath -- bu, tek-servis deploy kapsamının DIŞINDadır (paylaşılabilir); Apply öncesi kaynak ($sourceDataPath) elle veya ayrı bir adımla o konuma sağlanmalı.")
                            }
                        }
                    }
                }
            }
        }
    }

    $sourceManifest = @()
    if ($issues.Count -eq 0) {
        try { $sourceManifest = Get-SourceDeploymentManifest $source $closureManifest $repoRootFull }
        catch { $issues.Add("Kaynak envanteri okunamadı: $($_.Exception.Data['SafeCode'])") }
    }
    $totalBytes = 0
    if ($sourceManifest.Count -gt 0) {
        $totalBytes = ($sourceManifest | Measure-Object -Property Size -Sum).Sum
    }

    # HB-2026-144: bağımlılık kapanışı GERÇEK monorepo kilit dosyalarında
    # derin iç içe "override" zincirleri üretebilir (ör.
    # node_modules\fast-json-stringify\node_modules\ajv\node_modules\
    # fast-uri\...). Bu betik `\\?\` uzun-yol önekini KULLANMAZ (PowerShell
    # 5.1 / .NET Framework'te tüm ham dosya sistemi çağrılarına güvenli
    # şekilde retrofit etmek risklidir); bunun yerine staging'e kopyalamadan
    # ÖNCE, Windows MAX_PATH (260) sınırını aşacak herhangi bir hedef yol
    # varsa fail-closed BLOCKED döner -- kriptik bir çalışma zamanı
    # istisnası yerine net, eyleme geçirilebilir bir uyarı verir.
    $maxSafePathLength = 259
    $stagingSuffixLength = '.staging-'.Length + 8
    if ($sourceManifest.Count -gt 0) {
        $tooLongEntries = @($sourceManifest | Where-Object { ($target.Length + $stagingSuffixLength + 1 + $_.RelativePath.Length) -gt $maxSafePathLength })
        if ($tooLongEntries.Count -gt 0) {
            $sample = @($tooLongEntries | Select-Object -First 3 -ExpandProperty RelativePath)
            $issues.Add("Hedef yol uzunluğu Windows MAX_PATH sınırını (~260) aşacak ($($tooLongEntries.Count) dosya, örn: $($sample -join '; ')) -- -TargetDir daha kısa bir yola taşınmalı.")
        }
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
        # HB-2026-175: yalnız BU BETİĞİN yönettiği üst-düzey segmentler
        # taranır -- hedefte yan yana yaşayan yabancı içerik (WinSW
        # ikili/XML, canlı `logs\`) ASLA okunmaya çalışılmaz.
        $managedSegments = Get-TopLevelSegments $sourceManifest
        $targetManifest = Get-ScopedTreeManifest -Root $target -Segments $managedSegments
        $alreadyUpToDate = Test-ManifestsIdentical $sourceManifest $targetManifest
    }

    if ($Apply -and -not $alreadyUpToDate -and -not (Test-IsElevated)) {
        $issues.Add('Yönetici (Administrator) oturumu gerekli (yalnız -Apply ile, zaten güncel değilse).')
    }

    $mode = if ($Apply) { 'apply' } else { 'preview' }
    $closureUsed = $null -ne $closureManifest
    $workspaceInternalCount = if ($closureUsed) { @($closureManifest.WorkspaceInternal).Count } else { 0 }
    $externalPackageCount = if ($closureUsed) { @($closureManifest.External).Count } else { 0 }
    $extraDataReferenceCount = if ($closureUsed) { (Get-ClosureArrayProperty $closureManifest 'ExtraDataReferences').Count } else { 0 }
    Write-Host "--- HasarBotu V2 servis dağıtımı: $mode ($ServiceLabel) ---" -ForegroundColor Cyan
    Write-Host "  Kaynak dizin        : $source"
    Write-Host "  Hedef dizin         : $target"
    Write-Host "  Bağımlılık kapanışı : $(if ($closureUsed) { "EVET (workspace-internal=$workspaceInternalCount, harici=$externalPackageCount)" } else { 'HAYIR (yalnız dist+package.json)' })"
    Write-Host "  Dağıtılacak dosya sayısı : $($sourceManifest.Count)"
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
            DependencyClosureUsed = $closureUsed
            WorkspaceInternalPackageCount = $workspaceInternalCount
            ExternalPackageCount = $externalPackageCount
            ExtraDataReferenceCount = $extraDataReferenceCount
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
            DependencyClosureUsed = $closureUsed
            WorkspaceInternalPackageCount = $workspaceInternalCount
            ExternalPackageCount = $externalPackageCount
            ExtraDataReferenceCount = $extraDataReferenceCount
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
            DependencyClosureUsed = $closureUsed
            WorkspaceInternalPackageCount = $workspaceInternalCount
            ExternalPackageCount = $externalPackageCount
            ExtraDataReferenceCount = $extraDataReferenceCount
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
    # HB-2026-175: yalnız BU BETİĞİN yönettiği üst-düzey segmentler
    # (`$managedSegments`, kaynak manifestinden türetilir -- örn. `dist`,
    # `package.json`, kapanış varsa `node_modules`) taşınır. Hedefte yan
    # yana yaşayan yabancı içerik (`install-services.ps1`nin yerleştirdiği
    # WinSW ikili/XML dosyaları, canlı servisin sürekli açık tuttuğu
    # `logs\` dizini) HİÇ okunmaz, HİÇ taşınmaz, YERİNDE KALIR -- gerçek
    # bir çalışan servise karşı yeniden dağıtımın, o servisin kendi SCM
    # kaydının işaret ettiği ikili dosyayı/log dizinini asla koparmaması
    # için.
    $managedSegments = Get-TopLevelSegments $sourceManifest
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
            # Yalnız yönetilen segmentler $target'tan $backupPath'e
            # TAŞINIR -- yabancı içerik (varsa) $target'ta YERİNDE KALIR.
            Move-TopLevelSegments -FromDir $target -ToDir $backupPath -Segments $managedSegments
            Set-AdminOnlySecurityOn $backupPath $true
            $backupManifest = Get-FullTreeManifest $backupPath
            $backupManifestJson = [ordered]@{ GeneratedAtUtc = [DateTime]::UtcNow.ToString('o'); SourceTargetDir = $target; ManagedSegments = $managedSegments; Entries = $backupManifest } | ConvertTo-Json -Depth 8
            $backupManifestPath = "$backupPath.manifest.json"
            [System.IO.File]::WriteAllText($backupManifestPath, $backupManifestJson, [System.Text.UTF8Encoding]::new($false))
            Set-AdminOnlySecurityOn $backupManifestPath $false
        }

        # Yönetilen segmentler staging'den $target'a taşınır -- $target
        # yoksa oluşturulur (ilk dağıtım); varsa (yabancı içerikle
        # birlikte) İÇİNE eklenir, asla yeniden adlandırılıp
        # değiştirilmez.
        Move-TopLevelSegments -FromDir $stagingPath -ToDir $target -Segments $managedSegments
        if ([System.IO.Directory]::Exists($stagingPath)) { [System.IO.Directory]::Delete($stagingPath, $true) }
    }
    catch {
        if ([System.IO.Directory]::Exists($stagingPath)) { [System.IO.Directory]::Delete($stagingPath, $true) }
        throw
    }

    # --- BAĞIMSIZ DOĞRULAMA (staging'e değil, kaynağın orijinal hash'ine
    #     karşı; yalnız yönetilen segmentler taranır -- yabancı içerik
    #     hiç okunmaya çalışılmaz, sayıma hiç dahil edilmez) ---
    $finalManifest = Get-ScopedTreeManifest -Root $target -Segments $managedSegments
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
        DependencyClosureUsed = $closureUsed
        WorkspaceInternalPackageCount = $workspaceInternalCount
        ExternalPackageCount = $externalPackageCount
        ExtraDataReferenceCount = $extraDataReferenceCount
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
