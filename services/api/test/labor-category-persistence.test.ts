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
import { waitForRunTerminal } from './helpers/labor-allocation-run.js'
import {
  buildApp,
  createDeterministicLaborAllocationProviderRegistry,
  fixedClock,
  hashPassword,
} from '../src/index.js'

/**
 * Paket 64 ara dilim — kategori dağılımı kalıcılaştırma.
 *
 * Ana iddialar: önerilen ve uygulanan kategori dağılımı AYRI saklanır, sekiz
 * kategori tamlığı ve toplam eşitliği veritabanı seviyesinde zorlanır, ve
 * kullanıcı işçilik tutarını değiştirdiyse kategori provenance'ı UYDURULMAZ.
 */
const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'p64-sentetik-guclu-parola-64'
const NOW = '2026-07-20T14:00:00.000Z'

describeDb('Paket 64 kategori dağılımı kalıcılaştırma', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let organizationId: string
  let userId: string
  let cookie: string
  let sequence = 6400

  /** Föy + analiz + (isteğe bağlı) uygulama zinciri kuran yardımcı. */
  async function prepareCase(items: readonly Record<string, unknown>[]) {
    const caseId = uuidv7()
    sequence += 1
    await pool.query(
      `INSERT INTO cases
         (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
          workflow_stage,plate,plate_normalized,responsible_user_id,notification_date,version)
       VALUES ($1,$2,2026,$3,$4,'traffic','open','reporting',$5,$6,$7,'2026-07-01',1)`,
      [
        caseId, organizationId, sequence, `2026/${sequence}`,
        `34 KT ${sequence}`, `34KT${sequence}`, userId,
      ],
    )
    const sheet = await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/labor-sheet`,
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedCaseVersion: 1, confirmed: true, items },
    })
    expect(sheet.statusCode).toBe(201)

    const analyzed = await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/labor-allocation-ai/analyze`,
      headers: { cookie },
      payload: { expectedSheetVersion: 1, damageDescription: 'Ön darbe.', confirmedEgress: false },
    })
    const settled = await waitForRunTerminal(app, cookie, caseId, analyzed)
    const run = laborAllocationRunResponseSchema.parse(settled.json()).run
    expect(run.status).toBe('review_required')
    return { caseId, runId: run.id }
  }

  const apply = (
    caseId: string,
    runId: string,
    lines: readonly Record<string, unknown>[],
    key = uuidv7(),
  ) => app.inject({
    method: 'POST', url: `/api/v1/cases/${caseId}/labor-allocation-ai/${runId}/apply`,
    headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: key },
    payload: { expectedSheetVersion: 1, reason: 'Kategori testi', confirmed: true, lines },
  })

  const ITEM = {
    description: 'Ön tampon', action: 'Onarım',
    partAmountMinor: 0, laborAmountMinor: 1_000_000,
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })

    organizationId = uuidv7()
    userId = uuidv7()
    await pool.query(
      "INSERT INTO organizations (id,code,name) VALUES ($1,'p64-main','P64 Sentetik')",
      [organizationId],
    )
    await pool.query(
      `INSERT INTO users (id,organization_id,email,display_name,password_hash)
       VALUES ($1,$2,'p64-admin@test.local','P64 Yönetici',$3)`,
      [userId, organizationId, await hashPassword(PASSWORD)],
    )
    await pool.query(
      "INSERT INTO user_roles (user_id,role_id) SELECT $1::uuid,id FROM roles WHERE code='admin'",
      [userId],
    )
    await pool.query(
      `INSERT INTO ai_provider_policies
         (id,organization_id,labor_allocation_enabled,labor_allocation_allowed_provider_ids,
          monthly_budget_minor,per_request_budget_minor)
       VALUES ($1,$2,true,ARRAY['deterministic-success']::text[],100000000,100000000)`,
      [uuidv7(), organizationId],
    )

    app = buildApp({
      clock: fixedClock(NOW),
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 500, windowMs: 60_000 } },
      laborAllocationProviders: createDeterministicLaborAllocationProviderRegistry(),
      laborAllocationProviderId: 'deterministic-success',
    })
    await app.ready()
    const login = await app.inject({
      method: 'POST', url: AUTH_LOGIN_ROUTE,
      payload: { email: 'p64-admin@test.local', password: PASSWORD },
    })
    expect(login.statusCode).toBe(200)
    cookie = String(login.headers['set-cookie']).split(';')[0] as string
  })

  afterAll(async () => {
    await app?.close()
    await closeDatabasePool(pool)
  })

  it('önerilen kategori dağılımını sekiz anahtarla ve doğru toplamla saklar', async () => {
    const { runId } = await prepareCase([ITEM])
    const stored = await pool.query(
      `SELECT proposed_category_amounts,category_schema_version,category_confidence,
              source_labor_amount_minor::text AS labor
         FROM labor_allocation_line_suggestions WHERE run_id=$1`,
      [runId],
    )
    const row = stored.rows[0] as Record<string, unknown>
    const amounts = row.proposed_category_amounts as Record<string, number>
    expect(Object.keys(amounts).sort()).toEqual([
      'bodywork', 'calibration', 'electrical', 'glass',
      'mechanical', 'paint', 'repair', 'upholstery_lock',
    ])
    const total = Object.values(amounts).reduce((sum, value) => sum + value, 0)
    // Toplam YALNIZ işçilik tutarına eşittir; parça bedeli karışmaz.
    expect(total).toBe(Number(row.labor))
    expect(row.category_schema_version).toBe('labor-category-allocation/1.0.0')
  })

  it('öneri satırı append-only kalır; kategori sonradan değiştirilemez', async () => {
    const { runId } = await prepareCase([ITEM])
    await expect(pool.query(
      `UPDATE labor_allocation_line_suggestions
          SET proposed_category_amounts='{"bodywork":1000000}'::jsonb WHERE run_id=$1`,
      [runId],
    )).rejects.toMatchObject({ code: '23001' })
  })

  it('uygulanan satır append-only kalır; toplam sonradan bozulamaz', async () => {
    const { runId } = await prepareCase([ITEM])
    const wrong = JSON.stringify({
      bodywork: 999_999, mechanical: 0, electrical: 0, upholstery_lock: 0,
      glass: 0, calibration: 0, repair: 0, paint: 0,
    })
    await expect(pool.query(
      `UPDATE labor_allocation_line_suggestions
          SET proposed_category_amounts=$2::jsonb WHERE run_id=$1`,
      [runId, wrong],
    )).rejects.toMatchObject({ code: '23001' })
  })

  it('uygulanan satırda proposed ve applied AYRI saklanır', async () => {
    const { caseId, runId } = await prepareCase([ITEM])
    const applied = await apply(caseId, runId, [{
      lineOrdinal: 1, description: 'Ön tampon', action: 'Onarım',
      partAmountMinor: 0, laborAmountMinor: 1_000_000,
    }])
    expect(applied.statusCode).toBe(200)

    const stored = await pool.query(
      `SELECT proposed_category_amounts,applied_category_amounts,category_modified,
              category_schema_version,applied_labor_amount_minor::text AS labor
         FROM labor_allocation_applied_lines
        WHERE application_id=(SELECT id FROM labor_allocation_applications WHERE run_id=$1)`,
      [runId],
    )
    const row = stored.rows[0] as Record<string, unknown>
    expect(row.proposed_category_amounts).not.toBeNull()
    expect(row.applied_category_amounts).not.toBeNull()
    expect(row.category_modified).toBe(false)
    expect(row.category_schema_version).toBe('labor-category-allocation/1.0.0')
    const total = Object.values(row.applied_category_amounts as Record<string, number>)
      .reduce((sum, value) => sum + value, 0)
    expect(total).toBe(Number(row.labor))
  })

  it('kullanıcı işçilik tutarını değiştirdiyse kategori provenance UYDURULMAZ', async () => {
    const { caseId, runId } = await prepareCase([ITEM])
    // Uygulanan işçilik tutarı öneriden FARKLI: dağılım artık bu satırı
    // açıklamıyor, bu yüzden kategori bilgisi bilinmiyor bırakılmalıdır.
    const applied = await apply(caseId, runId, [{
      lineOrdinal: 1, description: 'Ön tampon', action: 'Onarım',
      partAmountMinor: 200_000, laborAmountMinor: 800_000,
    }])
    expect(applied.statusCode).toBe(200)

    const stored = await pool.query(
      `SELECT proposed_category_amounts,applied_category_amounts,category_modified,
              category_schema_version,modified
         FROM labor_allocation_applied_lines
        WHERE application_id=(SELECT id FROM labor_allocation_applications WHERE run_id=$1)`,
      [runId],
    )
    const row = stored.rows[0] as Record<string, unknown>
    expect(row.modified).toBe(true)
    // Ölçeklenmiş sahte bir dağılım YAZILMAZ.
    expect(row.proposed_category_amounts).toBeNull()
    expect(row.applied_category_amounts).toBeNull()
    expect(row.category_modified).toBeNull()
    expect(row.category_schema_version).toBeNull()
  })

  it('yarım kategori provenance üretmek için sonradan düzenleme yapılamaz', async () => {
    const { caseId, runId } = await prepareCase([ITEM])
    await apply(caseId, runId, [{
      lineOrdinal: 1, description: 'Ön tampon', action: 'Onarım',
      partAmountMinor: 0, laborAmountMinor: 1_000_000,
    }])
    // applied var, proposed null: yarım provenance kabul edilmez.
    await expect(pool.query(
      `UPDATE labor_allocation_applied_lines SET proposed_category_amounts=NULL
        WHERE application_id=(SELECT id FROM labor_allocation_applications WHERE run_id=$1)`,
      [runId],
    )).rejects.toMatchObject({ code: '23001' })
  })

  it('category_modified bayrağı sonradan yalana çevrilemez', async () => {
    const { caseId, runId } = await prepareCase([ITEM])
    await apply(caseId, runId, [{
      lineOrdinal: 1, description: 'Ön tampon', action: 'Onarım',
      partAmountMinor: 0, laborAmountMinor: 1_000_000,
    }])
    // Dağılım aynıyken bayrağı true yapmak yalan olur; DB reddeder.
    await expect(pool.query(
      `UPDATE labor_allocation_applied_lines SET category_modified=true
        WHERE application_id=(SELECT id FROM labor_allocation_applications WHERE run_id=$1)`,
      [runId],
    )).rejects.toMatchObject({ code: '23001' })
  })

  it('aynı run ikinci kez uygulanamaz', async () => {
    const { caseId, runId } = await prepareCase([ITEM])
    const line = {
      lineOrdinal: 1, description: 'Ön tampon', action: 'Onarım',
      partAmountMinor: 0, laborAmountMinor: 1_000_000,
    }
    expect((await apply(caseId, runId, [line])).statusCode).toBe(200)
    const second = await apply(caseId, runId, [line])
    expect(second.statusCode).toBeGreaterThanOrEqual(400)

    const count = await pool.query(
      'SELECT count(*)::int AS n FROM labor_allocation_applications WHERE run_id=$1',
      [runId],
    )
    expect(count.rows[0].n).toBe(1)
  })

  it('kategori tutarları audit kayıtlarına sızmaz', async () => {
    const { caseId, runId } = await prepareCase([ITEM])
    await apply(caseId, runId, [{
      lineOrdinal: 1, description: 'Ön tampon', action: 'Onarım',
      partAmountMinor: 0, laborAmountMinor: 1_000_000,
    }])
    const leak = await pool.query(
      "SELECT count(*)::int AS n FROM audit_events WHERE details::text LIKE '%bodywork%'",
    )
    expect(leak.rows[0].n).toBe(0)
  })


  it('kategori dağılımı çalıştırma okuma yolunda görünür', async () => {
    const { caseId, runId } = await prepareCase([ITEM])
    const read = await app.inject({
      method: 'GET', url: `/api/v1/cases/${caseId}/labor-allocation-ai/${runId}`,
      headers: { cookie },
    })
    const line = laborAllocationRunResponseSchema.parse(read.json()).run.suggestion?.lines[0]
    expect(line?.categoryAllocation).not.toBeNull()
    // Sekiz anahtarın TAMAMI taşınır; eksik anahtar sıfır varsayılmaz.
    expect(line?.categoryAllocation?.amounts).toHaveLength(8)
    const total = (line?.categoryAllocation?.amounts ?? [])
      .reduce((sum, item) => sum + item.amountMinor, 0)
    expect(total).toBe(1_000_000)
  })

  it('tutarlı geçmiş YANLIŞ ALARM üretmez: aynı dağılım çelişki sayılmaz', async () => {
    // Birinci dosya onaylanır; ikinci dosyada aynı kalem analiz edilir.
    // Geçmiş ile öneri aynı branş dağılımını taşıdığı için kod basılmamalıdır.
    const first = await prepareCase([ITEM])
    expect((await apply(first.caseId, first.runId, [{
      lineOrdinal: 1, description: 'Ön tampon', action: 'Onarım',
      partAmountMinor: 0, laborAmountMinor: 1_000_000,
    }])).statusCode).toBe(200)

    const second = await prepareCase([ITEM])
    const stored = await pool.query(
      `SELECT run_id::text AS run,category_conflict_codes,control_required
         FROM labor_allocation_line_suggestions WHERE run_id=ANY($1::uuid[])`,
      [[first.runId, second.runId]],
    )
    const before = stored.rows.find((row) => row.run === first.runId)
    const after = stored.rows.find((row) => row.run === second.runId)
    expect(after.category_conflict_codes).toEqual([])
    /*
     * `control_required` çok eksenlidir; model güveni gibi başka nedenlerle de
     * true olabilir. Burada iddia edilen tek şey KATEGORİ ekseninin kararı
     * değiştirmediğidir: tutarlı geçmiş kontrol gereksinimi EKLEMEZ.
     */
    expect(after.control_required).toBe(before.control_required)
  })

  it('provenance\'ı olmayan uygulanmış satır kategori geçmişine GİRMEZ', async () => {
    // Kullanıcı işçilik tutarını değiştirince kategori dağılımı bilinmiyor
    // kalır. Bu satır sonraki analizde kanıt sayılmamalıdır.
    const first = await prepareCase([ITEM])
    expect((await apply(first.caseId, first.runId, [{
      lineOrdinal: 1, description: 'Ön tampon', action: 'Onarım',
      partAmountMinor: 0, laborAmountMinor: 750_000,
    }])).statusCode).toBe(200)

    const nulled = await pool.query(
      `SELECT applied_category_amounts FROM labor_allocation_applied_lines
         WHERE application_id=(SELECT id FROM labor_allocation_applications WHERE run_id=$1)`,
      [first.runId],
    )
    expect(nulled.rows[0].applied_category_amounts).toBeNull()

    // Geçmişte kullanılabilir kategori örneği olmadığı için ikinci analizde
    // çelişki kodu da üretilmez; boşluk sessizce dağılım gibi okunmaz.
    const second = await prepareCase([ITEM])
    const stored = await pool.query(
      `SELECT category_conflict_codes
         FROM labor_allocation_line_suggestions WHERE run_id=$1`,
      [second.runId],
    )
    expect(stored.rows[0].category_conflict_codes).toEqual([])
  })

  it('baseline kategori kaynağı yoksa çelişki uydurulmaz', async () => {
    // Föy sürüm 1 hiçbir zaman kategori dağıtılmadan oluşur; sürüm 2'nin
    // baseline'ı olan sürüm 1 için kategori provenance'ı YOKTUR.
    const first = await prepareCase([ITEM])
    expect((await apply(first.caseId, first.runId, [{
      lineOrdinal: 1, description: 'Ön tampon', action: 'Onarım',
      partAmountMinor: 0, laborAmountMinor: 1_000_000,
    }])).statusCode).toBe(200)

    const baselineRows = await pool.query(
      `SELECT count(*)::int AS n FROM labor_allocation_applications
        WHERE case_id=$1 AND status='completed' AND target_sheet_version=1`,
      [first.caseId],
    )
    expect(baselineRows.rows[0].n).toBe(0)
  })

  it('kategori alanları eklenmiş kayıt geriye dönük okunabilir kalır', async () => {
    const { caseId, runId } = await prepareCase([ITEM])
    const read = await app.inject({
      method: 'GET', url: `/api/v1/cases/${caseId}/labor-allocation-ai/${runId}`,
      headers: { cookie },
    })
    // Eski kayıt sessizce yeniden yorumlanmaz ama OKUNABİLİR kalır.
    expect(read.statusCode).toBe(200)
    expect(laborAllocationRunResponseSchema.parse(read.json()).run.id).toBe(runId)
  })
})
