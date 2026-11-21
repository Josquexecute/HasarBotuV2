param(
  [Parameter(Mandatory=$true)][ValidateSet('PrivateRoot','Processes','Signature','RegistrySnapshot','RegistryRestore','RegistryVerify','FsMetadata','FsMetadataRestore','FsMetadataVerify','Install')][string]$Action,
  [string]$Config,
  [string]$Value
)
$ErrorActionPreference = 'Stop'
if ([IntPtr]::Size -ne 8) { throw '64_BIT_POWERSHELL_REQUIRED' }
$allowedKeys = @(
  'Software\e9773db3-bffd-545e-a9a8-f55088a50fa3',
  'Software\Microsoft\Windows\CurrentVersion\Uninstall\e9773db3-bffd-545e-a9a8-f55088a50fa3',
  'Software\Classes\hasarbotu',
  'Software\Classes\AppUserModelId\com.hasarbotu.desktop'
)
function Clients([int[]]$OwnedIds=@()) { @(Get-Process -Name 'HasarBotu*' -ErrorAction SilentlyContinue | Where-Object { $OwnedIds -notcontains $_.Id }) }
function AssertOffline([int[]]$OwnedIds=@()) { if ((Clients $OwnedIds).Count -ne 0) { throw 'UNOWNED_CLIENT_RUNNING' } }
function Canonical([string]$Path) { [IO.Path]::GetFullPath($Path).TrimEnd('\') }
function AssertPrivatePath([string]$Path) {
  $root = Canonical (Join-Path $env:LOCALAPPDATA 'HasarBotuUpdateBackups')
  $target = Canonical $Path
  if (-not $target.StartsWith($root + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'PRIVATE_PATH_OUTSIDE_BACKUP_ROOT' }
}
function RegistryState {
  $result = @()
  foreach ($name in $allowedKeys) {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($name)
    if ($null -eq $key) { $result += @{ name=$name; exists=$false; entries=@() }; continue }
    $key.Dispose()
    $entries = @()
    $pending = [Collections.Generic.Queue[string]]::new()
    $pending.Enqueue($name)
    while ($pending.Count) {
      $path = $pending.Dequeue()
      $item = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($path)
      try {
        $values = @()
        foreach ($valueName in ($item.GetValueNames() | Sort-Object)) {
          $kind = $item.GetValueKind($valueName)
          $data = $item.GetValue($valueName,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
          $values += @{ name=$valueName; kind=[string]$kind; data=$data }
        }
        # Windows PowerShell 5.1 Get-Acl -LiteralPath misresolves registry paths.
        # Read owner, group and DACL from the same native key used for its values.
        $sddl = $item.GetAccessControl().GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All)
        $entries += @{ path=$path; values=$values; sddl=$sddl }
        foreach ($child in ($item.GetSubKeyNames() | Sort-Object)) { $pending.Enqueue($path + '\' + $child) }
      } finally { $item.Dispose() }
    }
    $result += @{ name=$name; exists=$true; entries=$entries }
  }
  return ,$result
}
function NormalizedRegistry($State) {
  @($State | ForEach-Object {
    $parent = $_
    [ordered]@{ name=$parent.name; exists=[bool]$parent.exists; entries=@($parent.entries | ForEach-Object {
      $entry = $_
      [ordered]@{ path=$entry.path; sddl=$entry.sddl; values=@($entry.values | ForEach-Object { [ordered]@{name=$_.name;kind=$_.kind;data=$_.data} }) }
    }) }
  }) | ConvertTo-Json -Depth 60 -Compress
}
if ($Action -eq 'Processes') { @{ count=(Clients).Count } | ConvertTo-Json -Compress; exit }
if ($Action -eq 'PrivateRoot') {
  AssertPrivatePath $Value
  $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
  if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'RUN_WITHOUT_ELEVATION' }
  if (Test-Path -LiteralPath $Value) { throw 'BACKUP_ALREADY_EXISTS' }
  $item = New-Item -ItemType Directory -Path $Value
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl = [Security.AccessControl.DirectorySecurity]::new()
  $acl.SetOwner($sid)
  $acl.SetAccessRuleProtection($true,$false)
  foreach ($principal in @($sid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
    $rule = [Security.AccessControl.FileSystemAccessRule]::new($principal,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
    $acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $item.FullName -AclObject $acl
  $actual = Get-Acl -LiteralPath $item.FullName
  if (-not $actual.AreAccessRulesProtected) { throw 'BACKUP_ACL_NOT_PROTECTED' }
  $identities = @($actual.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | ForEach-Object { $_.IdentityReference.Value })
  if (@($identities | Where-Object { $_ -ne $sid.Value -and $_ -ne 'S-1-5-18' }).Count -ne 0) { throw 'BACKUP_ACL_TOO_BROAD' }
  @{ private=$true } | ConvertTo-Json -Compress
  exit
}
if ($Action -eq 'Signature') {
  $file = Get-Item -LiteralPath $Value
  $signature = Get-AuthenticodeSignature -LiteralPath $Value
  @{ version=$file.VersionInfo.FileVersion; bytes=$file.Length; status=[string]$signature.Status; thumbprint=$signature.SignerCertificate.Thumbprint; timestamped=($null -ne $signature.TimeStamperCertificate) } | ConvertTo-Json -Compress
  exit
}
AssertPrivatePath $Config
$settings = Get-Content -LiteralPath $Config -Raw -Encoding UTF8 | ConvertFrom-Json
if ($Action.StartsWith('Registry')) {
  AssertPrivatePath $settings.registryFile
  if ($Action -eq 'RegistrySnapshot') {
    # InputObject avoids PowerShell's decorated array becoming { value, Count }.
    ConvertTo-Json -InputObject (RegistryState) -Depth 60 | Set-Content -LiteralPath $settings.registryFile -Encoding UTF8
  } else {
    # Windows PowerShell 5.1 already returns a JSON array as one pipeline object.
    $saved = Get-Content -LiteralPath $settings.registryFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($saved.Count -ne $allowedKeys.Count) { throw 'REGISTRY_SNAPSHOT_SCOPE_INVALID' }
    for ($i=0; $i -lt $allowedKeys.Count; $i++) { if ($saved[$i].name -cne $allowedKeys[$i]) { throw 'REGISTRY_SNAPSHOT_KEY_INVALID' } }
    if ($Action -eq 'RegistryRestore' -and (NormalizedRegistry $saved) -cne (NormalizedRegistry (RegistryState))) {
      AssertOffline
      foreach ($state in $saved) {
        [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($state.name,$false)
        if (-not $state.exists) { continue }
        foreach ($entry in $state.entries) {
          if ($entry.path -ne $state.name -and -not $entry.path.StartsWith($state.name + '\',[StringComparison]::Ordinal)) { throw 'REGISTRY_CHILD_OUTSIDE_SCOPE' }
          $item = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($entry.path)
          try {
            foreach ($valueEntry in $entry.values) {
              $kind = [Enum]::Parse([Microsoft.Win32.RegistryValueKind],[string]$valueEntry.kind)
              $data = $valueEntry.data
              if ($kind -eq [Microsoft.Win32.RegistryValueKind]::Binary) { $data = [byte[]]$data }
              if ($kind -eq [Microsoft.Win32.RegistryValueKind]::MultiString) { $data = [string[]]$data }
              if ($kind -eq [Microsoft.Win32.RegistryValueKind]::DWord) { $data = [int]$data }
              if ($kind -eq [Microsoft.Win32.RegistryValueKind]::QWord) { $data = [long]$data }
              $item.SetValue([string]$valueEntry.name,$data,$kind)
            }
          } finally { $item.Dispose() }
        }
        foreach ($entry in ($state.entries | Sort-Object { $_.path.Length })) {
          $acl = [Security.AccessControl.RegistrySecurity]::new()
          $acl.SetSecurityDescriptorSddlForm($entry.sddl)
          $rights = [Security.AccessControl.RegistryRights]::ChangePermissions -bor [Security.AccessControl.RegistryRights]::TakeOwnership -bor [Security.AccessControl.RegistryRights]::ReadPermissions
          $item = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($entry.path,[Microsoft.Win32.RegistryKeyPermissionCheck]::ReadWriteSubTree,$rights)
          try { $item.SetAccessControl($acl) } finally { if ($item) { $item.Dispose() } }
        }
      }
    }
    if ((NormalizedRegistry $saved) -cne (NormalizedRegistry (RegistryState))) { throw 'REGISTRY_EXACT_VERIFY_FAILED' }
  }
  @{ action=$Action; verified=$true } | ConvertTo-Json -Compress
  exit
}
if ($Action -eq 'FsMetadata') {
  AssertPrivatePath $settings.metadataFile
  $entries = @()
  foreach ($scope in $settings.scopes) {
    if (-not (Test-Path -LiteralPath $scope.path)) { continue }
    $items = @((Get-Item -LiteralPath $scope.path -Force))
    if ($scope.directory) { $items += @(Get-ChildItem -LiteralPath $scope.path -Recurse -Force) }
    foreach ($item in $items) {
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'SOURCE_REPARSE_POINT' }
      $entries += @{ path=$item.FullName; directory=$item.PSIsContainer; attributes=[int]$item.Attributes; created=$item.CreationTimeUtc.ToString('o'); written=$item.LastWriteTimeUtc.ToString('o'); sddl=(Get-Acl -LiteralPath $item.FullName).Sddl }
    }
  }
  $entries | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $settings.metadataFile -Encoding UTF8
  @{ action=$Action; verified=$true } | ConvertTo-Json -Compress
  exit
}
if ($Action -eq 'FsMetadataRestore' -or $Action -eq 'FsMetadataVerify') {
  AssertPrivatePath $settings.metadataFile
  AssertOffline
  $entries = Get-Content -LiteralPath $settings.metadataFile -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($entry in ($entries | Sort-Object { $_.path.Length } -Descending)) {
    $matches = @($settings.scopes | Where-Object { $entry.path -eq $_.path -or ($_.directory -and $entry.path.StartsWith($_.path + '\',[StringComparison]::OrdinalIgnoreCase)) })
    if ($matches.Count -ne 1) { throw 'METADATA_PATH_OUTSIDE_SCOPE' }
    if ($Action -eq 'FsMetadataRestore' -and @($settings.metadataRestoreScopes) -notcontains $matches[0].name) { continue }
    $item = Get-Item -LiteralPath $entry.path -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'RESTORE_REPARSE_POINT' }
    if ($Action -eq 'FsMetadataRestore') {
      if ($entry.directory) { $acl = [Security.AccessControl.DirectorySecurity]::new() } else { $acl = [Security.AccessControl.FileSecurity]::new() }
      $acl.SetSecurityDescriptorSddlForm($entry.sddl)
      Set-Acl -LiteralPath $entry.path -AclObject $acl
      $item.CreationTimeUtc = [DateTime]::Parse($entry.created)
      $item.LastWriteTimeUtc = [DateTime]::Parse($entry.written)
      $item.Attributes = [IO.FileAttributes]$entry.attributes
    } else {
      if ((Get-Acl -LiteralPath $entry.path).Sddl -cne $entry.sddl -or [int]$item.Attributes -ne $entry.attributes -or $item.CreationTimeUtc.ToString('o') -cne $entry.created -or $item.LastWriteTimeUtc.ToString('o') -cne $entry.written) { throw 'FILESYSTEM_METADATA_VERIFY_FAILED' }
    }
  }
  @{ action=$Action; verified=$true } | ConvertTo-Json -Compress
  exit
}
if ($Action -ne 'Install') { throw 'UNKNOWN_ACTION' }
$target = Canonical (Join-Path $env:LOCALAPPDATA 'Programs\HasarBotu')
if ((Canonical $settings.installDirectory) -ine $target) { throw 'INSTALL_TARGET_CHANGED' }
AssertOffline
# A private Job Object contains only our NSIS process tree. Closing it never kills a user client.
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class HBNsisJob {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct StartupInfo {
    public uint cb; public string reserved; public string desktop; public string title;
    public uint x,y,xSize,ySize,xChars,yChars,fill,flags; public ushort show,reservedSize;
    public IntPtr reservedPointer,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)] public struct ProcessInfo { public IntPtr process,thread; public uint pid,tid; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr CreateJobObject(IntPtr a,string n);
  [DllImport("kernel32.dll")] public static extern bool SetInformationJobObject(IntPtr h,int c,IntPtr p,uint n);
  [DllImport("kernel32.dll")] public static extern bool AssignProcessToJobObject(IntPtr h,IntPtr p);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CreateProcess(string app,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref StartupInfo startup,out ProcessInfo info);
  [DllImport("kernel32.dll")] public static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] public static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
  [DllImport("kernel32.dll")] public static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll")] public static extern bool TerminateProcess(IntPtr process,uint code);
}
'@
$job = [HBNsisJob]::CreateJobObject([IntPtr]::Zero,$null)
if ($job -eq [IntPtr]::Zero) { throw 'JOB_CREATE_FAILED' }
$limits = [Runtime.InteropServices.Marshal]::AllocHGlobal(144)
$created = $false
$assigned = $false
$info = [HBNsisJob+ProcessInfo]::new()
try {
  for ($i=0; $i -lt 144; $i++) { [Runtime.InteropServices.Marshal]::WriteByte($limits,$i,0) }
  [Runtime.InteropServices.Marshal]::WriteInt32($limits,16,0x2000)
  if (-not [HBNsisJob]::SetInformationJobObject($job,9,$limits,144)) { throw 'JOB_LIMIT_FAILED' }
  $startup = [HBNsisJob+StartupInfo]::new()
  $startup.cb = [Runtime.InteropServices.Marshal]::SizeOf($startup)
  $startup.flags = 1 # STARTF_USESHOWWINDOW
  $startup.show = 0 # SW_HIDE
  $command = [Text.StringBuilder]::new('"' + $settings.installerPath + '" /currentuser /S --updated /D=' + $target)
  $env:NSIS_ACCEPTANCE_DATABASE_URL = $null
  $env:TEST_DATABASE_URL = $null
  $env:DATABASE_URL = $null
  # CREATE_SUSPENDED removes the live-process gap before assigning our private Job Object.
  $created = [HBNsisJob]::CreateProcess($settings.installerPath,$command,[IntPtr]::Zero,[IntPtr]::Zero,$false,4,[IntPtr]::Zero,(Split-Path -Parent $settings.installerPath),[ref]$startup,[ref]$info)
  if (-not $created) { throw 'INSTALL_PROCESS_CREATE_FAILED' }
  $assigned = [HBNsisJob]::AssignProcessToJobObject($job,$info.process)
  if (-not $assigned) { throw 'JOB_ASSIGN_FAILED' }
  AssertOffline @([int]$info.pid)
  if ([HBNsisJob]::ResumeThread($info.thread) -eq [uint32]::MaxValue) { throw 'INSTALL_RESUME_FAILED' }
  $timer = [Diagnostics.Stopwatch]::StartNew()
  while ([HBNsisJob]::WaitForSingleObject($info.process,200) -eq 258) {
    AssertOffline @([int]$info.pid)
    if ($timer.ElapsedMilliseconds -gt 180000) { throw 'INSTALL_TIMEOUT' }
  }
  AssertOffline @([int]$info.pid)
  $exitCode = [uint32]0
  if (-not [HBNsisJob]::GetExitCodeProcess($info.process,[ref]$exitCode)) { throw 'INSTALL_EXIT_UNAVAILABLE' }
  @{ exitCode=$exitCode; watched=$true; unexpectedClient=$false } | ConvertTo-Json -Compress
  if ($exitCode -ne 0) { exit 2 }
} finally {
  if ($created -and -not $assigned) { [void][HBNsisJob]::TerminateProcess($info.process,125) }
  [void][HBNsisJob]::CloseHandle($job)
  if ($created) { [void][HBNsisJob]::CloseHandle($info.thread); [void][HBNsisJob]::CloseHandle($info.process) }
  [Runtime.InteropServices.Marshal]::FreeHGlobal($limits)
}
