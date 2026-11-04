#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding()]
param([string]$RuntimeDirectory, [string]$CandidateDirectory, [string]$WinSwXml, [switch]$RestoreAdmin, [string]$RestoreEvidencePath, [string]$RestoreEvidenceSha256, [switch]$Apply, [switch]$Rollback, [switch]$InspectPostgres, [switch]$Rehearse)
# Generated delivery embeds the verified operator ZIP; no network download.
$ErrorActionPreference = 'Stop'
$stage = 'bundle_integrity'
try {
    if (($Rehearse -and -not $InspectPostgres) -or ($InspectPostgres -and ($Apply -or $Rollback -or $RestoreAdmin -or $CandidateDirectory -or $RestoreEvidencePath -or $RestoreEvidenceSha256))) { throw 'INSPECTION_MODE_CONFLICT' }
    if (($RestoreAdmin -and ($RestoreEvidencePath -or $RestoreEvidenceSha256)) -or ([bool]$RestoreEvidencePath -ne [bool]$RestoreEvidenceSha256)) { throw 'RESTORE_MODE_CONFLICT' }
    $bytes = [Convert]::FromBase64String('__ARCHIVE_BASE64__')
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $hash = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
    if ($hash -cne '__ARCHIVE_SHA256__') { throw 'BUNDLE_HASH_MISMATCH' }
    if ([Environment]::MachineName -ine 'DESKTOP-EFN2G33') { throw 'OFFICE_SERVER_REQUIRED' }
    $stage = 'operator_package_extract'
    $root = 'C:\HB0191\manager-__PACKAGE_FOLDER__'
    # Refuse junctions in the entire existing ancestor chain before writing.
    $ancestor = $root
    while ($ancestor) {
        if (Test-Path -LiteralPath $ancestor) {
            if ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'BUNDLE_REPARSE_POINT' }
        }
        $ancestor = Split-Path $ancestor -Parent
    }
    if (-not (Test-Path -LiteralPath $root)) {
        [IO.Directory]::CreateDirectory($root) | Out-Null
        $acl = [Security.AccessControl.DirectorySecurity]::new()
        $acl.SetAccessRuleProtection($true,$false)
        $acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
        foreach ($sid in @('S-1-5-32-544','S-1-5-18')) {
            $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
        }
        Set-Acl -LiteralPath $root -AclObject $acl
        Add-Type -AssemblyName System.IO.Compression
        $memory = [IO.MemoryStream]::new($bytes,$false)
        $archive = [IO.Compression.ZipArchive]::new($memory,[IO.Compression.ZipArchiveMode]::Read)
        try {
            foreach ($entry in $archive.Entries) {
                $path = [IO.Path]::GetFullPath((Join-Path $root $entry.FullName))
                if (-not $path.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'BUNDLE_PATH_ESCAPE' }
                if ($entry.FullName.EndsWith('/') -or $entry.FullName.EndsWith('\')) { [IO.Directory]::CreateDirectory($path) | Out-Null; continue }
                [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($path)) | Out-Null
                $inputStream = $entry.Open()
                try {
                    $outputStream = [IO.File]::Open($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
                    try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose() }
                } finally { $inputStream.Dispose() }
            }
        } finally { $archive.Dispose(); $memory.Dispose() }
    }
    $stage = 'manager_start'
    $entry=if($InspectPostgres){'inspect-local-postgres.ps1'}else{'start-api-transition.ps1'}
    $managerArguments = @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $root ('transition-manager\'+$entry)))
    if ($RuntimeDirectory) { $managerArguments += @('-RuntimeDirectory',$RuntimeDirectory) }
    if ($CandidateDirectory) { $managerArguments += @('-CandidateDirectory',$CandidateDirectory) }
    if ($WinSwXml) { $managerArguments += @('-WinSwXml',$WinSwXml) }
    if ($RestoreAdmin) { $managerArguments += '-RestoreAdmin' }
    if ($RestoreEvidencePath) { $managerArguments += @('-RestoreEvidencePath',$RestoreEvidencePath,'-RestoreEvidenceSha256',$RestoreEvidenceSha256) }
    if ($Rehearse) { $managerArguments += '-Rehearse' }
    if ($Apply) { $managerArguments += '-Apply' }
    if ($Rollback) { $managerArguments += '-Rollback' }
    & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" @managerArguments
    exit $LASTEXITCODE
} catch {
    $code = if ($_.Exception.Message -in @('BUNDLE_HASH_MISMATCH','OFFICE_SERVER_REQUIRED','BUNDLE_REPARSE_POINT','BUNDLE_PATH_ESCAPE','INSPECTION_MODE_CONFLICT','RESTORE_MODE_CONFLICT')) { $_.Exception.Message } else { 'BUNDLE_FAILED_DETAILS_SUPPRESSED' }
    Write-Host ('STOP stage='+$stage+' code='+$code)
    exit 1
}
