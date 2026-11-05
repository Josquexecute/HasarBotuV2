import { lookup } from 'node:dns/promises'
import { networkInterfaces } from 'node:os'
import { createSocket } from 'node:dgram'
import { randomBytes } from 'node:crypto'
import { request } from 'node:https'
import type { ApiConnection, ApiEndpoint } from '@hasarbotu/desktop-bridge'
import type { OfficeConnection } from './office-connection.js'

export type NetworkFailure = 'dns' | 'tls' | 'timeout' | 'refused' | 'service' | 'wrong_server' | 'unavailable'
export class OfficeNetworkError extends Error {
  constructor(readonly reason: NetworkFailure) { super(`Office network: ${reason}`); this.name = 'OfficeNetworkError' }
}

export function classifyNetworkFailure(error: unknown): NetworkFailure {
  if (error instanceof OfficeNetworkError) return error.reason
  const code = (error as NodeJS.ErrnoException)?.code ?? ''
  if (/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)) return 'tls'
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) return 'dns'
  if (code === 'ECONNREFUSED') return 'refused'
  if (['ETIMEDOUT', 'ABORT_ERR'].includes(code)) return 'timeout'
  return 'unavailable'
}

export function isPrivateIpv4(address: string): boolean {
  const octets = address.split('.').map(Number)
  return octets.length === 4 && octets.every(n => Number.isInteger(n) && n >= 0 && n <= 255)
    && (octets[0] === 10 || octets[0] === 192 && octets[1] === 168 || octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31)
}

export function localNetworks(): { fingerprint: string; broadcasts: string[] } {
  const interfaces = Object.values(networkInterfaces()).flatMap(entries => entries ?? [])
    .filter(entry => entry.family === 'IPv4' && !entry.internal && isPrivateIpv4(entry.address))
  return {
    fingerprint: interfaces.map(entry => `${entry.address}/${entry.netmask}`).sort().join(','),
    broadcasts: [...new Set(interfaces.map(entry => entry.address.split('.').map((n, i) => Number(n) | (255 ^ Number(entry.netmask.split('.')[i]))).join('.')))],
  }
}

/** Untrusted hints only. No endpoint is selected until TLS and /health succeed. */
export async function discoverOffice(profile: OfficeConnection, timeoutMs = 900): Promise<string[]> {
  if (!profile.discoveryPort) return []
  const broadcasts = localNetworks().broadcasts
  if (!broadcasts.length) return []
  const nonce = randomBytes(24).toString('hex'), addresses = new Set<string>()
  return new Promise(resolve => {
    const socket = createSocket('udp4')
    let finished = false
    const finish = () => { if (finished) return; finished = true; clearTimeout(timer); socket.close(); resolve([...addresses]) }
    const timer = setTimeout(finish, timeoutMs)
    socket.on('error', () => finish())
    socket.on('message', (bytes, peer) => {
      if (bytes.length > 1024 || !isPrivateIpv4(peer.address) || addresses.size >= 8) return
      try {
        const value = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>
        if (value.protocol === 'hasarbotu-discovery-v1' && value.nonce === nonce && value.apiOrigin === profile.apiOrigin && value.httpsPort === profile.httpsPort) addresses.add(peer.address)
      } catch { /* Unrelated or malformed LAN datagrams are not discovery answers. */ }
    })
    socket.bind(0, '0.0.0.0', () => {
      socket.setBroadcast(true)
      const bytes = Buffer.from(JSON.stringify({ protocol: 'hasarbotu-discovery-v1', nonce, apiOrigin: profile.apiOrigin }))
      for (const address of broadcasts) socket.send(bytes, profile.discoveryPort!, address, () => {})
    })
  })
}

/** Credential-free probe, bounded body, no redirect, standard chain/name checks. */
export async function officeHealth(endpoint: ApiEndpoint, apiOrigin: string, timeoutMs = 2500): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const req = request({ ...endpoint, path: '/health', method: 'GET', headers: { host: endpoint.httpHost ?? new URL(apiOrigin).host, accept: 'application/json' },
      signal: controller.signal, agent: false, rejectUnauthorized: true }, response => {
      const chunks: Buffer[] = []
      let size = 0
      response.on('error', reject)
      response.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > 8192) { req.destroy(new OfficeNetworkError('wrong_server')); return }
        chunks.push(chunk)
      })
      response.on('end', () => {
        if ([502, 503, 504].includes(response.statusCode ?? 0)) { reject(new OfficeNetworkError('service')); return }
        if (response.statusCode !== 200) { reject(new OfficeNetworkError('wrong_server')); return }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown) }
        catch { reject(new OfficeNetworkError('wrong_server')) }
      })
    })
    req.once('error', reject)
    req.once('close', () => clearTimeout(timer))
    req.end()
  })
}

export interface OfficeNetworkDeps {
  readonly lookup?: (hostname: string) => Promise<string[]>
  readonly discover?: (profile: OfficeConnection) => Promise<string[]>
  readonly health?: (endpoint: ApiEndpoint, origin: string) => Promise<unknown>
  readonly networks?: typeof localNetworks
  readonly now?: () => number
  readonly report?: (state: { outcome: 'connected' | NetworkFailure; route?: 'lan' | 'remote' }) => void
}

export function createOfficeNetwork(profile: OfficeConnection, deps: OfficeNetworkDeps = {}): ApiConnection {
  const dns = deps.lookup ?? (hostname => new Promise<string[]>((resolve, reject) => {
    const timer = setTimeout(() => reject(new OfficeNetworkError('dns')), 2000)
    lookup(hostname, { all: true, family: 4 }).then(entries => resolve(entries.map(entry => entry.address)), reject).finally(() => clearTimeout(timer))
  }))
  const health = deps.health ?? officeHealth, networks = deps.networks ?? localNetworks, now = deps.now ?? Date.now
  let active: ApiEndpoint | undefined, expires = 0, fingerprint = '', pending: Promise<ApiEndpoint> | undefined
  let failedUntil = 0, lastFailure: NetworkFailure = 'unavailable'
  const probe = async (endpoint: ApiEndpoint) => {
    const body = await health(endpoint, profile.apiOrigin)
    if (!body || typeof body !== 'object' || !('service' in body) || body.service !== 'hasarbotu-api'
      || !('status' in body) || !['ok', 'degraded'].includes(String(body.status))) throw new OfficeNetworkError('wrong_server')
    return endpoint
  }
  const resolveFresh = async (): Promise<ApiEndpoint> => {
    const canonical = new URL(profile.apiOrigin)
    const makeLan = (hostname: string): ApiEndpoint => ({ hostname, servername: canonical.hostname,
      port: profile.httpsPort ?? 443, ...(profile.caCertificate ? { ca: profile.caCertificate } : {}) })
    // DNS is a fast path; broadcast also works where Windows hostname lookup is disabled.
    const candidates = await Promise.allSettled([dns(profile.lanHostname), (deps.discover ?? discoverOffice)(profile)])
    const addresses = [...new Set(candidates.flatMap(result => result.status === 'fulfilled' ? result.value.filter(isPrivateIpv4) : []))].slice(0, 8)
    const outcomes = await Promise.allSettled(addresses.map(address => probe(makeLan(address))))
    let endpoint = outcomes.find(result => result.status === 'fulfilled')
    if (endpoint?.status === 'fulfilled') { deps.report?.({ outcome: 'connected', route: 'lan' }); return endpoint.value }
    const errors: unknown[] = outcomes.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
    // v1 keeps the existing optional remote route. v2 requires an explicit administrator-provisioned route.
    const remoteOrigin = profile.remoteOrigin ?? (profile.schemaVersion === 1 ? profile.apiOrigin : undefined)
    if (remoteOrigin) {
      const remote = new URL(remoteOrigin)
      try {
        endpoint = { status: 'fulfilled', value: await probe({ hostname: remote.hostname, servername: remote.hostname, port: Number(remote.port || 443), httpHost: remote.host }) }
        deps.report?.({ outcome: 'connected', route: 'remote' })
        return endpoint.value
      } catch (error) { errors.push(error) }
    }
    const reasons = errors.map(classifyNetworkFailure)
    throw new OfficeNetworkError(reasons.includes('tls') ? 'tls' : reasons.includes('wrong_server') ? 'wrong_server' : reasons[0] ?? (addresses.length ? 'unavailable' : 'dns'))
  }
  return {
    async resolve() {
      const current = networks().fingerprint
      if (current !== fingerprint) { active = undefined; expires = 0; failedUntil = 0; fingerprint = current }
      if (active && now() < expires) return active
      if (pending) return pending
      if (now() < failedUntil) throw new OfficeNetworkError(lastFailure)
      pending = resolveFresh().then(endpoint => {
        if (networks().fingerprint !== current) throw new OfficeNetworkError('unavailable')
        active = endpoint; expires = now() + 15_000; failedUntil = 0; return endpoint
      }).catch((error: unknown) => {
        lastFailure = classifyNetworkFailure(error); failedUntil = networks().fingerprint === current ? now() + 2000 : 0; deps.report?.({ outcome: lastFailure }); throw error
      }).finally(() => { pending = undefined })
      return pending
    },
    invalidate(endpoint) { if (active === endpoint) { active = undefined; expires = 0 } },
  }
}
