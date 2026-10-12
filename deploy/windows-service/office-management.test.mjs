import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const source = fileURLToPath(new URL('./', import.meta.url))
const baseDirectory = fileURLToPath(new URL('../../.local/office-management-regression/', import.meta.url))
const nativeDirectory = 'C:/HasarBotuPilot/office-handoff-20261011/network-tools/ssh-config-validation/OpenSSH-Win64'
const quote = value => `'${value.replaceAll("'", "''")}'`

async function execute(file, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, windowsHide: true, windowsVerbatimArguments: file === 'cmd.exe' })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', data => { stdout += data })
    child.stderr.on('data', data => { stderr += data })
    child.on('error', reject)
    const timeout = setTimeout(() => child.kill(), 30000)
    child.on('close', code => { clearTimeout(timeout); resolve({ code, stdout, stderr }) })
    child.stdin.end('\r\n')
  })
}

async function fixture(run) {
  await mkdir(baseDirectory, { recursive: true })
  const base = await realpath(baseDirectory)
  const directory = await mkdtemp(path.join(base, 'ssh-ayar-İ-'))
  try {
    for (const name of ['enable-office-management.ps1', 'office-ssh-settings.ps1', 'office-management-state.ps1', 'office-management.bat']) {
      await copyFile(path.join(source, name), path.join(directory, name))
    }
    await run(directory, base)
  } finally {
    const resolved = await realpath(directory)
    assert.equal(path.dirname(resolved), base)
    assert(path.basename(resolved).startsWith('ssh-ayar-İ-'))
    await rm(resolved, { recursive: true })
  }
}

const powershell = (args, cwd) => execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args], cwd)
const reportAt = async directory => JSON.parse((await readFile(path.join(directory, 'ofis-yonetim-sonucu.json'), 'utf8')).replace(/^\uFEFF/u, ''))

test('wrong-machine Apply stops before installation, even without keys or runtime', async () => {
  assert.notEqual(process.env.COMPUTERNAME, 'DESKTOP-EFN2G33')
  await fixture(async (directory, base) => {
    const result = await powershell(['-File', path.join(directory, 'enable-office-management.ps1'), '-Apply'], base)
    assert.equal(result.code, 1, result.stderr)
    const report = await reportAt(directory)
    assert.equal(report.ErrorCode, 'TARGET_COMPUTER_MISMATCH')
    assert.equal(report.InstallationPerformed, false)
    assert.equal(report.OfficeDataModified, false)
  })
})

test('real BAT preserves a failed inspection exit code from another cwd', async () => {
  await fixture(async (directory, base) => {
    const bat = path.join(directory, 'office-management.bat')
    const result = await execute('cmd.exe', ['/d', '/s', '/c', `"call "${bat}""`], base)
    assert.equal(result.code, 1, result.stderr)
    assert.match(result.stdout, /Islem tamamlanamadi/u)
    assert.doesNotMatch(result.stdout, /Yerel SSH kontrolu gecti/u)
    assert.equal((await reportAt(directory)).ErrorCode, 'TARGET_COMPUTER_MISMATCH')
  })
})

test('configuration rejects non-Tailscale addresses and injected account/path values', async () => {
  await fixture(async (directory, base) => {
    const command = `. ${quote(path.join(directory, 'office-ssh-settings.ps1'))};
$valid = @{ UserName='officeuser'; OfficeAddress='100.79.207.106'; ClientAddress='100.92.252.82'; HostKeyPath='C:/keys/host'; AuthorizedKeyPath='C:/keys/authorized'; SftpPath='C:/OpenSSH/sftp-server.exe' };
foreach ($pair in @(@('ClientAddress','0.0.0.0'), @('OfficeAddress','192.168.1.100'), @('UserName','officeuser *'), @('HostKeyPath', 'C:/bad"path'))) {
  $invalid = $valid.Clone(); $invalid[$pair[0]] = $pair[1]; $rejected=$false;
  try { Get-OfficeSshSettings @invalid | Out-Null } catch { $rejected=$true };
  if (-not $rejected) { throw 'UNSAFE_CONFIGURATION_ACCEPTED' }
}; Write-Output 'PASS'`
    const result = await powershell(['-Command', command], base)
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stdout, /PASS/u)
  })
})

test('native Microsoft sshd validates the rendered settings and effective restrictions', async () => {
  await fixture(async (directory, base) => {
    const configPath = path.join(directory, 'sshd_config')
    const hostPath = path.join(directory, 'host_key')
    const helper = path.join(directory, 'office-ssh-settings.ps1')
    const script = `. ${quote(helper)};
$hostFile = ${quote(hostPath)};
Invoke-OfficeSshNative -File ${quote(path.join(nativeDirectory, 'ssh-keygen.exe'))} -Arguments ('-q -t ed25519 -N "" -f "' + $hostFile + '"') | Out-Null;
Set-OfficeSshAcl -Path $hostFile;
$config = Get-OfficeSshSettings -UserName 'officeuser' -OfficeAddress '100.79.207.106' -ClientAddress '100.92.252.82' -HostKeyPath $hostFile -AuthorizedKeyPath ${quote(path.join(directory, 'authorized_keys'))} -SftpPath ${quote(path.join(nativeDirectory, 'sftp-server.exe'))};
[IO.File]::WriteAllText(${quote(configPath)}, $config + "\n", [Text.UTF8Encoding]::new($false));
Invoke-OfficeSshNative -File ${quote(path.join(nativeDirectory, 'sshd.exe'))} -Arguments ('-t -f "' + ${quote(configPath)} + '"') | Out-Null;
Invoke-OfficeSshNative -File ${quote(path.join(nativeDirectory, 'sshd.exe'))} -Arguments ('-T -f "' + ${quote(configPath)} + '"')`
    const result = await powershell(['-Command', script], base)
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stdout, /^passwordauthentication no$/mu)
    assert.match(result.stdout, /^authenticationmethods publickey$/mu)
    assert.match(result.stdout, /^allowtcpforwarding no$/mu)
    assert.match(result.stdout, /^allowagentforwarding no$/mu)
    assert.match(result.stdout, /^allowusers officeuser@100\.92\.252\.82$/mu)
    assert.match(result.stdout, /^listenaddress 100\.79\.207\.106:22$/mu)
    await writeFile(path.join(directory, 'validated-settings.txt'), result.stdout)
  })
})

test('localized Windows ACL protection leaves only SYSTEM and Administrators', async () => {
  await fixture(async (directory, base) => {
    const file = path.join(directory, 'acl-fixture')
    await writeFile(file, 'public fixture')
    const result = await powershell(['-Command', `. ${quote(path.join(directory, 'office-ssh-settings.ps1'))}; Set-OfficeSshAcl -Path ${quote(file)}; $acl=Get-Acl -LiteralPath ${quote(file)}; $acl.Access | ForEach-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } | ConvertTo-Json`], base)
    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout).sort(), ['S-1-5-18', 'S-1-5-32-544'])
  })
})

test('an installer failure closes a newly created SSH service and its firewall rules', async () => {
  await fixture(async (directory, base) => {
    const scriptPath = path.join(directory, 'enable-office-management.ps1')
    const original = await readFile(scriptPath, 'utf8')
    const changed = original.replaceAll('DESKTOP-EFN2G33', process.env.COMPUTERNAME)
    await writeFile(scriptPath, changed, 'utf8')
    await copyFile('C:/HasarBotuPilot/local-tracking-20261011/private/office-management-access/development-office-access.pub', path.join(directory, 'development-office-access.pub'))
    const result = await powershell(['-Command', `
$ErrorActionPreference='Stop'; $env:ProgramData=${quote(directory)};
$global:created=$false; $global:stopped=$false; $global:disabled=$false; $global:rulesDisabled=$false;
function Get-NetIPAddress { [pscustomobject]@{IPAddress='100.79.207.106';InterfaceAlias='Tailscale';AddressState='Preferred'} }
function Get-Service { param($Name,$ErrorAction) if ($global:created) { [pscustomobject]@{Name='sshd';Status='Running'} } }
function Get-NetFirewallRule { param($Name,$ErrorAction) if ($global:created) { [pscustomobject]@{Name=$Name} } }
function Get-WindowsCapability { [pscustomobject]@{State='NotPresent'} }
function Add-WindowsCapability { $global:created=$true; throw 'INJECTED_INSTALLER_FAILURE' }
function Stop-Service { param($Name,$ErrorAction) $global:stopped=$true }
function Set-Service { param($Name,$StartupType) $global:disabled=($StartupType -eq 'Disabled') }
function Disable-NetFirewallRule { process { $global:rulesDisabled=$true } }
try { & ${quote(scriptPath)} -Apply } finally {
  [ordered]@{ServiceStopped=$global:stopped;StartupDisabled=$global:disabled;FirewallDisabled=$global:rulesDisabled} | ConvertTo-Json | Set-Content -LiteralPath ${quote(path.join(directory, 'cleanup-proof.json'))} -Encoding UTF8
}; exit $LASTEXITCODE`], base)
    assert.equal(result.code, 1, result.stderr)
    const report = await reportAt(directory)
    assert.equal(report.Status, 'BLOCKED')
    assert.equal(report.ErrorCode, 'INJECTED_INSTALLER_FAILURE')
    assert.equal(report.InstallationPerformed, null)
    const cleanup = JSON.parse((await readFile(path.join(directory, 'cleanup-proof.json'), 'utf8')).replace(/^\uFEFF/u, ''))
    assert.deepEqual(cleanup, { ServiceStopped: true, StartupDisabled: true, FirewallDisabled: true })
  })
})

test('an unowned existing SSH service is inspected without changing services or files', async () => {
  await fixture(async (directory, base) => {
    const scriptPath = path.join(directory, 'enable-office-management.ps1')
    await writeFile(scriptPath, (await readFile(scriptPath, 'utf8')).replaceAll('DESKTOP-EFN2G33', process.env.COMPUTERNAME))
    await copyFile('C:/HasarBotuPilot/local-tracking-20261011/private/office-management-access/development-office-access.pub', path.join(directory, 'development-office-access.pub'))
    const result = await powershell(['-Command', `
$env:ProgramData=${quote(directory)};
function Get-NetIPAddress { [pscustomobject]@{IPAddress='100.79.207.106';InterfaceAlias='Tailscale';AddressState='Preferred'} }
function Get-Service { [pscustomobject]@{Name='sshd';Status='Running'} }
function Get-CimInstance { [pscustomobject]@{State='Running';StartMode='Auto';PathName='SECRET_MUST_NOT_BE_REPORTED'} }
function Get-NetTCPConnection { [pscustomobject]@{LocalAddress='0.0.0.0';LocalPort=22;OwningProcess=123} }
function Stop-Service { throw 'UNEXPECTED_SERVICE_MUTATION' }
function Set-Service { throw 'UNEXPECTED_SERVICE_MUTATION' }
function Add-WindowsCapability { throw 'UNEXPECTED_INSTALLATION' }
& ${quote(scriptPath)} -Apply`], base)
    assert.equal(result.code, 1, result.stderr)
    const report = await reportAt(directory)
    assert.equal(report.ErrorCode, 'EXISTING_SSH_SERVICE_REQUIRES_REVIEW')
    assert.equal(report.ExistingSsh.ServiceStatus, 'Running')
    assert.equal(report.ExistingSsh.DeploymentStatePresent, false)
    assert.equal(report.ExistingSsh.Listeners[0].LocalAddress, '0.0.0.0')
    assert.equal(report.InstallationPerformed, false)
    assert.doesNotMatch(JSON.stringify(report), /SECRET_MUST_NOT_BE_REPORTED/u)
  })
})

test('an owned rerun revalidates native configuration and rejects changed keys, listeners and firewall', async () => {
  for (const scenario of ['owned', 'config', 'keys', 'listener', 'firewall']) {
    await fixture(async (directory, base) => {
      const scriptPath = path.join(directory, 'enable-office-management.ps1')
      const native = nativeDirectory.replaceAll('/', '\\')
      const original = await readFile(scriptPath, 'utf8')
      await writeFile(scriptPath, original.replaceAll('DESKTOP-EFN2G33', process.env.COMPUTERNAME)
        .replace("$sshBin = Join-Path $env:SystemRoot 'System32\\OpenSSH'", `$sshBin = ${quote(native)}`))
      await copyFile('C:/HasarBotuPilot/local-tracking-20261011/private/office-management-access/development-office-access.pub', path.join(directory, 'development-office-access.pub'))
      const result = await powershell(['-Command', `
$ErrorActionPreference='Stop'; $env:ProgramData=${quote(directory)};
. ${quote(path.join(directory, 'office-ssh-settings.ps1'))};
$dir=Join-Path $env:ProgramData 'HasarBotu\\office-management';
$ssh=Join-Path $env:ProgramData 'ssh';
New-Item -ItemType Directory -Path $dir,$ssh -Force | Out-Null;
Set-OfficeSshAcl -Path $dir -Directory;
$hostFile=Join-Path $dir 'ssh_host_ed25519_key';
Invoke-OfficeSshNative -File ${quote(path.join(nativeDirectory, 'ssh-keygen.exe'))} -Arguments ('-q -t ed25519 -N "" -f "'+$hostFile+'" -C hasarbotu-office-management') | Out-Null;
Set-OfficeSshAcl -Path $hostFile;
$configPath=Join-Path $ssh 'sshd_config'; $keys=Join-Path $ssh 'administrators_authorized_keys';
$user=([Security.Principal.WindowsIdentity]::GetCurrent().Name -split '\\\\')[-1].ToLowerInvariant();
$config=Get-OfficeSshSettings -UserName $user -OfficeAddress '100.79.207.106' -ClientAddress '100.92.252.82' -HostKeyPath $hostFile -AuthorizedKeyPath $keys -SftpPath ${quote(path.join(nativeDirectory, 'sftp-server.exe').replaceAll('/', '\\'))};
[IO.File]::WriteAllText($configPath,$config+[string][char]10,[Text.UTF8Encoding]::new($false));
$public=[IO.File]::ReadAllText(${quote(path.join(directory, 'development-office-access.pub'))}).Trim();
[IO.File]::WriteAllText($keys,('from="100.92.252.82",no-agent-forwarding,no-port-forwarding,no-X11-forwarding '+$public+[string][char]10),[Text.UTF8Encoding]::new($false));
Set-OfficeSshAcl -Path $configPath; Set-OfficeSshAcl -Path $keys;
$state=[ordered]@{SchemaVersion='hasarbotu-office-management/1.0.0';Status='PENDING_REMOTE_KEY_ACCEPTANCE';ComputerName=$env:COMPUTERNAME;OfficeAddress='100.79.207.106';AllowedClientAddress='100.92.252.82';UserName=$user;FirewallRuleName='HasarBotu-Office-SSH-Tailscale';HostPublicKey=[IO.File]::ReadAllText($hostFile+'.pub').Trim();ConfigSha256=(Get-FileHash $configPath).Hash;AuthorizedKeysSha256=(Get-FileHash $keys).Hash};
$statePath=Join-Path $dir 'deployment-state.json'; $state | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8;
Copy-Item -LiteralPath $statePath -Destination ${quote(path.join(directory, 'state-before.json'))};
if (${quote(scenario)} -eq 'config') { Add-Content -LiteralPath $configPath -Value 'PasswordAuthentication yes' }
if (${quote(scenario)} -eq 'keys') { Add-Content -LiteralPath $keys -Value 'ssh-ed25519 changed' }
function Get-NetIPAddress { [pscustomobject]@{IPAddress='100.79.207.106';InterfaceAlias='Tailscale';AddressState='Preferred'} }
function Get-Service { [pscustomobject]@{Name='sshd';Status='Running'} }
function Get-CimInstance { [pscustomobject]@{State='Running';StartMode='Auto';ProcessId=123;PathName=${quote(path.join(nativeDirectory, 'sshd.exe').replaceAll('/', '\\'))}} }
function Get-NetTCPConnection { [pscustomobject]@{LocalAddress=$(if (${quote(scenario)} -eq 'listener') {'0.0.0.0'} else {'100.79.207.106'});LocalPort=22;OwningProcess=123} }
function Get-NetFirewallRule { param($Name,$ErrorAction) if ($Name -eq 'HasarBotu-Office-SSH-Tailscale') { [pscustomobject]@{Enabled='True';Action='Allow';Direction='Inbound'} } }
function Get-NetFirewallAddressFilter { process { [pscustomobject]@{LocalAddress='100.79.207.106';RemoteAddress=$(if (${quote(scenario)} -eq 'firewall') {'Any'} else {'100.92.252.82'})} } }
function Get-NetFirewallPortFilter { process { [pscustomobject]@{LocalPort='22';Protocol='TCP'} } }
function Get-NetFirewallInterfaceFilter { process { [pscustomobject]@{InterfaceAlias='Tailscale'} } }
function Get-NetFirewallApplicationFilter { process { [pscustomobject]@{Program=${quote(path.join(nativeDirectory, 'sshd.exe').replaceAll('/', '\\'))}} } }
function Add-WindowsCapability { throw 'UNEXPECTED_INSTALLATION' }
function Stop-Service { throw 'UNEXPECTED_SERVICE_MUTATION' }
function Set-Service { throw 'UNEXPECTED_SERVICE_MUTATION' }
& ${quote(scriptPath)} -Apply`], base)
      const report = await reportAt(directory)
      const expected = { config: 'CHANGED_SSH_CONFIGURATION_REQUIRES_REVIEW', keys: 'CHANGED_SSH_CONFIGURATION_REQUIRES_REVIEW', listener: 'SSH_LISTENER_ACCEPTANCE_FAILED', firewall: 'SSH_FIREWALL_ACCEPTANCE_FAILED' }
      assert.equal(result.code, scenario === 'owned' ? 0 : 1, `${scenario}: ${result.stderr} ${JSON.stringify(report)}`)
      assert.equal(report.Status, scenario === 'owned' ? 'PENDING_REMOTE_KEY_ACCEPTANCE' : 'BLOCKED', `${scenario}: ${JSON.stringify(report)}`)
      if (scenario === 'owned') {
        assert.equal(report.ExistingInstallationRevalidated, true)
        assert.match(report.HostPublicKey, /^ssh-ed25519 /u)
      } else assert.equal(report.ErrorCode, expected[scenario])
      assert.equal(report.InstallationPerformed, false)
      assert.deepEqual(await readFile(path.join(directory, 'state-before.json')), await readFile(path.join(directory, 'HasarBotu/office-management/deployment-state.json')))
    })
  }
})
