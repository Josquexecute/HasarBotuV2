#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'inspect-central-pilot-host.ps1'
$root = Join-Path ([System.IO.Path]::GetTempPath()) ('hb-host-inspection-' + [guid]::NewGuid().ToString('N'))
$testNode = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Source
$passed = 0
function Check {
    param([bool]$Condition, [string]$Name)
    if (-not $Condition) { throw "FAIL: $Name" }
    $script:passed++
}
New-Item -ItemType Directory -Path $root | Out-Null
try {
    $contentPath = Join-Path $root 'sentinel.txt'
    [System.IO.File]::WriteAllText($contentPath, 'unchanged')
    $before = (Get-FileHash -LiteralPath $contentPath).Hash
    $output = & powershell.exe -NoProfile -NonInteractive -File $script -StorageRoot $root -NodeExe $testNode
    $code = $LASTEXITCODE
    $result = ($output | Out-String) | ConvertFrom-Json
    Check ($code -eq 0 -and $result.Status -eq 'PENDING_SERVICE_PROBE') 'valid host remains pending actual service validation'
    Check ($result.ComputerName -eq $env:COMPUTERNAME) 'actual computer name'
    Check ($result.GoogleStatus -eq 'PENDING_SEPARATE_ACCEPTANCE') 'Google stays separate'
    Check ((Get-FileHash -LiteralPath $contentPath).Hash -eq $before -and @(Get-ChildItem -LiteralPath $root -Force).Count -eq 1) 'storage remains unchanged'
    foreach ($case in @(
        @{ Root = 'relative-path'; Node = $testNode; Code = 'STORAGE_ROOT_MUST_BE_ABSOLUTE_LOCAL_PATH' },
        @{ Root = (Join-Path $root 'missing'); Node = $testNode; Code = 'STORAGE_ROOT_NOT_FOUND' },
        @{ Root = $root; Node = (Join-Path $root 'missing-node.exe'); Code = 'NODE_EXECUTABLE_UNAVAILABLE' }
    )) {
        $output = & powershell.exe -NoProfile -NonInteractive -File $script -StorageRoot $case.Root -NodeExe $case.Node
        $code = $LASTEXITCODE
        $result = ($output | Out-String) | ConvertFrom-Json
        Check ($code -eq 1 -and $result.Status -eq 'BLOCKED' -and $result.Blockers -contains $case.Code) $case.Code
    }
    $output = & powershell.exe -NoProfile -NonInteractive -File $script -StorageRoot $root -NodeExe $testNode -ExpectedComputerName 'different-office-computer'
    $code = $LASTEXITCODE
    $result = ($output | Out-String) | ConvertFrom-Json
    Check ($code -eq 1 -and $result.Blockers -contains 'TARGET_COMPUTER_MISMATCH') 'reject wrong target computer'
    Write-Output "$passed/8 PASS"
} finally {
    # Only the fixture files created by this test are removed.
    Remove-Item -LiteralPath (Join-Path $root 'sentinel.txt')
    Remove-Item -LiteralPath $root
}
exit 0
