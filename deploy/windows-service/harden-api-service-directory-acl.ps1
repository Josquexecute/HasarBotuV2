#Requires -Version 5.1
<#
.SYNOPSIS
    C:\HasarBotu\services\api (gercek kurulu API dagitim dizini) icin
    File Agent'in HB-2026-113..116'da ZATEN aldigi en-az-yetki ACL
    disiplinini uygular -- PLANLAR, ONIZLER ve (yalniz -Apply ile) UYGULAR.

.DESCRIPTION
    Final production readiness denetiminde (2026-08-09) bulunan gercek
    bulgu: `hasarbotu-api` LocalSystem altinda calisir ve kendi dagitim
    dizini HICBIR ozel ACL almadi -- yalniz miras alinan Windows
    varsayilanlari (`NT AUTHORITY\Authenticated Users: Modify` DAHIL).
    `svc-hb-fileagent` (daha dusuk guvenli, is-isleyen bir hesap) da bu
    grubun uyesi oldugu icin, File Agent servis hesabi ayni makinede
    API'nin dagitilmis kodunu DEGISTIREBILIR -- File Agent bir gun ele
    gecirilirse API'nin (LocalSystem = tam SYSTEM yetkisi) calistiracagi
    kodu degistirebilecegi anlamina gelir. File Agent'in KENDI dizini
    zaten aynen bu sekilde sertlestirilmisti; API hic almamisti.

    Bu betik AYNI iki katmanli deseni uygular (root=ReadAndExecute,
    logs\=Modify) ama HEDEF KIMLIGI degistirmez -- API bugun LocalSystem
    altinda calistigi icin hedef `NT AUTHORITY\SYSTEM`dir (servis
    HESABININ KENDISI degismez, yalniz KENDI dizinine erisimi daraltilir).
    LocalSystem'i adanmis dusuk-yetkili bir hesaba tasimak (File Agent'in
    HB-2026-113..120'de gectigi, WinSW <serviceaccount>/sc.exe config
    parola sorunlari dahil, coklu-paketlik surec) BU BETIGIN KAPSAMI
    DISINDADIR -- ayri, daha buyuk bir mimari karar.

    `-Apply` VERILMEDEN bu betik HICBIR kalici degisiklik yapmaz; yalniz
    MEVCUT durumu okur ve YAPILACAK plani yazdirir (AGENTS.md SS7).

    Apply ONCESI: hedef dizinin (ve logs alt-dizininin) TAM SDDL'si
    Administrators-only+hash'li bir kanit raporuna yazilir -- `-Rollback
    -RollbackBackupPath <rapor>` bu TAM SDDL'yi birebir geri yukler.
    Apply, servisi DURDURMAZ/BASLATMAZ/YENIDEN BASLATMAZ -- yalniz NTFS
    ACL degisir; calisan surecin zaten acik dosya tanitiglari (handle)
    etkilenmez, SADECE GELECEKTEKI erisim denemeleri yeni ACL'ye tabidir.
    Apply SONRASI: hedef kimligin (varsayilan SYSTEM) hem root'ta
    ReadAndExecute HEM logs'ta Modify sahibi oldugu, Administrators'in
    FullControl sahibi oldugu VE eski genis miras (Authenticated
    Users/Users) artik ETKIN OLMADIGI bagimsizca yeniden okunarak
    dogrulanir -- herhangi biri eksikse Apply KENDINI otomatik geri alir
    (fail-closed, yarim sertlestirilmis bir durumda birakilmaz).
#>
[CmdletBinding(DefaultParameterSetName = 'Apply')]
param(
    [Parameter(ParameterSetName = 'Apply')]
    [Parameter(ParameterSetName = 'DryRun')]
    [string]$ApiDir = 'C:\HasarBotu\services\api',

    [Parameter(ParameterSetName = 'Apply')]
    [Parameter(ParameterSetName = 'DryRun')]
    [string]$ServiceIdentity = 'NT AUTHORITY\SYSTEM',

    [Parameter(ParameterSetName = 'Apply')]
    [switch]$Apply,

    [Parameter(ParameterSetName = 'Rollback', Mandatory)]
    [switch]$Rollback,

    [Parameter(ParameterSetName = 'Rollback', Mandatory)]
    [string]$RollbackBackupPath
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
$ReportDirectory = 'C:\ProgramData\HasarBotu\migration-preflight'

function Throw-SafeAclError {
    param([string]$Code)
    $exception = [System.InvalidOperationException]::new($Code)
    $exception.Data['SafeCode'] = $Code
    throw $exception
}

function New-AdminOnlySecurity {
    param([string]$Path)
    $sid = [System.Security.Principal.SecurityIdentifier]::new($AdministratorSidValue)
    $security = [System.Security.AccessControl.FileSecurity]::new()
    $security.SetAccessRuleProtection($true, $false)
    $security.SetOwner($sid)
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
        $sid, [System.Security.AccessControl.FileSystemRights]::FullControl,
        [System.Security.AccessControl.InheritanceFlags]::None,
        [System.Security.AccessControl.PropagationFlags]::None,
        [System.Security.AccessControl.AccessControlType]::Allow)
    $security.AddAccessRule($rule)
    [System.IO.File]::SetAccessControl($Path, $security)
}

function Write-AdminOnlyEvidence {
    param([string]$NamePrefix, [object]$ReportObject)
    New-Item -ItemType Directory -Path $ReportDirectory -Force | Out-Null
    $timestamp = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHHmmss.fffZ')
    $fileName = "$NamePrefix-$timestamp.json"
    $path = Join-Path $ReportDirectory $fileName
    $json = $ReportObject | ConvertTo-Json -Depth 8
    [System.IO.File]::WriteAllText($path, $json, [System.Text.UTF8Encoding]::new($false))
    New-AdminOnlySecurity -Path $path
    $sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    return [ordered]@{ Path = $path; FileName = $fileName; Sha256 = $sha256 }
}

function Read-HashVerifiedJson {
    param([string]$Path, [string]$ExpectedSha256)
    if (-not (Test-Path -LiteralPath $Path)) { Throw-SafeAclError 'ROLLBACK_EVIDENCE_NOT_FOUND' }
    $actualSha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualSha256 -ne $ExpectedSha256.ToLowerInvariant()) { Throw-SafeAclError 'ROLLBACK_EVIDENCE_HASH_MISMATCH' }
    return (Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json)
}

function Get-DirectorySddl {
    param([string]$Path)
    return (Get-Acl -LiteralPath $Path).Sddl
}

function Set-DirectorySddl {
    param([string]$Path, [string]$Sddl)
    $acl = Get-Acl -LiteralPath $Path
    $acl.SetSecurityDescriptorSddlForm($Sddl)
    Set-Acl -LiteralPath $Path -AclObject $acl
}

# Root: Administrators FullControl + hedef kimlik ReadAndExecute --
# ContainerInherit+ObjectInherit ile dist/, node_modules/, package.json
# vb. TUMUNE otomatik yayilir (File Agent'ta ayni desen, tek ACE).
function Set-HardenedRootAcl {
    param([string]$Path, [string]$Identity)
    $acl = [System.Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $adminRule = [System.Security.AccessControl.FileSystemAccessRule]::new(
        'BUILTIN\Administrators', [System.Security.AccessControl.FileSystemRights]::FullControl,
        ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit),
        [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
    $identityRule = [System.Security.AccessControl.FileSystemAccessRule]::new(
        $Identity, [System.Security.AccessControl.FileSystemRights]::ReadAndExecute,
        ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit),
        [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
    $acl.AddAccessRule($adminRule)
    $acl.AddAccessRule($identityRule)
    [System.IO.Directory]::SetAccessControl($Path, $acl)
}

# logs\: Administrators FullControl + hedef kimlik Modify (Pino/WinSW
# stdout/stderr log dosyalarini yazabilmesi icin -- File Agent'ta ayni).
function Set-HardenedLogsAcl {
    param([string]$Path, [string]$Identity)
    $acl = [System.Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $adminRule = [System.Security.AccessControl.FileSystemAccessRule]::new(
        'BUILTIN\Administrators', [System.Security.AccessControl.FileSystemRights]::FullControl,
        ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit),
        [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
    $identityRule = [System.Security.AccessControl.FileSystemAccessRule]::new(
        $Identity, [System.Security.AccessControl.FileSystemRights]::Modify,
        ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit),
        [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
    $acl.AddAccessRule($adminRule)
    $acl.AddAccessRule($identityRule)
    [System.IO.Directory]::SetAccessControl($Path, $acl)
}

function Get-EffectiveGrant {
    param([string]$Path, [string]$Identity, [System.Security.AccessControl.FileSystemRights]$Rights)
    $acl = Get-Acl -LiteralPath $Path
    $sid = ([System.Security.Principal.NTAccount]::new($Identity)).Translate([System.Security.Principal.SecurityIdentifier])
    $allow = 0
    $deny = 0
    foreach ($rule in $acl.Access) {
        $ruleSid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier])
        if ($ruleSid -ne $sid) { continue }
        if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Deny) { $deny = $deny -bor $rule.FileSystemRights }
        else { $allow = $allow -bor $rule.FileSystemRights }
    }
    $effective = $allow -band (-bnot $deny)
    return (([int]$effective -band [int]$Rights) -eq [int]$Rights)
}

function Get-BroadIdentityStillGranted {
    param([string]$Path)
    $acl = Get-Acl -LiteralPath $Path
    $broad = @('NT AUTHORITY\Authenticated Users', 'BUILTIN\Users', 'Everyone')
    $found = @()
    foreach ($rule in $acl.Access) {
        if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { continue }
        $name = $rule.IdentityReference.Value
        if ($broad -contains $name) { $found += $name }
    }
    return $found
}

try {
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [System.Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Throw-SafeAclError 'ADMINISTRATOR_REQUIRED'
    }

    if ($Rollback) {
        $evidence = Read-HashVerifiedJson -Path $RollbackBackupPath -ExpectedSha256 (Get-FileHash -LiteralPath $RollbackBackupPath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($evidence.SchemaVersion -ne 'hasarbotu-api-directory-acl-hardening/1.0.0') { Throw-SafeAclError 'ROLLBACK_EVIDENCE_SCHEMA_INVALID' }
        if (-not (Test-Path -LiteralPath $evidence.ApiDir)) { Throw-SafeAclError 'API_DIR_NOT_FOUND' }
        Set-DirectorySddl -Path $evidence.ApiDir -Sddl $evidence.Before.RootSddl
        $logsPath = Join-Path $evidence.ApiDir 'logs'
        if (Test-Path -LiteralPath $logsPath) { Set-DirectorySddl -Path $logsPath -Sddl $evidence.Before.LogsSddl }
        $afterRootSddl = Get-DirectorySddl -Path $evidence.ApiDir
        $restoredExactly = $afterRootSddl -eq $evidence.Before.RootSddl
        $rollbackReport = [ordered]@{
            SchemaVersion = 'hasarbotu-api-directory-acl-hardening-rollback/1.0.0'
            GeneratedAtUtc = [DateTime]::UtcNow.ToString('o')
            ApiDir = $evidence.ApiDir
            RestoredExactly = $restoredExactly
        }
        $ref = Write-AdminOnlyEvidence -NamePrefix 'harden-api-directory-acl-rollback' -ReportObject $rollbackReport
        Write-Output ([ordered]@{ Mode = 'rollback'; RestoredExactly = $restoredExactly; Report = $ref } | ConvertTo-Json -Depth 6)
        exit $(if ($restoredExactly) { 0 } else { 1 })
    }

    # --- Apply / DryRun shared path ---
    if (-not (Test-Path -LiteralPath $ApiDir)) { Throw-SafeAclError 'API_DIR_NOT_FOUND' }
    $logsDir = Join-Path $ApiDir 'logs'
    $logsExists = Test-Path -LiteralPath $logsDir

    $beforeRootSddl = Get-DirectorySddl -Path $ApiDir
    $beforeLogsSddl = if ($logsExists) { Get-DirectorySddl -Path $logsDir } else { $null }
    $broadBefore = Get-BroadIdentityStillGranted -Path $ApiDir

    if (-not $Apply) {
        Write-Output ([ordered]@{
            Mode = 'dry-run'
            ApiDir = $ApiDir
            ServiceIdentity = $ServiceIdentity
            LogsDirExists = $logsExists
            BroadIdentitiesCurrentlyGranted = $broadBefore
            PlannedRootAces = @(
                'BUILTIN\Administrators: FullControl (ContainerInherit, ObjectInherit)'
                "$ServiceIdentity`: ReadAndExecute (ContainerInherit, ObjectInherit)"
            )
            PlannedLogsAces = @(
                'BUILTIN\Administrators: FullControl (ContainerInherit, ObjectInherit)'
                "$ServiceIdentity`: Modify (ContainerInherit, ObjectInherit)"
            )
            Note = 'Zero mutation. Nothing was applied (no -Apply switch given). Service is NOT stopped/started by this tool in any mode.'
        } | ConvertTo-Json -Depth 6)
        exit 0
    }

    # === -Apply from here on ===
    $snapshot = [ordered]@{
        SchemaVersion = 'hasarbotu-api-directory-acl-hardening/1.0.0'
        GeneratedAtUtc = [DateTime]::UtcNow.ToString('o')
        ApiDir = $ApiDir
        ServiceIdentity = $ServiceIdentity
        Before = [ordered]@{
            RootSddl = $beforeRootSddl
            LogsSddl = $beforeLogsSddl
            BroadIdentitiesGranted = $broadBefore
        }
    }
    $snapshotRef = Write-AdminOnlyEvidence -NamePrefix 'harden-api-directory-acl-snapshot' -ReportObject $snapshot

    $rolledBack = $false
    $verificationErrors = New-Object 'System.Collections.Generic.List[string]'
    try {
        Set-HardenedRootAcl -Path $ApiDir -Identity $ServiceIdentity
        if ($logsExists) { Set-HardenedLogsAcl -Path $logsDir -Identity $ServiceIdentity }

        if (-not (Get-EffectiveGrant -Path $ApiDir -Identity 'BUILTIN\Administrators' -Rights ([System.Security.AccessControl.FileSystemRights]::FullControl))) {
            $verificationErrors.Add('ADMINISTRATORS_NOT_FULLCONTROL_ON_ROOT')
        }
        if (-not (Get-EffectiveGrant -Path $ApiDir -Identity $ServiceIdentity -Rights ([System.Security.AccessControl.FileSystemRights]::ReadAndExecute))) {
            $verificationErrors.Add('SERVICE_IDENTITY_MISSING_READ_ON_ROOT')
        }
        if ($logsExists -and -not (Get-EffectiveGrant -Path $logsDir -Identity $ServiceIdentity -Rights ([System.Security.AccessControl.FileSystemRights]::Modify))) {
            $verificationErrors.Add('SERVICE_IDENTITY_MISSING_MODIFY_ON_LOGS')
        }
        $broadAfter = Get-BroadIdentityStillGranted -Path $ApiDir
        if (@($broadAfter).Count -gt 0) {
            $verificationErrors.Add("BROAD_IDENTITY_STILL_GRANTED:$($broadAfter -join ',')")
        }

        if ($verificationErrors.Count -gt 0) {
            # Fail-closed: kendi kendine ANINDA geri al -- yarim
            # sertlestirilmis bir durumda ASLA birakilmaz.
            Set-DirectorySddl -Path $ApiDir -Sddl $beforeRootSddl
            if ($logsExists) { Set-DirectorySddl -Path $logsDir -Sddl $beforeLogsSddl }
            $rolledBack = $true
            Throw-SafeAclError "VERIFICATION_FAILED_AUTO_ROLLED_BACK:$($verificationErrors -join ';')"
        }
    } catch {
        if (-not $rolledBack) {
            Set-DirectorySddl -Path $ApiDir -Sddl $beforeRootSddl
            if ($logsExists) { Set-DirectorySddl -Path $logsDir -Sddl $beforeLogsSddl }
        }
        throw
    }

    $afterRootSddl = Get-DirectorySddl -Path $ApiDir
    $afterLogsSddl = if ($logsExists) { Get-DirectorySddl -Path $logsDir } else { $null }
    $applyReport = [ordered]@{
        Mode = 'apply'
        Status = 'applied'
        ApiDir = $ApiDir
        ServiceIdentity = $ServiceIdentity
        AdministratorsFullControlOnRoot = $true
        ServiceIdentityReadAndExecuteOnRoot = $true
        ServiceIdentityModifyOnLogs = $logsExists
        BroadIdentitiesRemaining = @(Get-BroadIdentityStillGranted -Path $ApiDir)
        RootSddlChanged = ($afterRootSddl -ne $beforeRootSddl)
        LogsSddlChanged = ($logsExists -and $afterLogsSddl -ne $beforeLogsSddl)
        SnapshotReport = $snapshotRef
    }
    Write-Output ($applyReport | ConvertTo-Json -Depth 6)
    exit 0
} catch {
    $code = if ($_.Exception.Data.Contains('SafeCode')) { $_.Exception.Data['SafeCode'] } else { 'ACL_HARDENING_RUNTIME_ERROR' }
    Write-Output ([ordered]@{ Status = 'error'; ErrorCode = $code } | ConvertTo-Json -Depth 4)
    exit 1
}
