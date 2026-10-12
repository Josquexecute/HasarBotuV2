#Requires -Version 5.1
Set-StrictMode -Version Latest

function Get-OfficeSshInspection {
    param([string]$ManagementDirectory, [string]$ConfigPath)
    $service = Get-CimInstance Win32_Service -Filter "Name = 'sshd'"
    $statePath = Join-Path $ManagementDirectory 'deployment-state.json'
    $inspection = [ordered]@{
        ServiceStatus = [string]$service.State
        ServiceStartMode = [string]$service.StartMode
        Listeners = @(Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -eq 22 } |
            Select-Object LocalAddress, LocalPort, OwningProcess)
        DeploymentStatePresent = [bool](Test-Path -LiteralPath $statePath -PathType Leaf)
        ConfigurationPresent = [bool](Test-Path -LiteralPath $ConfigPath -PathType Leaf)
    }
    if ($inspection.ConfigurationPresent) {
        $inspection['ConfigSha256'] = (Get-FileHash -LiteralPath $ConfigPath -Algorithm SHA256).Hash
    }
    return $inspection
}

function Assert-OfficeManagementAcl {
    param([string]$Path)
    $acl = Get-Acl -LiteralPath $Path
    if (-not $acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne 'S-1-5-32-544') {
        throw 'MANAGEMENT_ACL_REQUIRES_REVIEW'
    }
    $seen = @()
    foreach ($rule in $acl.Access) {
        $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
        if ($sid -notin @('S-1-5-18', 'S-1-5-32-544') -or $rule.AccessControlType -ne 'Allow' -or
            $rule.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl) {
            throw 'MANAGEMENT_ACL_REQUIRES_REVIEW'
        }
        $seen += $sid
    }
    if (@($seen | Select-Object -Unique).Count -ne 2) { throw 'MANAGEMENT_ACL_REQUIRES_REVIEW' }
}

function Get-VerifiedOfficeManagementState {
    param([string]$ManagementDirectory, [string]$ConfigPath, [string]$AuthorizedKeyPath,
          [string]$HostKeyPath, [string]$SshBin, [string]$ExpectedConfig, [string]$PublicKey,
          [string]$UserName, [string]$OfficeAddress, [string]$ClientAddress, [string]$RuleName)
    $statePath = Join-Path $ManagementDirectory 'deployment-state.json'
    if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) { throw 'EXISTING_SSH_SERVICE_REQUIRES_REVIEW' }
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    if ($state.SchemaVersion -ne 'hasarbotu-office-management/1.0.0' -or $state.Status -ne 'PENDING_REMOTE_KEY_ACCEPTANCE' -or
        $state.ComputerName -ne $env:COMPUTERNAME -or $state.OfficeAddress -ne $OfficeAddress -or
        $state.AllowedClientAddress -ne $ClientAddress -or $state.UserName -ne $UserName -or $state.FirewallRuleName -ne $RuleName) {
        throw 'EXISTING_MANAGEMENT_IDENTITY_REQUIRES_REVIEW'
    }
    foreach ($file in @($ConfigPath, $AuthorizedKeyPath, $HostKeyPath)) { Assert-OfficeManagementAcl -Path $file }
    # State inherits the protected management directory's two-principal ACL.
    Assert-OfficeManagementAcl -Path $ManagementDirectory
    $stateAcl = Get-Acl -LiteralPath $statePath
    foreach ($rule in $stateAcl.Access) {
        if ($rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin @('S-1-5-18', 'S-1-5-32-544')) {
            throw 'MANAGEMENT_STATE_ACL_REQUIRES_REVIEW'
        }
    }
    $expectedKeys = 'from="' + $ClientAddress + '",no-agent-forwarding,no-port-forwarding,no-X11-forwarding ' + $PublicKey + "`n"
    if ([IO.File]::ReadAllText($ConfigPath) -cne ($ExpectedConfig + "`n") -or
        [IO.File]::ReadAllText($AuthorizedKeyPath) -cne $expectedKeys -or
        (Get-FileHash -LiteralPath $ConfigPath -Algorithm SHA256).Hash -ne $state.ConfigSha256 -or
        (Get-FileHash -LiteralPath $AuthorizedKeyPath -Algorithm SHA256).Hash -ne $state.AuthorizedKeysSha256) {
        throw 'CHANGED_SSH_CONFIGURATION_REQUIRES_REVIEW'
    }
    $hostPublicKey = [IO.File]::ReadAllText($HostKeyPath + '.pub').Trim()
    if ($hostPublicKey -cnotmatch '^ssh-ed25519 ([A-Za-z0-9+/]+={0,2})(?: [a-zA-Z0-9._-]+)?$' -or
        [Convert]::FromBase64String($Matches[1]).Length -ne 51 -or $hostPublicKey -cne $state.HostPublicKey) {
        throw 'CHANGED_SSH_HOST_KEY_REQUIRES_REVIEW'
    }
    $derived = Invoke-OfficeSshNative -File (Join-Path $SshBin 'ssh-keygen.exe') -Arguments ('-y -f "' + $HostKeyPath + '"')
    if (($derived -split ' ')[1] -cne ($hostPublicKey -split ' ')[1]) { throw 'SSH_HOST_KEY_PAIR_MISMATCH' }
    Invoke-OfficeSshNative -File (Join-Path $SshBin 'sshd.exe') -Arguments ('-t -f "' + $ConfigPath + '"') | Out-Null
    $service = Get-CimInstance Win32_Service -Filter "Name = 'sshd'"
    $expectedExe = Join-Path $SshBin 'sshd.exe'
    if ($service.PathName.Trim('"') -ine $expectedExe -or $service.State -ne 'Running') { throw 'SSH_SERVICE_ACCEPTANCE_FAILED' }
    $listeners = @(Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -eq 22 })
    if ($listeners.Count -ne 1 -or $listeners[0].LocalAddress -ne $OfficeAddress -or $listeners[0].OwningProcess -ne $service.ProcessId) {
        throw 'SSH_LISTENER_ACCEPTANCE_FAILED'
    }
    $rule = Get-NetFirewallRule -Name $RuleName
    $address = $rule | Get-NetFirewallAddressFilter
    $port = $rule | Get-NetFirewallPortFilter
    $interface = $rule | Get-NetFirewallInterfaceFilter
    $application = $rule | Get-NetFirewallApplicationFilter
    $defaultRule = Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue
    if ($rule.Enabled -ne 'True' -or $rule.Action -ne 'Allow' -or $rule.Direction -ne 'Inbound' -or
        $address.LocalAddress -ne $OfficeAddress -or $address.RemoteAddress -ne $ClientAddress -or
        $port.LocalPort -ne '22' -or $port.Protocol -notin @('TCP', '6') -or
        $interface.InterfaceAlias -ne 'Tailscale' -or $application.Program -ine $expectedExe -or
        ($defaultRule -and $defaultRule.Enabled -eq 'True')) { throw 'SSH_FIREWALL_ACCEPTANCE_FAILED' }
    return [ordered]@{
        HostPublicKey = $hostPublicKey
        HostKeyFingerprint = Invoke-OfficeSshNative -File (Join-Path $SshBin 'ssh-keygen.exe') -Arguments ('-l -f "' + $HostKeyPath + '.pub"')
        ConfigSha256 = $state.ConfigSha256
        AuthorizedKeysSha256 = $state.AuthorizedKeysSha256
        FirewallRuleName = $RuleName
        FirewallRestrictionsAccepted = $true
    }
}
