import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AUTH_LOGIN_ROUTE, CASES_ROUTE, EXPERTS_REFERENCE_ROUTE, IDEMPOTENCY_KEY_HEADER, USERS_REFERENCE_ROUTE,
  USERS_ROUTE, expertsReferenceResponseSchema, userResponseSchema, usersReferenceResponseSchema,
} from '@hasarbotu/contracts'
import { assertTestDatabaseUrl, createDatabasePool, closeDatabasePool, runMigrations, uuidv7 } from '@hasarbotu/database'
import { buildApp, hashPassword, verifyPassword } from '../src/index.js'

const testUrl = process.env.TEST_DATABASE_URL
const describeDb = testUrl ? describe : describe.skip
const password = 'manual-user-synthetic-password-25'

describeDb('manual user creation: real login, references, assignment and tenant isolation', () => {
  let app: FastifyInstance
  let pool: pg.Pool
  let organizationId: string
  let otherOrganizationId: string
  let cookie: string
  let managerCookie: string
  let otherCookie: string

  async function seedUser(org: string, email: string, role: string) {
    const id = uuidv7()
    await pool.query('INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,$3,$3,$4)', [id, org, email, await hashPassword(password)])
    await pool.query('INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code=$2', [id, role])
    const result = await app.inject({ method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email, password } })
    expect(result.statusCode).toBe(200)
    return String(result.headers['set-cookie']).split(';')[0] as string
  }

  beforeAll(async () => {
    const config = assertTestDatabaseUrl(testUrl as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    organizationId = uuidv7()
    otherOrganizationId = uuidv7()
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,'manual-user-a','Sentetik A'),($2,'manual-user-b','Sentetik B')", [organizationId, otherOrganizationId])
    app = buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false, loginRateLimit: { limit: 100, windowMs: 60_000 } } })
    cookie = await seedUser(organizationId, 'admin-a@example.test', 'admin')
    managerCookie = await seedUser(organizationId, 'manager-a@example.test', 'case_manager')
    otherCookie = await seedUser(otherOrganizationId, 'admin-b@example.test', 'admin')
  }, 60_000)

  afterAll(async () => {
    if (app) await app.close()
    if (pool) await closeDatabasePool(pool)
  })

  const input = { displayName: 'Sentetik Eksper', email: 'expert@example.test', password, roles: ['expert', 'case_manager'] }

  it('rejects unauthenticated callers and non-admins before creating anything', async () => {
    expect((await app.inject({ method: 'POST', url: USERS_ROUTE, payload: input })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: USERS_ROUTE, headers: { cookie: managerCookie }, payload: input })).statusCode).toBe(403)
    expect((await pool.query('SELECT count(*)::int AS total FROM users')).rows[0].total).toBe(3)
  })

  it('rejects blank names, invalid credentials, missing roles and tenant injection', async () => {
    for (const fields of [{ displayName: '  ' }, { email: 'invalid' }, { password: 'short' }, { roles: [] }, { roles: ['invalid'] }, { organizationId: otherOrganizationId }]) {
      expect((await app.inject({ method: 'POST', url: USERS_ROUTE, headers: { cookie }, payload: { ...input, ...fields } })).statusCode).toBe(400)
    }
    expect((await pool.query('SELECT count(*)::int AS total FROM users')).rows[0].total).toBe(3)
  })

  it('persists a usable account, hashes its password, audits the operation and enables real expert assignment', async () => {
    const response = await app.inject({ method: 'POST', url: USERS_ROUTE, headers: { cookie }, payload: { ...input, email: ' Expert@Example.Test ', displayName: ' Sentetik Eksper ' } })
    expect(response.statusCode, response.payload).toBe(201)
    const user = userResponseSchema.parse(response.json()).user
    expect(user).toMatchObject({ email: 'expert@example.test', displayName: 'Sentetik Eksper', roles: ['case_manager', 'expert'], status: 'active', version: 1 })
    expect(response.payload).not.toContain(password)
    expect(response.payload).not.toContain('password_hash')
    const stored = (await pool.query('SELECT organization_id,password_hash FROM users WHERE id=$1', [user.id])).rows[0]
    expect(stored.organization_id).toBe(organizationId)
    expect(stored.password_hash).not.toBe(password)
    expect(await verifyPassword(stored.password_hash, password)).toBe(true)
    const login = await app.inject({ method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email: user.email, password } })
    expect(login.statusCode).toBe(200)
    expect(login.json().user.roles).toEqual(['case_manager', 'expert'])
    const users = usersReferenceResponseSchema.parse((await app.inject({ method: 'GET', url: USERS_REFERENCE_ROUTE, headers: { cookie } })).json())
    const experts = expertsReferenceResponseSchema.parse((await app.inject({ method: 'GET', url: EXPERTS_REFERENCE_ROUTE, headers: { cookie } })).json())
    expect(users.items.some(row => row.id === user.id)).toBe(true)
    expect(experts.items.some(row => row.id === user.id)).toBe(true)
    const foreignUsers = usersReferenceResponseSchema.parse((await app.inject({ method: 'GET', url: USERS_REFERENCE_ROUTE, headers: { cookie: otherCookie } })).json())
    expect(foreignUsers.items.some(row => row.id === user.id)).toBe(false)
    const createdCase = await app.inject({ method: 'POST', url: CASES_ROUTE, headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() }, payload: { caseType: 'traffic', plate: '34 MAN 0025', responsibleUserId: user.id, expertUserId: user.id } })
    expect(createdCase.statusCode, createdCase.payload).toBe(201)
    const assigned = (await pool.query('SELECT responsible_user_id,expert_user_id FROM cases WHERE organization_id=$1', [organizationId])).rows[0]
    expect(assigned).toMatchObject({ responsible_user_id: user.id, expert_user_id: user.id })
    const audit = await pool.query("SELECT details FROM audit_events WHERE action='user.created' AND resource_id=$1", [user.id])
    expect(audit.rowCount).toBe(1)
    expect(audit.rows[0].details.roles).toEqual(['case_manager', 'expert'])
    expect(JSON.stringify(audit.rows)).not.toMatch(/password|email/i)
  })

  it('case-insensitive duplicate email is a conflict and never changes the existing account', async () => {
    const response = await app.inject({ method: 'POST', url: USERS_ROUTE, headers: { cookie: otherCookie }, payload: { ...input, email: 'EXPERT@EXAMPLE.TEST', roles: ['admin'] } })
    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('user_email_in_use')
    expect((await pool.query("SELECT count(*)::int AS total FROM users WHERE lower(email)='expert@example.test'")).rows[0].total).toBe(1)
  })

  it('concurrent duplicate submissions create exactly one account and one audit event', async () => {
    const results = await Promise.all([1, 2].map(() => app.inject({ method: 'POST', url: USERS_ROUTE, headers: { cookie }, payload: { ...input, email: 'concurrent@example.test' } })))
    expect(results.map(response => response.statusCode).sort()).toEqual([201, 409])
    const rows = await pool.query("SELECT id FROM users WHERE email='concurrent@example.test'")
    expect(rows.rowCount).toBe(1)
    expect((await pool.query("SELECT count(*)::int AS total FROM audit_events WHERE action='user.created' AND resource_id=$1", [rows.rows[0].id])).rows[0].total).toBe(1)
  })

  it('fails closed and rolls back the user when a requested catalog role is unavailable', async () => {
    const removed = (await pool.query("DELETE FROM roles WHERE code='accounting' RETURNING id,code,name")).rows[0]
    try {
      const response = await app.inject({ method: 'POST', url: USERS_ROUTE, headers: { cookie }, payload: { ...input, email: 'rollback@example.test', roles: ['accounting'] } })
      expect(response.statusCode).toBe(500)
      expect((await pool.query("SELECT count(*)::int AS total FROM users WHERE email='rollback@example.test'")).rows[0].total).toBe(0)
    } finally {
      await pool.query('INSERT INTO roles(id,code,name) VALUES($1,$2,$3)', [removed.id, removed.code, removed.name])
    }
  })
})
