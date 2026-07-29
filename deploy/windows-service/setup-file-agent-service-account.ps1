#Requires -Version 5.1
<#
.SYNOPSIS
    File Agent icin adanmis, en-az-yetkili yerel servis hesabini VE WinSW
    servis kurulumunu ATOMIK olarak PLANLAR, ONIZLER ve (yalniz -Apply
    ile) UYGULAR (D6, HB-2026-113/114/115/116).

.DESCRIPTION
    HB-2026-113 karari: File Agent, WinSW varsayilani olan LocalSystem
    YERINE ayri bir yerel servis hesabi (varsayilan: svc-hb-fileagent)
    altinda calisir. HB-2026-116'da bu betik, hesap + LSA haklari + ACL +
    GERCEK WinSW servis kurulumunu TEK ATOMIK islem haline getirdi: adimlar
    SIRAYLA uygulanir; HERHANGI biri basarisiz olursa, o ana kadar
    TAMAMLANMIS TUM adimlar TERS SIRAYLA geri alinmaya calisilir (hesap
    silinir, verilen LSA haklari kaldirilir, ACL onceki haline dondurulur,
    kurulan servis kaldirilir) - ya HEPSI basarili ya da HICBIRI kalici
    degildir.

    Bu betik dort seyi PLANLAR/DOGRULAR/UYGULAR:

      1. Hesabin VARLIGI ve "Users" grubu uyeliginden CIKARILMIS olmasi.
      2. "Log on as a service" hakki (SeServiceLogonRight) VAR mi.
      3. Etkilesimli/RDP oturum YASAGI (SeDenyInteractiveLogonRight,
         SeDenyRemoteInteractiveLogonRight) VAR mi.
      4. Hedef depolama kokunde VE File Agent uygulama dizininde NTFS
         en-az-yetki ACL'i (Everyone/Users/Authenticated Users YOK) dogru
         mu; WinSW XML'inde `<serviceaccount>` kimligi dogru mu (PAROLA
         ICERMEDEN); GERCEK WinSW servisi kurulu mu, `Disabled`
         baslangic turunde mi (KURULUR ama HICBIR ZAMAN BASLATILMAZ).

    HB-2026-115 duzeltmesi: depolama koku ACL'i YALNIZ File Agent servis
    hesabina degil, pCloud'u calistiran ETKILESIMLI KULLANICI hesabina da
    (`-PCloudSyncAccount`) Modify verir - aksi halde NTFS senkron klasor
    moduna gecildiginde pCloud'un kendisi o klasore YAZAMAZ ve
    senkronizasyon SESSIZCE durur (bkz. `-PCloudSyncAccount`).

    `-Apply` VERILMEDEN bu betik HICBIR kalici degisiklik yapmaz; yalniz
    MEVCUT durumu okur ve YAPILACAK plani yazdirir (AGENTS.md SS7 "kritik
    islem standardi": Planla -> Onizle -> Onay -> Uygula -> Dogrula).

    PAROLA GUVENLIGI (HB-2026-116/117): Parola operator tarafindan
    VERILMEZ - betik `-Apply` sirasinda BIR KEZ, kriptografik RNG ile
    kendi uretir, yalniz `SecureString` olarak bellekte tutar. Parola:
    (1) hesabi olusturur/sifirlar (`New-LocalUser`/`Set-LocalUser`),
    (2) SCM'ye DOGRUDAN Win32 API'siyle (`ChangeServiceConfigW`,
    `advapi32.dll`) aktarilir - `sc.exe` gibi bir COCUK SUREC ASLA
    baslatilmaz, bu yuzden parola HICBIR ZAMAN bir komut satiri
    argumaninda (argv) gorunmez; API'ye yalniz gecici, unmanaged bir
    bellek pointer'i (IntPtr) olarak gecer ve cagri biter bitmez
    `Marshal.ZeroFreeGlobalAllocUnicode` ile ONCE SIFIRLANIR SONRA
    serbest birakilir. Parola HICBIR ZAMAN: repo'ya, WinSW XML'ine (ne
    sablon ne render edilmis kopya), herhangi bir log/transcript
    dosyasina, ortam degiskenine, konsol ciktisina YAZILMAZ. Islem
    bittikten sonra parolayi bilen/hatirlayan HICBIR
    kayit KALMAZ - bu KASITLIDIR: hesap yalniz "Log on as a service" icin
    kullanilir, hicbir insan ona etkilesimli giris yapmaz, parolayi
    bilmesi GEREKMEZ. Rotasyon, betigi tekrar `-Apply` ile calistirip
    parolayi/SCM kaydini YENIDEN uretmektir (ayri, gelecekteki bir adim).

.PARAMETER AccountName
    Olusturulacak/dogrulanacak yerel hesap adi (varsayilan:
    svc-hb-fileagent).

.PARAMETER StorageRoot
    File Agent'in depolama koku (varsayilan: HB-2026-112/113'teki hedef).
    Bu betik klasoru OLUSTURMAZ - onceden var olmalidir (pCloud senkron
    klasor gecisi, RUNBOOK SS2/SS2a, ayri bir adimdir).

.PARAMETER PCloudSyncAccount
    (HB-2026-115 duzeltmesi) pCloud istemcisinin (`pCloud.exe`) calistigi
    ETKILESIMLI KULLANICI hesabi (varsayilan: bu oturumun kendisi,
    "$env:COMPUTERNAME\$env:USERNAME"). NTFS senkron klasor moduna
    gecildiginde pCloud'un GERCEKTEN dosya yazabilmesi icin bu hesap da
    depolama kokunde Modify almalidir - servis hesabina (File Agent) ACL
    vermek TEK BASINA YETMEZ, pCloud'un kendi yazma erisimini KESER. File
    Agent uygulama dizininde/loglarinda bu hesaba HICBIR yetki VERILMEZ
    (pCloud o dizinlere dokunmaz).

.PARAMETER FileAgentAppDir
    File Agent dagitim dizini (icinde `dist\index.js`, `logs\` bulunur,
    GERCEK kurulumda WinSW ikilisi/XML'i de buraya kopyalanir/render
    edilir). Hesabin Read+Execute (+ yalniz `logs`da Modify) alacagi
    dizin.

.PARAMETER WinSwXmlPath
    (Opsiyonel, salt-okunur ONIZLEME icin) Dogrulanacak WinSW XML
    dosyasinin yolu - repo'daki sabit sablon veya sentetik test dosyasi
    olabilir. `-Apply` sirasinda KULLANILMAZ (render hedefi her zaman
    `$FileAgentAppDir\$ServiceName.xml`dir); yalniz onizlemede "eklenirse
    ne olur" gostermek icin verilebilir.

.PARAMETER WinSwExe
    GERCEK kurulum icin: onceden indirilmis WinSW ikili dosyasinin mutlak
    yolu (bu repo WinSW'yi DAGITMAZ, bkz. `install-services.ps1`). Yalniz
    `-Apply` icin GEREKLIDIR.

.PARAMETER WinSwTemplatePath
    Render edilecek WinSW XML SABLONU (varsayilan: bu betikle ayni
    dizindeki `hasarbotu-file-agent.winsw.xml` - repo'daki GERCEK, sabit
    sablon; hicbir zaman DEGISTIRILMEZ, yalniz OKUNUR).

.PARAMETER NodeExe
    node.exe mutlak yolu. Verilmezse PATH'ten tespit edilir (yalniz
    `-Apply` icin gereklidir).

.PARAMETER ServiceName
    WinSW servis kimligi (varsayilan: hasarbotu-file-agent).

.PARAMETER Apply
    Verilmezse yalniz mevcut durum + plan yazdirilir, HICBIR degisiklik
    yapilmaz. Gercek uygulama icin ACIKCA verilmelidir (ayrica yukseltme
    ve PSCmdlet.ShouldProcess onayi GEREKTIRIR). Basarili UYGULAMA SONUNDA
    dahi servis `Disabled` baslangic turundedir ve BASLATILMAMISTIR -
    servisi etkinlestirme/baslatma bu betigin KAPSAMI DISINDADIR, ayri,
    acikca onaylanmis bir adimdir.

.EXAMPLE
    # Onizleme (hicbir sey degismez):
    .\setup-file-agent-service-account.ps1 -FileAgentAppDir C:\HasarBotu\services\file-agent

.EXAMPLE
    # Gercek uygulama (yalniz D6'nin gercek yurutulmesinde; parola
    # OPERATORDEN ALINMAZ, betik kendi uretir):
    .\setup-file-agent-service-account.ps1 -FileAgentAppDir C:\HasarBotu\services\file-agent `
        -WinSwExe C:\Tools\WinSW-x64.exe `
        -PCloudSyncAccount 'DESKTOP-EFN2G33\<pCloud'u calistiran gercek kullanici>' `
        -Apply

.NOTES
    Yonetici (elevation) yalniz `-Apply` icin GEREKIR; salt-okunur
    plan/dogrulama yukseltme OLMADAN da calisir.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    # HB-2026-118: Windows yerel hesap adlari (SAM) EN FAZLA 20 karakter
    # olabilir - `svc-hasarbotu-fileagent` (23 karakter) GERCEK -Apply
    # calistirmasinda `New-LocalUser` parametre dogrulamasiyla BASARISIZ
    # oldu (atomik rollback DOGRU sekilde devreye girip hicbir iz
    # birakmadan geri aldi). Varsayilan `svc-hb-fileagent`e (16 karakter)
    # kisaltildi; ek olarak ASAGIDAKI dogrulama, ozel bir -AccountName
    # verilirse AYNI hatanin sessizce New-LocalUser'a kadar ULASMASINI
    # onler.
    [ValidateLength(1, 20)]
    [string]$AccountName = 'svc-hb-fileagent',

    [string]$StorageRoot = 'C:\HasarBotuStorage\BARAN GLOBAL EKSPERTİZ',

    [string]$PCloudSyncAccount = "$env:COMPUTERNAME\$env:USERNAME",

    [Parameter(Mandatory = $true)]
    [string]$FileAgentAppDir,

    [string]$WinSwXmlPath,

    [string]$WinSwExe,

    [string]$WinSwTemplatePath,

    [string]$NodeExe,

    [string]$ServiceName = 'hasarbotu-file-agent',

    [switch]$Apply
)

$ErrorActionPreference = 'Stop'

# NOT: varsayilan deger param() blogunda `$PSScriptRoot` ile VERILMEZ -
# bazi cagrim yollarinda (ör. dot-source) `$PSScriptRoot` param blogu
# degerlendirilirken henuz BOS olabilir (gercekten test edilip BULUNDU:
# "Join-Path: Cannot bind argument... empty string"). Govde icinde,
# `$PSScriptRoot` KESIN dolu oldugunda cozulur.
if (-not $WinSwTemplatePath) {
    $WinSwTemplatePath = Join-Path $PSScriptRoot 'hasarbotu-file-agent.winsw.xml'
}

try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
} catch {
    # Bazi barindirilmis konsollarda OutputEncoding salt-okunur olabilir;
    # bu yalniz GORUNTUYU etkiler, dosya yazimlarini etkilemez.
}

# HB-2026-110'da bulunan gercek kusur: `+` ile string birlestirme, PowerShell
# 5.1'de array-literal icinde beklenmedik bicimde bolunebiliyor. Bu betikte
# HICBIR yerde `+` string birlestirme KULLANILMAZ - yalniz double-quote
# interpolasyon.

$sensitiveRightsRequired = @('SeServiceLogonRight')
$sensitiveRightsDenied = @('SeDenyInteractiveLogonRight', 'SeDenyRemoteInteractiveLogonRight')

function Test-IsElevated {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# --- LSA (Local Security Authority) haklari icin P/Invoke -----------------
# Ek dependency GEREKTIRMEZ (yalniz advapi32.dll, Windows'ta her zaman
# mevcuttur). Ayni yaklasim yaygin bilinen, herkese acik "Add-AccountRight"
# desenidir (LsaAddAccountRights/LsaEnumerateAccountRights/LsaRemoveAccountRights).
if (-not ('HasarBotu.Lsa' -as [type])) {
    Add-Type -Namespace HasarBotu -Name Lsa -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)]
public struct LSA_UNICODE_STRING {
    public ushort Length;
    public ushort MaximumLength;
    public IntPtr Buffer;
}

[StructLayout(LayoutKind.Sequential)]
public struct LSA_OBJECT_ATTRIBUTES {
    public int Length;
    public IntPtr RootDirectory;
    public IntPtr ObjectName;
    public int Attributes;
    public IntPtr SecurityDescriptor;
    public IntPtr SecurityQualityOfService;
}

[DllImport("advapi32.dll", SetLastError = true)]
public static extern uint LsaOpenPolicy(IntPtr SystemName, ref LSA_OBJECT_ATTRIBUTES ObjectAttributes, int DesiredAccess, out IntPtr PolicyHandle);

[DllImport("advapi32.dll", SetLastError = true)]
public static extern uint LsaAddAccountRights(IntPtr PolicyHandle, byte[] AccountSid, LSA_UNICODE_STRING[] UserRights, int CountOfRights);

[DllImport("advapi32.dll", SetLastError = true)]
public static extern uint LsaRemoveAccountRights(IntPtr PolicyHandle, byte[] AccountSid, bool AllRights, LSA_UNICODE_STRING[] UserRights, int CountOfRights);

[DllImport("advapi32.dll", SetLastError = true)]
public static extern uint LsaEnumerateAccountRights(IntPtr PolicyHandle, byte[] AccountSid, out IntPtr UserRights, out int CountOfRights);

[DllImport("advapi32.dll")]
public static extern int LsaClose(IntPtr ObjectHandle);

[DllImport("advapi32.dll")]
public static extern int LsaNtStatusToWinError(uint status);

[DllImport("advapi32.dll")]
public static extern int LsaFreeMemory(IntPtr Buffer);
'@
}

# --- SCM (Service Control Manager) icin P/Invoke ---------------------------
# HB-2026-117: `sc.exe config ... password=` cocuk surec olusturup parolayi
# KOMUT SATIRI ARGUMANI olarak tasiyordu - bu, calistigi kisa sure boyunca
# baska bir surecin (WMI Win32_Process, Process Explorer, denetim/audit
# araclari) surecin komut satirini okuyabilmesi anlamina gelir. Bunun yerine
# DOGRUDAN Win32 SCM API'si (OpenSCManagerW/OpenServiceW/ChangeServiceConfigW)
# COCUK SUREC OLUSTURMADAN cagrilir - parola hicbir zaman bir komut satirinda
# GORUNMEZ, yalniz bu surecin KENDI bellegindeki gecici, acikca sifirlanan
# bir unmanaged arabellek uzerinden Windows'un kendi SCM'sine aktarilir.
if (-not ('HasarBotu.Svc' -as [type])) {
    Add-Type -Namespace HasarBotu -Name Svc -MemberDefinition @'
[DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
public static extern IntPtr OpenSCManagerW(string lpMachineName, string lpDatabaseName, uint dwDesiredAccess);

[DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
public static extern IntPtr OpenServiceW(IntPtr hSCManager, string lpServiceName, uint dwDesiredAccess);

[DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
public static extern bool ChangeServiceConfigW(
    IntPtr hService,
    uint dwServiceType,
    uint dwStartType,
    uint dwErrorControl,
    string lpBinaryPathName,
    string lpLoadOrderGroup,
    IntPtr lpdwTagId,
    string lpDependencies,
    string lpServiceStartName,
    IntPtr lpPassword,
    string lpDisplayName);

[DllImport("advapi32.dll", SetLastError = true)]
public static extern bool CloseServiceHandle(IntPtr hSCObject);
'@
}

function Get-LsaPolicyHandle {
    $objectAttributes = New-Object HasarBotu.Lsa+LSA_OBJECT_ATTRIBUTES
    $policyHandle = [IntPtr]::Zero
    # POLICY_ALL_ACCESS yerine yalniz ihtiyac duyulan erisim: LOOKUP_NAMES(0x0800) yok,
    # burada CREATE_ACCOUNT(0x0010)+GET_PRIVATE_INFORMATION gerekmez; en-az-yetki icin
    # yalniz 0x0800 (VIEW_LOCAL_INFORMATION) + 0x0010 (TRUST_ADMIN) yerine dogrudan
    # gerekli iki cagriyi (Add/Remove/EnumerateAccountRights) destekleyen 0x00F0FFF
    # (POLICY_ALL_ACCESS) kullanilir - LSA politika nesnesi ICIN, hedef DOSYA/HESAP
    # ICIN degildir; bu betigin calistigi surec zaten yonetici oldugu icin ek risk
    # TASIMAZ.
    $POLICY_ALL_ACCESS = 0x000F0FFF
    $status = [HasarBotu.Lsa]::LsaOpenPolicy([IntPtr]::Zero, [ref]$objectAttributes, $POLICY_ALL_ACCESS, [ref]$policyHandle)
    if ($status -ne 0) {
        $win32Error = [HasarBotu.Lsa]::LsaNtStatusToWinError($status)
        throw "LsaOpenPolicy basarisiz (NTSTATUS=$status, Win32=$win32Error)."
    }
    return $policyHandle
}

function Get-AccountSidBytes {
    param([Parameter(Mandatory = $true)][string]$Account)
    $ntAccount = New-Object System.Security.Principal.NTAccount($Account)
    $sid = $ntAccount.Translate([System.Security.Principal.SecurityIdentifier])
    $bytes = New-Object byte[] ($sid.BinaryLength)
    $sid.GetBinaryForm($bytes, 0)
    return $bytes
}

function ConvertTo-LsaUnicodeStringArray {
    param([string[]]$Values)
    $result = New-Object 'System.Collections.Generic.List[HasarBotu.Lsa+LSA_UNICODE_STRING]'
    foreach ($value in $Values) {
        $lsaString = New-Object HasarBotu.Lsa+LSA_UNICODE_STRING
        $lsaString.Buffer = [System.Runtime.InteropServices.Marshal]::StringToHGlobalUni($value)
        $lsaString.Length = [uint16]($value.Length * 2)
        $lsaString.MaximumLength = [uint16](($value.Length + 1) * 2)
        $result.Add($lsaString)
    }
    return , $result.ToArray()
}

function Get-AccountRights {
    <# Salt-okunur: hesabin SU ANDA sahip oldugu TUM LSA haklarini dondurur.
       Herhangi bir hesaba karsi GUVENLE cagrilabilir (hicbir sey degistirmez). #>
    param([Parameter(Mandatory = $true)][string]$Account)
    if (-not (Test-LocalOrWellKnownAccountExists -Account $Account)) { return @() }
    $sidBytes = Get-AccountSidBytes -Account $Account
    $policyHandle = Get-LsaPolicyHandle
    try {
        $rightsPtr = [IntPtr]::Zero
        $count = 0
        $status = [HasarBotu.Lsa]::LsaEnumerateAccountRights($policyHandle, $sidBytes, [ref]$rightsPtr, [ref]$count)
        if ($status -eq 2) { return @() } # STATUS_OBJECT_NAME_NOT_FOUND: hesabin hicbir ozel hakki yok
        if ($status -ne 0) {
            $win32Error = [HasarBotu.Lsa]::LsaNtStatusToWinError($status)
            throw "LsaEnumerateAccountRights basarisiz (NTSTATUS=$status, Win32=$win32Error)."
        }
        $rights = New-Object 'System.Collections.Generic.List[string]'
        $structSize = [System.Runtime.InteropServices.Marshal]::SizeOf([type]'HasarBotu.Lsa+LSA_UNICODE_STRING')
        for ($i = 0; $i -lt $count; $i++) {
            $currentPtr = [IntPtr]::Add($rightsPtr, $i * $structSize)
            $lsaString = [System.Runtime.InteropServices.Marshal]::PtrToStructure($currentPtr, [type]'HasarBotu.Lsa+LSA_UNICODE_STRING')
            $rights.Add([System.Runtime.InteropServices.Marshal]::PtrToStringUni($lsaString.Buffer, [int]($lsaString.Length / 2)))
        }
        [HasarBotu.Lsa]::LsaFreeMemory($rightsPtr) | Out-Null
        return $rights.ToArray()
    } finally {
        [HasarBotu.Lsa]::LsaClose($policyHandle) | Out-Null
    }
}

function Grant-AccountRights {
    <# YAZAR: hesaba belirtilen LSA haklarini VERIR. Yalniz -Apply akisinda cagrilir. #>
    param([Parameter(Mandatory = $true)][string]$Account, [Parameter(Mandatory = $true)][string[]]$Rights)
    $sidBytes = Get-AccountSidBytes -Account $Account
    $policyHandle = Get-LsaPolicyHandle
    try {
        $lsaRights = ConvertTo-LsaUnicodeStringArray -Values $Rights
        $status = [HasarBotu.Lsa]::LsaAddAccountRights($policyHandle, $sidBytes, $lsaRights, $lsaRights.Length)
        if ($status -ne 0) {
            $win32Error = [HasarBotu.Lsa]::LsaNtStatusToWinError($status)
            throw "LsaAddAccountRights basarisiz ($($Rights -join ', '); NTSTATUS=$status, Win32=$win32Error)."
        }
    } finally {
        [HasarBotu.Lsa]::LsaClose($policyHandle) | Out-Null
    }
}

function Remove-AccountRights {
    <# GERI ALMA: hesaptan belirtilen LSA haklarini KALDIRIR. Yalniz
       rollback akisinda cagrilir. #>
    param([Parameter(Mandatory = $true)][string]$Account, [Parameter(Mandatory = $true)][string[]]$Rights)
    $sidBytes = Get-AccountSidBytes -Account $Account
    $policyHandle = Get-LsaPolicyHandle
    try {
        $lsaRights = ConvertTo-LsaUnicodeStringArray -Values $Rights
        $status = [HasarBotu.Lsa]::LsaRemoveAccountRights($policyHandle, $sidBytes, $false, $lsaRights, $lsaRights.Length)
        if ($status -ne 0) {
            $win32Error = [HasarBotu.Lsa]::LsaNtStatusToWinError($status)
            Write-Host "  UYARI: LsaRemoveAccountRights basarisiz ($($Rights -join ', '); NTSTATUS=$status, Win32=$win32Error) - elle kontrol edin." -ForegroundColor Red
        }
    } finally {
        [HasarBotu.Lsa]::LsaClose($policyHandle) | Out-Null
    }
}

function Test-LocalOrWellKnownAccountExists {
    param([Parameter(Mandatory = $true)][string]$Account)
    try {
        $ntAccount = New-Object System.Security.Principal.NTAccount($Account)
        $ntAccount.Translate([System.Security.Principal.SecurityIdentifier]) | Out-Null
        return $true
    } catch {
        return $false
    }
}

# --- NTFS en-az-yetki ACL --------------------------------------------------

function Get-DirectoryAclReport {
    <# Salt-okunur: mevcut ACL'i, IsProtected (miras kesilmis mi) ve
       ACE listesini insan-okunabilir bicimde dondurur. #>
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        return [pscustomobject]@{ Exists = $false; IsProtected = $null; Rules = @() }
    }
    $acl = Get-Acl -LiteralPath $Path
    $rules = foreach ($access in $acl.Access) {
        [pscustomobject]@{
            Identity = $access.IdentityReference.Value
            Rights   = $access.FileSystemRights.ToString()
            Type     = $access.AccessControlType.ToString()
            Inherited = $access.IsInherited
        }
    }
    return [pscustomobject]@{ Exists = $true; IsProtected = $acl.AreAccessRulesProtected; Rules = @($rules) }
}

function New-AclGrant {
    <# Yardimci: Test-LeastPrivilegeAcl/Set-LeastPrivilegeAcl'in $Grants
       dizisi icin tek bir eleman olusturur. #>
    param(
        [Parameter(Mandatory = $true)][string]$Identity,
        [Parameter(Mandatory = $true)][System.Security.AccessControl.FileSystemRights]$Rights
    )
    return @{ Identity = $Identity; Rights = $Rights }
}

function Test-LeastPrivilegeAcl {
    <# Salt-okunur dogrulama: miras kesilmis mi, HER $Grants elemani TAM
       OLARAK beklenen haklara sahip mi, genis (Everyone/Users/Authenticated
       Users) hicbir ACE YOK mu, $Grants DISINDA baska bir ACE YOK mu
       (HB-2026-115: birden fazla hesaba - ör. File Agent servis hesabi VE
       pCloud'u calistiran etkilesimli kullanici - grant desteklenir). #>
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][hashtable[]]$Grants
    )
    $report = Get-DirectoryAclReport -Path $Path
    $problems = New-Object 'System.Collections.Generic.List[string]'
    if (-not $report.Exists) {
        $problems.Add("Yol mevcut degil: $Path")
        return [pscustomobject]@{ Pass = $false; Problems = $problems.ToArray(); Report = $report }
    }
    if (-not $report.IsProtected) {
        $problems.Add('Miras KESILMEMIS (ust dizinden genis haklar sizabilir) - icacls /inheritance:d veya SetAccessRuleProtection(true,false) gerekir.')
    }
    $broadIdentities = @('Everyone', 'BUILTIN\Users', 'NT AUTHORITY\Authenticated Users', 'NT AUTHORITY\SYSTEM')
    foreach ($rule in $report.Rules) {
        if ($broadIdentities -contains $rule.Identity) {
            $problems.Add("Genis/beklenmeyen ACE bulundu: $($rule.Identity) ($($rule.Rights))")
        }
    }
    foreach ($grant in $Grants) {
        # .NET FileSystemAccessRule constructor "Allow" kurallari icin
        # OTOMATIK olarak Synchronize bitini ekler (ör. Modify -> "Modify,
        # Synchronize"); bu, Get-Acl/Set-Acl round-trip'inden BAGIMSIZ,
        # .NET'in kendi kurucusunun davranisidir. Bu yuzden ham
        # Rights.ToString() ile DEGIL, AYNI kurucu ile olusturulmus bir
        # REFERANS kuralin ToString()'i ile karsilastirilir (kendi-tutarli).
        $referenceRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            'Everyone', $grant.Rights, 'ContainerInherit, ObjectInherit', 'None', 'Allow')
        $expectedRightsString = $referenceRule.FileSystemRights.ToString()

        $accountRule = $report.Rules | Where-Object { $_.Identity -like "*$($grant.Identity)" }
        if (-not $accountRule) {
            $problems.Add("$($grant.Identity) icin hicbir ACE bulunamadi.")
        } else {
            foreach ($rule in $accountRule) {
                if ($rule.Rights -ne $expectedRightsString) {
                    $problems.Add("$($grant.Identity) hakki beklenenden FARKLI: gorulen='$($rule.Rights)' beklenen='$expectedRightsString'")
                }
            }
        }
    }
    $expectedIdentities = @($Grants | ForEach-Object { $_.Identity })
    foreach ($rule in $report.Rules) {
        $isExpected = $false
        foreach ($identity in $expectedIdentities) { if ($rule.Identity -like "*$identity") { $isExpected = $true } }
        if (-not $isExpected -and -not ($broadIdentities -contains $rule.Identity)) {
            $problems.Add("BEKLENMEYEN fazladan ACE bulundu: $($rule.Identity) ($($rule.Rights)) - Grants listesinde YOK.")
        }
    }
    return [pscustomobject]@{ Pass = ($problems.Count -eq 0); Problems = $problems.ToArray(); Report = $report }
}

function Set-LeastPrivilegeAcl {
    <# YAZAR: mirasi keser, YALNIZ $Grants listesindeki hesaplara belirtilen
       haklari verir (baska hicbir ACE eklenmez - Administrators dahil
       gereken her grant caller tarafindan ACIKCA $Grants icine konur).
       Yalniz -Apply akisinda cagrilir. #>
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][hashtable[]]$Grants
    )
    if (-not (Test-Path -LiteralPath $Path)) { throw "Yol mevcut degil, ACL uygulanamaz: $Path" }
    $acl = New-Object System.Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    $inheritFlags = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    $propagationFlags = [System.Security.AccessControl.PropagationFlags]::None
    foreach ($grant in $Grants) {
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            $grant.Identity, $grant.Rights, $inheritFlags, $propagationFlags, [System.Security.AccessControl.AccessControlType]::Allow)
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}

# --- WinSW kimlik yapilandirmasi (PAROLASIZ) -------------------------------

function Test-WinSwServiceAccountIdentity {
    <# Salt-okunur: XML'de <serviceaccount>/<user> beklenen hesaba esit mi,
       <allowservicelogon>true mi, VE - kritik guvenlik kontrolu - HICBIR
       <password> elemani YOK mu (varsa bu betigin/sablon disciplininin
       ihlal edildigini gosterir). #>
    param([Parameter(Mandatory = $true)][string]$XmlPath, [Parameter(Mandatory = $true)][string]$AccountName)
    if (-not (Test-Path -LiteralPath $XmlPath)) {
        return [pscustomobject]@{ Pass = $false; Problems = @("WinSW XML bulunamadi: $XmlPath") }
    }
    # HB-2026-110 dersi: PowerShell 5.1'in `Get-Content -Raw` varsayilan
    # kodlamasi BOM'suz dosyalarda sistem ANSI kod sayfasina (tr-TR'de
    # Windows-1254) duser; Turkce yorum/metin iceren WinSW XML'i acikca
    # UTF-8 olarak OKUNUR.
    [xml]$xml = [System.IO.File]::ReadAllText($XmlPath, [System.Text.Encoding]::UTF8)
    $problems = New-Object 'System.Collections.Generic.List[string]'
    $serviceAccount = $xml.service.serviceaccount
    if ($null -eq $serviceAccount) {
        $problems.Add('<serviceaccount> elemani YOK.')
        return [pscustomobject]@{ Pass = $false; Problems = $problems.ToArray() }
    }
    if ($serviceAccount.user -ne $AccountName) {
        $problems.Add("user beklenenden FARKLI: gorulen='$($serviceAccount.user)' beklenen='$AccountName'")
    }
    if ($serviceAccount.allowservicelogon -ne 'true') {
        $problems.Add("allowservicelogon 'true' DEGIL (gorulen: '$($serviceAccount.allowservicelogon)')")
    }
    if ($null -ne $serviceAccount.password -and $serviceAccount.password.Trim().Length -gt 0) {
        $problems.Add('<password> elemani DOLU - bu betik/sablon disciplini parola XML icine YAZMAMALIDIR.')
    }
    return [pscustomobject]@{ Pass = ($problems.Count -eq 0); Problems = $problems.ToArray() }
}

function Set-WinSwServiceAccountIdentity {
    <# YAZAR: <serviceaccount> elemanini ekler/gunceller - user/domain/
       allowservicelogon YAZAR, <password> ASLA YAZMAZ. Yalniz -Apply
       akisinda cagrilir. #>
    param([Parameter(Mandatory = $true)][string]$XmlPath, [Parameter(Mandatory = $true)][string]$AccountName)
    if (-not (Test-Path -LiteralPath $XmlPath)) { throw "WinSW XML bulunamadi: $XmlPath" }
    [xml]$xml = [System.IO.File]::ReadAllText($XmlPath, [System.Text.Encoding]::UTF8)
    $existing = $xml.service.serviceaccount
    if ($null -ne $existing) { $xml.service.RemoveChild($existing) | Out-Null }
    # HB-2026-118: `%COMPUTERNAME%` GERCEK -Apply calistirmasinda WinSW
    # tarafindan bir ortam degiskeni olarak GENISLETILMEDI - literal
    # metin olarak alinip hesap aramasi basarisiz oldu (WinSW FATAL:
    # "Failed to find the account", Win32 1332/ERROR_NONE_MAPPED).
    # Windows'un yerel makine icin standart kisaltmasi olan tek nokta
    # (".") - "sc.exe"siz `Set-FileAgentServiceLogonCredential`nin zaten
    # kullandigi ".\hesap" deseniyle AYNI ilke - GERCEKTEN test edilip
    # DUZELTILDI.
    $serviceAccountNode = $xml.CreateElement('serviceaccount')
    $domainNode = $xml.CreateElement('domain'); $domainNode.InnerText = '.'
    $userNode = $xml.CreateElement('user'); $userNode.InnerText = $AccountName
    $allowNode = $xml.CreateElement('allowservicelogon'); $allowNode.InnerText = 'true'
    $serviceAccountNode.AppendChild($domainNode) | Out-Null
    $serviceAccountNode.AppendChild($userNode) | Out-Null
    $serviceAccountNode.AppendChild($allowNode) | Out-Null
    $xml.service.AppendChild($serviceAccountNode) | Out-Null

    # `$xml.OuterXml` bicimlendirmeyi (satir sonu/girinti) TAMAMEN atar -
    # sonraki insan incelemesini/diff'i okunmaz hale getirir. XmlWriter
    # ile girintili, UTF-8 BOM'suz yazilir.
    $settings = New-Object System.Xml.XmlWriterSettings
    $settings.Indent = $true
    $settings.IndentChars = '  '
    $settings.Encoding = [System.Text.UTF8Encoding]::new($false)
    $settings.OmitXmlDeclaration = $true
    $writer = [System.Xml.XmlWriter]::Create($XmlPath, $settings)
    try {
        $xml.Save($writer)
    } finally {
        $writer.Dispose()
    }
}

function Set-FileAgentServiceLogonCredential {
    <# HB-2026-117: `sc.exe` COCUK SURECI KULLANMAZ - dogrudan Win32 SCM
       API'sini (ChangeServiceConfigW) bu surecin ICINDEN cagirir. Parola
       HICBIR ZAMAN: bir komut satiri argumaninda (argv), ortam
       degiskeninde (env), dosyada/XML'de veya log'da GORUNMEZ. Parola
       yalniz `Marshal.SecureStringToGlobalAllocUnicode` ile GECICI,
       unmanaged (yonetilmeyen, .NET GC/heap DISINDA) bir arabellege
       cozulur; ChangeServiceConfigW'a HAM POINTER (IntPtr) olarak gecer
       (yonetilen bir `string` ASLA olusturulmaz - .NET string'leri
       immutable'dir ve GUVENLE sifirlanamaz); API cagrisi biter bitmez
       `Marshal.ZeroFreeGlobalAllocUnicode` ile arabellek ONCE SIFIRLANIR
       SONRA serbest birakilir (bu, .NET'in belgelenen API garantisidir -
       yalniz `FreeHGlobal` DEGIL, ic:erigi de temizler). #>
    param(
        [Parameter(Mandatory = $true)][string]$ServiceName,
        [Parameter(Mandatory = $true)][string]$AccountName,
        [Parameter(Mandatory = $true)][System.Security.SecureString]$Password
    )
    $SC_MANAGER_CONNECT = [uint32]0x0001
    $SERVICE_CHANGE_CONFIG = [uint32]0x0002
    # NOT: `0xFFFFFFFF` PowerShell'de once Int32 (-1) olarak ayrıştırılır;
    # `[uint32]0xFFFFFFFF` bu -1'i ARALIK KONTROLUYLE UInt32'ye cevirmeye
    # calisip BASARISIZ olur ("Deger UInt32 icin cok buyuk/kucuk") -
    # GERCEKTEN denenip BULUNDU (bkz. DECISION_LOG HB-2026-117).
    # `[uint32]::MaxValue` dogru, ACIK bit deseniyle SERVICE_NO_CHANGE'i verir.
    $SERVICE_NO_CHANGE = [uint32]::MaxValue
    # HB-2026-118: GERCEK -Apply calistirmasinda ChangeServiceConfigW,
    # `dwServiceType` icin `SERVICE_NO_CHANGE` (tum bitleri 1) VERILIP
    # AYNI ANDA hesap LocalSystem DISINA degistirilince ERROR_INVALID_
    # PARAMETER (Win32 87) ile basarisiz oldu - MSDN'e gore hesap
    # LocalSystem degilse `dwServiceType` SERVICE_INTERACTIVE_PROCESS
    # BITINI ICEREMEZ; `SERVICE_NO_CHANGE`in tum-bitleri-1 deseni bu
    # biti de "set" gosteriyor OLABILIR. WinSW'nin kurdugu servisler
    # HER ZAMAN SERVICE_WIN32_OWN_PROCESS (etkilesimli DEGIL) oldugu
    # icin bu deger ACIKCA verilir - SERVICE_NO_CHANGE yalniz DstartType/
    # ErrorControl icin kullanilir (bunlar ayni belirsizligi TASIMAZ).
    $SERVICE_WIN32_OWN_PROCESS = [uint32]0x00000010

    # NOT: MSDN'e gore lpDatabaseName=NULL "ServicesActive"e DUSMELIDIR,
    # ancak bu ortamda GERCEKTEN test edilip BULUNDU: NULL gecmek
    # ERROR_INVALID_NAME (123) ile basarisiz oluyor - acikca
    # 'ServicesActive' vermek CALISIYOR. Bkz. DECISION_LOG HB-2026-117.
    $scmHandle = [HasarBotu.Svc]::OpenSCManagerW($null, 'ServicesActive', $SC_MANAGER_CONNECT)
    if ($scmHandle -eq [IntPtr]::Zero) {
        $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
        throw "OpenSCManagerW basarisiz (Win32 hata kodu: $err)."
    }
    try {
        $serviceHandle = [HasarBotu.Svc]::OpenServiceW($scmHandle, $ServiceName, $SERVICE_CHANGE_CONFIG)
        if ($serviceHandle -eq [IntPtr]::Zero) {
            $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
            throw "OpenServiceW basarisiz ($ServiceName; Win32 hata kodu: $err)."
        }
        try {
            $passwordPtr = [System.Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($Password)
            try {
                $accountArg = ".\$AccountName"
                $ok = [HasarBotu.Svc]::ChangeServiceConfigW(
                    $serviceHandle, $SERVICE_WIN32_OWN_PROCESS, $SERVICE_NO_CHANGE, $SERVICE_NO_CHANGE,
                    $null, $null, [IntPtr]::Zero, $null, $accountArg, $passwordPtr, $null)
                if (-not $ok) {
                    $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
                    throw "ChangeServiceConfigW basarisiz ($ServiceName; Win32 hata kodu: $err)."
                }
            } finally {
                # Sifirla SONRA serbest birak - yalniz serbest birakmak
                # (FreeHGlobal) icerigi bellekte/sayfalama dosyasinda
                # birakabilirdi; bu cagri ONCE sifirlar.
                [System.Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($passwordPtr)
            }
        } finally {
            [HasarBotu.Svc]::CloseServiceHandle($serviceHandle) | Out-Null
        }
    } finally {
        [HasarBotu.Svc]::CloseServiceHandle($scmHandle) | Out-Null
    }
}

function New-ServiceAccountPassword {
    <# HB-2026-116: parolayi OPERATOR degil, betik kendisi BIR KEZ,
       kriptografik RNG ile uretir; yalniz SecureString olarak doner.
       Cagiran hicbir zaman duz metnini GORMEZ/KAYDETMEZ. #>
    $bytes = [byte[]]::new(32)
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $plain = [Convert]::ToBase64String($bytes)
    $secure = ConvertTo-SecureString -String $plain -AsPlainText -Force
    Remove-Variable -Name plain -ErrorAction SilentlyContinue
    Remove-Variable -Name bytes -ErrorAction SilentlyContinue
    return $secure
}

function Resolve-NodeExe {
    <# install-services.ps1 ile AYNI desen. #>
    param([string]$Explicit)
    if ($Explicit) { return $Explicit }
    $found = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($null -eq $found) { throw 'node.exe PATH''te bulunamadi. -NodeExe ile mutlak yol verin.' }
    return $found.Source
}

function Invoke-Rollback {
    <# HERHANGI bir atomik adim basarisiz oldugunda cagirilir: yigindaki
       (stack) TUM geri-alma scriptblock'larini TERS SIRAYLA calistirir
       (best-effort - bir geri alma adimi basarisiz olursa DIGERLERI
       yine de denenir, hicbiri digerini engellemez). Ana akistan
       BAGIMSIZ test edilebilmesi icin fonksiyon tanimlari arasina
       (main-flow'un olasi erken `exit`lerinden ONCE) konuldu. #>
    param([System.Collections.Generic.Stack[scriptblock]]$Stack)
    Write-Host ''
    Write-Host '--- HATA: ATOMIK ISLEM GERI ALINIYOR (best-effort) ---' -ForegroundColor Red
    while ($Stack.Count -gt 0) {
        $undo = $Stack.Pop()
        try { & $undo } catch { Write-Host "  GERI ALMA ADIMI BASARISIZ: $($_.Exception.Message)" -ForegroundColor Red }
    }
    Write-Host '--- GERI ALMA TAMAMLANDI ---' -ForegroundColor Red
}

function New-RenderedWinSwConfig {
    <# `install-services.ps1`deki `New-RenderedServiceConfig` ile AYNI
       yer tutucu cozme mantigi, ancak HB-2026-110/114 dersiyle acikca
       UTF-8 okuma/yazma (Get-Content/Set-Content varsayilan kodlamasi
       BOM'suz dosyalarda sistem ANSI kod sayfasina duser). #>
    param(
        [Parameter(Mandatory = $true)][string]$TemplatePath,
        [Parameter(Mandatory = $true)][string]$NodeExePath,
        [Parameter(Mandatory = $true)][string]$AppDirPath,
        [Parameter(Mandatory = $true)][string]$OutputPath
    )
    $xml = [System.IO.File]::ReadAllText($TemplatePath, [System.Text.Encoding]::UTF8)
    $xml = $xml.Replace('__NODE_EXE__', $NodeExePath).Replace('__APP_DIR__', $AppDirPath)
    if ($xml.Contains('__NODE_EXE__') -or $xml.Contains('__APP_DIR__')) {
        throw "Yer tutucu cozumlenemedi: $TemplatePath"
    }
    [xml]$parsed = $xml
    if ($null -eq $parsed) { throw "Render edilen XML gecersiz: $TemplatePath" }
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($OutputPath, $xml, $utf8NoBom)
}

# --- Ana akis: DURUM -> PLAN -> (yalniz -Apply) UYGULA -> DOGRULA ---------

Write-Host '--- HasarBotu V2 File Agent servis hesabi: MEVCUT DURUM ---' -ForegroundColor Cyan

$accountExists = Test-LocalOrWellKnownAccountExists -Account $AccountName
Write-Host "  Hesap ($AccountName) mevcut mu   : $accountExists"

$currentRights = if ($accountExists) { Get-AccountRights -Account $AccountName } else { @() }
foreach ($right in $sensitiveRightsRequired) {
    Write-Host "  Sahip mi: $right   : $($currentRights -contains $right)"
}
foreach ($right in $sensitiveRightsDenied) {
    Write-Host "  Sahip mi: $right   : $($currentRights -contains $right)"
}

# HB-2026-115: depolama koku SVC hesabi + Administrators DISINDA, pCloud'u
# calistiran ETKILESIMLI KULLANICI hesabina da Modify alir - aksi halde
# pCloud senkron klasor moduna gecince kendi yazma erisimini KAYBEDER ve
# senkronizasyon SESSIZCE durur. Uygulama dizini/loglar bu hesaba HICBIR
# yetki VERMEZ (pCloud oraya dokunmaz).
$storageGrants = @(
    (New-AclGrant -Identity $AccountName -Rights ([System.Security.AccessControl.FileSystemRights]::Modify)),
    (New-AclGrant -Identity $PCloudSyncAccount -Rights ([System.Security.AccessControl.FileSystemRights]::Modify)),
    (New-AclGrant -Identity 'BUILTIN\Administrators' -Rights ([System.Security.AccessControl.FileSystemRights]::FullControl))
)
$appDirGrants = @(
    (New-AclGrant -Identity $AccountName -Rights ([System.Security.AccessControl.FileSystemRights]'ReadAndExecute')),
    (New-AclGrant -Identity 'BUILTIN\Administrators' -Rights ([System.Security.AccessControl.FileSystemRights]::FullControl))
)
$logsGrants = @(
    (New-AclGrant -Identity $AccountName -Rights ([System.Security.AccessControl.FileSystemRights]::Modify)),
    (New-AclGrant -Identity 'BUILTIN\Administrators' -Rights ([System.Security.AccessControl.FileSystemRights]::FullControl))
)

$storageAclCheck = Test-LeastPrivilegeAcl -Path $StorageRoot -Grants $storageGrants
Write-Host "  Depolama koku ACL uygun mu ($StorageRoot) : $($storageAclCheck.Pass)"
Write-Host "    (beklenen: $AccountName -> Modify, $PCloudSyncAccount -> Modify, Administrators -> Full)"
foreach ($problem in $storageAclCheck.Problems) { Write-Host "    - $problem" -ForegroundColor DarkYellow }

$appDirAclCheck = Test-LeastPrivilegeAcl -Path $FileAgentAppDir -Grants $appDirGrants
Write-Host "  Uygulama dizini ACL uygun mu ($FileAgentAppDir) : $($appDirAclCheck.Pass)"
foreach ($problem in $appDirAclCheck.Problems) { Write-Host "    - $problem" -ForegroundColor DarkYellow }

$logsDir = Join-Path $FileAgentAppDir 'logs'
$logsAclCheck = Test-LeastPrivilegeAcl -Path $logsDir -Grants $logsGrants
Write-Host "  Log dizini ACL uygun mu ($logsDir) : $($logsAclCheck.Pass)"
foreach ($problem in $logsAclCheck.Problems) { Write-Host "    - $problem" -ForegroundColor DarkYellow }

$winSwCheck = $null
if ($WinSwXmlPath) {
    $winSwCheck = Test-WinSwServiceAccountIdentity -XmlPath $WinSwXmlPath -AccountName $AccountName
    Write-Host "  WinSW kimligi uygun mu ($WinSwXmlPath) : $($winSwCheck.Pass)"
    foreach ($problem in $winSwCheck.Problems) { Write-Host "    - $problem" -ForegroundColor DarkYellow }
} else {
    Write-Host '  WinSW kimligi: -WinSwXmlPath verilmedi, ATLANDI.'
}

$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
Write-Host "  WinSW servisi ($ServiceName) kurulu mu : $($null -ne $existingService)"
if ($existingService) { Write-Host "    StartType=$($existingService.StartType) Status=$($existingService.Status)" }

Write-Host ''
Write-Host '--- PLAN (Apply verilmedikce hicbir sey degismez) ---' -ForegroundColor Yellow

$planSteps = New-Object 'System.Collections.Generic.List[string]'
if (-not $accountExists) { $planSteps.Add("Yerel hesap olusturulacak: $AccountName (betigin KENDI urettigi rastgele parola, 'Users' grubundan cikarilacak)") }
foreach ($right in $sensitiveRightsRequired) {
    if ($currentRights -notcontains $right) { $planSteps.Add("Hak VERILECEK: $right") }
}
foreach ($right in $sensitiveRightsDenied) {
    if ($currentRights -notcontains $right) { $planSteps.Add("Hak VERILECEK (yasak): $right") }
}
if (-not $storageAclCheck.Pass) { $planSteps.Add("ACL yeniden yazilacak: $StorageRoot ($AccountName -> Modify, $PCloudSyncAccount -> Modify, Administrators -> Full)") }
if (-not $appDirAclCheck.Pass) { $planSteps.Add("ACL yeniden yazilacak: $FileAgentAppDir (yalniz $AccountName -> Read+Execute, Administrators -> Full)") }
if (-not $logsAclCheck.Pass) { $planSteps.Add("ACL yeniden yazilacak: $logsDir (yalniz $AccountName -> Modify, Administrators -> Full)") }
if (-not $existingService) {
    $planSteps.Add("WinSW servisi KURULACAK: $ServiceName ($FileAgentAppDir\$ServiceName.xml render edilecek, <serviceaccount> PAROLASIZ eklenecek)")
    $planSteps.Add('SCM servis oturum acma kimlik bilgisi (parola) BIR KEZ uretilip dogrudan ChangeServiceConfigW (Win32 API, cocuk surec YOK) ile AKTARILACAK - hicbir dosyaya/argv/env/log''a yazilmayacak')
    $planSteps.Add('Servis baslangic turu DISABLED olarak ayarlanacak ve BASLATILMAYACAK')
} else {
    $planSteps.Add("UYARI: $ServiceName servisi ZATEN kurulu - bu betik VAR OLAN bir servisi guncellemez/yeniden kurmaz, atomik islem yalniz servis HENUZ yokken desteklenir.")
}

if ($planSteps.Count -eq 0) {
    Write-Host '  Yapilacak hicbir sey yok - mevcut durum zaten hedeflenen duruma uygun.' -ForegroundColor Green
} else {
    foreach ($step in $planSteps) { Write-Host "  - $step" }
}
Write-Host ''

if (-not $Apply) {
    Write-Host '-Apply verilmedi: yalniz durum + plan gosterildi, HICBIR degisiklik yapilmadi.' -ForegroundColor Cyan
    exit 0
}

if ($planSteps.Count -eq 0) {
    Write-Host 'Uygulanacak adim yok, cikiliyor.' -ForegroundColor Green
    exit 0
}

# NOT: `Write-Error` global `$ErrorActionPreference = 'Stop'` altinda
# TERMINATING sayilir ve script'i O ANDA durdurur - sonraki `exit N`
# satirina HIC ULASILMAZ, gercek cikis kodu PowerShell'in kendi genel
# hata kodu (1) olur, istenen N DEGIL (gercekten calistirilarak BULUNDU -
# bkz. DECISION_LOG HB-2026-116). `-ErrorAction Continue` ile bu tek
# cagri icin gecersiz kilinir, boylece `exit N` GERCEKTEN calisir.
if (-not (Test-IsElevated)) {
    Write-Error 'Bu betik -Apply ile yalniz yonetici (Administrator) yukseltmesiyle calisir. Hicbir degisiklik yapilmadi.' -ErrorAction Continue
    exit 2
}

if ($existingService) {
    Write-Error "$ServiceName servisi ZATEN kurulu - atomik kurulum yalniz servis HENUZ yokken desteklenir. Once elle kaldirin (`"$($existingService.Name)`" WinSW exe ile 'uninstall') veya farkli -ServiceName kullanin. Hicbir degisiklik yapilmadi." -ErrorAction Continue
    exit 2
}

if (-not $WinSwExe -or -not (Test-Path -LiteralPath $WinSwExe)) {
    Write-Error "GERCEK servis kurulumu icin -WinSwExe (onceden indirilmis WinSW ikili dosyasi) GEREKIR. Hicbir degisiklik yapilmadi." -ErrorAction Continue
    exit 2
}

try { $resolvedNodeExe = Resolve-NodeExe -Explicit $NodeExe } catch {
    Write-Error "$($_.Exception.Message) Hicbir degisiklik yapilmadi." -ErrorAction Continue
    exit 2
}

if (-not (Test-Path -LiteralPath $WinSwTemplatePath)) {
    Write-Error "WinSW sablonu bulunamadi: $WinSwTemplatePath. Hicbir degisiklik yapilmadi." -ErrorAction Continue
    exit 2
}

if (-not $PSCmdlet.ShouldProcess("$AccountName / $StorageRoot / $FileAgentAppDir / $ServiceName", 'Servis hesabi + LSA haklari + ACL + WinSW kurulumunu ATOMIK olarak uygula')) {
    exit 0
}

# --- ATOMIK UYGULAMA: her basarili adim ters-sirali bir "geri al" -------
$undoStack = New-Object 'System.Collections.Generic.Stack[scriptblock]'
$exeDest = Join-Path $FileAgentAppDir "$ServiceName.exe"
$xmlDest = Join-Path $FileAgentAppDir "$ServiceName.xml"

try {
    Write-Host '--- UYGULANIYOR (atomik) ---' -ForegroundColor Yellow

    # HB-2026-116: parola OPERATORDEN ALINMAZ, burada BIR KEZ uretilir;
    # islem sonuna kadar YALNIZ bu degiskende (SecureString) tutulur.
    $servicePassword = New-ServiceAccountPassword
    Write-Host '  Parola uretildi (SecureString, hicbir yere yazilmayacak).'

    if (-not $accountExists) {
        # HB-2026-118: Windows yerel hesap "Description" alani EN FAZLA 48
        # karakter olabilir - onceki (102 karakter) metin GERCEK -Apply
        # calistirmasinda New-LocalUser dogrulamasiyla BASARISIZ oldu
        # (atomik rollback DOGRU sekilde devreye girdi). Kisaltildi.
        New-LocalUser -Name $AccountName -Password $servicePassword `
            -PasswordNeverExpires -UserMayNotChangePassword `
            -Description 'HasarBotu V2 File Agent servis hesabi (D6)' | Out-Null
        $undoStack.Push({ Remove-LocalUser -Name $AccountName -ErrorAction SilentlyContinue }.GetNewClosure())
        Remove-LocalGroupMember -Group 'Users' -Member $AccountName -ErrorAction SilentlyContinue
        Write-Host "  Hesap olusturuldu: $AccountName" -ForegroundColor Green
    } else {
        # Hesap zaten vardi: SCM'nin kullanacagi parolayla senkron kalmasi
        # icin GERCEK parola burada da (yeniden) ayarlanir - bu hesabin
        # ESKI parolasi zaten bilinmiyordu/bilinmemesi gerekiyordu, bu
        # yuzden GERI ALINACAK bir "eski parola" YOKTUR (kasitli - bkz.
        # DECISION_LOG HB-2026-116).
        Set-LocalUser -Name $AccountName -Password $servicePassword
        Write-Host "  Mevcut hesabin parolasi yenilendi: $AccountName" -ForegroundColor Green
    }

    $rightsToGrant = @()
    foreach ($right in $sensitiveRightsRequired) { if ($currentRights -notcontains $right) { $rightsToGrant += $right } }
    foreach ($right in $sensitiveRightsDenied) { if ($currentRights -notcontains $right) { $rightsToGrant += $right } }
    if ($rightsToGrant.Count -gt 0) {
        Grant-AccountRights -Account $AccountName -Rights $rightsToGrant
        $undoStack.Push({ Remove-AccountRights -Account $AccountName -Rights $rightsToGrant }.GetNewClosure())
        Write-Host "  Haklar verildi: $($rightsToGrant -join ', ')" -ForegroundColor Green
    }

    if (-not $storageAclCheck.Pass) {
        $originalAcl = if (Test-Path -LiteralPath $StorageRoot) { Get-Acl -LiteralPath $StorageRoot } else { $null }
        Set-LeastPrivilegeAcl -Path $StorageRoot -Grants $storageGrants
        $undoStack.Push({ if ($originalAcl) { Set-Acl -LiteralPath $StorageRoot -AclObject $originalAcl } }.GetNewClosure())
        Write-Host "  ACL uygulandi: $StorageRoot" -ForegroundColor Green
    }
    if (-not $appDirAclCheck.Pass) {
        $originalAcl = if (Test-Path -LiteralPath $FileAgentAppDir) { Get-Acl -LiteralPath $FileAgentAppDir } else { $null }
        Set-LeastPrivilegeAcl -Path $FileAgentAppDir -Grants $appDirGrants
        $undoStack.Push({ if ($originalAcl) { Set-Acl -LiteralPath $FileAgentAppDir -AclObject $originalAcl } }.GetNewClosure())
        Write-Host "  ACL uygulandi: $FileAgentAppDir" -ForegroundColor Green
    }
    if (-not $logsAclCheck.Pass) {
        $logsDirPreExisted = Test-Path -LiteralPath $logsDir
        $originalAcl = if ($logsDirPreExisted) { Get-Acl -LiteralPath $logsDir } else { $null }
        if (-not $logsDirPreExisted) {
            New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
            $undoStack.Push({ Remove-Item -LiteralPath $logsDir -Recurse -Force -ErrorAction SilentlyContinue }.GetNewClosure())
        }
        Set-LeastPrivilegeAcl -Path $logsDir -Grants $logsGrants
        if ($logsDirPreExisted) {
            $undoStack.Push({ if ($originalAcl) { Set-Acl -LiteralPath $logsDir -AclObject $originalAcl } }.GetNewClosure())
        }
        Write-Host "  ACL uygulandi: $logsDir" -ForegroundColor Green
    }

    # --- GERCEK WinSW servis kurulumu -------------------------------------
    Copy-Item -LiteralPath $WinSwExe -Destination $exeDest -Force
    $undoStack.Push({ Remove-Item -LiteralPath $exeDest -ErrorAction SilentlyContinue }.GetNewClosure())
    Write-Host "  WinSW ikilisi kopyalandi: $exeDest" -ForegroundColor Green

    New-RenderedWinSwConfig -TemplatePath $WinSwTemplatePath -NodeExePath $resolvedNodeExe -AppDirPath $FileAgentAppDir -OutputPath $xmlDest
    $undoStack.Push({ Remove-Item -LiteralPath $xmlDest -ErrorAction SilentlyContinue }.GetNewClosure())
    Set-WinSwServiceAccountIdentity -XmlPath $xmlDest -AccountName $AccountName
    Write-Host "  WinSW XML render edildi (serviceaccount PAROLASIZ eklendi): $xmlDest" -ForegroundColor Green

    & $exeDest install
    if ($LASTEXITCODE -ne 0) { throw "WinSW 'install' basarisiz oldu (kod $LASTEXITCODE)." }
    $undoStack.Push({ & $exeDest uninstall 2>$null }.GetNewClosure())
    Write-Host "  Servis kuruldu: $ServiceName" -ForegroundColor Green

    # --- SCM oturum acma kimlik bilgisi: parola BURADA, dogrudan Win32 ----
    # API'siyle (ChangeServiceConfigW) aktarilir - cocuk surec/argv/env/
    # dosya/log YOK (HB-2026-117).
    Set-FileAgentServiceLogonCredential -ServiceName $ServiceName -AccountName $AccountName -Password $servicePassword
    Write-Host '  SCM oturum acma kimlik bilgisi ayarlandi (parola hicbir dosyaya yazilmadi).' -ForegroundColor Green

    # --- Guvenlik: servis DISABLED - ASLA otomatik/elle baslatilmaz ------
    Set-Service -Name $ServiceName -StartupType Disabled
    Write-Host "  Servis baslangic turu: Disabled (BASLATILMADI)." -ForegroundColor Green

    Write-Host ''
    Write-Host '--- DOGRULAMA (uygulama sonrasi yeniden okunuyor) ---' -ForegroundColor Yellow

    $finalRights = Get-AccountRights -Account $AccountName
    $finalStorageAcl = Test-LeastPrivilegeAcl -Path $StorageRoot -Grants $storageGrants
    $finalAppDirAcl = Test-LeastPrivilegeAcl -Path $FileAgentAppDir -Grants $appDirGrants
    $finalLogsAcl = Test-LeastPrivilegeAcl -Path $logsDir -Grants $logsGrants
    $finalWinSw = Test-WinSwServiceAccountIdentity -XmlPath $xmlDest -AccountName $AccountName
    $finalService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue

    $allOk = $true
    foreach ($right in $sensitiveRightsRequired) {
        $ok = $finalRights -contains $right
        Write-Host "  $right : $ok"
        if (-not $ok) { $allOk = $false }
    }
    foreach ($right in $sensitiveRightsDenied) {
        $ok = $finalRights -contains $right
        Write-Host "  $right : $ok"
        if (-not $ok) { $allOk = $false }
    }
    Write-Host "  Depolama koku ACL : $($finalStorageAcl.Pass)"
    if (-not $finalStorageAcl.Pass) { $allOk = $false }
    Write-Host "  Uygulama dizini ACL : $($finalAppDirAcl.Pass)"
    if (-not $finalAppDirAcl.Pass) { $allOk = $false }
    Write-Host "  Log dizini ACL : $($finalLogsAcl.Pass)"
    if (-not $finalLogsAcl.Pass) { $allOk = $false }
    Write-Host "  WinSW kimligi : $($finalWinSw.Pass)"
    if (-not $finalWinSw.Pass) { $allOk = $false }
    $serviceOk = ($null -ne $finalService) -and ($finalService.StartType -eq 'Disabled') -and ($finalService.Status -ne 'Running')
    Write-Host "  Servis kurulu+Disabled+calismiyor : $serviceOk (StartType=$($finalService.StartType), Status=$($finalService.Status))"
    if (-not $serviceOk) { $allOk = $false }

    if (-not $allOk) { throw 'Dogrulama basarisiz - bkz. yukaridaki isaretli kontroller.' }

    Write-Host ''
    Write-Host 'SONUC: Tum adimlar ATOMIK olarak basarili. Servis kuruldu, DISABLED, BASLATILMADI.' -ForegroundColor Green
    exit 0
}
catch {
    Write-Host ''
    Write-Host "HATA: $($_.Exception.Message)" -ForegroundColor Red
    Invoke-Rollback -Stack $undoStack
    Write-Error 'Atomik islem BASARISIZ oldu ve geri alindi. Hicbir kalici degisiklik KALMAMIS olmalidir (yukaridaki geri alma sonuclarini kontrol edin).' -ErrorAction Continue
    exit 1
}
finally {
    Remove-Variable -Name servicePassword -ErrorAction SilentlyContinue
}
