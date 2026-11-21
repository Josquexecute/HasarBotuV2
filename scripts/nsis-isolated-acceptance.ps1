param([Parameter(Mandatory=$true)][string]$Root)
$ErrorActionPreference='Stop'
$plan=Get-Content -LiteralPath (Join-Path $root 'plan.json') -Raw | ConvertFrom-Json
$result=@{status='RUNNING';at=[DateTime]::UtcNow.ToString('o');installations=@();checks=@();productionProfileUsed=$false;productionDatabaseChanged=$false;screenshots=$false}
function Check([string]$Name,[bool]$Pass){if(-not $Pass){throw $Name};$script:result.checks+=@{name=$Name;pass=$true}}
function NativeAcl([string]$Path){(Get-Acl -LiteralPath $Path).Sddl}
try {
 $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
 $principal=[Security.Principal.WindowsPrincipal]::new($identity)
 Check 'exact disposable standard user' ($identity.User.Value -ceq $plan.sid -and $env:USERNAME -ceq $plan.user -and -not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))
 $os=Get-CimInstance Win32_OperatingSystem
 Check 'real Windows 11' ($os.Caption -like '*Windows 11*' -and [int]$os.BuildNumber -ge 22000)
 $result.os=@{caption=$os.Caption;build=$os.BuildNumber};$result.sid=$identity.User.Value;$result.sessionId=(Get-Process -Id $PID).SessionId
 $profile=[Environment]::GetFolderPath('UserProfile')
 Check 'fresh account profile isolated from office user' ($profile -ieq ('C:\Users\'+$plan.user))
 $target=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs\HasarBotu'
 Check 'install target belongs only to disposable account' ($target.StartsWith($profile+'\',[StringComparison]::OrdinalIgnoreCase) -and -not (Test-Path -LiteralPath $target))
 $preferences=Join-Path ([Environment]::GetFolderPath('ApplicationData')) '@hasarbotu\desktop'
 $legacy=Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'hasarbotu-baran-ekspertiz'
 foreach($path in @($preferences,$legacy)){
  [IO.Directory]::CreateDirectory($path)|Out-Null
  [IO.File]::WriteAllText((Join-Path $path 'assistant-position.json'),'{"x":32,"y":64}',[Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText((Join-Path $path 'synthetic-draft.txt'),'HasarBotu 0.1.99 -> 0.1.100 -> 0.1.99 synthetic unsaved draft',[Text.UTF8Encoding]::new($false))
 }
 $baseFiles=@(foreach($p in @($preferences,$legacy)){Get-ChildItem -LiteralPath $p -File|ForEach-Object{@{path=$_.FullName;sha256=(Get-FileHash -LiteralPath $_.FullName).Hash}}})
 $helper=Join-Path $root 'nsis-upgrade-acceptance.ps1'
 $backup=Join-Path $env:LOCALAPPDATA 'HasarBotuUpdateBackups\isolated-0100'
 & $helper -Action PrivateRoot -Value $backup | Out-Null
 $config=Join-Path $backup 'control.json'
 $registryFile=Join-Path $backup 'registry.json'
 $metadataFile=Join-Path $backup 'metadata.json'
 @{registryFile=$registryFile;metadataFile=$metadataFile;scopes=@(@{name='v2-profile';path=$preferences;directory=$true},@{name='legacy-profile';path=$legacy;directory=$true})}|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $config -Encoding UTF8
 & $helper -Action FsMetadata -Config $config | Out-Null
 $profileRootAcl=NativeAcl $profile
 $stepIndex=0
 foreach($step in @(@{version='0.1.99';file='old.exe';hash=$plan.oldHash},@{version='0.1.100';file='new.exe';hash=$plan.newHash},@{version='0.1.99';file='old.exe';hash=$plan.oldHash})){
  $installer=Join-Path $root $step.file
  Check ($step.version+': immutable installer hash') ((Get-FileHash -LiteralPath $installer).Hash -ieq $step.hash)
  $sig=Get-AuthenticodeSignature -LiteralPath $installer
  Check ($step.version+': trusted timestamped installer') ($sig.Status -eq 'Valid' -and $sig.SignerCertificate.Thumbprint -ieq $plan.signer -and $null -ne $sig.TimeStamperCertificate)
  $owned=@(Get-CimInstance Win32_Process|Where-Object{$_.ExecutablePath -and $_.ExecutablePath.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase)})
  Check ($step.version+': isolated target has no running client') ($owned.Count -eq 0)
  $process=Start-Process -FilePath $installer -ArgumentList @('/currentuser','/S','--updated',('/D='+$target)) -WindowStyle Hidden -PassThru
  if(-not $process.WaitForExit(180000)){throw 'OWNED_INSTALLER_TIMEOUT'}
  $process.Refresh()
  Check ($step.version+': real NSIS exit zero') ($process.ExitCode -eq 0)
  $exe=Join-Path $target 'HasarBotu.exe';$file=Get-Item -LiteralPath $exe;$sig=Get-AuthenticodeSignature -LiteralPath $exe
  Check ($step.version+': installed signed version') ($file.VersionInfo.ProductVersion -in @($step.version,($step.version+'.0')) -and $sig.Status -eq 'Valid' -and $sig.SignerCertificate.Thumbprint -ieq $plan.signer -and $null -ne $sig.TimeStamperCertificate)
  foreach($entry in $baseFiles){Check ($step.version+': profile bytes preserved') ((Get-FileHash -LiteralPath $entry.path).Hash -ceq $entry.sha256)}
  # Other accounts' office clients stay running. Verify every saved item in our
  # disposable profile directly; no restore or production-profile write occurs.
  $metadata=Get-Content -LiteralPath $metadataFile -Raw|ConvertFrom-Json
  foreach($entry in $metadata){
   Check 'metadata path belongs to disposable profile' ($entry.path.StartsWith($profile+'\',[StringComparison]::OrdinalIgnoreCase))
   $item=Get-Item -LiteralPath $entry.path -Force
   Check ($step.version+': exact profile metadata and ACL preserved') ((NativeAcl $entry.path) -ceq $entry.sddl -and [int]$item.Attributes -eq $entry.attributes -and $item.CreationTimeUtc.ToString('o') -ceq $entry.created -and $item.LastWriteTimeUtc.ToString('o') -ceq $entry.written)
  }
  Check ($step.version+': profile root ACL preserved') ((NativeAcl $profile) -ceq $profileRootAcl)
  if($stepIndex -eq 0){
   & $helper -Action RegistrySnapshot -Config $config | Out-Null
   & $helper -Action RegistryVerify -Config $config | Out-Null
   $baselineRegistry=Get-Content -LiteralPath $registryFile -Raw | ConvertFrom-Json
   Check 'four baseline registry roots serialized and verified' ($baselineRegistry.Count -eq 4)
  }elseif($stepIndex -eq 1){
   $candidateFile=Join-Path $backup 'candidate-registry.json';$candidateConfig=Join-Path $backup 'candidate-control.json'
   @{registryFile=$candidateFile}|ConvertTo-Json|Set-Content -LiteralPath $candidateConfig -Encoding UTF8
   & $helper -Action RegistrySnapshot -Config $candidateConfig | Out-Null
   $candidateRegistry=Get-Content -LiteralPath $candidateFile -Raw|ConvertFrom-Json
   foreach($baseline in $baselineRegistry){
    $current=$candidateRegistry|Where-Object name -CEQ $baseline.name
    Check 'upgrade retains registry key existence' ($current.exists -eq $baseline.exists)
    foreach($entry in $baseline.entries){$actual=$current.entries|Where-Object path -CEQ $entry.path;Check 'upgrade preserves registry owner group DACL and inheritance' ($actual.sddl -ceq $entry.sddl)}
   }
  }else{
   & $helper -Action RegistryVerify -Config $config | Out-Null
   Check 'rollback restores exact registry values kinds owner group DACL and inheritance' $?
  }
  $result.installations+=@{version=$step.version;exitCode=$process.ExitCode;signature=[string]$sig.Status;installerSha256=$step.hash;exeSha256=(Get-FileHash -LiteralPath $exe).Hash.ToLower();profilesPreserved=$true}
  $stepIndex++
 }
 Check 'three real NSIS transitions completed' ($result.installations.Count -eq 3)
 $result.status='PASS';$result.profileFiles=$baseFiles.Count;$result.installedPath=$target
 Copy-Item -LiteralPath $registryFile -Destination (Join-Path $root 'output\baseline-registry.json')
 Copy-Item -LiteralPath $metadataFile -Destination (Join-Path $root 'output\baseline-profile-metadata.json')
}catch{$result.status='FAIL';$result.error=$_.Exception.Message}
finally{$result.finishedAt=[DateTime]::UtcNow.ToString('o');[IO.File]::WriteAllText((Join-Path $root 'output\result.json'),($result|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))}
if($result.status -ne 'PASS'){exit 1}
