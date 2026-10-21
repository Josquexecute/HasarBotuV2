import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import { createGoogleProvider, GoogleProviderError } from '../src/tracking/google.js'

const config = { clientId: 'synthetic-client', clientSecret: 'synthetic-secret',
  redirectUri: 'https://example.test/callback', encryptionKey: 'ab'.repeat(32), sbmSenders: [], automaticSbmEnabled: false, loginDomain: 'office.example' }

const servers: Server[] = []
async function listen(server: Server) {
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`
}
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})

it('does not forward OAuth client credentials and authorization codes through redirects', async () => {
  const received = vi.fn()
  const target = await listen(createServer((request, response) => {
    received(request.url)
    response.setHeader('content-type', 'application/json')
    response.end('{"access_token":"synthetic-token"}')
  }))
  const origin = await listen(createServer((_request, response) => {
    response.writeHead(307, { location: `${target}/capture` })
    response.end()
  }))
  const provider = createGoogleProvider(config,
  (_input, init) => fetch(origin, init))
  await expect(provider.exchange('synthetic-code', 'synthetic-verifier')).rejects.toThrow()
  await expect(provider.refresh('synthetic-refresh-token')).rejects.toThrow()
  expect(received).not.toHaveBeenCalled()
})

it.each([
  { status: 401, body: '<html>synthetic-private-upstream-body</html>', kind: 'permission_required' },
  { status: 401, body: 'null', kind: 'permission_required' },
  { status: 400, body: '{"error":"invalid_grant"}', kind: 'permission_required' },
  { status: 403, body: '{"error":{"status":"PERMISSION_DENIED"}}', kind: 'permission_required' },
  { status: 403, body: '{"error":null}', kind: 'temporary' },
  { status: 429, body: '<html>synthetic-private-upstream-body</html>', kind: 'temporary' },
  { status: 503, body: '', kind: 'temporary' },
])('classifies Google $status $body safely without retrying', async ({ status, body, kind }) => {
  const fetcher = vi.fn(async () => new Response(body, { status }))
  const provider = createGoogleProvider(config, fetcher)
  const error: unknown = await provider.refresh('synthetic-refresh-token').catch(value => value)
  expect(error).toBeInstanceOf(GoogleProviderError)
  expect(error).toMatchObject({ kind, status })
  expect(String(error)).not.toContain('synthetic-private-upstream-body')
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('rejects malformed successful Google token responses', async () => {
  for (const body of ['not-json', 'null', '{"access_token":null}']) {
    const provider = createGoogleProvider(config, async () => new Response(body))
    await expect(provider.refresh('synthetic-refresh-token')).rejects.toThrow()
  }
})
