import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { caseDetailResponseSchema, caseListResponseSchema, caseFaultResponseSchema } from '@hasarbotu/contracts'
import { assertTestDatabaseUrl, createDatabasePool, runMigrations, uuidv7 } from '@hasarbotu/database'
import { buildApp, hashPassword } from '../src/index.js'
import { runBehindRowLock } from '../test-support/row-lock-race.js'
import { defaultRolePolicy } from '../src/auth/permissions.js'

const testUrl = process.env.TEST_DATABASE_URL
describe.skipIf(!testUrl)('case fault real PostgreSQL/API regression', () => {
  let pool: pg.Pool, app: FastifyInstance, org: string, userId: string, foreignOrg: string
  const cookies: Record<string, string> = {}
  let sequence = 1
  const url = (id: string) => `/api/v1/cases/${id}/fault`
  const get = (id: string, role = 'expert') => app.inject({ method: 'GET', url: url(id), headers: { cookie: cookies[role]! } })
  const put = (id: string, insuredPercent: unknown, expectedVersion: unknown = 0, role = 'expert') => app.inject({ method: 'PUT', url: url(id), headers: { cookie: cookies[role]! }, payload: { insuredPercent, expectedVersion } })
  async function newCase(type: 'traffic' | 'casco' | null = 'traffic', organization = org) {
    const id = uuidv7(), n = sequence++
    await pool.query(`INSERT INTO cases(id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,workflow_stage,plate,plate_normalized)
      VALUES($1,$2,2026,$3,$4,$5,'open','new_notification','34 TEST 1','34TEST1')`, [id, organization, n, `2026/${n}`, type])
    return id
  }
  beforeAll(async () => {
    const config = assertTestDatabaseUrl(testUrl!)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    org = uuidv7(); foreignOrg = uuidv7()
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,'fault-main','Synthetic office'),($2,'fault-foreign','Foreign office')", [org, foreignOrg])
    const password = 'Synthetic-Fault-Test-2026!'
    const hash = await hashPassword(password)
    for (const role of ['expert', 'secretary', 'accounting', 'read_only', 'admin']) {
      const id = uuidv7()
      if (role === 'expert') userId = id
      await pool.query('INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,$3,$4,$5)', [id, org, `${role}@fault.test`, role, hash])
      await pool.query('INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code=$2', [id, role])
    }
    app = buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false } })
    for (const role of ['expert', 'secretary', 'accounting', 'read_only', 'admin']) {
      const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: `${role}@fault.test`, password } })
      expect(response.statusCode).toBe(200)
      cookies[role] = String(response.headers['set-cookie']).split(';')[0]!
    }
  }, 90000)
  afterAll(async () => { await app?.close(); await pool?.end() })

  it('defaults existing cases to undetermined without changing legacy DTOs', async () => {
    const id = await newCase()
    const result = await get(id)
    expect(result.statusCode).toBe(200)
    expect(caseFaultResponseSchema.parse(result.json())).toMatchObject({ caseId: id, insuredPercent: null, version: 0, updatedAt: null, permissions: { canEdit: true } })
    const detail = await app.inject({ url: `/api/v1/cases/${id}`, headers: { cookie: cookies.expert! } })
    expect(detail.statusCode).toBe(200)
    expect(caseDetailResponseSchema.safeParse(detail.json()).success).toBe(true)
    expect(detail.json().case).not.toHaveProperty('insuredPercent')
    const list = await app.inject({ url: '/api/v1/cases', headers: { cookie: cookies.expert! } })
    expect(caseListResponseSchema.safeParse(list.json()).success).toBe(true)
  })
  it.each(['traffic', 'casco'] as const)('persists all fixed choices, revision and clearing for %s', async type => {
    const id = await newCase(type)
    let version = 0
    for (const value of [0, 25, 50, 75, 100, null]) {
      const result = await put(id, value, version++)
      expect(result.statusCode).toBe(200)
      expect(result.json()).toMatchObject({ insuredPercent: value, version, caseType: type })
      expect((await get(id)).json()).toEqual(result.json())
    }
    const audits = await pool.query("SELECT details FROM audit_events WHERE resource_id=$1 AND action='case.fault_updated' ORDER BY occurred_at", [id])
    expect(audits.rowCount).toBe(6)
    expect(audits.rows.at(-1)?.details).toMatchObject({ insuredPercent: null, previousInsuredPercent: 100, version: 6 })
    expect((await pool.query('SELECT version,recourse_status FROM cases WHERE id=$1', [id])).rows[0]).toEqual({ version: 1, recourse_status: 'unknown' })
  })
  it('never promotes potential recourse or changes an existing confirmed decision', async () => {
    const id = await newCase('casco')
    await pool.query("UPDATE cases SET recourse_status='confirmed' WHERE id=$1", [id])
    expect((await put(id, 0)).statusCode).toBe(200)
    expect((await pool.query('SELECT recourse_status FROM cases WHERE id=$1', [id])).rows[0].recourse_status).toBe('confirmed')
  })
  it.each([1, 25.5, -25, 125, '25', undefined])('rejects invalid manual percentage %s without writing', async value => {
    const id = await newCase()
    expect((await put(id, value)).statusCode).toBe(400)
    expect((await get(id)).json().version).toBe(0)
  })
  it('enforces authentication, role, tenant and case classification boundaries', async () => {
    const id = await newCase(), foreign = await newCase('casco', foreignOrg), unclassified = await newCase(null)
    expect((await app.inject({ url: url(id) })).statusCode).toBe(401)
    expect((await get(id, 'read_only')).json().permissions.canEdit).toBe(false)
    expect((await put(id, 25, 0, 'read_only')).statusCode).toBe(403)
    expect((await get(foreign)).statusCode).toBe(404)
    expect((await put(foreign, 25)).statusCode).toBe(404)
    expect((await get(unclassified)).json().permissions.canEdit).toBe(false)
    expect((await put(unclassified, 25)).statusCode).toBe(409)
    expect((await get(uuidv7())).statusCode).toBe(404)
    expect((await get('invalid')).statusCode).toBe(400)
    expect((await put(id, 25, 0, 'secretary')).statusCode).toBe(200)
    expect((await put(id, 50, 1, 'accounting')).statusCode).toBe(200)
  })
  it('honors custom permission policy on reads and writes', async () => {
    const id = await newCase()
    const permissions = { ...defaultRolePolicy().permissions, case_write: ['admin'] }
    await pool.query('INSERT INTO organization_role_policies(organization_id,version,permissions) VALUES($1,1,$2)', [org, permissions])
    try {
      expect((await get(id)).json().permissions.canEdit).toBe(false)
      expect((await put(id, 25)).statusCode).toBe(403)
    } finally { await pool.query('DELETE FROM organization_role_policies WHERE organization_id=$1', [org]) }
  })
  it('allows exactly one concurrent first write and rejects stale revisions', async () => {
    const id = await newCase()
    const results = await runBehindRowLock(pool, 'SELECT id FROM cases WHERE id=$1 FOR UPDATE', [id], () => put(id, 25))
    expect(results.filter(result => result.statusCode === 200)).toHaveLength(1)
    expect(results.filter(result => result.statusCode === 409)).toHaveLength(4)
    expect((await put(id, 75, 0)).json().error.code).toBe('version_conflict')
    expect((await get(id)).json()).toMatchObject({ insuredPercent: 25, version: 1 })
  })
  it('refuses writes after a concurrent close commits', async () => {
    const id = await newCase()
    const closer = await pool.connect()
    let writing: ReturnType<typeof put> | undefined
    try {
      await closer.query('BEGIN')
      await closer.query('SELECT id FROM cases WHERE id=$1 FOR UPDATE', [id])
      writing = put(id, 50)
      void writing.then(() => undefined)
      await vi.waitFor(async () => {
        const waits = await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT case_type,lifecycle_status%'")
        expect(waits.rowCount).toBeGreaterThan(0)
      })
      await closer.query("UPDATE cases SET lifecycle_status='closed',workflow_stage='closed' WHERE id=$1", [id])
      await closer.query('COMMIT')
      expect((await writing).statusCode).toBe(409)
      expect((await get(id)).json()).toMatchObject({ version: 0, permissions: { canEdit: false } })
    } finally { await closer.query('ROLLBACK'); closer.release(); if (writing) await writing }
  })
  it('rolls back the ratio when audit insertion fails', async () => {
    const id = await newCase()
    const { createCaseFaultStore } = await import('../src/case-fault/store.js')
    await pool.query(`CREATE FUNCTION reject_fault_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action='case.fault_updated' THEN RAISE EXCEPTION 'fixture audit unavailable'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_fault_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_fault_audit()`)
    try {
      await expect(createCaseFaultStore(pool).save({ organizationId: org, userId, requestId: 'audit-failure' }, id, { insuredPercent: 50, expectedVersion: 0 })).rejects.toThrow('fixture audit unavailable')
    } finally { await pool.query('DROP TRIGGER reject_fault_audit ON audit_events; DROP FUNCTION reject_fault_audit()') }
    expect((await get(id)).json().version).toBe(0)
  })
  it('enforces database percentage and tenant constraints independently of the API', async () => {
    const id = await newCase()
    await expect(pool.query('INSERT INTO case_fault_ratios(organization_id,case_id,insured_percent,updated_by_user_id) VALUES($1,$2,33,$3)', [org, id, userId])).rejects.toMatchObject({ code: '23514' })
    await expect(pool.query('INSERT INTO case_fault_ratios(organization_id,case_id,insured_percent,updated_by_user_id) VALUES($1,$2,25,$3)', [foreignOrg, id, userId])).rejects.toMatchObject({ code: '23503' })
  })
})
