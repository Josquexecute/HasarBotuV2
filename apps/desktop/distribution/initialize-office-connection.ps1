param([switch]$Apply,[switch]$Remove)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'office-hosts.psm1') -Force
$officeProfile=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'office-connection.json') -Raw -Encoding UTF8|ConvertFrom-Json
if(($officeProfile.PSObject.Properties.Name|Sort-Object) -join ',' -ne 'apiOrigin,lanHostname,lanIpv4,schemaVersion' -or $officeProfile.schemaVersion -ne 1){throw 'INVALID_OFFICE_PROFILE'}
$origin=[Uri]$officeProfile.apiOrigin
if($origin.Scheme -ne 'https' -or $origin.Port -ne 443 -or $origin.UserInfo -or $origin.AbsolutePath -ne '/' -or $origin.Query -or $origin.Fragment -or $origin.Host -notmatch '^[a-zA-Z0-9][a-zA-Z0-9.-]+$' -or $officeProfile.lanHostname -notmatch '^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$'){throw 'INVALID_OFFICE_PROFILE'}
$configuredAddress=[Net.IPAddress]::Parse($officeProfile.lanIpv4)
if($configuredAddress.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or $officeProfile.lanIpv4 -notmatch '^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)'){throw 'INVALID_LAN_ADDRESS'}

function Test-OfficeTlsEndpoint([string]$Address) {
 $client=[Net.Sockets.TcpClient]::new()
 $ssl=$null
 try{
  $connect=$client.ConnectAsync($Address,443)
  if(-not $connect.Wait(1800)){return $false}
  $connect.GetAwaiter().GetResult()
  $ssl=[Net.Security.SslStream]::new($client.GetStream(),$false)
  $ssl.ReadTimeout=3500;$ssl.WriteTimeout=3500
  # Standard chain and hostname validation remain enabled, even when connecting by LAN IP.
  $authentication=$ssl.AuthenticateAsClientAsync($origin.Host)
  if(-not $authentication.Wait(3500)){return $false}
  $authentication.GetAwaiter().GetResult()
  $request=[Text.Encoding]::ASCII.GetBytes("GET /health HTTP/1.0`r`nHost: $($origin.Host)`r`nAccept: application/json`r`nConnection: close`r`n`r`n")
  $ssl.Write($request,0,$request.Length)
  $buffer=[byte[]]::new(8192);$received=0
  do{$read=$ssl.Read($buffer,$received,$buffer.Length-$received);$received+=$read;if($received -eq $buffer.Length){throw 'OFFICE_HEALTH_RESPONSE_TOO_LARGE'}}while($read -gt 0)
  $response=[Text.Encoding]::UTF8.GetString($buffer,0,$received)
  if($response -notmatch '^HTTP/1\.[01] 200 '){return $false}
  $body=($response -split "`r`n`r`n",2)[1]|ConvertFrom-Json
  return $body.status -eq 'ok' -and $body.service -eq 'hasarbotu-api'
 }catch [AggregateException]{return $false}catch [IO.IOException]{return $false}catch [Net.Sockets.SocketException]{return $false}catch [System.Security.Authentication.AuthenticationException]{return $false}
 finally{if($ssl){$ssl.Dispose()};$client.Dispose()}
}

$hosts=Join-Path ([Environment]::GetFolderPath('System')) 'drivers/etc/hosts'
$original=[IO.File]::ReadAllBytes($hosts)
$address=$officeProfile.lanIpv4
if(-not $Remove){
 $available=Test-OfficeTlsEndpoint $address
 if(-not $available){
  try{$candidates=@([Net.Dns]::GetHostAddresses($officeProfile.lanHostname)|Where-Object {$_.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork -and $_.ToString() -match '^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)'})}catch [Net.Sockets.SocketException]{$candidates=@()}
  foreach($candidate in $candidates){if(Test-OfficeTlsEndpoint $candidate.ToString()){$address=$candidate.ToString();$available=$true;break}}
 }
 if(-not $available){@{status='remote_required'}|ConvertTo-Json -Compress;exit 0}
}
try{$updated=Update-OfficeHostsContent -Bytes $original -Hostname $origin.Host -Address $address -Remove:$Remove}
catch{if($_.Exception.Message -eq 'EXISTING_DNS_CONFLICT'){@{status='existing_dns_conflict'}|ConvertTo-Json -Compress;exit 0};throw}
if([Convert]::ToBase64String($original) -eq [Convert]::ToBase64String($updated)){@{status='configured'}|ConvertTo-Json -Compress;exit 0}
$principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
 if($Apply){throw 'ADMINISTRATOR_REQUIRED'}
 $arguments=@('-NoProfile','-NonInteractive','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-Apply')
 if($Remove){$arguments+='-Remove'}
 try{$process=Start-Process -FilePath (Join-Path ([Environment]::GetFolderPath('System')) 'WindowsPowerShell/v1.0/powershell.exe') -ArgumentList $arguments -Verb RunAs -WindowStyle Hidden -Wait -PassThru}
 catch [ComponentModel.Win32Exception]{if($_.Exception.NativeErrorCode -eq 1223){@{status='approval_declined'}|ConvertTo-Json -Compress;exit 0};throw}
 if($process.ExitCode -ne 0){throw 'OFFICE_DNS_SETUP_FAILED'}
 @{status='configured'}|ConvertTo-Json -Compress;exit 0
}
if((Get-Item -LiteralPath $hosts).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'UNSAFE_HOSTS_FILE'}
$stream=[IO.File]::Open($hosts,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::Read)
try{
 $current=[byte[]]::new($stream.Length);$read=$stream.Read($current,0,$current.Length)
 if($read -ne $current.Length -or [Convert]::ToBase64String($current) -ne [Convert]::ToBase64String($original)){throw 'HOSTS_FILE_CHANGED'}
 $backup=$hosts+'.before-hasarbotu'
 if(-not(Test-Path -LiteralPath $backup)){[IO.File]::WriteAllBytes($backup,$original)}
 $stream.Position=0;$stream.Write($updated,0,$updated.Length);$stream.SetLength($updated.Length);$stream.Flush($true)
}finally{$stream.Dispose()}
Clear-DnsClientCache
@{status='configured'}|ConvertTo-Json -Compress
