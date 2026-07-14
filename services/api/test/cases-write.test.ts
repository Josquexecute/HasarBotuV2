import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AUTH_LOGIN_ROUTE,
  CASES_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  caseDetailResponseSchema,
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
const EMAIL = 'yazici@baran.example'
const YEAR = new Date().getFullYear()

describeDb('Cases yazma uclari (gercek veritabani)', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let cookie: string
  let orgId: string
  let userId: string
  let serviceId: string
  let expertId: string
  let insurerId: string
  let inactiveServiceId: string

  function createPayload(plate: string): Record<string, unknown> {
    return { caseType: 'casco', plate, notificationFormNumber: `F-${YEAR}-${plate.slice(-3)}` }
  }

  async function createCase(plate: string, key?: string): Promise<{ status: number; body: { case?: { id: string; officeCaseNumber: string; version: number } } & Record<string, unknown> }> {
    const response = await app.inject({
      method: 'POST',
      url: CASES_ROUTE,
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: key ?? uuidv7() },
      payload: createPayload(plate),
    })
    return { status: response.statusCode, body: response.json() }
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })

    orgId = uuidv7()
    userId = uuidv7()
    serviceId = uuidv7()
    expertId = uuidv7()
    insurerId = uuidv7()
    inactiveServiceId = uuidv7()
    await pool.query('INSERT INTO organizations (id, code, name) VALUES ($1, $2, $3)', [orgId, 'baran-global', 'Baran Global'])
    await pool.query(
      'INSERT INTO users (id, organization_id, email, display_name, password_hash) VALUES ($1, $2, $3, $4, $5)',
      [userId, orgId, EMAIL, 'Yazici', await hashPassword(PASSWORD)],
    )
    await pool.query(
      'INSERT INTO service_centers (id, organization_id, name, center_type) VALUES ($1, $2, $3, $4)',
      [serviceId, orgId, 'Merkez Servis', 'ozel'],
    )
    await pool.query(
      'INSERT INTO users (id, organization_id, email, display_name, password_hash) VALUES ($1, $2, $3, $4, $5)',
      [expertId, orgId, 'eksper@baran.example', 'Gerçek Eksper', await hashPassword(PASSWORD)],
    )
    await pool.query("INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code='expert'", [expertId])
    await pool.query('INSERT INTO insurers (id, organization_id, name) VALUES ($1, $2, $3)', [insurerId, orgId, 'Güven Sigorta'])
    await pool.query(
      'INSERT INTO service_centers (id, organization_id, name, center_type, is_active) VALUES ($1, $2, $3, $4, false)',
      [inactiveServiceId, orgId, 'Pasif Servis', 'ozel'],
    )

    app = buildApp({
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 1000, windowMs: 60_000 } },
    })
    const login = await app.inject({ method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email: EMAIL, password: PASSWORD } })
    const setCookie = login.headers['set-cookie']
    cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0] as string
  }, 60_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  it('olusturma: 201, sirali ofis numarasi, sema uyumu, audit kaydi', async () => {
    const first = await createCase('34 AAA 111')
    expect(first.status).toBe(201)
    expect(caseDetailResponseSchema.safeParse(first.body).success).toBe(true)
    expect(first.body.case?.officeCaseNumber).toBe(`${YEAR}/1`)
    expect(first.body.case?.version).toBe(1)

    const second = await createCase('34 AAA 222')
    expect(second.body.case?.officeCaseNumber).toBe(`${YEAR}/2`)

    const audit = await pool.query(
      "SELECT count(*)::int AS n FROM audit_events WHERE action = 'case.created' AND actor_user_id = $1",
      [userId],
    )
    expect((audit.rows[0] as { n: number }).n).toBe(2)
  })

  it('eksper ve LocalDate alanlarını create/read/update/audit akışında taşır', async () => {
    const created = await app.inject({
      method: 'POST',
      url: CASES_ROUTE,
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        caseType: 'traffic', plate: '34 P 180', responsibleUserId: userId, expertUserId: expertId,
        insurerId, serviceId, lossDate: '2026-07-10', notificationDate: '2026-07-11', followUpDate: '2026-07-20',
      },
    })
    expect(created.statusCode).toBe(201)
    const createdCase = caseDetailResponseSchema.parse(created.json()).case
    expect(createdCase).toMatchObject({ expertUserId: expertId, lossDate: '2026-07-10', notificationDate: '2026-07-11' })

    const updated = await app.inject({
      method: 'PATCH', url: `${CASES_ROUTE}/${createdCase.id}`, headers: { cookie },
      payload: { expectedVersion: 1, lossDate: '2026-07-12', notificationDate: '2026-07-13' },
    })
    expect(updated.statusCode).toBe(200)
    expect(caseDetailResponseSchema.parse(updated.json()).case).toMatchObject({ version: 2, lossDate: '2026-07-12', notificationDate: '2026-07-13' })
    const audits = await pool.query("SELECT action,details FROM audit_events WHERE resource_id=$1 ORDER BY occurred_at", [createdCase.id])
    expect(audits.rows).toEqual([
      expect.objectContaining({ action: 'case.created', details: expect.objectContaining({ assignedReferenceFields: ['responsibleUserId', 'expertUserId', 'serviceId', 'insurerId'], dateFieldsPresent: ['followUpDate', 'lossDate', 'notificationDate'] }) }),
      expect.objectContaining({ action: 'case.updated', details: expect.objectContaining({ changedFields: ['lossDate', 'notificationDate'], fromVersion: 1, toVersion: 2 }) }),
    ])
  })

  it('pasif referansı, expert rolü olmayan kullanıcıyı ve ters tarih sırasını alan bazlı reddeder', async () => {
    const attempts = [
      { field: 'serviceId', plate: '34 Z 181', payload: { serviceId: inactiveServiceId } },
      { field: 'expertUserId', plate: '34 Z 182', payload: { expertUserId: userId } },
      { field: 'notificationDate', plate: '34 Z 183', payload: { lossDate: '2026-07-14', notificationDate: '2026-07-13' } },
    ]
    for (const attempt of attempts) {
      const response = await app.inject({
        method: 'POST', url: CASES_ROUTE,
        headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
        payload: { caseType: 'casco', plate: attempt.plate, ...attempt.payload },
      })
      expect(response.statusCode).toBe(400)
      expect(response.json().error.fieldErrors[0].path).toBe(attempt.field)
    }
  })

  it('idempotent tekrar: ayni anahtar + ayni govde ayni yaniti dondurur, kopya olusturmaz', async () => {
    const key = uuidv7()
    const first = await createCase('34 BBB 333', key)
    const before = await pool.query('SELECT count(*)::int AS n FROM cases')
    const replay = await createCase('34 BBB 333', key)
    const after = await pool.query('SELECT count(*)::int AS n FROM cases')

    expect(replay.status).toBe(201)
    expect(replay.body.case?.id).toBe(first.body.case?.id)
    expect((after.rows[0] as { n: number }).n).toBe((before.rows[0] as { n: number }).n)
  })

  it('ayni anahtar farkli govde 409 idempotency_conflict doner', async () => {
    const key = uuidv7()
    await createCase('34 CCC 444', key)
    const conflict = await app.inject({
      method: 'POST',
      url: CASES_ROUTE,
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: key },
      payload: createPayload('34 CCC 555'),
    })
    expect(conflict.statusCode).toBe(409)
    expect((conflict.json() as { error: { code: string } }).error.code).toBe('idempotency_conflict')
  })

  it('Idempotency-Key basligi zorunludur', async () => {
    const response = await app.inject({
      method: 'POST',
      url: CASES_ROUTE,
      headers: { cookie },
      payload: createPayload('34 DDD 666'),
    })
    expect(response.statusCode).toBe(400)
    const body = response.json() as { error: { fieldErrors: { path: string }[] } }
    expect(body.error.fieldErrors[0]?.path).toBe(IDEMPOTENCY_KEY_HEADER)
  })

  it('es zamanli olusturmalar benzersiz ve ardisik ofis numaralari alir', async () => {
    const startCount = await pool.query('SELECT count(*)::int AS n FROM cases WHERE organization_id = $1', [orgId])
    const plates = ['06 EEE 100', '06 EEE 200', '06 EEE 300', '06 EEE 400', '06 EEE 500']
    const results = await Promise.all(plates.map((plate) => createCase(plate)))
    const numbers = results.map((r) => r.body.case?.officeCaseNumber).sort()
    expect(new Set(numbers).size).toBe(5)
    const total = await pool.query('SELECT count(*)::int AS n FROM cases WHERE organization_id = $1', [orgId])
    expect((total.rows[0] as { n: number }).n).toBe((startCount.rows[0] as { n: number }).n + 5)
    const max = await pool.query('SELECT last_sequence FROM office_counters WHERE organization_id = $1 AND office_year = $2', [orgId, YEAR])
    expect((max.rows[0] as { last_sequence: number }).last_sequence).toBe((total.rows[0] as { n: number }).n)
  })

  it('gecersiz referans 400 doner ve ofis numarasi TUKETILMEZ (transaction rollback)', async () => {
    const counterBefore = await pool.query(
      'SELECT last_sequence FROM office_counters WHERE organization_id = $1 AND office_year = $2',
      [orgId, YEAR],
    )
    const response = await app.inject({
      method: 'POST',
      url: CASES_ROUTE,
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { ...createPayload('34 FFF 777'), serviceId: uuidv7() },
    })
    expect(response.statusCode).toBe(400)
    const body = response.json() as { error: { fieldErrors: { path: string; code: string }[] } }
    expect(body.error.fieldErrors[0]).toMatchObject({ path: 'serviceId', code: 'unknown_reference' })

    const counterAfter = await pool.query(
      'SELECT last_sequence FROM office_counters WHERE organization_id = $1 AND office_year = $2',
      [orgId, YEAR],
    )
    expect(counterAfter.rows[0]).toEqual(counterBefore.rows[0])

    const next = await createCase('34 FFF 888')
    expect(next.status).toBe(201)
  })

  it('guncelleme: surum artar, alan temizlenebilir, audit degisen alan adlarini tasir', async () => {
    const created = await createCase('34 GGG 999')
    const caseId = created.body.case?.id as string

    const update = await app.inject({
      method: 'PATCH',
      url: `${CASES_ROUTE}/${caseId}`,
      headers: { cookie },
      payload: { expectedVersion: 1, workflowStage: 'reporting', followUpDate: '2026-08-01', serviceId },
    })
    expect(update.statusCode).toBe(200)
    const updated = update.json() as { case: { version: number; stage: string; followUpDate: string } }
    expect(caseDetailResponseSchema.safeParse(updated).success).toBe(true)
    expect(updated.case).toMatchObject({ version: 2, stage: 'reporting', followUpDate: '2026-08-01' })

    const clear = await app.inject({
      method: 'PATCH',
      url: `${CASES_ROUTE}/${caseId}`,
      headers: { cookie },
      payload: { expectedVersion: 2, followUpDate: null },
    })
    expect((clear.json() as { case: { followUpDate: string | null; version: number } }).case).toMatchObject({
      followUpDate: null,
      version: 3,
    })

    const audit = await pool.query(
      "SELECT details FROM audit_events WHERE action = 'case.updated' AND resource_id = $1 ORDER BY occurred_at",
      [caseId],
    )
    expect((audit.rows[0] as { details: { changedFields: string[] } }).details.changedFields).toEqual(
      expect.arrayContaining(['workflowStage', 'followUpDate', 'serviceId']),
    )
  })

  it('bayat surum 409 version_conflict doner ve veri EZILMEZ', async () => {
    const created = await createCase('34 HHH 111')
    const caseId = created.body.case?.id as string
    await app.inject({
      method: 'PATCH',
      url: `${CASES_ROUTE}/${caseId}`,
      headers: { cookie },
      payload: { expectedVersion: 1, workflowStage: 'reporting' },
    })

    const stale = await app.inject({
      method: 'PATCH',
      url: `${CASES_ROUTE}/${caseId}`,
      headers: { cookie },
      payload: { expectedVersion: 1, workflowStage: 'under_repair' },
    })
    expect(stale.statusCode).toBe(409)
    expect((stale.json() as { error: { code: string } }).error.code).toBe('version_conflict')

    const row = await pool.query('SELECT workflow_stage, version FROM cases WHERE id = $1', [caseId])
    expect(row.rows[0]).toMatchObject({ workflow_stage: 'reporting', version: 2 })
  })

  it('sinirlar: bos guncelleme 400; baska org dosyasi 404; oturumsuz 401; plaka/tur degistirilemez (strict)', async () => {
    const created = await createCase('34 JJJ 222')
    const caseId = created.body.case?.id as string

    const empty = await app.inject({
      method: 'PATCH',
      url: `${CASES_ROUTE}/${caseId}`,
      headers: { cookie },
      payload: { expectedVersion: 1 },
    })
    expect(empty.statusCode).toBe(400)

    const immutable = await app.inject({
      method: 'PATCH',
      url: `${CASES_ROUTE}/${caseId}`,
      headers: { cookie },
      payload: { expectedVersion: 1, plate: '99 ZZZ 999' },
    })
    expect(immutable.statusCode).toBe(400)

    const otherOrg = uuidv7()
    await pool.query('INSERT INTO organizations (id, code, name) VALUES ($1, $2, $3)', [otherOrg, 'baska', 'Baska'])
    const foreign = uuidv7()
    await pool.query(
      `INSERT INTO cases (id, organization_id, office_year, office_sequence, office_number, case_type, workflow_stage, plate, plate_normalized)
       VALUES ($1, $2, $3, 1, $4, 'traffic', 'reporting', '35 K 1', '35K1')`,
      [foreign, otherOrg, YEAR, `${YEAR}/1`],
    )
    const cross = await app.inject({
      method: 'PATCH',
      url: `${CASES_ROUTE}/${foreign}`,
      headers: { cookie },
      payload: { expectedVersion: 1, workflowStage: 'reporting' },
    })
    expect(cross.statusCode).toBe(404)

    const anonymous = await app.inject({
      method: 'POST',
      url: CASES_ROUTE,
      headers: { [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: createPayload('34 KKK 333'),
    })
    expect(anonymous.statusCode).toBe(401)
  })
})
