import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AUTH_LOGIN_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  laborAllocationApplyResponseSchema,
  laborAllocationRunResponseSchema,
} from '@hasarbotu/contracts'
import {
  assertTestDatabaseUrl,
  closeDatabasePool,
  createDatabasePool,
  runMigrations,
  uuidv7,
  type DatabaseConfig,
} from '@hasarbotu/database'
import { waitForRunTerminal } from './helpers/labor-allocation-run.js'
import {
  buildApp,
  createDeterministicLaborAllocationProviderRegistry,
  fixedClock,
  hashPassword,
} from '../src/index.js'

/**
 * Paket 58 — onaylı AI dağıtımının föye uygulanması.
 *
 * Ana iddialar: atomiklik, çift uygulama koruması, idempotency, kısmi seçim,
 * kullanıcı değişikliğinin ayrı snapshot'lanması ve onaylı geçmişin YALNIZ
 * tamamlanmış provenance'tan beslenmesi.
 */
const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'p58-sentetik-guclu-parola-58'
const NOW = '2026-07-19T12:00:00.000Z'
const SECRET_ITEM = 'GIZLI-PARCA-ACIKLAMASI-58'

describeDb('Paket 58 AI dağıtımının uygulanması', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let organizationId: string
  let foreignOrganizationId: string
  let userId: string
  let foreignUserId: string
  let cookie: string
  let foreignCookie: string

  async function login(email: string): Promise<string> {
    const response = await app.inject({
      method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email, password: PASSWORD },
    })
    expect(response.statusCode).toBe(200)
    return String(response.headers['set-cookie']).split(';')[0] as string
  }

  async function makeCase(organization: string, owner: string, sequence: number): Promise<string> {
    const caseId = uuidv7()
    await pool.query(
      `INSERT INTO cases
         (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
          workflow_stage,plate,plate_normalized,responsible_user_id,notification_date,version)
       VALUES ($1,$2,2026,$3,$4,'traffic','open','reporting',$5,$6,$7,'2026-07-01',1)`,
      [
        caseId, organization, sequence, `2026/${sequence}`,
        `34 PS ${sequence}`, `34PS${sequence}`, owner,
      ],
    )
    return caseId
  }

  async function createSheet(sessionCookie: string, caseId: string, items: Record<string, unknown>[]) {
    return app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/labor-sheet`,
      headers: { cookie: sessionCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedCaseVersion: 1, items, confirmed: true },
    })
  }

  async function analyze(sessionCookie: string, caseId: string, sheetVersion: number) {
    const response = await waitForRunTerminal(app, sessionCookie, caseId, await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/labor-allocation-ai/analyze`,
      headers: { cookie: sessionCookie },
      payload: {
        expectedSheetVersion: sheetVersion,
        damageDescription: 'Ön sol darbe.',
        confirmedEgress: false,
      },
    }))
    expect(response.statusCode).toBe(200)
    return laborAllocationRunResponseSchema.parse(response.json()).run
  }

  async function apply(
    sessionCookie: string,
    caseId: string,
    runId: string,
    payload: Record<string, unknown>,
    key = uuidv7(),
  ) {
    return app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/labor-allocation-ai/${runId}/apply`,
      headers: { cookie: sessionCookie, [IDEMPOTENCY_KEY_HEADER]: key },
      payload,
    })
  }

  const line = (ordinal: number, part: number, labor: number) => ({
    lineOrdinal: ordinal,
    description: ordinal === 1 ? 'Ön tampon' : SECRET_ITEM,
    action: 'Değişim',
    partAmountMinor: part,
    laborAmountMinor: labor,
  })

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })

    organizationId = uuidv7()
    foreignOrganizationId = uuidv7()
    userId = uuidv7()
    foreignUserId = uuidv7()
    const passwordHash = await hashPassword(PASSWORD)
    await pool.query(
      `INSERT INTO organizations (id,code,name)
       VALUES ($1,'p58-main','P58 Sentetik'),($2,'p58-foreign','P58 Yabancı')`,
      [organizationId, foreignOrganizationId],
    )
    await pool.query(
      `INSERT INTO users (id,organization_id,email,display_name,password_hash)
       VALUES ($1,$3,'p58-manager@test.local','P58 Sorumlu',$5),
              ($2,$4,'p58-foreign@test.local','P58 Yabancı',$5)`,
      [userId, foreignUserId, organizationId, foreignOrganizationId, passwordHash],
    )
    await pool.query(
      `INSERT INTO user_roles (user_id,role_id)
       SELECT $1::uuid,id FROM roles WHERE code='case_manager'
       UNION ALL SELECT $2::uuid,id FROM roles WHERE code='case_manager'`,
      [userId, foreignUserId],
    )
    await pool.query(
      `INSERT INTO ai_provider_policies
         (id,organization_id,labor_allocation_enabled,labor_allocation_allowed_provider_ids,
          monthly_budget_minor,per_request_budget_minor)
       VALUES ($1,$2,true,ARRAY['deterministic-success']::text[],10000000,10000000),
              ($3,$4,true,ARRAY['deterministic-success']::text[],10000000,10000000)`,
      [uuidv7(), organizationId, uuidv7(), foreignOrganizationId],
    )

    app = buildApp({
      clock: fixedClock(NOW),
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 500, windowMs: 60_000 } },
      laborAllocationProviders: createDeterministicLaborAllocationProviderRegistry(),
      laborAllocationProviderId: 'deterministic-success',
    })
    await app.ready()
    cookie = await login('p58-manager@test.local')
    foreignCookie = await login('p58-foreign@test.local')
  })

  afterAll(async () => {
    await app?.close()
    await closeDatabasePool(pool)
  })

  it('seçilen satırları tek transaction içinde uygular ve provenance yazar', async () => {
    const caseId = await makeCase(organizationId, userId, 5801)
    expect((await createSheet(cookie, caseId, [
      { description: 'Ön tampon', action: 'Değişim', partAmountMinor: 900_000, laborAmountMinor: 100_000 },
      { description: SECRET_ITEM, action: 'Değişim', partAmountMinor: 400_000, laborAmountMinor: 60_000 },
    ])).statusCode).toBe(201)
    const run = await analyze(cookie, caseId, 1)

    const response = await apply(cookie, caseId, run.id, {
      expectedSheetVersion: 1,
      reason: 'AI dağıtımı incelendi ve onaylandı',
      confirmed: true,
      lines: [line(1, 900_000, 100_000)],
    })
    expect(response.statusCode).toBe(200)
    const body = laborAllocationApplyResponseSchema.parse(response.json())

    expect(body.application.status).toBe('completed')
    expect(body.application.sourceSheetVersion).toBe(1)
    expect(body.application.targetSheetVersion).toBe(2)
    expect(body.application.selectedLineCount).toBe(1)
    // Seçilmeyen satır reddedilmiş sayılır ama föyden düşmez.
    expect(body.application.rejectedLineCount).toBe(1)
    expect(body.sheet.version).toBe(2)
    expect(body.sheet.currentVersion.items).toHaveLength(2)
    expect(body.sheet.currentVersion.sourceType).toBe('ai_allocation_applied')

    const version = await pool.query(
      `SELECT source_type FROM labor_sheet_versions
        WHERE organization_id=$1 AND case_id=$2 AND sheet_version=2`,
      [organizationId, caseId],
    )
    expect(version.rows[0].source_type).toBe('ai_allocation_applied')
  })

  it('kullanıcı değişikliğini ayrı snapshot olarak saklar', async () => {
    const caseId = await makeCase(organizationId, userId, 5802)
    expect((await createSheet(cookie, caseId, [
      { description: 'Ön tampon', action: 'Değişim', partAmountMinor: 900_000, laborAmountMinor: 100_000 },
    ])).statusCode).toBe(201)
    const run = await analyze(cookie, caseId, 1)

    const response = await apply(cookie, caseId, run.id, {
      expectedSheetVersion: 1,
      reason: 'Tutar eksper tarafından düzeltildi',
      confirmed: true,
      lines: [line(1, 700_000, 300_000)],
    })
    expect(response.statusCode).toBe(200)
    const body = laborAllocationApplyResponseSchema.parse(response.json())
    expect(body.application.modifiedLineCount).toBe(1)
    const applied = body.application.lines[0]
    // Önerilen ve uygulanan değerler AYRI saklanır.
    expect(applied?.suggestedPartAmountMinor).toBe(900_000)
    expect(applied?.appliedPartAmountMinor).toBe(700_000)
    expect(applied?.modified).toBe(true)
    expect(applied?.suggestedOperationTypes.length).toBeGreaterThan(0)
    // Föye yazılan değer kullanıcının değeridir.
    expect(body.sheet.currentVersion.items[0]?.partAmountMinor).toBe(700_000)
  })

  it('aynı run ikinci kez uygulanamaz', async () => {
    const caseId = await makeCase(organizationId, userId, 5803)
    expect((await createSheet(cookie, caseId, [
      { description: 'Ön tampon', action: 'Değişim', partAmountMinor: 900_000, laborAmountMinor: 100_000 },
    ])).statusCode).toBe(201)
    const run = await analyze(cookie, caseId, 1)

    expect((await apply(cookie, caseId, run.id, {
      expectedSheetVersion: 1, reason: 'İlk uygulama', confirmed: true, lines: [line(1, 900_000, 100_000)],
    })).statusCode).toBe(200)

    // İkinci deneme farklı anahtarla gelse de reddedilir.
    const second = await apply(cookie, caseId, run.id, {
      expectedSheetVersion: 2, reason: 'İkinci uygulama', confirmed: true, lines: [line(1, 900_000, 100_000)],
    })
    expect(second.statusCode).toBe(409)

    const count = await pool.query(
      "SELECT count(*)::int AS n FROM labor_allocation_applications WHERE run_id=$1 AND status='completed'",
      [run.id],
    )
    expect(count.rows[0].n).toBe(1)
  })

  it('aynı idempotency anahtarı aynı sonucu döner ve ikinci sürüm üretmez', async () => {
    const caseId = await makeCase(organizationId, userId, 5804)
    expect((await createSheet(cookie, caseId, [
      { description: 'Ön tampon', action: 'Değişim', partAmountMinor: 900_000, laborAmountMinor: 100_000 },
    ])).statusCode).toBe(201)
    const run = await analyze(cookie, caseId, 1)
    const key = uuidv7()
    const payload = {
      expectedSheetVersion: 1, reason: 'Idempotent uygulama', confirmed: true,
      lines: [line(1, 900_000, 100_000)],
    }

    const first = await apply(cookie, caseId, run.id, payload, key)
    const second = await apply(cookie, caseId, run.id, payload, key)
    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(200)
    const firstBody = laborAllocationApplyResponseSchema.parse(first.json())
    const secondBody = laborAllocationApplyResponseSchema.parse(second.json())
    expect(secondBody.application.id).toBe(firstBody.application.id)

    const versions = await pool.query(
      'SELECT count(*)::int AS n FROM labor_sheet_versions WHERE organization_id=$1 AND case_id=$2',
      [organizationId, caseId],
    )
    expect(versions.rows[0].n).toBe(2)
  })

  it('stale kaynak föy sürümünde uygulama bloklanır ve hiçbir kayıt oluşmaz', async () => {
    const caseId = await makeCase(organizationId, userId, 5805)
    expect((await createSheet(cookie, caseId, [
      { description: 'Ön tampon', action: 'Değişim', partAmountMinor: 900_000, laborAmountMinor: 100_000 },
    ])).statusCode).toBe(201)
    const run = await analyze(cookie, caseId, 1)

    const response = await apply(cookie, caseId, run.id, {
      expectedSheetVersion: 2, reason: 'Stale deneme', confirmed: true, lines: [line(1, 900_000, 100_000)],
    })
    expect(response.statusCode).toBe(409)

    const applications = await pool.query(
      'SELECT count(*)::int AS n FROM labor_allocation_applications WHERE run_id=$1',
      [run.id],
    )
    expect(applications.rows[0].n).toBe(0)
    const versions = await pool.query(
      'SELECT count(*)::int AS n FROM labor_sheet_versions WHERE organization_id=$1 AND case_id=$2',
      [organizationId, caseId],
    )
    expect(versions.rows[0].n).toBe(1)
  })

  it('geçersiz satır uygulamasında hiçbir kayıt kalmaz (atomiklik)', async () => {
    const caseId = await makeCase(organizationId, userId, 5806)
    expect((await createSheet(cookie, caseId, [
      { description: 'Ön tampon', action: 'Değişim', partAmountMinor: 900_000, laborAmountMinor: 100_000 },
    ])).statusCode).toBe(201)
    const run = await analyze(cookie, caseId, 1)

    // Run'da olmayan satır: doğrulama uygulama kaydı yazıldıktan SONRA değil,
    // transaction içinde reddedilir; geriye hiçbir şey kalmaz.
    const response = await apply(cookie, caseId, run.id, {
      expectedSheetVersion: 1, reason: 'Geçersiz satır', confirmed: true, lines: [line(9, 1, 1)],
    })
    expect(response.statusCode).toBe(400)

    const applications = await pool.query(
      'SELECT count(*)::int AS n FROM labor_allocation_applications WHERE run_id=$1',
      [run.id],
    )
    expect(applications.rows[0].n).toBe(0)
    const versions = await pool.query(
      'SELECT count(*)::int AS n FROM labor_sheet_versions WHERE organization_id=$1 AND case_id=$2',
      [organizationId, caseId],
    )
    expect(versions.rows[0].n).toBe(1)
  })

  it('yabancı organization başka dosyanın run\'ını uygulayamaz', async () => {
    const caseId = await makeCase(organizationId, userId, 5807)
    expect((await createSheet(cookie, caseId, [
      { description: 'Ön tampon', action: 'Değişim', partAmountMinor: 900_000, laborAmountMinor: 100_000 },
    ])).statusCode).toBe(201)
    const run = await analyze(cookie, caseId, 1)

    const response = await apply(foreignCookie, caseId, run.id, {
      expectedSheetVersion: 1, reason: 'Yetkisiz', confirmed: true, lines: [line(1, 900_000, 100_000)],
    })
    expect(response.statusCode).toBe(404)
  })

  it('kapalı dosyada uygulama yapılamaz', async () => {
    const caseId = await makeCase(organizationId, userId, 5808)
    expect((await createSheet(cookie, caseId, [
      { description: 'Ön tampon', action: 'Değişim', partAmountMinor: 900_000, laborAmountMinor: 100_000 },
    ])).statusCode).toBe(201)
    const run = await analyze(cookie, caseId, 1)
    await pool.query(
      "UPDATE cases SET lifecycle_status='closed',workflow_stage='closed' WHERE id=$1",
      [caseId],
    )
    const response = await apply(cookie, caseId, run.id, {
      expectedSheetVersion: 1, reason: 'Kapalı dosya', confirmed: true, lines: [line(1, 900_000, 100_000)],
    })
    expect(response.statusCode).toBe(409)
  })

  it('onaylı geçmiş yalnız tamamlanmış provenance\'tan beslenir', async () => {
    // Aynı organizationda daha önce uygulanmış bir dağıtım var (5801/5802...).
    // Yeni dosyada AYNI kalem/işlem ile analiz: geçmiş artık eşleşir.
    const caseId = await makeCase(organizationId, userId, 5809)
    expect((await createSheet(cookie, caseId, [
      { description: 'Ön tampon', action: 'Değişim', partAmountMinor: 900_000, laborAmountMinor: 100_000 },
    ])).statusCode).toBe(201)
    const run = await analyze(cookie, caseId, 1)
    const codes = run.suggestion?.lines[0]?.missingEvidenceCodes ?? []
    expect(codes).not.toContain('EVIDENCE_MISSING_APPROVED_HISTORY')
  })

  it('uygulanmamış öneri onaylı geçmiş sayılmaz', async () => {
    // Hiç uygulama yapılmamış, tamamen farklı bir kalem: geçmiş eşleşmez.
    const caseId = await makeCase(organizationId, userId, 5810)
    expect((await createSheet(cookie, caseId, [
      { description: 'Arka panel hizalama', action: 'Ölçüm', partAmountMinor: 0, laborAmountMinor: 250_000 },
    ])).statusCode).toBe(201)
    const run = await analyze(cookie, caseId, 1)
    const codes = run.suggestion?.lines[0]?.missingEvidenceCodes ?? []
    expect(codes).toContain('EVIDENCE_MISSING_APPROVED_HISTORY')
  })

  it('provenance uygulama listesinden okunabilir', async () => {
    const response = await app.inject({
      method: 'GET', url: '/api/v1/cases/'
        + (await pool.query(
          "SELECT case_id::text AS id FROM labor_allocation_applications WHERE status='completed' LIMIT 1",
        )).rows[0].id
        + '/labor-allocation-applications',
      headers: { cookie },
    })
    expect(response.statusCode).toBe(200)
    const body = response.json() as { applications: { status: string }[] }
    expect(body.applications.length).toBeGreaterThan(0)
    expect(body.applications[0]?.status).toBe('completed')
  })

  it('ham kalem açıklaması audit kayıtlarına sızmaz', async () => {
    const leak = await pool.query(
      "SELECT count(*)::int AS n FROM audit_events WHERE details::text LIKE '%' || $1 || '%'",
      [SECRET_ITEM],
    )
    expect(leak.rows[0].n).toBe(0)
  })

  it('tamamlanmış uygulama kaydı değiştirilemez', async () => {
    const row = await pool.query(
      "SELECT id FROM labor_allocation_applications WHERE status='completed' ORDER BY id LIMIT 1",
    )
    await expect(pool.query(
      'UPDATE labor_allocation_applications SET selected_line_count=99 WHERE id=$1',
      [String(row.rows[0].id)],
    )).rejects.toMatchObject({ code: '23001' })
  })
})
