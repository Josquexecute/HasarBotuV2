Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Protect-ApiTransitionPath([string]$Path, [string]$ServiceSid) {
    $item = Get-Item -LiteralPath $Path -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'REPARSE_POINT_REJECTED' }
    if ($item.PSIsContainer) { $acl = [Security.AccessControl.DirectorySecurity]::new() }
    else { $acl = [Security.AccessControl.FileSecurity]::new() }
    $acl.SetAccessRuleProtection($true, $false)
    $admin = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
    $acl.SetOwner($admin)
    $inheritance = if ($item.PSIsContainer) { [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
    foreach ($sid in @('S-1-5-32-544', 'S-1-5-18')) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid), 'FullControl', $inheritance, 'None', 'Allow'))
    }
    if ($ServiceSid -and $ServiceSid -notin @('S-1-5-32-544','S-1-5-18')) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($ServiceSid), 'ReadAndExecute', $inheritance, 'None', 'Allow'))
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Read-ApiServiceXml([string]$Path) {
    $settings = [Xml.XmlReaderSettings]::new()
    $settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver = $null
    $reader = [Xml.XmlReader]::Create($Path, $settings)
    try {
        $doc = [Xml.XmlDocument]::new()
        $doc.PreserveWhitespace = $true
        $doc.XmlResolver = $null
        $doc.Load($reader)
        # PowerShell's XML adapter exposes <name> as .Name on its parent.
        # Use CLR getters so a normal WinSW display name cannot shadow the root.
        $root = $doc.get_DocumentElement()
        if ($null -eq $root -or $root.get_Name() -cne 'service' -or $root.get_NamespaceURI() -cne '') { throw 'SERVICE_XML_REQUIRED' }
        return ,$doc
    } finally { $reader.Dispose() }
}

function Get-ApiServiceEnvironment([Xml.XmlDocument]$Document) {
    $values = @{}
    foreach ($entry in $Document.SelectNodes('/service/env')) {
        $name = $entry.GetAttribute('name')
        if (-not $name -or $values.ContainsKey($name)) { throw 'DUPLICATE_OR_EMPTY_ENV_NAME' }
        $values[$name] = $entry.GetAttribute('value')
    }
    return $values
}

function Get-ApiResolvedEnvironment {
    param([Xml.XmlDocument]$Document, [string]$XmlPath, [hashtable]$MachineEnvironment)
    if ($null -eq $MachineEnvironment) {
        $MachineEnvironment = @{}
        foreach ($entry in [Environment]::GetEnvironmentVariables('Machine').GetEnumerator()) { $MachineEnvironment[$entry.Key] = [string]$entry.Value }
        # Registry machine variables omit Windows-created process variables.
        # Derive these from the OS, never from the operator's user environment.
        $windows = [Environment]::GetFolderPath('Windows')
        $systemValues = @{
            SystemRoot=$windows; windir=$windows; SystemDrive=[IO.Path]::GetPathRoot($windows).TrimEnd('\');
            COMPUTERNAME=[Environment]::MachineName; ProgramData=[Environment]::GetFolderPath('CommonApplicationData');
            ProgramFiles=[Environment]::GetFolderPath('ProgramFiles'); ProgramW6432=[Environment]::GetFolderPath('ProgramFiles');
            'ProgramFiles(x86)'=[Environment]::GetFolderPath('ProgramFilesX86');
            CommonProgramFiles=[Environment]::GetFolderPath('CommonProgramFiles'); CommonProgramW6432=[Environment]::GetFolderPath('CommonProgramFiles');
            'CommonProgramFiles(x86)'=[Environment]::GetFolderPath('CommonProgramFilesX86')
        }
        foreach ($key in $systemValues.Keys) { if (-not $MachineEnvironment.ContainsKey($key)) { $MachineEnvironment[$key] = $systemValues[$key] } }
    }
    # Resolve as a machine service, independent of the operator's stale process.
    # Percent-encoded URL bytes must not be mistaken for unresolved variables.
    $resolved = @{}
    foreach ($key in $MachineEnvironment.Keys) { $resolved[$key] = $MachineEnvironment[$key] }
    $resolved.BASE = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($XmlPath))
    Get-ApiServiceEnvironment $Document | Out-Null
    foreach ($entry in $Document.SelectNodes('/service/env')) {
        $raw = $entry.GetAttribute('value')
        $literalUrl = $entry.GetAttribute('name') -eq 'DATABASE_URL' -and ($raw.StartsWith('postgres://',[StringComparison]::OrdinalIgnoreCase) -or $raw.StartsWith('postgresql://',[StringComparison]::OrdinalIgnoreCase))
        $value = if ($literalUrl) { $raw } else { [regex]::Replace($raw, '%([A-Za-z_][A-Za-z0-9_()]*)%', {
            param($match)
            if ($resolved.ContainsKey($match.Groups[1].Value)) { return $resolved[$match.Groups[1].Value] }
            return $match.Value
        }.GetNewClosure()) }
        $resolved[$entry.GetAttribute('name')] = $value
    }
    if (-not $resolved.ContainsKey('DATABASE_URL') -or -not $resolved.DATABASE_URL -or $resolved.DATABASE_URL -cmatch '^%[A-Za-z_][A-Za-z0-9_]*%$') { throw 'SERVICE_DATABASE_URL_UNRESOLVED' }
    return $resolved
}

function Convert-ApiSecureValue([Security.SecureString]$Value) {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Set-ApiDesktopOAuth {
    param([string]$XmlPath, [Security.SecureString]$ClientId, [Security.SecureString]$ClientSecret,
        [switch]$RemoveDesktopSecret, [string]$BackupDirectory, [string]$ServiceSid)
    $doc = Read-ApiServiceXml $XmlPath
    $before = Get-ApiServiceEnvironment $doc
    $effective = Get-ApiResolvedEnvironment -Document $doc -XmlPath $XmlPath
    foreach ($name in @('GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REDIRECT_URI')) {
        if (-not $effective.ContainsKey($name) -or -not $effective[$name]) { throw 'EXISTING_WEB_OAUTH_REQUIRED' }
    }
    $bind = if ($effective.ContainsKey('HOST')) { $effective.HOST } else { '127.0.0.1' }
    if ($bind -and $bind -notin @('127.0.0.1','::1')) { throw 'LOOPBACK_BIND_REQUIRED' }
    $id = Convert-ApiSecureValue $ClientId
    if ($id -cnotmatch '^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$') { throw 'DESKTOP_CLIENT_ID_INVALID' }
    if ($id -eq $effective.GOOGLE_CLIENT_ID) { throw 'DISTINCT_DESKTOP_CLIENT_REQUIRED' }
    $updates = @{ GOOGLE_DESKTOP_CLIENT_ID=$id; TRUST_LOOPBACK_PROXY='true' }
    if ($null -ne $ClientSecret) {
        $secret = Convert-ApiSecureValue $ClientSecret
        if (-not $secret -or $secret.Length -gt 4096 -or $secret -match '[\x00-\x1f]') { throw 'DESKTOP_CLIENT_SECRET_INVALID' }
        $updates.GOOGLE_DESKTOP_CLIENT_SECRET = $secret
    }
    foreach ($name in $updates.Keys) {
        $entry = @($doc.SelectNodes('/service/env') | Where-Object { $_.GetAttribute('name') -eq $name })
        if ($entry.Count) { $node = $entry[0] }
        else { $node = $doc.CreateElement('env'); $node.SetAttribute('name',$name); $doc.DocumentElement.AppendChild($node) | Out-Null }
        $node.SetAttribute('value',$updates[$name])
    }
    if ($RemoveDesktopSecret) {
        foreach ($node in @($doc.SelectNodes('/service/env') | Where-Object { $_.GetAttribute('name') -eq 'GOOGLE_DESKTOP_CLIENT_SECRET' })) { $doc.DocumentElement.RemoveChild($node) | Out-Null }
    }
    $after = Get-ApiServiceEnvironment $doc
    foreach ($name in $before.Keys) {
        if ($name -notin @('GOOGLE_DESKTOP_CLIENT_ID','GOOGLE_DESKTOP_CLIENT_SECRET','TRUST_LOOPBACK_PROXY') -and $before[$name] -cne $after[$name]) { throw 'EXISTING_ENV_CHANGED' }
    }
    if (Test-Path -LiteralPath $BackupDirectory) { throw 'NEW_BACKUP_DIRECTORY_REQUIRED' }
    [IO.Directory]::CreateDirectory($BackupDirectory) | Out-Null
    Protect-ApiTransitionPath $BackupDirectory ''
    $backup = Join-Path $BackupDirectory 'api.winsw.xml'
    [IO.File]::Copy($XmlPath, $backup, $false)
    Protect-ApiTransitionPath $backup ''
    $temp = Join-Path ([IO.Path]::GetDirectoryName($XmlPath)) ('.oauth-' + [Guid]::NewGuid().ToString('N') + '.tmp')
    try {
        [IO.File]::WriteAllBytes($temp, [byte[]]@())
        Protect-ApiTransitionPath $temp $ServiceSid
        $settings = [Xml.XmlWriterSettings]::new()
        $settings.Encoding = [Text.UTF8Encoding]::new($false)
        $writer = [Xml.XmlWriter]::Create($temp,$settings)
        try { $doc.Save($writer) } finally { $writer.Dispose() }
        $verified = Get-ApiServiceEnvironment (Read-ApiServiceXml $temp)
        foreach ($name in $after.Keys) { if ($verified[$name] -cne $after[$name]) { throw 'XML_ROUNDTRIP_FAILED' } }
        # Restrict the original before ReplaceFile preserves its ACL.
        Protect-ApiTransitionPath $XmlPath $ServiceSid
        # Windows PowerShell 5.1 converts a null string argument to an empty
        # path for this overload. Use a protected swap backup explicitly.
        $swapBackup = Join-Path $BackupDirectory 'api.pre-replace.xml'
        [IO.File]::Replace($temp,$XmlPath,$swapBackup)
        if ((Get-FileHash -LiteralPath $swapBackup).Hash -ne (Get-FileHash -LiteralPath $backup).Hash) { throw 'XML_CHANGED_DURING_UPDATE' }
        [IO.File]::Delete($swapBackup)
        Protect-ApiTransitionPath $XmlPath $ServiceSid
        $hash = (Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash.ToLowerInvariant()
        [IO.File]::WriteAllText((Join-Path $BackupDirectory 'SHA256SUMS.txt'), "$hash  api.winsw.xml`n", [Text.UTF8Encoding]::new($false))
    } finally {
        if ([IO.File]::Exists($temp)) { [IO.File]::Delete($temp) }
        $id = $null; $secret = $null; $updates = $null; $before = $null; $after = $null; $doc = $null
    }
}

Export-ModuleMember -Function Protect-ApiTransitionPath, Read-ApiServiceXml, Get-ApiServiceEnvironment, Get-ApiResolvedEnvironment, Set-ApiDesktopOAuth
