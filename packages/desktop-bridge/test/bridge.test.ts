import { createServer, globalAgent as httpAgent, type Server } from 'node:http'
import { createServer as createHttpsServer, globalAgent } from 'node:https'
import { createReadStream } from 'node:fs'
import { mkdtemp, writeFile, rm, mkdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { PassThrough } from 'node:stream'
import { expect, it, vi } from 'vitest'
import { startDesktopBridge, upstreamTimeoutFor } from '../src/bridge.js'
import { createTestTlsCertificate } from '../../../scripts/test-tls-certificate.mjs'

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, createReadStream: vi.fn(actual.createReadStream) }
})

async function listen(server: Server): Promise<number> {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return (server.address() as { port: number }).port
}
async function close(server: Server) {
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}

it('does not accumulate connect listeners on a reused upstream HTTP socket', async () => {
  const upstream = createServer((_req, res) => res.end('ok'))
  const port = await listen(upstream), bridge = await startDesktopBridge({ apiOrigin: `http://127.0.0.1:${port}` })
  try {
    await (await fetch(bridge.origin + '/api/test')).text()
    await new Promise<void>(done => setImmediate(done))
    const socket = Object.values(httpAgent.freeSockets).flat().find(value => value?.remotePort === port)!
    expect(socket).toBeDefined()
    const before = socket.listenerCount('connect')
    for (let index = 0; index < 20; index++) expect(await (await fetch(bridge.origin + '/api/test')).text()).toBe('ok')
    expect(socket.listenerCount('connect')).toBe(before)
  } finally { await bridge.close(); await close(upstream) }
})

it('forwards a native callback only through the bridge that initiated it and rejects foreign flows and replays', async () => {
  const flowId = 'synthetic-native-local-flow-123456'
  let origin = '', callbacks = 0
  const upstream = createServer((request, response) => {
    request.resume()
    if (request.url === '/api/v1/google/start') {
      expect(request.headers['accept-encoding']).toBe('identity')
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ flowId, url: 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ state: flowId, redirect_uri: origin + '/api/v1/google/desktop/callback' }) }))
    } else { callbacks++; response.writeHead(303, { location: '/api/v1/google/result/desktop/login/success' }); response.end() }
  })
  const port = await listen(upstream)
  const first = await startDesktopBridge({ apiOrigin: `http://127.0.0.1:${port}` }), second = await startDesktopBridge({ apiOrigin: `http://127.0.0.1:${port}` })
  origin = first.origin
  const callback = '/api/v1/google/desktop/callback?state=' + flowId + '&code=synthetic-code'
  try {
    expect((await fetch(first.origin + callback, { redirect: 'manual' })).headers.get('location')).toMatch(/expired$/)
    expect(callbacks).toBe(0)
    await (await fetch(first.origin + '/api/v1/google/start', { method: 'POST', body: '{}' })).json()
    expect((await fetch(second.origin + callback, { redirect: 'manual' })).headers.get('location')).toMatch(/expired$/)
    expect(callbacks).toBe(0)
    expect((await fetch(first.origin + callback, { redirect: 'manual' })).headers.get('location')).toMatch(/success$/)
    expect(callbacks).toBe(1)
    expect((await fetch(first.origin + callback, { redirect: 'manual' })).headers.get('location')).toMatch(/expired$/)
    expect(callbacks).toBe(1)
  } finally { await first.close(); await second.close(); await close(upstream) }
})

it('proxies trusted HTTPS and rejects an untrusted certificate', async () => {
  const { cert, key } = createTestTlsCertificate()
  const upstream = createHttpsServer({ cert, key }, (_req, res) => res.end('secure API'))
  const port = await listen(upstream)
  const bridge = await startDesktopBridge({ apiOrigin: `https://127.0.0.1:${port}` })
  const previousCa = globalAgent.options.ca
  try {
    expect((await fetch(`${bridge.origin}/api/test`)).status).toBe(502)
    globalAgent.options.ca = cert
    const response = await fetch(`${bridge.origin}/api/test`)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('secure API')
  } finally { globalAgent.options.ca = previousCa; await bridge.close(); await close(upstream) }
})

it('handles an asset becoming unreadable after stat and remains available', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hb-assets-'))
  await writeFile(join(directory, 'index.html'), 'working')
  const bridge = await startDesktopBridge({ apiOrigin: 'http://127.0.0.1:1', assetRoot: directory })
  try {
    vi.mocked(createReadStream).mockImplementationOnce(() => {
      const stream = new PassThrough()
      queueMicrotask(() => stream.destroy(Object.assign(new Error('unreadable'), { code: 'EACCES' })))
      return stream as unknown as ReturnType<typeof createReadStream>
    })
    expect((await fetch(bridge.origin)).status).toBe(500)
    expect(await (await fetch(bridge.origin)).text()).toBe('working')
  } finally { await bridge.close(); await rm(directory, { recursive: true, force: true }) }
})

it('does not serve assets through a junction outside the asset root', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hb-asset-boundary-'))
  const assets = join(directory, 'ui')
  const outside = join(directory, 'private')
  await mkdir(assets)
  await mkdir(outside)
  await writeFile(join(assets, 'index.html'), 'application')
  await writeFile(join(outside, 'secret.json'), '{"private":true}')
  await symlink(outside, join(assets, 'linked'), 'junction')
  const bridge = await startDesktopBridge({ apiOrigin: 'http://127.0.0.1:1', assetRoot: assets })
  try {
    const response = await fetch(`${bridge.origin}/linked/secret.json`)
    expect(response.status).toBe(404)
    expect(await response.text()).not.toContain('private')
    expect(await (await fetch(`${bridge.origin}/cases/123`)).text()).toBe('application')
  } finally { await bridge.close(); await rm(directory, { recursive: true, force: true }) }
})

it('serves internal junctions and an asset root that is itself a junction', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hb-asset-junction-'))
  const assets = join(directory, 'ui')
  const root = join(directory, 'root')
  await mkdir(join(assets, 'resources'), { recursive: true })
  await writeFile(join(assets, 'resources', 'app.js'), 'application')
  await symlink(assets, root, 'junction')
  await symlink(join(assets, 'resources'), join(assets, 'linked'), 'junction')
  const bridge = await startDesktopBridge({ apiOrigin: 'http://127.0.0.1:1', assetRoot: root })
  try {
    expect(await (await fetch(`${bridge.origin}/linked/app.js`)).text()).toBe('application')
  } finally { await bridge.close(); await rm(directory, { recursive: true, force: true }) }
})

it('terminates truncated upstream responses without crashing the bridge', async () => {
  const upstream = createServer((_req, res) => {
    res.writeHead(200, { 'content-length': '100' })
    res.write('partial')
    setImmediate(() => res.destroy())
  })
  const port = await listen(upstream)
  const bridge = await startDesktopBridge({ apiOrigin: `http://127.0.0.1:${port}` })
  try {
    await expect(fetch(`${bridge.origin}/api/test`).then(response => response.text())).rejects.toThrow()
    expect((await fetch(bridge.origin)).status).toBe(404)
  } finally { await bridge.close(); await close(upstream) }
})

it('allows bounded OCR time while retaining the ordinary request timeout', async () => {
  expect(upstreamTimeoutFor('/api/v1/eksist/sources', 30_000)).toBe(120_000)
  expect(upstreamTimeoutFor('/api/v1/cases', 30_000)).toBe(30_000)
  const upstream = createServer((_req, res) => { setTimeout(() => res.end('done'), 80) })
  const port = await listen(upstream)
  const bridge = await startDesktopBridge({ apiOrigin: `http://127.0.0.1:${port}`, upstreamTimeoutMs: 20 })
  try {
    expect((await fetch(`${bridge.origin}/api/v1/cases`)).status).toBe(504)
    expect(await (await fetch(`${bridge.origin}/api/v1/eksist/sources`)).text()).toBe('done')
  } finally { await bridge.close(); await close(upstream) }
})

it.each([
  '/api/v1/legislation/questions',
  '/api/v1/cases/case-1/policy-ai-extractions/run-1/start',
  '/api/v1/cases/case-1/email-ai-suggestions',
])('waits for the bounded synchronous AI response at %s', async (path) => {
  // Legal generation has a 60-second provider budget; other AI calls can use 30 seconds.
  expect(upstreamTimeoutFor(path, 30_000)).toBe(75_000)
  expect(upstreamTimeoutFor(path, 100_000)).toBe(100_000)
  const upstream = createServer((_req, res) => { setTimeout(() => res.end('AI result'), 80) })
  const port = await listen(upstream)
  const bridge = await startDesktopBridge({ apiOrigin: `http://127.0.0.1:${port}`, upstreamTimeoutMs: 20 })
  try {
    const response = await fetch(`${bridge.origin}${path}`, { method: 'POST' })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('AI result')
  } finally { await bridge.close(); await close(upstream) }
})

it.each([
  '/api/v1/legislation/history',
  '/api/v1/legislation/questions/extra',
  '/api/v1/cases/case-1/policy-ai-extractions/run-1',
  '/api/v1/cases/case-1/email-ai-suggestions/plan',
])('retains the configured timeout for the ordinary route %s', (path) => {
  expect(upstreamTimeoutFor(path, 30_000)).toBe(30_000)
})
