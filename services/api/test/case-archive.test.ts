import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import pg from 'pg'
import { AGENT_ID_HEADER, AGENT_SECRET_HEADER } from '@hasarbotu/contracts'
import { assertTestDatabaseUrl, closeDatabasePool, createDatabasePool, runMigrations, uuidv7 } from '@hasarbotu/database'
import { buildApp, hashPassword } from '../src/index.js'

const testUrl = process.env.TEST_DATABASE_URL
const describeDb = testUrl ? describe : describe.skip

describeDb('Archived migration fixtures retain history without appearing in operational routes', () => {
  let pool: pg.Pool
  let app: FastifyInstance
  let cookie: string
  let org: string
  let user: string
  let archivedId: string
  let activeId: string
  let version: number

  beforeAll(async () => {
    const config = assertTestDatabaseUrl(testUrl!)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    org = uuidv7()
    user = uuidv7()
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,'archive-test','Archive Test')", [org])
    await pool.query("INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,'archive@test.example','Archive Test',$3)", [user, org, await hashPassword('archive-test-strong-password')])
    await pool.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code='admin'", [user])
    app = buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false } })
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'archive@test.example', password: 'archive-test-strong-password' } })
    expect(login.statusCode).toBe(200)
    cookie = String(login.headers['set-cookie']).split(';')[0]!
    for (const plate of ['34 ARC 101', '34 ACT 202']) {
      const created = await app.inject({ method: 'POST', url: '/api/v1/cases', headers: { cookie, 'idempotency-key': uuidv7() },
        payload: { plate, caseType: 'traffic', followUpDate: '2026-10-12' } })
      expect(created.statusCode).toBe(201)
      if (plate === '34 ARC 101') { archivedId = created.json().case.id; version = created.json().case.version }
      else activeId = created.json().case.id
    }
    await pool.query('UPDATE cases SET is_archived=true WHERE organization_id=$1 AND id=$2', [org, archivedId])
  }, 60_000)

  afterAll(async () => { if (app) await app.close(); if (pool) await closeDatabasePool(pool) })

  it('filters both list rows and total, including search results', async () => {
    const listed = await app.inject({ method: 'GET', url: '/api/v1/cases', headers: { cookie } })
    expect(listed.statusCode).toBe(200)
    expect(listed.json().items.map((row: { id: string }) => row.id)).toEqual([activeId])
    expect(listed.json().pageInfo.totalItems).toBe(1)
    const searched = await app.inject({ method: 'GET', url: '/api/v1/cases?search=34%20ARC%20101', headers: { cookie } })
    expect(searched.json().items).toEqual([])
    expect(searched.json().pageInfo.totalItems).toBe(0)
  })

  it('rejects archived detail, location and mutation while retaining history', async () => {
    const before = (await pool.query('SELECT * FROM case_follow_up_history WHERE organization_id=$1 AND case_id=$2', [org, archivedId])).rows
    expect(before).toHaveLength(1)
    for (const url of [`/api/v1/cases/${archivedId}`, `/api/v1/cases/${archivedId}/location`]) {
      expect((await app.inject({ method: 'GET', url, headers: { cookie } })).statusCode).toBe(404)
    }
    const patched = await app.inject({ method: 'PATCH', url: `/api/v1/cases/${archivedId}`, headers: { cookie }, payload: { expectedVersion: version, followUpDate: '2026-10-13' } })
    expect(patched.statusCode).toBe(404)
    expect((await pool.query('SELECT * FROM case_follow_up_history WHERE organization_id=$1 AND case_id=$2', [org, archivedId])).rows).toEqual(before)
    expect((await pool.query('SELECT version FROM cases WHERE id=$1', [archivedId])).rows[0].version).toBe(version)
  })

  it('keeps active detail and authentication behavior unchanged', async () => {
    expect((await app.inject({ method: 'GET', url: `/api/v1/cases/${activeId}`, headers: { cookie } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: `/api/v1/cases/${archivedId}` })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/api/v1/cases/invalid-id', headers: { cookie } })).statusCode).toBe(404)
  })

  it('offers only active case locations to the real authenticated scanner', async () => {
    await pool.query("INSERT INTO storage_roots(id,organization_id,root_key,label) VALUES($1,$2,'archive-root','Archive Test')", [uuidv7(), org])
    for (const [id, path] of [[archivedId, 'archived'], [activeId, 'active']]) {
      await pool.query("INSERT INTO case_locations(id,organization_id,case_id,storage_root_key,relative_path) VALUES($1,$2,$3,'archive-root',$4)", [uuidv7(), org, id, path])
    }
    const registered = await app.inject({ method: 'POST', url: '/api/v1/agents', headers: { cookie }, payload: { name: 'Archive Test Scanner' } })
    expect(registered.statusCode).toBe(201)
    const { agent, secret } = registered.json()
    const locations = await app.inject({ method: 'GET', url: '/api/v1/tracking/agent/locations', headers: { [AGENT_ID_HEADER]: agent.id, [AGENT_SECRET_HEADER]: secret } })
    expect(locations.statusCode).toBe(200)
    expect(locations.json().locations.map((row: { caseId: string }) => row.caseId)).toEqual([activeId])
    expect((await pool.query('SELECT count(*)::int n FROM case_locations WHERE organization_id=$1', [org])).rows[0].n).toBe(2)
    const rejected = await app.inject({ method: 'POST', url: '/api/v1/tracking/agent/observations',
      headers: { [AGENT_ID_HEADER]: agent.id, [AGENT_SECRET_HEADER]: secret },
      payload: { caseId: archivedId, storageRootKey: 'archive-root', relativePath: 'archived/report.pdf', locationVersion: 1, contentHash: 'a'.repeat(64), byteSize: 10 } })
    expect(rejected.statusCode).toBe(409)
    expect((await pool.query('SELECT count(*)::int n FROM tracked_files WHERE case_id=$1', [archivedId])).rows[0].n).toBe(0)
  })

  it('excludes archived notifications and rejects direct tracking access', async () => {
    const notification = uuidv7()
    await pool.query(`INSERT INTO tracking_notifications(id,organization_id,case_id,recipient_user_id,event_key,kind,title)
      VALUES($1,$2,$3,$4,'archive-notification','document','Archived history')`, [notification, org, archivedId, user])
    for (const url of ['/api/v1/tracking', '/api/v1/tracking/notifications/pending']) {
      const response = await app.inject({ method: 'GET', url, headers: { cookie } })
      expect(response.statusCode).toBe(200)
      expect(response.json().notifications).toEqual([])
    }
    expect((await app.inject({ method: 'GET', url: `/api/v1/tracking?caseId=${archivedId}`, headers: { cookie } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: `/api/v1/tracking/notifications/${notification}/read`, headers: { cookie } })).statusCode).toBe(404)
    expect((await pool.query('SELECT read_at FROM tracking_notifications WHERE id=$1', [notification])).rows[0].read_at).toBeNull()
  })

  it('scans an active case while a concurrent owner update holds its parent row', async () => {
    const scanPool = new pg.Pool({ connectionString: testUrl, options: '-c lock_timeout=500ms' })
    const scanApp = buildApp({ loggerEnabled: false, auth: { pool: scanPool, cookieSecure: false } })
    const ownerUpdate = await pool.connect()
    try {
      const registered = await scanApp.inject({ method: 'POST', url: '/api/v1/agents', headers: { cookie }, payload: { name: 'Concurrent Owner Test' } })
      expect(registered.statusCode).toBe(201)
      const { agent, secret } = registered.json()
      await ownerUpdate.query('BEGIN')
      await ownerUpdate.query('SELECT id FROM cases WHERE id=$1 FOR NO KEY UPDATE', [activeId])
      const observed = await scanApp.inject({ method: 'POST', url: '/api/v1/tracking/agent/observations',
        headers: { [AGENT_ID_HEADER]: agent.id, [AGENT_SECRET_HEADER]: secret },
        payload: { caseId: activeId, storageRootKey: 'archive-root', relativePath: 'active/report.pdf', locationVersion: 1, contentHash: 'b'.repeat(64), byteSize: 10 } })
      expect(observed.statusCode, observed.payload).toBe(200)
      expect(observed.json()).toEqual({ changed: true })
    } finally {
      await ownerUpdate.query('ROLLBACK')
      ownerUpdate.release()
      await scanApp.close()
      await scanPool.end()
    }
  })
})
