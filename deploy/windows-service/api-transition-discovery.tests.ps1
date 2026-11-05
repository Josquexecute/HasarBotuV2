#Requires -Version 5.1
#Requires -RunAsAdministrator
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'api-transition-secrets.psm1') -Force
$manager = Import-Module (Join-Path $PSScriptRoot 'api-transition-manager.psm1') -Force -PassThru -DisableNameChecking
$checks = 0
function Assert([bool]$Value) { if (-not $Value) { throw ('DISCOVERY_REGRESSION_FAILED_CHECK_'+($script:checks+1)+'_LINE_'+(Get-PSCallStack)[1].ScriptLineNumber) }; $script:checks++ }
$root = Join-Path $env:TEMP ('hb-discovery-test-'+[Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($root) | Out-Null
$root = [IO.Path]::GetFullPath($root)
try {
    # Exercise real context discovery and real XML/files. Only SCM, host identity
    # and the machine registry boundary are synthetic. No production service I/O.
    $wrapper = Join-Path $root 'ProgramData\HasarBotu\runtime-20261011\wrappers\api\hasarbotu-api.exe'
    $xml = [IO.Path]::ChangeExtension($wrapper,'.xml')
    $api = Join-Path $root 'ProgramData\HasarBotu\runtime-20261011\services\api'
    $node = Join-Path $root 'Program Files\nodejs\node.exe'
    $runtime = Join-Path $root 'candidate-runtime'
    $candidate = Join-Path $root 'candidate\services\api'
    $state = Join-Path $root 'state'
    foreach ($directory in @((Split-Path $wrapper),(Split-Path $node),(Join-Path $api 'dist'),$runtime,$candidate,$state)) { [IO.Directory]::CreateDirectory($directory) | Out-Null }
    foreach ($file in @($wrapper,$node,(Join-Path $api 'dist\index.js'))) { [IO.File]::WriteAllText($file,'synthetic-file') }
    $environment = @{
        DATABASE_URL='postgres://synthetic:p%40ss%25word@127.0.0.1/hb_test';
        GOOGLE_CLIENT_ID='fixture.apps.googleusercontent.com'; GOOGLE_CLIENT_SECRET='SYNTHETIC_SECRET_DO_NOT_PRINT';
        GOOGLE_REDIRECT_URI='https://fixture.invalid/callback'; GOOGLE_TOKEN_ENCRYPTION_KEY='SYNTHETIC_TOKEN_DO_NOT_PRINT';
        NODE_PATH_FIXTURE=$node; PATH=(Split-Path $node); COMPUTERNAME='fixture'
    }
    $service = [pscustomobject]@{PathName=('"'+$wrapper+'"');State='Running';StartName='LocalSystem';ProcessId=1234;ExecutablePath=$wrapper}
    & $manager {
        param($Service,$Environment)
        $script:fixtureService=$Service; $script:fixtureEnvironment=$Environment
        $script:originalAssert=${function:Assert-Transition}
        function script:Assert-Transition([bool]$Condition,[string]$Code) {
            if ($Code -in @('OFFICE_SERVER_REQUIRED','ISOLATED_CANDIDATE_PATH_REQUIRED')) { return }
            & $script:originalAssert $Condition $Code
        }
        function script:Get-CimInstance { param($ClassName,$Filter) return $script:fixtureService }
        function script:Get-ApiResolvedEnvironment { param($Document,$XmlPath)
            return api-transition-secrets\Get-ApiResolvedEnvironment -Document $Document -XmlPath $XmlPath -MachineEnvironment $script:fixtureEnvironment
        }
    } $service $environment
    # Render the actual installed-service template, including <name> and comments.
    $validXml = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'hasarbotu-api.winsw.xml')).Replace('__NODE_EXE__','%NODE_PATH_FIXTURE%').Replace('__APP_DIR__','%BASE%\..\..\services\api').Replace('</service>','<env name="DATABASE_URL" value="%DATABASE_URL%"/></service>')
    $explicitXml=''
    function Context { return Get-TransitionContext $runtime $candidate $state $explicitXml 6>$null }
    function ExpectFailure([string]$Stage,[string]$Code) {
        $caught=$false
        try { Context | Out-Null } catch {
            $safe=Get-TransitionDiagnostic $_ 'fallback' 'FALLBACK'
            Assert ($safe.stage -eq $Stage -and $safe.code -eq $Code)
            Assert (($safe | ConvertTo-Json -Compress) -notmatch 'SYNTHETIC_|postgres|fixture\.invalid')
            $caught=$true
        }
        Assert $caught
    }
    [IO.File]::WriteAllText($xml,$validXml)
    $beforeXml=Get-TransitionHash $xml; $beforeApi=Get-TransitionTreeHash $api
    $context=Context
    Assert ($context.Api -ieq $api -and $context.ServiceNode -ieq $node -and $context.ServiceSid -eq 'S-1-5-18')
    Assert ($context.Values.DATABASE_URL -ceq $environment.DATABASE_URL)
    Assert ($context.Values.HOST -eq '127.0.0.1' -and $context.Values.PORT -eq '3100')
    Assert ((Get-TransitionHash $xml) -ceq $beforeXml -and (Get-TransitionTreeHash $api) -ceq $beforeApi)
    $explicitXml=$xml
    Assert ((Context).Xml -ieq $xml)
    # A valid XML beside the API is still not the running wrapper's config.
    $otherXml=Join-Path $api 'hasarbotu-api.xml'
    [IO.File]::WriteAllText($otherXml,$validXml)
    $explicitXml=$otherXml
    ExpectFailure 'service_xml' 'SERVICE_XML_WRAPPER_PATH_MISMATCH'
    $explicitXml='relative.xml'
    ExpectFailure 'service_xml' 'SERVICE_XML_ABSOLUTE_PATH_REQUIRED'
    $explicitXml=''
    [IO.File]::Move($xml,$xml+'.held')
    ExpectFailure 'service_xml' 'SERVICE_XML_NOT_FOUND'
    [IO.Directory]::CreateDirectory($xml) | Out-Null
    ExpectFailure 'service_xml' 'SERVICE_XML_FILE_REQUIRED'
    [IO.Directory]::Delete($xml)
    [IO.File]::Move($xml+'.held',$xml)
    # Exercise SCM quoting with a wrapper path containing spaces as well.
    $spacedWrapper=Join-Path $root 'runtime with spaces\wrappers\api\hasarbotu-api.exe'
    [IO.Directory]::CreateDirectory((Split-Path $spacedWrapper)) | Out-Null
    [IO.File]::Copy($wrapper,$spacedWrapper)
    $spacedXml=[IO.Path]::ChangeExtension($spacedWrapper,'.xml')
    [IO.File]::WriteAllText($spacedXml,$validXml.Replace('%BASE%\..\..\services\api',$api))
    $service.PathName='"'+$spacedWrapper+'"'; $service.ExecutablePath=$spacedWrapper
    Assert ((Context).Xml -ieq $spacedXml)
    # The old whitespace split truncates this supported, unquoted SCM path.
    $service.PathName=$spacedWrapper
    Assert (($service.PathName -split '\s+')[0] -ine $spacedWrapper)
    Assert ((Context).Xml -ieq $spacedXml)
    $service.ExecutablePath=$wrapper
    $service.PathName=$wrapper
    Assert ((Context).Xml -ieq $xml)
    $service.PathName='"'+$wrapper+'" --config unexpected.xml'
    ExpectFailure 'service_command' 'SERVICE_COMMAND_UNSUPPORTED'
    foreach ($command in @('hasarbotu-api.exe','"relative\hasarbotu-api.exe"',('"'+$wrapper+'" run'),('"'+$wrapper+'"' + "`n" + 'unexpected'))) {
        $service.PathName=$command
        ExpectFailure 'service_command' 'SERVICE_COMMAND_UNSUPPORTED'
    }
    $service.PathName='"'+$wrapper+'"'
    $service.ExecutablePath=$node
    ExpectFailure 'service_wrapper_process' 'SERVICE_WRAPPER_PROCESS_MISMATCH'
    $service.ExecutablePath=$wrapper
    $service.State='Stopped'; ExpectFailure 'service_query' 'RUNNING_API_SERVICE_REQUIRED'; $service.State='Running'
    [IO.File]::WriteAllText($xml,'<settings><name>service</name></settings>')
    ExpectFailure 'service_xml' 'SERVICE_XML_REQUIRED'
    [IO.File]::WriteAllText($xml,$validXml.Replace('hasarbotu-api</id>','wrong-service</id>'))
    ExpectFailure 'service_xml' 'SERVICE_ID_MISMATCH'
    [IO.File]::WriteAllText($xml,'<service><bad>')
    ExpectFailure 'service_xml' 'SERVICE_XML_INVALID_OR_UNREADABLE'
    [IO.File]::WriteAllText($xml,$validXml.Replace('<id>hasarbotu-api</id>',''))
    ExpectFailure 'service_xml' 'SERVICE_XML_FIELD_REQUIRED_OR_DUPLICATE'
    [IO.File]::WriteAllText($xml,$validXml.Replace('%BASE%\..\..\services\api','%UNKNOWN_FIXTURE%\api'))
    ExpectFailure 'service_working_directory' 'SERVICE_PATH_ENV_UNRESOLVED'
    [IO.File]::WriteAllText($xml,$validXml.Replace('%NODE_PATH_FIXTURE%','%BASE%\missing.exe'))
    ExpectFailure 'service_node_path' 'SERVICE_NODE_NOT_FOUND'
    [IO.File]::WriteAllText($xml,$validXml.Replace('%NODE_PATH_FIXTURE%','node'))
    Assert ((Context).ServiceNode -ieq $node)
    [IO.File]::WriteAllText($xml,$validXml.Replace('dist\index.js','.\dist\index.js'))
    Assert ((Context).Api -ieq $api)
    [IO.File]::WriteAllText($xml,$validXml.Replace('%BASE%\..\..\services\api',$api))
    Assert ((Context).Api -ieq $api)
    [IO.File]::WriteAllText($xml,$validXml.Replace('dist\index.js','dist\other.js'))
    ExpectFailure 'service_entrypoint' 'SERVICE_ENTRYPOINT_UNSUPPORTED'
    [IO.File]::WriteAllText($xml,$validXml.Replace('</service>','<env name="DATABASE_URL" value="duplicate"/></service>'))
    ExpectFailure 'service_environment' 'DUPLICATE_OR_EMPTY_ENV_NAME'
    [IO.File]::WriteAllText($xml,$validXml.Replace('%DATABASE_URL%','%UNKNOWN_DATABASE%'))
    ExpectFailure 'service_environment' 'SERVICE_DATABASE_URL_UNRESOLVED'
    [IO.File]::WriteAllText($xml,$validXml)
    $environment.HOST='0.0.0.0'; ExpectFailure 'service_configuration' 'IPV4_LOOPBACK_BIND_REQUIRED'; $environment.Remove('HOST')
    $environment.PORT='999999999999999999999'
    ExpectFailure 'service_configuration' 'EXPLICIT_API_PORT_REQUIRED'; $environment.Remove('PORT')
    $environment.Remove('GOOGLE_TOKEN_ENCRYPTION_KEY')
    ExpectFailure 'service_configuration' 'EXISTING_GOOGLE_TOKEN_KEY_REQUIRED'
    # Unknown exceptions may carry secrets. Only fixed diagnostic fields survive.
    $output=@()
    try { $output=@(Invoke-TransitionCheck 'synthetic_stage' 'SYNTHETIC_FAILURE' { throw 'SYNTHETIC_SECRET_DO_NOT_PRINT' } 6>&1) } catch {
        $safe=Get-TransitionDiagnostic $_ 'fallback' 'FALLBACK'
        Assert ($safe.stage -eq 'synthetic_stage' -and $safe.code -eq 'SYNTHETIC_FAILURE' -and $safe.line -gt 0)
        Assert (($safe | ConvertTo-Json -Compress) -notmatch 'SECRET_DO_NOT_PRINT')
    }
    Assert (($output -join '') -notmatch 'SECRET_DO_NOT_PRINT')
    # Real OS-derived variables were missing from GetEnvironmentVariables(Machine).
    $doc=Read-ApiServiceXml $xml
    $doc.SelectSingleNode('/service/env[@name="DATABASE_URL"]').SetAttribute('value','postgres://synthetic@127.0.0.1/hb_test')
    $actual=api-transition-secrets\Get-ApiResolvedEnvironment -Document $doc -XmlPath $xml
    Assert ($actual.ProgramData -ceq [Environment]::GetFolderPath('CommonApplicationData'))
    Assert ($actual.SystemRoot -ceq [Environment]::GetFolderPath('Windows'))
    Assert ($actual.COMPUTERNAME -ceq [Environment]::MachineName)
    $programDataPath = & $manager { param($Values) Resolve-TransitionPath '%ProgramData%\HasarBotu' $Values 'C:\unrelated' } $actual
    Assert ($programDataPath -ceq (Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'HasarBotu'))
    $programFilesPath = & $manager { param($Values) Resolve-TransitionPath '%ProgramFiles(x86)%\fixture' $Values 'C:\unrelated' } $actual
    Assert ($programFilesPath -ceq (Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'fixture'))
    # Exercise the real health/ownership consumer; only OS/HTTP boundaries fake.
    & $manager {
        param($Node)
        $script:fixtureNode=$Node; $script:healthFault=''
        function script:Get-CimInstance { param($ClassName,$Filter)
            if ($ClassName -eq 'Win32_Service' -or $Filter -eq ('ProcessId='+$script:fixtureService.ProcessId)) { return $script:fixtureService }
            return [pscustomobject]@{ProcessId=5678;ParentProcessId=$(if ($script:healthFault -eq 'owner') {0} else {$script:fixtureService.ProcessId});ExecutablePath=$(if ($script:healthFault -eq 'node') {'C:\wrong\node.exe'} else {$script:fixtureNode})}
        }
        function script:Get-NetTCPConnection { param($LocalAddress,$LocalPort,$State,$ErrorAction)
            if ($script:healthFault -ne 'listener') { return [pscustomobject]@{OwningProcess=5678} }
        }
        function script:Invoke-RestMethod { param($Uri,$TimeoutSec,[switch]$UseBasicParsing)
            if ($Uri.EndsWith('/health')) { return [pscustomobject]@{status='ok';service='hasarbotu-api'} }
            return [pscustomobject]@{enabled=($script:healthFault -ne 'oauth');desktopEnabled=$false;proxyAwareRateLimit=$false}
        }
    } $node
    & $manager { param($Context) Test-TransitionHealth $Context $false } $context
    $checks++
    foreach ($case in @(@('node','API_LISTENER_NODE_MISMATCH'),@('owner','API_LISTENER_NOT_OWNED_BY_SERVICE'),@('listener','ONE_API_LISTENER_REQUIRED'),@('oauth','API_HEALTH_OR_WEB_OAUTH_FAILED'))) {
        & $manager { param($Fault) $script:healthFault=$Fault } $case[0]
        $failed=$false
        try { & $manager { param($Context) Test-TransitionHealth $Context $false } $context } catch { $failed=$_.Exception.Data['SafeCode'] -eq $case[1] }
        Assert $failed
    }
    & $manager { $script:healthFault='' }
    # Run the complete preflight orchestration over the real fixture files.
    # External package/Node/PostgreSQL/HTTP checks are fakes in this test only;
    # real package and disposable database suites validate those boundaries.
    [IO.Directory]::CreateDirectory((Join-Path $runtime 'node')) | Out-Null
    [IO.File]::WriteAllText((Join-Path $runtime 'node\node.exe'),'synthetic-node')
    [IO.File]::WriteAllText((Join-Path $runtime 'dependency-closure.json'),'{"ExtraDataReferences":[]}')
    [IO.File]::WriteAllText((Join-Path $root 'pg_dump.exe'),'synthetic-dump')
    [IO.File]::WriteAllText((Join-Path $root 'pg_restore.exe'),'synthetic-restore')
    $context.Dump=Join-Path $root 'pg_dump.exe'
    $environment.GOOGLE_TOKEN_ENCRYPTION_KEY='SYNTHETIC_TOKEN_DO_NOT_PRINT'
    & $manager {
        $script:originalHash=${function:Get-TransitionHash}
        $script:preflightTrace=[Collections.Generic.List[string]]::new()
        $script:driftPath=''
        $script:fault=''
        function script:Get-TransitionHash($Path) {
            if ((Split-Path $Path -Leaf) -eq 'package-manifest.json') { return 'd6806fd817d08de80bfe8d406ce38040793026e9faf20e02b39cf2e29c659a47' }
            return & $script:originalHash $Path
        }
        function script:Invoke-TransitionTool($Name,$ToolArguments,[switch]$TextResult) {
            $script:preflightTrace.Add($Name)
            if ($ToolArguments -contains '-Apply') { throw 'PREFLIGHT_UNEXPECTED_WRITE' }
            if ($Name -eq 'verify-api-transition-package.ps1') { return 'synthetic-verifier' }
            if ($script:fault -eq 'candidate' -and $Name -eq 'deploy-service-artifacts.ps1') { return [pscustomobject]@{Status='failed'} }
            if ($script:fault -eq 'references' -and $Name -eq 'provision-extra-data-references.ps1' -and $ToolArguments -contains $script:fixtureApi) { return [pscustomobject]@{Status='would_apply'} }
            return [pscustomobject]@{Status='already_up_to_date'}
        }
        function script:Invoke-TransitionProcess($Executable,$Arguments,$EnvironmentValues,[switch]$TextResult) {
            if ($Arguments[0] -eq '--version') {
                if ($Executable -match 'pg_') { if ($script:fault -eq 'pg18') { return 'synthetic PostgreSQL 18.0' }; return 'synthetic PostgreSQL 17.0' }
                if ($script:fault -eq 'node22') { return 'v22.23.2' }
                return 'v24.22.0'
            }
            if ($Arguments[0] -eq '-p') { if ($script:fault -eq 'arm64') { return 'win32/arm64' }; return 'win32/x64' }
            if ($script:driftPath) { [IO.File]::WriteAllText($script:driftPath,'unexpected-drift') }
            if ($script:fault -eq 'probe') { return [pscustomobject]@{status='FAIL'} }
            return [pscustomobject]@{status='PASS'}
        }
        function script:Invoke-TransitionDatabase($Context,$Action) {
            if ($Action -ne 'Check') { throw 'PREFLIGHT_UNEXPECTED_DATABASE_WRITE' }
            if ($Context.ContainsKey('RestoreEvidence') -and $Context.RestoreEvidence) {
                return [pscustomobject]@{status='PASS';serverMajor=17;appliedCount=74;restoreStrategy='isolated-cluster';
                    permissions=[pscustomobject]@{databaseOwnerDirect=$false;databaseOwnerEffective=$false;apiCreatedb=$false;apiSuperuser=$false;migrationCapable=$true;backupReadPrivileges=$true};
                    restoreAdmin=[pscustomobject]@{supplied=$false;separateRole=$false;canCreateDatabase=$false;sameServerMajor=$false};independentRestore=[pscustomobject]@{evidenceValid=($script:fault -ne 'evidence');freshBackupRehearsalRequired=($script:fault -ne 'futurebackup');evidenceSha256=$(if($script:fault -eq 'evidencepin'){'wrong'}else{$Context.RestoreEvidence.sha256})}}
            }
            return [pscustomobject]@{status='PASS';serverMajor=$(if ($script:fault -eq 'db18') {18} else {17});appliedCount=74;
                permissions=[pscustomobject]@{databaseOwnerDirect=$false;databaseOwnerEffective=$false;apiCreatedb=$false;apiSuperuser=$false;migrationCapable=($script:fault -ne 'role');backupReadPrivileges=($script:fault -ne 'backupread')};
                restoreStrategy='same-cluster';restoreAdmin=[pscustomobject]@{supplied=($script:fault -ne 'noadmin');separateRole=($script:fault -ne 'sameadmin');canCreateDatabase=($script:fault -ne 'nocreate');sameServerMajor=($script:fault -ne 'adminversion')}}
        }
        function script:Test-TransitionHealth { if ($script:fault -eq 'health') { Assert-Transition $false 'API_HEALTH_OR_WEB_OAUTH_FAILED' } }
        function script:Stop-Service { throw 'PREFLIGHT_UNEXPECTED_SERVICE_STOP' }
        function script:Start-Service { throw 'PREFLIGHT_UNEXPECTED_SERVICE_START' }
    }
    $preflightOutput = @(Invoke-TransitionPreflight $context 6>&1)
    $plan = $preflightOutput | Where-Object { $_ -is [hashtable] }
    $stagePasses = @($preflightOutput | ForEach-Object { [string]$_ } | Where-Object { $_ -match '^CHECK stage=\w+ status=PASS$' })
    $expectedStages = @('production_baseline','runtime_integrity','node_versions','postgresql_tools','candidate_integrity','database_read_only','candidate_probe','production_deploy_preview','running_api_health','production_unchanged','database_authorization')
    Assert (($stagePasses -join '|') -ceq (($expectedStages | ForEach-Object { 'CHECK stage='+$_+' status=PASS' }) -join '|'))
    Assert (($preflightOutput -join '') -notmatch 'SYNTHETIC_|postgres://|fixture\.invalid')
    Assert (-not $plan.productionChanged -and $plan.xmlHash -ceq $beforeXml -and $plan.runtimeHash -ceq $beforeApi)
    Assert ($plan.googleWebLogin -eq 'PENDING' -and $plan.gmail -eq 'PENDING')
    Assert ($plan.restoreAcceptance -eq 'PENDING' -and $plan.restoreStrategy -eq 'same-cluster')
    $context.RestoreEvidence=@{path='synthetic-proof.json';sha256='externally-pinned-synthetic-proof'}
    $alternative=Invoke-TransitionPreflight $context 6>$null
    Assert ($alternative.restoreStrategy -ceq 'isolated-cluster' -and $alternative.restoreAcceptance -ceq 'PENDING' -and $alternative.restoreEvidenceSha256 -ceq $context.RestoreEvidence.sha256)
    foreach($fault in @('evidence','futurebackup','evidencepin')){
        & $manager {param($Value)$script:fault=$Value} $fault
        $rejected=$false
        try {Invoke-TransitionPreflight $context 6>$null|Out-Null} catch {$rejected=$_.Exception.Data['SafeCode'] -ceq 'RESTORE_EVIDENCE_REQUIRED'}
        Assert $rejected
    }
    $context.Remove('RestoreEvidence')
    & $manager {$script:fault=''}
    # Exercise the actual later guard conditions with bad boundary results.
    & $manager { param($Api) $script:fixtureApi=$Api } $api
    foreach ($case in @(
        @('node22','node_versions','NODE_24_15_REQUIRED'), @('arm64','node_versions','WINDOWS_X64_NODE_REQUIRED'),
        @('pg18','postgresql_tools','POSTGRESQL17_TOOLS_REQUIRED'), @('candidate','candidate_integrity','CANDIDATE_DIFFERS_FROM_VERIFIED_RUNTIME'),
        @('db18','database_read_only','POSTGRESQL17_SERVER_REQUIRED'), @('role','database_authorization','MIGRATION_OBJECT_PRIVILEGES_REQUIRED'),
        @('backupread','database_authorization','BACKUP_READ_PRIVILEGES_REQUIRED'), @('noadmin','database_authorization','RESTORE_ADMIN_CREDENTIAL_REQUIRED'),
        @('sameadmin','database_authorization','RESTORE_ADMIN_SEPARATE_ROLE_REQUIRED'), @('nocreate','database_authorization','RESTORE_ADMIN_CREATEDB_REQUIRED'),
        @('adminversion','database_authorization','RESTORE_ADMIN_VERSION_MISMATCH'),
        @('probe','candidate_probe','CANDIDATE_PROBE_FAILED'), @('references','production_deploy_preview','PRODUCTION_REFERENCE_DATA_REQUIRES_SEPARATE_REVIEW'),
        @('health','running_api_health','API_HEALTH_OR_WEB_OAUTH_FAILED')
    )) {
        & $manager { param($Fault) $script:fault=$Fault } $case[0]
        $failed=$false
        $trace=[Collections.Generic.List[string]]::new()
        try { Invoke-TransitionPreflight $context 6>&1 | ForEach-Object { $trace.Add([string]$_) } } catch {
            $safe=Get-TransitionDiagnostic $_ 'fallback' 'FALLBACK'
            $failed=$safe.stage -eq $case[1] -and $safe.code -eq $case[2] -and ($safe | ConvertTo-Json -Compress) -notmatch 'SYNTHETIC_'
        }
        Assert $failed
        if ($case[1] -eq 'database_authorization') {
            Assert ($trace -contains 'CHECK stage=candidate_probe status=PASS' -and $trace -contains 'CHECK stage=production_deploy_preview status=PASS' -and $trace -contains 'CHECK stage=running_api_health status=PASS' -and $trace -contains 'CHECK stage=production_unchanged status=PASS')
            Assert ($trace -notcontains 'CHECK stage=database_authorization status=PASS')
        }
        Assert ((Get-TransitionHash $xml) -ceq $beforeXml -and (Get-TransitionTreeHash $api) -ceq $beforeApi)
    }
    & $manager { $script:fault='' }
    & $manager { param($Path) $script:driftPath=$Path } (Join-Path $api 'dist\index.js')
    $failed=$false
    try { Invoke-TransitionPreflight $context 6>$null | Out-Null } catch { $failed=$_.Exception.Data['SafeCode'] -eq 'PRODUCTION_DRIFT_DURING_PREFLIGHT' -and $_.Exception.Data['SafeStage'] -eq 'production_unchanged' }
    Assert $failed
    Write-Output "DISCOVERY_TESTS_PASS_$checks"
} finally {
    $resolved=[IO.Path]::GetFullPath($root)
    if (-not $resolved.StartsWith([IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')+'\hb-discovery-test-',[StringComparison]::OrdinalIgnoreCase)) { throw 'UNSAFE_TEST_CLEANUP' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
