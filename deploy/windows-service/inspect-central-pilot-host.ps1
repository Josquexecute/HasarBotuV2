#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$StorageRoot,
    [string]$NodeExe = 'node.exe',
    [string]$ExpectedComputerName
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$blockers = [System.Collections.Generic.List[string]]::new()
$canonicalRoot = $null
$nodeVersion = $null
$directoryCount = $null

# This inspects the interactive account only. Service-account access is a separate gate.
if ($ExpectedComputerName -and $env:COMPUTERNAME -ine $ExpectedComputerName) {
    $blockers.Add('TARGET_COMPUTER_MISMATCH')
}
if ($StorageRoot -notmatch '^[A-Za-z]:[\\/]') {
    $blockers.Add('STORAGE_ROOT_MUST_BE_ABSOLUTE_LOCAL_PATH')
} else {
    $canonicalRoot = [System.IO.Path]::GetFullPath($StorageRoot)
    if (-not (Test-Path -LiteralPath $canonicalRoot -PathType Container)) {
        $blockers.Add('STORAGE_ROOT_NOT_FOUND')
    } else {
        try {
            $item = Get-Item -LiteralPath $canonicalRoot -Force
            while ($null -ne $item) {
                if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                    $blockers.Add('STORAGE_ROOT_REPARSE_POINT')
                    break
                }
                $item = $item.Parent
            }
            $drive = [System.IO.DriveInfo]::new([System.IO.Path]::GetPathRoot($canonicalRoot))
            if ($drive.DriveType -ne [System.IO.DriveType]::Fixed) {
                $blockers.Add('STORAGE_ROOT_MUST_BE_ON_FIXED_DISK')
            }
            $directoryCount = @(Get-ChildItem -LiteralPath $canonicalRoot -Directory -Force).Count
        } catch {
            $blockers.Add('STORAGE_ROOT_INSPECTION_FAILED')
        }
    }
}

try {
    $nodeCommand = Get-Command $NodeExe -CommandType Application -ErrorAction Stop | Select-Object -First 1
    $nodeVersion = (& $nodeCommand.Source --version 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v24\.\d+\.\d+$') {
        $blockers.Add('NODE_24_REQUIRED')
    }
} catch {
    $blockers.Add('NODE_EXECUTABLE_UNAVAILABLE')
}

$result = [ordered]@{
    SchemaVersion = 'hasarbotu-central-pilot-host-inspection/1.0.0'
    CheckedAtUtc = [DateTime]::UtcNow.ToString('o')
    ComputerName = $env:COMPUTERNAME
    ExpectedComputerName = $ExpectedComputerName
    StorageRoot = $canonicalRoot
    NodeVersion = $nodeVersion
    TopLevelDirectoryCount = $directoryCount
    Status = if ($blockers.Count -eq 0) { 'PENDING_SERVICE_PROBE' } else { 'BLOCKED' }
    Blockers = @($blockers)
    PendingChecks = @('OFFICE_UPTIME', 'POSTGRESQL_AND_DATABASE', 'SERVICE_ACCOUNT_READ_ACCESS', 'REGISTERED_CASE_LOCATIONS', 'TRACKING_END_TO_END', 'RESTART_AND_OUTAGE')
    GoogleStatus = 'PENDING_SEPARATE_ACCEPTANCE'
}
$result | ConvertTo-Json -Depth 3
if ($blockers.Count -ne 0) { exit 1 }
