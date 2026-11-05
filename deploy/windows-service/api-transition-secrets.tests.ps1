#Requires -Version 5.1
#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'api-transition-secrets.psm1') -Force
$root = Join-Path $env:TEMP ('hb-oauth-test-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($root) | Out-Null
$checks = 0
function Assert([bool]$condition) { if (-not $condition) { throw 'OAUTH_REGRESSION_FAILED' }; $script:checks++ }
$xml = Join-Path $root 'api.xml'
$fixture = '<service><id>hasarbotu-api</id><executable>node</executable><env name="GOOGLE_CLIENT_ID" value="old.apps.googleusercontent.com"/><env name="GOOGLE_CLIENT_SECRET" value="web&amp;secret&quot;x"/><env name="GOOGLE_REDIRECT_URI" value="https://office.example.test/api/v1/google/callback"/><env name="HOST" value="127.0.0.1"/><env name="DATABASE_URL" value="postgres://synthetic:synthetic@127.0.0.1/hb_test"/></service>'
$id = ConvertTo-SecureString 'new.apps.googleusercontent.com' -AsPlainText -Force
$secret = ConvertTo-SecureString 'desktop&secret"x' -AsPlainText -Force
try {
    $fixture = $fixture.Replace('<id>hasarbotu-api</id>','<id>hasarbotu-api</id><name>HasarBotu V2 - Merkezi API</name>')
    [IO.File]::WriteAllText($xml,$fixture)
    $document = Read-ApiServiceXml $xml
    Assert ($document.DocumentElement.Name -cne 'service') # Reproduce adapter shadowing.
    Assert ($document.DocumentElement.get_Name() -ceq 'service')
    foreach ($invalid in @('<settings><name>service</name></settings>','<Service/>','<service xmlns="urn:unexpected"/>','<!DOCTYPE service [<!ENTITY secret "hidden">]><service/>','<service>')) {
        [IO.File]::WriteAllText($xml,$invalid)
        $failed=$false
        try { Read-ApiServiceXml $xml | Out-Null } catch { $failed=$true }
        Assert $failed
    }
    [IO.File]::WriteAllText($xml,$fixture)
    $before = Get-ApiServiceEnvironment (Read-ApiServiceXml $xml)
    $output = @(Set-ApiDesktopOAuth -XmlPath $xml -ClientId $id -ClientSecret $secret -BackupDirectory (Join-Path $root 'backup') -ServiceSid 'S-1-5-18')
    Assert ($output.Count -eq 0)
    $after = Get-ApiServiceEnvironment (Read-ApiServiceXml $xml)
    foreach ($key in $before.Keys) { Assert ($before[$key] -ceq $after[$key]) }
    Assert ($after.GOOGLE_DESKTOP_CLIENT_SECRET -ceq 'desktop&secret"x')
    Assert ($after.GOOGLE_DESKTOP_CLIENT_ID -ceq 'new.apps.googleusercontent.com')
    Assert ($after.TRUST_LOOPBACK_PROXY -eq 'true')
    Assert ([IO.File]::ReadAllText((Join-Path $root 'backup/api.winsw.xml')) -ceq $fixture)
    $acl = Get-Acl -LiteralPath $xml
    Assert $acl.AreAccessRulesProtected
    Assert (@($acl.Access | Where-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin @('S-1-5-18','S-1-5-32-544') }).Count -eq 0)
    Set-ApiDesktopOAuth -XmlPath $xml -ClientId $id -BackupDirectory (Join-Path $root 'backup2') -ServiceSid 'S-1-5-18'
    Assert ((Get-ApiServiceEnvironment (Read-ApiServiceXml $xml)).GOOGLE_DESKTOP_CLIENT_SECRET -ceq 'desktop&secret"x')
    Set-ApiDesktopOAuth -XmlPath $xml -ClientId $id -RemoveDesktopSecret -BackupDirectory (Join-Path $root 'backup3') -ServiceSid 'S-1-5-18'
    Assert (-not (Get-ApiServiceEnvironment (Read-ApiServiceXml $xml)).ContainsKey('GOOGLE_DESKTOP_CLIENT_SECRET'))
    [IO.File]::WriteAllText($xml,$fixture.Replace('value="127.0.0.1"','value="0.0.0.0"'))
    $failed = $false
    try { Set-ApiDesktopOAuth -XmlPath $xml -ClientId $id -BackupDirectory (Join-Path $root 'bad') -ServiceSid 'S-1-5-18' } catch { $failed = $_.Exception.Message -eq 'LOOPBACK_BIND_REQUIRED' }
    Assert $failed
    Assert (-not (Test-Path -LiteralPath (Join-Path $root 'bad')))
    [IO.File]::WriteAllText($xml,$fixture.Replace('</service>','<env name="GOOGLE_CLIENT_ID" value="duplicate"/></service>'))
    $failed = $false
    try { Get-ApiServiceEnvironment (Read-ApiServiceXml $xml) | Out-Null } catch { $failed = $_.Exception.Message -eq 'DUPLICATE_OR_EMPTY_ENV_NAME' }
    Assert $failed
    # Snapshot manifests must use ordered object properties, not unordered
    # hashtable keys: the existing rollback reader compares sorted entries.
    $apiFixture = Join-Path $root 'service'
    [IO.Directory]::CreateDirectory((Join-Path $apiFixture 'dist')) | Out-Null
    [IO.File]::WriteAllText((Join-Path $apiFixture 'dist\z.js'),'last')
    [IO.File]::WriteAllText((Join-Path $apiFixture 'dist\a.js'),'first')
    [IO.File]::WriteAllText((Join-Path $apiFixture 'package.json'),'{"name":"fixture"}')
    function Get-Service { [pscustomobject]@{ Status='Stopped' } }
    $snapshot = Join-Path $root 'snapshot'
    $backupOutput = & (Join-Path $PSScriptRoot 'backup-api-transition.ps1') -ApiDirectory $apiFixture -WinSwXml $xml -BackupDirectory $snapshot
    Assert ($backupOutput -eq 'API_AND_WINSW_BACKUP_HASH_VERIFIED_ADMIN_ONLY')
    $restoreOutput = & (Join-Path $PSScriptRoot 'deploy-service-artifacts.ps1') -TargetDir $apiFixture -ServiceLabel oauthsnapshot -Rollback -RollbackBackupPath (Join-Path $snapshot 'runtime') -Apply 6>$null
    Assert (($restoreOutput | ConvertFrom-Json).Status -eq 'rolled_back')
    Assert ([IO.File]::ReadAllText((Join-Path $apiFixture 'dist\a.js')) -eq 'first')
    Assert ([IO.File]::ReadAllText((Join-Path $apiFixture 'dist\z.js')) -eq 'last')
    Write-Output "OAUTH_SECRET_TESTS_PASS_$checks"
} finally {
    $id.Dispose(); $secret.Dispose()
    $resolved = [IO.Path]::GetFullPath($root)
    if (-not $resolved.StartsWith([IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\hb-oauth-test-',[StringComparison]::OrdinalIgnoreCase)) { throw 'UNSAFE_TEST_CLEANUP' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
