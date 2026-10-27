import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type pg from 'pg'
import type { FastifyInstance } from 'fastify'
import { assertTestDatabaseUrl, createDatabasePool, closeDatabasePool, runMigrations, uuidv7 } from '@hasarbotu/database'
import { DEFAULT_ASSISTANT_APPEARANCE } from '@hasarbotu/contracts'
import { buildApp, hashPassword } from '../src/index.js'
import { createCanvas } from '@napi-rs/canvas'

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
    const sharedOrg = uuidv7()
    for (let i = 0; i < 3; i++) {
      const org = i === 2 ? sharedOrg : i === 0 ? sharedOrg : uuidv7(), id = uuidv7(), email = `appearance-${i}@example.test`
      if (i !== 2) await pool.query('INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)', [org, `appearance-${i}`, 'Synthetic'])
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
    const canvas = createCanvas(80, 40)
    canvas.getContext('2d').fillRect(20, 10, 40, 20)
    const customImage = `data:image/png;base64,${canvas.toBuffer('image/png').toString('base64')}`
    const appearance = { ...DEFAULT_ASSISTANT_APPEARANCE, accentColor: '#15803d', characterColor: '#b9e7c8', eyeColor: '#22cc88', textSize: 'large', reduceMotion: true, customImage }
    const saved = await app.inject({ method: 'PUT', url, headers: { cookie: user.cookie }, payload: { expectedUserId: user.id, expectedVersion: 0, appearance } })
    expect(saved.statusCode).toBe(200)
    expect(saved.json().appearance.customImage).toMatch(/^data:image\/png;base64,/)
    expect(saved.json().appearance.eyeColor).toBe('#22cc88')
    expect((await app.inject({ method: 'GET', url, headers: { cookie: user.cookie } })).json()).toEqual(saved.json())
    expect((await app.inject({ method: 'GET', url, headers: { cookie: other.cookie } })).json()).toMatchObject({ userId: other.id, version: 0, appearance: DEFAULT_ASSISTANT_APPEARANCE })
    const colleague = users[2]!
    expect((await app.inject({ method: 'GET', url, headers: { cookie: colleague.cookie } })).json()).toMatchObject({ userId: colleague.id, version: 0, appearance: DEFAULT_ASSISTANT_APPEARANCE })
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
    for (const appearance of [{ ...DEFAULT_ASSISTANT_APPEARANCE, eyeColor: 'url(file:///private)' }, { ...DEFAULT_ASSISTANT_APPEARANCE, eyeColor: '#fff' }, { ...DEFAULT_ASSISTANT_APPEARANCE, accentColor: 'url(file:///private)' }, { ...DEFAULT_ASSISTANT_APPEARANCE, scheme: 'random' }, { ...DEFAULT_ASSISTANT_APPEARANCE, userId: users[1]!.id }, { ...DEFAULT_ASSISTANT_APPEARANCE, customImage: 'https://other-user.test/private.png' }, { ...DEFAULT_ASSISTANT_APPEARANCE, customImage: 'data:image/png;base64,PHN2Zz4=' }]) {
      expect((await app.inject({ method: 'PUT', url, headers: { cookie: user.cookie }, payload: { expectedUserId: user.id, expectedVersion: 1, appearance } })).statusCode).toBe(400)
    }
  })
  it('preserves eye colors for 0.1.76 clients, negotiates strict responses and resets only on explicit null', async () => {
    const user = users[0]!, cookie = user.cookie
    const headers = { cookie, 'user-agent': 'Mozilla/5.0 HasarBotu/0.1.76 Electron/44.9.1' }
    const legacy = await app.inject({ method: 'GET', url, headers })
    expect(legacy.json().appearance).not.toHaveProperty('eyeColor')
    expect(legacy.headers.vary).toContain('User-Agent')
    const modern = await app.inject({ method: 'GET', url, headers: { cookie, 'user-agent': 'Mozilla/5.0 HasarBotu/0.1.77 Electron/44.9.1' } })
    expect(modern.json().appearance.eyeColor).toBe('#22cc88')
    const { eyeColor: _eyeColor, ...appearance } = modern.json().appearance
    expect(_eyeColor).toBe('#22cc88')
    const updated = await app.inject({ method: 'PUT', url, headers, payload: { expectedUserId: user.id, expectedVersion: 1, appearance } })
    expect(updated.statusCode).toBe(200)
    expect(updated.json().appearance).not.toHaveProperty('eyeColor')
    expect((await app.inject({ method: 'GET', url, headers: { cookie } })).json().appearance.eyeColor).toBe('#22cc88')
    const reset = await app.inject({ method: 'PUT', url, headers: { cookie }, payload: { expectedUserId: user.id, expectedVersion: 2, appearance: { ...appearance, eyeColor: null } } })
    expect(reset.statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url, headers: { cookie } })).json().appearance.eyeColor).toBeNull()
  })
  it('serializes concurrent first writes to a single version', async () => {
    const user = users[1]!, payload = { expectedUserId: user.id, expectedVersion: 0, appearance: DEFAULT_ASSISTANT_APPEARANCE }
    const results = await Promise.all([1, 2].map(() => app.inject({ method: 'PUT', url, headers: { cookie: user.cookie }, payload })))
    expect(results.map(r => r.statusCode).sort()).toEqual([200, 409])
    expect((await pool.query('SELECT version FROM user_assistant_preferences WHERE user_id=$1', [user.id])).rows[0].version).toBe(1)
  })
  it('keeps a saved image when a 0.1.72 client edits its legacy appearance fields', async () => {
    const user = users[2]!, cookie = user.cookie
    const customImage = `data:image/png;base64,${createCanvas(8, 4).toBuffer('image/png').toString('base64')}`
    const saved = await app.inject({ method: 'PUT', url, headers: { cookie }, payload: { expectedUserId: user.id, expectedVersion: 0, appearance: { ...DEFAULT_ASSISTANT_APPEARANCE, customImage } } })
    expect(saved.statusCode).toBe(200)
    const userAgent = 'Mozilla/5.0 HasarBotu/0.1.72 Chrome/152.0.7977.167 Electron/44.9.1 Safari/537.36'
    const legacy = await app.inject({ method: 'GET', url, headers: { cookie, 'user-agent': userAgent } })
    expect(legacy.json().appearance).not.toHaveProperty('customImage')
    const updated = await app.inject({ method: 'PUT', url, headers: { cookie, 'user-agent': userAgent }, payload: { expectedUserId: user.id, expectedVersion: 1, appearance: { ...DEFAULT_ASSISTANT_APPEARANCE, accentColor: '#be185d' } } })
    expect(updated.statusCode).toBe(200)
    expect(updated.json().appearance).not.toHaveProperty('customImage')
    const current = (await app.inject({ method: 'GET', url, headers: { cookie } })).json()
    expect(current.appearance.customImage).toBe(saved.json().appearance.customImage)
    expect(current.appearance.accentColor).toBe('#be185d')
    const reset = await app.inject({ method: 'PUT', url, headers: { cookie }, payload: { expectedUserId: user.id, expectedVersion: 2, appearance: { ...DEFAULT_ASSISTANT_APPEARANCE, customImage: null } } })
    expect(reset.statusCode).toBe(200)
    expect(reset.json().appearance.customImage).toBeNull()
  })
})
