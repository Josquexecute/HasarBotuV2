import { createSocket } from 'node:dgram'
import { networkInterfaces } from 'node:os'
import { readFile, writeFile, rename } from 'node:fs/promises'
import { spawn, execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { request } from 'node:https'

export function isPrivateIpv4(address) {
  const n = address.split('.').map(Number)
  return n.length === 4 && n.every(v => Number.isInteger(v) && v >= 0 && v <= 255)
    && (n[0] === 10 || n[0] === 192 && n[1] === 168 || n[0] === 172 && n[1] >= 16 && n[1] <= 31)
}

export function lanAddresses() {
  return [...new Set(Object.values(networkInterfaces()).flatMap(entries => entries ?? [])
    .filter(entry => entry.family === 'IPv4' && !entry.internal && isPrivateIpv4(entry.address)).map(entry => entry.address))].sort()
}

export function discoveryReply(bytes, address, profile) {
  if (!isPrivateIpv4(address) || bytes.length > 512) return undefined
  try {
    const input = JSON.parse(bytes.toString('utf8'))
    if (input.protocol !== 'hasarbotu-discovery-v1' || input.apiOrigin !== profile.apiOrigin || !/^[a-f0-9]{48}$/.test(input.nonce)) return undefined
    return Buffer.from(JSON.stringify({ protocol: input.protocol, nonce: input.nonce, apiOrigin: profile.apiOrigin, httpsPort: profile.httpsPort }))
  } catch { return undefined }
}

export async function startDiscovery(profile, { port = profile.discoveryPort, host = '0.0.0.0' } = {}) {
  const socket = createSocket('udp4')
  let interval = Date.now(), answers = 0
  socket.on('message', (bytes, peer) => {
    if (Date.now() - interval >= 1000) { interval = Date.now(); answers = 0 }
    // Global budget prevents source-spoofed UDP reflection without an unbounded peer map.
    if (answers >= 40) return
    const reply = discoveryReply(bytes, peer.address, profile)
    if (reply) { answers++; socket.send(reply, peer.port, peer.address, error => { if (error) console.error(JSON.stringify({ event: 'discovery_send_failed', code: error.code })) }) }
  })
  await new Promise((done, reject) => {
    socket.once('error', reject)
    socket.bind(port, host, () => { socket.removeListener('error', reject); done() })
  })
  socket.on('error', error => { console.error(JSON.stringify({ event: 'discovery_socket_failed', code: error.code })); process.exitCode = 1; socket.close() })
  return socket
}

export async function verifyGateway(profile) {
  const origin = new URL(profile.apiOrigin)
  return new Promise((done, reject) => {
    const req = request({ hostname: '127.0.0.1', port: profile.httpsPort, servername: origin.hostname,
      ca: profile.caCertificate, rejectUnauthorized: true, method: 'GET', path: '/health', headers: { host: origin.host },
      signal: AbortSignal.timeout(5000), agent: false }, response => {
      let body = '', size = 0
      response.on('error', reject)
      response.on('data', bytes => { size += bytes.length; if (size > 8192) req.destroy(Error('HEALTH_RESPONSE_TOO_LARGE')); else body += bytes.toString('utf8') })
      response.on('end', () => {
        try {
          if ([502, 503, 504].includes(response.statusCode)) throw Error('UPSTREAM_UNAVAILABLE')
          const value = JSON.parse(body)
          if (response.statusCode !== 200 || value.service !== 'hasarbotu-api') throw Error('WRONG_API_SERVICE')
          if (value.status !== 'ok') throw Error('API_NOT_READY')
          done({ status: 'PASS', tlsVerified: true, apiHealthy: true })
        } catch (error) { reject(error) }
      })
    })
    req.once('error', reject); req.end()
  })
}

export async function waitGateway(profile, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try { return await verifyGateway(profile) }
    catch (error) {
      if (!['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ABORT_ERR', 'EPIPE', 'API_NOT_READY', 'UPSTREAM_UNAVAILABLE'].includes(error.code ?? error.message) || Date.now() >= deadline) throw error
      await new Promise(done => setTimeout(done, Math.min(500, deadline - Date.now())))
    }
  }
}

export function renderLegacyCaddy(template, addresses) {
  if (!addresses.length || !addresses.every(isPrivateIpv4)) throw new Error('LAN_ADDRESS_UNAVAILABLE')
  let replaced = 0
  const rendered = template.replace(/^(\s*)bind\s+([^\r\n]+)$/gm, (line, indent, values) => {
    if (!values.split(/\s+/).some(isPrivateIpv4)) return line
    replaced++
    return `${indent}bind ${addresses.join(' ')}`
  })
  if (!replaced) throw new Error('LEGACY_LAN_BIND_NOT_FOUND')
  return rendered
}

/** Only the legacy 443 listener needs interface binds to coexist with Tailscale Serve. */
export async function superviseLegacyCaddy(caddy, templateFile, configFile) {
  const template = await readFile(templateFile, 'utf8')
  let child, fingerprint, changing = false, stopping = false
  const stopChild = async () => {
    const previous = child
    child = undefined
    if (!previous || previous.exitCode !== null) return
    await new Promise(done => { previous.once('exit', done); previous.kill() })
  }
  const update = async () => {
    const addresses = lanAddresses(), next = addresses.join(',')
    if (changing || next === fingerprint || stopping) return
    changing = true
    try {
      if (!addresses.length) { await stopChild(); fingerprint = next; console.error('{"event":"legacy_waiting_for_lan"}'); return }
      const candidate = configFile + '.candidate'
      await writeFile(candidate, renderLegacyCaddy(template, addresses), { mode: 0o600 })
      execFileSync(caddy, ['validate', '--config', candidate, '--adapter', 'caddyfile'], { windowsHide: true, stdio: ['ignore', 'ignore', 'inherit'], timeout: 20_000 })
      await stopChild()
      await rename(candidate, configFile)
      child = spawn(caddy, ['run', '--config', configFile, '--adapter', 'caddyfile'], { windowsHide: true, stdio: 'inherit' })
      child.once('error', error => { console.error(JSON.stringify({ event: 'legacy_start_failed', code: error.code })); process.exitCode = 1; clearInterval(timer) })
      child.once('exit', code => {
        if (!changing && !stopping) { console.error(JSON.stringify({ event: 'legacy_exited', code })); process.exitCode = 1; clearInterval(timer) }
      })
      fingerprint = next
      console.log('{"event":"legacy_lan_binding_updated"}')
    } finally { changing = false }
  }
  const timer = setInterval(() => { update().catch(error => { console.error(JSON.stringify({ event: 'legacy_update_failed', code: error.code ?? error.message })); clearInterval(timer); void stopChild().finally(() => { process.exitCode = 1 }) }) }, 5000)
  const stop = () => { stopping = true; clearInterval(timer); void stopChild() }
  process.once('SIGINT', stop); process.once('SIGTERM', stop)
  try { await update() }
  catch (error) { clearInterval(timer); await stopChild(); throw error }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, ...args] = process.argv.slice(2)
  try {
    if (mode === 'discovery') {
      const profile = JSON.parse(await readFile(args[0], 'utf8'))
      if (profile.schemaVersion !== 2 || !Number.isInteger(profile.discoveryPort) || profile.discoveryPort < 1024 || profile.discoveryPort > 65535) throw Error('INVALID_PROFILE')
      const socket = await startDiscovery(profile)
      process.once('SIGINT', () => socket.close()); process.once('SIGTERM', () => socket.close())
      console.log('{"event":"discovery_ready"}')
    } else if (mode === 'verify') console.log(JSON.stringify(await verifyGateway(JSON.parse(await readFile(args[0], 'utf8')))))
    else if (mode === 'wait') console.log(JSON.stringify(await waitGateway(JSON.parse(await readFile(args[0], 'utf8')))))
    else if (mode === 'legacy-caddy') await superviseLegacyCaddy(...args)
    else throw Error('INVALID_MODE')
  } catch (error) { console.error(JSON.stringify({ event: 'office_network_failed', code: error.code ?? error.message })); process.exitCode = 1 }
}
