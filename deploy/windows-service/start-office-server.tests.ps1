#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'start-office-server.ps1')

$script:checks = 0
function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "FAIL: $Message" }
    $script:checks++
}
function Reset-Fixture {
    $script:events = [Collections.Generic.List[string]]::new()
    $script:services = @{}
    $script:responses = [Collections.Generic.Queue[object]]::new()
    $script:responses.Enqueue(@{ status = 'ok' })
    $script:responses.Enqueue(@{ status = 'ok' })
    foreach ($name in @('postgresql-x64-17', 'Tailscale', 'hasarbotu-api', 'hasarbotu-lan-https', 'hasarbotu-file-agent', 'hasarbotu-folder-discovery')) {
        $service = [pscustomobject]@{ Name = $name; Status = 'Stopped'; FailStart = $false; Race = $false }
        $service | Add-Member ScriptMethod Start {
            $script:events.Add("start:$($this.Name)")
            if ($this.Race) { $this.Status = 'Running'; throw 'Automatic start race' }
            if ($this.FailStart) { throw 'Service logon failed' }
            $this.Status = 'StartPending'
        }
        $service | Add-Member ScriptMethod WaitForStatus { param($status, $timeout) $this.Status = [string]$status }
        $service | Add-Member ScriptMethod Refresh {}
        $script:services[$name] = $service
    }
}
# These overrides keep all service and network operations inside the fixture.
function Get-Service { param([string[]]$Name, $ErrorAction) foreach ($item in $Name) { $script:services[$item] } }
function Invoke-RestMethod {
    param($Uri, $TimeoutSec, $ErrorAction)
    $script:events.Add("http:$Uri")
    $response = $script:responses.Dequeue()
    if ($response -is [Exception]) { throw $response }
    return $response
}
function Start-Sleep { param($Milliseconds) $script:events.Add('wait') }

Reset-Fixture
$result = Start-HasarBotuOfficeServer
Assert-True ($result.status -eq 'PASS' -and $result.services.Count -eq 6) 'all six services are verified'
Assert-True (($script:events -join '|') -eq 'start:postgresql-x64-17|start:Tailscale|start:hasarbotu-api|http:http://127.0.0.1:3100/health|start:hasarbotu-lan-https|start:hasarbotu-file-agent|start:hasarbotu-folder-discovery|http:https://desktop-efn2g33.tail276cda.ts.net/health') 'database and API readiness precede workers; HTTPS is checked'
$script:events.Clear()
$script:responses.Enqueue(@{ status = 'ok' }); $script:responses.Enqueue(@{ status = 'ok' })
[void](Start-HasarBotuOfficeServer)
Assert-True (@($script:events | Where-Object { $_ -like 'start:*' }).Count -eq 0) 'already-running services are not started again'

Reset-Fixture
$script:services['hasarbotu-api'].Race = $true
Assert-True ((Start-HasarBotuOfficeServer).status -eq 'PASS') 'an observed automatic-start race succeeds'

Reset-Fixture
$script:services['hasarbotu-api'].FailStart = $true
$failed = $false
try { [void](Start-HasarBotuOfficeServer) } catch { $failed = $_.Exception.Message -match 'Service logon failed' }
Assert-True $failed 'a real service start error is preserved'
Assert-True (-not $script:events.Contains('start:hasarbotu-file-agent')) 'workers stay untouched after an API startup failure'

Reset-Fixture
$script:responses.Clear()
$script:responses.Enqueue([InvalidOperationException]::new('Connection refused'))
$script:responses.Enqueue(@{ status = 'degraded' })
$script:responses.Enqueue(@{ status = 'ok' })
Wait-HasarBotuHttpReady -Uri 'http://fixture/health'
Assert-True (@($script:events | Where-Object { $_ -like 'http:*' }).Count -eq 3) 'startup waits for an actual healthy HTTP response'
$script:responses.Enqueue(@{ status = 'degraded' })
$failed = $false
try { Wait-HasarBotuHttpReady -Uri 'http://fixture/health' -TimeoutSeconds 0 } catch { $failed = $_.Exception -is [TimeoutException] }
Assert-True $failed 'degraded health fails within the bounded timeout'

Reset-Fixture
$script:services['hasarbotu-api'].Status = 'StartPending'
[void](Start-HasarBotuOfficeServer)
Assert-True (-not $script:events.Contains('start:hasarbotu-api')) 'a pending service is awaited without a duplicate start'

$commandLine = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'start-office-server.cmd') | Where-Object { $_ -match ' -Command ' }
$command = [regex]::Match($commandLine, ' -Command "(.*)"$')
Assert-True $command.Success 'the desktop command contains a valid PowerShell launch expression'
$script:launch = $null
function Start-Process {
    param($FilePath, $ArgumentList, $Verb, $WindowStyle, $ErrorAction)
    $script:launch = [pscustomobject]$PSBoundParameters
}
& ([scriptblock]::Create($command.Groups[1].Value))
Assert-True ($script:launch.Verb -eq 'RunAs' -and $script:launch.WindowStyle -eq 'Normal') 'desktop activation requests administrator elevation and a visible result window'
Assert-True ($script:launch.ArgumentList -eq '-NoProfile -ExecutionPolicy Bypass -File C:\ProgramData\HasarBotu\office-management\server-start\start-office-server.ps1') 'the elevated process runs the exact installed protected script'
Write-Output "$script:checks/$script:checks PASS"
