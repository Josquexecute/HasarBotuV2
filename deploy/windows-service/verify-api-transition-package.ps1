#Requires -Version 5.1
param([Parameter(Mandatory=$true)][string]$Directory)
$ErrorActionPreference = 'Stop'
try {
    $root = [IO.Path]::GetFullPath($Directory).TrimEnd('\')
    $manifestPath = Join-Path $root 'package-manifest.json'
    $manifest = [IO.File]::ReadAllText($manifestPath) | ConvertFrom-Json
    if ($manifest.sourceCommit -ne '2a4f6009b12a9470ac50d3802a33f92cafd47875' -or $manifest.version -ne '0.1.91') { throw 'SOURCE_VERSION_MISMATCH' }
    $expected = @{}
    foreach ($entry in $manifest.files) {
        $path = [IO.Path]::GetFullPath((Join-Path $root $entry.path))
        if (-not $path.StartsWith($root + '\',[StringComparison]::OrdinalIgnoreCase) -or $expected.ContainsKey($path)) { throw 'MANIFEST_PATH_INVALID' }
        $file = Get-Item -LiteralPath $path -Force
        if ($file.PSIsContainer -or $file.Length -ne $entry.size -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ine $entry.sha256) { throw 'PACKAGE_HASH_OR_SIZE_MISMATCH' }
        $expected[$path] = $true
    }
    $all = @((Get-Item -LiteralPath $root -Force)) + @(Get-ChildItem -LiteralPath $root -Recurse -Force)
    foreach ($item in $all) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'PACKAGE_REPARSE_POINT' }
        if (-not $item.PSIsContainer -and $item.FullName -notin @($manifestPath,(Join-Path $root 'SHA256SUMS.txt')) -and -not $expected.ContainsKey($item.FullName)) { throw 'UNLISTED_PACKAGE_FILE' }
    }
    $sumLines = @([IO.File]::ReadAllLines((Join-Path $root 'SHA256SUMS.txt')) | Where-Object { $_ })
    if ($sumLines.Count -ne $manifest.files.Count + 1) { throw 'CHECKSUM_LIST_INVALID' }
    $seen = @{}
    foreach ($line in $sumLines) {
        if ($line -notmatch '^([a-f0-9]{64})  (.+)$') { throw 'CHECKSUM_LINE_INVALID' }
        $hash = $Matches[1]; $relative = $Matches[2]
        $path = [IO.Path]::GetFullPath((Join-Path $root $relative))
        if (($path -ne $manifestPath -and -not $expected.ContainsKey($path)) -or $seen.ContainsKey($path) -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ine $hash) { throw 'CHECKSUM_LIST_MISMATCH' }
        $seen[$path] = $true
    }
    Write-Output ('PACKAGE_PASS_FILES_' + $manifest.files.Count)
} catch { Write-Output 'PACKAGE_VERIFICATION_FAILED'; exit 1 }
