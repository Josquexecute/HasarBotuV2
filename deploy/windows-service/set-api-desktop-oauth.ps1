#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$WinSwXml,
    [Parameter(Mandatory=$true)][string]$BackupDirectory,
    [switch]$WithDesktopSecret, [switch]$RemoveDesktopSecret)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'api-transition-secrets.psm1') -Force
$id = $null; $secret = $null
try {
    if ($WithDesktopSecret -and $RemoveDesktopSecret) { throw 'SECRET_OPTIONS_CONFLICT' }
    $WinSwXml = [IO.Path]::GetFullPath($WinSwXml)
    $doc = Read-ApiServiceXml $WinSwXml
    $service = Get-CimInstance Win32_Service -Filter "Name='hasarbotu-api'"
    if (-not $service -or $service.State -ne 'Stopped' -or [string]$doc.service.id -ne 'hasarbotu-api') { throw 'STOPPED_API_SERVICE_REQUIRED' }
    $command = $service.PathName.Trim()
    $exe = if ($command.StartsWith('"')) { $command.Split('"')[1] } else { ($command -split '\s+')[0] }
    if ([IO.Path]::ChangeExtension($exe,'.xml') -ine $WinSwXml) { throw 'XML_MUST_MATCH_INSTALLED_WINSW_SERVICE' }
    $account = $service.StartName
    $sid = if ($account -eq 'LocalSystem') { 'S-1-5-18' } else {
        if ($account.StartsWith('.\')) { $account = $env:COMPUTERNAME + $account.Substring(1) }
        ([Security.Principal.NTAccount]::new($account)).Translate([Security.Principal.SecurityIdentifier]).Value
    }
    $id = Read-Host 'Google Desktop client ID (hidden)' -AsSecureString
    if ($WithDesktopSecret) { $secret = Read-Host 'Google Desktop client secret (hidden)' -AsSecureString }
    Set-ApiDesktopOAuth -XmlPath $WinSwXml -ClientId $id -ClientSecret $secret -RemoveDesktopSecret:$RemoveDesktopSecret -BackupDirectory $BackupDirectory -ServiceSid $sid
    Write-Output 'DESKTOP_OAUTH_SAVED_WEB_OAUTH_PRESERVED_RESTART_REQUIRED'
} catch {
    # Never emit XML, credentials, exception payloads, or the PowerShell error record.
    Write-Output 'DESKTOP_OAUTH_FAILED_VALUES_SUPPRESSED_CHECK_PATH_SERVICE_BIND_AND_INPUT'
    exit 1
} finally {
    if ($null -ne $id) { $id.Dispose() }
    if ($null -ne $secret) { $secret.Dispose() }
}
