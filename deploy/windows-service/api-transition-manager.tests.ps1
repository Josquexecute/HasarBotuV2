#Requires -Version 5.1
#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'api-transition-secrets.psm1') -Force
$manager = Import-Module (Join-Path $PSScriptRoot 'api-transition-manager.psm1') -Force -PassThru -DisableNameChecking
$checks = 0
function Assert([bool]$Value) { if (-not $Value) { throw ('MANAGER_REGRESSION_FAILED_CHECK_'+($script:checks+1)+'_LINE_'+(Get-PSCallStack)[1].ScriptLineNumber) }; $script:checks++ }
$root = Join-Path $env:TEMP ('hb-manager-test-'+[Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($root) | Out-Null
try {
    $xml = Join-Path $root 'api.xml'
    $url = 'postgres://synthetic:p%40ss%25word@127.0.0.1/hb_test'
    Assert ($url -match '%[^%]+%') # Reproduce the old false-positive guard.
    [IO.File]::WriteAllText($xml,'<service><env name="DATABASE_URL" value="%DATABASE_URL%"/></service>')
    $original = $env:DATABASE_URL
    $env:DATABASE_URL = 'postgres://stale:process@invalid.invalid/wrong_test'
    $values = Get-ApiResolvedEnvironment -Document (Read-ApiServiceXml $xml) -XmlPath $xml -MachineEnvironment @{DATABASE_URL=$url}
    Assert ($values.DATABASE_URL -ceq $url)
    $encoded = 'postgres://synthetic:p%AB%CD@127.0.0.1/hb_test'
    [IO.File]::WriteAllText($xml,'<service><env name="DATABASE_URL" value="'+$encoded+'"/></service>')
    $values = Get-ApiResolvedEnvironment -Document (Read-ApiServiceXml $xml) -XmlPath $xml -MachineEnvironment @{AB='must-not-substitute'}
    Assert ($values.DATABASE_URL -ceq $encoded)
    [IO.File]::WriteAllText($xml,'<service><env name="DATABASE_URL" value="'+$url+'"/></service>')
    $values = Get-ApiResolvedEnvironment -Document (Read-ApiServiceXml $xml) -XmlPath $xml -MachineEnvironment @{}
    Assert ($values.DATABASE_URL -ceq $url)
    [IO.File]::WriteAllText($xml,'<service/>')
    $values = Get-ApiResolvedEnvironment -Document (Read-ApiServiceXml $xml) -XmlPath $xml -MachineEnvironment @{DATABASE_URL=$url}
    Assert ($values.DATABASE_URL -ceq $url)
    [IO.File]::WriteAllText($xml,'<service><env name="DATABASE_URL" value="%MISSING_DB_VALUE%"/></service>')
    $failed = $false
    try { Get-ApiResolvedEnvironment -Document (Read-ApiServiceXml $xml) -XmlPath $xml -MachineEnvironment @{} | Out-Null } catch { $failed = $_.Exception.Message -eq 'SERVICE_DATABASE_URL_UNRESOLVED' }
    Assert $failed
    $env:DATABASE_URL = $original
    $failed = $false
    try { Assert-TransitionApproval '' 'ONAY exact nonce' } catch { $failed = $_.Exception.Data['SafeCode'] -eq 'EXPLICIT_APPROVAL_REQUIRED' }
    Assert $failed
    $failed = $false
    try { Assert-TransitionApproval 'onay exact nonce' 'ONAY exact nonce' } catch { $failed = $true }
    Assert $failed
    Assert-TransitionApproval 'ONAY exact nonce' 'ONAY exact nonce'; $checks++
    Assert-TransitionPath $xml; $checks++
    $node = Join-Path (Split-Path (Split-Path $PSScriptRoot)) '.local\tools\node-v24.22.0-win-x64\node.exe'
    $probe = Join-Path $root 'argv.mjs'
    [IO.File]::WriteAllText($probe,'console.log(JSON.stringify({status:"PASS",args:process.argv.slice(2)}))')
    $arguments = @('space path','trailing\','embedded"quote','%40%25','backslash\"quote')
    $result = Invoke-TransitionProcess $node (@($probe)+$arguments)
    Assert (($result.args | ConvertTo-Json -Compress) -ceq ($arguments | ConvertTo-Json -Compress))
    $inputText='{"username":"synthetic-restore","password":"gizli-şifre%40"}'
    [IO.File]::WriteAllText($probe,'let text="";process.stdin.setEncoding("utf8");for await(const chunk of process.stdin)text+=chunk;const {createHash}=await import("node:crypto");console.log(JSON.stringify({status:"PASS",hash:createHash("sha256").update(text).digest("hex"),argvClean:!process.argv.join().includes("synthetic-restore"),envClean:!Object.values(process.env).some(value=>value.includes("synthetic-restore"))}))')
    $result=Invoke-TransitionProcess -Executable $node -Arguments @($probe) -InputText $inputText
    $sha=[Security.Cryptography.SHA256]::Create()
    try { $expected=[BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($inputText))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
    Assert ($result.hash -ceq $expected -and $result.argvClean -and $result.envClean)
    [IO.File]::WriteAllText($probe,'console.error("synthetic-secret-must-not-leak");process.exit(1)')
    $captured = @()
    try { $captured = @(Invoke-TransitionProcess $node @($probe) *>&1) } catch { Assert ($_.Exception.Message -eq 'CHILD_RESULT_INVALID') }
    Assert (($captured -join '') -notmatch 'synthetic-secret')
    [IO.File]::WriteAllText($probe,'console.log(JSON.stringify({status:"FAIL",stage:"candidate_configuration",code:"CANDIDATE_CONFIGURATION_INVALID",message:"synthetic-secret-must-not-leak"}));process.exit(1)')
    $failed = $false
    try { Invoke-TransitionProcess $node @($probe) | Out-Null } catch {
        $safe = Get-TransitionDiagnostic $_ 'fallback' 'FALLBACK'
        $failed = $safe.stage -eq 'candidate_configuration' -and $safe.code -eq 'CANDIDATE_CONFIGURATION_INVALID'
        Assert (($safe | ConvertTo-Json -Compress) -notmatch 'synthetic-secret')
    }
    Assert $failed
    [IO.File]::WriteAllText($probe,'console.log(JSON.stringify({status:"FAIL",stage:"candidate_configuration",code:"SYNTHETIC_UPPERCASE_SECRET"}));process.exit(1)')
    $failed = $false
    try { Invoke-TransitionProcess $node @($probe) | Out-Null } catch { $failed = $_.Exception.Data['SafeCode'] -eq 'CHILD_FAILED' }
    Assert $failed
    # Real runtime/XML rollback on disk, with SCM/HTTP isolated to fakes.
    $live = Join-Path $root 'live'
    [IO.Directory]::CreateDirectory((Join-Path $live 'dist')) | Out-Null
    [IO.File]::WriteAllText((Join-Path $live 'dist\index.js'),'old-api')
    [IO.File]::WriteAllText((Join-Path $live 'package.json'),'{"name":"fixture"}')
    $fileAcl = Get-Acl -LiteralPath (Join-Path $live 'dist\index.js')
    $fileAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-19'),'ReadAndExecute','Allow'))
    Set-Acl -LiteralPath (Join-Path $live 'dist\index.js') -AclObject $fileAcl
    $originalRuntimeSddl = (Get-Acl -LiteralPath (Join-Path $live 'dist\index.js')).Sddl
    [IO.File]::WriteAllText((Join-Path $live 'claim-file.keep'),'preserved-claim-file')
    [IO.File]::WriteAllText($xml,'<service><env name="DATABASE_URL" value="'+$url+'"/></service>')
    $backupRoot = Join-Path $root 'rollback-data'
    [IO.Directory]::CreateDirectory($backupRoot) | Out-Null
    function Get-Service { [pscustomobject]@{Status='Stopped'} }
    & (Join-Path $PSScriptRoot 'backup-api-transition.ps1') -ApiDirectory $live -WinSwXml $xml -BackupDirectory (Join-Path $backupRoot 'api') 1>$null
    $receipt = @{backup=$backupRoot;runtimeHash=(Get-TransitionTreeHash $live);xmlHash=(Get-TransitionHash $xml);xmlSddl=(Get-Acl -LiteralPath $xml).Sddl;backupManifestHash=(Get-TransitionHash (Join-Path $backupRoot 'api\backup-manifest.json'));status='APPROVED'}
    [IO.File]::WriteAllText((Join-Path $live 'dist\index.js'),'new-api')
    [IO.File]::WriteAllText($xml,'<service/>')
    & $manager {
        function script:Stop-Service {}
        function script:Start-Service {}
        function script:Get-Service { $value=[pscustomobject]@{}; $value | Add-Member ScriptMethod WaitForStatus {}; return $value }
        function script:Wait-TransitionHealth {}
    }
    Restore-TransitionRuntime @{Api=$live;Xml=$xml} $receipt
    Assert ([IO.File]::ReadAllText((Join-Path $live 'dist\index.js')) -ceq 'old-api')
    Assert ([IO.File]::ReadAllText((Join-Path $live 'claim-file.keep')) -ceq 'preserved-claim-file')
    Assert ((Get-TransitionHash $xml) -eq $receipt.xmlHash)
    Assert ((Get-Acl -LiteralPath (Join-Path $live 'dist\index.js')).Sddl -ceq $originalRuntimeSddl)
    Assert (Test-Path -LiteralPath (Join-Path $backupRoot 'api\runtime\dist\index.js'))
    Assert ($receipt.status -eq 'ROLLED_BACK_PILOT_PENDING')
    [IO.File]::WriteAllText((Join-Path $backupRoot 'api\runtime\dist\index.js'),'corrupted')
    $failed = $false
    try { Restore-TransitionRuntime @{Api=$live;Xml=$xml} $receipt } catch { $failed = $_.Exception.Data['SafeCode'] -eq 'ROLLBACK_BACKUP_CORRUPT' }
    Assert $failed
    Assert ([IO.File]::ReadAllText((Join-Path $live 'dist\index.js')) -ceq 'old-api')
    # Orchestration faults use synthetic service/database boundaries only.
    # Real pg_dump/restore/migration tests live in api-transition-database.test.mjs.
    & $manager {
        $script:trace = [Collections.Generic.List[string]]::new()
        $script:fault = ''
        function script:Read-Host { param($Prompt,[switch]$AsSecureString)
            if ($AsSecureString) { return ConvertTo-SecureString 'desktop.apps.googleusercontent.com' -AsPlainText -Force }
            return 'ONAY 0.1.91 DESKTOP-EFN2G33 synthetic'
        }
        function script:Get-TransitionHash { return 'hash' }
        function script:Get-TransitionTreeHash { return 'tree' }
        function script:Invoke-TransitionPreflight { return @{xmlHash='hash';runtimeHash='tree';configHash='config';restoreStrategy=$script:strategy;restoreEvidenceSha256=$(if($script:strategy -eq 'isolated-cluster'){'verified-readiness-proof'}else{''})} }
        function script:Set-ApiDesktopOAuth {param($XmlPath) $script:trace.Add($(if($XmlPath -ceq $script:liveFixtureXml){'oauth'}else{'oauth-staged'})) }
        function script:Invoke-TransitionProcess { return [pscustomobject]@{status='PASS';desktopOAuthConfigured=$true;proxyAwareRateLimit=$true} }
        function script:Invoke-TransitionTool { param($Name,$ToolArguments,[switch]$TextResult)
            $script:trace.Add($Name)
            if ($script:fault -eq 'backup' -and $Name -eq 'backup-api-transition.ps1') { throw 'SYNTHETIC_BACKUP_FAILURE' }
            return [pscustomobject]@{Status='applied'}
        }
        function script:Invoke-TransitionDatabase { param($Context,$Action,$BackupDirectory)
            $script:trace.Add($Action)
            if ($script:fault -eq $Action) { throw 'SYNTHETIC_DB_FAILURE' }
            if ($Action -eq 'ValidateBackup' -and $script:strategy -eq 'isolated-cluster') { return [pscustomobject]@{status='PASS';restoreAcceptance='PASS';clusterStopped=($script:fault -ne 'ValidateBackupNoProof');evidenceSha256='new-exact-backup-proof'} }
            return [pscustomobject]@{status='PASS'}
        }
        function script:Stop-Service { $script:trace.Add('stop') }
        function script:Start-Service { $script:trace.Add('start') }
        function script:Get-Service { $service = [pscustomobject]@{}; $service | Add-Member ScriptMethod WaitForStatus {}; return $service }
        function script:Wait-TransitionHealth { $script:trace.Add('health'); if ($script:fault -eq 'health') { throw 'SYNTHETIC_HEALTH_FAILURE' } }
        function script:Restore-TransitionRuntime { param($Context,$Receipt) $script:trace.Add('rollback'); $Receipt.status='ROLLED_BACK_PILOT_PENDING' }
    }
    [IO.File]::WriteAllText($xml,'<service><env name="DATABASE_URL" value="'+$url+'"/></service>')
    $context = @{ Xml=$xml; Api=$root; Candidate=$root; Runtime=$root; Node=$node; ServiceNode=$node; Values=@{PORT='3100'}; ServiceSid='S-1-5-18' }
    & $manager {param($Path)$script:liveFixtureXml=$Path} $xml
    foreach($strategy in @('same-cluster','isolated-cluster')) {
    foreach ($fault in @('backup','ValidateBackup','Migrate','health','','ValidateBackupNoProof')) {
        if($strategy -eq 'same-cluster' -and $fault -eq 'ValidateBackupNoProof'){continue}
        $state = Join-Path $root ('state-'+[Guid]::NewGuid().ToString('N'))
        [IO.Directory]::CreateDirectory($state) | Out-Null
        $plan = @{ host=$env:COMPUTERNAME;createdUtc=[DateTime]::UtcNow.ToString('o');xmlHash='hash';runtimeHash='tree';configHash='config';api=$root;candidate=$root;runtime=$root;id='synthetic';restoreStrategy=$strategy;restoreEvidenceSha256=$(if($strategy -eq 'isolated-cluster'){'verified-readiness-proof'}else{''}) }
        & $manager { param($value,$mode) $script:fault=$value;$script:strategy=$mode; $script:trace.Clear() } $fault $strategy
        $caught = $false
        try { Invoke-TransitionApply $context $plan $state 1>$null 6>$null } catch { $caught=$true }
        $trace = @(& $manager { $script:trace.ToArray() })
        Assert ($trace -contains 'stop')
        if ($fault -eq 'backup') { Assert ($trace -notcontains 'Backup' -and $trace -notcontains 'deploy-service-artifacts.ps1' -and $trace -contains 'start' -and $caught) }
        elseif ($fault -eq 'ValidateBackup') { Assert ($trace -notcontains 'Migrate' -and $trace -contains 'start' -and $caught) }
        elseif ($fault -eq 'ValidateBackupNoProof') { Assert ($trace -notcontains 'Migrate' -and $trace -notcontains 'oauth' -and $trace -contains 'start' -and $caught) }
        elseif ($fault -eq 'Migrate') { Assert ($trace -notcontains 'deploy-service-artifacts.ps1' -and $trace -contains 'rollback' -and $caught) }
        elseif ($fault -eq 'health') { Assert ($trace -contains 'rollback' -and $caught) }
        else {
            Assert (-not $caught -and $trace -notcontains 'rollback')
            Assert (($trace.IndexOf('ValidateBackup') -lt $trace.IndexOf('Migrate')) -and ($trace.IndexOf('Verify') -lt $trace.IndexOf('deploy-service-artifacts.ps1')))
            $receipt = [IO.File]::ReadAllText((Join-Path $state 'active.json')) | ConvertFrom-Json
            Assert ($receipt.status -eq 'DEPLOYED_PILOT_PENDING' -and $receipt.gmail -eq 'PENDING')
            if($strategy -eq 'isolated-cluster'){Assert ($receipt.restoreStrategy -ceq $strategy -and $receipt.currentBackupRestoreEvidenceSha256 -ceq 'new-exact-backup-proof' -and $receipt.restoreEvidenceSha256 -ceq 'verified-readiness-proof')}
        }
    }
    }
    & $manager {
        $script:applyCalls = 0
        function script:Invoke-TransitionPreflight { return @{id='fresh';xmlHash='same';runtimeHash='same'} }
        function script:Invoke-TransitionApply { $script:applyCalls++ }
    }
    $firstState = Join-Path $root 'first-run'
    [IO.Directory]::CreateDirectory($firstState) | Out-Null
    Invoke-TransitionSession @{} $firstState 6>$null
    Assert ((& $manager { $script:applyCalls }) -eq 0)
    Assert (Test-Path -LiteralPath (Join-Path $firstState 'preflight.json'))
    Invoke-TransitionSession @{} $firstState 6>$null
    Assert ((& $manager { $script:applyCalls }) -eq 0)
    Invoke-TransitionSession @{} $firstState -Apply 6>$null
    Assert ((& $manager { $script:applyCalls }) -eq 1)
    $newState = Join-Path $root 'explicit-first-run'
    [IO.Directory]::CreateDirectory($newState) | Out-Null
    Invoke-TransitionSession @{} $newState -Apply 6>$null
    Assert ((& $manager { $script:applyCalls }) -eq 1)
    Write-Output "MANAGER_TESTS_PASS_$checks"
} finally {
    if (Get-Variable original -ErrorAction SilentlyContinue) { $env:DATABASE_URL = $original }
    $resolved = [IO.Path]::GetFullPath($root)
    if (-not $resolved.StartsWith([IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')+'\hb-manager-test-',[StringComparison]::OrdinalIgnoreCase)) { throw 'UNSAFE_TEST_CLEANUP' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
