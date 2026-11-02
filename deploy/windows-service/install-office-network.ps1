#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$ApiOrigin,
    [Parameter(Mandatory=$true)][string]$WinSwExe,
    [Parameter(Mandatory=$true)][string]$CaddyExe,
    [Parameter(Mandatory=$true)][string]$OpenSslExe,
    [string]$NodeExe = (Get-Command node.exe -ErrorAction Stop).Source,
    [string]$LanHostname = $env:COMPUTERNAME,
    [string]$Directory = 'C:\ProgramData\HasarBotu\office-network',
    [string]$RemoteOrigin,
    [int]$HttpsPort = 8443,
    [int]$DiscoveryPort = 43110,
    [switch]$Apply,
    [switch]$RepairLegacyCaddy
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'office-network-state.ps1')
foreach ($path in @($Directory, $NodeExe, $WinSwExe, $CaddyExe, $OpenSslExe)) {
    if (-not [IO.Path]::IsPathRooted($path) -or $path -match '["\r\n]') { throw 'SAFE_ABSOLUTE_PATH_REQUIRED' }
}
Assert-OfficeNetworkPath $Directory
if ([IO.Path]::GetFullPath($Directory).TrimEnd('\') -eq [IO.Path]::GetPathRoot($Directory).TrimEnd('\')) { throw 'UNSAFE_TARGET_DIRECTORY' }
if ((Test-Path -LiteralPath $Directory) -and @(Get-ChildItem -LiteralPath $Directory -Force).Count -gt 0) { Assert-OfficeNetworkProtectedFile $Directory }
if ((Test-Path -LiteralPath $Directory) -and @(Get-ChildItem -LiteralPath $Directory -Force).Count -gt 0 -and
    -not (Test-Path -LiteralPath (Join-Path $Directory 'server-settings.json'))) {
    $marker = Join-Path $Directory '.network-installer-v2'
    if (-not (Test-Path -LiteralPath $marker) -or [IO.File]::ReadAllText($marker) -ne 'hasarbotu-office-network-v2') { throw 'NONEMPTY_UNMANAGED_TARGET_DIRECTORY' }
    Assert-OfficeNetworkProtectedFile $Directory
}
foreach ($exe in @($NodeExe, $WinSwExe, $CaddyExe, $OpenSslExe)) {
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "EXECUTABLE_MISSING: $exe" }
}
if ((& $NodeExe --version) -notmatch '^v24\.') { throw 'NODE_24_REQUIRED' }
if ($HttpsPort -lt 1024 -or $HttpsPort -gt 65535 -or $DiscoveryPort -lt 1024 -or $DiscoveryPort -gt 65535) { throw 'INVALID_PORT' }
$gateway = Get-Service -Name 'hasarbotu-office-gateway' -ErrorAction SilentlyContinue
$discovery = Get-Service -Name 'hasarbotu-network-discovery' -ErrorAction SilentlyContinue
$serviceProcesses = @{'hasarbotu-office-gateway'=0;'hasarbotu-network-discovery'=0}
foreach ($name in @('hasarbotu-office-gateway','hasarbotu-network-discovery')) {
    $existingService = Get-CimInstance Win32_Service -Filter ("Name='" + $name + "'")
    if ($existingService -and $existingService.PathName.Trim('"') -ne (Join-Path $Directory ($name + '.exe'))) { throw 'NETWORK_SERVICE_PATH_CONFLICT' }
    if ($existingService) { $serviceProcesses[$name] = $existingService.ProcessId }
}
if (-not (Get-Service -Name 'hasarbotu-api' -ErrorAction SilentlyContinue)) { throw 'API_SERVICE_REQUIRED' }
$listener = @(Get-NetTCPConnection -State Listen -LocalPort $HttpsPort -ErrorAction SilentlyContinue)
Assert-OfficeNetworkListenerOwner $listener $serviceProcesses['hasarbotu-office-gateway']
Assert-OfficeNetworkListenerOwner @(Get-NetUDPEndpoint -LocalPort $DiscoveryPort -ErrorAction SilentlyContinue) $serviceProcesses['hasarbotu-network-discovery']
if ((Test-Path -LiteralPath $Directory) -and ((Get-Item -LiteralPath $Directory).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'UNSAFE_TARGET_DIRECTORY' }
$legacyFiles = @()
if ($RepairLegacyCaddy) {
    $legacy = Get-CimInstance Win32_Service -Filter "Name='hasarbotu-lan-https'"
    if (-not $legacy -or $legacy.PathName -notmatch '^"?([^"\r\n]+?\.exe)"?(?:\s|$)') { throw 'LEGACY_SERVICE_PATH_UNSUPPORTED' }
    $legacyXml = [IO.Path]::ChangeExtension($Matches[1], '.xml')
    [xml]$legacyDefinition = [IO.File]::ReadAllText($legacyXml)
    $managed = $legacyDefinition.service.executable -eq $NodeExe -and $legacyDefinition.service.arguments.StartsWith(('"' + (Join-Path $Directory 'office-network.mjs') + '" legacy-caddy '))
    if (-not $managed) {
        if ($legacyDefinition.service.executable -ne $CaddyExe -or $legacyDefinition.service.arguments -notmatch '--config\s+(?:"([^"]+)"|(\S+))') { throw 'LEGACY_CADDY_CONFIG_REQUIRES_INSPECTION' }
        $legacyConfig = if ($Matches[1]) { $Matches[1] } else { $Matches[2] }
        if (-not [IO.Path]::IsPathRooted($legacyConfig) -or -not (Test-Path -LiteralPath $legacyConfig -PathType Leaf)) { throw 'LEGACY_CADDY_CONFIG_MISSING' }
        $legacyFiles = @($legacyXml, $legacyConfig)
    }
}
$rules = @(@{Name='HasarBotu-Office-Gateway-v2';Protocol='TCP';Port=$HttpsPort;Program=$CaddyExe}, @{Name='HasarBotu-Office-Discovery-v2';Protocol='UDP';Port=$DiscoveryPort;Program=$NodeExe})
foreach ($rule in $rules) {
    $existing = Get-NetFirewallRule -Name $rule.Name -ErrorAction SilentlyContinue
    if ($existing) {
        $port = $existing | Get-NetFirewallPortFilter
        $program = $existing | Get-NetFirewallApplicationFilter
        $address = $existing | Get-NetFirewallAddressFilter
        if ([string]$existing.Direction -ne 'Inbound' -or [string]$existing.Action -ne 'Allow' -or [string]$existing.Enabled -ne 'True' -or
            ([string]$existing.Profile -replace '\s','') -ne 'Domain,Private' -or [string]$port.Protocol -ne $rule.Protocol -or
            [string]$port.LocalPort -ne [string]$rule.Port -or $program.Program -ine $rule.Program -or [string]$address.RemoteAddress -ne 'LocalSubnet') { throw 'NETWORK_FIREWALL_RULE_CONFLICT' }
    }
}
if (-not $Apply) {
    [ordered]@{ status='PREVIEW'; directory=$Directory; httpsPort=$HttpsPort; discoveryPort=$DiscoveryPort; repairLegacy=[bool]$RepairLegacyCaddy } | ConvertTo-Json -Compress
    return
}
# Private keys and service scripts share an administrator-owned deployment boundary.
New-Item -ItemType Directory -Path $Directory -Force | Out-Null
$acl = [Security.AccessControl.DirectorySecurity]::new()
$acl.SetAccessRuleProtection($true, $false)
foreach ($sid in @('S-1-5-18', 'S-1-5-32-544')) {
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid), 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
}
$acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
Set-Acl -LiteralPath $Directory -AclObject $acl
$directories = [Collections.Generic.Queue[string]]::new()
$directories.Enqueue($Directory)
while ($directories.Count) {
foreach ($entry in Get-ChildItem -LiteralPath ($directories.Dequeue()) -Force) {
    if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'UNSAFE_DEPLOYMENT_REPARSE_POINT' }
    if ($entry.PSIsContainer) { Set-Acl -LiteralPath $entry.FullName -AclObject $acl; $directories.Enqueue($entry.FullName) }
    else {
        $fileAcl = [Security.AccessControl.FileSecurity]::new()
        $fileAcl.SetAccessRuleProtection($true, $false)
        $fileAcl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
        foreach ($sid in @('S-1-5-18', 'S-1-5-32-544')) {
            $fileAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid), 'FullControl', 'Allow'))
        }
        Set-Acl -LiteralPath $entry.FullName -AclObject $fileAcl
    }
}
}
$utf8 = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText((Join-Path $Directory '.network-installer-v2'), 'hasarbotu-office-network-v2', $utf8)
$protectedFiles = @('server-settings.json','client-profile.json','certificate-current.json','Caddyfile',
    'office-network.mjs','provision-office-network.mjs','renew-office-network.ps1','office-network-state.ps1','rollback-office-network.ps1',
    'set-office-service-recovery.ps1','office-service-recovery.cs','test-office-network-readiness.ps1',
    'ca.crt','ca.key','ca.srl','Caddyfile.legacy-template',
    'hasarbotu-office-gateway.xml','hasarbotu-network-discovery.xml')
$receipt = New-OfficeNetworkBackup -Directory $Directory -Files $protectedFiles -LegacyFiles $legacyFiles
try {
$settingsFile = Join-Path $Directory 'server-settings.json'
$config = @{ directory=$Directory; openssl=$OpenSslExe; apiOrigin=$ApiOrigin; lanHostname=$LanHostname; httpsPort=$HttpsPort; discoveryPort=$DiscoveryPort }
if ($RemoteOrigin) { $config.remoteOrigin = $RemoteOrigin }
if (Test-Path -LiteralPath $settingsFile) { Copy-Item -LiteralPath $settingsFile -Destination ($settingsFile + '.before-update') -Force }
foreach ($file in @('office-network.mjs','provision-office-network.mjs','renew-office-network.ps1','office-network-state.ps1','rollback-office-network.ps1','set-office-service-recovery.ps1','office-service-recovery.cs','test-office-network-readiness.ps1')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $Directory $file) -Force
}
[IO.File]::WriteAllText($settingsFile, ($config | ConvertTo-Json), $utf8)
& $NodeExe (Join-Path $Directory 'provision-office-network.mjs') $settingsFile
if ($LASTEXITCODE -ne 0) { throw 'NETWORK_PROVISIONING_FAILED' }
& $CaddyExe validate --config (Join-Path $Directory 'Caddyfile') --adapter caddyfile
if ($LASTEXITCODE -ne 0) { throw 'GATEWAY_CONFIG_INVALID' }
function ConvertTo-XmlText([string]$Value) { [Security.SecurityElement]::Escape($Value) }
function Install-NetworkService([string]$Name, [string]$Executable, [string]$Arguments, [string]$Dependency) {
    $base = Join-Path $Directory $Name
    $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if ($service) { Stop-Service -Name $Name -ErrorAction Stop }
    if (Test-Path -LiteralPath ($base + '.xml')) { Copy-Item -LiteralPath ($base + '.xml') -Destination ($base + '.xml.before-update') -Force }
    $xml = @"
<service>
  <id>$Name</id><name>$Name</name>
  <description>HasarBotu authenticated office network transport</description>
  <executable>$(ConvertTo-XmlText $Executable)</executable>
  <arguments>$(ConvertTo-XmlText $Arguments)</arguments>
  <workingdirectory>$(ConvertTo-XmlText $Directory)</workingdirectory>
  <depend>$Dependency</depend><startmode>Automatic</startmode><delayedAutoStart>true</delayedAutoStart>
  <onfailure action="restart" delay="10 sec"/><onfailure action="restart" delay="30 sec"/><onfailure action="restart" delay="60 sec"/>
  <onfailure action="none"/>
  <resetfailure>1 hour</resetfailure><stoptimeout>20 sec</stoptimeout>
  <logpath>%BASE%\logs</logpath><log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>8</keepFiles></log>
</service>
"@
    [void][xml]$xml
    [IO.File]::WriteAllText(($base + '.xml'), $xml, $utf8)
    if (-not $service) {
        Copy-Item -LiteralPath $WinSwExe -Destination ($base + '.exe')
        Invoke-OfficeNetworkWrapper ($base + '.exe') 'install'
    } else {
        Invoke-OfficeNetworkWrapper ($base + '.exe') 'refresh'
    }
}
# The new wildcard listener uses its own port, so Serve/IIS on 443 remain untouched.
if ($discovery) { Stop-Service -Name 'hasarbotu-network-discovery' }
Install-NetworkService 'hasarbotu-office-gateway' $CaddyExe ('run --config "' + (Join-Path $Directory 'Caddyfile') + '" --adapter caddyfile') 'hasarbotu-api'
Install-NetworkService 'hasarbotu-network-discovery' $NodeExe ('"' + (Join-Path $Directory 'office-network.mjs') + '" discovery "' + (Join-Path $Directory 'client-profile.json') + '"') 'hasarbotu-office-gateway'
foreach ($rule in $rules) {
    $existing = Get-NetFirewallRule -Name $rule.Name -ErrorAction SilentlyContinue
    if (-not $existing) { New-NetFirewallRule -Name $rule.Name -DisplayName $rule.Name -Direction Inbound -Action Allow -Protocol $rule.Protocol -LocalPort $rule.Port -Program $rule.Program -Profile Domain,Private -RemoteAddress LocalSubnet | Out-Null }
}
if ($RepairLegacyCaddy) {
    $legacy = Get-CimInstance Win32_Service -Filter "Name='hasarbotu-lan-https'"
    if (-not $legacy -or $legacy.PathName -notmatch '^"?([^"\r\n]+?\.exe)"?(?:\s|$)') { throw 'LEGACY_SERVICE_PATH_UNSUPPORTED' }
    $legacyExe = $Matches[1]
    $legacyXml = [IO.Path]::ChangeExtension($legacyExe, '.xml')
    [xml]$xml = [IO.File]::ReadAllText($legacyXml)
    $alreadyManaged = $xml.service.executable -eq $NodeExe -and $xml.service.arguments.StartsWith(('"' + (Join-Path $Directory 'office-network.mjs') + '" legacy-caddy '))
    if (-not $alreadyManaged) {
    if ($xml.service.executable -ne $CaddyExe -or $xml.service.arguments -notmatch '--config\s+(?:"([^"]+)"|(\S+))') { throw 'LEGACY_CADDY_CONFIG_REQUIRES_INSPECTION' }
    $legacyConfig = if ($Matches[1]) { $Matches[1] } else { $Matches[2] }
    if (-not [IO.Path]::IsPathRooted($legacyConfig) -or -not (Test-Path -LiteralPath $legacyConfig -PathType Leaf)) { throw 'LEGACY_CADDY_CONFIG_MISSING' }
    $template = Join-Path $Directory 'Caddyfile.legacy-template'
    if (-not (Test-Path -LiteralPath $template)) { Copy-Item -LiteralPath $legacyConfig -Destination $template }
    $backup = $legacyXml + '.before-network-v2'
    if (-not (Test-Path -LiteralPath $backup)) { Copy-Item -LiteralPath $legacyXml -Destination $backup }
    Stop-Service -Name 'hasarbotu-lan-https'
        $xml.service.executable = $NodeExe
        $xml.service.arguments = '"' + (Join-Path $Directory 'office-network.mjs') + '" legacy-caddy "' + $CaddyExe + '" "' + $template + '" "' + $legacyConfig + '"'
        foreach ($dependency in @($xml.service.SelectNodes('depend'))) { if ($dependency.InnerText -eq 'Tailscale') { [void]$xml.service.RemoveChild($dependency) } }
        $failureActions = @($xml.service.SelectNodes('onfailure'))
        if (-not $failureActions.Count -or $failureActions[-1].action -ne 'none') {
            $stopRecovery = $xml.CreateElement('onfailure')
            $stopRecovery.SetAttribute('action', 'none')
            [void]$xml.service.AppendChild($stopRecovery)
        }
        $xml.Save($legacyXml)
        Invoke-OfficeNetworkWrapper $legacyExe 'refresh'
        Start-Service -Name 'hasarbotu-lan-https'
    }
}
Start-Service -Name 'hasarbotu-office-gateway'
& $NodeExe (Join-Path $Directory 'office-network.mjs') wait (Join-Path $Directory 'client-profile.json')
if ($LASTEXITCODE -ne 0) { throw 'GATEWAY_HEALTH_VERIFICATION_FAILED' }
Start-Service -Name 'hasarbotu-network-discovery'
# Use a protected script so renewal validates the certificate/config before restarting.
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $Directory 'renew-office-network.ps1') + '" -NodeExe "' + $NodeExe + '" -CaddyExe "' + $CaddyExe + '"')
$triggers = @((New-ScheduledTaskTrigger -Daily -At '04:15'), (New-ScheduledTaskTrigger -AtStartup))
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5) -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName 'HasarBotu-Office-Certificate-Renewal' -Action $action -Trigger $triggers -Settings $settings -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
[ordered]@{ status='INSTALLED'; clientProfile=(Join-Path $Directory 'client-profile.json'); rollbackReceipt=$receipt; productionAcceptance='PENDING'; legacyRulesPreserved=$true } | ConvertTo-Json -Compress
} catch {
    $installFailure = $_
    # Restore the exact pre-install state, including a legacy repair completed before a later failure.
    try {
        Restore-OfficeNetworkBackup -Receipt $receipt -Apply | ConvertTo-Json -Compress | Write-Output
    } catch { throw "NETWORK_ROLLBACK_FAILED; use protected receipt $receipt. Original failure: $($installFailure.Exception.Message). Rollback: $($_.Exception.Message)" }
    throw $installFailure
}
