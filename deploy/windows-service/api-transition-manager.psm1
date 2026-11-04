Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'api-transition-secrets.psm1')

function Assert-Transition([bool]$Condition, [string]$Code) {
    if (-not $Condition) { $errorObject = [InvalidOperationException]::new($Code); $errorObject.Data['SafeCode'] = $Code; throw $errorObject }
}

function Get-TransitionDiagnostic($Failure, [string]$Stage, [string]$Code) {
    # Never serialize ErrorRecord, Message, TargetObject, command text or XML.
    $known = @('SERVICE_XML_REQUIRED','DUPLICATE_OR_EMPTY_ENV_NAME','SERVICE_DATABASE_URL_UNRESOLVED','SERVICE_ENV_UNSUPPORTED')
    if ($Failure.Exception.Data.Contains('SafeCode')) { $Code = [string]$Failure.Exception.Data['SafeCode'] }
    elseif ($Failure.Exception.Message -in $known) { $Code = $Failure.Exception.Message }
    if ($Failure.Exception.Data.Contains('SafeStage')) { $Stage = [string]$Failure.Exception.Data['SafeStage'] }
    $kind = 'Operation'
    if ($Failure.Exception -is [UnauthorizedAccessException]) { $kind = 'AccessDenied' }
    elseif ($Failure.Exception -is [Xml.XmlException]) { $kind = 'Xml' }
    elseif ($Failure.Exception -is [IO.IOException]) { $kind = 'IO' }
    elseif ($Failure.CategoryInfo.Category -eq 'ObjectNotFound') { $kind = 'MissingObject' }
    elseif ($Failure.CategoryInfo.Category -eq 'InvalidOperation') { $kind = 'InvalidOperation' }
    $line = $Failure.InvocationInfo.ScriptLineNumber
    if ($Failure.Exception.Data.Contains('SafeLine')) { $line = [int]$Failure.Exception.Data['SafeLine'] }
    if ($Failure.Exception.Data.Contains('SafeKind')) { $kind = [string]$Failure.Exception.Data['SafeKind'] }
    return @{stage=$Stage;code=$Code;kind=$kind;line=[int]$line}
}

function Invoke-TransitionCheck([string]$Stage, [string]$Code, [scriptblock]$Action) {
    Write-Host ('CHECK stage='+$Stage+' status=START')
    try {
        $result = & $Action
        Write-Host ('CHECK stage='+$Stage+' status=PASS')
        return $result
    } catch {
        $safe = Get-TransitionDiagnostic $_ $Stage $Code
        $failure = [InvalidOperationException]::new($safe.code)
        $failure.Data['SafeCode'] = $safe.code
        $failure.Data['SafeStage'] = $safe.stage
        $failure.Data['SafeLine'] = $safe.line
        $failure.Data['SafeKind'] = $safe.kind
        throw $failure
    }
}

function Get-TransitionServiceExecutable([string]$Command) {
    # Bundled WinSW uses a renamed EXE and its adjacent XML. Explicit global
    # mode/config switches need review rather than guessing which XML is live.
    $match = [regex]::Match($Command.Trim(), '^(?:"([^"\r\n]+\.exe)"|([A-Za-z]:\\[^"\r\n]*?\.exe))\s*$', 'IgnoreCase')
    Assert-Transition $match.Success 'SERVICE_COMMAND_UNSUPPORTED'
    $exe = if ($match.Groups[1].Success) { $match.Groups[1].Value } else { $match.Groups[2].Value }
    Assert-Transition ($exe -match '^[A-Za-z]:\\' -and $exe.Substring(2) -notmatch '[:*?"<>|\x00-\x1f]') 'SERVICE_COMMAND_UNSUPPORTED'
    $exe = [IO.Path]::GetFullPath($exe)
    Assert-TransitionPath $exe
    Assert-Transition (Test-Path -LiteralPath $exe -PathType Leaf) 'SERVICE_WRAPPER_FILE_REQUIRED'
    return $exe
}

function Get-TransitionServiceXml([string]$Command, [string]$WinSwXml) {
    $expected = [IO.Path]::ChangeExtension((Get-TransitionServiceExecutable $Command),'.xml')
    if ($WinSwXml) {
        # An operator path is evidence to verify, never a config override for SCM.
        Assert-Transition ($WinSwXml -match '^[A-Za-z]:\\' -and $WinSwXml.Substring(2) -notmatch '[:*?"<>|\x00-\x1f]') 'SERVICE_XML_ABSOLUTE_PATH_REQUIRED'
        Assert-Transition ([IO.Path]::GetFullPath($WinSwXml) -ieq $expected) 'SERVICE_XML_WRAPPER_PATH_MISMATCH'
    }
    Assert-Transition (Test-Path -LiteralPath $expected) 'SERVICE_XML_NOT_FOUND'
    Assert-Transition (Test-Path -LiteralPath $expected -PathType Leaf) 'SERVICE_XML_FILE_REQUIRED'
    Assert-TransitionPath $expected
    return $expected
}

function Get-TransitionXmlText([Xml.XmlDocument]$Document, [string]$Name, [switch]$Optional) {
    $nodes = $Document.SelectNodes('/service/'+$Name)
    Assert-Transition ($nodes.Count -le 1 -and ($Optional -or $nodes.Count -eq 1)) 'SERVICE_XML_FIELD_REQUIRED_OR_DUPLICATE'
    if ($nodes.Count -eq 0) { return '' }
    return $nodes[0].InnerText.Trim()
}

function Resolve-TransitionPath([string]$Value, [hashtable]$Values, [string]$Base) {
    foreach ($reference in [regex]::Matches($Value, '%([A-Za-z_][A-Za-z0-9_()]*)%')) {
        Assert-Transition ($Values.ContainsKey($reference.Groups[1].Value)) 'SERVICE_PATH_ENV_UNRESOLVED'
    }
    $expanded = [regex]::Replace($Value, '%([A-Za-z_][A-Za-z0-9_()]*)%', {
        param($match)
        return [string]$Values[$match.Groups[1].Value]
    }.GetNewClosure()).Trim()
    Assert-Transition ([bool]$expanded -and $expanded -notmatch '%[A-Za-z_][A-Za-z0-9_()]*%') 'SERVICE_PATH_ENV_UNRESOLVED'
    if ($expanded.StartsWith('"') -and $expanded.EndsWith('"')) { $expanded = $expanded.Substring(1,$expanded.Length-2) }
    if (-not [IO.Path]::IsPathRooted($expanded)) { $expanded = Join-Path $Base $expanded }
    return [IO.Path]::GetFullPath($expanded).TrimEnd('\')
}

function Find-TransitionRuntime([string]$Directory) {
    if ($Directory) { return [IO.Path]::GetFullPath($Directory).TrimEnd('\') }
    $found = @(@('C:\HB0191', 'C:\Users\user\Desktop\HasarBotu-0191\api-0191') | Where-Object { Test-Path -LiteralPath $_ } | ForEach-Object {
        Get-ChildItem -LiteralPath $_ -Directory -Depth 3 -Recurse | Where-Object { $_.Name -eq 'api-runtime' -and (Test-Path -LiteralPath (Join-Path $_.FullName 'package-manifest.json')) } | Select-Object -ExpandProperty FullName
    } | Sort-Object -Unique)
    Assert-Transition ($found.Count -gt 0) 'EXISTING_API_RUNTIME_REQUIRED'
    Assert-Transition ($found.Count -eq 1) 'MULTIPLE_RUNTIMES_SPECIFY_RUNTIME_DIRECTORY'
    return $found[0]
}

function ConvertTo-TransitionArgument([string]$Value) {
    # CommandLineToArgvW quoting, including trailing backslashes and quotes.
    return '"' + [regex]::Replace([regex]::Replace($Value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
}

function Invoke-TransitionProcess {
    param([string]$Executable, [string[]]$Arguments, [hashtable]$EnvironmentValues, [int]$TimeoutSeconds=900, [switch]$TextResult, [string]$InputText)
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $Executable
    $info.Arguments = ($Arguments | ForEach-Object { ConvertTo-TransitionArgument $_ }) -join ' '
    $info.UseShellExecute = $false; $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
    $info.RedirectStandardInput = [bool]$InputText
    # Child output is never forwarded: exception/driver output can contain secrets.
    if ($EnvironmentValues) { $info.EnvironmentVariables.Clear(); foreach ($key in $EnvironmentValues.Keys) { $info.EnvironmentVariables[$key] = [string]$EnvironmentValues[$key] } }
    $process = [Diagnostics.Process]::new(); $process.StartInfo = $info
    try {
        Assert-Transition ($process.Start()) 'CHILD_START_FAILED'
        $stdout = $process.StandardOutput.ReadToEndAsync(); $stderr = $process.StandardError.ReadToEndAsync()
        if ($InputText) {
            # .NET Framework lacks StandardInputEncoding. Write UTF-8 directly
            # to the private pipe; credentials never enter argv, env or disk.
            $inputBytes = [Text.Encoding]::UTF8.GetBytes($InputText)
            try { $process.StandardInput.BaseStream.Write($inputBytes,0,$inputBytes.Length); $process.StandardInput.BaseStream.Close() }
            finally { [Array]::Clear($inputBytes,0,$inputBytes.Length); $InputText=$null }
        }
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            # taskkill /T is restricted to this child tree (e.g. pg_restore).
            & "$env:SystemRoot\System32\taskkill.exe" /PID $process.Id /T /F 1>$null 2>$null
            Assert-Transition $false 'CHILD_TIMEOUT'
        }
        $output = $stdout.GetAwaiter().GetResult(); $stderr.GetAwaiter().GetResult() | Out-Null
        if ($TextResult) { Assert-Transition ($process.ExitCode -eq 0) 'CHILD_FAILED'; return $output.Trim() }
        $json = [regex]::Match($output, '(?ms)^\{.*\}\s*$').Value
        Assert-Transition ([bool]$json) 'CHILD_RESULT_INVALID'
        $result = $json | ConvertFrom-Json
        if ($process.ExitCode -ne 0) {
            $codes = @('28P01','28000','3D000','42P01','42501','ECONNREFUSED','ENOTFOUND','ETIMEDOUT','MODULE_NOT_FOUND','ERR_MODULE_NOT_FOUND',
                'ACTION_INVALID','MIGRATION_SET_INVALID','MIGRATION_BASELINE_MISMATCH','MIGRATION_SCHEMA_INVALID','DATABASE_URL_INVALID',
                'DATABASE_WRITERS_PRESENT','BACKUP_ARGUMENTS_REQUIRED','BACKUP_URL_OPTIONS_UNSUPPORTED','PG_DUMP_FAILED','DUMP_INVALID',
                'BACKUP_HASH_MISMATCH','RESTORE_FAILED','RESTORE_CONTENT_MISMATCH','UNEXPECTED_MIGRATION','DATA_CHANGED','PRIVILEGES_REQUIRED',
                'DATABASE_OPERATION_FAILED','NODE24_REQUIRED','STOPPED_API_REQUIRED','SERVICE_DATABASE_URL_UNRESOLVED','DUPLICATE_OR_EMPTY_ENV_NAME',
                'NEW_BACKUP_DIRECTORY_AND_PG_DUMP_REQUIRED','DATABASE_WRAPPER_FAILED','CANDIDATE_IMPORT_FAILED','CANDIDATE_CONFIGURATION_INVALID',
                'CANDIDATE_HEALTH_FAILED','CANDIDATE_GOOGLE_STATUS_FAILED','CANDIDATE_PROBE_OPERATION_FAILED',
                'BACKUP_READ_PRIVILEGES_REQUIRED','MIGRATION_OBJECT_PRIVILEGES_REQUIRED','RESTORE_ADMIN_CREDENTIAL_REQUIRED','RESTORE_ADMIN_SEPARATE_ROLE_REQUIRED',
                'RESTORE_ADMIN_CREATEDB_REQUIRED','RESTORE_ADMIN_VERSION_MISMATCH','RESTORE_MAINTENANCE_DATABASE_REQUIRED','RESTORE_CLEANUP_FAILED',
                'PG_CREDENTIAL_PROTECTION_FAILED','PG_CREDENTIAL_INVALID','PG_CREDENTIAL_CLEANUP_FAILED',
                'RESTORE_MODE_CONFLICT','RESTORE_EVIDENCE_REQUIRED','RESTORE_EVIDENCE_INVALID','RESTORE_EVIDENCE_PIN_REQUIRED',
                'RESTORE_EVIDENCE_EXPIRED','RESTORE_EVIDENCE_BINDING_MISMATCH','RESTORE_EVIDENCE_VERSION_MISMATCH',
                'RESTORE_EVIDENCE_INCOMPLETE','RESTORE_EVIDENCE_BACKUP_MISMATCH','RESTORE_EVIDENCE_HASH_MISMATCH',
                'RESTORE_EVIDENCE_MISSING','RESTORE_EVIDENCE_PATH_INVALID','ISOLATED_RESTORE_PATH_INVALID',
                'ISOLATED_RESTORE_ENDPOINT_INVALID','ISOLATED_RESTORE_PROCESS_FAILED','ISOLATED_RESTORE_CLEANUP_FAILED')
            $stages = @('runtime_load','database_url','migration_baseline','verify_schema','pg_dump','dump_decode','backup_hash','restore_create',
                'restore_content','migrate','verify','node_version','service_state','service_environment','database_child',
                'candidate_import','candidate_configuration','candidate_database','candidate_health','candidate_google_status','restore_admin_check','restore_cleanup','migration_0075',
                'legacy_evidence_import','independent_restore_evidence','isolated_restore')
            if ($result.PSObject.Properties['stage'] -and $result.PSObject.Properties['code'] -and $result.stage -in $stages -and $result.code -in $codes) {
                $failure = [InvalidOperationException]::new([string]$result.code)
                $failure.Data['SafeCode'] = [string]$result.code
                $failure.Data['SafeStage'] = [string]$result.stage
                throw $failure
            }
            Assert-Transition $false 'CHILD_FAILED'
        }
        return $result
    } finally { $info.EnvironmentVariables.Clear(); $process.Dispose() }
}

function Invoke-TransitionTool([string]$Name, [string[]]$ToolArguments, [switch]$TextResult) {
    return Invoke-TransitionProcess -Executable "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Arguments (@('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot $Name)) + $ToolArguments) -TextResult:$TextResult
}

function Get-TransitionHash([string]$Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Get-TransitionConfigHash([string]$XmlPath) {
    $values = Get-ApiResolvedEnvironment -Document (Read-ApiServiceXml $XmlPath) -XmlPath $XmlPath
    $ordered = [ordered]@{}
    foreach ($key in @($values.Keys | Sort-Object)) { $ordered[$key] = $values[$key] }
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes(($ordered | ConvertTo-Json -Compress)))).Replace('-','').ToLowerInvariant() } finally { $hash.Dispose() }
}
function Assert-TransitionPath([string]$Path) {
    $full = [IO.Path]::GetFullPath($Path)
    Assert-Transition ($full -match '^[A-Za-z]:\\' -and $full.Length -gt 3) 'LOCAL_ABSOLUTE_PATH_REQUIRED'
    $item = Get-Item -LiteralPath $full -Force
    while ($null -ne $item) {
        Assert-Transition (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) 'REPARSE_POINT_REJECTED'
        $item = if ($item -is [IO.DirectoryInfo]) { $item.Parent } else { $item.Directory }
    }
}
function Get-TransitionTreeHash([string]$Root) {
    $Root = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    $lines = [Collections.Generic.List[string]]::new()
    foreach ($segment in @('dist','node_modules','package.json','THIRD-PARTY-NOTICES.txt')) {
        $path = Join-Path $Root $segment
        if (-not (Test-Path -LiteralPath $path)) { continue }
        $items = @((Get-Item -LiteralPath $path -Force))
        if ($items[0].PSIsContainer) { $items += @(Get-ChildItem -LiteralPath $path -Recurse -Force) }
        foreach ($item in $items) {
            Assert-Transition (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) 'REPARSE_POINT_REJECTED'
            if (-not $item.PSIsContainer) { $lines.Add($item.FullName.Substring($Root.Length).ToLowerInvariant() + ':' + (Get-TransitionHash $item.FullName)) }
        }
    }
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes((@($lines | Sort-Object) -join "`n")))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
}
function Write-TransitionJson([string]$Path, $Value) {
    $temporary = $Path + '.new'
    [IO.File]::WriteAllText($temporary,($Value | ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Get-TransitionContext([string]$RuntimeDirectory, [string]$CandidateDirectory, [string]$StateDirectory, [string]$WinSwXml) {
    Assert-Transition ([Environment]::MachineName -ieq 'DESKTOP-EFN2G33') 'OFFICE_SERVER_REQUIRED'
    $service = Invoke-TransitionCheck 'service_query' 'SERVICE_QUERY_FAILED' {
        $found = Get-CimInstance Win32_Service -Filter "Name='hasarbotu-api'"
        Assert-Transition ($null -ne $found) 'INSTALLED_API_SERVICE_REQUIRED'
        Assert-Transition ($found.State -eq 'Running') 'RUNNING_API_SERVICE_REQUIRED'
        return $found
    }
    $wrapper = Invoke-TransitionCheck 'service_command' 'SERVICE_COMMAND_READ_FAILED' { Get-TransitionServiceExecutable $service.PathName }
    Invoke-TransitionCheck 'service_wrapper_process' 'SERVICE_WRAPPER_PROCESS_CHECK_FAILED' {
        Assert-Transition ($service.ProcessId -gt 0) 'SERVICE_PROCESS_ID_REQUIRED'
        $process = Get-CimInstance Win32_Process -Filter ('ProcessId='+$service.ProcessId)
        Assert-Transition ($null -ne $process -and $process.ExecutablePath -ieq $wrapper) 'SERVICE_WRAPPER_PROCESS_MISMATCH'
    } | Out-Null
    $configuration = Invoke-TransitionCheck 'service_xml' 'SERVICE_XML_INVALID_OR_UNREADABLE' {
        $xml = Get-TransitionServiceXml $service.PathName $WinSwXml
        $doc = Read-ApiServiceXml $xml
        Assert-Transition ((Get-TransitionXmlText $doc 'id') -eq 'hasarbotu-api') 'SERVICE_ID_MISMATCH'
        Assert-Transition ($doc.SelectNodes('/service/env[@secret] | /service/env[@file] | /service/download | /service/extensions').Count -eq 0) 'SERVICE_ENV_UNSUPPORTED'
        return @{Path=$xml;Document=$doc}
    }
    $xml = $configuration.Path
    $document = $configuration.Document
    $values = Invoke-TransitionCheck 'service_environment' 'SERVICE_ENVIRONMENT_FAILED' { Get-ApiResolvedEnvironment -Document $document -XmlPath $xml }
    $base = Split-Path $xml -Parent
    $api = Invoke-TransitionCheck 'service_working_directory' 'SERVICE_WORKING_DIRECTORY_INVALID' {
        $working = Get-TransitionXmlText $document 'workingdirectory' -Optional
        if (-not $working) { $working = $base }
        $path = Resolve-TransitionPath $working $values $base
        Assert-TransitionPath $path
        Assert-Transition (Test-Path -LiteralPath (Join-Path $path 'dist\index.js') -PathType Leaf) 'SERVICE_ENTRYPOINT_NOT_FOUND'
        return $path
    }
    $serviceNode = Invoke-TransitionCheck 'service_node_path' 'SERVICE_NODE_RESOLUTION_FAILED' {
        $raw = Get-TransitionXmlText $document 'executable'
        $path = Resolve-TransitionPath $raw $values $base
        if (-not (Test-Path -LiteralPath $path) -and $raw -match '^(?i:node(?:\.exe)?)$') {
            Assert-Transition ($values.ContainsKey('PATH')) 'MACHINE_NODE_PATH_REQUIRED'
            $matches = @($values.PATH.Split(';') | Where-Object { $_ } | ForEach-Object {
                $dir = Resolve-TransitionPath $_ $values $base
                $entry = Join-Path $dir 'node.exe'
                if (Test-Path -LiteralPath $entry -PathType Leaf) { $entry }
            } | Select-Object -First 1)
            Assert-Transition ($matches.Count -eq 1) 'MACHINE_NODE_NOT_FOUND'
            $path = $matches[0]
        }
        Assert-Transition (Test-Path -LiteralPath $path -PathType Leaf) 'SERVICE_NODE_NOT_FOUND'
        Assert-TransitionPath $path
        return $path
    }
    Invoke-TransitionCheck 'service_entrypoint' 'SERVICE_ENTRYPOINT_INVALID' {
        $argument = Get-TransitionXmlText $document 'startarguments' -Optional
        if (-not $argument) { $argument = Get-TransitionXmlText $document 'arguments' }
        Assert-Transition ($argument -match '^(?:"[^"]+"|[^"\s]+)$') 'SERVICE_ENTRYPOINT_UNSUPPORTED'
        Assert-Transition ((Resolve-TransitionPath $argument $values $api) -ieq (Join-Path $api 'dist\index.js')) 'SERVICE_ENTRYPOINT_UNSUPPORTED'
    } | Out-Null
    $RuntimeDirectory = Invoke-TransitionCheck 'runtime_discovery' 'RUNTIME_DISCOVERY_FAILED' { Find-TransitionRuntime $RuntimeDirectory }
    Invoke-TransitionCheck 'isolated_paths' 'ISOLATED_PATH_CHECK_FAILED' {
        foreach ($path in @($api,$RuntimeDirectory,$CandidateDirectory,$serviceNode)) { Assert-TransitionPath $path }
        foreach ($path in @($RuntimeDirectory,$CandidateDirectory,$StateDirectory)) {
            $normalized = [IO.Path]::GetFullPath($path).TrimEnd('\')
            Assert-Transition (-not ($normalized -ieq $api -or $normalized.StartsWith($api+'\',[StringComparison]::OrdinalIgnoreCase) -or $api.StartsWith($normalized+'\',[StringComparison]::OrdinalIgnoreCase))) 'PRODUCTION_PATH_OVERLAP'
        }
        $candidateRoot = 'C:\HB0191\candidate-ready-20261104'
        Assert-Transition ([IO.Path]::GetFullPath($CandidateDirectory).TrimEnd('\') -ieq (Join-Path $candidateRoot 'services\api')) 'ISOLATED_CANDIDATE_PATH_REQUIRED'
        Assert-Transition (-not $api.StartsWith($candidateRoot+'\',[StringComparison]::OrdinalIgnoreCase)) 'PRODUCTION_IN_CANDIDATE_ROOT'
    } | Out-Null
    Invoke-TransitionCheck 'service_configuration' 'SERVICE_CONFIGURATION_INVALID' {
        if (-not $values.ContainsKey('HOST')) { $values.HOST = '127.0.0.1' }
        if (-not $values.ContainsKey('PORT')) { $values.PORT = '3100' }
        Assert-Transition ($values.HOST -eq '127.0.0.1') 'IPV4_LOOPBACK_BIND_REQUIRED'
        $port = 0
        Assert-Transition ($values.PORT -match '^\d+$' -and [int]::TryParse($values.PORT,[ref]$port) -and $port -ge 1 -and $port -le 65535) 'EXPLICIT_API_PORT_REQUIRED'
        $required = [ordered]@{
            GOOGLE_CLIENT_ID='EXISTING_GOOGLE_CLIENT_ID_REQUIRED'; GOOGLE_CLIENT_SECRET='EXISTING_GOOGLE_CLIENT_SECRET_REQUIRED';
            GOOGLE_REDIRECT_URI='EXISTING_GOOGLE_REDIRECT_URI_REQUIRED'; GOOGLE_TOKEN_ENCRYPTION_KEY='EXISTING_GOOGLE_TOKEN_KEY_REQUIRED'
        }
        foreach ($name in $required.Keys) {
            Assert-Transition ($values.ContainsKey($name) -and [bool]$values[$name]) $required[$name]
        }
    } | Out-Null
    $sid = Invoke-TransitionCheck 'service_account' 'SERVICE_ACCOUNT_RESOLUTION_FAILED' {
        $account = $service.StartName
        if ($account -in @('LocalSystem','NT AUTHORITY\SYSTEM')) { return 'S-1-5-18' }
        if ($account -in @('NT AUTHORITY\LocalService','NT AUTHORITY\LOCAL SERVICE')) { return 'S-1-5-19' }
        if ($account -in @('NT AUTHORITY\NetworkService','NT AUTHORITY\NETWORK SERVICE')) { return 'S-1-5-20' }
        if ($account.StartsWith('.\')) { $account = [Environment]::MachineName + $account.Substring(1) }
        return ([Security.Principal.NTAccount]::new($account)).Translate([Security.Principal.SecurityIdentifier]).Value
    }
    return @{ Api=$api; Xml=$xml; Values=$values; Service=$service; ServiceNode=$serviceNode; ServiceSid=$sid;
        Runtime=[IO.Path]::GetFullPath($RuntimeDirectory).TrimEnd('\'); Candidate=[IO.Path]::GetFullPath($CandidateDirectory).TrimEnd('\');
        Node=(Join-Path $RuntimeDirectory 'node\node.exe'); Dump='C:\Program Files\PostgreSQL\17\bin\pg_dump.exe'; Origin=('http://127.0.0.1:'+$values.PORT) }
}

function Read-TransitionRestoreCredential {
    $user = Read-Host 'Restore yonetici kullanicisi (gizli; API hesabindan ayri)' -AsSecureString
    try {
        $name = [Net.NetworkCredential]::new('',$user).Password
        Assert-Transition ([bool]$name) 'RESTORE_ADMIN_CREDENTIAL_REQUIRED'
        $password = Read-Host 'Restore yonetici parolasi (gizli)' -AsSecureString
        return [Management.Automation.PSCredential]::new($name,$password)
    } finally { $user.Dispose(); $name=$null }
}
function Invoke-TransitionDatabase($Context, [string]$Action, [string]$BackupDirectory) {
    Assert-Transition ($Action -in @('Check','Backup','ValidateBackup','RehearseBackup','Migrate','Verify','Quiescent')) 'ACTION_INVALID'
    $version = Invoke-TransitionProcess $Context.Node @('--version') -TextResult
    Assert-Transition ($version -match '^v24\.(\d+)\.' -and [int]$Matches[1] -ge 15) 'NODE24_REQUIRED'
    if ($Action -in @('Backup','ValidateBackup','Migrate','Quiescent')) { Assert-Transition ((Get-Service hasarbotu-api).Status -eq 'Stopped') 'STOPPED_API_REQUIRED' }
    $values = Get-ApiResolvedEnvironment -Document (Read-ApiServiceXml $Context.Xml) -XmlPath $Context.Xml
    if ($Action -in @('Backup','RehearseBackup')) {
        Assert-Transition ($Context.Dump -and $BackupDirectory -and -not (Test-Path -LiteralPath $BackupDirectory)) 'NEW_BACKUP_DIRECTORY_AND_PG_DUMP_REQUIRED'
        Assert-TransitionPath (Split-Path ([IO.Path]::GetFullPath($BackupDirectory)) -Parent)
        [IO.Directory]::CreateDirectory($BackupDirectory) | Out-Null
        Assert-TransitionPath $BackupDirectory
        Protect-ApiTransitionPath $BackupDirectory ''
    }
    $request = @{databaseUrl=$values.DATABASE_URL}
    try {
        if ($Context.ContainsKey('RestoreEvidence') -and $Context.RestoreEvidence) { $request.restoreEvidence = $Context.RestoreEvidence }
        if ($Context.ContainsKey('LegacyEvidence') -and $Context.LegacyEvidence) { $request.legacyEvidence = $Context.LegacyEvidence }
        if ($request.ContainsKey('restoreEvidence') -or $request.ContainsKey('legacyEvidence') -or $Action -eq 'RehearseBackup') {
            $postgres = Get-CimInstance Win32_Service -Filter "Name='postgresql-x64-17'"
            Assert-Transition ($postgres.PathName -match '-D\s+"([^"]+)"') 'ISOLATED_RESTORE_PATH_INVALID'
            $request.productionDataDirectory = $Matches[1]
        }
        if ($Action -in @('Check','ValidateBackup') -and $Context.ContainsKey('RestoreAdminCredential') -and $null -ne $Context.RestoreAdminCredential) {
            $request.restoreAdmin = @{username=$Context.RestoreAdminCredential.UserName;password=$Context.RestoreAdminCredential.GetNetworkCredential().Password}
        }
        $childEnvironment = @{SystemRoot=$env:SystemRoot;PATH=$env:PATH;TEMP=$env:TEMP;TMP=$env:TMP}
        $result = Invoke-TransitionProcess -Executable $Context.Node -Arguments @((Join-Path $PSScriptRoot 'api-transition-database.mjs'),$Action,$Context.Candidate,$Context.Dump,$BackupDirectory,'--stdin') -EnvironmentValues $childEnvironment -InputText ($request | ConvertTo-Json -Compress)
        Assert-Transition ($result.status -eq 'PASS') 'DATABASE_CHECK_FAILED'
        return $result
    } finally { $request.Clear(); $values.Clear() }
}
function Test-TransitionHealth($Context, [bool]$Desktop) {
    $service = Get-CimInstance Win32_Service -Filter "Name='hasarbotu-api'"
    Assert-Transition ($service.State -eq 'Running' -and $service.ProcessId -gt 0) 'API_SERVICE_NOT_RUNNING'
    $listeners = @(Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort ([int]$Context.Values.PORT) -State Listen -ErrorAction Stop)
    Assert-Transition ($listeners.Count -eq 1) 'ONE_API_LISTENER_REQUIRED'
    $process = Get-CimInstance Win32_Process -Filter ('ProcessId='+$listeners[0].OwningProcess)
    Assert-Transition ($process.ExecutablePath -ieq $Context.ServiceNode) 'API_LISTENER_NODE_MISMATCH'
    $owned = $false
    for ($i=0; $i -lt 8 -and $process; $i++) {
        if ($process.ProcessId -eq $service.ProcessId) { $owned=$true; break }
        $process = Get-CimInstance Win32_Process -Filter ('ProcessId='+$process.ParentProcessId)
    }
    Assert-Transition $owned 'API_LISTENER_NOT_OWNED_BY_SERVICE'
    $health = Invoke-RestMethod -Uri ($Context.Origin+'/health') -TimeoutSec 5 -UseBasicParsing
    $google = Invoke-RestMethod -Uri ($Context.Origin+'/api/v1/google/status') -TimeoutSec 5 -UseBasicParsing
    Assert-Transition ($health.status -eq 'ok' -and $health.service -eq 'hasarbotu-api' -and $google.enabled) 'API_HEALTH_OR_WEB_OAUTH_FAILED'
    if ($Desktop) { Assert-Transition ($google.desktopEnabled -and $google.proxyAwareRateLimit) 'DESKTOP_OAUTH_STATUS_FAILED' }
}
function Wait-TransitionHealth($Context, [bool]$Desktop) {
    # Bounded readiness polling is needed after SCM starts a real process.
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    do {
        try { Test-TransitionHealth $Context $Desktop; return } catch { if ([DateTime]::UtcNow -ge $deadline) { throw }; Start-Sleep -Milliseconds 500 }
    } while ($true)
}
function Get-TransitionDeployArguments($Context, [string]$Target) {
    return @('-SourceDir',(Join-Path $Context.Runtime 'services\api'),'-TargetDir',$Target,'-ServiceLabel','api0191manager','-DependencyClosureManifestPath',(Join-Path $Context.Runtime 'dependency-closure.json'),'-RepoRoot',$Context.Runtime)
}
function Invoke-TransitionPreflight($Context) {
    $before = Invoke-TransitionCheck 'production_baseline' 'PRODUCTION_BASELINE_FAILED' {
        return @{xmlHash=(Get-TransitionHash $Context.Xml);configHash=(Get-TransitionConfigHash $Context.Xml);runtimeHash=(Get-TransitionTreeHash $Context.Api)}
    }
    Invoke-TransitionCheck 'runtime_integrity' 'RUNTIME_INTEGRITY_CHECK_FAILED' {
        Assert-Transition ($Context.Service.State -eq 'Running') 'RUNNING_0190_SERVICE_REQUIRED'
        Assert-Transition ((Get-TransitionHash (Join-Path $Context.Runtime 'package-manifest.json')) -eq 'd6806fd817d08de80bfe8d406ce38040793026e9faf20e02b39cf2e29c659a47') 'VERIFIED_0191_RUNTIME_REQUIRED'
        Invoke-TransitionTool 'verify-api-transition-package.ps1' @('-Directory',$Context.Runtime) -TextResult | Out-Null
    } | Out-Null
    Invoke-TransitionCheck 'node_versions' 'NODE_EXECUTION_FAILED' {
        foreach ($node in @($Context.Node,$Context.ServiceNode)) {
            Assert-Transition (Test-Path -LiteralPath $node -PathType Leaf) 'NODE_EXECUTABLE_NOT_FOUND'
            $version = Invoke-TransitionProcess $node @('--version') -TextResult
            Assert-Transition ($version -match '^v24\.(\d+)\.' -and [int]$Matches[1] -ge 15) 'NODE_24_15_REQUIRED'
            $arch = Invoke-TransitionProcess $node @('-p','process.platform+"/"+process.arch') -TextResult
            Assert-Transition ($arch -eq 'win32/x64') 'WINDOWS_X64_NODE_REQUIRED'
        }
    } | Out-Null
    Invoke-TransitionCheck 'postgresql_tools' 'POSTGRESQL_TOOLS_EXECUTION_FAILED' {
        foreach ($tool in @($Context.Dump,(Join-Path (Split-Path $Context.Dump) 'pg_restore.exe'))) {
            Assert-Transition (Test-Path -LiteralPath $tool -PathType Leaf) 'POSTGRESQL17_TOOL_NOT_FOUND'
            $version = Invoke-TransitionProcess $tool @('--version') -TextResult
            Assert-Transition ($version -match '\b17\.') 'POSTGRESQL17_TOOLS_REQUIRED'
        }
    } | Out-Null
    Invoke-TransitionCheck 'candidate_integrity' 'CANDIDATE_PREPARATION_FAILED' {
        # Repairs are allowed only in the isolated candidate tree. Resolve every
        # pinned extra-data destination before either candidate tool can mutate it.
        $closure = [IO.File]::ReadAllText((Join-Path $Context.Runtime 'dependency-closure.json')) | ConvertFrom-Json
        foreach ($ref in $closure.ExtraDataReferences) {
            $destination = [IO.Path]::GetFullPath((Join-Path (Split-Path (Join-Path $Context.Candidate $ref.distRelativePath)) $ref.literal))
            Assert-Transition ($destination.StartsWith('C:\HB0191\candidate-ready-20261104\',[StringComparison]::OrdinalIgnoreCase)) 'CANDIDATE_REFERENCE_PATH_ESCAPE'
        }
        $candidateRefsArgs = @('-RepoRoot',$Context.Runtime,'-DataLabel','api0191candidate','-DependencyClosureManifestPath',(Join-Path $Context.Runtime 'dependency-closure.json'),'-ServiceTargetDir',$Context.Candidate)
        $candidateRefs = Invoke-TransitionTool 'provision-extra-data-references.ps1' $candidateRefsArgs
        if ($candidateRefs.Status -eq 'would_apply') {
            $candidateRefs = Invoke-TransitionTool 'provision-extra-data-references.ps1' ($candidateRefsArgs+@('-Apply'))
        }
        Assert-Transition ($candidateRefs.Status -in @('applied','already_up_to_date','nothing_to_provision')) 'CANDIDATE_REFERENCE_DATA_FAILED'
        $candidate = Invoke-TransitionTool 'deploy-service-artifacts.ps1' (Get-TransitionDeployArguments $Context $Context.Candidate)
        if ($candidate.Status -eq 'would_apply') {
            $candidate = Invoke-TransitionTool 'deploy-service-artifacts.ps1' ((Get-TransitionDeployArguments $Context $Context.Candidate)+@('-Apply'))
        }
        Assert-Transition ($candidate.Status -in @('applied','already_up_to_date')) 'CANDIDATE_DIFFERS_FROM_VERIFIED_RUNTIME'
    } | Out-Null
    $db = Invoke-TransitionCheck 'database_read_only' 'DATABASE_READ_ONLY_CHECK_FAILED' {
        $result = Invoke-TransitionDatabase $Context 'Check'
        Assert-Transition ($result.serverMajor -eq 17) 'POSTGRESQL17_SERVER_REQUIRED'
        foreach ($name in @('databaseOwnerDirect','databaseOwnerEffective','apiCreatedb','apiSuperuser','migrationCapable','backupReadPrivileges')) {
            Assert-Transition ($result.permissions.$name -is [bool]) 'DATABASE_PERMISSION_RESULT_INVALID'
            Write-Host ('DB_PERMISSION '+$name+'='+$result.permissions.$name.ToString().ToLowerInvariant())
        }
        foreach ($name in @('supplied','separateRole','canCreateDatabase','sameServerMajor')) {
            Assert-Transition ($result.restoreAdmin.$name -is [bool]) 'DATABASE_PERMISSION_RESULT_INVALID'
            Write-Host ('RESTORE_ADMIN '+$name+'='+$result.restoreAdmin.$name.ToString().ToLowerInvariant())
        }
        return $result
    }
    Invoke-TransitionCheck 'candidate_probe' 'CANDIDATE_PROBE_FAILED' {
        $probe = Invoke-TransitionProcess $Context.Node @((Join-Path $PSScriptRoot 'api-transition-probe.mjs'),$Context.Candidate) $Context.Values
        Assert-Transition ($probe.status -eq 'PASS') 'CANDIDATE_PROBE_FAILED'
    } | Out-Null
    # Production reference data must already be correct: no automatic replacement
    # of shared reference files, so file-agent/old API consumers stay untouched.
    Invoke-TransitionCheck 'production_deploy_preview' 'PRODUCTION_DEPLOY_PREVIEW_FAILED' {
        $refs = Invoke-TransitionTool 'provision-extra-data-references.ps1' @('-RepoRoot',$Context.Runtime,'-DataLabel','api0191manager','-DependencyClosureManifestPath',(Join-Path $Context.Runtime 'dependency-closure.json'),'-ServiceTargetDir',$Context.Api)
        Assert-Transition ($refs.Status -in @('already_up_to_date','nothing_to_provision')) 'PRODUCTION_REFERENCE_DATA_REQUIRES_SEPARATE_REVIEW'
        $preview = Invoke-TransitionTool 'deploy-service-artifacts.ps1' (Get-TransitionDeployArguments $Context $Context.Api)
        Assert-Transition ($preview.Status -in @('would_apply','already_up_to_date')) 'DEPLOY_PREVIEW_FAILED'
    } | Out-Null
    Invoke-TransitionCheck 'running_api_health' 'RUNNING_API_HEALTH_CHECK_FAILED' { Test-TransitionHealth $Context $false } | Out-Null
    Invoke-TransitionCheck 'production_unchanged' 'PRODUCTION_UNCHANGED_CHECK_FAILED' {
        Assert-Transition ((Get-TransitionHash $Context.Xml) -eq $before.xmlHash -and (Get-TransitionConfigHash $Context.Xml) -eq $before.configHash -and (Get-TransitionTreeHash $Context.Api) -eq $before.runtimeHash) 'PRODUCTION_DRIFT_DURING_PREFLIGHT'
        $service = Get-CimInstance Win32_Service -Filter "Name='hasarbotu-api'"
        Assert-Transition ($service.State -eq 'Running' -and $service.ProcessId -eq $Context.Service.ProcessId) 'PRODUCTION_SERVICE_CHANGED_DURING_PREFLIGHT'
    } | Out-Null
    # Keep diagnostics for later read-only gates available even when credentials
    # or object rights are missing. A Check PASS does not authorize a migration.
    Invoke-TransitionCheck 'database_authorization' 'DATABASE_AUTHORIZATION_FAILED' {
        Assert-Transition $db.permissions.backupReadPrivileges 'BACKUP_READ_PRIVILEGES_REQUIRED'
        Assert-Transition $db.permissions.migrationCapable 'MIGRATION_OBJECT_PRIVILEGES_REQUIRED'
        if ($Context.ContainsKey('RestoreEvidence') -and $Context.RestoreEvidence) {
            Assert-Transition ($db.restoreStrategy -ceq 'isolated-cluster' -and $db.independentRestore.evidenceValid -and $db.independentRestore.freshBackupRehearsalRequired -and $db.independentRestore.evidenceSha256 -ceq $Context.RestoreEvidence.sha256) 'RESTORE_EVIDENCE_REQUIRED'
        } else {
            Assert-Transition $db.restoreAdmin.supplied 'RESTORE_ADMIN_CREDENTIAL_REQUIRED'
            Assert-Transition $db.restoreAdmin.separateRole 'RESTORE_ADMIN_SEPARATE_ROLE_REQUIRED'
            Assert-Transition $db.restoreAdmin.canCreateDatabase 'RESTORE_ADMIN_CREATEDB_REQUIRED'
            Assert-Transition $db.restoreAdmin.sameServerMajor 'RESTORE_ADMIN_VERSION_MISMATCH'
        }
    } | Out-Null
    return @{ id=[Guid]::NewGuid().ToString('N'); createdUtc=[DateTime]::UtcNow.ToString('o'); host=$env:COMPUTERNAME;
        xmlHash=$before.xmlHash; configHash=$before.configHash; runtimeHash=$before.runtimeHash; api=$Context.Api;
        candidate=$Context.Candidate; runtime=$Context.Runtime; appliedCount=$db.appliedCount; status='PREFLIGHT_PASS';
        productionChanged=$false; restoreAcceptance='PENDING';restoreStrategy=$db.restoreStrategy;
        restoreEvidenceSha256=$(if ($Context.ContainsKey('RestoreEvidence') -and $Context.RestoreEvidence) { $Context.RestoreEvidence.sha256 } else { '' });
        googleWebLogin='PENDING'; desktopLogin='PENDING'; gmail='PENDING' }
}

function Assert-TransitionApproval([string]$Actual, [string]$Expected) { Assert-Transition ($Actual -ceq $Expected) 'EXPLICIT_APPROVAL_REQUIRED' }

function Restore-TransitionRuntime($Context, $Receipt) {
    $Context.Api = [IO.Path]::GetFullPath($Context.Api).TrimEnd('\')
    $backup = [IO.Path]::GetFullPath((Join-Path $Receipt.backup 'api')).TrimEnd('\')
    $metadata = [IO.File]::ReadAllText((Join-Path $backup 'backup-manifest.json')) | ConvertFrom-Json
    Assert-Transition ((Get-TransitionHash (Join-Path $backup 'backup-manifest.json')) -eq $Receipt.backupManifestHash) 'ROLLBACK_BACKUP_MANIFEST_CORRUPT'
    Assert-Transition ([IO.Path]::GetFullPath($metadata.SourceTargetDir).TrimEnd('\') -ieq [IO.Path]::GetFullPath($Context.Api).TrimEnd('\')) 'BACKUP_TARGET_MISMATCH'
    foreach ($entry in $metadata.Entries) {
        $path = [IO.Path]::GetFullPath((Join-Path $backup $entry.RelativePath))
        Assert-Transition ($path.StartsWith($backup+'\',[StringComparison]::OrdinalIgnoreCase)) 'BACKUP_PATH_INVALID'
        Assert-Transition ((Get-TransitionHash $path) -eq $entry.Sha256.ToLowerInvariant() -and (Get-Item -LiteralPath $path).Length -eq $entry.Size) 'ROLLBACK_BACKUP_CORRUPT'
    }
    Assert-Transition ((Get-TransitionTreeHash (Join-Path $backup 'runtime')) -eq $Receipt.runtimeHash) 'ROLLBACK_RUNTIME_HASH_MISMATCH'
    Assert-Transition ((Get-TransitionHash (Join-Path $backup 'api.winsw.xml')) -eq $Receipt.xmlHash) 'ROLLBACK_XML_HASH_MISMATCH'
    Stop-Service hasarbotu-api -ErrorAction Stop
    (Get-Service hasarbotu-api).WaitForStatus('Stopped',[TimeSpan]::FromSeconds(45))
    # Restore from a working copy: preserve the immutable original backup.
    $restore = Join-Path $Receipt.backup ('restore-'+[Guid]::NewGuid().ToString('N'))
    Copy-Item -LiteralPath (Join-Path $backup 'runtime') -Destination $restore -Recurse
    Copy-Item -LiteralPath (Join-Path $backup 'runtime.manifest.json') -Destination ($restore+'.manifest.json')
    $result = Invoke-TransitionTool 'deploy-service-artifacts.ps1' @('-TargetDir',$Context.Api,'-ServiceLabel','api0191manager','-Rollback','-RollbackBackupPath',$restore,'-Apply')
    Assert-Transition ($result.Status -eq 'rolled_back') 'RUNTIME_ROLLBACK_FAILED'
    # Files moved out of an admin-only backup retain their backup ACL on NTFS.
    # Reapply the original managed-tree ACLs before starting the service account.
    foreach ($entry in @($metadata.RuntimeAcls | Sort-Object { $_.RelativePath.Length })) {
        $path = [IO.Path]::GetFullPath((Join-Path $Context.Api $entry.RelativePath))
        $segment = ($entry.RelativePath -split '[\\/]')[0]
        Assert-Transition ($segment -in @('dist','node_modules','package.json','THIRD-PARTY-NOTICES.txt') -and $path.StartsWith($Context.Api+'\',[StringComparison]::OrdinalIgnoreCase) -and $entry.RelativePath -notmatch '(^|[\\/])\.\.([\\/]|$)') 'RUNTIME_ACL_PATH_INVALID'
        $runtimeAcl = Get-Acl -LiteralPath $path
        $runtimeAcl.SetSecurityDescriptorSddlForm($entry.Sddl)
        Set-Acl -LiteralPath $path -AclObject $runtimeAcl
    }
    [IO.File]::Copy((Join-Path $backup 'api.winsw.xml'),$Context.Xml,$true)
    $acl = Get-Acl -LiteralPath $Context.Xml
    $acl.SetSecurityDescriptorSddlForm($Receipt.xmlSddl)
    Set-Acl -LiteralPath $Context.Xml -AclObject $acl
    Assert-Transition ((Get-TransitionHash $Context.Xml) -eq $Receipt.xmlHash -and (Get-TransitionTreeHash $Context.Api) -eq $Receipt.runtimeHash) 'ROLLBACK_VERIFICATION_FAILED'
    Start-Service hasarbotu-api
    (Get-Service hasarbotu-api).WaitForStatus('Running',[TimeSpan]::FromSeconds(45))
    Wait-TransitionHealth $Context $false
    $Receipt.status = 'ROLLED_BACK_PILOT_PENDING'
    # The additive migration remains; no down migration or production DB restore.
}

function Invoke-TransitionApply($Context, $Plan, [string]$StateDirectory) {
    Assert-Transition ($Plan.host -ieq $env:COMPUTERNAME -and ([DateTime]::UtcNow - [DateTime]::Parse($Plan.createdUtc).ToUniversalTime()).TotalMinutes -lt 60) 'PREFLIGHT_EXPIRED'
    Assert-Transition ((Get-TransitionHash $Context.Xml) -eq $Plan.xmlHash -and (Get-TransitionTreeHash $Context.Api) -eq $Plan.runtimeHash -and $Plan.api -ieq $Context.Api -and $Plan.runtime -ieq $Context.Runtime -and $Plan.candidate -ieq $Context.Candidate) 'PREFLIGHT_DRIFT'
    Write-Host ('RESTORE_STRATEGY '+$Plan.restoreStrategy+'; her zaman SON yedegin gercek restore/migration provasi zorunlu.')
    Write-Host 'Uretim: API durdurma, yedek, gecici _test DB restore/migration provasi, Desktop OAuth, 0075 ve API dagitimi.'
    Write-Host 'Bakim penceresi acik ve diger DB yazicilari kapali olmali. Web OAuth, Gmail, dosyalar ve eski paket korunur.'
    $expected = 'ONAY 0.1.91 DESKTOP-EFN2G33 ' + $Plan.id
    Write-Host ('Ayri acik onay icin aynen yazin: '+$expected)
    Assert-TransitionApproval (Read-Host 'Onay (bos = iptal)') $expected
    $id = $null; $secret = $null; $receipt = $null; $stopped = $false; $snapshotReady = $false; $changed = $false
    try {
        # Gather secrets before stopping production; hidden input never enters args.
        $id = Read-Host 'Google Desktop client ID (gizli)' -AsSecureString
        $secret = Read-Host 'Desktop secret (gizli; mevcut degeri korumak icin bos)' -AsSecureString
        if ($secret.Length -eq 0) { $secret.Dispose(); $secret = $null }
        # Validate OAuth/config on a protected copy before production mutation.
        $run = Join-Path $StateDirectory ('run-'+$Plan.id)
        Assert-Transition (-not (Test-Path -LiteralPath $run)) 'APPROVAL_ALREADY_CONSUMED'
        [IO.Directory]::CreateDirectory($run) | Out-Null; Protect-ApiTransitionPath $run ''
        $testXml = Join-Path $run 'candidate.xml'
        [IO.File]::Copy($Context.Xml,$testXml,$false)
        Set-ApiDesktopOAuth -XmlPath $testXml -ClientId $id -ClientSecret $secret -BackupDirectory (Join-Path $run 'oauth-validation') -ServiceSid $Context.ServiceSid
        $candidateValues = Get-ApiResolvedEnvironment -Document (Read-ApiServiceXml $testXml) -XmlPath $Context.Xml
        $probe = Invoke-TransitionProcess $Context.Node @((Join-Path $PSScriptRoot 'api-transition-probe.mjs'),$Context.Candidate) $candidateValues
        Assert-Transition ($probe.status -eq 'PASS' -and $probe.desktopOAuthConfigured -and $probe.proxyAwareRateLimit) 'OAUTH_CANDIDATE_CONFIGURATION_FAILED'
        $receipt = @{ id=$Plan.id; host=$env:COMPUTERNAME; backup=$run; api=$Context.Api; xml=$Context.Xml; serviceNode=$Context.ServiceNode; port=$Context.Values.PORT; xmlHash=$Plan.xmlHash; runtimeHash=$Plan.runtimeHash;
            xmlSddl=(Get-Acl -LiteralPath $Context.Xml).Sddl; backupManifestHash=''; status='APPROVED'; stage='stop'; snapshotReady=$false; changed=$false;
            restoreStrategy=$Plan.restoreStrategy;restoreEvidenceSha256=$Plan.restoreEvidenceSha256;googleWebLogin='PENDING'; desktopLogin='PENDING'; gmail='PENDING' }
        $receiptPath = Join-Path $StateDirectory 'active.json'
        # Recheck all inputs and original config after potentially lengthy prompts.
        Assert-Transition ((Get-TransitionHash $Context.Xml) -eq $Plan.xmlHash -and (Get-TransitionTreeHash $Context.Api) -eq $Plan.runtimeHash) 'PREFLIGHT_DRIFT'
        $fresh = Invoke-TransitionPreflight $Context
        Assert-Transition ($fresh.xmlHash -eq $Plan.xmlHash -and $fresh.runtimeHash -eq $Plan.runtimeHash -and $fresh.configHash -eq $Plan.configHash -and $fresh.restoreStrategy -ceq $Plan.restoreStrategy -and $fresh.restoreEvidenceSha256 -ceq $Plan.restoreEvidenceSha256) 'PREFLIGHT_DRIFT'
        Write-TransitionJson $receiptPath $receipt
        $stopped = $true; Stop-Service hasarbotu-api
        (Get-Service hasarbotu-api).WaitForStatus('Stopped',[TimeSpan]::FromSeconds(45))
        Invoke-TransitionDatabase $Context 'Quiescent' | Out-Null
        $receipt.stage = 'runtime_backup'; Write-TransitionJson $receiptPath $receipt
        Invoke-TransitionTool 'backup-api-transition.ps1' @('-ApiDirectory',$Context.Api,'-WinSwXml',$Context.Xml,'-BackupDirectory',(Join-Path $run 'api')) -TextResult | Out-Null
        Assert-Transition ((Get-TransitionTreeHash (Join-Path $run 'api\runtime')) -eq $Plan.runtimeHash -and (Get-TransitionHash (Join-Path $run 'api\api.winsw.xml')) -eq $Plan.xmlHash) 'BACKUP_VERIFICATION_FAILED'
        $snapshotReady = $true
        $receipt.snapshotReady = $true
        $receipt.backupManifestHash = Get-TransitionHash (Join-Path $run 'api\backup-manifest.json')
        $receipt.stage = 'database_backup'; Write-TransitionJson $receiptPath $receipt
        Invoke-TransitionDatabase $Context 'Backup' (Join-Path $run 'database') | Out-Null
        $receipt.stage = 'restore_rehearsal'; Write-TransitionJson $receiptPath $receipt
        $restored = Invoke-TransitionDatabase $Context 'ValidateBackup' (Join-Path $run 'database')
        if ($Plan.restoreStrategy -ceq 'isolated-cluster') {
            Assert-Transition ($restored.restoreAcceptance -ceq 'PASS' -and $restored.clusterStopped -and $restored.evidenceSha256) 'RESTORE_EVIDENCE_REQUIRED'
            $receipt.currentBackupRestoreEvidenceSha256 = $restored.evidenceSha256
            Write-TransitionJson $receiptPath $receipt
        }
        $receipt.stage = 'oauth'; Write-TransitionJson $receiptPath $receipt
        $changed = $true
        $receipt.changed = $true; Write-TransitionJson $receiptPath $receipt
        Set-ApiDesktopOAuth -XmlPath $Context.Xml -ClientId $id -ClientSecret $secret -BackupDirectory (Join-Path $run 'oauth') -ServiceSid $Context.ServiceSid
        $receipt.stage = 'migration'; Write-TransitionJson $receiptPath $receipt
        Invoke-TransitionDatabase $Context 'Migrate' (Join-Path $run 'database') | Out-Null
        Invoke-TransitionDatabase $Context 'Verify' (Join-Path $run 'database') | Out-Null
        $receipt.stage = 'deploy'; Write-TransitionJson $receiptPath $receipt
        $result = Invoke-TransitionTool 'deploy-service-artifacts.ps1' ((Get-TransitionDeployArguments $Context $Context.Api) + @('-Apply'))
        Assert-Transition ($result.Status -in @('applied','already_up_to_date')) 'API_DEPLOY_FAILED'
        $receipt.stage = 'health'; Write-TransitionJson $receiptPath $receipt
        Start-Service hasarbotu-api
        (Get-Service hasarbotu-api).WaitForStatus('Running',[TimeSpan]::FromSeconds(45))
        Wait-TransitionHealth $Context $true
        $receipt.status = 'DEPLOYED_PILOT_PENDING'; $receipt.stage = 'pilot'
        Write-TransitionJson $receiptPath $receipt
        Write-Host 'DEPLOYED_PILOT_PENDING: Web/desktop Google girisi ve mevcut Gmail baglantisi gercek kullaniciyla dogrulanmadi. Feed degismedi.'
    } catch {
        $failure = $_
        if ($stopped) {
            try {
                if ($changed -and $snapshotReady) { Restore-TransitionRuntime $Context $receipt }
                else { Start-Service hasarbotu-api; (Get-Service hasarbotu-api).WaitForStatus('Running',[TimeSpan]::FromSeconds(45)); Wait-TransitionHealth $Context $false; $receipt.status = 'ABORTED_ORIGINAL_API_RUNNING' }
                Write-TransitionJson (Join-Path $StateDirectory 'active.json') $receipt
                Write-Host $receipt.status
            } catch {
                if ($receipt) { $receipt.status = 'ROLLBACK_FAILED_DO_NOT_CONTINUE'; Write-TransitionJson (Join-Path $StateDirectory 'active.json') $receipt }
                Write-Host 'ROLLBACK_FAILED_DO_NOT_CONTINUE: yedekler korundu, ayni baslaticida GERI secenegi kullanilabilir.'
            }
        }
        throw $failure
    } finally { if ($id) { $id.Dispose() }; if ($secret) { $secret.Dispose() } }
}

function Get-TransitionRollbackContext($Receipt, [string]$WinSwXml) {
    Assert-Transition ($Receipt.host -ieq [Environment]::MachineName) 'RECEIPT_HOST_MISMATCH'
    $service = Get-CimInstance Win32_Service -Filter "Name='hasarbotu-api'"
    Assert-Transition ($null -ne $service) 'INSTALLED_API_SERVICE_REQUIRED'
    $xml = Get-TransitionServiceXml $service.PathName $WinSwXml
    Assert-Transition ($xml -ieq $Receipt.xml) 'RECEIPT_SERVICE_XML_MISMATCH'
    foreach ($path in @($Receipt.api,$Receipt.xml,$Receipt.serviceNode)) { Assert-TransitionPath $path }
    Assert-Transition ($Receipt.port -match '^\d+$' -and [int]$Receipt.port -gt 0 -and [int]$Receipt.port -le 65535) 'RECEIPT_PORT_INVALID'
    # Recovery needs the immutable backup and manager package only. Neither the
    # candidate, runtime ZIP nor a parsable current OAuth XML is required.
    return @{Api=$Receipt.api;Xml=$xml;ServiceNode=$Receipt.serviceNode;Values=@{PORT=$Receipt.port};Origin=('http://127.0.0.1:'+$Receipt.port)}
}

function Invoke-TransitionSession($Context, [string]$StateDirectory, [switch]$Apply) {
    $planPath = Join-Path $StateDirectory 'preflight.json'
    $priorPlan = if (Test-Path -LiteralPath $planPath) { [IO.File]::ReadAllText($planPath) | ConvertFrom-Json } else { $null }
    Write-Host 'PREFLIGHT: salt okunur DB/kaynak/servis kontrolu ve adayin import/config testi. Servis durdurulmaz.'
    $plan = Invoke-TransitionPreflight $Context
    Write-TransitionJson $planPath $plan
    if ($priorPlan) { Assert-Transition ($priorPlan.xmlHash -eq $plan.xmlHash -and $priorPlan.runtimeHash -eq $plan.runtimeHash) 'PREVIOUS_PREFLIGHT_DRIFT_RUN_AGAIN' }
    Write-Host 'PREFLIGHT_PASS_PRODUCTION_UNCHANGED'
    Write-Host 'Gercek Google Web/Desktop girisi ve Gmail kabul testleri PENDING. Installer/feed degismedi.'
    if (-not $Apply -or -not $priorPlan) {
        Write-Host 'SALT_OKUNUR_TAMAMLANDI. Uretim gecisi icin ayri -Apply calistirmasi ve islem kimlikli ONAY gerekir.'
        return
    }
    Invoke-TransitionApply $Context $plan $StateDirectory
}

Export-ModuleMember -Function Assert-Transition, Get-TransitionDiagnostic, Invoke-TransitionCheck, ConvertTo-TransitionArgument, Invoke-TransitionProcess, Invoke-TransitionTool, Get-TransitionHash, Get-TransitionConfigHash, Assert-TransitionPath, Get-TransitionTreeHash, Write-TransitionJson, Get-TransitionContext, Get-TransitionRollbackContext, Invoke-TransitionPreflight, Assert-TransitionApproval, Invoke-TransitionApply, Restore-TransitionRuntime, Invoke-TransitionSession, Wait-TransitionHealth, Read-TransitionRestoreCredential, Invoke-TransitionDatabase
