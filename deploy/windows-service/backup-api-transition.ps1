#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$ApiDirectory,
    [Parameter(Mandatory=$true)][string]$WinSwXml,
    [Parameter(Mandatory=$true)][string]$BackupDirectory)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'api-transition-secrets.psm1') -Force
try {
    if ((Get-Service hasarbotu-api).Status -ne 'Stopped') { throw 'STOPPED_API_REQUIRED' }
    $ApiDirectory = [IO.Path]::GetFullPath($ApiDirectory).TrimEnd('\')
    $BackupDirectory = [IO.Path]::GetFullPath($BackupDirectory).TrimEnd('\')
    if ($BackupDirectory.StartsWith($ApiDirectory + '\',[StringComparison]::OrdinalIgnoreCase) -or $BackupDirectory -eq $ApiDirectory -or (Test-Path -LiteralPath $BackupDirectory)) { throw 'NEW_EXTERNAL_BACKUP_DIRECTORY_REQUIRED' }
    [IO.Directory]::CreateDirectory($BackupDirectory) | Out-Null
    Protect-ApiTransitionPath $BackupDirectory ''
    $runtimeBackup = Join-Path $BackupDirectory 'runtime'
    [IO.Directory]::CreateDirectory($runtimeBackup) | Out-Null
    $files = [Collections.Generic.List[object]]::new()
    $runtimeFiles = [Collections.Generic.List[object]]::new()
    $runtimeAcls = [Collections.Generic.List[object]]::new()
    foreach ($segment in @('dist','node_modules','package.json','THIRD-PARTY-NOTICES.txt')) {
        $source = Join-Path $ApiDirectory $segment
        if (-not (Test-Path -LiteralPath $source)) {
            if ($segment -in @('dist','package.json')) { throw 'CURRENT_API_RUNTIME_MISSING' }
            continue
        }
        $all = @((Get-Item -LiteralPath $source -Force))
        if ($all[0].PSIsContainer) { $all += @(Get-ChildItem -LiteralPath $source -Recurse -Force) }
        if (@($all | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) { throw 'BACKUP_REPARSE_POINT_REJECTED' }
        foreach ($item in $all) {
            $runtimeAcls.Add([pscustomobject]@{ RelativePath=$item.FullName.Substring($ApiDirectory.Length + 1); Sddl=(Get-Acl -LiteralPath $item.FullName).Sddl })
        }
        Copy-Item -LiteralPath $source -Destination (Join-Path $runtimeBackup $segment) -Recurse -Force
        foreach ($file in @($all | Where-Object { -not $_.PSIsContainer })) {
            $relative = $file.FullName.Substring($ApiDirectory.Length + 1)
            $copy = Join-Path $runtimeBackup $relative
            $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
            if ($hash -ne (Get-FileHash -LiteralPath $copy -Algorithm SHA256).Hash) { throw 'BACKUP_HASH_MISMATCH' }
            $runtimeFiles.Add([pscustomobject]@{ RelativePath=$relative; Sha256=$hash; Size=$file.Length })
            $files.Add([pscustomobject]@{ RelativePath=('runtime\' + $relative); Sha256=$hash; Size=$file.Length })
        }
    }
    [IO.File]::Copy($WinSwXml,(Join-Path $BackupDirectory 'api.winsw.xml'),$false)
    $files.Add(@{ RelativePath='api.winsw.xml'; Sha256=(Get-FileHash -LiteralPath $WinSwXml -Algorithm SHA256).Hash; Size=(Get-Item -LiteralPath $WinSwXml).Length })
    if ((Get-FileHash -LiteralPath (Join-Path $BackupDirectory 'api.winsw.xml')).Hash -ne $files[$files.Count-1].Sha256) { throw 'XML_BACKUP_HASH_MISMATCH' }
    $runtimeManifest = Join-Path $BackupDirectory 'runtime.manifest.json'
    [IO.File]::WriteAllText($runtimeManifest,(@{ SourceTargetDir=$ApiDirectory; ManagedSegments=@('dist','node_modules','package.json','THIRD-PARTY-NOTICES.txt'); Entries=@($runtimeFiles | Sort-Object RelativePath) } | ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
    $files.Add(@{ RelativePath='runtime.manifest.json'; Sha256=(Get-FileHash -LiteralPath $runtimeManifest -Algorithm SHA256).Hash; Size=(Get-Item -LiteralPath $runtimeManifest).Length })
    [IO.File]::WriteAllText((Join-Path $BackupDirectory 'backup-manifest.json'),(@{ SourceTargetDir=$ApiDirectory; Entries=@($files); RuntimeAcls=@($runtimeAcls) } | ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $BackupDirectory 'SHA256SUMS.txt'),(($files | ForEach-Object { $_.Sha256.ToLowerInvariant() + '  ' + $_.RelativePath.Replace('\','/') }) -join "`n") + "`n",[Text.UTF8Encoding]::new($false))
    Write-Output 'API_AND_WINSW_BACKUP_HASH_VERIFIED_ADMIN_ONLY'
} catch { Write-Output 'API_BACKUP_FAILED_DETAILS_SUPPRESSED_DO_NOT_CONTINUE'; exit 1 }
