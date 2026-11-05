#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Receipt, [switch]$Apply)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'office-network-state.ps1')
Restore-OfficeNetworkBackup -Receipt $Receipt -Apply:$Apply | ConvertTo-Json -Compress
