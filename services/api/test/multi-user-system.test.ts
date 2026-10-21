import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { performance } from 'node:perf_hooks'
import { appendFile } from 'node:fs/promises'
import { assertTestDatabaseUrl, closeDatabasePool, createDatabasePool, runMigrations, uuidv7 } from '@hasarbotu/database'
import { DEFAULT_NOTIFICATION_PREFERENCES, type RoleCode } from '@hasarbotu/contracts'
import { buildApp, hashPassword } from '../src/index.js'

interface Client {
  id: string
  role: RoleCode
  cookie: string
  caseId: string
}

const testUrl = process.env.TEST_DATABASE_URL
const roles: RoleCode[] = ['admin', 'expert', 'case_manager', 'secretary', 'accounting', 'read_only']
const operators = new Set<RoleCode>(['admin', 'expert', 'case_manager', 'secretary'])

describe.skipIf(!testUrl)('isolated multi-user system over real HTTP and PostgreSQL', () => {
  let pool: pg.Pool, app: FastifyInstance, origin: string, organizationId: string, foreign: Client
  const clients: Client[] = []
  const password = 'Synthetic-System-Audit-42!'
  let maxInFlight = 0, inFlight = 0

  async function request(client: Client, path: string, method = 'GET', body?: unknown, key?: string) {
    const response = await fetch(origin + path, {
      method,
      headers: { cookie: client.cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(key ? { 'idempotency-key': key } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    })
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : undefined }
  }

  async function createCase(client: Client, key = uuidv7(), plate = '34 AUD 123') {
    return request(client, '/api/v1/cases', 'POST', { caseType: 'traffic', plate }, key)
  }

  beforeAll(async () => {
    const config = assertTestDatabaseUrl(testUrl!)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    organizationId = uuidv7()
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,'multi-user-main','Synthetic office')", [organizationId])
    const foreignOrganizationId = uuidv7()
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,'multi-user-foreign','Synthetic foreign office')", [foreignOrganizationId])
    app = buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false, loginRateLimit: { limit: 1000, windowMs: 60_000 } } })
    app.addHook('onRequest', async () => { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight) })
    app.addHook('onResponse', async () => { inFlight-- })
    origin = await app.listen({ host: '127.0.0.1', port: 0 })
    const hash = await hashPassword(password)
    for (let i = 0; i < 51; i++) {
      const id = uuidv7(), org = i === 50 ? foreignOrganizationId : organizationId
      const role = roles[i % roles.length]!, email = `system-audit-${i}@example.test`
      await pool.query('INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,$3,$4,$5)', [id, org, email, `Synthetic ${i}`, hash])
      await pool.query('INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code=$2', [id, role])
      const response = await fetch(origin + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, rememberMe: false }) })
      expect(response.status).toBe(200)
      await response.text()
      const cookie = response.headers.get('set-cookie')!.split(';')[0]!, caseId = uuidv7()
      await pool.query(`INSERT INTO cases(id,organization_id,office_year,office_sequence,office_number,case_type,workflow_stage,plate,plate_normalized,responsible_user_id)
        VALUES($1,$2,2026,$3,$4,'traffic','new_notification','34 AUD 123','34AUD123',$5)`, [caseId, org, 10000 + i, `2026/${10000 + i}`, id])
      const client = { id, role, cookie, caseId }
      if (i === 50) foreign = client
      else clients.push(client)
    }
    await pool.query(`INSERT INTO cases(id,organization_id,office_year,office_sequence,office_number,case_type,workflow_stage,plate,plate_normalized)
      SELECT gen_random_uuid(),$1,2026,n,'2026/'||n,'casco','inspection_pending','06 LOAD '||n,'06LOAD'||n FROM generate_series(1,2000) n`, [organizationId])
    await pool.query('ANALYZE cases')
    await pool.query('INSERT INTO office_counters(organization_id,office_year,last_sequence) VALUES($1,2026,20000)', [organizationId])
  }, 60_000)

  afterAll(async () => {
    if (app) await app.close()
    if (pool) await closeDatabasePool(pool)
  })

  it('runs ten independent sessions with all six roles, concurrent writes and isolated preferences', async () => {
    const results = await Promise.all(clients.slice(0, 10).map(async client => {
      const [session, list, settings, saved, created] = await Promise.all([
        request(client, '/api/v1/auth/session'),
        request(client, '/api/v1/cases?search=LOAD&pageSize=20'),
        request(client, '/api/v1/me/notification-preferences'),
        request(client, '/api/v1/me/notification-preferences', 'PUT', { expectedUserId: client.id, expectedVersion: 0, preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES, playSound: false } }),
        createCase(client),
      ])
      expect(session.body.user.id).toBe(client.id)
      expect([list.status, settings.status, saved.status]).toEqual([200, 200, 200])
      expect(saved.body.userId).toBe(client.id)
      expect(created.status).toBe(client.role === 'read_only' ? 403 : 201)
      if (operators.has(client.role)) {
        const note = await request(client, `/api/v1/cases/${client.caseId}/notes`, 'POST', { noteType: 'internal', body: `Note by ${client.id}` }, uuidv7())
        expect(note.status).toBe(201)
        expect(note.body.note.createdByUserId).toBe(client.id)
      }
      return client.id
    }))
    expect(new Set(results).size).toBe(10)
    expect(maxInFlight).toBeGreaterThanOrEqual(10)
    const rows = await pool.query('SELECT user_id,version,preferences FROM user_notification_preferences')
    expect(rows.rowCount).toBe(10)
    expect(rows.rows.every(row => row.version === 1 && row.preferences.playSound === false)).toBe(true)
  })

  it('keeps concurrent same-case notes and exactly one result/audit for a repeated command', async () => {
    const writers = clients.filter(client => operators.has(client.role)).slice(0, 10)
    const caseId = clients[0]!.caseId, key = uuidv7()
    const before = (await pool.query('SELECT 1 FROM case_notes WHERE case_id=$1', [caseId])).rowCount!
    const body = { noteType: 'internal', body: 'One logical repeated operation' }
    const repeated = await Promise.all(writers.map(client => request(client, `/api/v1/cases/${caseId}/notes`, 'POST', body, key)))
    expect(repeated.map(result => result.status)).toEqual(Array(10).fill(201))
    expect(new Set(repeated.map(result => result.body.note.id)).size).toBe(1)
    const unique = await Promise.all(writers.map(client => request(client, `/api/v1/cases/${caseId}/notes`, 'POST', { ...body, body: client.id }, uuidv7())))
    expect(unique.every(result => result.status === 201)).toBe(true)
    expect((await pool.query('SELECT 1 FROM case_notes WHERE case_id=$1', [caseId])).rowCount).toBe(before + 11)
    expect((await pool.query("SELECT 1 FROM audit_events WHERE action='case_note.created' AND resource_id=$1", [repeated[0]!.body.note.id])).rowCount).toBe(1)
  })

  it('returns one winner for stale edits and preserves its value and audit', async () => {
    const caseId = clients[0]!.caseId
    const responses = await Promise.all(clients.filter(client => client.role !== 'read_only').slice(0, 10).map((client, i) =>
      request(client, `/api/v1/cases/${caseId}`, 'PATCH', { expectedVersion: 1, insurerClaimNumber: `winner-${i}` })))
    expect(responses.filter(result => result.status === 200)).toHaveLength(1)
    expect(responses.filter(result => result.status === 409)).toHaveLength(9)
    const winner = responses.find(result => result.status === 200)!
    const current = await request(clients[0]!, `/api/v1/cases/${caseId}`)
    expect(current.body.case.insurerClaimNumber).toBe(winner.body.case.insurerClaimNumber)
    expect(current.body.case.version).toBe(2)
    expect((await pool.query("SELECT 1 FROM audit_events WHERE action='case.updated' AND resource_id=$1", [caseId])).rowCount).toBe(1)
  })

  it('serializes double task approval with a single resolution and a single audit event', async () => {
    const caseId = clients[1]!.caseId
    const created = await request(clients[1]!, `/api/v1/cases/${caseId}/tasks`, 'POST', { title: 'Concurrent approval', dueDate: '2026-10-21' }, uuidv7())
    expect(created.status).toBe(201)
    const taskId = created.body.task.id
    const results = await Promise.all(clients.filter(client => operators.has(client.role)).slice(0, 10).map(client =>
      request(client, `/api/v1/cases/${caseId}/tasks/${taskId}/complete`, 'POST', { expectedVersion: 1, resultNote: 'Human confirmed' }, uuidv7())))
    expect(results.filter(result => result.status === 200)).toHaveLength(1)
    expect(results.filter(result => result.status === 409)).toHaveLength(9)
    expect((await pool.query('SELECT status,version FROM case_tasks WHERE id=$1', [taskId])).rows[0]).toEqual({ status: 'completed', version: 2 })
  })

  it('keeps notifications scoped to recipients and denies another organization', async () => {
    const users = clients.slice(0, 10)
    const ids = await Promise.all(users.map(async client => {
      const id = uuidv7()
      await pool.query("INSERT INTO tracking_notifications(id,organization_id,case_id,recipient_user_id,event_key,kind,title) VALUES($1,$2,$3,$4,$5,'document','Synthetic notification')", [id, organizationId, client.caseId, client.id, id])
      return id
    }))
    await Promise.all(users.map(async (client, i) => {
      const response = await request(client, '/api/v1/tracking/notifications/pending')
      expect(response.status).toBe(200)
      expect(response.body.notifications.map((item: { id: string }) => item.id)).toEqual([ids[i]])
      expect((await request(client, '/api/v1/tracking/notifications/dismiss', 'POST', { ids })).status).toBe(204)
    }))
    expect((await pool.query('SELECT 1 FROM tracking_notifications WHERE presented_at IS NOT NULL')).rowCount).toBe(10)
    expect((await request(foreign, `/api/v1/cases/${users[0]!.caseId}`)).status).toBe(404)
    expect((await request(foreign, `/api/v1/cases/${users[0]!.caseId}/operations`)).status).toBe(404)
    expect((await request(foreign, '/api/v1/cases?search=LOAD')).body.items).toEqual([])
  })

  it('applies role revocation to an already open session and rejects all concurrent writes', async () => {
    const client = clients[48]!
    await pool.query('DELETE FROM user_roles WHERE user_id=$1', [client.id])
    await pool.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code='read_only'", [client.id])
    const responses = await Promise.all(Array.from({ length: 10 }, () => createCase(client)))
    expect(responses.map(result => result.status)).toEqual(Array(10).fill(403))
    expect((await request(client, '/api/v1/auth/session')).body.user.roles).toEqual(['read_only'])
    await pool.query('DELETE FROM user_roles WHERE user_id=$1', [client.id])
    await pool.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code='admin'", [client.id])
  })

  it.each([5, 10, 20, 50])('measures %i simultaneous clients against 2,000 synthetic cases', async count => {
    const durationMs = Number(process.env.HB_CAPACITY_DURATION_MS ?? 0)
    if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 45_000) throw new Error('Invalid controlled load duration')
    const latencies: number[] = [], statuses: number[] = []
    let poolWaitingMax = 0, poolTotalMax = 0, rssMax = process.memoryUsage().rss
    const sampler = setInterval(() => {
      poolWaitingMax = Math.max(poolWaitingMax, pool.waitingCount)
      poolTotalMax = Math.max(poolTotalMax, pool.totalCount)
      rssMax = Math.max(rssMax, process.memoryUsage().rss)
    }, 10)
    maxInFlight = 0
    const cpu = process.cpuUsage(), started = performance.now()
    try {
      await Promise.all(clients.slice(0, count).map(async client => {
        for (let i = 0; i < 18 || performance.now() - started < durationMs; i++) {
          const paths = ['/api/v1/cases?search=LOAD&pageSize=20', `/api/v1/cases/${client.caseId}`, `/api/v1/cases/${client.caseId}/operations`, '/api/v1/me/notification-preferences', '/api/v1/tracking/notifications/pending', `/api/v1/cases/${client.caseId}/documents`]
          const start = performance.now()
          const response = i % 6 === 5 && operators.has(client.role)
            ? await request(client, `/api/v1/cases/${client.caseId}/notes`, 'POST', { noteType: 'internal', body: `Load ${count}/${i}` }, uuidv7())
            : await request(client, paths[i % paths.length]!)
          latencies.push(performance.now() - start)
          statuses.push(response.status)
        }
      }))
    } finally { clearInterval(sampler) }
    const elapsedMs = performance.now() - started, cpuUsed = process.cpuUsage(cpu)
    latencies.sort((a, b) => a - b)
    const percentile = (p: number) => Number(latencies[Math.ceil(latencies.length * p) - 1]!.toFixed(2))
    const metric = { clients: count, requests: statuses.length, errors: statuses.filter(status => status !== 200 && status !== 201).length,
      elapsedMs: Math.round(elapsedMs), throughput: Number((statuses.length * 1000 / elapsedMs).toFixed(2)), p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99),
      cpuMs: Math.round((cpuUsed.user + cpuUsed.system) / 1000), rssMaxMB: Math.round(rssMax / 1024 / 1024), poolWaitingMax, poolTotalMax, maxInFlight }
    console.log('MULTI_USER_METRIC ' + JSON.stringify(metric))
    if (process.env.HB_CAPACITY_RESULTS) await appendFile(process.env.HB_CAPACITY_RESULTS, JSON.stringify(metric) + '\n')
    expect(metric.errors).toBe(0)
    expect(maxInFlight).toBeGreaterThanOrEqual(count)
    expect(poolTotalMax).toBeLessThanOrEqual(10)
    expect(pool.waitingCount).toBe(0)
  }, 60_000)

  it('leaves no dangling transaction, broken tenant reference or duplicate idempotency record', async () => {
    expect((await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'")).rowCount).toBe(0)
    expect((await pool.query('SELECT 1 FROM case_notes n JOIN cases c ON c.id=n.case_id WHERE n.organization_id<>c.organization_id')).rowCount).toBe(0)
    expect((await pool.query('SELECT 1 FROM idempotency_keys GROUP BY organization_id,scope,idem_key HAVING count(*)>1')).rowCount).toBe(0)
  })
})
