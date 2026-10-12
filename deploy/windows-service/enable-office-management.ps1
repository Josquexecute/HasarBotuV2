#Requires -Version 5.1
[CmdletBinding()]
param([switch]$Apply, [string]$OutputPath = '')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $OutputPath) { $OutputPath = Join-Path $PSScriptRoot 'ofis-yonetim-sonucu.json' }
$officeAddress = '100.79.207.106'
$clientAddress = '100.92.252.82'
$ruleName = 'HasarBotu-Office-SSH-Tailscale'
$report = [ordered]@{
    SchemaVersion = 'hasarbotu-office-management/1.0.0'
    CheckedAtUtc = [DateTime]::UtcNow.ToString('o')
    ComputerName = $env:COMPUTERNAME
    Status = 'BLOCKED'
    Stage = 'PRECONDITIONS'
    InstallationPerformed = $false
    OfficeDataModified = $false
    OfficeAddress = $officeAddress
    AllowedClientAddress = $clientAddress
}
try {
    if ($env:COMPUTERNAME -ne 'DESKTOP-EFN2G33') { throw 'TARGET_COMPUTER_MISMATCH' }
    . (Join-Path $PSScriptRoot 'office-ssh-settings.ps1')
    . (Join-Path $PSScriptRoot 'office-management-state.ps1')
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'ELEVATED_OFFICE_ADMIN_REQUIRED' }
    if ($identity.Name -notlike ($env:COMPUTERNAME + '\*')) { throw 'LOCAL_OFFICE_ADMIN_ACCOUNT_REQUIRED' }
    $userName = ($identity.Name -split '\\')[-1].ToLowerInvariant()
    $addresses = @(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -eq $officeAddress -and $_.InterfaceAlias -eq 'Tailscale' -and $_.AddressState -eq 'Preferred' })
    if ($addresses.Count -ne 1) { throw 'CONNECTED_OFFICE_TAILSCALE_ADDRESS_REQUIRED' }
    $publicKeyPath = Join-Path $PSScriptRoot 'development-office-access.pub'
    $publicKey = [IO.File]::ReadAllText($publicKeyPath).Trim()
    # Base64 is case-sensitive; Turkish culture's ignore-case folding can reject valid ASCII keys.
    if ($publicKey -cnotmatch '^ssh-ed25519 ([A-Za-z0-9+/]+={0,2})(?: [a-zA-Z0-9._-]+)?$') { throw 'SINGLE_ED25519_PUBLIC_KEY_REQUIRED' }
    if ([Convert]::FromBase64String($Matches[1]).Length -ne 51) { throw 'INVALID_ED25519_PUBLIC_KEY' }
    $sshDirectory = Join-Path $env:ProgramData 'ssh'
    $configPath = Join-Path $sshDirectory 'sshd_config'
    $managementDirectory = Join-Path $env:ProgramData 'HasarBotu\office-management'
    $sshBin = Join-Path $env:SystemRoot 'System32\OpenSSH'
    $hostKeyPath = Join-Path $managementDirectory 'ssh_host_ed25519_key'
    $authorizedKeyPath = Join-Path $sshDirectory 'administrators_authorized_keys'
    $config = Get-OfficeSshSettings -UserName $userName -OfficeAddress $officeAddress -ClientAddress $clientAddress -HostKeyPath $hostKeyPath -AuthorizedKeyPath $authorizedKeyPath -SftpPath (Join-Path $sshBin 'sftp-server.exe')
    $report['UserName'] = $userName
    $existingService = Get-Service -Name sshd -ErrorAction SilentlyContinue
    if ($existingService) {
        $report['ExistingSsh'] = Get-OfficeSshInspection -ManagementDirectory $managementDirectory -ConfigPath $configPath
        $verified = Get-VerifiedOfficeManagementState -ManagementDirectory $managementDirectory -ConfigPath $configPath -AuthorizedKeyPath $authorizedKeyPath -HostKeyPath $hostKeyPath -SshBin $sshBin -ExpectedConfig $config -PublicKey $publicKey -UserName $userName -OfficeAddress $officeAddress -ClientAddress $clientAddress -RuleName $ruleName
        foreach ($name in $verified.Keys) { $report[$name] = $verified[$name] }
        $report['ExistingInstallationRevalidated'] = $true
        $report.Status = 'PENDING_REMOTE_KEY_ACCEPTANCE'
        $report.Stage = 'LOCAL_LISTENER_ACCEPTED'
    } else {
        # Never replace an existing SSH installation or configuration belonging to someone else.
        if (Test-Path -LiteralPath $configPath) { throw 'EXISTING_SSH_CONFIGURATION_REQUIRES_REVIEW' }
        if ((Test-Path -LiteralPath $sshDirectory) -and @(Get-ChildItem -LiteralPath $sshDirectory -Force).Count) { throw 'EXISTING_SSH_DIRECTORY_REQUIRES_REVIEW' }
        if (Test-Path -LiteralPath $managementDirectory) { throw 'EXISTING_MANAGEMENT_DIRECTORY_REQUIRES_REVIEW' }
        if (Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue) { throw 'EXISTING_MANAGEMENT_RULE_REQUIRES_REVIEW' }
    }
    if (-not $existingService -and -not $Apply) {
        $report.Status = 'DRY_RUN'
    } elseif (-not $existingService) {
        $report.Stage = 'INSTALL_OPENSSH'
        $capability = Get-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0'
        if ($capability.State -ne 'Installed') {
            Write-Host 'Windows OpenSSH kuruluyor; Windows Update indirmesi zaman alabilir.'
            $report['InstallationAttempted'] = $true
            $report.InstallationPerformed = $null
            $installed = Add-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0'
            $report.InstallationPerformed = $true
            if ($installed.RestartNeeded) { throw 'WINDOWS_RESTART_REQUIRED_BEFORE_SSH_SETUP' }
        }
        # The Windows installer creates a general rule. Scope it before starting any listener.
        $defaultRule = Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue
        if ($defaultRule) { $defaultRule | Disable-NetFirewallRule | Out-Null }
        if ((Get-Service sshd).Status -ne 'Stopped') { throw 'UNEXPECTED_EXISTING_SSH_LISTENER' }
        $report.Stage = 'CONFIGURE_KEY_AUTHENTICATION'
        New-Item -ItemType Directory -Path $managementDirectory -Force | Out-Null
        Set-OfficeSshAcl -Path $managementDirectory -Directory
        New-Item -ItemType Directory -Path $sshDirectory -Force | Out-Null
        Set-OfficeSshAcl -Path $sshDirectory -Directory
        [IO.File]::WriteAllText($authorizedKeyPath, ('from="' + $clientAddress + '",no-agent-forwarding,no-port-forwarding,no-X11-forwarding ' + $publicKey + "`n"), [Text.UTF8Encoding]::new($false))
        Set-OfficeSshAcl -Path $authorizedKeyPath
        Invoke-OfficeSshNative -File (Join-Path $sshBin 'ssh-keygen.exe') -Arguments ('-q -t ed25519 -N "" -f "' + $hostKeyPath + '" -C "hasarbotu-office-management"') | Out-Null
        Set-OfficeSshAcl -Path $hostKeyPath
        [IO.File]::WriteAllText($configPath, $config + "`n", [Text.UTF8Encoding]::new($false))
        Set-OfficeSshAcl -Path $configPath
        Invoke-OfficeSshNative -File (Join-Path $sshBin 'sshd.exe') -Arguments ('-t -f "' + $configPath + '"') | Out-Null
        $report.Stage = 'RESTRICT_FIREWALL_AND_START'
        New-NetFirewallRule -Name $ruleName -DisplayName 'HasarBotu office management over Tailscale' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 22 -LocalAddress $officeAddress -RemoteAddress $clientAddress -InterfaceAlias 'Tailscale' -Profile Any -Program (Join-Path $sshBin 'sshd.exe') | Out-Null
        Invoke-OfficeSshNative -File (Join-Path $env:SystemRoot 'System32\sc.exe') -Arguments 'config sshd start= delayed-auto depend= Tailscale' | Out-Null
        # The Tailscale service may start before its address is ready after a reboot.
        Invoke-OfficeSshNative -File (Join-Path $env:SystemRoot 'System32\sc.exe') -Arguments 'failure sshd reset= 86400 actions= restart/5000/restart/15000/restart/60000' | Out-Null
        Start-Service sshd
        $listener = @(Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -eq 22 -and $_.LocalAddress -eq $officeAddress })
        $service = Get-CimInstance Win32_Service -Filter "Name = 'sshd'"
        if ($listener.Count -ne 1 -or (Get-Service sshd).Status -ne 'Running' -or $listener[0].OwningProcess -ne $service.ProcessId) { throw 'SSH_LISTENER_ACCEPTANCE_FAILED' }
        $rule = Get-NetFirewallRule -Name $ruleName
        $addressFilter = $rule | Get-NetFirewallAddressFilter
        $portFilter = $rule | Get-NetFirewallPortFilter
        if ($rule.Enabled -ne 'True' -or $rule.Action -ne 'Allow' -or $addressFilter.LocalAddress -ne $officeAddress -or
            $addressFilter.RemoteAddress -ne $clientAddress -or $portFilter.LocalPort -ne '22') { throw 'SSH_FIREWALL_ACCEPTANCE_FAILED' }
        $report['FirewallRestrictionsAccepted'] = $true
        $report['HostPublicKey'] = [IO.File]::ReadAllText($hostKeyPath + '.pub').Trim()
        $report['HostKeyFingerprint'] = Invoke-OfficeSshNative -File (Join-Path $sshBin 'ssh-keygen.exe') -Arguments ('-l -f "' + $hostKeyPath + '.pub"')
        $report['ConfigSha256'] = (Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash
        $report['AuthorizedKeysSha256'] = (Get-FileHash -LiteralPath $authorizedKeyPath -Algorithm SHA256).Hash
        $report['FirewallRuleName'] = $ruleName
        $report.Status = 'PENDING_REMOTE_KEY_ACCEPTANCE'
        $report.Stage = 'LOCAL_LISTENER_ACCEPTED'
        $report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $managementDirectory 'deployment-state.json') -Encoding UTF8
    }
} catch {
    $report['ErrorCode'] = $_.Exception.Message
    $report.Status = 'BLOCKED'
    if ($report.Stage -ne 'PRECONDITIONS') {
        # Preconditions proved there was no existing SSH service; close any newly created one on failure.
        $newService = Get-Service -Name sshd -ErrorAction SilentlyContinue
        if ($newService) {
            if ($newService.Status -ne 'Stopped') { Stop-Service sshd -ErrorAction Stop }
            Set-Service sshd -StartupType Disabled
        }
        $defaultRule = Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue
        if ($defaultRule) { $defaultRule | Disable-NetFirewallRule | Out-Null }
        $ownRule = Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
        if ($ownRule) { $ownRule | Disable-NetFirewallRule | Out-Null }
    }
} finally {
    $report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
}
Write-Output ($report | ConvertTo-Json -Depth 5)
if ($report.Status -eq 'BLOCKED') { exit 1 }
