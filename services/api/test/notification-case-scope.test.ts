import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type pg from 'pg'
import type { FastifyInstance } from 'fastify'
import { assertTestDatabaseUrl, createDatabasePool, runMigrations, uuidv7 } from '@hasarbotu/database'
import { buildApp, hashPassword } from '../src/index.js'

describe.skipIf(!process.env.TEST_DATABASE_URL)('case-scoped operational notification reads', () => {
  let pool: pg.Pool, app: FastifyInstance, cookie: string, selected: string, other: string
  beforeAll(async () => {
    const config = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL!)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    const org = uuidv7(), user = uuidv7(), password = 'case-scope-synthetic-password-42'
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,'case-scope','Case scope')", [org])
    await pool.query("INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,'scope@example.test','Scope',$3)", [user, org, await hashPassword(password)])
    await pool.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code='admin'", [user])
    selected = uuidv7(); other = uuidv7()
    for (const [index, id] of [selected, other].entries()) {
      await pool.query(`INSERT INTO cases(id,organization_id,office_year,office_sequence,office_number,case_type,workflow_stage,plate,plate_normalized,responsible_user_id,follow_up_date)
        VALUES($1,$2,2026,$3,$4,'traffic','new_notification',$5,$5,$6,'2020-01-01')`, [id, org, index + 1, `2026/${index + 1}`, `34SCOPE${index + 1}`, user])
    }
    app = buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false } })
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'scope@example.test', password } })
    expect(login.statusCode).toBe(200)
    cookie = String(login.headers['set-cookie']).split(';')[0]!
  }, 60_000)
  afterAll(async () => { await app?.close(); await pool?.end() })
  it('acknowledges only selected-case alerts and rejects empty filter broadening', async () => {
    const list = (id: string) => app.inject({ method: 'GET', url: `/api/v1/operational-alerts?includeTotal=true&unreadOnly=true&caseIds=${id}`, headers: { cookie } })
    expect((await list(selected)).json().alerts.length).toBeGreaterThan(0)
    expect((await list(other)).json().alerts.length).toBeGreaterThan(0)
    const response = await app.inject({ method: 'POST', url: '/api/v1/operational-alerts/read-all', headers: { cookie }, payload: { caseIds: [selected] } })
    expect(response.statusCode).toBe(204)
    expect((await list(selected)).json().alerts).toEqual([])
    expect((await list(other)).json().alerts.length).toBeGreaterThan(0)
    expect((await pool.query('SELECT DISTINCT case_id FROM operational_alert_reads')).rows).toEqual([{ case_id: selected }])
    expect((await app.inject({ method: 'POST', url: '/api/v1/operational-alerts/read-all', headers: { cookie }, payload: { caseIds: [] } })).statusCode).toBe(400)
    expect((await list(other)).json().alerts.length).toBeGreaterThan(0)
  })
})
