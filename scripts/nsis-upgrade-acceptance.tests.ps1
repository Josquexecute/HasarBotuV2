param([string]$Helper = (Join-Path $PSScriptRoot 'nsis-upgrade-acceptance.ps1'))
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:LOCALAPPDATA ('HasarBotuUpdateBackups\registry-gate-' + [Guid]::NewGuid().ToString('N'))
$config = Join-Path $root 'control.json'
$snapshot = Join-Path $root 'registry.json'
$passed = 0
function Invoke-Gate([string]$Action, [bool]$ExpectedSuccess=$true) {
  $args = @('-NoProfile','-NonInteractive','-File',$Helper,'-Action',$Action)
  if ($Action -eq 'PrivateRoot') { $args += @('-Value',$root) } else { $args += @('-Config',$config) }
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $output = & powershell.exe @args 2>&1; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $old }
  if (($code -eq 0) -ne $ExpectedSuccess) { throw ('GATE_' + $Action + ': ' + ($output -join "`n")) }
  $script:passed++
}
try {
  Invoke-Gate 'PrivateRoot'
  @{registryFile=$snapshot} | ConvertTo-Json | Set-Content -LiteralPath $config -Encoding UTF8
  Invoke-Gate 'RegistrySnapshot'
  $raw = [IO.File]::ReadAllText($snapshot).TrimStart([char]0xFEFF)
  $state = $raw | ConvertFrom-Json
  if ($state.Count -ne 4 -or -not $raw.TrimStart().StartsWith('[')) { throw ('SNAPSHOT_MUST_CONTAIN_FOUR_ROOTS_AS_JSON_ARRAY count=' + $state.Count + ' prefix=' + $raw.Substring(0,[Math]::Min(100,$raw.Length))) }
  foreach ($rootState in $state) {
    foreach ($entry in $rootState.entries) {
      $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($entry.path)
      try {
        $sddl = $key.GetAccessControl().GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All)
        if ($entry.sddl -cne $sddl) { throw 'SNAPSHOT_ACL_DIFFERS_FROM_NATIVE_REGISTRY' }
      } finally { $key.Dispose() }
    }
  }
  $passed++
  Invoke-Gate 'RegistryVerify'
  $state[0].name = 'Software\OutsideAllowedScope'
  ConvertTo-Json -InputObject $state -Depth 60 | Set-Content -LiteralPath $snapshot -Encoding UTF8
  Invoke-Gate 'RegistryVerify' $false
  [IO.File]::WriteAllText($snapshot,$raw)
  $state = $raw | ConvertFrom-Json
  $entry = @($state | ForEach-Object { $_.entries }) | Select-Object -First 1
  if ($null -eq $entry) { throw 'EXISTING_REGISTRY_KEY_REQUIRED_FOR_ACL_NEGATIVE_TEST' }
  $entry.sddl = 'D:P(A;;KA;;;SY)'
  ConvertTo-Json -InputObject $state -Depth 60 | Set-Content -LiteralPath $snapshot -Encoding UTF8
  Invoke-Gate 'RegistryVerify' $false
  [IO.File]::WriteAllText($snapshot,$raw)
  Invoke-Gate 'RegistryVerify'
  @{status='PASS';checks=$passed;registryWritten=$false;permissionsRelaxed=$false} | ConvertTo-Json -Compress
} finally {
  $allowed = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'HasarBotuUpdateBackups')) + '\'
  $resolved = [IO.Path]::GetFullPath($root)
  if (-not $resolved.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase)) { throw 'CLEANUP_OUTSIDE_PRIVATE_ROOT' }
  if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
