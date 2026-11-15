import assert from 'node:assert/strict'
import { test } from 'node:test'
import worker, { createDesktopEdge } from './desktop-api-worker.mjs'

const origin = 'https://desktop.example.workers.dev'
const request = (path, init) => new Request(origin + path, init)
const service = fetch => ({ fetch })

test('requires a provisioned VPC binding without falling back to a public origin', async () => {
  const response = await worker.fetch(request('/health'), { PUBLIC_ORIGIN: origin })
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { code: 'office_not_configured' })
})

test('only proxies the exact configured hostname, API routes and credential-free health', async () => {
  let calls = 0
  const edge = createDesktopEdge(service(async () => { calls++; return new Response('{}') }), origin)
  for (const path of ['/', '/saha', '/.env', '/assets/app.js', '/api/v10/cases', '/api/v1/agent/jobs/claim', '/api/v1/agent', '/api/v1/field-agent/uploads/claim', '/api/v1/agent%2fjobs/claim', '/api/v1/%61gent/jobs/claim', '/api/v1/%66ield-agent/uploads/claim', '/api/v1/%invalid']) {
    assert.equal((await edge(request(path))).status, 404, path)
  }
  assert.equal((await edge(new Request('https://preview.example.workers.dev/health'))).status, 421)
  assert.equal((await edge(request('/api/v1/cases', { method: 'OPTIONS' }))).status, 405)
  assert.equal(calls, 0)
  assert.equal((await edge(request('/health'))).status, 200)
  assert.equal((await edge(request('/api/v1/desktop-updates/latest'))).status, 200)
  assert.equal(calls, 2)
})

test('rejects browser writes from foreign origins while accepting the desktop loopback origin', async () => {
  let calls = 0
  const edge = createDesktopEdge(service(async () => { calls++; return new Response('{}') }), origin)
  for (const value of ['https://evil.test', 'null', 'http://127.0.0.1.evil.test:43123', 'http://localhost@evil.test']) {
    assert.equal((await edge(request('/api/v1/auth/login', { method: 'POST', headers: { origin: value }, body: '{}' }))).status, 403)
  }
  assert.equal((await edge(request('/api/v1/auth/logout', { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } }))).status, 403)
  assert.equal(calls, 0)
  assert.equal((await edge(request('/api/v1/auth/login', { method: 'POST', headers: { origin: 'http://127.0.0.1:43123' }, body: '{}' }))).status, 200)
  assert.equal((await edge(request('/api/v1/auth/logout', { method: 'POST' }))).status, 200)
})

test('preserves sessions, idempotency, compatibility headers and body without forwarding spoofed identities', async () => {
  const edge = createDesktopEdge(service(async incoming => {
    assert.equal(incoming.url, 'http://hasarbotu-api.internal/api/v1/cases?cursor=next%2Bpage')
    assert.equal(incoming.headers.get('cookie'), 'hb_session=synthetic')
    assert.equal(incoming.headers.get('idempotency-key'), 'synthetic-operation')
    assert.equal(incoming.headers.get('x-hasarbotu-dashboard-stages'), '7')
    assert.equal(incoming.headers.get('x-hasarbotu-notice-sheet-fields'), '1')
    for (const name of ['x-agent-secret', 'x-agent-id', 'tailscale-user-login', 'authorization', 'x-forwarded-for', 'x-forwarded-host', 'cf-access-jwt-assertion']) assert.equal(incoming.headers.get(name), null, name)
    assert.equal(await incoming.text(), '{"plate":"ANON"}')
    assert.equal(incoming.redirect, 'manual')
    return new Response('{}', { status: 201 })
  }), origin)
  const response = await edge(request('/api/v1/cases?cursor=next%2Bpage', { method: 'POST', body: '{"plate":"ANON"}', headers: {
    cookie: 'hb_session=synthetic', 'idempotency-key': 'synthetic-operation', 'x-hasarbotu-dashboard-stages': '7', 'x-hasarbotu-notice-sheet-fields': '1',
    'x-agent-secret': 'must-not-forward', 'x-agent-id': 'spoof', 'tailscale-user-login': 'spoof', authorization: 'Bearer spoof',
    'x-forwarded-for': '192.0.2.1', 'x-forwarded-host': 'evil.test', 'cf-access-jwt-assertion': 'spoof',
  } }))
  assert.equal(response.status, 201)
})

test('only uses the Cloudflare visitor address supplied by the deployed runtime for proxy-aware limits', async () => {
  let ip
  const edge = createDesktopEdge(service(async incoming => { ip = incoming.headers.get('x-forwarded-for'); return new Response('{}') }), origin)
  const incoming = request('/api/v1/auth/session', { headers: { 'cf-connecting-ip': '192.0.2.10', 'x-forwarded-for': '192.0.2.99' } })
  Object.defineProperty(incoming, 'cf', { value: { colo: 'TEST' } })
  await edge(incoming)
  assert.equal(ip, '192.0.2.10')
})

test('streams authenticated artifact bytes and preserves session cookie consent and API errors', async () => {
  const bytes = Uint8Array.of(77, 90, 0, 1, 255)
  const headers = new Headers({ 'content-type': 'application/octet-stream', 'content-length': String(bytes.length), 'content-disposition': 'attachment; filename="installer.exe"', vary: 'x-hasarbotu-dashboard-stages' })
  headers.append('set-cookie', 'hb_session=synthetic; HttpOnly; SameSite=Strict; Path=/')
  headers.append('set-cookie', 'hb_google_flow=synthetic; HttpOnly; SameSite=Strict; Path=/; Max-Age=600')
  const edge = createDesktopEdge(service(async () => new Response(bytes, { headers })), origin)
  const output = await edge(request('/api/v1/desktop-updates/artifacts/synthetic'))
  assert.deepEqual(new Uint8Array(await output.arrayBuffer()), bytes)
  assert.deepEqual(output.headers.getSetCookie(), headers.getSetCookie())
  assert.equal(output.headers.get('content-length'), String(bytes.length))
  assert.equal(output.headers.get('vary'), 'x-hasarbotu-dashboard-stages')
  assert.equal(output.headers.get('cache-control'), 'private, no-store')
  const denied = await createDesktopEdge(service(async () => new Response('{"error":"unauthorized"}', { status: 401 })), origin)(request('/api/v1/cases'))
  assert.equal(denied.status, 401)
  assert.deepEqual(await denied.json(), { error: 'unauthorized' })
  assert.equal(denied.headers.get('access-control-allow-origin'), null)
})

test('enforces actual request body limits before forwarding regardless of declared length', async () => {
  let calls = 0
  const edge = createDesktopEdge(service(async () => { calls++; return new Response('{}') }), origin)
  assert.equal((await edge(request('/api/v1/cases', { method: 'POST', headers: { 'content-length': '16777217' } }))).status, 413)
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(16777217)); controller.close() } })
  assert.equal((await edge(request('/api/v1/cases', { method: 'POST', body, duplex: 'half' }))).status, 413)
  assert.equal(calls, 0)
})

test('rejects unexpected redirects and returns a deliberate tunnel failure without leaking its details', async () => {
  const redirect = await createDesktopEdge(service(async () => Response.redirect('https://evil.test')), origin)(request('/api/v1/cases'))
  assert.equal(redirect.status, 502)
  assert.equal(redirect.headers.get('location'), null)
  const failed = await createDesktopEdge(service(async () => { throw Error('private infrastructure detail') }), origin)(request('/health'))
  assert.equal(failed.status, 502)
  assert.deepEqual(await failed.json(), { code: 'office_unavailable' })
})

test('retains only the existing local OAuth result redirect contract', async () => {
  const path = '/api/v1/google/result/desktop/login/success'
  const response = await createDesktopEdge(service(async () => new Response(null, { status: 303, headers: { location: path, 'referrer-policy': 'no-referrer' } })), origin)(request('/api/v1/google/callback?code=synthetic&state=synthetic'))
  assert.equal(response.status, 303)
  assert.equal(response.headers.get('location'), path)
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
})

test('preserves native desktop OAuth callbacks and rejects foreign or credential-bearing redirects', async () => {
  const callback = '/api/v1/google/desktop/callback?code=synthetic&state=synthetic'
  for (const path of ['/api/v1/google/result/desktop/login/success', '/api/v1/google/result/desktop/login/denied', '/api/v1/google/result/web/login/expired']) {
    const response = await createDesktopEdge(service(async () => new Response(null, { status: 303, headers: { location: path, 'referrer-policy': 'no-referrer' } })), origin)(request(callback))
    assert.equal(response.status, 303)
    assert.equal(response.headers.get('location'), path)
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
  }
  for (const location of ['https://evil.test/api/v1/google/result/desktop/login/success', '/api/v1/google/result/desktop/login/success?code=private', '/api/v1/users']) {
    const response = await createDesktopEdge(service(async () => new Response(null, { status: 303, headers: { location } })), origin)(request(callback))
    assert.equal(response.status, 502)
    assert.equal(response.headers.get('location'), null)
  }
})
