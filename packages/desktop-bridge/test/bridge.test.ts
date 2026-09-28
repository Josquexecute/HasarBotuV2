import { createServer, type Server } from 'node:http'
import { createServer as createHttpsServer, globalAgent } from 'node:https'
import { createReadStream } from 'node:fs'
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { PassThrough } from 'node:stream'
import { expect, it, vi } from 'vitest'
import { startDesktopBridge, upstreamTimeoutFor } from '../src/bridge.js'

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

it('proxies trusted HTTPS and rejects an untrusted certificate', async () => {
  const cert = await readFile(new URL('./fixtures/localhost.crt', import.meta.url))
  const key = await readFile(new URL('./fixtures/localhost.key', import.meta.url))
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
