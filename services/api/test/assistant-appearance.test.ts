import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type pg from 'pg'
import type { FastifyInstance } from 'fastify'
import { assertTestDatabaseUrl, createDatabasePool, closeDatabasePool, runMigrations, uuidv7 } from '@hasarbotu/database'
import { DEFAULT_ASSISTANT_APPEARANCE } from '@hasarbotu/contracts'
import { buildApp, hashPassword } from '../src/index.js'

const testUrl = process.env.TEST_DATABASE_URL
describe.skipIf(!testUrl)('account-specific Touch appearance', () => {
  let pool: pg.Pool, app: FastifyInstance
  let inFlight = 0
  let drained: (() => void) | undefined
  const users: { id: string; cookie: string }[] = []
  const url = '/api/v1/me/assistant-appearance'
  beforeAll(async () => {
    const config = assertTestDatabaseUrl(testUrl!)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    app = await buildApp({ auth: { pool, cookieSecure: false, loginRateLimit: { limit: 50, windowMs: 60_000 } } })
    app.addHook('onRequest', async () => { inFlight++ })
    app.addHook('onResponse', async () => { inFlight--; if (inFlight === 0) drained?.() })
    const password = 'Appearance-Test-Only-42!', passwordHash = await hashPassword(password)
    for (let i = 0; i < 2; i++) {
      const org = uuidv7(), id = uuidv7(), email = `appearance-${i}@example.test`
      await pool.query('INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)', [org, `appearance-${i}`, 'Synthetic'])
      await pool.query('INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,$3,$4,$5)', [id, org, email, 'Synthetic', passwordHash])
      await pool.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code='read_only'", [id])
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } })
      expect(login.statusCode).toBe(200)
      users.push({ id, cookie: String(login.headers['set-cookie']).split(';')[0]! })
    }
  }, 60_000)
  afterAll(async () => { if (app) { if (inFlight > 0) await new Promise<void>(resolve => { drained = resolve }); await app.close() }; if (pool) await closeDatabasePool(pool) })
  it('requires authentication for reads and writes', async () => {
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401)
    expect((await app.inject({ method: 'PUT', url, payload: {} })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/api/v1/cases', headers: { cookie: users[0]!.cookie }, payload: {} })).statusCode).toBe(403)
  })
  it('lets read-only accounts personalize themselves, persists changes and isolates organizations', async () => {
    const user = users[0]!, other = users[1]!
    const initial = await app.inject({ method: 'GET', url, headers: { cookie: user.cookie } })
    expect(initial.json()).toMatchObject({ userId: user.id, version: 0, appearance: DEFAULT_ASSISTANT_APPEARANCE })
    const appearance = { ...DEFAULT_ASSISTANT_APPEARANCE, accentColor: '#15803d', characterColor: '#b9e7c8', textSize: 'large', reduceMotion: true }
    const saved = await app.inject({ method: 'PUT', url, headers: { cookie: user.cookie }, payload: { expectedUserId: user.id, expectedVersion: 0, appearance } })
    expect(saved.statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url, headers: { cookie: user.cookie } })).json()).toEqual(saved.json())
    expect((await app.inject({ method: 'GET', url, headers: { cookie: other.cookie } })).json()).toMatchObject({ userId: other.id, version: 0, appearance: DEFAULT_ASSISTANT_APPEARANCE })
    expect((await pool.query("SELECT details FROM audit_events WHERE action='user.assistant_appearance_updated'")).rows).toHaveLength(1)
  })
  it('rejects stale versions and account switches without changing either profile', async () => {
    const user = users[0]!, other = users[1]!
    const input = { expectedUserId: user.id, expectedVersion: 0, appearance: DEFAULT_ASSISTANT_APPEARANCE }
    expect((await app.inject({ method: 'PUT', url, headers: { cookie: user.cookie }, payload: input })).statusCode).toBe(409)
    expect((await app.inject({ method: 'PUT', url, headers: { cookie: other.cookie }, payload: input })).statusCode).toBe(409)
    expect((await pool.query('SELECT count(*)::int n FROM user_assistant_preferences')).rows[0].n).toBe(1)
  })
  it('rejects CSS injection and unexpected fields', async () => {
    const user = users[0]!
    for (const appearance of [{ ...DEFAULT_ASSISTANT_APPEARANCE, accentColor: 'url(file:///private)' }, { ...DEFAULT_ASSISTANT_APPEARANCE, scheme: 'random' }, { ...DEFAULT_ASSISTANT_APPEARANCE, userId: users[1]!.id }]) {
      expect((await app.inject({ method: 'PUT', url, headers: { cookie: user.cookie }, payload: { expectedUserId: user.id, expectedVersion: 1, appearance } })).statusCode).toBe(400)
    }
  })
  it('serializes concurrent first writes to a single version', async () => {
    const user = users[1]!, payload = { expectedUserId: user.id, expectedVersion: 0, appearance: DEFAULT_ASSISTANT_APPEARANCE }
    const results = await Promise.all([1, 2].map(() => app.inject({ method: 'PUT', url, headers: { cookie: user.cookie }, payload })))
    expect(results.map(r => r.statusCode).sort()).toEqual([200, 409])
    expect((await pool.query('SELECT version FROM user_assistant_preferences WHERE user_id=$1', [user.id])).rows[0].version).toBe(1)
  })
})
