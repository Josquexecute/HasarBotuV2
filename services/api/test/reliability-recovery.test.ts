import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import pg from 'pg'
import type { FastifyInstance } from 'fastify'
import { assertTestDatabaseUrl, closeDatabasePool, createDatabasePool, runMigrations, uuidv7 } from '@hasarbotu/database'
import { buildApp, hashPassword } from '../src/index.js'

const testUrl = process.env.TEST_DATABASE_URL
const barrierKey = 741026321

describe.skipIf(!testUrl)('isolated HTTP and PostgreSQL interruption recovery', () => {
  let pool: pg.Pool, control: pg.Client, app: FastifyInstance, origin: string, cookie: string, userId: string

  async function start() {
    pool = createDatabasePool({ config: assertTestDatabaseUrl(testUrl!), max: 1, connectionTimeoutMillis: 2000 })
    app = buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false } })
    origin = await app.listen({ host: '127.0.0.1', port: 0 })
  }

  async function create(key: string, signal?: AbortSignal) {
    const response = await fetch(origin + '/api/v1/cases', {
      method: 'POST', headers: { cookie, 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify({ caseType: 'traffic', plate: '34 REC 123' }), signal: signal ?? AbortSignal.timeout(10_000),
    })
    return { status: response.status, body: await response.json() as { case: { id: string } } }
  }

  async function waitFor<T>(read: () => Promise<T | undefined>): Promise<T> {
    const deadline = Date.now() + 5000
    do {
      const value = await read()
      if (value !== undefined) return value
      await delay(10)
    } while (Date.now() < deadline)
    throw new Error('Isolated recovery synchronization condition did not occur')
  }

  async function blockFinalWrite(key: string) {
    await control.query('SELECT pg_advisory_lock($1)', [barrierKey])
    // Pause after the case, counter and audit writes, before the idempotency record and COMMIT.
    await control.query(`CREATE FUNCTION recovery_final_write_barrier() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.idem_key = TG_ARGV[0] THEN PERFORM pg_advisory_xact_lock(${barrierKey}); END IF; RETURN NEW; END $$;
      CREATE TRIGGER recovery_final_write_barrier BEFORE INSERT ON idempotency_keys FOR EACH ROW
      EXECUTE FUNCTION recovery_final_write_barrier('${key}')`)
  }

  async function unblockFinalWrite() {
    await control.query('SELECT pg_advisory_unlock($1)', [barrierKey])
    await control.query('DROP TRIGGER IF EXISTS recovery_final_write_barrier ON idempotency_keys; DROP FUNCTION IF EXISTS recovery_final_write_barrier()')
  }

  const blockedBackend = () => waitFor(async () => (await control.query<{ pid: number }>(
    "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND wait_event='advisory' AND query LIKE '%INSERT INTO idempotency_keys%'",
  )).rows[0]?.pid)

  async function counts() {
    return (await control.query(`SELECT
      (SELECT count(*)::int FROM cases) cases,
      (SELECT count(*)::int FROM case_follow_up_history) follow_ups,
      (SELECT count(*)::int FROM audit_events WHERE action='case.created') audit,
      (SELECT count(*)::int FROM idempotency_keys) idempotency,
      (SELECT coalesce(sum(last_sequence),0)::int FROM office_counters) office_sequence`)).rows[0]
  }

  async function expectSingleCommit(key: string, id: string) {
    expect((await pool.query('SELECT 1 FROM cases WHERE id=$1', [id])).rowCount).toBe(1)
    expect((await pool.query("SELECT 1 FROM audit_events WHERE action='case.created' AND resource_id=$1", [id])).rowCount).toBe(1)
    expect((await pool.query('SELECT case_id FROM idempotency_keys WHERE idem_key=$1', [key])).rows).toEqual([{ case_id: id }])
    expect(pool.waitingCount).toBe(0)
    expect(pool.idleCount).toBe(pool.totalCount)
    expect((await control.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'")).rowCount).toBe(0)
  }

  beforeAll(async () => {
    const config = assertTestDatabaseUrl(testUrl!)
    control = new pg.Client({ connectionString: config.url })
    await control.connect()
    await control.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    const organizationId = uuidv7()
    userId = uuidv7()
    await control.query("INSERT INTO organizations(id,code,name) VALUES($1,'recovery-fixture','Synthetic recovery office')", [organizationId])
    await control.query("INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,'recovery@example.test','Synthetic recovery user',$3)",
      [userId, organizationId, await hashPassword('Synthetic-Recovery-42!')])
    await control.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code='admin'", [userId])
    await start()
    const login = await fetch(origin + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'recovery@example.test', password: 'Synthetic-Recovery-42!', rememberMe: true }) })
    expect(login.status).toBe(200)
    await login.text()
    expect(login.headers.get('set-cookie')).toMatch(/Max-Age=/)
    cookie = login.headers.get('set-cookie')!.split(';')[0]!
  }, 60_000)

  afterAll(async () => {
    if (app) await app.close()
    if (pool) await closeDatabasePool(pool)
    if (control) await control.end()
  })

  it('preserves a persistent session and one idempotent result across API and pool recreation', async () => {
    const key = uuidv7(), created = await create(key)
    expect(created.status).toBe(201)
    await app.close()
    await closeDatabasePool(pool)
    await start()
    const session = await fetch(origin + '/api/v1/auth/session', { headers: { cookie } })
    expect(session.status).toBe(200)
    expect(await session.json()).toMatchObject({ user: { id: userId } })
    expect(await create(key)).toEqual(created)
    await expectSingleCommit(key, created.body.case.id)
  })

  it('rolls back a terminated transaction and recovers the single-client pool without consuming a case number', async () => {
    const before = await counts(), key = uuidv7()
    await blockFinalWrite(key)
    const command = create(key)
    try {
      const pid = await blockedBackend()
      expect((await control.query('SELECT pg_terminate_backend($1) terminated', [pid])).rows[0].terminated).toBe(true)
      const failed = await command
      expect(failed.status).toBe(500)
      expect(JSON.stringify(failed.body)).not.toMatch(/pg_terminate|terminating|INSERT|stack|password/i)
      expect(await counts()).toEqual(before)
      expect((await control.query('SELECT 1 FROM idempotency_keys WHERE idem_key=$1', [key])).rowCount).toBe(0)
    } finally {
      await unblockFinalWrite()
      await command
    }
    const recovered = await create(key)
    expect(recovered.status).toBe(201)
    expect(await create(key)).toEqual(recovered)
    await expectSingleCommit(key, recovered.body.case.id)
    expect((await counts()).office_sequence).toBe(before.office_sequence + 1)
  })

  it('commits one result when a client disconnects after dispatch and safely replays the uncertain request', async () => {
    const before = await counts(), key = uuidv7(), controller = new AbortController()
    await blockFinalWrite(key)
    const command = create(key, controller.signal).then(result => ({ result, error: undefined }), error => ({ result: undefined, error }))
    try {
      await blockedBackend()
      controller.abort()
      expect((await command).error).toMatchObject({ name: 'AbortError' })
    } finally {
      await unblockFinalWrite()
    }
    const id = await waitFor(async () => (await control.query<{ case_id: string }>('SELECT case_id FROM idempotency_keys WHERE idem_key=$1', [key])).rows[0]?.case_id)
    const replayed = await create(key)
    expect(replayed.status).toBe(201)
    expect(replayed.body.case.id).toBe(id)
    await expectSingleCommit(key, id)
    const after = await counts()
    expect(after.cases).toBe(before.cases + 1)
    expect(after.audit).toBe(before.audit + 1)
    expect(after.idempotency).toBe(before.idempotency + 1)
    expect(after.office_sequence).toBe(before.office_sequence + 1)
  })

  it('removes a disconnected idle PostgreSQL client and serves the next authenticated request', async () => {
    const pid = (await pool.query<{ pid: number }>('SELECT pg_backend_pid() pid')).rows[0]!.pid
    const disconnected = once(pool, 'error')
    expect((await control.query('SELECT pg_terminate_backend($1) terminated', [pid])).rows[0].terminated).toBe(true)
    expect((await disconnected)[0]).toMatchObject({ code: '57P01' })
    const session = await fetch(origin + '/api/v1/auth/session', { headers: { cookie } })
    expect(session.status).toBe(200)
    expect(await session.json()).toMatchObject({ user: { id: userId } })
    expect((await pool.query<{ pid: number }>('SELECT pg_backend_pid() pid')).rows[0]!.pid).not.toBe(pid)
    expect(pool.waitingCount).toBe(0)
    expect(pool.idleCount).toBe(pool.totalCount)
  })
})
