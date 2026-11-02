# Invoked only in a disposable directory by office-network-installer.test.mjs.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$source = Join-Path $env:HB_TEST_ROOT 'source'
$target = Join-Path $env:HB_TEST_ROOT 'network'
New-Item -ItemType Directory -Path $source | Out-Null
foreach ($file in @('install-office-network.ps1','office-network-state.ps1','rollback-office-network.ps1','office-network.mjs','provision-office-network.mjs','renew-office-network.ps1','set-office-service-recovery.ps1','office-service-recovery.cs','test-office-network-readiness.ps1')) {
    Copy-Item -LiteralPath (Join-Path $env:HB_TEST_SOURCE $file) -Destination (Join-Path $source $file)
}
$mockWrapper = @'
function Invoke-OfficeNetworkWrapper {
    param($Wrapper,$Action)
    $name = [IO.Path]::GetFileNameWithoutExtension($Wrapper)
    if ($Action -eq 'install') { $global:hbTestServices[$name] = [pscustomobject]@{Status='Stopped'} }
    if ($Action -eq 'uninstall') { $global:hbTestServices.Remove($name) }
}
'@
[IO.File]::AppendAllText((Join-Path $source 'office-network-state.ps1'), $mockWrapper)
$global:hbTestServices = @{'hasarbotu-api'=[pscustomobject]@{Status='Running'};'hasarbotu-lan-https'=[pscustomobject]@{Status='Running'}}
$global:hbTestGateway = $null
$global:hbTestRules = @{}
$global:hbTestTask = '<Task>original</Task>'
$legacyXml = Join-Path $env:HB_TEST_ROOT 'legacy.xml'
$legacyConfig = Join-Path $env:HB_TEST_ROOT 'legacy.caddy'
$legacyExe = [IO.Path]::ChangeExtension($legacyXml,'.exe')
$xml = '<service><id>hasarbotu-lan-https</id><executable>' + [Security.SecurityElement]::Escape($env:TEST_CADDY_EXE) + '</executable><arguments>run --config &quot;' + $legacyConfig + '&quot; --adapter caddyfile</arguments><depend>Tailscale</depend><onfailure action="restart" delay="10 sec"/></service>'
[IO.File]::WriteAllText($legacyXml,$xml)
[IO.File]::WriteAllText($legacyConfig,"https://office.example.test {`n bind 192.168.1.100`n reverse_proxy 127.0.0.1:3100`n}")
function Get-Service { param($Name,$ErrorAction) $global:hbTestServices[$Name] }
function Get-CimInstance {
    param($ClassName,$Filter)
    if ($Filter -eq "Name='hasarbotu-lan-https'") { @{PathName=('"' + $legacyExe + '"')} }
    elseif ($Filter -match "Name='([^']+)'") { if ($global:hbTestServices.ContainsKey($Matches[1]) -and $Matches[1] -ne 'hasarbotu-api') { @{PathName=('"' + (Join-Path $target ($Matches[1]+'.exe')) + '"')} } }
}
function Get-NetTCPConnection { param($State,$LocalPort,$ErrorAction) }
function Get-NetUDPEndpoint { param($LocalPort,$ErrorAction) }
function Get-NetFirewallRule { param($Name,$ErrorAction) $global:hbTestRules[$Name] }
function New-NetFirewallRule { param($Name,$DisplayName,$Direction,$Action,$Protocol,$LocalPort,$Program,$Profile,$RemoteAddress) $global:hbTestRules[$Name]=@{Name=$Name} }
function Remove-NetFirewallRule { param($Name) $global:hbTestRules.Remove($Name) }
function Get-ScheduledTask { param($TaskName,$ErrorAction) if ($global:hbTestTask) { @{Name=$TaskName} } }
function Export-ScheduledTask { param($TaskName) $global:hbTestTask }
function Register-ScheduledTask {
    param($TaskName,$Xml,$Action,$Trigger,$Settings,$User,$RunLevel,[switch]$Force)
    if ($Action -and $env:HB_TEST_INJECT_FAIL -eq 'true') { throw 'INJECTED_LATE_TASK_FAILURE' }
    $global:hbTestTask = if ($Xml) { $Xml } else { '<Task>new</Task>' }
}
function New-ScheduledTaskAction { param($Execute,$Argument) @{Execute=$Execute;Argument=$Argument} }
function New-ScheduledTaskTrigger { param([switch]$Daily,$At,[switch]$AtStartup) @{Trigger='test'} }
function New-ScheduledTaskSettingsSet { param([switch]$StartWhenAvailable,$MultipleInstances,$RestartCount,$RestartInterval,$ExecutionTimeLimit) @{Settings='test'} }
function Start-Service {
    param($Name,$ErrorAction)
    if ($Name -eq 'hasarbotu-office-gateway') {
        $global:hbTestGateway = Start-Process -FilePath $env:TEST_CADDY_EXE -ArgumentList ('run --config "' + (Join-Path $target 'Caddyfile') + '" --adapter caddyfile') -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $env:HB_TEST_ROOT 'caddy.out') -RedirectStandardError (Join-Path $env:HB_TEST_ROOT 'caddy.err')
    }
    $global:hbTestServices[$Name].Status = 'Running'
}
function Stop-Service {
    param($Name,$ErrorAction)
    if ($Name -eq 'hasarbotu-office-gateway' -and $global:hbTestGateway -and -not $global:hbTestGateway.HasExited) { $global:hbTestGateway.Kill(); $global:hbTestGateway.WaitForExit() }
    $global:hbTestServices[$Name].Status = 'Stopped'
}
try {
    $failed = $false
    try {
        & (Join-Path $source 'install-office-network.ps1') -ApiOrigin 'https://office.example.test' -LanHostname 'OFFICE' -Directory $target -NodeExe $env:HB_TEST_NODE -CaddyExe $env:TEST_CADDY_EXE -WinSwExe $env:TEST_WINSW_EXE -OpenSslExe 'C:\Program Files\Git\usr\bin\openssl.exe' -HttpsPort ([int]$env:HB_TEST_HTTPS_PORT) -Apply -RepairLegacyCaddy
    } catch {
        if ($_.Exception.Message -ne 'INJECTED_LATE_TASK_FAILURE') { throw }
        $failed = $true
    }
    if ($failed -ne ($env:HB_TEST_INJECT_FAIL -eq 'true')) { throw 'UNEXPECTED_INSTALL_OUTCOME' }
    if (-not $failed) {
        [xml]$managed = [IO.File]::ReadAllText($legacyXml)
        if ($managed.service.executable -ne $env:HB_TEST_NODE -or @($managed.service.SelectNodes('depend')).Count -ne 0) { throw 'LEGACY_MIGRATION_NOT_APPLIED' }
        if (@($managed.service.SelectNodes('onfailure'))[-1].GetAttribute('action') -ne 'none') { throw 'LEGACY_RECOVERY_NOT_BOUNDED' }
        $receipt = Get-ChildItem (Join-Path $target 'backups') -Filter state.json -Recurse | Select-Object -First 1 -ExpandProperty FullName
        . (Join-Path $source 'office-network-state.ps1')
        Restore-OfficeNetworkBackup -Receipt $receipt -Apply | Out-Null
    }
    if ([IO.File]::ReadAllText($legacyXml) -ne $xml -or -not ([IO.File]::ReadAllText($legacyConfig).Contains('192.168.1.100'))) { throw 'LEGACY_STATE_NOT_RESTORED' }
    if ($global:hbTestServices.Count -ne 2 -or $global:hbTestServices['hasarbotu-lan-https'].Status -ne 'Running' -or $global:hbTestRules.Count -ne 0 -or $global:hbTestTask -ne '<Task>original</Task>') { throw 'SYSTEM_STATE_NOT_RESTORED' }
    if (Test-Path -LiteralPath (Join-Path $target 'client-profile.json')) { throw 'PARTIAL_PROFILE_REMAINS' }
    Write-Output '{"fixture":"PASS","realTlsHealth":true,"productionMutated":false}'
} finally {
    if ($global:hbTestGateway -and -not $global:hbTestGateway.HasExited) { $global:hbTestGateway.Kill(); $global:hbTestGateway.WaitForExit() }
}
