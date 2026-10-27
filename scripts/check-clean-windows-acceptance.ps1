param([string]$CustomerProfile)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$issues = [Collections.Generic.List[string]]::new()
$vbox = Join-Path $env:ProgramFiles 'Oracle/VirtualBox/VBoxManage.exe'
$registered = @()
$running = @()
$configuration = Join-Path $env:USERPROFILE '.VirtualBox/VirtualBox.xml'
if (Test-Path -LiteralPath $vbox) {
  $listing = & $vbox list vms 2>&1
  if ($LASTEXITCODE -ne 0) { $issues.Add('VirtualBox inventory is unavailable') }
  $running = @(& $vbox list runningvms 2>&1)
  if ($LASTEXITCODE -ne 0) { $issues.Add('VirtualBox running guest inventory is unavailable') }
  if (Test-Path -LiteralPath $configuration) {
    [xml]$xml = Get-Content -LiteralPath $configuration -Raw
    $entries = @($xml.SelectNodes('//*[local-name()="MachineEntry"]'))
    foreach ($entry in $entries) {
      $exists = Test-Path -LiteralPath $entry.GetAttribute('src') -PathType Leaf
      $id = $entry.GetAttribute('uuid').Trim('{}')
      $registered += [ordered]@{ id = $id; configurationExists = $exists }
    }
  }
} else { $issues.Add('VirtualBox is unavailable') }
$hyperV = Get-Command Get-VM -ErrorAction SilentlyContinue
$hyperVGuests = @()
if ($hyperV) {
  try { $hyperVGuests = @(Get-VM | Select-Object Id, State) }
  catch { $issues.Add('Hyper-V guest inventory is inaccessible') }
}
if (-not @($registered | Where-Object { $_.configurationExists }).Count -and -not $hyperVGuests.Count) {
  $issues.Add('No accessible registered VM; provision a clean licensed Windows guest and snapshot')
}
if (-not $CustomerProfile -or -not (Test-Path -LiteralPath $CustomerProfile -PathType Leaf)) { $issues.Add('Customer-specific API/TLS/folder sandbox profile is missing') }
$issues.Add('Clean guest state and interactive customer acceptance require observed execution; inventory alone cannot establish acceptance')
[ordered]@{
  checkedAt = [DateTime]::UtcNow.ToString('o'); status = 'BLOCKED'; virtualBoxAvailable = (Test-Path -LiteralPath $vbox);
  registeredVirtualBoxGuests = $registered; runningVirtualBoxGuests = $running.Count;
  hyperVAvailable = $null -ne $hyperV; hyperVGuests = $hyperVGuests.Count; issues = @($issues);
  acceptanceExecuted = $false; realCustomerAcceptanceClaimed = $false; hostConfigurationChanged = $false;
  requiredObservedChecks = @('Record clean guest Windows build/license/snapshot and standard user identity',
    'Use synthetic customer account, customer sandbox API/TLS/DNS/WAN and permitted folders; isolate office data',
    'Install verified x64 NSIS as a standard user, launch/login, check allowed and denied folder operations',
    'Exercise signed/user-controlled upgrade and preserve session/theme/profile; uninstall and restore snapshot',
    'Record actual errors/results without screenshots; isolated lab acceptance remains distinct from real customer signoff')
} | ConvertTo-Json -Depth 6
exit 2
