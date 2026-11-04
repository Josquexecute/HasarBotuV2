#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidateSet('Check','Backup','ValidateBackup','RehearseBackup','Migrate','Verify','Quiescent')][string]$Action,
    [Parameter(Mandatory=$true)][string]$WinSwXml,
    [Parameter(Mandatory=$true)][string]$CandidateDirectory,
    [Parameter(Mandatory=$true)][string]$NodeExe,
    [string]$PgDumpExe, [string]$BackupDirectory, [switch]$RestoreAdmin,
    [string]$RestoreEvidencePath,[string]$RestoreEvidenceSha256,[string]$LegacyEvidenceManifestPath,[string]$LegacyEvidenceManifestSha256)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'api-transition-manager.psm1') -Force -DisableNameChecking
$credential = $null
try {
    if (($RestoreAdmin -and ($RestoreEvidencePath -or $LegacyEvidenceManifestPath)) -or ([bool]$RestoreEvidencePath -ne [bool]$RestoreEvidenceSha256) -or ([bool]$LegacyEvidenceManifestPath -ne [bool]$LegacyEvidenceManifestSha256) -or ($RestoreEvidencePath -and $LegacyEvidenceManifestPath)) { throw 'RESTORE_MODE_CONFLICT' }
    if ($RestoreAdmin) { $credential = Read-TransitionRestoreCredential }
    $context = @{Xml=$WinSwXml;Candidate=$CandidateDirectory;Node=$NodeExe;Dump=$PgDumpExe;RestoreAdminCredential=$credential}
    if ($RestoreEvidencePath) { $context.RestoreEvidence = @{path=$RestoreEvidencePath;sha256=$RestoreEvidenceSha256} }
    if ($LegacyEvidenceManifestPath) { $context.LegacyEvidence = @{manifestPath=$LegacyEvidenceManifestPath;sha256=$LegacyEvidenceManifestSha256;report='fresh-restore/isolated-restore-result.json'} }
    Invoke-TransitionDatabase $context $Action $BackupDirectory | ConvertTo-Json -Depth 5 -Compress
} catch {
    $safe = Get-TransitionDiagnostic $_ 'database_child' 'DATABASE_WRAPPER_FAILED'
    @{status='FAIL';action=$Action;stage=$safe.stage;code=$safe.code} | ConvertTo-Json -Compress
    exit 1
} finally { if ($credential) { $credential.Password.Dispose() } }
