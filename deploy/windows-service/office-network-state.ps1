#Requires -Version 5.1
# Shared by install and explicit rollback. The enclosing directory must be Administrators/SYSTEM-only.
function Assert-OfficeNetworkPath {
    param([string]$Path)
    if (-not [IO.Path]::IsPathRooted($Path) -or $Path -match '["\r\n]') { throw 'SAFE_ABSOLUTE_PATH_REQUIRED' }
    $current = [IO.Path]::GetFullPath($Path)
    while ($current) {
        if ((Test-Path -LiteralPath $current) -and ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'NETWORK_REPARSE_POINT_REJECTED' }
        $parent = Split-Path -Parent $current
        if ($parent -eq $current) { break }
        $current = $parent
    }
}

function Assert-OfficeNetworkListenerOwner {
    param([object[]]$Listeners, [int]$ServiceProcessId)
    foreach ($listener in $Listeners) {
        if ($ServiceProcessId -le 0) { throw 'NETWORK_PORT_CONFLICT' }
        if ($listener.OwningProcess -eq $ServiceProcessId) { continue }
        $process = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $listener.OwningProcess)
        if (-not $process -or $process.ParentProcessId -ne $ServiceProcessId) { throw 'NETWORK_PORT_CONFLICT' }
    }
}

function New-OfficeNetworkBackup {
    param([string]$Directory, [string[]]$Files, [string[]]$LegacyFiles = @())
    Assert-OfficeNetworkProtectedFile $Directory
    $backup = Join-Path $Directory ('backups\' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    $entries = @()
    foreach ($path in @($Files | ForEach-Object { Join-Path $Directory $_ }) + $LegacyFiles) {
        Assert-OfficeNetworkPath $path
        $present = Test-Path -LiteralPath $path -PathType Leaf
        $encoded = if ($present) { [Convert]::ToBase64String([IO.File]::ReadAllBytes($path)) } else { '' }
        $entries += @{ path=$path; present=$present; bytes=$encoded }
    }
    $services = @()
    foreach ($name in @('hasarbotu-office-gateway','hasarbotu-network-discovery','hasarbotu-lan-https')) {
        $service = Get-Service -Name $name -ErrorAction SilentlyContinue
        if ($name -eq 'hasarbotu-lan-https' -and $LegacyFiles.Count -eq 0) { continue }
        $wrapper = Join-Path $Directory ($name + '.exe')
        if ($name -eq 'hasarbotu-lan-https') { $wrapper = [IO.Path]::ChangeExtension($LegacyFiles[0], '.exe') }
        $services += @{name=$name; present=[bool]$service; running=([bool]$service -and $service.Status -eq 'Running'); wrapper=$wrapper}
    }
    $taskName = 'HasarBotu-Office-Certificate-Renewal'
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    $taskXml = if ($task) { Export-ScheduledTask -TaskName $taskName } else { $null }
    $rules = @('HasarBotu-Office-Gateway-v2','HasarBotu-Office-Discovery-v2') | Where-Object { Get-NetFirewallRule -Name $_ -ErrorAction SilentlyContinue }
    $state = @{schemaVersion=1; machine=$env:COMPUTERNAME; directory=$Directory; entries=$entries; services=$services; taskXml=$taskXml; existingRules=@($rules)}
    $receipt = Join-Path $backup 'state.json'
    [IO.File]::WriteAllText($receipt, ($state | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText(($receipt + '.sha256'), (Get-FileHash -LiteralPath $receipt -Algorithm SHA256).Hash)
    return $receipt
}

function Assert-OfficeNetworkProtectedFile {
    param([string]$Path)
    $acl = Get-Acl -LiteralPath $Path
    $trusted = @('S-1-5-18','S-1-5-32-544')
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $trusted) { throw 'NETWORK_BACKUP_OWNER_UNTRUSTED' }
    foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $trusted) { throw 'NETWORK_BACKUP_ACL_UNTRUSTED' }
    }
}

function Invoke-OfficeNetworkWrapper {
    param([string]$Wrapper, [string]$Action)
    & $Wrapper $Action
    if ($LASTEXITCODE -ne 0) { throw "NETWORK_ROLLBACK_WRAPPER_FAILED: $Action" }
}

function Restore-OfficeNetworkBackup {
    param([Parameter(Mandatory=$true)][string]$Receipt, [switch]$Apply)
    Assert-OfficeNetworkPath $Receipt
    Assert-OfficeNetworkProtectedFile $Receipt
    Assert-OfficeNetworkProtectedFile ($Receipt + '.sha256')
    if ((Get-Item -LiteralPath $Receipt).Length -gt 4MB) { throw 'NETWORK_BACKUP_TOO_LARGE' }
    if ((Get-FileHash -LiteralPath $Receipt -Algorithm SHA256).Hash -ne [IO.File]::ReadAllText($Receipt + '.sha256').Trim()) { throw 'NETWORK_BACKUP_HASH_MISMATCH' }
    $state = [IO.File]::ReadAllText($Receipt) | ConvertFrom-Json
    if ($state.schemaVersion -ne 1 -or $state.machine -ne $env:COMPUTERNAME) { throw 'NETWORK_BACKUP_IDENTITY_MISMATCH' }
    Assert-OfficeNetworkProtectedFile $state.directory
    foreach ($entry in $state.entries) { Assert-OfficeNetworkPath $entry.path }
    if (-not $Apply) { return @{status='ROLLBACK_PREVIEW';receipt=$Receipt;databaseUnchanged=$true} }
    if (Test-Path -LiteralPath ($Receipt + '.restored')) { return @{status='ALREADY_RESTORED';receipt=$Receipt} }
    foreach ($name in @('hasarbotu-network-discovery','hasarbotu-office-gateway','hasarbotu-lan-https')) {
        $saved = @($state.services | Where-Object name -eq $name)
        if (-not $saved.Count) { continue }
        $service = Get-Service -Name $name -ErrorAction SilentlyContinue
        if ($service -and $service.Status -ne 'Stopped') { Stop-Service -Name $name -ErrorAction Stop }
        if ($service -and -not $saved[0].present) {
            Invoke-OfficeNetworkWrapper $saved[0].wrapper 'uninstall'
        }
    }
    foreach ($entry in $state.entries) {
        if ($entry.present) { [IO.File]::WriteAllBytes($entry.path, [Convert]::FromBase64String($entry.bytes)) }
        elseif (Test-Path -LiteralPath $entry.path -PathType Leaf) { Remove-Item -LiteralPath $entry.path -Force }
    }
    foreach ($name in @('HasarBotu-Office-Gateway-v2','HasarBotu-Office-Discovery-v2')) {
        if ($name -notin $state.existingRules -and (Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue)) { Remove-NetFirewallRule -Name $name }
    }
    $taskName = 'HasarBotu-Office-Certificate-Renewal'
    if ($state.taskXml) { Register-ScheduledTask -TaskName $taskName -Xml $state.taskXml -Force | Out-Null }
    elseif (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }
    foreach ($name in @('hasarbotu-lan-https','hasarbotu-office-gateway','hasarbotu-network-discovery')) {
        $saved = @($state.services | Where-Object name -eq $name)
        if (-not $saved.Count -or -not $saved[0].present) { continue }
        Invoke-OfficeNetworkWrapper $saved[0].wrapper 'refresh'
        if ($saved[0].running) { Start-Service -Name $name -ErrorAction Stop }
    }
    [IO.File]::WriteAllText(($Receipt + '.restored'), [DateTime]::UtcNow.ToString('o'))
    return @{status='RESTORED';receipt=$Receipt;databaseUnchanged=$true}
}
