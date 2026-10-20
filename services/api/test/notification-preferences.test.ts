import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type pg from 'pg'
import type { FastifyInstance } from 'fastify'
import { assertTestDatabaseUrl, createDatabasePool, closeDatabasePool, runMigrations, uuidv7 } from '@hasarbotu/database'
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@hasarbotu/contracts'
import { buildApp, hashPassword } from '../src/index.js'

const testUrl = process.env.TEST_DATABASE_URL
describe.skipIf(!testUrl)('personal notification settings and mandatory Tramer results', () => {
  let pool: pg.Pool, app: FastifyInstance
  let inFlight = 0
  let drained: (() => void) | undefined
  const users: { id: string; org: string; cookie: string; caseId: string }[] = []
  const url = '/api/v1/me/notification-preferences'
  beforeAll(async () => {
    const config = assertTestDatabaseUrl(testUrl!)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    app = buildApp({ loggerEnabled: false,auth: { pool, cookieSecure: false, loginRateLimit: { limit: 50, windowMs: 60_000 } } })
    app.addHook('onRequest',async () => { inFlight++ })
    app.addHook('onResponse',async () => { inFlight--;if (inFlight === 0) drained?.() })
    const password = 'Notification-Test-Only-42!', hash = await hashPassword(password)
    for (let i = 0; i < 3; i++) {
      const org = i === 1 ? users[0]!.org : uuidv7(), id = uuidv7(), email = `notification-${i}@example.test`, caseId = uuidv7()
      if (i !== 1) await pool.query('INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)', [org, `notification-${i}`, 'Synthetic'])
      await pool.query('INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,$3,$4,$5)', [id, org, email, 'Synthetic', hash])
      await pool.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code='read_only'", [id])
      await pool.query(`INSERT INTO cases(id,organization_id,office_year,office_sequence,office_number,case_type,workflow_stage,plate,plate_normalized,responsible_user_id)
        VALUES($1,$2,2026,$3,$4,'traffic','new_notification','34 TEST 123','34TEST123',$5)`, [caseId,org,i+1,`2026/${i+1}`,id])
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } })
      expect(login.statusCode).toBe(200)
      users.push({ id, org, caseId, cookie: String(login.headers['set-cookie']).split(';')[0]! })
    }
  }, 60_000)
  afterAll(async () => { if (app) { if (inFlight > 0) await new Promise<void>(resolve => { drained = resolve });await app.close() }; if (pool) await closeDatabasePool(pool) })
  it('requires authentication and persists only the current account preferences', async () => {
    expect((await app.inject({ url })).statusCode).toBe(401)
    expect((await app.inject({ method: 'PUT',url,payload: {} })).statusCode).toBe(401)
    const user = users[0]!
    expect((await app.inject({ url,headers: { cookie: user.cookie } })).json()).toEqual({ userId: user.id,version: 0,preferences: DEFAULT_NOTIFICATION_PREFERENCES })
    const preferences = { showPopups: false,playSound: false,assistantReaction: false }
    const saved = await app.inject({ method: 'PUT',url,headers: { cookie: user.cookie },payload: { expectedUserId: user.id,expectedVersion: 0,preferences } })
    expect(saved.statusCode).toBe(200)
    expect((await app.inject({ url,headers: { cookie: user.cookie } })).json()).toEqual(saved.json())
    for (const other of users.slice(1)) expect((await app.inject({ url,headers: { cookie: other.cookie } })).json()).toMatchObject({ version: 0,preferences: DEFAULT_NOTIFICATION_PREFERENCES })
    expect((await app.inject({ method: 'PUT',url,headers: { cookie: user.cookie },payload: { expectedUserId: user.id,expectedVersion: 0,preferences } })).statusCode).toBe(409)
    expect((await app.inject({ method: 'PUT',url,headers: { cookie: users[1]!.cookie },payload: { expectedUserId: user.id,expectedVersion: 1,preferences } })).statusCode).toBe(409)
  })
  it('prioritizes actual results and keeps them visible when muted, without showing another employee data', async () => {
    for (const user of users) {
      for (let i = 0; i < 25; i++) await pool.query(`INSERT INTO tracking_notifications(id,organization_id,case_id,recipient_user_id,event_key,kind,title)
        VALUES($1,$2,$3,$4,$5,'document','Synthetic document')`, [uuidv7(),user.org,user.caseId,user.id,`doc:${user.id}:${i}`])
      await pool.query(`INSERT INTO tracking_notifications(id,organization_id,case_id,recipient_user_id,event_key,kind,title)
        VALUES($1,$2,$3,$4,$5,'tramer','Synthetic result')`, [uuidv7(),user.org,user.caseId,user.id,`tramer:${uuidv7()}:completed`])
      await pool.query(`INSERT INTO tracking_notifications(id,organization_id,case_id,recipient_user_id,event_key,kind,title)
        VALUES($1,$2,$3,$4,$5,'tramer','Pending review')`, [uuidv7(),user.org,user.caseId,user.id,`tramer:${uuidv7()}:review:abc`])
    }
    const muted = (await app.inject({ url: '/api/v1/tracking/notifications/pending',headers: { cookie: users[0]!.cookie } })).json()
    expect(muted.preferences.showPopups).toBe(false)
    expect(muted.notifications).toHaveLength(1)
    expect(muted.notifications[0]).toMatchObject({ caseId: users[0]!.caseId,isResult: true,title: 'Synthetic result' })
    const ordinary = (await app.inject({ url: '/api/v1/tracking/notifications/pending',headers: { cookie: users[1]!.cookie } })).json()
    expect(ordinary.notifications).toHaveLength(20)
    expect(ordinary.notifications[0].isResult).toBe(true)
    expect(ordinary.notifications.every((row: { caseId: string }) => row.caseId === users[1]!.caseId)).toBe(true)
    const response = await app.inject({ method: 'POST',url: '/api/v1/tracking/notifications/dismiss',headers: { cookie: users[0]!.cookie },payload: { ids: [muted.notifications[0].id,ordinary.notifications[0].id] } })
    expect(response.statusCode).toBe(204)
    expect((await pool.query('SELECT count(*)::int n FROM tracking_notifications WHERE presented_at IS NOT NULL')).rows[0].n).toBe(1)
    expect((await pool.query('SELECT count(*)::int n FROM tracking_notifications WHERE read_at IS NOT NULL')).rows[0].n).toBe(0)
    expect((await app.inject({ method: 'POST',url: '/api/v1/tracking/notifications/dismiss',headers: { cookie: users[1]!.cookie },payload: { ordinary: true } })).statusCode).toBe(204)
    const remaining = (await app.inject({ url: '/api/v1/tracking/notifications/pending',headers: { cookie: users[1]!.cookie } })).json().notifications
    expect(remaining).toHaveLength(1)
    expect(remaining[0]).toMatchObject({ isResult: true,title: 'Synthetic result' })
  })
  it('serializes simultaneous first writes and rejects unsupported Tramer suppression fields', async () => {
    const user = users[2]!, payload = { expectedUserId: user.id,expectedVersion: 0,preferences: DEFAULT_NOTIFICATION_PREFERENCES }
    const results = await Promise.all([1,2].map(() => app.inject({ method: 'PUT',url,headers: { cookie: user.cookie },payload })))
    expect(results.map(result => result.statusCode).sort()).toEqual([200,409])
    expect((await app.inject({ method: 'PUT',url,headers: { cookie: user.cookie },payload: { ...payload,expectedVersion: 1,preferences: { ...payload.preferences,suppressTramer: true } } })).statusCode).toBe(400)
  })
})
