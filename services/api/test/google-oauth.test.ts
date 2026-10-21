import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import pg from 'pg'
import { assertTestDatabaseUrl, runMigrations, uuidv7 } from '@hasarbotu/database'
import { buildApp, hashPassword } from '../src/index.js'
import { createGoogleProvider, decryptToken, digest, GMAIL_SCOPE, validateGoogleClaims, type GoogleConfig } from '../src/tracking/google.js'

describe.skipIf(!process.env.TEST_DATABASE_URL)('Google browser-bound OAuth and clean results', () => {
  let pool: pg.Pool, app: FastifyInstance, org: string, operator: string, cookie: string
  let email = 'oauth@office.example', subject = 'synthetic-subject', scope = GMAIL_SCOPE, wrongNonce = false
  const logs: string[] = []
  const config: GoogleConfig = { clientId: 'synthetic-client', clientSecret: 'synthetic-secret', redirectUri: 'https://office.example/api/v1/google/callback', encryptionKey: 'a'.repeat(64), loginDomain: 'office.example', sbmSenders: ['sbm@sbm.org.tr'], automaticSbmEnabled: false }
  const exchange = vi.fn(async (code: string, verifier: string) => {
    if (code === 'provider-error') throw new Error('sensitive-provider-response-not-for-logs')
    if (!verifier) throw new Error('Missing verifier')
    return { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', id_token: 'synthetic-id', scope }
  })
  const start = (purpose = 'login', client = 'web', authCookie = '') => app.inject({ method: 'POST', url: '/api/v1/google/start', headers: { cookie: authCookie }, payload: { purpose, client }, remoteAddress: `127.1.${Math.floor(requests / 250)}.${++requests % 250 + 1}` })
  let requests = 0
  const callback = (flowId: string, code = 'synthetic-code', error?: string) => app.inject({ url: `/api/v1/google/callback?state=${flowId}&${error ? `error=${error}` : `code=${code}`}` })
  const complete = (flowId: string, browser: string, authCookie = '', rememberMe = false) => app.inject({ method: 'POST', url: '/api/v1/google/complete', headers: { cookie: [browser, authCookie].filter(Boolean).join('; ') }, payload: { flowId, rememberMe } })
  const browserCookie = (response: { headers: Record<string, unknown> }) => String(response.headers['set-cookie']).split(';')[0]!
  beforeAll(async () => {
    const db = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL!)
    pool = new pg.Pool({ connectionString: db.url })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: db.url, quiet: true })
    org = uuidv7(); operator = uuidv7(); config.signupOrganizationId = org
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,'oauth','Synthetic OAuth')", [org])
    await pool.query('INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,$3,$4,$5)', [operator, org, email, 'Synthetic Operator', await hashPassword('synthetic-password-42')])
    await pool.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code='admin'", [operator])
    app = buildApp({ logLevel: 'trace', loggerStream: { write: text => logs.push(text) }, auth: { pool, cookieSecure: false }, google: config,
      googleProvider: { ...createGoogleProvider(config), exchange,
        identity: async (_jwt, nonce, corporate) => validateGoogleClaims({ iss: 'https://accounts.google.com', aud: config.clientId, exp: Date.now() / 1000 + 600, iat: Date.now() / 1000, nonce: wrongNonce ? 'wrong' : nonce, email_verified: true, email, sub: subject, hd: 'office.example' }, config.clientId, nonce, corporate ? config.loginDomain : undefined),
        gmail: async () => ({ emailAddress: email }) } })
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'synthetic-password-42' } })
    expect(login.statusCode).toBe(200)
    cookie = browserCookie(login)
  }, 60_000)
  afterAll(async () => { await app?.close(); await pool?.end() })

  it.each(['web', 'field', 'desktop'])('redirects %s login to a parameter-free result and issues a session only to the initiating browser', async client => {
    const response = await start('login', client), { flowId, url } = response.json()
    const browser = browserCookie(response), authorize = new URL(url)
    expect(String(response.headers['set-cookie'])).toContain('HttpOnly; SameSite=Strict')
    expect(authorize.searchParams.get('state')).toBe(flowId)
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
    const row = (await pool.query('SELECT * FROM google_oauth_states WHERE state_hash=$1', [digest(flowId)])).rows[0]
    expect(authorize.searchParams.get('nonce')).toBe(row.nonce)
    expect(authorize.searchParams.get('code_challenge')).toBe(Buffer.from(digest(row.verifier), 'hex').toString('base64url'))
    expect((await complete(flowId, browser)).json()).toEqual({ status: 'pending' })
    const result = await callback(flowId)
    expect(result.statusCode).toBe(303)
    expect(result.headers.location).toBe(`/api/v1/google/result/${client}/login/success`)
    expect(result.headers['set-cookie']).toBeUndefined()
    expect((await complete(flowId, '')).statusCode).toBe(400)
    expect((await complete(flowId, 'hb_google_flow=unrelated-browser')).statusCode).toBe(400)
    const login = await complete(flowId, browser)
    expect(login.json()).toEqual({ status: 'complete' })
    expect(String(login.headers['set-cookie'])).not.toContain('Max-Age=')
    const session = await app.inject({ url: '/api/v1/auth/session', headers: { cookie: browserCookie(login) } })
    expect(session.json().user).toMatchObject({ id: operator, roles: ['admin'] })
    expect((await complete(flowId, browser)).json().status).toBe('expired')
  })
  it.each(['success', 'pending', 'approval', 'denied', 'expired', 'failed'])('serves the branded accessible %s page with a nonce CSP and no authorization data', async outcome => {
    const result = await app.inject({ url: `/api/v1/google/result/desktop/mail/${outcome}` })
    expect(result.statusCode).toBe(200)
    expect(result.headers['cache-control']).toBe('no-store')
    expect(result.headers['referrer-policy']).toBe('no-referrer')
    expect(result.headers['content-security-policy']).toMatch(/default-src 'none'; script-src 'nonce-/)
    expect(result.body).toContain('<html lang="tr">')
    expect(result.body).toContain('prefers-reduced-motion:reduce')
    expect(result.body).toContain('aria-labelledby="result-title"')
    expect(result.body).toContain('hasarbotu://oauth/return')
    expect(result.body.includes('window.close()')).toBe(outcome === 'success')
    expect(result.headers['set-cookie']).toBeUndefined()
    for (const secret of ['synthetic-access', 'synthetic-refresh', 'synthetic-id', 'state=', 'flowId', 'code=']) expect(result.body).not.toContain(secret)
    expect((await app.inject({ url: `/api/v1/google/result/desktop/mail/${outcome}?code=private&state=private` })).headers.location).toBe(`/api/v1/google/result/desktop/mail/${outcome}`)
  })
  it('does not authorize direct result visits and rejects invalid presentation parameters', async () => {
    expect((await app.inject({ url: '/api/v1/google/result/web/login/success' })).body).toContain('href="/"')
    expect((await app.inject({ url: '/api/v1/google/result/field/login/failed' })).body).toContain('href="/saha"')
    expect((await app.inject({ url: '/api/v1/auth/session' })).statusCode).toBe(401)
    expect((await app.inject({ url: '/api/v1/google/result/evil/login/success' })).statusCode).toBe(404)
    expect((await start('login', 'https://evil.example')).statusCode).toBe(400)
  })
  it('handles cancellation separately, never exchanges a code and preserves the existing session', async () => {
    const response = await start('login', 'desktop'), flow = response.json().flowId, count = exchange.mock.calls.length
    expect((await callback(flow, '', 'access_denied')).headers.location).toBe('/api/v1/google/result/desktop/login/denied')
    expect(exchange).toHaveBeenCalledTimes(count)
    expect((await complete(flow, browserCookie(response))).json()).toEqual({ status: 'denied' })
    expect((await app.inject({ url: '/api/v1/auth/session', headers: { cookie } })).statusCode).toBe(200)
  })
  it('keeps provider errors and invalid identity nonces out of results and logs', async () => {
    for (const badNonce of [false, true]) {
      const response = await start(), flow = response.json().flowId
      wrongNonce = badNonce
      const result = await callback(flow, badNonce ? 'synthetic-code' : 'provider-error')
      wrongNonce = false
      expect(result.headers.location).toBe('/api/v1/google/result/web/login/failed')
      expect((await complete(flow, browserCookie(response))).json()).toEqual({ status: 'failed' })
      expect((await pool.query('SELECT verifier FROM google_oauth_states WHERE state_hash=$1', [digest(flow)])).rows[0].verifier).toBe('')
      expect(logs.join('')).not.toContain(flow)
    }
    for (const privateValue of ['synthetic-code', 'provider-error', 'synthetic-access', 'sensitive-provider-response-not-for-logs']) expect(logs.join('')).not.toContain(privateValue)
  })
  it('handles malformed, unknown, expired and replayed callbacks without a session or code reuse', async () => {
    expect((await app.inject({ url: '/api/v1/google/callback?code=private' })).headers.location).toBe('/api/v1/google/result/web/login/failed')
    expect((await callback('unknown-state-that-is-not-valid')).headers.location).toBe('/api/v1/google/result/web/login/expired')
    const response = await start('login', 'field'), flow = response.json().flowId
    await pool.query("UPDATE google_oauth_states SET expires_at=now()-interval '1 second' WHERE state_hash=$1", [digest(flow)])
    expect((await callback(flow)).headers.location).toBe('/api/v1/google/result/field/login/expired')
    const second = await start('login', 'desktop'), secondFlow = second.json().flowId
    const results = await Promise.all([callback(secondFlow), callback(secondFlow)])
    expect(results.map(r => r.headers.location).sort()).toEqual(['/api/v1/google/result/desktop/login/expired', '/api/v1/google/result/desktop/login/success'])
  })
  it('registers pending employees with an approval page and no application session', async () => {
    email = 'pending@office.example'; subject = 'synthetic-pending'
    const response = await start(), flow = response.json().flowId
    expect((await callback(flow)).headers.location).toBe('/api/v1/google/result/web/login/approval')
    const result = await complete(flow, browserCookie(response))
    expect(result.json()).toEqual({ status: 'approval_required' })
    expect(result.headers['set-cookie']).toBeUndefined()
    email = 'oauth@office.example'; subject = 'synthetic-subject'
  })
  it('denies disabled employees without granting a session', async () => {
    const response = await start(), flow = response.json().flowId
    await pool.query("UPDATE users SET status='disabled' WHERE id=$1", [operator])
    expect((await callback(flow)).headers.location).toBe('/api/v1/google/result/web/login/denied')
    expect((await complete(flow, browserCookie(response))).json().status).toBe('denied')
    await pool.query("UPDATE users SET status='active' WHERE id=$1", [operator])
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'synthetic-password-42' } })
    expect(login.statusCode).toBe(200)
    cookie = browserCookie(login)
  })
  it('connects Gmail in the office scope, encrypts refresh tokens and keeps the operator session', async () => {
    expect((await start('mail')).statusCode).toBe(401)
    const response = await start('mail', 'desktop', cookie), flow = response.json().flowId
    expect(response.statusCode).toBe(200)
    expect((await callback(flow)).headers.location).toBe('/api/v1/google/result/desktop/mail/success')
    expect((await complete(flow, browserCookie(response))).statusCode).toBe(401)
    const result = await complete(flow, browserCookie(response), cookie)
    expect(result.json()).toEqual({ status: 'complete' })
    expect(result.headers['set-cookie']).toBeUndefined()
    const connection = (await pool.query('SELECT * FROM mail_connections')).rows[0]
    expect(connection.organization_id).toBe(org)
    expect(connection.connected_by).toBe(operator)
    expect(decryptToken(connection.encrypted_refresh_token, config.encryptionKey, `${org}:${subject}`)).toBe('synthetic-refresh')
    expect((await app.inject({ url: '/api/v1/auth/session', headers: { cookie } })).json().user.id).toBe(operator)
  })
  it('rechecks mail permissions at callback and completion and requires offline Gmail consent', async () => {
    const first = await start('mail', 'web', cookie), flow = first.json().flowId
    scope = 'openid email'
    expect((await callback(flow)).headers.location).toBe('/api/v1/google/result/web/mail/failed')
    scope = GMAIL_SCOPE
    const second = await start('mail', 'web', cookie), secondFlow = second.json().flowId
    await callback(secondFlow)
    await pool.query('DELETE FROM user_roles WHERE user_id=$1', [operator])
    expect((await complete(secondFlow, browserCookie(second), cookie)).statusCode).toBe(403)
    const third = await start('login'), thirdFlow = third.json().flowId
    await pool.query("UPDATE google_oauth_states SET purpose='mail',user_id=$2 WHERE state_hash=$1", [digest(thirdFlow), operator])
    expect((await callback(thirdFlow)).headers.location).toBe('/api/v1/google/result/web/mail/denied')
    await pool.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code='admin'", [operator])
  })
})
