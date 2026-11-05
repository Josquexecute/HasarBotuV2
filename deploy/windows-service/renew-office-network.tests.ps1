#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('hb-renew-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'renew-office-network.ps1') -Destination $fixtureRoot
$script:checks = 0
function Assert-True([bool]$Value, [string]$Message) { if (-not $Value) { throw $Message }; $script:checks++ }
function Invoke-FixtureNode {
    param($ScriptFile, $ConfigFile, $Mode)
    $global:LASTEXITCODE = 0
    if ($ScriptFile -like '*provision-office-network.mjs') {
        [IO.File]::WriteAllText((Join-Path $fixtureRoot 'Caddyfile'), 'new-certificate-pair')
        [IO.File]::WriteAllText((Join-Path $fixtureRoot 'certificate-current.json'), '{"certificateBase":"new"}')
        '{"status":"PROVISIONED","certificateChanged":true}'
    }
    else { $global:hbRenewTestEvents.Add('verified'); if ($global:hbRenewTestHealthFails) { $global:LASTEXITCODE = 1 } }
}
function Invoke-FixtureCaddy { $global:LASTEXITCODE = $(if($global:hbRenewCaddyFails){1}else{0}) }
function Get-Service {
    param($Name, $ErrorAction)
    if ($Name -eq 'hasarbotu-office-gateway') { return [pscustomobject]@{Status=$global:hbRenewTestGatewayStatus} }
    return [pscustomobject]@{Status=$global:hbRenewTestDiscoveryStatus}
}
function Stop-Service { param($Name, $ErrorAction) $global:hbRenewTestEvents.Add('stop:' + $Name) }
function Start-Service { param($Name, $ErrorAction) $global:hbRenewTestEvents.Add('start:' + $Name) }
function Restart-Service { param($Name, $ErrorAction) $global:hbRenewTestEvents.Add('restart:' + $Name) }
try {
    $global:hbRenewTestHealthFails = $false
    $global:hbRenewCaddyFails = $false
    foreach ($gatewayStatus in @('Stopped','Running')) {
        foreach ($discoveryStatus in @('Stopped','Running')) {
            $global:hbRenewTestGatewayStatus = $gatewayStatus; $global:hbRenewTestDiscoveryStatus = $discoveryStatus
            $global:hbRenewTestEvents = [Collections.Generic.List[string]]::new()
            & (Join-Path $fixtureRoot 'renew-office-network.ps1') -NodeExe 'Invoke-FixtureNode' -CaddyExe 'Invoke-FixtureCaddy'
            $receipt = Get-Content -LiteralPath (Join-Path $fixtureRoot 'certificate-status.json') -Raw | ConvertFrom-Json
            if ($gatewayStatus -eq 'Stopped') {
                Assert-True ($receipt.status -eq 'PENDING_START' -and -not $receipt.runtimeVerified) 'a stopped gateway is not reported as live-verified'
                Assert-True ($global:hbRenewTestEvents.Count -eq 0) 'renewal does not start a stopped or administratively disabled gateway'
            } else {
                Assert-True ($receipt.runtimeVerified -and $global:hbRenewTestEvents.Contains('verified')) 'running gateway is verified after renewal'
                Assert-True ($global:hbRenewTestEvents.Contains('restart:hasarbotu-office-gateway')) 'changed certificates are applied to the running gateway'
                Assert-True ($global:hbRenewTestEvents.Contains('start:hasarbotu-network-discovery') -eq ($discoveryStatus -eq 'Running')) 'discovery running/stopped intent survives renewal'
            }
        }
    }
    $global:hbRenewTestHealthFails = $true
    [IO.File]::WriteAllText((Join-Path $fixtureRoot 'Caddyfile'), 'previous-certificate-pair')
    [IO.File]::WriteAllText((Join-Path $fixtureRoot 'certificate-current.json'), '{"certificateBase":"previous"}')
    [IO.File]::WriteAllText((Join-Path $fixtureRoot 'Caddyfile.previous'), 'stale-previous-pair')
    [IO.File]::WriteAllText((Join-Path $fixtureRoot 'certificate-current.json.previous'), '{"certificateBase":"previous"}')
    $failed = $false
    try { & (Join-Path $fixtureRoot 'renew-office-network.ps1') -NodeExe 'Invoke-FixtureNode' -CaddyExe 'Invoke-FixtureCaddy' }
    catch { $failed = $_.Exception.Message -eq 'RENEWED_GATEWAY_NOT_HEALTHY' }
    Assert-True $failed 'failed HTTPS verification is not reported as success'
    Assert-True ((Get-Content -LiteralPath (Join-Path $fixtureRoot 'Caddyfile') -Raw) -eq 'previous-certificate-pair') 'the previous certificate configuration is restored'
    Assert-True ((Get-Content -LiteralPath (Join-Path $fixtureRoot 'certificate-status.json') -Raw | ConvertFrom-Json).status -eq 'FAILED') 'failed renewal has an explicit diagnostic receipt'
    $global:hbRenewCaddyFails = $true
    $global:hbRenewTestEvents.Clear()
    $failed = $false
    try { & (Join-Path $fixtureRoot 'renew-office-network.ps1') -NodeExe 'Invoke-FixtureNode' -CaddyExe 'Invoke-FixtureCaddy' }
    catch { $failed = $_.Exception.Message -eq 'GATEWAY_CONFIG_INVALID' }
    Assert-True $failed 'a rejected Caddy configuration fails before any restart'
    Assert-True ([IO.File]::ReadAllText((Join-Path $fixtureRoot 'Caddyfile')) -eq 'previous-certificate-pair') 'validation failure restores the last effective configuration, not a stale previous file'
    Assert-True ([IO.File]::ReadAllText((Join-Path $fixtureRoot 'certificate-current.json')) -eq '{"certificateBase":"previous"}') 'validation failure restores the certificate pointer'
    Assert-True ($global:hbRenewTestEvents.Count -eq 0) 'configuration validation failure does not restart a running service'
    Write-Output "$script:checks/$script:checks PASS"
} finally {
    $resolved = [IO.Path]::GetFullPath($fixtureRoot)
    if (-not $resolved.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()), [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolved) -notlike 'hb-renew-*') { throw 'UNSAFE_FIXTURE_CLEANUP' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
