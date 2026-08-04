#Requires -Version 5.1
<#
.SYNOPSIS
    D9 B8 çözümü (HB-2026-145): `resolve-runtime-dependency-closure.mjs`in
    tespit ettiği "ExtraDataReferences"i (kilit dosyasında görünmeyen,
    derlenmiş koddaki `new URL('../...', import.meta.url)` ile repo
    köküne sabit kodlanmış veri dosyası referansları) GERÇEK, planlanan
    servis hedefine göre TAZE hesaplanan konuma fail-closed, idempotent,
    atomik, geri alınabilir şekilde sağlar (provision eder). PLANLA ->
    ÖNİZLE -> ONAY -> UYGULA -> DOĞRULA modeli (AGENTS.md §7).

.DESCRIPTION
    Bu betik `-TargetDir` gibi bir yol PARAMETRESİ ALMAZ ve HİÇBİR veri
    yolunu (`reference-data/` dahil) kendi içinde sabit kodlamaz: nereyi
    sağlayacağını, `-DependencyClosureManifestPath`teki `ExtraDataReferences`
    ile `-ServiceTargetDir`i `deploy-service-artifacts.ps1`teki BİREBİR AYNI
    hesaplamayla birleştirerek TÜRETİR. Böylece API'nin (veya başka bir
    servisin) derlenmiş koddaki göreli-yol sözleşmesi HİÇ DEĞİŞTİRİLMEDEN,
    her iki betik de "bu referans gerçekte nereye ihtiyaç duyuyor" sorusuna
    her zaman AYNI cevabı verir.

    KAYNAK ALLOWLİST: sağlanacak dosya kümesi, bir referansın kaynak
    dosyasını (`resolvedRepoRelativePath`) İÇEREN DİZİNİN TAMAMIDIR — repo
    içindeki başka HİÇBİR ŞEY okunmaz/taşınmaz. Bugün tam olarak bir böyle
    dizin vardır (`reference-data/value-loss/real-market-analysis/
    2026-07-01/1.0.0/`); birden fazla FARKLI hedef dizine karşılık gelen
    referans bulunursa (bugün yok) bu betik ŞU AN desteklemediği için
    fail-closed reddeder.

    KİMLİK/SÜRÜM DOĞRULAMASI: allowlist içindeki bir dosyanın adı tam
    olarak `snapshot.json` ise, `verify-value-loss-reference-data-
    identity.mjs` ile -- uygulamanın KENDİSİNİN çalışma zamanında
    kullandığı AYNI kanonik JSON hash algoritması ve AYNI sabit kodlanmış
    `identity`/hash beklentisiyle (`packages/domain`) -- doğrulanır. Bu,
    genel SHA-256 manifestinin ötesinde "bu, GERÇEKTEN uygulamanın kabul
    edeceği doğru snapshot sürümü mü" sorusunu cevaplar. Diğer allowlist
    dosyaları (ör. `manifest.json`, `schema.json`) için ayrı bir kimlik
    sabiti uygulama kodunda tanımlı OLMADIĞI için yalnız genel SHA-256
    manifestiyle korunur -- bu, çıktıda AÇIKÇA belirtilir, asla sessizce
    "doğrulandı" varsayılmaz.

    EKSİK/FAZLA/DEĞİŞMİŞ DOSYADA FAIL-CLOSED (TOCTOU koruması): kaynak
    dizininin manifesti PLAN anında hesaplanır; `-Apply` ile staging'e
    kopyalamadan HEMEN ÖNCE aynı dizin TAZE olarak yeniden taranır ve
    plan-anı manifestiyle karşılaştırılır -- eksik (planda vardı, şimdi
    yok), fazla (plan sonrası yeni dosya belirdi) veya değişmiş (hash
    farklı) HERHANGİ bir fark, plan bayatlamış demektir ve `-Apply`
    fail-closed reddedilir (kimse operasyon sırasında kaynağı elle
    düzenlemiş olamaz diye).

    İDEMPOTENCY: hedef ZATEN kaynakla birebir aynıysa (`already_up_to_date`)
    `-Apply` bile hiçbir şey değiştirmez.

    YEDEKLEME + ATOMİK DEĞİŞTİRME + ROLLBACK: `deploy-service-artifacts.ps1`
    ile BİREBİR aynı ilkeler -- staging'de hash doğrulama, önceki hedef
    varsa kopyalamadan `Directory.Move` ile Administrators-only+zaman
    damgalı+hash manifestli yedeğe taşıma, atomik staging->hedef taşıma,
    uygulama sonrası her dosyanın YENİDEN okunup kaynağın ORİJİNAL
    hash'iyle bağımsız doğrulanması, `-Rollback -RollbackBackupPath` ile
    (yedek bütünlüğü kendi manifestine karşı doğrulanarak) geri alma.

    `-Apply` VERİLMEDEN hiçbir kalıcı değişiklik yapılmaz.

.PARAMETER RepoRoot
    Mandatory. Kaynak verinin okunduğu repo kökü.

.PARAMETER DependencyClosureManifestPath
    Mandatory. `resolve-runtime-dependency-closure.mjs` çıktısı JSON
    (`Status: 'ok'` olmalı). `ExtraDataReferences` buradan okunur.

.PARAMETER ServiceTargetDir
    Mandatory. Referansları taşıyan servisin GERÇEK/planlanan dağıtım
    hedefi (ör. `C:\HasarBotu\services\api`) -- `deploy-service-
    artifacts.ps1` ile BİREBİR AYNI hesaplamayla beklenen sağlama
    konumunu üretmek için kullanılır.

.PARAMETER DataLabel
    Yedek/manifest dosya adlarında kullanılan güvenli tanımlayıcı
    (yalnız `[a-zA-Z0-9_-]`, ör. `value-loss-reference-data`).

.PARAMETER Apply
    Verilmezse yalnız plan yazdırılır, hiçbir dosya kopyalanmaz/taşınmaz.

.PARAMETER Rollback
    Verilirse betik sağlama YERİNE `-RollbackBackupPath`teki yedeği geri
    yükler (yine `-Apply` gerektirir).

.PARAMETER RollbackBackupPath
    `-Rollback` ile ZORUNLU: geri yüklenecek yedek dizininin TAM yolu.

.PARAMETER RequiredFreeSpaceMultiplier
    Hedef birimde toplam boyutun kaç katı boş alan gerektiği (varsayılan 3).

.EXAMPLE
    # Önizleme (hiçbir şey değişmez):
    .\provision-extra-data-references.ps1 -RepoRoot C:\...\HasarBotuV2 -DependencyClosureManifestPath C:\...\api-closure.json -ServiceTargetDir C:\HasarBotu\services\api -DataLabel value-loss-reference-data

    # Gerçek uygulama:
    .\provision-extra-data-references.ps1 -RepoRoot C:\...\HasarBotuV2 -DependencyClosureManifestPath C:\...\api-closure.json -ServiceTargetDir C:\HasarBotu\services\api -DataLabel value-loss-reference-data -Apply

    # Rollback önizlemesi:
    .\provision-extra-data-references.ps1 -DataLabel value-loss-reference-data -Rollback -RollbackBackupPath 'C:\ProgramData\HasarBotu\migration-preflight\pre-deploy-backups\value-loss-reference-data-20260804T120000000Z-abcd1234'
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$RepoRoot,

    [string]$DependencyClosureManifestPath,

    [string]$ServiceTargetDir,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-zA-Z0-9_-]+$')]
    [string]$DataLabel,

    [switch]$Apply,

    [switch]$Rollback,

    [string]$RollbackBackupPath,

    [ValidateRange(1, 100)]
    [double]$RequiredFreeSpaceMultiplier = 3
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
} catch {
    # Bazi barindirilmis konsollarda OutputEncoding salt-okunur olabilir.
}

$AdministratorSidValue = 'S-1-5-32-544'
$BackupRootDirectory = 'C:\ProgramData\HasarBotu\migration-preflight\pre-deploy-backups'
$IdentityVerifierScriptPath = Join-Path $PSScriptRoot 'verify-value-loss-reference-data-identity.mjs'

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

function Test-NoReparsePoint {
    param([string]$Path, [bool]$Directory, [string]$SafeCode)
    $info = if ($Directory) { [System.IO.DirectoryInfo]::new($Path) } else { [System.IO.FileInfo]::new($Path) }
    if ($info.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        Throw-SafeError $SafeCode
    }
}

# Sınırsız, özyinelemeli dizin taraması -- reparse point kontrolüyle. Hem
# kaynak (allowlist = "bu türetilmiş dizindeki HER ŞEY") hem zaten
# sağlanmış hedef/yedek dizinleri için kullanılır.
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

function Get-ManifestDiff {
    # Plan-ani (Left) ile TAZE (Right) manifest arasindaki eksik/fazla/
    # degismis farkini raporlar -- TOCTOU korumasi icin.
    param([object[]]$PlanManifest, [object[]]$FreshManifest)
    $planByPath = @{}
    foreach ($entry in $PlanManifest) { $planByPath[$entry.RelativePath] = $entry.Sha256 }
    $freshByPath = @{}
    foreach ($entry in $FreshManifest) { $freshByPath[$entry.RelativePath] = $entry.Sha256 }
    $missing = [System.Collections.Generic.List[string]]::new()
    $changed = [System.Collections.Generic.List[string]]::new()
    foreach ($path in $planByPath.Keys) {
        if (-not $freshByPath.ContainsKey($path)) { $missing.Add($path) }
        elseif ($freshByPath[$path] -ne $planByPath[$path]) { $changed.Add($path) }
    }
    $extra = [System.Collections.Generic.List[string]]::new()
    foreach ($path in $freshByPath.Keys) {
        if (-not $planByPath.ContainsKey($path)) { $extra.Add($path) }
    }
    return [pscustomobject]@{
        Missing = @($missing)
        Extra = @($extra)
        Changed = @($changed)
        IsIdentical = ($missing.Count -eq 0 -and $extra.Count -eq 0 -and $changed.Count -eq 0)
    }
}

# Bu aracin hedefi (turetilmis, surumlu, cok seviyeli bir yol -- ör.
# reference-data\value-loss\real-market-analysis\2026-07-01\1.0.0) ilk
# saglamada HICBIR ara dizini onceden var OLMAYABILIR -- bu,
# deploy-service-artifacts.ps1'in `-TargetDir`i (tek seviyeli, onceden
# elle kurulmus `services\` kokunun altinda) ile kasitli bir fark. O
# yuzden "hedefin DOGRUDAN ebeveyni onceden var olmali" yerine, var olan
# EN DERIN atayi bulup ORADA yazma iznini dogrularz; eksik ara dizinler
# `-Apply` sirasinda [System.IO.Directory]::CreateDirectory ile (tum
# eksik seviyeleri) guvenle olusturulur.
function Get-DeepestExistingAncestor {
    param([string]$Path)
    $current = $Path
    while (-not [System.IO.Directory]::Exists($current)) {
        $parent = Split-Path -Path $current -Parent
        if ([string]::IsNullOrEmpty($parent) -or $parent -eq $current) { return $null }
        $current = $parent
    }
    return $current
}

function Test-WriteAccessProbe {
    param([string]$DirectoryPath)
    try {
        if (-not [System.IO.Directory]::Exists($DirectoryPath)) {
            [System.IO.Directory]::CreateDirectory($DirectoryPath) | Out-Null
        }
        $probePath = Join-Path $DirectoryPath (".hasarbotu-provision-write-probe-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
        [System.IO.File]::WriteAllText($probePath, 'probe')
        [System.IO.File]::Delete($probePath)
        return $true
    }
    catch {
        return $false
    }
}

# Set-StrictMode -Version Latest, JSON'dan gelen bir PSCustomObject'te
# olmayan bir property'ye erişimi HATA olarak fırlatır; ayrıca bir
# fonksiyondan `return @()` ile BOŞ dizi dönmek pipeline'da SIFIR nesne
# yazıp çağıran tarafta `$null`'a çözülür (HB-2026-144'te bulundu) --
# virgül operatörüyle HER ZAMAN TEK bir dizi nesnesi döndürülür.
function Get-ClosureArrayProperty {
    param([object]$Closure, [string]$Name)
    if ($null -eq $Closure) { return , @() }
    $prop = $Closure.PSObject.Properties[$Name]
    if ($null -eq $prop) { return , @() }
    return , @($prop.Value)
}

function Resolve-NodeExecutable {
    $found = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($null -eq $found) { Throw-SafeError 'NODE_EXE_NOT_FOUND' }
    return $found.Source
}

function Invoke-SnapshotIdentityVerification {
    param([string]$NodeExePath, [string]$SnapshotPath)
    $out = & $NodeExePath $IdentityVerifierScriptPath '--snapshot-path' $SnapshotPath
    $exitCode = $LASTEXITCODE
    $json = $null
    try { $json = $out | ConvertFrom-Json } catch {}
    return [pscustomobject]@{ ExitCode = $exitCode; Json = $json }
}

try {
    if ($Rollback) {
        # ------------------------------------------------------------
        # ROLLBACK MODU (deploy-service-artifacts.ps1 ile ayni model)
        # ------------------------------------------------------------
        if ([string]::IsNullOrWhiteSpace($RollbackBackupPath)) { Throw-SafeError 'ROLLBACK_BACKUP_PATH_REQUIRED' }
        if ([string]::IsNullOrWhiteSpace($ServiceTargetDir)) { Throw-SafeError 'SERVICE_TARGET_DIR_REQUIRED_FOR_ROLLBACK_TARGET_UNKNOWN' }
        $target = [System.IO.Path]::GetFullPath($ServiceTargetDir).TrimEnd('\')
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
        Write-Host "--- Ek veri referansı sağlama ROLLBACK: $mode ($DataLabel) ---" -ForegroundColor Cyan
        Write-Host "  Hedef dizin  : $target"
        Write-Host "  Yedek dizini : $backupPath"
        Write-Host ''

        if ($issues.Count -gt 0) {
            Write-Host '--- Ön koşul HATALARI (rollback yapılamaz) ---' -ForegroundColor Red
            foreach ($issue in $issues) { Write-Host "  - $issue" -ForegroundColor Red }
            $result = [ordered]@{
                SchemaVersion = 'hasarbotu-provision-extra-data-references/1.0.0'
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
                SchemaVersion = 'hasarbotu-provision-extra-data-references/1.0.0'
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
            $preRollbackBackupPath = Join-Path $BackupRootDirectory "$DataLabel-pre-rollback-$timestamp-$suffix"
            [System.IO.Directory]::Move($target, $preRollbackBackupPath)
            Set-AdminOnlySecurityOn $preRollbackBackupPath $true
            $preRollbackManifest = Get-FullTreeManifest $preRollbackBackupPath
            $preRollbackManifestJson = [ordered]@{ GeneratedAtUtc = [DateTime]::UtcNow.ToString('o'); Entries = $preRollbackManifest } | ConvertTo-Json -Depth 6
            $preRollbackManifestPath = "$preRollbackBackupPath.manifest.json"
            [System.IO.File]::WriteAllText($preRollbackManifestPath, $preRollbackManifestJson, [System.Text.UTF8Encoding]::new($false))
            Set-AdminOnlySecurityOn $preRollbackManifestPath $false
        }
        [System.IO.Directory]::Move($backupPath, $target)
        [System.IO.File]::Delete($backupManifestPath)

        $finalManifest = Get-FullTreeManifest $target
        $verifyMismatches = @()
        foreach ($entry in $recordedManifest) {
            $match = $finalManifest | Where-Object { $_.RelativePath -eq $entry.RelativePath }
            if ($null -eq $match -or $match.Sha256 -ne $entry.Sha256) { $verifyMismatches += $entry.RelativePath }
        }

        $result = [ordered]@{
            SchemaVersion = 'hasarbotu-provision-extra-data-references/1.0.0'
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
    # PROVISION MODU (varsayılan)
    # ------------------------------------------------------------
    if ([string]::IsNullOrWhiteSpace($RepoRoot)) { Throw-SafeError 'REPO_ROOT_REQUIRED' }
    if ([string]::IsNullOrWhiteSpace($DependencyClosureManifestPath)) { Throw-SafeError 'DEPENDENCY_CLOSURE_MANIFEST_PATH_REQUIRED' }
    if ([string]::IsNullOrWhiteSpace($ServiceTargetDir)) { Throw-SafeError 'SERVICE_TARGET_DIR_REQUIRED' }

    $issues = [System.Collections.Generic.List[string]]::new()
    $repoRootFull = [System.IO.Path]::GetFullPath($RepoRoot).TrimEnd('\')
    $serviceTarget = [System.IO.Path]::GetFullPath($ServiceTargetDir).TrimEnd('\')

    if (-not [System.IO.Directory]::Exists($repoRootFull)) { $issues.Add("RepoRoot dizini yok: $repoRootFull") }
    if (-not [System.IO.File]::Exists($DependencyClosureManifestPath)) { $issues.Add("Bağımlılık kapanışı manifest dosyası yok: $DependencyClosureManifestPath") }

    $closureManifest = $null
    if ($issues.Count -eq 0) {
        try {
            $closureManifest = Get-Content -LiteralPath $DependencyClosureManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
        }
        catch {
            $issues.Add("Bağımlılık kapanışı manifest dosyası geçerli JSON değil: $DependencyClosureManifestPath")
        }
        if ($null -ne $closureManifest -and [string]$closureManifest.Status -ne 'ok') {
            $issues.Add("Bağımlılık kapanışı manifesti 'ok' durumunda değil (Status=$($closureManifest.Status)) -- önce resolve-runtime-dependency-closure.mjs başarıyla çalıştırılmalı.")
            $closureManifest = $null
        }
    }

    $mode = if ($Apply) { 'apply' } else { 'preview' }

    if ($issues.Count -gt 0) {
        Write-Host "--- Ek veri referansı sağlama: $mode ($DataLabel) ---" -ForegroundColor Cyan
        Write-Host '--- Ön koşul HATALARI (sağlama yapılamaz) ---' -ForegroundColor Red
        foreach ($issue in $issues) { Write-Host "  - $issue" -ForegroundColor Red }
        $result = [ordered]@{
            SchemaVersion = 'hasarbotu-provision-extra-data-references/1.0.0'
            Mode = $mode
            Status = 'blocked'
            DataLabel = $DataLabel
            Blockers = @($issues)
        }
        $result | ConvertTo-Json -Depth 8
        exit 2
    }

    $extraDataReferences = Get-ClosureArrayProperty $closureManifest 'ExtraDataReferences'

    if ($extraDataReferences.Count -eq 0) {
        Write-Host "--- Ek veri referansı sağlama: $mode ($DataLabel) ---" -ForegroundColor Cyan
        Write-Host 'Kapanışta hiç ExtraDataReferences yok -- sağlanacak bir şey yok.' -ForegroundColor Green
        $result = [ordered]@{
            SchemaVersion = 'hasarbotu-provision-extra-data-references/1.0.0'
            Mode = $mode
            Status = 'nothing_to_provision'
            DataLabel = $DataLabel
            Blockers = @()
        }
        $result | ConvertTo-Json -Depth 8
        exit 0
    }

    # --- Her referans icin kaynak/hedef dizin ciftini deploy-service-artifacts.ps1
    #     ile BIREBIR AYNI matematikle hesapla, targetFileDir'e gore grupla. ---
    $groups = [ordered]@{}
    foreach ($ref in $extraDataReferences) {
        $referencingDeployedPath = Join-Path $serviceTarget ([string]$ref.distRelativePath -replace '/', '\')
        $expectedTargetPath = [System.IO.Path]::GetFullPath((Join-Path (Split-Path -Path $referencingDeployedPath -Parent) ([string]$ref.literal -replace '/', '\')))
        $sourceDataPath = [System.IO.Path]::GetFullPath((Join-Path $repoRootFull ([string]$ref.resolvedRepoRelativePath -replace '/', '\')))
        $targetFileDir = Split-Path -Path $expectedTargetPath -Parent
        $sourceFileDir = Split-Path -Path $sourceDataPath -Parent
        $groupKey = $targetFileDir.ToLowerInvariant()
        if (-not $groups.Contains($groupKey)) {
            $groups[$groupKey] = [ordered]@{
                TargetDir = $targetFileDir
                SourceDir = $sourceFileDir
                References = [System.Collections.Generic.List[object]]::new()
            }
        }
        elseif ($groups[$groupKey].SourceDir -ne $sourceFileDir) {
            $issues.Add("Ek veri referansı grubu tutarsız: aynı hedef dizine ($targetFileDir) farklı kaynak dizinler eşleniyor ($($groups[$groupKey].SourceDir) vs $sourceFileDir).")
        }
        $groups[$groupKey].References.Add([pscustomobject]@{ Ref = $ref; SourceDataPath = $sourceDataPath; ExpectedTargetPath = $expectedTargetPath })
    }

    if ($groups.Count -gt 1) {
        $groupList = ($groups.Keys | ForEach-Object { $groups[$_].TargetDir }) -join '; '
        $issues.Add("$($groups.Count) farklı ek veri kök dizini bulundu ($groupList) -- bu betik şu an yalnız TEK bir kök dizini destekler. Ayrı ayrı çalıştırın veya bu aracı genişletin.")
    }

    if ($issues.Count -gt 0) {
        Write-Host "--- Ek veri referansı sağlama: $mode ($DataLabel) ---" -ForegroundColor Cyan
        Write-Host '--- Ön koşul HATALARI (sağlama yapılamaz) ---' -ForegroundColor Red
        foreach ($issue in $issues) { Write-Host "  - $issue" -ForegroundColor Red }
        $result = [ordered]@{
            SchemaVersion = 'hasarbotu-provision-extra-data-references/1.0.0'
            Mode = $mode
            Status = 'blocked'
            DataLabel = $DataLabel
            Blockers = @($issues)
        }
        $result | ConvertTo-Json -Depth 8
        exit 2
    }

    $group = @($groups.Values)[0]
    $sourceDir = $group.SourceDir
    $target = $group.TargetDir

    if (-not [System.IO.Directory]::Exists($sourceDir)) { $issues.Add("Kaynak veri dizini yok: $sourceDir") }

    $sourceManifest = @()
    if ($issues.Count -eq 0) {
        try { $sourceManifest = Get-FullTreeManifest $sourceDir }
        catch { $issues.Add("Kaynak envanteri okunamadı: $($_.Exception.Data['SafeCode'])") }
        if ($sourceManifest.Count -eq 0) { $issues.Add("Kaynak veri dizini boş: $sourceDir") }
    }

    # --- Kimlik/surum dogrulamasi: allowlist icindeki HER 'snapshot.json'
    #     adli dosya icin (bugun tam olarak bir tane). ---
    $identityChecks = [System.Collections.Generic.List[object]]::new()
    if ($issues.Count -eq 0) {
        $nodeExePath = $null
        try { $nodeExePath = Resolve-NodeExecutable }
        catch { $issues.Add("node.exe PATH'te bulunamadı -- kimlik doğrulaması çalıştırılamadı.") }
        if ($null -ne $nodeExePath) {
            foreach ($entry in $sourceManifest) {
                if ([System.IO.Path]::GetFileName($entry.RelativePath) -eq 'snapshot.json') {
                    $verification = Invoke-SnapshotIdentityVerification $nodeExePath $entry.FullPath
                    $identityChecks.Add([pscustomobject]@{ RelativePath = $entry.RelativePath; Ok = ($verification.ExitCode -eq 0 -and $null -ne $verification.Json -and $verification.Json.Status -eq 'ok') })
                    if ($verification.ExitCode -ne 0 -or $null -eq $verification.Json -or $verification.Json.Status -ne 'ok') {
                        $errorCode = if ($null -ne $verification.Json) { [string]$verification.Json.ErrorCode } else { 'IDENTITY_VERIFIER_RUNTIME_ERROR' }
                        $issues.Add("Kimlik/sürüm doğrulaması BAŞARISIZ ($($entry.RelativePath)): $errorCode -- bu dosya uygulamanın beklediği GERÇEK snapshot sürümü değil, tahrif edilmiş veya bozuk olabilir.")
                    }
                }
            }
        }
    }

    $totalBytes = 0
    if ($sourceManifest.Count -gt 0) {
        $totalBytes = ($sourceManifest | Measure-Object -Property Size -Sum).Sum
    }

    # Saglik tabani: referansi tasiyan servisin KENDI dagitim kokunun
    # ebeveyni (ör. C:\HasarBotu\services) GERCEKTEN var olmali -- yoksa
    # bu, servisin kendisi henuz dagitilmamis demektir ve ek veri
    # saglamanin hicbir anlami yoktur.
    $serviceTargetParent = Split-Path -Path $serviceTarget -Parent
    if (-not [System.IO.Directory]::Exists($serviceTargetParent)) {
        $issues.Add("Servis dağıtım köküne ait üst dizin yok: $serviceTargetParent -- ek veri sağlamadan önce servisin kendi dağıtım alanı kurulmuş olmalı.")
    }

    $targetParent = Split-Path -Path $target -Parent
    $deepestExistingAncestor = Get-DeepestExistingAncestor $targetParent
    if ($null -eq $deepestExistingAncestor) {
        $issues.Add("Hedef için hiçbir üst dizin bulunamadı (sürücü kökü bile yok?): $targetParent")
    }
    elseif (-not (Test-WriteAccessProbe $deepestExistingAncestor)) {
        $issues.Add("Hedef dizin zincirini oluşturmak için yazma izni yok: $deepestExistingAncestor")
    }

    $capacityPass = $false
    if ($null -ne $deepestExistingAncestor) {
        $targetDriveRoot = [System.IO.Path]::GetPathRoot($target)
        $targetDrive = [System.IO.DriveInfo]::new($targetDriveRoot)
        $requiredFreeBytes = [decimal]$totalBytes * [decimal]$RequiredFreeSpaceMultiplier
        $capacityPass = [decimal]$targetDrive.AvailableFreeSpace -ge $requiredFreeBytes
        if (-not $capacityPass) { $issues.Add("Hedef birimde ($targetDriveRoot) yeterli boş alan yok (gerekli: ${RequiredFreeSpaceMultiplier}x = $requiredFreeBytes bayt).") }
    }

    $targetExists = [System.IO.Directory]::Exists($target)
    $alreadyUpToDate = $false
    if ($targetExists -and $issues.Count -eq 0) {
        $targetManifest = Get-FullTreeManifest $target
        $alreadyUpToDate = Test-ManifestsIdentical $sourceManifest $targetManifest
    }

    if ($Apply -and -not $alreadyUpToDate -and -not (Test-IsElevated)) {
        $issues.Add('Yönetici (Administrator) oturumu gerekli (yalnız -Apply ile, zaten güncel değilse).')
    }

    Write-Host "--- Ek veri referansı sağlama: $mode ($DataLabel) ---" -ForegroundColor Cyan
    Write-Host "  Kaynak dizin        : $sourceDir"
    Write-Host "  Hedef dizin         : $target"
    Write-Host "  Sağlanacak dosya sayısı : $($sourceManifest.Count)"
    Write-Host "  Toplam bayt         : $totalBytes"
    Write-Host "  Kimlik doğrulaması yapılan dosya sayısı : $($identityChecks.Count)"
    Write-Host "  Hedef zaten var mı  : $targetExists"
    if ($targetExists -and $issues.Count -eq 0) { Write-Host "  Hedef zaten güncel mi : $alreadyUpToDate" }
    Write-Host ''

    if ($issues.Count -gt 0) {
        Write-Host '--- Ön koşul HATALARI (sağlama yapılamaz) ---' -ForegroundColor Red
        foreach ($issue in $issues) { Write-Host "  - $issue" -ForegroundColor Red }
        $result = [ordered]@{
            SchemaVersion = 'hasarbotu-provision-extra-data-references/1.0.0'
            Mode = $mode
            Status = 'blocked'
            DataLabel = $DataLabel
            SourceFileCount = $sourceManifest.Count
            IdentityVerifiedFileCount = @($identityChecks | Where-Object { $_.Ok }).Count
            TotalBytes = [int64]$totalBytes
            Blockers = @($issues)
        }
        $result | ConvertTo-Json -Depth 8
        exit 2
    }

    if ($alreadyUpToDate) {
        Write-Host 'Hedef zaten kaynakla BİREBİR aynı — hiçbir değişiklik gerekmiyor (idempotent).' -ForegroundColor Green
        $result = [ordered]@{
            SchemaVersion = 'hasarbotu-provision-extra-data-references/1.0.0'
            Mode = $mode
            Status = 'already_up_to_date'
            DataLabel = $DataLabel
            SourceFileCount = $sourceManifest.Count
            IdentityVerifiedFileCount = @($identityChecks | Where-Object { $_.Ok }).Count
            TotalBytes = [int64]$totalBytes
            Blockers = @()
        }
        $result | ConvertTo-Json -Depth 8
        exit 0
    }

    Write-Host 'Ön koşullar karşılandı (kimlik/sürüm doğrulaması dahil).' -ForegroundColor Green
    Write-Host ''
    Write-Host 'Uygulanacak adımlar (sıra ÖNEMLİDİR):' -ForegroundColor Yellow
    $stepNumber = 1
    Write-Host "  $stepNumber. Kaynak dizin TAZE olarak yeniden taranır (eksik/fazla/değişmiş kontrolü)"; $stepNumber++
    Write-Host "  $stepNumber. Yeni içerik staging dizinine kopyalanır ve hash doğrulanır"; $stepNumber++
    if ($targetExists) {
        Write-Host "  $stepNumber. Mevcut hedef Administrators-only, zaman damgalı yedeğe TAŞINIR (kopya değil)"; $stepNumber++
    }
    Write-Host "  $stepNumber. Staging dizini atomik olarak hedefe TAŞINIR"; $stepNumber++
    Write-Host "  $stepNumber. Hedefteki her dosya YENİDEN okunup kaynak hash'iyle bağımsız doğrulanır"; $stepNumber++
    Write-Host ''

    if (-not $Apply) {
        Write-Host '-Apply verilmedi: yalnız plan gösterildi, HİÇBİR değişiklik yapılmadı.' -ForegroundColor Cyan
        $result = [ordered]@{
            SchemaVersion = 'hasarbotu-provision-extra-data-references/1.0.0'
            Mode = $mode
            Status = 'would_apply'
            DataLabel = $DataLabel
            SourceFileCount = $sourceManifest.Count
            IdentityVerifiedFileCount = @($identityChecks | Where-Object { $_.Ok }).Count
            TotalBytes = [int64]$totalBytes
            Manifest = $sourceManifest | Select-Object RelativePath, Sha256, Size
            Blockers = @()
        }
        $result | ConvertTo-Json -Depth 8
        exit 0
    }

    if (-not $PSCmdlet.ShouldProcess($target, 'Sağla')) { exit 0 }

    # --- TOCTOU korumasi: staging'e kopyalamadan HEMEN ONCE kaynagi TAZE yeniden tara ---
    $freshSourceManifest = Get-FullTreeManifest $sourceDir
    $diff = Get-ManifestDiff $sourceManifest $freshSourceManifest
    if (-not $diff.IsIdentical) {
        $result = [ordered]@{
            SchemaVersion = 'hasarbotu-provision-extra-data-references/1.0.0'
            Mode = $mode
            Status = 'error'
            ErrorCode = 'SOURCE_DATA_CHANGED_SINCE_PLAN'
            DataLabel = $DataLabel
            MissingSincePlan = $diff.Missing
            ExtraSincePlan = $diff.Extra
            ChangedSincePlan = $diff.Changed
            Blockers = @()
        }
        $result | ConvertTo-Json -Depth 8
        exit 1
    }

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
            $backupPath = Join-Path $BackupRootDirectory "$DataLabel-$timestamp-$suffix"
            [System.IO.Directory]::Move($target, $backupPath)
            Set-AdminOnlySecurityOn $backupPath $true
            $backupManifest = Get-FullTreeManifest $backupPath
            $backupManifestJson = [ordered]@{ GeneratedAtUtc = [DateTime]::UtcNow.ToString('o'); SourceTargetDir = $target; Entries = $backupManifest } | ConvertTo-Json -Depth 8
            $backupManifestPath = "$backupPath.manifest.json"
            [System.IO.File]::WriteAllText($backupManifestPath, $backupManifestJson, [System.Text.UTF8Encoding]::new($false))
            Set-AdminOnlySecurityOn $backupManifestPath $false
        }
        else {
            [System.IO.Directory]::CreateDirectory($targetParent) | Out-Null
        }

        [System.IO.Directory]::Move($stagingPath, $target)
    }
    catch {
        if ([System.IO.Directory]::Exists($stagingPath)) { [System.IO.Directory]::Delete($stagingPath, $true) }
        throw
    }

    # --- BAGIMSIZ DOGRULAMA (staging'e degil, kaynagin ORIJINAL hash'ine karsi) ---
    $finalManifest = Get-FullTreeManifest $target
    $verifyMismatches = [System.Collections.Generic.List[string]]::new()
    foreach ($entry in $sourceManifest) {
        $match = $finalManifest | Where-Object { $_.RelativePath -eq $entry.RelativePath }
        if ($null -eq $match -or $match.Sha256 -ne $entry.Sha256) { $verifyMismatches.Add($entry.RelativePath) }
    }
    if ($finalManifest.Count -ne $sourceManifest.Count) {
        $verifyMismatches.Add("FILE_COUNT_MISMATCH_expected_$($sourceManifest.Count)_actual_$($finalManifest.Count)")
    }

    $result = [ordered]@{
        SchemaVersion = 'hasarbotu-provision-extra-data-references/1.0.0'
        Mode = $mode
        Status = if ($verifyMismatches.Count -eq 0) { 'applied' } else { 'error' }
        DataLabel = $DataLabel
        SourceFileCount = $sourceManifest.Count
        IdentityVerifiedFileCount = @($identityChecks | Where-Object { $_.Ok }).Count
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
        SchemaVersion = 'hasarbotu-provision-extra-data-references/1.0.0'
        Status = 'error'
        ErrorCode = if ($null -ne $_.Exception.Data -and $_.Exception.Data.Contains('SafeCode')) { [string]$_.Exception.Data['SafeCode'] } else { 'PROVISION_RUNTIME_ERROR' }
        ErrorType = $_.Exception.GetType().Name
        ErrorLine = $_.InvocationInfo.ScriptLineNumber
    }
    $safeError | ConvertTo-Json -Depth 4
    exit 1
}
