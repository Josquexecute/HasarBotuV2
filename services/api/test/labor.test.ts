import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AUTH_LOGIN_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  laborSheetResponseSchema,
  laborSheetWorkspaceResponseSchema,
} from '@hasarbotu/contracts'
import {
  assertTestDatabaseUrl,
  closeDatabasePool,
  createDatabasePool,
  runMigrations,
  uuidv7,
  type DatabaseConfig,
} from '@hasarbotu/database'
import { buildApp, fixedClock, hashPassword } from '../src/index.js'

const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'p43-sentetik-guclu-parola-43'

describeDb('Paket 43 İşçilik çekirdeği gerçek API', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let organizationId: string
  let foreignOrganizationId: string
  let managerUserId: string
  let caseId: string
  let closedCaseId: string
  let foreignCaseId: string
  let managerCookie: string
  let readOnlyCookie: string

  const sheetUrl = (targetCaseId = caseId) => `/api/v1/cases/${targetCaseId}/labor-sheet`
  const versionsUrl = (targetCaseId = caseId) => `${sheetUrl(targetCaseId)}/versions`
  const item = (over: Record<string, unknown> = {}) => ({
    description: 'Ön tampon kaplama',
    action: 'Değişim',
    partAmountMinor: 18_400_00,
    laborAmountMinor: 2_200_00,
    ...over,
  })

  async function login(email: string): Promise<string> {
    const response = await app.inject({ method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email, password: PASSWORD } })
    expect(response.statusCode).toBe(200)
    return String(response.headers['set-cookie']).split(';')[0] as string
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })

    organizationId = uuidv7()
    foreignOrganizationId = uuidv7()
    managerUserId = uuidv7()
    const readOnlyUserId = uuidv7()
    const foreignUserId = uuidv7()
    caseId = uuidv7()
    closedCaseId = uuidv7()
    foreignCaseId = uuidv7()
    const passwordHash = await hashPassword(PASSWORD)
    await pool.query(
      `INSERT INTO organizations (id,code,name)
       VALUES ($1,'p43-main','P43 Sentetik'),($2,'p43-foreign','P43 Yabancı')`,
      [organizationId, foreignOrganizationId],
    )
    await pool.query(
      `INSERT INTO users (id,organization_id,email,display_name,password_hash)
       VALUES ($1,$4,'p43-manager@test.local','P43 Dosya Sorumlusu',$6),
              ($2,$4,'p43-readonly@test.local','P43 Salt Okunur',$6),
              ($3,$5,'p43-foreign@test.local','P43 Yabancı',$6)`,
      [managerUserId, readOnlyUserId, foreignUserId, organizationId, foreignOrganizationId, passwordHash],
    )
    await pool.query(
      `INSERT INTO user_roles (user_id,role_id)
       SELECT $1::uuid,id FROM roles WHERE code='case_manager'
       UNION ALL SELECT $2::uuid,id FROM roles WHERE code='read_only'`,
      [managerUserId, readOnlyUserId],
    )
    await pool.query(
      `INSERT INTO cases
         (id,organization_id,office_year,office_sequence,office_number,case_type,
          lifecycle_status,workflow_stage,plate,plate_normalized,responsible_user_id,notification_date,version)
       VALUES
       ($1,$4,2026,4301,'2026/4301','traffic','open','reporting','34 P 4301','34P4301',$5,'2026-07-17',3),
       ($2,$4,2026,4302,'2026/4302','traffic','closed','closed','34 P 4302','34P4302',$5,'2026-07-17',1),
       ($3,$6,2026,4303,'2026/4303','traffic','open','reporting','35 P 4303','35P4303',$7,'2026-07-17',1)`,
      [caseId, closedCaseId, foreignCaseId, organizationId, managerUserId, foreignOrganizationId, foreignUserId],
    )

    app = buildApp({
      clock: fixedClock('2026-07-17T10:30:00.000Z'),
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 100, windowMs: 60_000 } },
    })
    managerCookie = await login('p43-manager@test.local')
    readOnlyCookie = await login('p43-readonly@test.local')
  }, 90_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  it('401, tenant 404, salt-okunur ve boş föy sınırlarını uygular', async () => {
    expect((await app.inject({ method: 'GET', url: sheetUrl() })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: sheetUrl(foreignCaseId), headers: { cookie: managerCookie } })).statusCode).toBe(404)
    const readOnly = await app.inject({ method: 'GET', url: sheetUrl(), headers: { cookie: readOnlyCookie } })
    expect(readOnly.statusCode).toBe(200)
    const workspace = laborSheetWorkspaceResponseSchema.parse(readOnly.json())
    expect(workspace.sheet).toBeNull()
    expect(workspace.permissions.canWrite).toBe(false)
    expect(workspace.caseVersion).toBe(3)
    const write = await app.inject({
      method: 'POST', url: sheetUrl(),
      headers: { cookie: readOnlyCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedCaseVersion: 3, items: [item()], confirmed: true },
    })
    expect(write.statusCode).toBe(403)
  })

  it('föyü oluşturur, sürüm 1 immutable kaydeder, toplamı hesaplar ve idempotent replay yapar', async () => {
    const key = uuidv7()
    const payload = {
      expectedCaseVersion: 3,
      items: [item(), item({ description: 'Sol ön çamurluk', action: 'Onarım + boya', partAmountMinor: 0, laborAmountMinor: 6_750_00 })],
      confirmed: true,
    }
    const created = await app.inject({
      method: 'POST', url: sheetUrl(),
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: key },
      payload,
    })
    expect(created.statusCode).toBe(201)
    const sheet = laborSheetResponseSchema.parse(created.json()).sheet
    expect(sheet.version).toBe(1)
    expect(sheet.currentVersion.sheetVersion).toBe(1)
    expect(sheet.currentVersion.sourceType).toBe('user_entered')
    expect(sheet.currentVersion.items).toHaveLength(2)
    expect(sheet.currentVersion.totals).toEqual({
      partTotalMinor: 18_400_00,
      laborTotalMinor: 8_950_00,
      grandTotalMinor: 27_350_00,
    })

    // idempotent replay: aynı anahtar aynı yanıt, ikinci föy oluşmaz
    const replay = await app.inject({
      method: 'POST', url: sheetUrl(),
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: key },
      payload,
    })
    expect(replay.statusCode).toBe(201)
    expect(laborSheetResponseSchema.parse(replay.json()).sheet.id).toBe(sheet.id)
    expect((await pool.query('SELECT count(*)::int AS n FROM labor_sheets WHERE case_id=$1', [caseId])).rows).toEqual([{ n: 1 }])
  })

  it('mevcut föy varken ikinci oluşturmayı reddeder (409)', async () => {
    const response = await app.inject({
      method: 'POST', url: sheetUrl(),
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedCaseVersion: 3, items: [item()], confirmed: true },
    })
    expect(response.statusCode).toBe(409)
  })

  it('sürüm ekler, eski sürümü korur ve version conflict uygular', async () => {
    const stale = await app.inject({
      method: 'POST', url: versionsUrl(),
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedVersion: 99, items: [item()], reason: 'Yanlış sürüm', confirmed: true },
    })
    expect(stale.statusCode).toBe(409)

    const revised = await app.inject({
      method: 'POST', url: versionsUrl(),
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        expectedVersion: 1,
        items: [item({ partAmountMinor: 20_000_00, laborAmountMinor: 3_000_00 })],
        reason: 'Parça bedeli güncellendi',
        confirmed: true,
      },
    })
    expect(revised.statusCode).toBe(200)
    const sheet = laborSheetResponseSchema.parse(revised.json()).sheet
    expect(sheet.version).toBe(2)
    expect(sheet.currentVersion.sheetVersion).toBe(2)
    expect(sheet.currentVersion.sourceType).toBe('manual_revision')
    expect(sheet.currentVersion.revisionReason).toBe('Parça bedeli güncellendi')
    expect(sheet.currentVersion.previousVersionId).not.toBeNull()
    // Eski sürüm 1 immutable korunur
    expect(sheet.versions).toHaveLength(2)
    const v1 = sheet.versions.find((version) => version.sheetVersion === 1)
    expect(v1?.totals.grandTotalMinor).toBe(27_350_00)
  })

  it('geçersiz satırı (her iki tutar sıfır) alan hatasıyla reddeder', async () => {
    const response = await app.inject({
      method: 'POST', url: versionsUrl(),
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        expectedVersion: 2,
        items: [item({ partAmountMinor: 0, laborAmountMinor: 0 })],
        reason: 'Geçersiz satır',
        confirmed: true,
      },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json().error.fieldErrors[0].code).toBe('amount_required')
  })

  it('kapalı case föyünü değiştirmeyi reddeder', async () => {
    const response = await app.inject({
      method: 'POST', url: sheetUrl(closedCaseId),
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedCaseVersion: 1, items: [item()], confirmed: true },
    })
    expect(response.statusCode).toBe(409)
  })

  it('audit yalnız güvenli sayı/toplam metadata taşır; satır metnini sızdırmaz', async () => {
    const audits = (await pool.query(
      "SELECT action,details FROM audit_events WHERE organization_id=$1 AND action LIKE 'labor_sheet.%' ORDER BY occurred_at",
      [organizationId],
    )).rows as { action: string; details: unknown }[]
    expect(audits.map((row) => row.action)).toEqual(['labor_sheet.created', 'labor_sheet.revised'])
    const text = JSON.stringify(audits)
    expect(text).not.toContain('Ön tampon')
    expect(text).not.toContain('Değişim')
    expect(text).not.toContain('çamurluk')
    expect(audits[0].details).toMatchObject({ itemCount: 2, grandTotalMinor: 27_350_00, sourceType: 'user_entered' })
  })
})
