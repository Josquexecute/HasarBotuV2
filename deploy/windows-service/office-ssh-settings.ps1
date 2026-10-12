#Requires -Version 5.1
Set-StrictMode -Version Latest

function Get-OfficeSshSettings {
    param([string]$UserName, [string]$OfficeAddress, [string]$ClientAddress,
          [string]$HostKeyPath, [string]$AuthorizedKeyPath, [string]$SftpPath)
    if ($UserName -cnotmatch '^[a-z0-9._-]+$') { throw 'LOCAL_ACCOUNT_NAME_UNSUPPORTED' }
    foreach ($address in @($OfficeAddress, $ClientAddress)) {
        $ip = [Net.IPAddress]::Parse($address)
        $bytes = $ip.GetAddressBytes()
        if ($bytes.Length -ne 4 -or $bytes[0] -ne 100 -or $bytes[1] -lt 64 -or $bytes[1] -gt 127) {
            throw 'TAILSCALE_IPV4_REQUIRED'
        }
    }
    foreach ($file in @($HostKeyPath, $AuthorizedKeyPath, $SftpPath)) {
        if ($file -notmatch '^[A-Za-z]:[\\/]' -or $file -match '["\r\n]') { throw 'SAFE_ABSOLUTE_SSH_PATH_REQUIRED' }
    }
    $hostFile = $HostKeyPath.Replace('\', '/')
    $authorizedFile = $AuthorizedKeyPath.Replace('\', '/')
    $sftpFile = $SftpPath.Replace('\', '/')
    return @"
Port 22
ListenAddress $OfficeAddress
HostKey "$hostFile"
AuthorizedKeysFile "$authorizedFile"
AllowUsers $UserName@$ClientAddress
AuthenticationMethods publickey
PubkeyAuthentication yes
PasswordAuthentication no
PermitEmptyPasswords no
AllowAgentForwarding no
AllowTcpForwarding no
MaxAuthTries 3
MaxSessions 2
LogLevel INFO
Subsystem sftp "$sftpFile"
"@
}

function Set-OfficeSshAcl {
    param([string]$Path, [switch]$Directory)
    $admin = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
    $system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
    if ($Directory) {
        $acl = [Security.AccessControl.DirectorySecurity]::new()
        $inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    } else {
        $acl = [Security.AccessControl.FileSecurity]::new()
        $inherit = [Security.AccessControl.InheritanceFlags]::None
    }
    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetOwner($admin)
    foreach ($sid in @($admin, $system)) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
            $sid, [Security.AccessControl.FileSystemRights]::FullControl, $inherit,
            [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Invoke-OfficeSshNative {
    param([string]$File, [string]$Arguments, [int]$TimeoutSeconds = 15)
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $File
    $info.Arguments = $Arguments
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $info
    try {
        if (-not $process.Start()) { throw 'SSH_NATIVE_START_FAILED' }
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            $process.Kill()
            $process.WaitForExit()
            throw 'SSH_NATIVE_TIMEOUT'
        }
        if ($process.ExitCode -ne 0) { throw ('SSH_NATIVE_FAILED_' + $process.ExitCode) }
        return $stdout.GetAwaiter().GetResult().Trim()
    } finally { $process.Dispose() }
}
