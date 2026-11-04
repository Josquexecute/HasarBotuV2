#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding()]
param([string]$RuntimeDirectory, [string]$WinSwXml, [switch]$Rehearse)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$stage='package_integrity'
try {
    # Validate this entry point's entire package before importing modules.
    $manifest=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'manager-manifest.json')) | ConvertFrom-Json
    foreach ($entry in $manifest.files) {
        $path=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot $entry.path))
        if (-not $path.StartsWith($PSScriptRoot+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'MANAGER_MANIFEST_INVALID' }
        if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ine $entry.sha256 -or (Get-Item -LiteralPath $path).Length -ne $entry.size) { throw 'MANAGER_PACKAGE_HASH_MISMATCH' }
    }
    if ([Environment]::MachineName -ine 'DESKTOP-EFN2G33') { throw 'OFFICE_SERVER_REQUIRED' }
    $manager=Import-Module (Join-Path $PSScriptRoot 'api-transition-manager.psm1') -PassThru -Force -DisableNameChecking
    Import-Module (Join-Path $PSScriptRoot 'api-transition-secrets.psm1') -Force -DisableNameChecking
    $stage='service_discovery'
    $service=Get-CimInstance Win32_Service -Filter "Name='hasarbotu-api'"
    Assert-Transition ($null -ne $service -and $service.State -eq 'Running' -and $service.ProcessId -gt 0) 'RUNNING_API_SERVICE_REQUIRED'
    $xml=& $manager { param($Command,$Explicit) Get-TransitionServiceXml $Command $Explicit } $service.PathName $WinSwXml
    $process=Get-CimInstance Win32_Process -Filter ('ProcessId='+$service.ProcessId)
    Assert-Transition ($process.ExecutablePath -ieq [IO.Path]::ChangeExtension($xml,'.exe')) 'SERVICE_WRAPPER_PROCESS_MISMATCH'
    $document=Read-ApiServiceXml $xml
    Assert-Transition ($document.SelectNodes('/service/id').Count -eq 1 -and $document.SelectSingleNode('/service/id').InnerText -ceq 'hasarbotu-api') 'SERVICE_ID_MISMATCH'
    $values=Get-ApiResolvedEnvironment -Document $document -XmlPath $xml
    $xmlHash=Get-TransitionHash $xml
    $RuntimeDirectory=& $manager { param($Directory) Find-TransitionRuntime $Directory } $RuntimeDirectory
    Assert-TransitionPath $RuntimeDirectory
    Assert-Transition ((Get-TransitionHash (Join-Path $RuntimeDirectory 'package-manifest.json')) -eq '5f68199d93a85dd422cc475fb30e7a9d3187da0a90c17d7dfac899434c596153') 'VERIFIED_0191_RUNTIME_REQUIRED'
    Invoke-TransitionTool 'verify-api-transition-package.ps1' @('-Directory',$RuntimeDirectory) -TextResult | Out-Null
    $pg=Get-CimInstance Win32_Service -Filter "Name='postgresql-x64-17'"
    Assert-Transition ($null -ne $pg -and $pg.State -eq 'Running') 'RUNNING_POSTGRESQL17_SERVICE_REQUIRED'
    $command=[regex]::Match($pg.PathName.Trim(),'^(?:"([^"\r\n]+\.exe)"|([A-Za-z]:\\[^"\r\n]*?\.exe))(?:\s|$)','IgnoreCase')
    Assert-Transition $command.Success 'POSTGRESQL_SERVICE_COMMAND_UNSUPPORTED'
    $pgExe=if($command.Groups[1].Success){$command.Groups[1].Value}else{$command.Groups[2].Value}
    Assert-TransitionPath $pgExe
    $pgBin=Split-Path $pgExe -Parent
    foreach($name in @('psql.exe','pg_dump.exe','pg_restore.exe')) {
        $tool=Join-Path $pgBin $name
        Assert-TransitionPath $tool
        Assert-Transition ((Invoke-TransitionProcess $tool @('--version') -TextResult) -match '\b17\.') 'POSTGRESQL17_TOOLS_REQUIRED'
    }
    $hbaPaths=@()
    $data=[regex]::Match($pg.PathName,'(?:^|\s)-D\s+(?:"([^"\r\n]+)"|([^\s"\r\n]+))')
    if($data.Success) { $dataPath=if($data.Groups[1].Success){$data.Groups[1].Value}else{$data.Groups[2].Value}; $hbaPaths+=Join-Path $dataPath 'pg_hba.conf' }
    $registryMetadata=$false
    $installerRole=''
    $installation='HKLM:\SOFTWARE\PostgreSQL\Installations\postgresql-x64-17'
    if(Test-Path -LiteralPath $installation) {
        $registryMetadata=$true
        try { $dataPath=Get-ItemPropertyValue -LiteralPath $installation -Name 'Data Directory'; if($dataPath){$hbaPaths+=Join-Path $dataPath 'pg_hba.conf'} } catch { Write-Host 'INSTALLATION_DATA_PATH_UNAVAILABLE' }
        try { $installerRole=[string](Get-ItemPropertyValue -LiteralPath $installation -Name 'Super User') } catch { Write-Host 'INSTALLATION_ROLE_METADATA_UNAVAILABLE' }
    }
    $passFiles=@();$serviceFiles=@()
    foreach($scope in @('Process','User','Machine')) {
        $pass=[Environment]::GetEnvironmentVariable('PGPASSFILE',$scope)
        $profile=[Environment]::GetEnvironmentVariable('PGSERVICEFILE',$scope)
        $systemDirectory=[Environment]::GetEnvironmentVariable('PGSYSCONFDIR',$scope)
        if($pass){$passFiles+=$pass};if($profile){$serviceFiles+=$profile}
        if($systemDirectory){$serviceFiles+=Join-Path $systemDirectory 'pg_service.conf'}
    }
    $passFiles+=Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'postgresql\pgpass.conf'
    $serviceFiles+=Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'postgresql\.pg_service.conf'
    $serviceFiles+=Join-Path (Split-Path $pgBin) 'etc\pg_service.conf'
    $pgConfig=Join-Path $pgBin 'pg_config.exe'
    if(Test-Path -LiteralPath $pgConfig -PathType Leaf){Assert-TransitionPath $pgConfig;$systemDirectory=Invoke-TransitionProcess $pgConfig @('--sysconfdir') -TextResult;$serviceFiles+=Join-Path $systemDirectory 'pg_service.conf'}
    $stage='local_postgres_inspection'
    $request=@{databaseUrl=$values.DATABASE_URL;runtime=$RuntimeDirectory;pgBin=$pgBin;installerRole=$installerRole;hbaPaths=@($hbaPaths | Select-Object -Unique);passFiles=@($passFiles | Select-Object -Unique);serviceFiles=@($serviceFiles | Select-Object -Unique);rehearse=[bool]$Rehearse}
    $childEnvironment=@{SystemRoot=$env:SystemRoot;PATH=$env:PATH;TEMP=$env:TEMP;TMP=$env:TMP;APPDATA=$env:APPDATA;USERPROFILE=$env:USERPROFILE;COMSPEC=$env:COMSPEC}
    try { $result=Invoke-TransitionProcess -Executable (Join-Path $RuntimeDirectory 'node\node.exe') -Arguments @((Join-Path $PSScriptRoot 'inspect-local-postgres.mjs')) -EnvironmentValues $childEnvironment -InputText ($request | ConvertTo-Json -Depth 5 -Compress) }
    finally { $request.Clear();$values.Clear() }
    $current=Get-CimInstance Win32_Service -Filter "Name='hasarbotu-api'"
    Assert-Transition ($current.State -eq 'Running' -and $current.ProcessId -eq $service.ProcessId -and (Get-TransitionHash $xml) -ceq $xmlHash) 'PRODUCTION_CHANGED_DURING_INSPECTION'
    $result | Add-Member NoteProperty installationMetadataFound $registryMetadata
    $result | Add-Member NoteProperty pgAdminProfilePresent (Test-Path -LiteralPath (Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'pgAdmin\pgadmin4.db'))
    $result | ConvertTo-Json -Depth 7
    if($result.status -eq 'BLOCKED'){exit 2}
} catch {
    $known=@('OFFICE_SERVER_REQUIRED','MANAGER_MANIFEST_INVALID','MANAGER_PACKAGE_HASH_MISMATCH')
    $code=if($_.Exception.Message -in $known){$_.Exception.Message}else{'LOCAL_POSTGRES_INSPECTION_FAILED'}
    if(Get-Command Get-TransitionDiagnostic -ErrorAction SilentlyContinue){$safe=Get-TransitionDiagnostic $_ $stage $code;$stage=$safe.stage;$code=$safe.code}
    Write-Host ('STOP stage='+$stage+' code='+$code)
    exit 1
}
