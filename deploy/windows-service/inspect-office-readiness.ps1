#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$ExpectedComputerName = 'DESKTOP-EFN2G33',
    [string]$StorageRoot = $env:HASARBOTU_OFFICE_STORAGE_ROOT,
    [string]$NodeExe = '',
    [string]$OutputPath = '',
    [switch]$NetworkOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 may evaluate param defaults before PSScriptRoot is set.
if ([string]::IsNullOrWhiteSpace($OutputPath)) { $OutputPath = Join-Path $PSScriptRoot 'ofis-kontrol-sonucu.json' }
if ($NetworkOnly) {
    $blockers = @()
    if ($env:COMPUTERNAME -ne $ExpectedComputerName) { $blockers += 'TARGET_COMPUTER_MISMATCH' }
    $hostReport = [ordered]@{
        ComputerName = $env:COMPUTERNAME
        ExpectedComputerName = $ExpectedComputerName
        ReadinessInspected = $false
        Blockers = $blockers
        Status = $(if ($blockers.Count) { 'BLOCKED' } else { 'PENDING_CONNECTION_ACCEPTANCE' })
    }
} else {
    if ([string]::IsNullOrWhiteSpace($NodeExe)) { $NodeExe = Join-Path $PSScriptRoot 'runtime\node.exe' }
    $storageRootConfigured = -not [string]::IsNullOrWhiteSpace($StorageRoot)
    # Keep producing a diagnostic report when the private root was not supplied.
    if (-not $storageRootConfigured) { $StorageRoot = Join-Path ($env:SystemDrive + '\') 'HasarBotuStorage' }
    $inspectionScript = Join-Path $PSScriptRoot 'inspect-central-pilot-host.ps1'
    if (-not (Test-Path -LiteralPath $inspectionScript -PathType Leaf)) { throw 'HOST_INSPECTION_SCRIPT_REQUIRED' }
    # The child can fail its readiness checks while still returning a useful report.
    $raw = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $inspectionScript -ExpectedComputerName $ExpectedComputerName -StorageRoot $StorageRoot -NodeExe $NodeExe
    if (-not $raw) { throw 'HOST_INSPECTION_REPORT_REQUIRED' }
    $hostReport = ($raw | Out-String) | ConvertFrom-Json
    if (-not $storageRootConfigured) {
        $hostReport.Blockers = @($hostReport.Blockers) + 'STORAGE_ROOT_CONFIGURATION_REQUIRED'
        $hostReport.Status = 'BLOCKED'
    }
}
$networkAddresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
    Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.AddressState -eq 'Preferred' })
$ipv4 = @($networkAddresses | Select-Object -ExpandProperty IPAddress)
$networkAdapters = @(Get-NetAdapter -IncludeHidden -ErrorAction Stop |
    Select-Object Name, InterfaceDescription, Status, ifIndex)
$allServices = @(Get-CimInstance Win32_Service)
$vpnServices = @($allServices | Where-Object {
    $_.Name -match 'tailscale|zerotier|wireguard|openvpn' -or
    $_.DisplayName -match 'tailscale|zerotier|wireguard|openvpn'
} | Select-Object Name, DisplayName, State, StartMode)
$tailscaleCandidates = @()
$tailscaleCommand = Get-Command tailscale.exe -ErrorAction SilentlyContinue
if ($tailscaleCommand) { $tailscaleCandidates += $tailscaleCommand.Source }
foreach ($programDirectory in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
    if ($programDirectory) { $tailscaleCandidates += Join-Path $programDirectory 'Tailscale\tailscale.exe' }
}
$tailscaleExe = $tailscaleCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
$tailscale = [ordered]@{ Detected = [bool]($tailscaleExe -or @($vpnServices | Where-Object { $_.Name -match 'tailscale' }).Count); Status = 'CLI_NOT_FOUND' }
if ($tailscaleExe) {
    # Only selected connectivity fields are exported; status JSON can contain account identity and keys.
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $tailscaleExe
    $startInfo.Arguments = 'status --json'
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    try {
        if (-not $process.Start()) { throw 'TAILSCALE_PROCESS_START_FAILED' }
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(10000)) {
            $process.Kill()
            $process.WaitForExit()
            $tailscale.Status = 'CLI_TIMEOUT'
        } elseif ($process.ExitCode -ne 0) {
            $tailscale.Status = 'CLI_FAILED'
            $tailscale['ExitCode'] = $process.ExitCode
        } else {
            $state = $stdoutTask.GetAwaiter().GetResult() | ConvertFrom-Json
            $tailscale.Status = 'STATUS_READ'
            $tailscale['BackendState'] = $state.BackendState
            $tailscale['Addresses'] = @()
            if ($state.PSObject.Properties['TailscaleIPs'] -and $state.TailscaleIPs) { $tailscale['Addresses'] = @($state.TailscaleIPs) }
            $tailscale['Peers'] = @()
            if ($state.PSObject.Properties['Peer'] -and $state.Peer) { $tailscale['Peers'] = @($state.Peer.PSObject.Properties | ForEach-Object {
                [ordered]@{ HostName = $_.Value.HostName; Addresses = @($_.Value.TailscaleIPs); Online = $_.Value.Online }
            }) }
        }
    } catch {
        $tailscale.Status = 'STATUS_INSPECTION_FAILED'
        # Do not serialize error messages containing raw CLI data or account details.
        $tailscale['ErrorType'] = $_.Exception.GetType().Name
    } finally { $process.Dispose() }
}
$databaseServices = @(Get-CimInstance Win32_Service -Filter "Name LIKE '%postgres%'" |
    Select-Object Name, State, StartMode, StartName)
$existingServices = @(Get-CimInstance Win32_Service -Filter "Name LIKE '%hasarbotu%'" |
    Select-Object Name, State, StartMode, StartName, @{Name='ExecutablePath';Expression={
        # Exclude service arguments, which may contain credentials.
        if ($_.PathName -match '^"?(.+?\.exe)(?:"|\s|$)') { $Matches[1] } else { $null }
    }})
$listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop |
    Where-Object { $_.LocalPort -in @(3100,5432,443,5986,3389) } |
    Select-Object LocalAddress, LocalPort)
$pcloudCandidates = @()
if (-not $NetworkOnly) { foreach ($profile in @(Get-CimInstance Win32_UserProfile | Where-Object { -not $_.Special })) {
    if (-not $profile.LocalPath) { continue }
    foreach ($relative in @('AppData\Local\pCloud\data.db','AppData\Local\pCloud Drive\data.db')) {
        $candidate = Join-Path $profile.LocalPath $relative
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { $pcloudCandidates += $candidate }
    }
} }
$report = [ordered]@{
    SchemaVersion = 'hasarbotu-office-readiness/1.1.0'
    CheckedAtUtc = [DateTime]::UtcNow.ToString('o')
    InspectionScope = $(if ($NetworkOnly) { 'NETWORK_ONLY' } else { 'HOST_AND_NETWORK' })
    Status = $hostReport.Status
    Host = $hostReport
    LocalIPv4 = $ipv4
    NetworkAddresses = @($networkAddresses | Select-Object IPAddress, InterfaceAlias, InterfaceIndex, PrefixLength)
    NetworkAdapters = $networkAdapters
    VpnServices = $vpnServices
    Tailscale = $tailscale
    DatabaseServices = $databaseServices
    ExistingHasarBotuServices = $existingServices
    ListeningPorts = $listeners
    PcloudDatabaseCandidates = $pcloudCandidates
    InstallationPerformed = $false
    PendingChecks = @('MANAGED_CONNECTION_TO_OFFICE','EXISTING_DATABASE_INVENTORY_AND_BACKUP','PRODUCTION_DATA_RECONCILIATION','HTTPS_ENDPOINT_AND_TRUST','SERVICE_ACCOUNT_STORAGE_ACCESS','PCLOUD_FRESHNESS','BACKUP_AND_OFFICE_REBOOT')
}
$json = $report | ConvertTo-Json -Depth 7
$json | Set-Content -LiteralPath $OutputPath -Encoding UTF8
Write-Output $json
if ($hostReport.Status -eq 'BLOCKED') { exit 1 }
