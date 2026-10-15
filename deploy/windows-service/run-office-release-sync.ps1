param(
  [Parameter(Mandatory=$true)][string]$Configuration,
  [Parameter(Mandatory=$true)][string]$NodeExecutable,
  [Parameter(Mandatory=$true)][string]$SyncScript,
  [switch]$CheckAccess
)
$ErrorActionPreference='Stop'
if(-not [IO.Path]::IsPathRooted($Configuration)){throw 'ABSOLUTE_SYNC_CONFIGURATION_REQUIRED'}
$config=Get-Content -LiteralPath $Configuration -Raw -Encoding UTF8|ConvertFrom-Json
$credential=Join-Path ([IO.Path]::GetDirectoryName($Configuration)) 'github-token.dpapi'
$previous=$env:GH_TOKEN
$secretPointer=[IntPtr]::Zero
try {
  if(Test-Path -LiteralPath $credential){
    $secure=Get-Content -LiteralPath $credential -Raw -Encoding UTF8|ConvertTo-SecureString
    $secretPointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $env:GH_TOKEN=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
  }
  if($CheckAccess){
    $start=[Diagnostics.ProcessStartInfo]::new()
    $start.FileName=$config.githubExecutable
    $start.Arguments='api --hostname github.com repos/Josquexecute/HasarBotuV2'
    $start.UseShellExecute=$false;$start.CreateNoWindow=$true
    $start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
    $process=[Diagnostics.Process]::Start($start)
    $output=$process.StandardOutput.ReadToEndAsync();$errors=$process.StandardError.ReadToEndAsync()
    if(-not $process.WaitForExit(30000)){$process.Kill();throw 'GITHUB_ACCESS_CHECK_TIMEOUT'}
    $text=$output.GetAwaiter().GetResult();$null=$errors.GetAwaiter().GetResult()
    if($process.ExitCode -ne 0){throw 'GITHUB_AUTH_REQUIRED_FOR_THIS_WINDOWS_USER'}
    $repository=$text|ConvertFrom-Json
    if($repository.full_name -ne 'Josquexecute/HasarBotuV2' -or -not $repository.private){throw 'PRIVATE_SOURCE_ACCESS_REQUIRED'}
    Write-Output 'PRIVATE_SOURCE_ACCESS_VERIFIED'
  }else{
    & $NodeExecutable $SyncScript $Configuration
    if($LASTEXITCODE -ne 0){throw 'OFFICE_RELEASE_SYNC_FAILED_SEE_STATUS_JSON'}
  }
}finally{
  $env:GH_TOKEN=$previous
  if($secretPointer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)}
}
