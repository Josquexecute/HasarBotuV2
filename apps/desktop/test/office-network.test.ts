import { describe, expect, it, vi } from 'vitest'
import { createOfficeNetwork, isPrivateIpv4, OfficeNetworkError, classifyNetworkFailure } from '../src/main/office-network.js'
import type { OfficeConnection } from '../src/main/office-connection.js'

const profile: OfficeConnection = { schemaVersion: 2, apiOrigin: 'https://office.example.test', lanHostname: 'OFFICE', httpsPort: 8443, discoveryPort: 43110, caCertificate: 'test-only-ca' }
const good = { service: 'hasarbotu-api', status: 'ok' }
const base = { discover: async () => [], networks: () => ({ fingerprint: 'network-a', broadcasts: [] }), health: async () => good }

describe('automatic office routing', () => {
  it('rediscovers DHCP changes without changing the logical origin or retaining an old IP', async () => {
    let now = 0, address = '192.168.1.100'
    const connection = createOfficeNetwork(profile, { ...base, lookup: async () => [address], now: () => now })
    const first = await connection.resolve()
    address = '192.168.1.108'; now = 15001
    const next = await connection.resolve()
    expect([first.hostname, next.hostname]).toEqual(['192.168.1.100', '192.168.1.108'])
    expect(next).toMatchObject({ servername: 'office.example.test', port: 8443, ca: 'test-only-ca' })
  })
  it('uses discovery without DNS, Tailscale, a hosts entry or a saved address', async () => {
    const connection = createOfficeNetwork(profile, { ...base, lookup: async () => { throw Object.assign(Error(), { code: 'ENOTFOUND' }) }, discover: async () => ['192.168.1.108'] })
    expect((await connection.resolve()).hostname).toBe('192.168.1.108')
  })
  it('shares one discovery/verification cycle between simultaneous clients of the bridge', async () => {
    const lookup = vi.fn(async () => ['10.0.0.5']), health = vi.fn(async () => good)
    const connection = createOfficeNetwork(profile, { ...base, lookup, health })
    const endpoints = await Promise.all(Array.from({ length: 30 }, () => connection.resolve()))
    expect(lookup).toHaveBeenCalledTimes(1); expect(health).toHaveBeenCalledTimes(1)
    expect(endpoints.every(endpoint => endpoint === endpoints[0])).toBe(true)
  })
  it('immediately rediscovers after a network change despite the positive cache', async () => {
    let fingerprint = 'a', address = '10.0.0.5'
    const connection = createOfficeNetwork(profile, { ...base, lookup: async () => [address], networks: () => ({ fingerprint, broadcasts: [] }) })
    expect((await connection.resolve()).hostname).toBe(address)
    fingerprint = 'b'; address = '172.16.1.5'
    expect((await connection.resolve()).hostname).toBe(address)
  })
  it('invalidates a failed route and does not replay the failed request', async () => {
    let address = '10.0.0.5'
    const connection = createOfficeNetwork(profile, { ...base, lookup: async () => [address] })
    const failed = await connection.resolve()
    connection.invalidate(failed); address = '10.0.0.6'
    const next = await connection.resolve()
    connection.invalidate(failed)
    expect(await connection.resolve()).toBe(next)
    expect(next.hostname).toBe(address)
  })
  it('limits failed discovery and recovers when the network returns', async () => {
    let now = 0, online = false
    const lookup = vi.fn(async () => online ? ['10.0.0.5'] : [])
    const connection = createOfficeNetwork(profile, { ...base, lookup, now: () => now })
    await expect(connection.resolve()).rejects.toMatchObject({ reason: 'dns' })
    await expect(connection.resolve()).rejects.toBeInstanceOf(OfficeNetworkError)
    expect(lookup).toHaveBeenCalledTimes(1)
    online = true; now = 2001
    expect((await connection.resolve()).hostname).toBe('10.0.0.5')
  })
  it('clears failure backoff on an observed interface change', async () => {
    let fingerprint = 'offline'
    const connection = createOfficeNetwork(profile, { ...base, lookup: async () => fingerprint === 'offline' ? [] : ['10.0.0.5'], networks: () => ({ fingerprint, broadcasts: [] }) })
    await expect(connection.resolve()).rejects.toThrow()
    fingerprint = 'online'
    expect((await connection.resolve()).hostname).toBe('10.0.0.5')
  })
  it('rejects the photo portal, wrong API and certificate failures before selecting a route', async () => {
    for (const body of [{ status: 'ok' }, { service: 'photo-portal', status: 'ok' }, { service: 'hasarbotu-api', status: 'error' }]) {
      const connection = createOfficeNetwork(profile, { ...base, lookup: async () => ['10.0.0.5'], health: async () => body })
      await expect(connection.resolve()).rejects.toMatchObject({ reason: 'wrong_server' })
    }
    const connection = createOfficeNetwork(profile, { ...base, lookup: async () => ['10.0.0.5'], health: async () => { throw Object.assign(Error(), { code: 'CERT_HAS_EXPIRED' }) } })
    await expect(connection.resolve()).rejects.toMatchObject({ reason: 'tls' })
  })
  it('does not use public or Tailscale addresses received through LAN discovery', async () => {
    const health = vi.fn(async () => good)
    const connection = createOfficeNetwork(profile, { ...base, lookup: async () => ['8.8.8.8', '127.0.0.1', '100.79.1.1'], discover: async () => ['169.254.1.1', '::1'], health })
    await expect(connection.resolve()).rejects.toThrow()
    expect(health).not.toHaveBeenCalled()
  })
  it('preserves legacy origin and remote behavior while ignoring the obsolete packaged IP', async () => {
    const legacy: OfficeConnection = { schemaVersion: 1, apiOrigin: profile.apiOrigin, lanHostname: profile.lanHostname, lanIpv4: '192.168.1.100' }
    const health = vi.fn(async () => good)
    const connection = createOfficeNetwork(legacy, { ...base, lookup: async () => ['192.168.1.108'], health })
    expect((await connection.resolve()).hostname).toBe('192.168.1.108')
    expect(health.mock.calls).toHaveLength(1)
    const remote = createOfficeNetwork(legacy, { ...base, lookup: async () => [], health })
    expect((await remote.resolve()).hostname).toBe('office.example.test')
  })
  it('uses only an explicitly provisioned remote HTTPS route outside the office', async () => {
    const connection = createOfficeNetwork({ ...profile, remoteOrigin: 'https://remote.example.test' }, { ...base, lookup: async () => [] })
    expect(await connection.resolve()).toEqual({ hostname: 'remote.example.test', servername: 'remote.example.test', port: 443, httpHost: 'remote.example.test' })
  })
  it('reports database degradation to the existing readiness gate instead of changing servers', async () => {
    const connection = createOfficeNetwork(profile, { ...base, lookup: async () => ['10.0.0.5'], health: async () => ({ service: 'hasarbotu-api', status: 'degraded' }) })
    expect((await connection.resolve()).hostname).toBe('10.0.0.5')
  })
  it('classifies certificate, DNS, refused-port and timeout failures separately', () => {
    for (const [code, reason] of [['CERT_HAS_EXPIRED', 'tls'], ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls'], ['ENOTFOUND', 'dns'], ['ECONNREFUSED', 'refused'], ['ABORT_ERR', 'timeout']]) {
      expect(classifyNetworkFailure({ code })).toBe(reason)
    }
    for (const address of ['10.0.0.1', '172.31.1.1', '192.168.1.108']) expect(isPrivateIpv4(address)).toBe(true)
    for (const address of ['999.0.0.1', '172.32.0.1', '127.0.0.1', '100.79.1.1']) expect(isPrivateIpv4(address)).toBe(false)
  })
  it('does not publish discovery that finished on a departed network', async () => {
    let fingerprint = 'a', complete!: (value: typeof good) => void
    const health = vi.fn().mockImplementationOnce(() => new Promise<typeof good>(resolve => { complete = resolve })).mockResolvedValue(good)
    const connection = createOfficeNetwork(profile, { ...base, lookup: async () => ['10.0.0.5'], health, networks: () => ({ fingerprint, broadcasts: [] }) })
    const previous = connection.resolve()
    await vi.waitFor(() => expect(health).toHaveBeenCalledTimes(1))
    fingerprint = 'b'; complete(good)
    await expect(previous).rejects.toMatchObject({ reason: 'unavailable' })
    expect((await connection.resolve()).hostname).toBe('10.0.0.5')
  })
})
