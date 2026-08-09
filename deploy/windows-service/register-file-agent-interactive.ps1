#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$ApiBaseUrl = 'http://127.0.0.1:3100',

    [ValidateLength(1, 120)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9 ._-]*$')]
    [string]$AgentName = 'svc-hb-fileagent',

    [ValidateSet('Machine', 'Process')]
    [string]$EnvScope = 'Machine',

    [System.Management.Automation.PSCredential]$Credential,

    # --- Yalnız otomatik test için: gerçek kullanımda ASLA verilmez. ---
    [switch]$ForcePreflightFailureForTesting,
    [switch]$ForceEnvWriteFailureForTesting
)

# HasarBotu V2 -- D9 Adım 6b: File Agent kaydı (HB-2026-176).
#
# Servis KURMAZ, File Agent'ı BAŞLATMAZ -- yalnız gerçek API'de bir agent
# kaydı oluşturur ve HASARBOTU_AGENT_ID/HASARBOTU_AGENT_SECRET'i belirtilen
# ortam değişkeni kapsamına (varsayılan Machine) yazar.
#
# Orphan-önleme, iki katman:
#   1) Kayıttan ÖNCE: hedef env kapsamında yazma/okuma/silme yetkisi
#      fail-closed kanıtlanır (probe değişkeni) -- başarısızsa kayıt hiç
#      denenmez.
#   2) Kayıttan SONRA env yazımı/doğrulaması başarısız olursa: yazılan
#      env değişkenleri temizlenir VE aynı admin oturumuyla
#      PATCH /api/v1/agents/:agentId {status:'disabled'} çağrılır --
#      services/api/src/agent/auth.ts (agent.status !== 'active' -> 403) ve
#      services/api/test/agent-jobs.test.ts ('devre dışı agent 403 alır')
#      bu yolun gerçekten etkili olduğunu kaynak+test ile doğrular. Disable
#      çağrısı da başarısız olursa kritik blocker + gerçek agent ID
#      raporlanır (secret asla).
#
# Parola yalnız interaktif SecureString (Get-Credential) ile alınır;
# -Credential yalnız otomatik test için (PSCredential nesnesi, düz metin
# argüman DEĞİL). SecureString -> düz metin dönüşümü için ayrılan unmanaged
# bellek finally içinde kesin olarak ZeroFreeGlobalAllocUnicode ile
# serbest bırakılır. Secret hiçbir stdout/log/argv/audit kaydında
# görünmez -- yalnız Machine/Process env'e yazılır.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$SchemaVersion = 'hasarbotu-register-file-agent-interactive/1.0.0'
$ReportDirectory = 'C:\ProgramData\HasarBotu\migration-preflight'
$AuthLoginRoute = '/api/v1/auth/login'
$AgentsRoute = '/api/v1/agents'
$AdministratorSidValue = 'S-1-5-32-544'

function New-AdminOnlyFileSecurity {
    $administratorSid = [System.Security.Principal.SecurityIdentifier]::new($AdministratorSidValue)
    $security = [System.Security.AccessControl.FileSecurity]::new()
    $security.SetAccessRuleProtection($true, $false)
    $security.SetOwner($administratorSid)
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
        $administratorSid, [System.Security.AccessControl.FileSystemRights]::FullControl,
        [System.Security.AccessControl.InheritanceFlags]::None, [System.Security.AccessControl.PropagationFlags]::None,
        [System.Security.AccessControl.AccessControlType]::Allow)
    $security.AddAccessRule($rule)
    return $security
}

function New-AdminOnlyDirectorySecurity {
    $administratorSid = [System.Security.Principal.SecurityIdentifier]::new($AdministratorSidValue)
    $security = [System.Security.AccessControl.DirectorySecurity]::new()
    $security.SetAccessRuleProtection($true, $false)
    $security.SetOwner($administratorSid)
    $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
        $administratorSid, [System.Security.AccessControl.FileSystemRights]::FullControl,
        $inheritance, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
    $security.AddAccessRule($rule)
    return $security
}

function Write-AdminOnlyEvidence {
    param([string]$NamePrefix, [object]$ReportObject)
    if (-not [System.IO.Directory]::Exists($ReportDirectory)) { [System.IO.Directory]::CreateDirectory($ReportDirectory) | Out-Null }
    [System.IO.Directory]::SetAccessControl($ReportDirectory, (New-AdminOnlyDirectorySecurity))
    $timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
    $suffix = [Guid]::NewGuid().ToString('N').Substring(0, 8)
    $fileName = "$NamePrefix-$timestamp-$suffix.json"
    $finalPath = Join-Path $ReportDirectory $fileName
    $json = $ReportObject | ConvertTo-Json -Depth 12
    [System.IO.File]::WriteAllText($finalPath, $json, [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::SetAccessControl($finalPath, (New-AdminOnlyFileSecurity))
    $reportHash = (Get-FileHash -LiteralPath $finalPath -Algorithm SHA256).Hash.ToLowerInvariant()
    return [ordered]@{ FileName = $fileName; Sha256 = $reportHash }
}

function Test-EnvScopeWriteReadDeleteCapability {
    param([string]$Scope, [string]$VarName)
    $probeValue = [Guid]::NewGuid().ToString('N')
    try {
        [Environment]::SetEnvironmentVariable($VarName, $probeValue, $Scope)
        if ([Environment]::GetEnvironmentVariable($VarName, $Scope) -ne $probeValue) { return $false }
        [Environment]::SetEnvironmentVariable($VarName, $null, $Scope)
        if ($null -ne [Environment]::GetEnvironmentVariable($VarName, $Scope)) { return $false }
        return $true
    }
    catch { return $false }
    finally {
        try { [Environment]::SetEnvironmentVariable($VarName, $null, $Scope) } catch {}
    }
}

function Set-VerifiedEnvVar {
    param([string]$Name, [string]$Value, [string]$Scope)
    [Environment]::SetEnvironmentVariable($Name, $Value, $Scope)
    return ([Environment]::GetEnvironmentVariable($Name, $Scope) -eq $Value)
}

function Clear-EnvVar {
    param([string]$Name, [string]$Scope)
    [Environment]::SetEnvironmentVariable($Name, $null, $Scope)
}

function Write-ResultAndExit {
    param([System.Collections.Specialized.OrderedDictionary]$Result, [int]$ExitCode)
    Write-Output ($Result | ConvertTo-Json -Depth 12)
    exit $ExitCode
}

$passwordPtr = [IntPtr]::Zero
$plainPassword = $null
$agentSecretLocal = $null
$agentId = $null
$idWritten = $false
$secretWritten = $false
$session = $null

try {
    # --- 1) Preflight: hedef env kapsamında yazma/okuma/silme -- KAYITTAN ÖNCE, fail-closed ---
    $probeVarName = "HASARBOTU_AGENT_REGISTRATION_PREFLIGHT_PROBE_$([Guid]::NewGuid().ToString('N').Substring(0, 8))"
    $preflightOk = (-not $ForcePreflightFailureForTesting) -and (Test-EnvScopeWriteReadDeleteCapability -Scope $EnvScope -VarName $probeVarName)
    if (-not $preflightOk) {
        Write-ResultAndExit -Result ([ordered]@{
            SchemaVersion = $SchemaVersion
            Status = 'preflight_failed'
            AgentId = $null
            AgentName = $AgentName
            CredentialsConfigured = $false
            EnvScope = $EnvScope
            Blockers = @("'$EnvScope' kapsamında ortam değişkeni yazma/okuma/silme yetkisi kanıtlanamadı -- agent kaydı hiç denenmedi.")
        }) -ExitCode 2
    }

    # --- 2) Kimlik girişi: yalnız interaktif SecureString (Get-Credential) ---
    if (-not $Credential) {
        $Credential = Get-Credential -Message 'HasarBotu admin oturumu (e-posta + parola)'
    }
    if (-not $Credential) {
        Write-ResultAndExit -Result ([ordered]@{
            SchemaVersion = $SchemaVersion
            Status = 'cancelled'
            AgentId = $null
            AgentName = $AgentName
            CredentialsConfigured = $false
            EnvScope = $EnvScope
            Blockers = @('Kimlik girişi iptal edildi -- agent kaydı denenmedi.')
        }) -ExitCode 2
    }

    # --- 3) SecureString -> düz metin (yalnız bellekte, minimum süre) ---
    $passwordPtr = [System.Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($Credential.Password)
    $plainPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringUni($passwordPtr)

    # --- 4) Login (normal WebSession/cookie jar -- manuel Cookie header YOK) ---
    $loginBody = @{ email = $Credential.UserName; password = $plainPassword } | ConvertTo-Json
    Invoke-RestMethod -Uri "$ApiBaseUrl$AuthLoginRoute" -Method Post -Body $loginBody -ContentType 'application/json' -SessionVariable session | Out-Null
    $plainPassword = $null

    # --- 5) Aynı isimde ACTIVE agent var mı -- fail-closed (kayıttan önce) ---
    $existing = Invoke-RestMethod -Uri "$ApiBaseUrl$AgentsRoute" -Method Get -WebSession $session
    $activeMatch = @($existing.items | Where-Object { $_.name -eq $AgentName -and $_.status -eq 'active' })
    if ($activeMatch.Count -gt 0) {
        Write-ResultAndExit -Result ([ordered]@{
            SchemaVersion = $SchemaVersion
            Status = 'active_agent_exists'
            AgentId = $activeMatch[0].id
            AgentName = $AgentName
            CredentialsConfigured = $false
            EnvScope = $EnvScope
            Blockers = @("Aynı isimde ('$AgentName') zaten AKTİF bir agent var (id: $($activeMatch[0].id)) -- yeni kayıt denenmedi.")
        }) -ExitCode 2
    }

    # --- 6) Agent kaydı ---
    $registerBody = @{ name = $AgentName } | ConvertTo-Json
    $registerResp = Invoke-RestMethod -Uri "$ApiBaseUrl$AgentsRoute" -Method Post -Body $registerBody -ContentType 'application/json' -WebSession $session
    $agentId = $registerResp.agent.id
    $agentSecretLocal = $registerResp.secret

    # --- 7) Machine/Process env yazımı + BAĞIMSIZ okuma-geri-doğrulama ---
    $envOk = $true
    $envError = $null
    try {
        if (-not (Set-VerifiedEnvVar -Name 'HASARBOTU_AGENT_ID' -Value $agentId -Scope $EnvScope)) { throw 'HASARBOTU_AGENT_ID readback uyuşmuyor.' }
        $idWritten = $true
        # Sentetik hata enjeksiyonu ID başarıyla yazıldıktan SONRA tetiklenir --
        # gerçek dünyadaki en olası senaryoyu (kısmi yazım) sentetik olarak yeniden üretir.
        if ($ForceEnvWriteFailureForTesting) { throw 'ForceEnvWriteFailureForTesting aktif (sentetik test) -- gerçek kullanımda asla oluşmaz.' }
        if (-not (Set-VerifiedEnvVar -Name 'HASARBOTU_AGENT_SECRET' -Value $agentSecretLocal -Scope $EnvScope)) { throw 'HASARBOTU_AGENT_SECRET readback uyuşmuyor.' }
        $secretWritten = $true
    }
    catch {
        $envOk = $false
        $envError = $_.Exception.Message
    }

    if ($envOk) {
        $evidence = Write-AdminOnlyEvidence -NamePrefix 'agent-registration' -ReportObject ([ordered]@{
            SchemaVersion = $SchemaVersion
            TimestampUtc = [DateTime]::UtcNow.ToString('o')
            AgentId = $agentId
            AgentName = $AgentName
            EnvScope = $EnvScope
            ApiBaseUrl = $ApiBaseUrl
            Outcome = 'registered'
        })
        Write-ResultAndExit -Result ([ordered]@{
            SchemaVersion = $SchemaVersion
            Status = 'registered'
            AgentId = $agentId
            AgentName = $AgentName
            CredentialsConfigured = $true
            EnvScope = $EnvScope
            Evidence = $evidence
            Blockers = @()
        }) -ExitCode 0
    }

    # --- 8) env başarısız -- orphan-önleme: temizle + PATCH disable ---
    if ($idWritten) { Clear-EnvVar -Name 'HASARBOTU_AGENT_ID' -Scope $EnvScope }
    if ($secretWritten) { Clear-EnvVar -Name 'HASARBOTU_AGENT_SECRET' -Scope $EnvScope }

    $disableUrl = "$ApiBaseUrl$AgentsRoute/$agentId"
    $disableBody = @{ status = 'disabled' } | ConvertTo-Json
    $disableOk = $false
    $disableError = $null
    try {
        $disableResp = Invoke-RestMethod -Uri $disableUrl -Method Patch -Body $disableBody -ContentType 'application/json' -WebSession $session
        $disableOk = ($disableResp.agent.status -eq 'disabled')
        if (-not $disableOk) { $disableError = "Beklenmeyen durum: $($disableResp.agent.status)" }
    }
    catch {
        $disableError = $_.Exception.Message
    }

    if ($disableOk) {
        $evidence = Write-AdminOnlyEvidence -NamePrefix 'agent-registration-rolled-back' -ReportObject ([ordered]@{
            SchemaVersion = $SchemaVersion
            TimestampUtc = [DateTime]::UtcNow.ToString('o')
            AgentId = $agentId
            AgentName = $AgentName
            EnvScope = $EnvScope
            ApiBaseUrl = $ApiBaseUrl
            Outcome = 'rolled_back'
            EnvError = $envError
        })
        Write-ResultAndExit -Result ([ordered]@{
            SchemaVersion = $SchemaVersion
            Status = 'rolled_back'
            AgentId = $agentId
            AgentName = $AgentName
            CredentialsConfigured = $false
            EnvScope = $EnvScope
            Evidence = $evidence
            Blockers = @("Ortam değişkeni yazımı başarısız oldu ($envError); agent ($agentId) güvenli şekilde devre dışı bırakıldı.")
        }) -ExitCode 3
    }

    # --- 9) KRİTİK: hem env yazımı hem disable başarısız ---
    $evidence = Write-AdminOnlyEvidence -NamePrefix 'agent-registration-critical' -ReportObject ([ordered]@{
        SchemaVersion = $SchemaVersion
        TimestampUtc = [DateTime]::UtcNow.ToString('o')
        AgentId = $agentId
        AgentName = $AgentName
        EnvScope = $EnvScope
        ApiBaseUrl = $ApiBaseUrl
        Outcome = 'critical_unrecoverable'
        EnvError = $envError
        DisableError = $disableError
    })
    Write-ResultAndExit -Result ([ordered]@{
        SchemaVersion = $SchemaVersion
        Status = 'critical_unrecoverable'
        AgentId = $agentId
        AgentName = $AgentName
        CredentialsConfigured = $false
        EnvScope = $EnvScope
        Evidence = $evidence
        Blockers = @(
            "KRİTİK: agent ($agentId) oluşturuldu, ENV yazımı başarısız oldu ($envError) VE devre dışı bırakma çağrısı da başarısız oldu ($disableError).",
            "MANUEL MÜDAHALE GEREKLİ: yönetim ucundan veya DB'den agent id = $agentId için status='disabled' yapın.",
            "Bu agent adı ('$AgentName') devre dışı bırakılana kadar yeniden kullanılamaz (aktif-isim fail-closed kontrolü engeller)."
        )
    }) -ExitCode 4
}
catch {
    Write-Output ([ordered]@{
        SchemaVersion = $SchemaVersion
        Status = 'error'
        AgentId = $agentId
        AgentName = $AgentName
        CredentialsConfigured = $false
        EnvScope = $EnvScope
        Blockers = @("Beklenmeyen hata: $($_.Exception.Message)")
    } | ConvertTo-Json -Depth 12)
    exit 1
}
finally {
    if ($passwordPtr -ne [IntPtr]::Zero) {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($passwordPtr)
    }
    $plainPassword = $null
    $agentSecretLocal = $null
    Remove-Variable -Name plainPassword, agentSecretLocal -ErrorAction SilentlyContinue
}
