#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'storage-path-safety.psm1') -Force
$script:failures = 0
function Assert-True {
    param([bool]$Condition, [string]$Message)
    if ($Condition) { Write-Output "OK: $Message" } else { Write-Output "FAIL: $Message"; $script:failures++ }
}
$root = Join-Path $env:TEMP ('hasarbotu-path-safety-' + [Guid]::NewGuid().ToString('N'))
$storage = Join-Path $root 'storage'
$outside = Join-Path $root 'storage-other'
try {
    New-Item -ItemType Directory -Path $storage, $outside -Force | Out-Null
    $file = Join-Path $storage 'file.txt'
    [System.IO.File]::WriteAllText($file, 'synthetic')
    Assert-True (Test-StoragePathWithinRoot $file $storage) 'a child stays inside its root'
    Assert-True (Test-StoragePathWithinRoot ([System.IO.Path]::GetFullPath($file)) $storage) 'short and long Windows paths identify the same child'
    Assert-True (Test-StoragePathWithinRoot $storage $storage) 'root equality is recognized for backup checks'
    Assert-True (-not (Test-StoragePathWithinRoot (Join-Path $outside 'file.txt') $storage)) 'a sibling sharing the root prefix is outside'
    Assert-True (-not (Test-StoragePathWithinRoot (Join-Path $storage '..\storage-other\file.txt') $storage)) 'parent traversal is outside after normalization'
    Assert-True (Test-StoragePathWithoutReparsePoints $file $storage) 'ordinary files are safe'
    Assert-True (Test-StoragePathWithoutReparsePoints (Join-Path $root 'new\backup')) 'missing backup leaves still validate their ancestors'
    $link = Join-Path $storage 'linked'
    New-Item -ItemType Junction -Path $link -Target $outside | Out-Null
    Assert-True (-not (Test-StoragePathWithoutReparsePoints (Join-Path $link 'file.txt') $storage)) 'a directory junction is rejected'
    Assert-True (-not (Test-StoragePathWithoutReparsePoints (Join-Path $link 'new\backup'))) 'a junction in an existing backup ancestor is rejected'
    Assert-True (-not (Test-StoragePathWithoutReparsePoints $link $link)) 'a junction used as the root is rejected'
} finally {
    $absolute = [System.IO.Path]::GetFullPath($root)
    $temporary = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
    if (-not $absolute.StartsWith($temporary, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected test directory' }
    Remove-Item -LiteralPath $root -Recurse -Force
}
Write-Output "SUMMARY: $script:failures failure(s)"
if ($script:failures -gt 0) { exit 1 }
