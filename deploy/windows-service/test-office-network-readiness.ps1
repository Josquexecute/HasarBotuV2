#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$ApiOrigin,
    [string]$Directory = 'C:\ProgramData\HasarBotu\office-network',
    [string]$NodeExe = (Get-Command node.exe -ErrorAction Stop).Source,
    [ValidateSet('Before','After')][string]$Stage = 'After',
    [string]$Installer,
    [string]$ExpectedSha256,
    [string]$ExpectedSignerThumbprint,
    [string]$ExpectedVersion = '0.1.91'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$checks = [Collections.Generic.List[object]]::new()
function Test-ReadinessCheck([string]$Name, [scriptblock]$Check) {
    try { & $Check; $checks.Add(@{name=$Name;status='PASS'}) }
    catch { $checks.Add(@{name=$Name;status='FAIL';code=$_.Exception.Message}) }
}
Test-ReadinessCheck 'node24' { if ((& $NodeExe --version) -notmatch '^v24\.') { throw 'NODE_24_REQUIRED' } }
Test-ReadinessCheck 'api3100' {
    $health = Invoke-RestMethod 'http://127.0.0.1:3100/health' -TimeoutSec 5
    if ($health.service -ne 'hasarbotu-api' -or $health.status -ne 'ok') { throw 'API_OR_DATABASE_NOT_READY' }
}
Test-ReadinessCheck 'field3200' {
    $health = Invoke-RestMethod 'http://127.0.0.1:3200/field-health' -Headers @{Host=([Uri]$ApiOrigin).Host} -TimeoutSec 5
    if ($health.status -ne 'ok') { throw 'FIELD_PORTAL_NOT_READY' }
}
$inventory = @()
foreach ($name in @('postgresql-x64-17','hasarbotu-api','hasarbotu-lan-https','hasarbotu-field-portal','hasarbotu-file-agent','hasarbotu-folder-discovery','hasarbotu-office-gateway','hasarbotu-network-discovery')) {
    $service = Get-CimInstance Win32_Service -Filter ("Name='" + $name + "'")
    $inventory += @{name=$name;present=[bool]$service;state=$(if($service){$service.State}else{'Missing'});startMode=$(if($service){$service.StartMode}else{'Missing'})}
}
if ($Stage -eq 'After') {
    Test-ReadinessCheck 'nativeGoogle' {
        $google = Invoke-RestMethod 'http://127.0.0.1:3100/api/v1/google/status' -TimeoutSec 5
        if (-not $google.enabled -or -not $google.desktopEnabled) { throw 'GOOGLE_DESKTOP_CLIENT_NOT_CONFIGURED' }
        if (-not $google.proxyAwareRateLimit) { throw 'TRUST_LOOPBACK_PROXY_REQUIRED' }
    }
    Test-ReadinessCheck 'profile' {
        $profile = [IO.File]::ReadAllText((Join-Path $Directory 'client-profile.json')) | ConvertFrom-Json
        if ($profile.schemaVersion -ne 2 -or $profile.apiOrigin -ne $ApiOrigin -or ([Uri]$ApiOrigin).Host -match '(\.test|\.example|\.invalid)$') { throw 'PRODUCTION_V2_PROFILE_REQUIRED' }
    }
    Test-ReadinessCheck 'tlsAndApi' {
        & $NodeExe (Join-Path $Directory 'office-network.mjs') wait (Join-Path $Directory 'client-profile.json') | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'TLS_OR_GATEWAY_NOT_READY' }
    }
    Test-ReadinessCheck 'automaticServices' {
        foreach ($name in @('hasarbotu-api','hasarbotu-office-gateway','hasarbotu-network-discovery')) {
            $item = $inventory | Where-Object name -eq $name
            if ($item.state -ne 'Running' -or $item.startMode -ne 'Auto') { throw "SERVICE_NOT_AUTOMATIC_OR_RUNNING:$name" }
            if (@((Get-Service -Name $name).ServicesDependedOn | Where-Object Name -eq 'Tailscale').Count) { throw "TAILSCALE_DEPENDENCY:$name" }
        }
    }
    Test-ReadinessCheck 'boundedServiceRecovery' {
        if (-not ('OfficeServiceRecovery' -as [type])) { Add-Type -Path (Join-Path $Directory 'office-service-recovery.cs') }
        foreach ($item in @($inventory | Where-Object present)) {
            $policy = [OfficeServiceRecovery]::Read($item.name)
            if ($policy.ResetSeconds -ne 3600 -or $policy.Actions.Count -ne 4) { throw "RECOVERY_POLICY_UNBOUNDED:$($item.name)" }
            for ($index=0; $index -lt 4; $index++) {
                if ($policy.Actions[$index].Type -ne @(1,1,1,0)[$index] -or $policy.Actions[$index].Delay -ne @(10000,30000,60000,0)[$index]) { throw "RECOVERY_POLICY_UNBOUNDED:$($item.name)" }
            }
        }
    }
}
if ($Installer) {
    Test-ReadinessCheck 'installerIntegrity' {
        if ($ExpectedSha256 -notmatch '^[a-fA-F0-9]{64}$' -or (Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash -ine $ExpectedSha256) { throw 'INSTALLER_HASH_MISMATCH' }
        if ((Get-Item -LiteralPath $Installer).VersionInfo.ProductVersion -notin @($ExpectedVersion,($ExpectedVersion + '.0'))) { throw 'INSTALLER_VERSION_MISMATCH' }
    }
    Test-ReadinessCheck 'installerSignature' {
        $signature = Get-AuthenticodeSignature -LiteralPath $Installer
        if ($ExpectedSignerThumbprint -notmatch '^[a-fA-F0-9]{40}$' -or $signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate -or
            $signature.SignerCertificate.Thumbprint -ine $ExpectedSignerThumbprint -or $null -eq $signature.TimeStamperCertificate) { throw 'TRUSTED_TIMESTAMPED_PUBLISHER_SIGNATURE_REQUIRED' }
    }
}
$failed = @($checks | Where-Object status -eq 'FAIL')
[ordered]@{status=$(if($failed.Count){'BLOCKED'}else{'PASS'});stage=$Stage;checks=@($checks);services=$inventory;productionMutated=$false;artifactVerification=$(if($Installer){'REQUESTED'}else{'NOT_REQUESTED'});realGoogleConsent='PENDING';officeClientAcceptance='PENDING'} | ConvertTo-Json -Depth 6
if ($failed.Count) { exit 1 }
