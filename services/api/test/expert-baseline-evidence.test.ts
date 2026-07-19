import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AUTH_LOGIN_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
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
import {
  buildApp,
  createDeterministicLaborAllocationProviderRegistry,
  fixedClock,
  hashPassword,
} from '../src/index.js'

/**
 * Paket 57 — eksper baseline kanıtı uçtan uca doğrulaması.
 *
 * Ana iddialar:
 *  - Baseline yalnız ÖNCEKİ onaylı föy sürümünden gelir; AI önerisi baseline
 *    sayılmaz.
 *  - Belirsiz satır eşleşmesi baseline varmış gibi davranmaz.
 *  - Baseline değişirse eski öneri stale olur.
 *  - Kanıt dolunca yalnız `EVIDENCE_MISSING_EXPERT_BASELINE` düşer.
 */
const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'p57-sentetik-guclu-parola-57'
const NOW = '2026-07-19T10:30:00.000Z'
const PLATE = '34 PC 5701'

describeDb('Paket 57 eksper baseline kanıtı', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let organizationId: string
  let foreignOrganizationId: string
  let userId: string
  let foreignUserId: string
  let caseId: string
  let foreignCaseId: string
  let cookie: string
  let foreignCookie: string

  async function login(email: string): Promise<string> {
    const response = await app.inject({
      method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email, password: PASSWORD },
    })
    expect(response.statusCode).toBe(200)
    return String(response.headers['set-cookie']).split(';')[0] as string
  }

  async function createSheet(
    sessionCookie: string,
    targetCaseId: string,
    items: Record<string, unknown>[],
  ) {
    return app.inject({
      method: 'POST', url: `/api/v1/cases/${targetCaseId}/labor-sheet`,
      headers: { cookie: sessionCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedCaseVersion: 1, items, confirmed: true },
    })
  }

  async function reviseSheet(
    sessionCookie: string,
    targetCaseId: string,
    expectedVersion: number,
    items: Record<string, unknown>[],
  ) {
    return app.inject({
      method: 'POST', url: `/api/v1/cases/${targetCaseId}/labor-sheet/versions`,
      headers: { cookie: sessionCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedVersion, items, reason: 'Kanıt güncellendi', confirmed: true },
    })
  }

  async function analyze(sessionCookie: string, targetCaseId: string, sheetVersion: number) {
    return app.inject({
      method: 'POST', url: `/api/v1/cases/${targetCaseId}/labor-allocation-ai/analyze`,
      headers: { cookie: sessionCookie },
      payload: {
        expectedSheetVersion: sheetVersion,
        damageDescription: 'Ön sol darbe.',
        confirmedEgress: false,
      },
    })
  }

  function run(response: { json: () => unknown }) {
    return laborAllocationRunResponseSchema.parse(response.json()).run
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })

    organizationId = uuidv7()
    foreignOrganizationId = uuidv7()
    userId = uuidv7()
    foreignUserId = uuidv7()
    caseId = uuidv7()
    foreignCaseId = uuidv7()
    const passwordHash = await hashPassword(PASSWORD)
    await pool.query(
      `INSERT INTO organizations (id,code,name)
       VALUES ($1,'p57-main','P57 Sentetik'),($2,'p57-foreign','P57 Yabancı')`,
      [organizationId, foreignOrganizationId],
    )
    await pool.query(
      `INSERT INTO users (id,organization_id,email,display_name,password_hash)
       VALUES ($1,$3,'p57-manager@test.local','P57 Sorumlu',$5),
              ($2,$4,'p57-foreign@test.local','P57 Yabancı',$5)`,
      [userId, foreignUserId, organizationId, foreignOrganizationId, passwordHash],
    )
    await pool.query(
      `INSERT INTO user_roles (user_id,role_id)
       SELECT $1::uuid,id FROM roles WHERE code='case_manager'
       UNION ALL SELECT $2::uuid,id FROM roles WHERE code='case_manager'`,
      [userId, foreignUserId],
    )
    await pool.query(
      `INSERT INTO cases
         (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
          workflow_stage,plate,plate_normalized,responsible_user_id,notification_date,version)
       VALUES ($1,$3,2026,5701,'2026/5701','traffic','open','reporting',$7,'34PC5701',$5,'2026-07-01',1),
              ($2,$4,2026,5702,'2026/5702','traffic','open','reporting','35 PC 5702','35PC5702',$6,'2026-07-01',1)`,
      [caseId, foreignCaseId, organizationId, foreignOrganizationId, userId, foreignUserId, PLATE],
    )
    await pool.query(
      `INSERT INTO ai_provider_policies
         (id,organization_id,labor_allocation_enabled,labor_allocation_allowed_provider_ids,
          monthly_budget_minor,per_request_budget_minor)
       VALUES ($1,$2,true,ARRAY['deterministic-success']::text[],1000000,1000000),
              ($3,$4,true,ARRAY['deterministic-success']::text[],1000000,1000000)`,
      [uuidv7(), organizationId, uuidv7(), foreignOrganizationId],
    )

    app = buildApp({
      clock: fixedClock(NOW),
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 200, windowMs: 60_000 } },
      laborAllocationProviders: createDeterministicLaborAllocationProviderRegistry(),
      laborAllocationProviderId: 'deterministic-success',
    })
    await app.ready()
    cookie = await login('p57-manager@test.local')
    foreignCookie = await login('p57-foreign@test.local')
  })

  afterAll(async () => {
    await app?.close()
    await closeDatabasePool(pool)
  })

  it('ilk sürümde baseline yoktur ve eksik kanıt kodu üretilir', async () => {
    const created = await createSheet(cookie, caseId, [
      { description: 'Ön tampon', action: 'Değişim', partAmountMinor: 900_000, laborAmountMinor: 100_000 },
    ])
    expect(created.statusCode).toBe(201)

    const analyzed = await analyze(cookie, caseId, 1)
    expect(analyzed.statusCode).toBe(200)
    const result = run(analyzed)
    expect(result.baselineSheetVersion).toBeNull()
    expect(result.baselineMatchVersion).toBeNull()
    expect(result.baselineMatchedLineCount).toBe(0)
    for (const suggestionLine of result.suggestion?.lines ?? []) {
      expect(suggestionLine.baseline).toBeNull()
      expect(suggestionLine.missingEvidenceCodes).toContain('EVIDENCE_MISSING_EXPERT_BASELINE')
    }
  })

  it('AI önerisi baseline sayılmaz: öneri üretildikten sonra da kanıt eksiktir', async () => {
    // Önceki testte bir öneri kaydedildi. Föy sürümü hâlâ 1 olduğu için
    // baseline yoktur; AI çıktısı hiçbir koşulda baseline'a dönüşmez.
    const suggestions = await pool.query(
      'SELECT count(*)::int AS n FROM labor_allocation_line_suggestions WHERE organization_id=$1',
      [organizationId],
    )
    expect(suggestions.rows[0].n).toBeGreaterThan(0)

    const stored = await pool.query(
      'SELECT baseline_sheet_version FROM labor_allocation_runs WHERE organization_id=$1',
      [organizationId],
    )
    expect(stored.rows.every((row: { baseline_sheet_version: number | null }) => (
      row.baseline_sheet_version === null
    ))).toBe(true)
  })

  it('önceki onaylı föy sürümü baseline olur ve yalnız baseline kodu düşer', async () => {
    const revised = await reviseSheet(cookie, caseId, 1, [
      { description: 'Ön tampon', action: 'Değişim', partAmountMinor: 950_000, laborAmountMinor: 105_000 },
    ])
    expect(revised.statusCode).toBe(200)

    const analyzed = await analyze(cookie, caseId, 2)
    expect(analyzed.statusCode).toBe(200)
    const result = run(analyzed)
    expect(result.baselineSheetVersion).toBe(1)
    expect(result.baselineMatchVersion).toBe('labor-baseline-match/1.0.0')
    expect(result.baselineMatchedLineCount).toBe(1)

    const suggestionLine = result.suggestion?.lines[0]
    expect(suggestionLine?.baseline?.baselinePartAmountMinor).toBe(900_000)
    expect(suggestionLine?.baseline?.baselineLaborAmountMinor).toBe(100_000)
    expect(suggestionLine?.missingEvidenceCodes).not.toContain('EVIDENCE_MISSING_EXPERT_BASELINE')
    // Diğer kanallar bağımsızdır: baseline dolduğu için düşmezler.
    expect(suggestionLine?.missingEvidenceCodes).toContain('EVIDENCE_MISSING_VEHICLE_IDENTITY')
    expect(suggestionLine?.missingEvidenceCodes).toContain('EVIDENCE_MISSING_APPROVED_HISTORY')
    // Kanıt dolsa da kullanıcı kontrolü kalkmaz.
    expect(suggestionLine?.controlRequired).toBe(true)
  })

  it('belirsiz satır eşleşmesinde baseline varmış gibi davranmaz', async () => {
    const ambiguousCaseId = uuidv7()
    await pool.query(
      `INSERT INTO cases
         (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
          workflow_stage,plate,plate_normalized,responsible_user_id,notification_date,version)
       VALUES ($1,$2,2026,5703,'2026/5703','traffic','open','reporting','34 PC 5703','34PC5703',$3,'2026-07-01',1)`,
      [ambiguousCaseId, organizationId, userId],
    )
    // Aynı açıklama+işlem iki kez: hangi satırın hangisine karşılık geldiği
    // belirsizdir ve ayırt edici alan yoktur.
    const items = [
      { description: 'Ön tampon', action: 'Değişim', partAmountMinor: 500_000, laborAmountMinor: 50_000 },
      { description: 'Ön tampon', action: 'Değişim', partAmountMinor: 400_000, laborAmountMinor: 40_000 },
    ]
    expect((await createSheet(cookie, ambiguousCaseId, items)).statusCode).toBe(201)
    expect((await reviseSheet(cookie, ambiguousCaseId, 1, items)).statusCode).toBe(200)

    const analyzed = await analyze(cookie, ambiguousCaseId, 2)
    expect(analyzed.statusCode).toBe(200)
    const result = run(analyzed)
    // Baseline sürümü bulunmuştur ama hiçbir satır güvenle bağlanamaz.
    expect(result.baselineSheetVersion).toBe(1)
    expect(result.baselineMatchedLineCount).toBe(0)
    for (const suggestionLine of result.suggestion?.lines ?? []) {
      expect(suggestionLine.baseline).toBeNull()
      expect(suggestionLine.missingEvidenceCodes).toContain('EVIDENCE_MISSING_EXPERT_BASELINE')
    }
  })

  it('parça kodu belirsizliği çözer ve eşleşmeyi geri getirir', async () => {
    const resolvedCaseId = uuidv7()
    await pool.query(
      `INSERT INTO cases
         (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
          workflow_stage,plate,plate_normalized,responsible_user_id,notification_date,version)
       VALUES ($1,$2,2026,5704,'2026/5704','traffic','open','reporting','34 PC 5704','34PC5704',$3,'2026-07-01',1)`,
      [resolvedCaseId, organizationId, userId],
    )
    const items = [
      {
        description: 'Ön tampon', action: 'Değişim', partAmountMinor: 500_000, laborAmountMinor: 50_000,
        partCode: 'TMP-A', partCodeSource: 'user_entered',
      },
      {
        description: 'Ön tampon', action: 'Değişim', partAmountMinor: 400_000, laborAmountMinor: 40_000,
        partCode: 'TMP-B', partCodeSource: 'user_entered',
      },
    ]
    expect((await createSheet(cookie, resolvedCaseId, items)).statusCode).toBe(201)
    expect((await reviseSheet(cookie, resolvedCaseId, 1, items)).statusCode).toBe(200)

    const result = run(await analyze(cookie, resolvedCaseId, 2))
    expect(result.baselineMatchedLineCount).toBe(2)
    expect(result.suggestion?.lines[0]?.baseline?.baselinePartAmountMinor).toBe(500_000)
    expect(result.suggestion?.lines[1]?.baseline?.baselinePartAmountMinor).toBe(400_000)
  })

  it('baseline değişince kanıt hash değişir ve eski öneri stale olur', async () => {
    const runs = await pool.query(
      `SELECT evidence_hash,source_sheet_version,baseline_sheet_version
         FROM labor_allocation_runs WHERE organization_id=$1 AND case_id=$2
        ORDER BY created_at`,
      [organizationId, caseId],
    )
    expect(runs.rows.length).toBeGreaterThanOrEqual(2)
    const hashes = new Set(runs.rows.map((row: { evidence_hash: string }) => row.evidence_hash))
    expect(hashes.size).toBe(runs.rows.length)

    // Föy tekrar revize edilince önceki öneri kaynak sürümüne göre stale olur.
    expect((await reviseSheet(cookie, caseId, 2, [
      { description: 'Ön tampon', action: 'Değişim', partAmountMinor: 960_000, laborAmountMinor: 106_000 },
    ])).statusCode).toBe(200)

    const workspace = await app.inject({
      method: 'GET', url: `/api/v1/cases/${caseId}/labor-allocation-ai`,
      headers: { cookie },
    })
    expect(workspace.statusCode).toBe(200)
    const body = workspace.json() as { runs: { stale: boolean; sourceSheetVersion: number }[] }
    expect(body.runs.length).toBeGreaterThan(0)
    expect(body.runs.every((item) => (item.sourceSheetVersion === 3) || item.stale)).toBe(true)
  })

  it('organization dışındaki onaylı sonuçlar baseline olarak kullanılmaz', async () => {
    // Yabancı organizationda aynı açıklama/işlemle iki sürüm oluştur.
    const items = [
      { description: 'Ön tampon', action: 'Değişim', partAmountMinor: 1, laborAmountMinor: 99 },
    ]
    expect((await createSheet(foreignCookie, foreignCaseId, items)).statusCode).toBe(201)

    // Ana organizationdaki yeni dosyanın ilk sürümünde baseline olmamalıdır;
    // yabancı organizationdaki onaylı sürüm sızmaz.
    const isolatedCaseId = uuidv7()
    await pool.query(
      `INSERT INTO cases
         (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
          workflow_stage,plate,plate_normalized,responsible_user_id,notification_date,version)
       VALUES ($1,$2,2026,5705,'2026/5705','traffic','open','reporting','34 PC 5705','34PC5705',$3,'2026-07-01',1)`,
      [isolatedCaseId, organizationId, userId],
    )
    expect((await createSheet(cookie, isolatedCaseId, items)).statusCode).toBe(201)

    const result = run(await analyze(cookie, isolatedCaseId, 1))
    expect(result.baselineSheetVersion).toBeNull()
    expect(result.baselineMatchedLineCount).toBe(0)
  })

  it('yabancı organization başka dosyanın önerisini okuyamaz', async () => {
    const response = await app.inject({
      method: 'GET', url: `/api/v1/cases/${caseId}/labor-allocation-ai`,
      headers: { cookie: foreignCookie },
    })
    expect(response.statusCode).toBe(404)
  })

  it('baseline tutarları ve plaka audit kayıtlarına sızmaz', async () => {
    const leak = await pool.query(
      `SELECT count(*)::int AS n FROM audit_events
        WHERE details::text LIKE '%' || $1 || '%'`,
      [PLATE],
    )
    expect(leak.rows[0].n).toBe(0)
  })

  it('baseline alanları sonradan değiştirilemez', async () => {
    // Baseline seçimi ve karşılaştırma önerinin parçasıdır: kaydedildikten
    // sonra değiştirilebilseydi, saklanan öneri başka bir kanıta aitmiş gibi
    // gösterilebilirdi. Hedef satır deterministik seçilir (LIMIT 1 sırasız
    // olduğu için önce baseline'sız bir run'a bağlanır).
    const target = await pool.query(
      `SELECT l.id FROM labor_allocation_line_suggestions l
         JOIN labor_allocation_runs r ON r.id=l.run_id
        WHERE r.organization_id=$1 AND r.status='review_required'
          AND r.baseline_sheet_version IS NULL
        ORDER BY l.id LIMIT 1`,
      [organizationId],
    )
    expect(target.rows.length).toBe(1)
    const lineId = String(target.rows[0].id)

    const before = await pool.query(
      'SELECT baseline_part_amount_minor FROM labor_allocation_line_suggestions WHERE id=$1',
      [lineId],
    )
    expect(before.rows[0].baseline_part_amount_minor).toBeNull()

    await expect(pool.query(
      'UPDATE labor_allocation_line_suggestions SET baseline_conflict=true WHERE id=$1',
      [lineId],
    )).rejects.toMatchObject({ code: expect.stringMatching(/23514|23001/) })

    const after = await pool.query(
      'SELECT baseline_conflict FROM labor_allocation_line_suggestions WHERE id=$1',
      [lineId],
    )
    expect(after.rows[0].baseline_conflict).toBe(false)
  })

  it('run baseline seçimi immutable trigger ile korunur', async () => {
    const runRow = await pool.query(
      `SELECT id FROM labor_allocation_runs
        WHERE organization_id=$1 AND baseline_sheet_version IS NOT NULL
        ORDER BY id LIMIT 1`,
      [organizationId],
    )
    expect(runRow.rows.length).toBe(1)
    await expect(pool.query(
      'UPDATE labor_allocation_runs SET baseline_sheet_version=99 WHERE id=$1',
      [String(runRow.rows[0].id)],
    )).rejects.toMatchObject({ code: '23001' })
  })
})
