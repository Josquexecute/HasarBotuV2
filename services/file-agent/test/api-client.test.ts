import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import { createAgentApiClient } from '../src/api-client.js'
import { createTrackingClient } from '../src/document-tracker.js'

const servers: Server[] = []
async function listen(server: Server): Promise<string> {
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

it('never follows redirects carrying agent credentials to another origin', async () => {
  const received = vi.fn()
  const target = await listen(createServer((request, response) => {
    received(request.headers['x-agent-secret'])
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ job: null, locations: [], nextCursor: null }))
  }))
  const origin = await listen(createServer((_request, response) => {
    response.writeHead(307, { location: `${target}/capture` })
    response.end()
  }))
  const client = createAgentApiClient({ baseUrl: origin, agentId: 'synthetic-agent', secret: 'synthetic-secret' })
  const tracking = createTrackingClient({ apiBaseUrl: origin, agentId: 'synthetic-agent', agentSecret: 'synthetic-secret', roots: {}, leaseSeconds: 120, pollIntervalMs: 5000, freshnessGate: undefined })
  for (const request of [
    () => client.claim(),
    () => client.heartbeat('synthetic-job'),
    () => client.reportResult('synthetic-job', { outcome: 'failed', errorCode: 'synthetic_error' }),
    () => tracking.locations(),
    () => tracking.reconcile!({ caseId: 'synthetic-case', locationVersion: 1, scanStartedAt: new Date().toISOString(), paths: [] }),
  ]) await expect(request()).rejects.toThrow()
  expect(received).not.toHaveBeenCalled()
})

it('bounds a stalled claim request and reports a safe transport error', async () => {
  const origin = await listen(createServer((_request, response) => {
    setTimeout(() => response.end('{"job":null}'), 100)
  }))
  const client = createAgentApiClient({ baseUrl: origin, agentId: 'synthetic-agent', secret: 'synthetic-secret', requestTimeoutMs: 10 })
  await expect(client.claim()).rejects.toMatchObject({ status: 0, message: 'API request failed' })
})
