import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AUDIT_EVENTS_ROUTE,
  AUTH_LOGIN_ROUTE,
  AUTH_LOGOUT_ROUTE,
  CASES_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  auditEventsResponseSchema,
} from '@hasarbotu/contracts'
import {
  assertTestDatabaseUrl,
  closeDatabasePool,
  createDatabasePool,
  runMigrations,
  uuidv7,
  type DatabaseConfig,
} from '@hasarbotu/database'
import { buildApp, hashPassword } from '../src/index.js'
import { createAuditService } from '../src/audit/index.js'
import { withTransaction } from '../src/db/executor.js'

const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe

const PASSWORD = 'cok-guclu-parola-42'

describeDb('Merkezi audit altyapisi (gercek veritabani)', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let orgA: string
  let orgB: string
  let adminId: string
  let serviceAId: string
  let adminCookie: string
  let managerCookie: string
  let adminToken: string

  async function seedUser(orgId: string, email: string, roleCode: string): Promise<string> {
    const id = uuidv7()
    await pool.query(
      'INSERT INTO users (id, organization_id, email, display_name, password_hash) VALUES ($1,$2,$3,$4,$5)',
      [id, orgId, email, email.split('@')[0], await hashPassword(PASSWORD)],
    )
    await pool.query(
      'INSERT INTO user_roles (user_id, role_id) VALUES ($1, (SELECT id FROM roles WHERE code = $2))',
      [id, roleCode],
    )
    return id
  }

  async function loginCookie(email: string): Promise<string> {
    const res = await app.inject({ method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email, password: PASSWORD } })
    const setCookie = res.headers['set-cookie']
    return String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0] as string
  }

  async function createCaseAsAdmin(plate: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: CASES_ROUTE,
      headers: { cookie: adminCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { caseType: 'traffic', plate, notificationFormNumber: `F-${plate.slice(-3)}` },
    })
    return (res.json() as { case: { id: string } }).case.id
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })

    orgA = uuidv7()
    orgB = uuidv7()
    serviceAId = uuidv7()
    await pool.query('INSERT INTO organizations (id, code, name) VALUES ($1,$2,$3)', [orgA, 'org-a', 'Org A'])
    await pool.query('INSERT INTO organizations (id, code, name) VALUES ($1,$2,$3)', [orgB, 'org-b', 'Org B'])
    adminId = await seedUser(orgA, 'admin@a.example', 'admin')
    await seedUser(orgA, 'manager@a.example', 'case_manager')
    await seedUser(orgB, 'user@b.example', 'admin')
    await pool.query('INSERT INTO service_centers (id, organization_id, name, center_type) VALUES ($1,$2,$3,$4)', [
      serviceAId,
      orgA,
      'Merkez',
      'ozel',
    ])

    app = buildApp({
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 1000, windowMs: 60_000 } },
    })
    adminCookie = await loginCookie('admin@a.example')
    adminToken = adminCookie.split('=').slice(1).join('=')
    managerCookie = await loginCookie('manager@a.example')
    await loginCookie('user@b.example') // orgB login olayi uretir (izolasyon testi icin)
  }, 60_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  it('audit_events append-only: UPDATE ve DELETE veritabani seviyesinde reddedilir', async () => {
    const row = await pool.query('SELECT id FROM audit_events LIMIT 1')
    const id = (row.rows[0] as { id: string }).id
    await expect(pool.query('UPDATE audit_events SET action = $1 WHERE id = $2', ['tampered', id])).rejects.toThrow(
      /append-only/,
    )
    await expect(pool.query('DELETE FROM audit_events WHERE id = $1', [id])).rejects.toThrow(/append-only/)
    // Satir hala orada (degistirilmemis).
    const still = await pool.query('SELECT count(*)::int AS n FROM audit_events WHERE id = $1', [id])
    expect((still.rows[0] as { n: number }).n).toBe(1)
  })

  it('redaksiyon: hassas alanlar ve uzun metin DB details icine yazilmaz', async () => {
    const audit = createAuditService()
    await audit.record(pool, {
      organizationId: orgA,
      actorUserId: adminId,
      action: 'test.redaction',
      details: { password: 'super-sirr', tokenHash: 'abc', cookie: 'x=1', note: 'gorunur', big: 'A'.repeat(2000) },
    })
    const row = await pool.query("SELECT details FROM audit_events WHERE action = 'test.redaction'")
    const d = (row.rows[0] as { details: Record<string, string> }).details
    expect(d.password).toBe('[redacted]')
    expect(d.tokenHash).toBe('[redacted]')
    expect(d.cookie).toBe('[redacted]')
    expect(d.note).toBe('gorunur')
    expect(d.big.length).toBeLessThan(600)
  })

  it('atomiklik: transaction icinde audit sonrasi hata olursa audit kaydi KALMAZ', async () => {
    const audit = createAuditService()
    await expect(
      withTransaction(pool, async (client) => {
        await audit.record(client, { organizationId: orgA, action: 'test.rollback' })
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    const n = await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action = 'test.rollback'")
    expect((n.rows[0] as { n: number }).n).toBe(0)
  })

  it('basarisiz is: gecersiz referansli create ne dosya ne audit kaydi birakir', async () => {
    const before = await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action = 'case.created'")
    const res = await app.inject({
      method: 'POST',
      url: CASES_ROUTE,
      headers: { cookie: adminCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { caseType: 'traffic', plate: '34 NON 001', serviceId: uuidv7() },
    })
    expect(res.statusCode).toBe(400)
    const after = await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action = 'case.created'")
    expect((after.rows[0] as { n: number }).n).toBe((before.rows[0] as { n: number }).n)
    const cases = await pool.query("SELECT count(*)::int AS n FROM cases WHERE plate = '34 NON 001'")
    expect((cases.rows[0] as { n: number }).n).toBe(0)
  })

  it('merkezi audit: login/case olaylari kaydedilir ve parola/oturum token sizmaz', async () => {
    const caseId = await createCaseAsAdmin('34 AUD 100')

    const login = await pool.query(
      "SELECT count(*)::int AS n FROM audit_events WHERE action = 'auth.login_succeeded' AND actor_user_id = $1",
      [adminId],
    )
    expect((login.rows[0] as { n: number }).n).toBeGreaterThanOrEqual(1)

    const created = await pool.query(
      "SELECT organization_id, resource_type, resource_id FROM audit_events WHERE action = 'case.created' AND resource_id = $1",
      [caseId],
    )
    expect(created.rows[0]).toMatchObject({ organization_id: orgA, resource_type: 'case', resource_id: caseId })

    // Guvenlik: hicbir audit details ham parolayi veya oturum token'ini icermez.
    const pwLeak = await pool.query(
      "SELECT count(*)::int AS n FROM audit_events WHERE details::text ILIKE '%' || $1 || '%'",
      [PASSWORD],
    )
    expect((pwLeak.rows[0] as { n: number }).n).toBe(0)
    const tokenLeak = await pool.query(
      "SELECT count(*)::int AS n FROM audit_events WHERE details::text ILIKE '%' || $1 || '%'",
      [adminToken],
    )
    expect((tokenLeak.rows[0] as { n: number }).n).toBe(0)
  })

  it('logout merkezi audit kaydi uretir (session iptali ile atomik)', async () => {
    const cookie = await loginCookie('admin@a.example')
    const before = await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action = 'auth.logout'")
    const res = await app.inject({ method: 'POST', url: AUTH_LOGOUT_ROUTE, headers: { cookie } })
    expect(res.statusCode).toBe(204)
    const after = await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action = 'auth.logout'")
    expect((after.rows[0] as { n: number }).n).toBe((before.rows[0] as { n: number }).n + 1)
  })

  it('sorgu API: admin kiracı olaylarini filtreli ve sayfali gorur', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${AUDIT_EVENTS_ROUTE}?action=auth.login_succeeded&pageSize=2&page=1`,
      headers: { cookie: adminCookie },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(auditEventsResponseSchema.safeParse(body).success).toBe(true)
    const parsed = body as { items: { action: string; organizationId: string }[]; pageInfo: { pageSize: number; totalItems: number; totalPages: number } }
    expect(parsed.items.length).toBeLessThanOrEqual(2)
    expect(parsed.items.every((e) => e.action === 'auth.login_succeeded')).toBe(true)
    expect(parsed.items.every((e) => e.organizationId === orgA)).toBe(true)
    expect(parsed.pageInfo.totalItems).toBeGreaterThanOrEqual(1)
    expect(parsed.pageInfo.totalPages).toBe(Math.ceil(parsed.pageInfo.totalItems / parsed.pageInfo.pageSize))
  })

  it('sorgu API: entityType/entityId ve tarih araligi filtreleri', async () => {
    const caseId = await createCaseAsAdmin('34 AUD 200')
    const res = await app.inject({
      method: 'GET',
      url: `${AUDIT_EVENTS_ROUTE}?entityType=case&entityId=${caseId}`,
      headers: { cookie: adminCookie },
    })
    expect(res.statusCode).toBe(200)
    const parsed = res.json() as { items: { action: string; entityType: string | null; entityId: string | null }[] }
    expect(parsed.items.length).toBeGreaterThanOrEqual(1)
    expect(parsed.items.every((e) => e.entityType === 'case' && e.entityId === caseId)).toBe(true)
    expect(parsed.items.some((e) => e.action === 'case.created')).toBe(true)

    // Gelecekteki bir tarih araligi hicbir kayit dondurmez.
    const future = await app.inject({
      method: 'GET',
      url: `${AUDIT_EVENTS_ROUTE}?occurredFrom=2999-01-01T00:00:00.000Z`,
      headers: { cookie: adminCookie },
    })
    expect((future.json() as { items: unknown[] }).items).toEqual([])
  })

  it('kiracı izolasyonu: A yoneticisi B organizasyonunun olaylarini goremez', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${AUDIT_EVENTS_ROUTE}?action=auth.login_succeeded&pageSize=100`,
      headers: { cookie: adminCookie },
    })
    const parsed = res.json() as { items: { organizationId: string }[] }
    expect(parsed.items.length).toBeGreaterThan(0)
    expect(parsed.items.every((e) => e.organizationId === orgA)).toBe(true)
    expect(parsed.items.some((e) => e.organizationId === orgB)).toBe(false)
  })

  it('sorgu API: yonetici olmayan 403, oturumsuz 401, gecersiz filtre 400', async () => {
    const forbidden = await app.inject({ method: 'GET', url: AUDIT_EVENTS_ROUTE, headers: { cookie: managerCookie } })
    expect(forbidden.statusCode).toBe(403)
    expect((forbidden.json() as { error: { code: string } }).error.code).toBe('forbidden')

    const anon = await app.inject({ method: 'GET', url: AUDIT_EVENTS_ROUTE })
    expect(anon.statusCode).toBe(401)

    const bad = await app.inject({
      method: 'GET',
      url: `${AUDIT_EVENTS_ROUTE}?pageSize=99999`,
      headers: { cookie: adminCookie },
    })
    expect(bad.statusCode).toBe(400)
  })
})
