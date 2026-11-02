import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { createServer } from 'node:https'
import { createServer as createHttpServer } from 'node:http'
import { spawn, execFileSync } from 'node:child_process'
import { createServer as createTcpServer } from 'node:net'
import { createSocket } from 'node:dgram'
import { discoveryReply, renderLegacyCaddy, startDiscovery, lanAddresses, verifyGateway } from './office-network.mjs'
import { gatewayCaddy, provisionOfficeNetwork } from './provision-office-network.mjs'
import { createOfficeNetwork, officeHealth } from '../../apps/desktop/dist/main/office-network.js'
import { parseOfficeConnection } from '../../apps/desktop/dist/main/office-connection.js'
import { startDesktopBridge } from '../../packages/desktop-bridge/dist/index.js'

const apiOrigin = 'https://office.example.test'
const profile = { schemaVersion: 2, apiOrigin, lanHostname: 'OFFICE', httpsPort: 8443, discoveryPort: 43110 }
const query = { protocol: 'hasarbotu-discovery-v1', nonce: 'a'.repeat(48), apiOrigin }
test('discovery is a bounded nonce-correlated hint with no credentials or arbitrary URL', () => {
  const answer = discoveryReply(Buffer.from(JSON.stringify(query)), '192.168.1.108', profile)
  assert.equal(JSON.parse(answer).httpsPort, 8443)
  for (const change of [{ nonce: 'bad' }, { apiOrigin: 'https://evil.test' }, { protocol: 'other' }]) assert.equal(discoveryReply(Buffer.from(JSON.stringify({ ...query, ...change })), '192.168.1.108', profile), undefined)
  assert.equal(discoveryReply(Buffer.alloc(513), '192.168.1.108', profile), undefined)
  assert.equal(discoveryReply(Buffer.from(JSON.stringify(query)), '100.79.1.1', profile), undefined)
})
test('legacy Caddy binds follow DHCP while certificate and API/portal routing are preserved', () => {
  const source = 'https://office.example.test {\n  bind 192.168.1.100\n  tls "cert.pem" "key.pem"\n  reverse_proxy 127.0.0.1:3100\n}\n'
  const rendered = renderLegacyCaddy(source, ['192.168.1.108', '10.0.0.2'])
  assert.ok(!rendered.includes('192.168.1.100')); assert.ok(rendered.includes('bind 192.168.1.108 10.0.0.2'))
  assert.ok(rendered.includes('tls "cert.pem" "key.pem"')); assert.ok(rendered.includes('127.0.0.1:3100'))
  assert.throws(() => renderLegacyCaddy(source, [])); assert.throws(() => renderLegacyCaddy(source, ['100.79.1.1']))
})
test('dedicated LAN listener cannot route desktop traffic to the field portal or collide on 443', () => {
  const config = gatewayCaddy(profile, 'C:/protected/network')
  assert.ok(config.includes(':8443')); assert.ok(config.includes('bind 0.0.0.0'))
  assert.ok(config.includes('reverse_proxy 127.0.0.1:3100')); assert.ok(!config.includes(':3200'))
  assert.ok(!config.includes('tls_insecure_skip_verify')); assert.ok(config.includes('handle {\n    respond 404'))
})
test('migration retains optional legacy remote access and later remote upgrades survive reinstall', { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hb-office-remote-'))
  const openssl = process.env.TEST_OPENSSL_EXE ?? (process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl')
  const options = { directory, openssl, apiOrigin: 'https://office.tail-example.ts.net', lanHostname: 'OFFICE' }
  try {
    const first = await provisionOfficeNetwork(options)
    assert.equal(first.profile.remoteOrigin, options.apiOrigin)
    const independent = await provisionOfficeNetwork({ ...options, remoteOrigin: 'https://remote.example.test' })
    assert.equal(independent.profile.caCertificate, first.profile.caCertificate)
    const reinstalled = await provisionOfficeNetwork(options)
    assert.equal(reinstalled.profile.remoteOrigin, 'https://remote.example.test')
    assert.equal(reinstalled.profile.apiOrigin, options.apiOrigin)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
test('real TLS, session continuity, simultaneous requests, outage/recovery and v1 migration', { timeout: 90_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hb-office-network-'))
  const openssl = process.env.TEST_OPENSSL_EXE ?? (process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl')
  let server, bridge
  try {
    const options = { directory, openssl, apiOrigin, lanHostname: 'OFFICE' }
    const provisioned = await provisionOfficeNetwork(options)
    const parsed = parseOfficeConnection(provisioned.profile)
    assert.equal(parsed.schemaVersion, 2); assert.equal(parsed.lanIpv4, undefined)
    const ca = parsed.caCertificate, originalCa = ca
    assert.equal((await provisionOfficeNetwork(options)).certificateChanged, false)
    assert.equal((await provisionOfficeNetwork({ ...options, renew: true })).profile.caCertificate, originalCa)
    await assert.rejects(() => provisionOfficeNetwork({ ...options, httpsPort: 9443 }), /EXISTING_PROFILE_DIFFERS/)
    const remote = await provisionOfficeNetwork({ ...options, remoteOrigin: 'https://remote.example.test' })
    assert.equal(remote.profile.caCertificate, originalCa)
    assert.equal((await provisionOfficeNetwork(options)).profile.remoteOrigin, 'https://remote.example.test')
    for (const invalid of [{ ...parsed, lanIpv4: '192.168.1.100' }, { ...parsed, apiOrigin: 'http://office.example.test' },
      { ...parsed, httpsPort: 443 }, { ...parsed, caCertificate: 'not-a-certificate' }, { ...parsed, remoteOrigin: 'http://remote.example.test' }]) {
      assert.throws(() => parseOfficeConnection(invalid))
    }
    const previous = JSON.parse(await readFile(join(directory, 'certificate-current.json'), 'utf8')).certificateBase
    // A real short-lived certificate exercises renewal and proves the installed CA pin survives it.
    execFileSync(openssl, ['x509', '-req', '-in', join(directory, 'server.csr'), '-CA', join(directory, 'ca.crt'), '-CAkey', join(directory, 'ca.key'),
      '-CAcreateserial', '-out', join(directory, previous + '.crt'), '-days', '1', '-sha256', '-extfile', join(directory, 'server.ext')], { windowsHide: true, stdio: 'pipe' })
    const renewed = await provisionOfficeNetwork({ ...options, renew: true })
    assert.equal(renewed.certificateChanged, true); assert.equal(renewed.profile.caCertificate, ca)
    assert.notEqual(JSON.parse(await readFile(join(directory, 'certificate-current.json'), 'utf8')).certificateBase, previous)
    assert.ok((await readFile(join(directory, 'Caddyfile.previous'), 'utf8')).includes(previous))
    const health = { status: 'ok', service: 'hasarbotu-api', version: '0.0.0', checkedAt: new Date().toISOString() }
    let writes = 0, cookies = [], writeFailure = false, healthCode = 200
    const makeServer = async () => {
      const { certificateBase } = JSON.parse(await readFile(join(directory, 'certificate-current.json'), 'utf8'))
      const instance = createServer({ cert: await readFile(join(directory, certificateBase + '.crt')), key: await readFile(join(directory, certificateBase + '.key')) }, (req, res) => {
        if (req.headers.host !== 'office.example.test') { res.statusCode = 421; res.end(); return }
        if (req.url === '/health') { res.statusCode = healthCode; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(health)); return }
        cookies.push(req.headers.cookie)
        if (req.method === 'POST') { writes++; if (writeFailure) { req.socket.destroy(); return } }
        res.setHeader('set-cookie', 'session=preserved; HttpOnly; SameSite=Strict; Path=/')
        res.end(req.headers.cookie === 'session=preserved' ? 'authenticated' : 'anonymous')
      })
      instance.listen(0, '127.0.0.1'); await once(instance, 'listening'); return instance
    }
    server = await makeServer()
    let selected = { hostname: '127.0.0.1', servername: 'office.example.test', httpHost: 'office.example.test', port: server.address().port, ca }
    const body = await officeHealth(selected, apiOrigin)
    assert.equal(body.service, 'hasarbotu-api')
    for (const code of [502, 503, 504]) {
      healthCode = code
      await assert.rejects(() => officeHealth(selected, apiOrigin), error => error.reason === 'service')
    }
    healthCode = 200
    await assert.rejects(() => officeHealth({ ...selected, servername: 'fake.example.test' }, apiOrigin), error => error.code === 'ERR_TLS_CERT_ALTNAME_INVALID')
    await assert.rejects(() => officeHealth({ ...selected, ca: undefined }, apiOrigin), error => /CERT|SELF_SIGNED|VERIFY/.test(error.code))
    let invalidations = 0
    bridge = await startDesktopBridge({ apiOrigin: 'https://stable-logical-origin.example.test', connection: { resolve: async () => selected, invalidate: () => { invalidations++ } }, upstreamTimeoutMs: 1000 })
    const initial = await fetch(bridge.origin + '/api/v1/auth/session', { headers: { cookie: 'session=preserved' } })
    assert.equal(await initial.text(), 'authenticated')
    const stableOrigin = bridge.origin
    await new Promise(done => server.close(done))
    const offline = await fetch(bridge.origin + '/api/v1/auth/session')
    assert.equal(offline.status, 502); assert.equal(invalidations, 1)
    server = await makeServer(); selected = { ...selected, port: server.address().port }
    const results = await Promise.all(Array.from({ length: 12 }, async () => (await fetch(bridge.origin + '/api/v1/auth/session', { headers: { cookie: 'session=preserved' } })).text()))
    assert.ok(results.every(value => value === 'authenticated')); assert.equal(bridge.origin, stableOrigin)
    writeFailure = true
    assert.equal((await fetch(bridge.origin + '/api/v1/cases', { method: 'POST', body: '{}', headers: { cookie: 'session=preserved' } })).status, 502)
    assert.equal(writes, 1, 'an uncertain write is never automatically repeated')
    assert.ok(cookies.every(cookie => cookie === 'session=preserved'))
    const before = cookies.length
    selected = { ...selected, servername: 'evil.example.test' }
    assert.equal((await fetch(bridge.origin + '/api/v1/auth/session', { headers: { cookie: 'session=preserved' } })).status, 502)
    assert.equal(cookies.length, before, 'invalid TLS receives no HTTP request or session cookie')
    // Migration uses the same canonical origin; old literals never enter the resolver.
    const old = parseOfficeConnection({ schemaVersion: 1, apiOrigin, lanHostname: 'OFFICE', lanIpv4: '192.168.1.100' })
    const migrated = createOfficeNetwork(old, { lookup: async () => ['192.168.1.108'], discover: async () => [], health: async () => health })
    assert.equal((await migrated.resolve()).hostname, '192.168.1.108')
    await rm(join(directory, 'ca.crt')); await rm(join(directory, 'ca.key'))
    await assert.rejects(() => provisionOfficeNetwork(options), /EXISTING_CA_MISSING_REFUSING_REPLACEMENT/)
  } finally {
    await bridge?.close()
    if (server?.listening) await new Promise(done => server.close(done))
    await rm(directory, { recursive: true, force: true })
  }
})
test('real UDP discovery on the available private LAN interface', { skip: !lanAddresses().length }, async () => {
  const address = lanAddresses()[0], socket = await startDiscovery(profile, { port: 0 })
  const client = createSocket('udp4')
  try {
    const reply = new Promise((done, reject) => {
      const timer = setTimeout(() => reject(Error('UDP_DISCOVERY_TIMEOUT')), 2500)
      client.once('message', bytes => { clearTimeout(timer); done(JSON.parse(bytes)) })
    })
    client.send(Buffer.from(JSON.stringify(query)), socket.address().port, address)
    assert.equal((await reply).nonce, query.nonce)
  } finally { client.close(); socket.close() }
})
test('a stalled TCP/TLS handshake is bounded and invalidates the old route without replay', { timeout: 15_000 }, async () => {
  let accepted, invalidations = 0
  const tcp = createTcpServer(socket => { accepted = socket })
  tcp.listen(0, '127.0.0.1'); await once(tcp, 'listening')
  const endpoint = { hostname: '127.0.0.1', servername: 'office.example.test', port: tcp.address().port }
  const bridge = await startDesktopBridge({ apiOrigin, connection: { resolve: async () => endpoint, invalidate: () => { invalidations++ } } })
  try {
    assert.equal((await fetch(bridge.origin + '/api/v1/auth/session')).status, 504)
    assert.ok(invalidations >= 1)
  } finally { await bridge.close(); accepted?.destroy(); await new Promise(done => tcp.close(done)) }
})
test('real Caddy wildcard listener, private CA, API authorization and portal separation', { skip: !process.env.TEST_CADDY_EXE, timeout: 90_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hb-caddy-office-'))
  const openssl = process.env.TEST_OPENSSL_EXE ?? (process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl')
  const forwarded = []
  const api = createHttpServer((req, res) => {
    if (req.url === '/api/v1/cases') forwarded.push(req.headers)
    res.setHeader('content-type', 'application/json')
    if (req.url === '/health') res.end(JSON.stringify({ status: 'ok', service: 'hasarbotu-api', version: '0.0.0', checkedAt: new Date().toISOString() }))
    else { res.statusCode = req.headers.cookie === 'session=preserved' ? 200 : 401; res.end('{}') }
  })
  let child, bridge
  try {
    api.listen(3100, '127.0.0.1'); await once(api, 'listening')
    const reserve = createHttpServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening')
    const port = reserve.address().port
    await new Promise(done => reserve.close(done))
    const { profile } = await provisionOfficeNetwork({ directory, openssl, apiOrigin, lanHostname: 'OFFICE', httpsPort: port })
    execFileSync(process.env.TEST_CADDY_EXE, ['validate', '--config', join(directory, 'Caddyfile'), '--adapter', 'caddyfile'], { windowsHide: true, stdio: 'pipe', timeout: 15_000 })
    const absent = ['192.168.1.100', '10.254.254.254'].find(address => !lanAddresses().includes(address))
    assert.ok(absent)
    const broken = join(directory, 'Caddyfile.absent-dhcp-address')
    await writeFile(broken, (await readFile(join(directory, 'Caddyfile'), 'utf8')).replace('bind 0.0.0.0', 'bind ' + absent))
    assert.throws(() => execFileSync(process.env.TEST_CADDY_EXE, ['run', '--config', broken, '--adapter', 'caddyfile'],
      { windowsHide: true, stdio: 'pipe', timeout: 5000 }), error => error.status !== null && error.stderr.toString().includes('bind:'))
    child = spawn(process.env.TEST_CADDY_EXE, ['run', '--config', join(directory, 'Caddyfile'), '--adapter', 'caddyfile'], { windowsHide: true, stdio: 'ignore' })
    const exited = new Promise(done => child.once('exit', done))
    let verified
    for (let i = 0; i < 30; i++) {
      try { verified = await verifyGateway(profile); break } catch { await new Promise(done => setTimeout(done, 100)) }
    }
    assert.equal(verified?.tlsVerified, true)
    const endpoint = { hostname: '127.0.0.1', port, servername: 'office.example.test', ca: profile.caCertificate }
    bridge = await startDesktopBridge({ apiOrigin, connection: { resolve: async () => endpoint, invalidate: () => {} } })
    assert.equal((await fetch(bridge.origin + '/api/v1/cases')).status, 401, 'network discovery never grants application authorization')
    assert.equal((await fetch(bridge.origin + '/api/v1/cases', { headers: { cookie: 'session=preserved' } })).status, 200)
    assert.equal((await fetch(bridge.origin + '/api/v1/cases', { headers: { cookie: 'session=preserved', 'x-forwarded-for': '198.51.100.99', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'http' } })).status, 200)
    assert.equal(forwarded.at(-1)['x-forwarded-for'], '127.0.0.1', 'the gateway replaces caller-supplied client addresses')
    assert.equal(forwarded.at(-1)['x-forwarded-host'], undefined)
    assert.equal(forwarded.at(-1)['x-forwarded-proto'], undefined)
    const wrongPortal = { ...endpoint }
    const probe = await new Promise((done, reject) => {
      import('node:https').then(({ request }) => {
        const req = request({ ...wrongPortal, path: '/field-health', headers: { host: 'office.example.test' } }, res => { res.resume(); done(res.statusCode) })
        req.once('error', reject); req.end()
      }, reject)
    })
    assert.equal(probe, 404)
    await bridge.close(); bridge = undefined
    child.kill(); await exited; child = undefined
  } finally {
    await bridge?.close()
    if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited }
    await new Promise(done => api.close(done))
    await rm(directory, { recursive: true, force: true })
  }
})
