[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$PCloudLocalDatabasePath,

    [Parameter(Mandatory)]
    [string]$TargetRoot,

    [Parameter(Mandatory)]
    [string]$TopLevelFolderName,

    [Parameter(Mandatory)]
    [string]$TestCaseRelativePath,

    [Parameter(Mandatory)]
    [string]$AttestationStoreDirectory,

    [Parameter(Mandatory)]
    [string]$ResultPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Disposable probe service INNER script (HB-2026-167, Karar 2).
#
# This is the payload a FUTURE, separate, explicit Apply tool would run
# INSIDE a one-shot, self-cleaning WinSW service registered as
# svc-hb-fileagent -- NOT this turn (plan+preview only, per explicit
# instruction). It is deliberately NOT gated on Administrator (unlike
# every other .ps1 in this directory) because svc-hb-fileagent is a
# dedicated, deliberately LOW-PRIVILEGE service account (SeDenyInteractive
# LogonRight, no admin group membership, HB-2026-113) -- an Administrator
# check here would make this script unable to run as the very identity it
# exists to prove things about.
#
# Because it is not Administrator-gated, it CANNOT write to the
# Administrators-only evidence directory other tools use
# (C:\ProgramData\HasarBotu\migration-preflight) -- svc-hb-fileagent has
# no grant there. It writes its result to -ResultPath instead, wherever
# the (separate, future) orchestrator tells it to -- that orchestrator is
# responsible for creating that directory beforehand with an ACL that
# specifically grants svc-hb-fileagent write access to just that one
# result location (a new, narrow, not-yet-applied grant -- see the
# preview tool's own precondition output).
#
# For the SAME reason (non-admin), this script calls
# pcloud-session0-freshness-gate.mjs DIRECTLY (node, no -Apply-style
# switch, no Administrator gate in that .mjs's own CLI entry point) rather
# than through run-pcloud-session0-freshness-gate.ps1, which DOES require
# Administrator and would simply fail here -- this exercises the freshness
# gate exactly the way a real, non-admin File Agent service invocation
# would, not a proxy.
#
# Never writes to pCloud, the target case's own file content, or performs
# any write this script does not explicitly attempt as part of the
# (expected-to-fail) no-write proof below.

function Get-Utf8Bytes {
    param([string]$Text)
    return [System.Text.UTF8Encoding]::new($false).GetBytes($Text)
}

$result = [ordered]@{
    SchemaVersion = 'hasarbotu-file-agent-disposable-probe-result/1.0.0'
    GeneratedAtUtc = [DateTime]::UtcNow.ToString('o')
    RanAsIdentity = $null
    DbReadProbe = [ordered]@{ Attempted = $true; Succeeded = $false; FilesRead = @(); Detail = $null }
    DbNoWriteProbe = [ordered]@{ Attempted = $true; WriteDenied = $false; Detail = $null }
    FreshnessGateProbe = [ordered]@{ Attempted = $true; Invoked = $false; CaseStatus = $null; GateStatus = $null; GateErrorCode = $null; ExitCode = $null; Detail = $null }
    OverallSucceeded = $false
}

try {
    $result.RanAsIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

    # 1) Real DB read probe: data.db + -wal/-shm if present.
    $dbBaseName = [System.IO.Path]::GetFileName($PCloudLocalDatabasePath)
    $pcloudFolder = Split-Path $PCloudLocalDatabasePath -Parent
    $namesToTry = @($dbBaseName, "$dbBaseName-wal", "$dbBaseName-shm")
    $filesRead = @()
    $readFailures = @()
    foreach ($name in $namesToTry) {
        $fullPath = Join-Path $pcloudFolder $name
        if (-not [System.IO.File]::Exists($fullPath)) { continue }
        try {
            $bytes = [System.IO.File]::ReadAllBytes($fullPath)
            $filesRead += [ordered]@{ Name = $name; BytesRead = $bytes.Length }
        }
        catch {
            $readFailures += [ordered]@{ Name = $name; Error = $_.Exception.Message }
        }
    }
    $result.DbReadProbe.FilesRead = $filesRead
    $result.DbReadProbe.Succeeded = ($filesRead.Count -gt 0 -and $readFailures.Count -eq 0)
    $result.DbReadProbe.Detail = if ($readFailures.Count -gt 0) { $readFailures } else { "Read $($filesRead.Count) file(s) successfully." }

    # 2) Real no-write probe against data.db itself -- a real attempt, not
    #    simulated. Expected/required outcome: access denied.
    try {
        $stream = [System.IO.File]::Open($PCloudLocalDatabasePath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read)
        $stream.Close()
        $result.DbNoWriteProbe.WriteDenied = $false
        $result.DbNoWriteProbe.Detail = 'UNEXPECTED: write handle was opened successfully -- this must never happen with the intended ACL.'
    }
    catch [System.UnauthorizedAccessException] {
        $result.DbNoWriteProbe.WriteDenied = $true
        $result.DbNoWriteProbe.Detail = 'Confirmed: write access denied (UnauthorizedAccessException), as intended.'
    }
    catch {
        # A different exception (e.g. sharing violation, since pCloud has
        # the file open) still proves no successful write occurred -- but
        # is recorded distinctly since it is not the specific ACL-deny
        # signal the design intends to prove.
        $result.DbNoWriteProbe.WriteDenied = $true
        $result.DbNoWriteProbe.Detail = "Write attempt failed with $($_.Exception.GetType().Name) (not UnauthorizedAccessException specifically, but still no write occurred): $($_.Exception.Message)"
    }

    # 3) Real, non-admin invocation of the Session-0-safe freshness gate's
    #    own CLI entry point directly (node), never through the
    #    Administrator-gated .ps1 wrapper.
    $nodeCommand = Get-Command node -CommandType Application -ErrorAction SilentlyContinue
    if ($null -eq $nodeCommand) {
        $result.FreshnessGateProbe.Detail = 'NODE_RUNTIME_NOT_FOUND'
    }
    else {
        $gateScriptPath = Join-Path $PSScriptRoot 'pcloud-session0-freshness-gate.mjs'
        if (-not [System.IO.File]::Exists($gateScriptPath)) {
            $result.FreshnessGateProbe.Detail = 'SESSION0_FRESHNESS_GATE_TOOLING_NOT_FOUND'
        }
        else {
            $targetCaseRoot = Join-Path $TargetRoot $TestCaseRelativePath
            $gateOutput = & $nodeCommand.Source $gateScriptPath `
                '--target-root' $targetCaseRoot `
                '--top-level-folder-name' $TopLevelFolderName `
                '--case-relative-path' $TestCaseRelativePath `
                '--pcloud-db' $PCloudLocalDatabasePath `
                '--attestation-store' $AttestationStoreDirectory 2>&1 | Out-String
            $gateExitCode = $LASTEXITCODE
            $result.FreshnessGateProbe.Invoked = $true
            $result.FreshnessGateProbe.ExitCode = $gateExitCode
            try {
                $gateReport = $gateOutput | ConvertFrom-Json
                # Case-ready responses carry CaseStatus but no Status/ErrorCode;
                # the gate's own error-path responses (see
                # pcloud-session0-freshness-gate.mjs's catch block) carry
                # Status='error' + ErrorCode but no CaseStatus -- capturing
                # both shapes here (not just CaseStatus, which is null on the
                # error path) is what lets a real run's evidence say WHY the
                # gate failed instead of just THAT it failed.
                $result.FreshnessGateProbe.CaseStatus = if ($null -ne $gateReport.PSObject.Properties['CaseStatus']) { $gateReport.CaseStatus } else { $null }
                $result.FreshnessGateProbe.GateStatus = if ($null -ne $gateReport.PSObject.Properties['Status']) { $gateReport.Status } else { $null }
                $result.FreshnessGateProbe.GateErrorCode = if ($null -ne $gateReport.PSObject.Properties['ErrorCode']) { $gateReport.ErrorCode } else { $null }
                $result.FreshnessGateProbe.Detail = "Invoked as $($result.RanAsIdentity); exit=$gateExitCode."
            }
            catch {
                $result.FreshnessGateProbe.Detail = "Output was not valid JSON: $gateOutput"
            }
        }
    }

    $result.OverallSucceeded = ($result.DbReadProbe.Succeeded -and $result.DbNoWriteProbe.WriteDenied -and $result.FreshnessGateProbe.Invoked)
}
catch {
    $result.OverallSucceeded = $false
    $result.UnhandledError = $_.Exception.Message
}
finally {
    $json = $result | ConvertTo-Json -Depth 10
    try {
        $resultDirectory = Split-Path $ResultPath -Parent
        if (-not [System.IO.Directory]::Exists($resultDirectory)) { [System.IO.Directory]::CreateDirectory($resultDirectory) | Out-Null }
        [System.IO.File]::WriteAllText($ResultPath, $json, [System.Text.UTF8Encoding]::new($false))
    }
    catch {
        # Cannot write the result file (e.g. the orchestrator did not grant
        # write access as expected) -- still print to stdout so WinSW's
        # own captured service log carries the evidence.
        Write-Output $json
    }
}

# Explicit final exit code reflecting THIS probe's own result -- not an
# accidental carry-over of $LASTEXITCODE from the last subprocess call
# (the freshness gate legitimately exits 2 for a normal "not ready" test
# case, which must not be misread as this probe having failed).
exit $(if ($result.OverallSucceeded) { 0 } else { 1 })
