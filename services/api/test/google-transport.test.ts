import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import { createGoogleProvider } from '../src/tracking/google.js'

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
  const provider = createGoogleProvider({ clientId: 'synthetic-client', clientSecret: 'synthetic-secret',
    redirectUri: 'https://example.test/callback', encryptionKey: 'ab'.repeat(32), sbmSenders: [], automaticSbmEnabled: false },
  (_input, init) => fetch(origin, init))
  await expect(provider.exchange('synthetic-code', 'synthetic-verifier')).rejects.toThrow()
  await expect(provider.refresh('synthetic-refresh-token')).rejects.toThrow()
  expect(received).not.toHaveBeenCalled()
})
