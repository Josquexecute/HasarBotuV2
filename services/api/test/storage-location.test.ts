import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AUTH_LOGIN_ROUTE,
  CASES_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  STORAGE_ROOTS_ROUTE,
  caseLocationHistoryResponseSchema,
  caseLocationResponseSchema,
  storageRootsResponseSchema,
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

const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe

const PASSWORD = 'cok-guclu-parola-42'
const VALID_PATH = '2026/Temmuz 2026/34ABC123/EVRAK/ruhsat__docv_01.pdf'

describeDb('Depolama referansı ve vaka konumu (gerçek veritabanı)', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let orgA: string
  let orgB: string
  let cookieA: string
  let cookieB: string
  let caseAId: string
  let caseBId: string

  async function seedUser(orgId: string, email: string): Promise<string> {
    const id = uuidv7()
    await pool.query(
      'INSERT INTO users (id, organization_id, email, display_name, password_hash) VALUES ($1,$2,$3,$4,$5)',
      [id, orgId, email, email.split('@')[0], await hashPassword(PASSWORD)],
    )
    await pool.query(
      "INSERT INTO user_roles (user_id, role_id) VALUES ($1, (SELECT id FROM roles WHERE code = 'case_manager'))",
      [id],
    )
    return id
  }
  async function loginCookie(email: string): Promise<string> {
    const res = await app.inject({ method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email, password: PASSWORD } })
    const c = res.headers['set-cookie']
    return String(Array.isArray(c) ? c[0] : c).split(';')[0] as string
  }
  async function createCase(cookie: string, plate: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: CASES_ROUTE,
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { caseType: 'traffic', plate },
    })
    return (res.json() as { case: { id: string } }).case.id
  }
  function locationRoute(caseId: string): string {
    return `/api/v1/cases/${caseId}/location`
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })

    orgA = uuidv7()
    orgB = uuidv7()
    await pool.query('INSERT INTO organizations (id, code, name) VALUES ($1,$2,$3)', [orgA, 'org-a', 'Org A'])
    await pool.query('INSERT INTO organizations (id, code, name) VALUES ($1,$2,$3)', [orgB, 'org-b', 'Org B'])
    await seedUser(orgA, 'a@a.example')
    await seedUser(orgB, 'b@b.example')
    // Kökler: A'da iki aktif + bir pasif; B'de bir aktif.
    for (const [org, key, active] of [
      [orgA, 'baran-primary', true],
      [orgA, 'baran-archive', true],
      [orgA, 'old-root', false],
      [orgB, 'other-primary', true],
    ] as [string, string, boolean][]) {
      await pool.query('INSERT INTO storage_roots (id, organization_id, root_key, label, is_active) VALUES ($1,$2,$3,$4,$5)', [
        uuidv7(),
        org,
        key,
        key,
        active,
      ])
    }

    app = buildApp({
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 1000, windowMs: 60_000 } },
    })
    cookieA = await loginCookie('a@a.example')
    cookieB = await loginCookie('b@b.example')
    caseAId = await createCase(cookieA, '34 ABC 123')
    caseBId = await createCase(cookieB, '06 XYZ 789')
  }, 60_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  it('GET /storage-roots kiracı köklerini döner (yabancı org kökü görünmez)', async () => {
    const res = await app.inject({ method: 'GET', url: STORAGE_ROOTS_ROUTE, headers: { cookie: cookieA } })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(storageRootsResponseSchema.safeParse(body).success).toBe(true)
    const keys = (body as { items: { rootKey: string }[] }).items.map((r) => r.rootKey)
    expect(keys).toEqual(['baran-archive', 'baran-primary', 'old-root'])
    expect(keys).not.toContain('other-primary')
  })

  it('atama öncesi GET konum 404 döner', async () => {
    const res = await app.inject({ method: 'GET', url: locationRoute(caseAId), headers: { cookie: cookieA } })
    expect(res.statusCode).toBe(404)
  })

  it('PUT ilk atama: 200, version 1, pending, geçmiş + audit üretir; mutlak yol sızmaz', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: locationRoute(caseAId),
      headers: { cookie: cookieA },
      payload: { storageRootKey: 'baran-primary', relativePath: VALID_PATH },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(caseLocationResponseSchema.safeParse(body).success).toBe(true)
    expect((body as { location: Record<string, unknown> }).location).toMatchObject({
      caseId: caseAId,
      storageRootKey: 'baran-primary',
      relativePath: VALID_PATH,
      verificationStatus: 'pending',
      source: 'manual',
      version: 1,
    })

    const audit = await pool.query(
      "SELECT details FROM audit_events WHERE action = 'case.location_assigned' AND resource_id = $1",
      [caseAId],
    )
    expect((audit.rows[0] as { details: { relativePath: string } }).details.relativePath).toBe(VALID_PATH)

    const history = await pool.query(
      'SELECT count(*)::int AS n FROM case_location_history WHERE case_id::text = $1',
      [caseAId],
    )
    expect((history.rows[0] as { n: number }).n).toBe(1)

    // Güvenlik: hiçbir audit details mutlak yol (sürücü/backslash) taşımaz.
    const leak = await pool.query(
      "SELECT count(*)::int AS n FROM audit_events WHERE details::text ~ '[A-Za-z]:' OR strpos(details::text, chr(92)) > 0",
    )
    expect((leak.rows[0] as { n: number }).n).toBe(0)
  })

  it('PUT değiştirme: doğru expectedVersion ile version artar, previous yol geçmişe geçer', async () => {
    const newPath = '2026/Temmuz 2026/34ABC123/HASAR/hasar_001__photo_01.jpg'
    const res = await app.inject({
      method: 'PUT',
      url: locationRoute(caseAId),
      headers: { cookie: cookieA },
      payload: { storageRootKey: 'baran-archive', relativePath: newPath, expectedVersion: 1 },
    })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { location: { version: number; relativePath: string } }).location).toMatchObject({
      version: 2,
      relativePath: newPath,
    })

    const updated = await pool.query(
      "SELECT details FROM audit_events WHERE action = 'case.location_updated' AND resource_id = $1",
      [caseAId],
    )
    expect((updated.rows[0] as { details: { toVersion: number } }).details.toVersion).toBe(2)

    const prev = await pool.query(
      'SELECT previous_relative_path FROM case_location_history WHERE case_id::text = $1 ORDER BY occurred_at DESC LIMIT 1',
      [caseAId],
    )
    expect((prev.rows[0] as { previous_relative_path: string }).previous_relative_path).toBe(VALID_PATH)
  })

  it('PUT bayat expectedVersion: 409 version_conflict, veri EZİLMEZ', async () => {
    const before = await pool.query('SELECT relative_path, version FROM case_locations WHERE case_id::text = $1', [caseAId])
    const res = await app.inject({
      method: 'PUT',
      url: locationRoute(caseAId),
      headers: { cookie: cookieA },
      payload: { storageRootKey: 'baran-primary', relativePath: 'EVRAK/x.pdf', expectedVersion: 1 },
    })
    expect(res.statusCode).toBe(409)
    expect((res.json() as { error: { code: string } }).error.code).toBe('version_conflict')
    const after = await pool.query('SELECT relative_path, version FROM case_locations WHERE case_id::text = $1', [caseAId])
    expect(after.rows[0]).toEqual(before.rows[0])
  })

  it('güvenlik: traversal/mutlak/sürücü/UNC yol 400 ile reddedilir (şema doğrulaması)', async () => {
    const bad = ['../escape', '/etc/passwd', 'C:/Windows/x', 'a\\b', 'dir/con', 'a/../b']
    for (const relativePath of bad) {
      const res = await app.inject({
        method: 'PUT',
        url: locationRoute(caseBId),
        headers: { cookie: cookieB },
        payload: { storageRootKey: 'other-primary', relativePath },
      })
      expect(res.statusCode, `path ${relativePath}`).toBe(400)
    }
  })

  it('bilinmeyen/pasif kök 400 unknown_reference; ilk atamada expectedVersion 409', async () => {
    const unknown = await app.inject({
      method: 'PUT',
      url: locationRoute(caseBId),
      headers: { cookie: cookieB },
      payload: { storageRootKey: 'nonexistent-root', relativePath: 'EVRAK/x.pdf' },
    })
    expect(unknown.statusCode).toBe(400)
    expect((unknown.json() as { error: { fieldErrors: { code: string }[] } }).error.fieldErrors[0]?.code).toBe(
      'unknown_reference',
    )

    const withVersion = await app.inject({
      method: 'PUT',
      url: locationRoute(caseBId),
      headers: { cookie: cookieB },
      payload: { storageRootKey: 'other-primary', relativePath: 'EVRAK/x.pdf', expectedVersion: 1 },
    })
    expect(withVersion.statusCode).toBe(409)
  })

  it('kiracı izolasyonu: A kullanıcısı B dosyasının konumunu ne okur ne yazar (404)', async () => {
    const read = await app.inject({ method: 'GET', url: locationRoute(caseBId), headers: { cookie: cookieA } })
    expect(read.statusCode).toBe(404)
    const write = await app.inject({
      method: 'PUT',
      url: locationRoute(caseBId),
      headers: { cookie: cookieA },
      payload: { storageRootKey: 'baran-primary', relativePath: 'EVRAK/x.pdf' },
    })
    expect(write.statusCode).toBe(404)
  })

  it('GET konum geçmişi sayfalı döner (en yeni önce)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/cases/${caseAId}/location/history?pageSize=1&page=1`,
      headers: { cookie: cookieA },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(caseLocationHistoryResponseSchema.safeParse(body).success).toBe(true)
    const parsed = body as { items: { relativePath: string }[]; pageInfo: { totalItems: number } }
    expect(parsed.items.length).toBe(1)
    expect(parsed.pageInfo.totalItems).toBeGreaterThanOrEqual(2)
  })

  it('oturumsuz erişim 401', async () => {
    expect((await app.inject({ method: 'GET', url: STORAGE_ROOTS_ROUTE })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: locationRoute(caseAId) })).statusCode).toBe(401)
  })

  it('DB savunması: case_locations traversal/mutlak yol doğrudan INSERT ile reddedilir', async () => {
    for (const badPath of ['../escape', 'C:/x', `a${String.fromCharCode(92)}b`]) {
      await expect(
        pool.query(
          `INSERT INTO case_locations (id, organization_id, case_id, storage_root_key, relative_path)
           VALUES ($1,$2,$3,'baran-primary',$4)`,
          [uuidv7(), orgA, caseAId, badPath],
        ),
      ).rejects.toThrow()
    }
  })

  it('DB savunması: case_location_history append-only (UPDATE/DELETE reddedilir)', async () => {
    const row = await pool.query('SELECT id FROM case_location_history WHERE case_id::text = $1 LIMIT 1', [caseAId])
    const id = (row.rows[0] as { id: string }).id
    await expect(pool.query("UPDATE case_location_history SET source = 'system' WHERE id = $1", [id])).rejects.toThrow(
      /append-only/,
    )
    await expect(pool.query('DELETE FROM case_location_history WHERE id = $1', [id])).rejects.toThrow(/append-only/)
  })
})
