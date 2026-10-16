#Requires -Version 5.1
Set-StrictMode -Version Latest

function Test-StoragePathWithinRoot {
    param([string]$Path, [string]$Root)
    try {
        $candidate = [System.IO.Path]::GetFullPath($Path).TrimEnd('\')
        $boundary = [System.IO.Path]::GetFullPath($Root).TrimEnd('\')
        return ($candidate.Equals($boundary, [StringComparison]::OrdinalIgnoreCase) -or
            $candidate.StartsWith($boundary + '\', [StringComparison]::OrdinalIgnoreCase))
    }
    catch { return $false }
}

function Test-StoragePathWithoutReparsePoints {
    param([string]$Path, [string]$Root)
    try {
        $candidate = [System.IO.Path]::GetFullPath($Path)
        $boundary = if ([string]::IsNullOrWhiteSpace($Root)) { [System.IO.Path]::GetPathRoot($candidate) } else { [System.IO.Path]::GetFullPath($Root) }
        if (-not (Test-StoragePathWithinRoot $candidate $boundary)) { return $false }
        $boundary = $boundary.TrimEnd('\')
        $current = $candidate.TrimEnd('\')
        while (-not [string]::IsNullOrWhiteSpace($current)) {
            # Missing leaf paths are expected for backups. Inspect every existing ancestor.
            $inspect = if ($current -match '^[A-Za-z]:$') { $current + '\' } else { $current }
            if ([System.IO.File]::Exists($inspect) -or [System.IO.Directory]::Exists($inspect)) {
                if (([System.IO.File]::GetAttributes($inspect) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { return $false }
            }
            if ($current.TrimEnd('\').Equals($boundary, [StringComparison]::OrdinalIgnoreCase)) { return $true }
            $current = [System.IO.Path]::GetDirectoryName($current)
        }
        return $false
    }
    catch { return $false }
}

Export-ModuleMember -Function Test-StoragePathWithinRoot, Test-StoragePathWithoutReparsePoints
