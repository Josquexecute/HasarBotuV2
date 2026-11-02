import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { resolve, join, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { once } from 'node:events'
import { execFileSync } from 'node:child_process'
import { provisionOfficeNetwork } from './provision-office-network.mjs'
import { waitGateway } from './office-network.mjs'

test('generated WinSW service recovers an actual HTTPS process crash', {
  skip: process.platform !== 'win32' || !process.env.TEST_WINSW_EXE || !process.env.TEST_CADDY_EXE,
  timeout: 120_000,
}, async () => {
  const root = resolve(process.env.RUNNER_TEMP ?? tmpdir()), directory = await mkdtemp(join(root, 'hb-service-network-'))
  const name = 'hb-network-smoke-' + process.pid, exe = join(directory, name + '.exe')
  const literal = value => "'" + value.replaceAll("'", "''") + "'"
  const ps = source => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from("$ProgressPreference='SilentlyContinue';$ErrorActionPreference='Stop';" + source, 'utf16le').toString('base64')], { windowsHide: true, encoding: 'utf8', timeout: 40_000 }).trim()
  const run = args => execFileSync(exe, args, { windowsHide: true, encoding: 'utf8', timeout: 40_000 })
  const api = createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end('{"status":"ok","service":"hasarbotu-api"}') })
  const pid = () => Number(ps(`$s=Get-CimInstance Win32_Service -Filter "Name='${name}'";$p=@(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($s.ProcessId)"|Where-Object {$_.Name -eq 'caddy.exe'});if($p.Count -eq 1){$p[0].ProcessId}`))
  try {
    api.listen(0, '127.0.0.1'); await once(api, 'listening')
    const free = createServer(); free.listen(0, '127.0.0.1'); await once(free, 'listening')
    const port = free.address().port; await new Promise(done => free.close(done))
    const { profile } = await provisionOfficeNetwork({ directory, apiOrigin: 'https://office.example.test', lanHostname: 'OFFICE',
      openssl: process.env.TEST_OPENSSL_EXE ?? 'C:/Program Files/Git/usr/bin/openssl.exe', httpsPort: port })
    const config = join(directory, 'Caddyfile')
    await writeFile(config, (await readFile(config, 'utf8')).replace('127.0.0.1:3100', '127.0.0.1:' + api.address().port))
    const source = await readFile(new URL('./install-office-network.ps1', import.meta.url), 'utf8')
    const start = source.indexOf('function ConvertTo-XmlText('), end = source.indexOf('# The new wildcard listener')
    assert.ok(start > 0 && end > start)
    // Execute the production XML generator, with a disposable name and a harmless existing driver dependency.
    ps(`. ${literal(resolve('deploy/windows-service/office-network-state.ps1'))};$Directory=${literal(directory)};$WinSwExe=${literal(resolve(process.env.TEST_WINSW_EXE))};$utf8=[Text.UTF8Encoding]::new($false);` +
      source.slice(start, end) + `\nInstall-NetworkService ${literal(name)} ${literal(resolve(process.env.TEST_CADDY_EXE))} ${literal('run --config "' + config + '" --adapter caddyfile')} 'Tcpip'`)
    run(['start']); await waitGateway(profile)
    const first = pid(); assert.ok(first > 0)
    process.kill(first)
    let recovered = 0
    const deadline = Date.now() + 40_000
    while (Date.now() < deadline) {
      await new Promise(done => setTimeout(done, 500))
      recovered = pid()
      if (recovered && recovered !== first) { await waitGateway(profile); break }
    }
    assert.ok(recovered > 0 && recovered !== first)
    assert.equal((await waitGateway(profile)).tlsVerified, true)
  } finally {
    const exists = ps(`if(Get-Service -Name ${literal(name)} -ErrorAction SilentlyContinue){'exists'}`)
    if (exists) {
      ps(`$s=Get-Service -Name ${literal(name)};if($s.Status -ne 'Stopped'){Stop-Service -Name ${literal(name)}}`)
      run(['uninstall'])
    }
    await new Promise(done => api.close(done))
    if (!resolve(directory).startsWith(root + sep)) throw Error('UNSAFE_FIXTURE_CLEANUP')
    await rm(directory, { recursive: true, force: true })
  }
})

test('WinSW stops after the configured recovery budget instead of repeating the final restart forever', {
  skip: process.platform !== 'win32' || !process.env.TEST_WINSW_EXE,
  timeout: 90_000,
}, async () => {
  const root = resolve(process.env.RUNNER_TEMP ?? tmpdir()), directory = await mkdtemp(join(root, 'hb-recovery-budget-'))
  const name = 'hb-recovery-budget-' + process.pid, exe = join(directory, name + '.exe')
  const literal = value => "'" + value.replaceAll("'", "''") + "'"
  const ps = source => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from("$ErrorActionPreference='Stop';" + source, 'utf16le').toString('base64')], { windowsHide: true, encoding: 'utf8', timeout: 30_000 })
  const countFile = join(directory, 'starts.txt'), crashFile = join(directory, 'crash.cjs')
  await writeFile(crashFile, "const fs=require('node:fs'),path=require('node:path');fs.appendFileSync(path.join(__dirname,'starts.txt'),'start\\n');setInterval(()=>{if(fs.existsSync(path.join(__dirname,'crash-now')))process.exit(1)},50)")
  try {
    const source = await readFile(new URL('./install-office-network.ps1', import.meta.url), 'utf8')
    const generator = source.slice(source.indexOf('function ConvertTo-XmlText('), source.indexOf('# The new wildcard listener'))
    assert.equal((generator.match(/action="restart"/g) ?? []).length, 3)
    assert.match(generator, /<onfailure action="none"\/>/)
    // Shorten only test delays; production actions and their order remain unchanged.
    ps(`. ${literal(resolve('deploy/windows-service/office-network-state.ps1'))};$Directory=${literal(directory)};$WinSwExe=${literal(resolve(process.env.TEST_WINSW_EXE))};$utf8=[Text.UTF8Encoding]::new($false);` +
      generator.replace(/delay="(?:10|30|60) sec"/g, 'delay="1 sec"') + `\nInstall-NetworkService ${literal(name)} ${literal(process.execPath)} ${literal('"' + crashFile + '"')} 'Tcpip';Start-Service ${literal(name)}`)
    // Inject failure only after SCM has acknowledged the first successful start.
    await writeFile(join(directory, 'crash-now'), 'crash')
    const count = async () => (await readFile(countFile, 'utf8').catch(() => '')).split('\n').filter(Boolean).length
    const deadline = Date.now() + 30_000
    while (await count() < 4 && Date.now() < deadline) await new Promise(done => setTimeout(done, 300))
    assert.equal(await count(), 4)
    await new Promise(done => setTimeout(done, 4000))
    assert.equal(await count(), 4, 'the fifth start must not occur')
    assert.match(ps(`(Get-Service ${literal(name)}).Status`).trim(), /^Stopped$/)
  } finally {
    ps(`$s=Get-Service -Name ${literal(name)} -ErrorAction SilentlyContinue;if($s){if($s.Status -ne 'Stopped'){Stop-Service -Name ${literal(name)}}}`)
    if (await readFile(exe).then(() => true, () => false)) execFileSync(exe, ['uninstall'], { windowsHide: true, stdio: 'ignore', timeout: 30_000 })
    if (!resolve(directory).startsWith(root + sep)) throw Error('UNSAFE_FIXTURE_CLEANUP')
    await rm(directory, { recursive: true, force: true })
  }
})
