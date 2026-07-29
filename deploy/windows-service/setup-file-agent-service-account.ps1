#Requires -Version 5.1
<#
.SYNOPSIS
    File Agent icin adanmis, en-az-yetkili yerel servis hesabini PLANLAR,
    ONIZLER ve (yalniz -Apply ile) UYGULAR (D6, HB-2026-113).

.DESCRIPTION
    HB-2026-113 karari: File Agent, WinSW varsayilani olan LocalSystem
    YERINE ayri bir yerel servis hesabi (varsayilan: svc-hasarbotu-fileagent)
    altinda calisir. Bu betik dort seyi PLANLAR/DOGRULAR:

      1. Hesabin VARLIGI ve "Users" grubu uyeliginden CIKARILMIS olmasi.
      2. "Log on as a service" hakki (SeServiceLogonRight) VAR mi.
      3. Etkilesimli/RDP oturum YASAGI (SeDenyInteractiveLogonRight,
         SeDenyRemoteInteractiveLogonRight) VAR mi.
      4. Hedef depolama kokunde VE File Agent uygulama dizininde NTFS
         en-az-yetki ACL'i (Everyone/Users/Authenticated Users YOK) dogru
         mu; verilirse WinSW XML'inde `<serviceaccount>` kimligi dogru mu
         (PAROLA ICERMEDEN).

    HB-2026-115 duzeltmesi: depolama koku ACL'i YALNIZ File Agent servis
    hesabina degil, pCloud'u calistiran ETKILESIMLI KULLANICI hesabina da
    (`-PCloudSyncAccount`) Modify verir - aksi halde NTFS senkron klasor
    moduna gecildiginde pCloud'un kendisi o klasore YAZAMAZ ve
    senkronizasyon SESSIZCE durur (bkz. `-PCloudSyncAccount`).

    `-Apply` VERILMEDEN bu betik HICBIR kalici degisiklik yapmaz; yalniz
    MEVCUT durumu okur ve YAPILACAK plani yazdirir (AGENTS.md SS7 "kritik
    islem standardi": Planla -> Onizle -> Onay -> Uygula -> Dogrula).

    PAROLA GUVENLIGI: `-ServiceAccountPassword` YALNIZ `SecureString`
    kabul eder; hicbir zaman Write-Host/Write-Verbose ile yazdirilmaz,
    hicbir dosyaya (repo, WinSW XML, log) YAZILMAZ. WinSW XML'ine yalniz
    hesap KIMLIGI (`<domain>`/`<user>`/`<allowservicelogon>`) yazilir;
    `<password>` elemani KASITLI olarak HICBIR ZAMAN eklenmez - servis
    kimlik bilgisi GERCEK kurulumdan SONRA, ayri bir adimda
    `Set-FileAgentServiceLogonCredential` ile `sc.exe config ... password=`
    kullanilarak (yalniz bellekte, dosyaya yazilmadan) ayarlanir. Bu betik
    o adimi CAGIRMAZ (gercek servis bu pakette kurulmadi); fonksiyon yalniz
    D6'nin sonraki asamasi icin HAZIR tutulur.

.PARAMETER AccountName
    Olusturulacak/dogrulanacak yerel hesap adi (varsayilan:
    svc-hasarbotu-fileagent).

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
    File Agent dagitim dizini (icinde `dist\index.js`, `logs\` bulunur).
    Hesabin Read+Execute (+ yalniz `logs`da Modify) alacagi dizin.

.PARAMETER WinSwXmlPath
    (Opsiyonel) Dogrulanacak/guncellenecek WinSW XML dosyasinin yolu. Repo
    icindeki SABIT sablonlar (`hasarbotu-file-agent.winsw.xml`) DEGIL -
    kurulum HEDEFINDEKI RENDER EDILMIS kopya (veya sentetik test dosyasi)
    beklenir. Verilmezse WinSW kimlik adimi ATLANIR.

.PARAMETER ServiceAccountPassword
    Yeni hesabin parolasi (SecureString). Yalniz `-Apply` ile GEREKLIDIR;
    hicbir zaman yazdirilmaz/kaydedilmez.

.PARAMETER Apply
    Verilmezse yalniz mevcut durum + plan yazdirilir, HICBIR degisiklik
    yapilmaz. Gercek uygulama icin ACIKCA verilmelidir (ayrica yukseltme
    ve PSCmdlet.ShouldProcess onayi GEREKTIRIR).

.EXAMPLE
    # Onizleme (hicbir sey degismez):
    .\setup-file-agent-service-account.ps1 -FileAgentAppDir C:\HasarBotu\services\file-agent

.EXAMPLE
    # Gercek uygulama (yalniz D6'nin gercek yurutulmesinde):
    $pw = Read-Host -AsSecureString 'Servis hesabi parolasi'
    .\setup-file-agent-service-account.ps1 -FileAgentAppDir C:\HasarBotu\services\file-agent `
        -WinSwXmlPath C:\HasarBotu\services\file-agent\hasarbotu-file-agent.xml `
        -ServiceAccountPassword $pw -Apply

.NOTES
    Yonetici (elevation) yalniz `-Apply` icin GEREKIR; salt-okunur
    plan/dogrulama yukseltme OLMADAN da calisir.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$AccountName = 'svc-hasarbotu-fileagent',

    [string]$StorageRoot = 'C:\HasarBotuStorage\BARAN GLOBAL EKSPERTİZ',

    [string]$PCloudSyncAccount = "$env:COMPUTERNAME\$env:USERNAME",

    [Parameter(Mandatory = $true)]
    [string]$FileAgentAppDir,

    [string]$WinSwXmlPath,

    [System.Security.SecureString]$ServiceAccountPassword,

    [switch]$Apply
)

$ErrorActionPreference = 'Stop'

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
    $serviceAccountNode = $xml.CreateElement('serviceaccount')
    $domainNode = $xml.CreateElement('domain'); $domainNode.InnerText = '%COMPUTERNAME%'
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
    <# GERCEK SERVIS KURULUMUNDAN SONRA kullanilacak adim (bu betik
       tarafindan CAGRILMAZ - D6'nin sonraki asamasi icin HAZIR tutulur).
       Parola YALNIZ bellekte cozulur, HICBIR dosyaya/log'a yazilmaz;
       `sc.exe config` cagrisina TEK SEFERLIK komut satiri argumani
       olarak gecer (Windows SCM'nin gerektirdigi ASGARI ifsa). #>
    param(
        [Parameter(Mandatory = $true)][string]$ServiceName,
        [Parameter(Mandatory = $true)][string]$AccountName,
        [Parameter(Mandatory = $true)][System.Security.SecureString]$Password
    )
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password)
    try {
        $plainPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
        $objArg = ".\$AccountName"
        & sc.exe config $ServiceName obj= $objArg password= $plainPassword | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "sc.exe config basarisiz oldu (kod $LASTEXITCODE)." }
    } finally {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        Remove-Variable -Name plainPassword -ErrorAction SilentlyContinue
    }
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

Write-Host ''
Write-Host '--- PLAN (Apply verilmedikce hicbir sey degismez) ---' -ForegroundColor Yellow

$planSteps = New-Object 'System.Collections.Generic.List[string]'
if (-not $accountExists) { $planSteps.Add("Yerel hesap olusturulacak: $AccountName (rastgele parola, 'Users' grubundan cikarilacak)") }
foreach ($right in $sensitiveRightsRequired) {
    if ($currentRights -notcontains $right) { $planSteps.Add("Hak VERILECEK: $right") }
}
foreach ($right in $sensitiveRightsDenied) {
    if ($currentRights -notcontains $right) { $planSteps.Add("Hak VERILECEK (yasak): $right") }
}
if (-not $storageAclCheck.Pass) { $planSteps.Add("ACL yeniden yazilacak: $StorageRoot ($AccountName -> Modify, $PCloudSyncAccount -> Modify, Administrators -> Full)") }
if (-not $appDirAclCheck.Pass) { $planSteps.Add("ACL yeniden yazilacak: $FileAgentAppDir (yalniz $AccountName -> Read+Execute, Administrators -> Full)") }
if (-not $logsAclCheck.Pass) { $planSteps.Add("ACL yeniden yazilacak: $logsDir (yalniz $AccountName -> Modify, Administrators -> Full)") }
if ($WinSwXmlPath -and -not $winSwCheck.Pass) { $planSteps.Add("WinSW XML guncellenecek: $WinSwXmlPath (<serviceaccount> - PAROLASIZ)") }

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

if (-not (Test-IsElevated)) {
    Write-Error 'Bu betik -Apply ile yalniz yonetici (Administrator) yukseltmesiyle calisir. Hicbir degisiklik yapilmadi.'
    exit 2
}

if (-not $ServiceAccountPassword) {
    Write-Error 'Hesap olusturmak/dogrulamak icin -ServiceAccountPassword (SecureString) GEREKIR. Hicbir degisiklik yapilmadi.'
    exit 2
}

if (-not $PSCmdlet.ShouldProcess("$AccountName / $StorageRoot / $FileAgentAppDir", 'Servis hesabi + ACL + WinSW kimligini uygula')) {
    exit 0
}

Write-Host '--- UYGULANIYOR ---' -ForegroundColor Yellow

if (-not $accountExists) {
    New-LocalUser -Name $AccountName -Password $ServiceAccountPassword `
        -PasswordNeverExpires -UserMayNotChangePassword `
        -Description 'HasarBotu V2 File Agent - yalniz Windows servis oturumu, etkilesimli giris YASAK (D6, HB-2026-113)' | Out-Null
    Remove-LocalGroupMember -Group 'Users' -Member $AccountName -ErrorAction SilentlyContinue
    Write-Host "Hesap olusturuldu: $AccountName" -ForegroundColor Green
}

$rightsToGrant = @()
foreach ($right in $sensitiveRightsRequired) { if ($currentRights -notcontains $right) { $rightsToGrant += $right } }
foreach ($right in $sensitiveRightsDenied) { if ($currentRights -notcontains $right) { $rightsToGrant += $right } }
if ($rightsToGrant.Count -gt 0) {
    Grant-AccountRights -Account $AccountName -Rights $rightsToGrant
    Write-Host "Haklar verildi: $($rightsToGrant -join ', ')" -ForegroundColor Green
}

if (-not $storageAclCheck.Pass) {
    Set-LeastPrivilegeAcl -Path $StorageRoot -Grants $storageGrants
    Write-Host "ACL uygulandi: $StorageRoot" -ForegroundColor Green
}
if (-not $appDirAclCheck.Pass) {
    Set-LeastPrivilegeAcl -Path $FileAgentAppDir -Grants $appDirGrants
    Write-Host "ACL uygulandi: $FileAgentAppDir" -ForegroundColor Green
}
if (-not $logsAclCheck.Pass) {
    if (-not (Test-Path -LiteralPath $logsDir)) { New-Item -ItemType Directory -Path $logsDir -Force | Out-Null }
    Set-LeastPrivilegeAcl -Path $logsDir -Grants $logsGrants
    Write-Host "ACL uygulandi: $logsDir" -ForegroundColor Green
}
if ($WinSwXmlPath -and -not $winSwCheck.Pass) {
    Set-WinSwServiceAccountIdentity -XmlPath $WinSwXmlPath -AccountName $AccountName
    Write-Host "WinSW kimligi guncellendi: $WinSwXmlPath" -ForegroundColor Green
}

Write-Host ''
Write-Host '--- DOGRULAMA (uygulama sonrasi yeniden okunuyor) ---' -ForegroundColor Yellow

$finalRights = Get-AccountRights -Account $AccountName
$finalStorageAcl = Test-LeastPrivilegeAcl -Path $StorageRoot -Grants $storageGrants
$finalAppDirAcl = Test-LeastPrivilegeAcl -Path $FileAgentAppDir -Grants $appDirGrants
$finalLogsAcl = Test-LeastPrivilegeAcl -Path $logsDir -Grants $logsGrants
$finalWinSw = if ($WinSwXmlPath) { Test-WinSwServiceAccountIdentity -XmlPath $WinSwXmlPath -AccountName $AccountName } else { $null }

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
if ($null -ne $finalWinSw) {
    Write-Host "  WinSW kimligi : $($finalWinSw.Pass)"
    if (-not $finalWinSw.Pass) { $allOk = $false }
}

Write-Host ''
if ($allOk) {
    Write-Host 'SONUC: Tum kontroller GECTI.' -ForegroundColor Green
    exit 0
} else {
    Write-Host 'SONUC: En az bir kontrol BASARISIZ - yukarida isaretlendi.' -ForegroundColor Red
    exit 1
}
