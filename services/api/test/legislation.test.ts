import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type pg from 'pg'
import type { FastifyInstance } from 'fastify'
import { assertTestDatabaseUrl, createDatabasePool, closeDatabasePool, runMigrations, uuidv7 } from '@hasarbotu/database'
import { buildApp, hashPassword } from '../src/index.js'
import { decryptToken } from '../src/tracking/google.js'
import type { LegalProvider } from '../src/legislation/provider.js'

describe.skipIf(!process.env.TEST_DATABASE_URL)('legislation live database routes', () => {
  let pool: pg.Pool, app: FastifyInstance, failCitation = false
  const users: { id: string; org: string; cookie: string }[] = [], encryptionKey = 'e'.repeat(64)
  const root = '/api/v1/legislation', key = 'AQ.synthetic-test-only.' + 'do-not-use_'.repeat(40), claim = uuidv7()
  const provider: LegalProvider = async (_input, evidence) => ({ statements: [{ text: 'Kaynak hükmü incelenmelidir.', citations: [{ id: failCitation ? 'made-up' : evidence[0]!.id, quote: evidence[0]!.excerpt.slice(0, 100) }] }], missingInformation: [] })
  beforeAll(async () => {
    const config = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL!)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    app = buildApp({ auth: { pool, cookieSecure: false, loginRateLimit: { limit: 50, windowMs: 60_000 } }, loggerEnabled: false, legislationProvider: provider,
      google: { clientId: 'synthetic', clientSecret: 'synthetic', redirectUri: 'http://localhost/api/v1/google/callback', encryptionKey, sbmSenders: [], automaticSbmEnabled: false } })
    const password = 'Legal-Synthetic-Only-42!', passwordHash = await hashPassword(password), org = uuidv7()
    for (let index = 0; index < 3; index++) {
      const organizationId = index < 2 ? org : uuidv7(), id = uuidv7(), email = `legal-${index}@example.test`
      if (index !== 1) await pool.query('INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)', [organizationId, `legal-${index}`, 'Synthetic'])
      await pool.query('INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,$3,$4,$5)', [id, organizationId, email, 'Synthetic', passwordHash])
      await pool.query('INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code=$2', [id, index === 1 ? 'read_only' : 'admin'])
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } })
      expect(login.statusCode).toBe(200)
      users.push({ id, org: organizationId, cookie: String(login.headers['set-cookie']).split(';')[0]! })
    }
    await pool.query(`INSERT INTO cases(id,organization_id,office_year,office_sequence,office_number,case_type,plate,plate_normalized,workflow_stage)
      VALUES($1,$2,2026,1,'2026/1',NULL,'34 TEST 12','34TEST12','new_notification')`, [claim, org])
  }, 60_000)
  afterAll(async () => { if (app) await app.close();if (pool) await closeDatabasePool(pool) })
  const req = (user: number, method: 'GET' | 'PUT' | 'POST', path: string, payload?: object) => app.inject({ method, url: root + path, headers: { cookie: users[user]!.cookie }, ...(payload ? { payload } : {}) })
  const question = { question: 'kasko sigortası teminat dışında kalan haller', mode: 'sources', eventDate: null, sourceIds: ['casco-conditions'], caseId: claim }
  it('requires authentication and serves actual PDF/annex sources without AI configuration', async () => {
    expect((await app.inject({ method: 'GET', url: root + '/library' })).statusCode).toBe(401)
    const library = await req(1, 'GET', '/library')
    expect(library.statusCode).toBe(200)
    expect(library.json()).toMatchObject({ aiEnabled: false })
    expect(library.json().sources).toHaveLength(7)
    const page = await req(1, 'GET', '/sources/traffic-conditions?page=1')
    expect(page.json().text).toContain('12/6/2026')
    expect((await req(1, 'GET', '/sources/traffic-annexes?page=1')).json().source.format).toBe('docx_archive')
    expect((await req(1, 'GET', '/sources/ktk?page=0')).statusCode).toBe(400)
    expect((await req(1, 'GET', '/sources/unknown')).statusCode).toBe(404)
  })
  it('allows read-only source research, warns about pending type and isolates personal history', async () => {
    const result = await req(1, 'POST', '/questions', question)
    expect(result.statusCode).toBe(200)
    expect(result.json().citations.length).toBeGreaterThan(0)
    expect(result.json().missingInformation).toContain('Dosyanın Trafik/Kasko türü henüz seçilmedi.')
    expect((await req(1, 'GET', '/history')).json().items).toHaveLength(1)
    expect((await req(0, 'GET', '/history')).json().items).toEqual([])
    expect((await req(2, 'POST', '/questions', question)).statusCode).toBe(404)
    expect((await req(1, 'POST', '/questions', { ...question, sourceIds: ['not-a-source'] })).statusCode).toBe(400)
    expect((await req(1, 'POST', '/questions', { ...question, mode: 'ai' })).statusCode).toBe(503)
  })
  it('serializes admin first writes, encrypts the key with tenant context and never returns it', async () => {
    const input = { expectedOrganizationId: users[0]!.org, expectedVersion: 0, apiKey: key, model: 'gemini-3.8-flash', enabled: true }
    expect((await req(1, 'PUT', '/ai-settings', input)).statusCode).toBe(403)
    expect((await req(2, 'PUT', '/ai-settings', input)).statusCode).toBe(409)
    const results = await Promise.all([req(0, 'PUT', '/ai-settings', input), req(0, 'PUT', '/ai-settings', input)])
    expect(results.map(r => r.statusCode).sort()).toEqual([200, 409])
    expect(results.map(r => r.body).join('')).not.toContain(key)
    const row = (await pool.query('SELECT * FROM legislation_ai_settings')).rows[0]
    expect(row.encrypted_api_key).not.toContain(key)
    expect(decryptToken(row.encrypted_api_key, encryptionKey, `legislation:${users[0]!.org}:api-key`)).toBe(key)
    expect(() => decryptToken(row.encrypted_api_key, encryptionKey, `legislation:${users[2]!.org}:api-key`)).toThrow()
    expect((await req(2, 'GET', '/ai-settings')).json().configured).toBe(false)
    expect(JSON.stringify((await pool.query("SELECT details FROM audit_events WHERE action='legislation.ai_settings_updated'")).rows)).not.toContain(key)
  })
  it('validates even injected provider citations and never stores or audits rejected answers', async () => {
    const before = (await pool.query('SELECT count(*)::int n FROM legislation_answers')).rows[0].n
    failCitation = true
    expect((await req(0, 'POST', '/questions', { ...question, mode: 'ai' })).statusCode).toBe(502)
    failCitation = false
    expect((await pool.query('SELECT count(*)::int n FROM legislation_answers')).rows[0].n).toBe(before)
    const result = await req(0, 'POST', '/questions', { ...question, mode: 'ai' })
    expect(result.statusCode).toBe(200)
    expect(result.json().citations).toHaveLength(1)
    expect(result.json().requiresReview).toBe(true)
    expect((await req(0, 'GET', '/history')).json().items[0]).toEqual(result.json())
    expect((await pool.query('SELECT case_type FROM cases WHERE id=$1', [claim])).rows[0].case_type).toBeNull()
  })
  it('keeps key on disable and rolls back history when audit fails', async () => {
    expect((await req(0, 'PUT', '/ai-settings', { expectedOrganizationId: users[0]!.org, expectedVersion: 1, model: 'gemini-3.8-flash', enabled: false })).statusCode).toBe(200)
    expect((await req(1, 'GET', '/library')).json().aiEnabled).toBe(false)
    const count = (await pool.query('SELECT count(*)::int n FROM legislation_answers')).rows[0].n
    await pool.query("CREATE FUNCTION reject_legal_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='legislation.answer_created' THEN RAISE EXCEPTION 'synthetic';END IF;RETURN NEW;END $$; CREATE TRIGGER reject_legal_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_legal_audit()")
    try {
      expect((await req(0, 'POST', '/questions', question)).statusCode).toBe(500)
      expect((await pool.query('SELECT count(*)::int n FROM legislation_answers')).rows[0].n).toBe(count)
    } finally { await pool.query('DROP TRIGGER reject_legal_audit ON audit_events; DROP FUNCTION reject_legal_audit()') }
  })
})
