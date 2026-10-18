import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createFieldEdge } from './field-portal-worker.mjs'

const origin = 'https://hasarbotu.pages.dev'
const upstream = 'https://desktop-efn2g33.tail276cda.ts.net'
const id = '11111111-1111-4111-8111-111111111111'
const request = (path, init = {}) => new Request(origin + path, init)

test('blocks private routes and spoofed tailnet identity before any upstream request', async () => {
  let calls = 0
  const edge = createFieldEdge(async () => { calls++; return new Response('unexpected') })
  for (const path of ['/api/v1/users', '/api/v1/cases', '/api/v1/desktop-updates/latest', '/api/v1/agents', '/api/v1/field-agent/uploads/claim', '/health', '/.env', '/index.html', '/assets/%2e%2e%2f.env']) {
    assert.equal((await edge(request(path, { headers: { 'tailscale-user-login': 'spoof@example.test', 'x-agent-secret': 'synthetic' } }))).status, 404)
  }
  assert.equal(calls, 0)
})

test('rejects previews, foreign origins and missing write origins without rewriting them', async () => {
  let calls = 0
  const edge = createFieldEdge(async () => { calls++; return new Response('{}') })
  assert.equal((await edge(new Request('https://preview.hasarbotu.pages.dev/saha'))).status, 421)
  for (const value of [undefined, 'https://evil.test', 'https://hasarbotu.pages.dev.evil.test', 'null']) {
    assert.equal((await edge(request('/api/v1/auth/login', { method: 'POST', headers: value ? { origin: value } : {}, body: '{}' }))).status, 403)
  }
  assert.equal(calls, 0)
})

test('forwards only public credentials and translates a validated origin to the public Funnel', async () => {
  const edge = createFieldEdge(async (url, options) => {
    assert.equal(url.href, upstream + '/api/v1/auth/login')
    assert.equal(options.headers.get('origin'), upstream)
    assert.equal(options.headers.get('cookie'), 'hb_session=synthetic')
    for (const name of ['tailscale-user-login', 'x-agent-secret', 'authorization', 'x-forwarded-host', 'cf-access-jwt-assertion']) assert.equal(options.headers.get(name), null)
    assert.equal(new TextDecoder().decode(options.body), '{"rememberMe":false}')
    assert.equal(options.redirect, 'manual')
    assert.equal(options.cache, 'no-store')
    return new Response('{}')
  })
  assert.equal((await edge(request('/api/v1/auth/login', {
    method: 'POST', body: '{"rememberMe":false}', headers: {
      origin, cookie: 'hb_session=synthetic', 'content-type': 'application/json',
      'tailscale-user-login': 'spoof@example.test', 'x-agent-secret': 'synthetic', authorization: 'Bearer synthetic',
      'x-forwarded-host': 'evil.test', 'cf-access-jwt-assertion': 'synthetic',
    },
  }))).status, 200)
})

test('preserves separate cookies, session consent and expiry without foreign cookie domains', async () => {
  const headers = new Headers({ 'content-type': 'application/json' })
  headers.append('set-cookie', 'hb_session=synthetic; HttpOnly; Path=/; SameSite=Strict; Domain=desktop-efn2g33.tail276cda.ts.net')
  headers.append('set-cookie', 'hb_google_flow=synthetic; HttpOnly; Path=/; SameSite=Strict; Max-Age=600; Secure')
  const response = await createFieldEdge(async () => new Response('{}', { headers }))(request('/api/v1/auth/session'))
  const cookies = response.headers.getSetCookie()
  assert.equal(cookies.length, 2)
  assert.match(cookies[0], /HttpOnly/)
  assert.match(cookies[0], /SameSite=Strict/)
  assert.match(cookies[0], /; Secure/)
  assert.doesNotMatch(cookies[0], /Domain=|Max-Age=/)
  assert.match(cookies[1], /Max-Age=600; Secure$/)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
})

test('enforces real streamed body limits even without Content-Length and preserves exact chunk bytes', async () => {
  let calls = 0
  const bytes = Uint8Array.from({ length: 262144 }, (_, index) => index % 251)
  const edge = createFieldEdge(async (_url, options) => {
    calls++
    assert.deepEqual(options.body, bytes)
    return new Response('{"offset":262144}')
  })
  for (const [path, size, method] of [['/api/v1/auth/login', 65537, 'POST'], [`/api/v1/field/uploads/${id}/chunk`, 262145, 'PUT']]) {
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(size)); controller.close() } })
    assert.equal((await edge(request(path, { method, headers: { origin }, body, duplex: 'half' }))).status, 413)
  }
  assert.equal(calls, 0)
  assert.equal((await edge(request(`/api/v1/field/uploads/${id}/chunk`, { method: 'PUT', headers: { origin }, body: bytes }))).status, 200)
  assert.equal(calls, 1)
})

test('streams photo downloads unchanged and keeps browser protections on errors and assets', async () => {
  const bytes = Uint8Array.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 255, 217])
  const edge = createFieldEdge(async () => new Response(bytes, { headers: { 'content-type': 'image/jpeg', 'content-disposition': 'attachment; filename="HASAR 101.jpg"' } }))
  const response = await edge(request(`/api/v1/field/uploads/${id}/jpeg`))
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes)
  assert.equal(response.headers.get('content-disposition'), 'attachment; filename="HASAR 101.jpg"')
  for (const path of ['/saha', '/assets/field-123.js', '/brand/logo-mark.svg', '/unknown']) {
    const output = await edge(request(path))
    assert.match(output.headers.get('content-security-policy'), /frame-ancestors 'none'/)
    assert.equal(output.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(output.headers.get('cache-control'), 'private, no-store')
  }
})

test('keeps Google flow and callback query intact and never follows upstream redirects', async () => {
  const edge = createFieldEdge(async (url) => {
    assert.equal(url.href, upstream + '/api/v1/google/callback?code=synthetic&state=synthetic')
    return new Response('<p>Complete</p>', { headers: { 'content-type': 'text/html' } })
  })
  assert.equal((await edge(request('/api/v1/google/callback?code=synthetic&state=synthetic'))).status, 200)
  const redirected = await createFieldEdge(async () => Response.redirect('https://evil.test/'))(request('/saha'))
  assert.equal(redirected.status, 502)
  assert.equal(redirected.headers.get('location'), null)
})

test('returns a deliberate unavailable error when the office cannot be reached', async () => {
  const response = await createFieldEdge(async () => { throw new TypeError('synthetic connection failure') })(request('/saha'))
  assert.equal(response.status, 502)
  assert.deepEqual(await response.json(), { code: 'office_unavailable' })
})

test('the alternate Workers address requires its own exact Origin and uses the same restricted proxy', async () => {
  const workerOrigin = 'https://hasarbotu.profaruk1.workers.dev'
  let calls = 0
  const edge = createFieldEdge(async (_url, options) => { calls++; assert.equal(options.headers.get('origin'), upstream); return new Response('{}') })
  assert.equal((await edge(new Request(workerOrigin + '/api/v1/auth/login', { method: 'POST', headers: { origin }, body: '{}' }))).status, 403)
  assert.equal(calls, 0)
  assert.equal((await edge(new Request(workerOrigin + '/api/v1/auth/login', { method: 'POST', headers: { origin: workerOrigin }, body: '{}' }))).status, 200)
  assert.equal(calls, 1)
  assert.equal((await edge(new Request(workerOrigin + '/api/v1/users'))).status, 404)
})
