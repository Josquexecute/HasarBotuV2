import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const source = fileURLToPath(new URL('./', import.meta.url))
const fixtureBase = fileURLToPath(new URL('../../.local/office-readiness-regression/', import.meta.url))

async function fixture(run) {
  await mkdir(fixtureBase, { recursive: true })
  const base = await realpath(fixtureBase)
  const directory = await mkdtemp(path.join(base, 'ofis kontrol-İ-'))
  try {
    await mkdir(path.join(directory, 'runtime'))
    await mkdir(path.join(directory, 'evrak'))
    await copyFile(process.execPath, path.join(directory, 'runtime', 'node.exe'))
    await copyFile(path.join(source, 'inspect-office-readiness.ps1'), path.join(directory, 'inspect-office-readiness.ps1'))
    await copyFile(path.join(source, 'inspect-central-pilot-host.ps1'), path.join(directory, 'inspect-central-pilot-host.ps1'))
    await copyFile(path.join(source, 'office-check.bat'), path.join(directory, 'OFIS_KONTROL.bat'))
    await run(directory, base)
  } finally {
    const resolved = await realpath(directory)
    assert.equal(path.dirname(resolved), base)
    assert(path.basename(resolved).startsWith('ofis kontrol-İ-'))
    await rm(resolved, { recursive: true })
  }
}

function execute(command, args, cwd, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, windowsHide: true, windowsVerbatimArguments: command === 'cmd.exe' })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', data => { stdout += data })
    child.stderr.on('data', data => { stderr += data })
    child.on('error', reject)
    child.on('close', code => resolve({ code, stdout, stderr }))
    child.stdin.end('\r\n')
  })
}

const powershell = (directory, args, cwd, env) => execute('powershell.exe', [
  '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
  path.join(directory, 'inspect-office-readiness.ps1'), ...args,
], cwd, env)
const reportAt = async file => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/u, ''))

test('PowerShell 5.1 resolves omitted NodeExe and OutputPath beside the script, from another cwd', async () => {
  await fixture(async (directory, base) => {
    const result = await powershell(directory, ['-ExpectedComputerName', process.env.COMPUTERNAME, '-StorageRoot', path.join(directory, 'evrak')], base)
    assert.equal(result.code, 0, result.stderr)
    const report = await reportAt(path.join(directory, 'ofis-kontrol-sonucu.json'))
    assert.equal(report.Status, 'PENDING_SERVICE_PROBE')
    assert.match(report.Host.NodeVersion, /^v24\./u)
    assert.equal(report.InstallationPerformed, false)
    assert(Array.isArray(report.NetworkAddresses))
    assert(Array.isArray(report.NetworkAdapters))
    assert(Array.isArray(report.VpnServices))
    assert.equal(typeof report.Tailscale.Detected, 'boolean')
    assert.equal(report.Host.StorageRoot, path.join(directory, 'evrak'))
    assert.equal((await stat(path.join(directory, 'evrak'))).isDirectory(), true)
  })
})

test('Tailscale projection excludes credentials and handles logged-out, failed and malformed CLI results', async () => {
  await fixture(async (directory, base) => {
    const programDirectory = path.join(directory, 'program files')
    const cliDirectory = path.join(programDirectory, 'Tailscale')
    await mkdir(cliDirectory, { recursive: true })
    const cli = path.join(cliDirectory, 'tailscale.exe')
    const sourceFile = path.join(directory, 'cli-fixture.cs')
    await writeFile(sourceFile, `using System; using System.IO;
public class CliFixture { public static void Main() {
Console.Error.Write(new string('x', 70000));
Console.Write(File.ReadAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "status.json")));
string exitFile = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "exit-code.txt");
if (File.Exists(exitFile)) Environment.Exit(int.Parse(File.ReadAllText(exitFile)));
} }`)
    const quote = value => `'${value.replaceAll("'", "''")}'`
    const compile = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Add-Type -TypeDefinition ([IO.File]::ReadAllText(${quote(sourceFile)})) -OutputAssembly ${quote(cli)} -OutputType ConsoleApplication`], base)
    assert.equal(compile.code, 0, compile.stderr)
    const env = { ...process.env, ProgramFiles: programDirectory, 'ProgramFiles(x86)': programDirectory,
      PATH: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0` }
    const args = ['-ExpectedComputerName', process.env.COMPUTERNAME, '-StorageRoot', path.join(directory, 'evrak')]
    await writeFile(path.join(cliDirectory, 'status.json'), JSON.stringify({
      BackendState: 'Running', TailscaleIPs: ['100.79.207.106'], PrivateKey: 'SECRET_NOT_FOR_REPORT',
      User: { 1: { LoginName: 'PRIVATE_ACCOUNT_NOT_FOR_REPORT' } },
      Peer: { key: { HostName: 'development-fixture', TailscaleIPs: ['100.64.0.2'], Online: true, PublicKey: 'PRIVATE_KEY_NOT_FOR_REPORT' } },
    }))
    const result = await powershell(directory, args, base, env)
    assert.equal(result.code, 0, result.stderr)
    const output = await readFile(path.join(directory, 'ofis-kontrol-sonucu.json'), 'utf8')
    const report = JSON.parse(output.replace(/^\uFEFF/u, ''))
    assert.equal(report.Tailscale.Status, 'STATUS_READ')
    assert.equal(report.Tailscale.BackendState, 'Running')
    assert.deepEqual(report.Tailscale.Addresses, ['100.79.207.106'])
    assert.deepEqual(report.Tailscale.Peers, [{ HostName: 'development-fixture', Addresses: ['100.64.0.2'], Online: true }])
    assert.doesNotMatch(output, /SECRET_NOT_FOR_REPORT|PRIVATE_ACCOUNT_NOT_FOR_REPORT|PRIVATE_KEY_NOT_FOR_REPORT/u)
    await writeFile(path.join(cliDirectory, 'status.json'), JSON.stringify({ BackendState: 'NeedsLogin', TailscaleIPs: null, Peer: null }))
    const loggedOut = await powershell(directory, args, base, env)
    assert.equal(loggedOut.code, 0, loggedOut.stderr)
    const loggedOutReport = await reportAt(path.join(directory, 'ofis-kontrol-sonucu.json'))
    assert.equal(loggedOutReport.Tailscale.BackendState, 'NeedsLogin')
    assert.deepEqual(loggedOutReport.Tailscale.Peers, [])
    await writeFile(path.join(cliDirectory, 'exit-code.txt'), '1')
    const failed = await powershell(directory, args, base, env)
    assert.equal(failed.code, 0, failed.stderr)
    const failedReport = await reportAt(path.join(directory, 'ofis-kontrol-sonucu.json'))
    assert.equal(failedReport.Tailscale.Status, 'CLI_FAILED')
    assert.equal(failedReport.Tailscale.ExitCode, 1)
    await rm(path.join(cliDirectory, 'exit-code.txt'))
    await writeFile(path.join(cliDirectory, 'status.json'), 'MALFORMED_SECRET_NOT_FOR_REPORT')
    const malformed = await powershell(directory, args, base, env)
    assert.equal(malformed.code, 0, malformed.stderr)
    const malformedOutput = await readFile(path.join(directory, 'ofis-kontrol-sonucu.json'), 'utf8')
    assert.equal(JSON.parse(malformedOutput.replace(/^\uFEFF/u, '')).Tailscale.Status, 'STATUS_INSPECTION_FAILED')
    assert.doesNotMatch(malformedOutput, /MALFORMED_SECRET_NOT_FOR_REPORT/u)
  })
})

test('the exact no-argument package invocation writes a valid report instead of failing param binding', async () => {
  await fixture(async (directory, base) => {
    const result = await powershell(directory, [], base)
    assert.doesNotMatch(result.stderr, /Cannot bind argument|empty string/u)
    const report = await reportAt(path.join(directory, 'ofis-kontrol-sonucu.json'))
    assert(['BLOCKED', 'PENDING_SERVICE_PROBE'].includes(report.Status))
    assert.equal(result.code, report.Status === 'BLOCKED' ? 1 : 0, result.stderr)
    if (process.env.COMPUTERNAME !== report.Host.ExpectedComputerName) {
      assert(report.Host.Blockers.includes('TARGET_COMPUTER_MISMATCH'))
    }
    assert.match(report.Host.NodeVersion, /^v24\./u)
    assert.equal(report.InstallationPerformed, false)
  })
})

test('explicit NodeExe and OutputPath remain supported', async () => {
  await fixture(async (directory, base) => {
    const output = path.join(directory, 'explicit-output.json')
    const result = await powershell(directory, ['-ExpectedComputerName', process.env.COMPUTERNAME, '-StorageRoot', path.join(directory, 'evrak'),
      '-NodeExe', process.execPath, '-OutputPath', output], base)
    assert.equal(result.code, 0, result.stderr)
    assert.equal((await reportAt(output)).Status, 'PENDING_SERVICE_PROBE')
  })
})

test('the real BAT launch from another cwd preserves the inspection status and writes the default report', async () => {
  await fixture(async (directory, base) => {
    const result = await execute('cmd.exe', ['/d', '/s', '/c', `"call "${path.join(directory, 'OFIS_KONTROL.bat')}""`], base)
    const report = await reportAt(path.join(directory, 'ofis-kontrol-sonucu.json'))
    assert.equal(result.code, report.Status === 'BLOCKED' ? 1 : 0, result.stderr)
    if (result.code === 1) {
      assert.match(result.stdout, /Kontrol tamamlanamadi veya bir engel bulundu/u)
      assert.doesNotMatch(result.stdout, /Rapor:/u)
    } else assert.match(result.stdout, /Rapor:/u)
  })
})

test('the BAT does not announce a stale report when its child script cannot start', async () => {
  await fixture(async (directory, base) => {
    await powershell(directory, [], base)
    const output = path.join(directory, 'ofis-kontrol-sonucu.json')
    const before = await readFile(output)
    await rm(path.join(directory, 'inspect-office-readiness.ps1'))
    const result = await execute('cmd.exe', ['/d', '/s', '/c', `"call "${path.join(directory, 'OFIS_KONTROL.bat')}""`], base)
    assert.notEqual(result.code, 0)
    assert.doesNotMatch(result.stdout, /Rapor:/u)
    assert.match(result.stdout, /Kontrol tamamlanamadi veya bir engel bulundu/u)
    assert.deepEqual(await readFile(output), before)
  })
})

test('the standalone network BAT works without Node or host script, and identifies its limited scope', async () => {
  await fixture(async (directory, base) => {
    await rm(path.join(directory, 'runtime', 'node.exe'))
    await rmdir(path.join(directory, 'runtime'))
    await rm(path.join(directory, 'inspect-central-pilot-host.ps1'))
    const bat = path.join(directory, 'OFIS_KONTROL.bat')
    const original = await readFile(bat, 'utf8')
    const invocation = '-File "%~dp0inspect-office-readiness.ps1"'
    assert.equal(original.split(invocation).length, 2)
    await writeFile(bat, original.replace(invocation, invocation + ' -NetworkOnly'))
    const result = await execute('cmd.exe', ['/d', '/s', '/c', `"call "${bat}""`], base)
    const report = await reportAt(path.join(directory, 'ofis-kontrol-sonucu.json'))
    assert.equal(result.code, report.Status === 'BLOCKED' ? 1 : 0, result.stderr)
    assert.doesNotMatch(result.stderr, /HOST_INSPECTION_SCRIPT_REQUIRED|NODE_EXE_REQUIRED/u)
    assert.equal(report.InspectionScope, 'NETWORK_ONLY')
    assert.equal(report.Host.ReadinessInspected, false)
    assert.equal(report.InstallationPerformed, false)
    assert(Array.isArray(report.NetworkAddresses))
    const matched = await powershell(directory, ['-NetworkOnly', '-ExpectedComputerName', process.env.COMPUTERNAME], base)
    assert.equal(matched.code, 0, matched.stderr)
    assert.equal((await reportAt(path.join(directory, 'ofis-kontrol-sonucu.json'))).Status, 'PENDING_CONNECTION_ACCEPTANCE')
  })
})
