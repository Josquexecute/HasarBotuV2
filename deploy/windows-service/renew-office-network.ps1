#Requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$NodeExe, [Parameter(Mandatory=$true)][string]$CaddyExe)
$ErrorActionPreference = 'Stop'
$beforeFiles = @{}
foreach ($name in @('Caddyfile','certificate-current.json','client-profile.json')) {
    $path = Join-Path $PSScriptRoot $name
    if (Test-Path -LiteralPath $path) { $beforeFiles[$name] = [IO.File]::ReadAllBytes($path) }
}
$gatewayRestartAttempted = $false
$discoveryStopped = $false
try {
    $output = & $NodeExe (Join-Path $PSScriptRoot 'provision-office-network.mjs') (Join-Path $PSScriptRoot 'server-settings.json') --renew
    if ($LASTEXITCODE -ne 0) { throw 'CERTIFICATE_RENEWAL_FAILED' }
    $result = $output | ConvertFrom-Json
    & $CaddyExe validate --config (Join-Path $PSScriptRoot 'Caddyfile') --adapter caddyfile
    if ($LASTEXITCODE -ne 0) { throw 'GATEWAY_CONFIG_INVALID' }
    $runtimeVerified = $false
    $gatewayRunning = (Get-Service -Name 'hasarbotu-office-gateway' -ErrorAction Stop).Status -eq 'Running'
    $discoveryRunning = (Get-Service -Name 'hasarbotu-network-discovery' -ErrorAction Stop).Status -eq 'Running'
    if ($result.certificateChanged -and $gatewayRunning) {
        if ($discoveryRunning) { Stop-Service -Name 'hasarbotu-network-discovery' -ErrorAction Stop; $discoveryStopped = $true }
        $gatewayRestartAttempted = $true
        Restart-Service -Name 'hasarbotu-office-gateway' -ErrorAction Stop
        & $NodeExe (Join-Path $PSScriptRoot 'office-network.mjs') wait (Join-Path $PSScriptRoot 'client-profile.json')
        if ($LASTEXITCODE -ne 0) { throw 'RENEWED_GATEWAY_NOT_HEALTHY' }
        $runtimeVerified = $true
    }
    $status = if ($result.certificateChanged -and -not $gatewayRunning) { 'PENDING_START' } else { 'PASS' }
    [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'certificate-status.json'), (@{status=$status;checkedAt=[DateTime]::UtcNow.ToString('o');renewed=$result.certificateChanged;runtimeVerified=$runtimeVerified} | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
} catch {
    $failure = $_
    # Validation can fail before any service restart. Restore the exact pre-renewal disk state in that case too.
    foreach ($file in $beforeFiles.Keys) { [IO.File]::WriteAllBytes((Join-Path $PSScriptRoot $file), $beforeFiles[$file]) }
    if ($gatewayRestartAttempted) {
        try { Restart-Service -Name 'hasarbotu-office-gateway' -ErrorAction Stop }
        catch {
            [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'certificate-status.json'), (@{status='FAILED';checkedAt=[DateTime]::UtcNow.ToString('o');code='CERTIFICATE_ROLLBACK_RESTART_FAILED'} | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
            throw "CERTIFICATE_ROLLBACK_RESTART_FAILED: $($failure.Exception.Message)"
        }
    }
    [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'certificate-status.json'), (@{status='FAILED';checkedAt=[DateTime]::UtcNow.ToString('o');code=$failure.Exception.Message} | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    throw $failure
} finally {
    if ($discoveryStopped) { Start-Service -Name 'hasarbotu-network-discovery' -ErrorAction Stop }
}
