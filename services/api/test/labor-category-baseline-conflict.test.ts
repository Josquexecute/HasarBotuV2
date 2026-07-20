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
  type LaborAllocationProviderAdapter,
  type LaborAllocationProviderRegistry,
  fixedClock,
  hashPassword,
} from '../src/index.js'

/**
 * Paket 64 kapanış — BASELINE kategori çelişkisi.
 *
 * Baseline'ın kategori karşılığı, aynı dosyanın önceki föy sürümünü ÜRETEN
 * tamamlanmış uygulamada kullanıcının onayladığı dağılımdır. Föy sürüm 1 hiç
 * kategorilenmeden oluştuğu için bu kaynak ancak ÜÇÜNCÜ sürümden itibaren
 * dolabilir; senaryo bu yüzden üç sürümlüdür.
 *
 * Karşılaştırma PAY üzerinden yapılır: aynı işin daha pahalıya yapılması
 * çelişki değildir, işin branşlar arasında kayması çelişkidir.
 */
const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'p64-baseline-sentetik-parola-64'
const NOW = '2026-07-20T15:00:00.000Z'

const CATEGORIES = [
  'bodywork', 'mechanical', 'electrical', 'upholstery_lock',
  'glass', 'calibration', 'repair', 'paint',
] as const

describeDb('Paket 64 baseline kategori çelişkisi', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let paintApp: FastifyInstance
  let organizationId: string
  let foreignOrganizationId: string
  let userId: string
  let cookie: string
  let sequence = 6500

  /**
   * Test-only sağlayıcı sarmalayıcısı: deterministik harness'ın kategori
   * dağılımını boyaya çevirir. Üretim davranışına dokunmaz — sağlayıcı
   * kimliği değişmez, veritabanı allowlist'i genişlemez ve bu sarmalayıcı
   * yalnız bu test dosyasında yaşar.
   */
  function paintProviders(): LaborAllocationProviderRegistry {
    const base = createDeterministicLaborAllocationProviderRegistry()
    const inner = base.get('deterministic-success') as LaborAllocationProviderAdapter
    const wrapped: LaborAllocationProviderAdapter = {
      ...inner,
      execute: async (request, signal) => {
        const response = await inner.execute(request, signal)
        const output = response.output as { lines: Record<string, unknown>[] }
        return {
          ...response,
          output: {
            ...output,
            lines: output.lines.map((line) => {
              const allocation = line.categoryAllocation as { amounts: Record<string, number> }
              const total = Object.values(allocation.amounts).reduce((sum, value) => sum + value, 0)
              return {
                ...line,
                categoryAllocation: {
                  ...allocation,
                  amounts: { ...allocation.amounts, bodywork: 0, paint: total },
                },
              }
            }),
          },
        }
      },
    }
    return {
      get: (id) => (id === 'deterministic-success' ? wrapped : base.get(id)),
      list: () => [wrapped],
    }
  }

  const ITEM = {
    description: 'Ön tampon', action: 'Onarım',
    partAmountMinor: 0, laborAmountMinor: 1_000_000,
  }

  /** Analiz çalıştırır ve `review_required` koşuyu döndürür. */
  async function analyze(instance: FastifyInstance, caseId: string, sheetVersion: number) {
    const started = await instance.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/labor-allocation-ai/analyze`,
      headers: { cookie },
      payload: {
        expectedSheetVersion: sheetVersion,
        damageDescription: 'Ön darbe.',
        confirmedEgress: false,
      },
    })
    const settled = await waitForRunTerminal(instance, cookie, caseId, started)
    const run = laborAllocationRunResponseSchema.parse(settled.json()).run
    expect(run.status).toBe('review_required')
    return run
  }

  /** Öneriyi olduğu gibi uygular; kategori düzeltmesi göndermez. */
  async function applyRun(
    instance: FastifyInstance,
    caseId: string,
    runId: string,
    sheetVersion: number,
    laborAmountMinor: number,
  ) {
    const applied = await instance.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/labor-allocation-ai/${runId}/apply`,
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        expectedSheetVersion: sheetVersion,
        reason: 'Baseline zinciri',
        confirmed: true,
        lines: [{
          lineOrdinal: 1, description: ITEM.description, action: ITEM.action,
          partAmountMinor: 0, laborAmountMinor,
        }],
      },
    })
    expect(applied.statusCode).toBe(200)
    return applied
  }

  async function createCase(): Promise<string> {
    const caseId = uuidv7()
    sequence += 1
    await pool.query(
      `INSERT INTO cases
         (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
          workflow_stage,plate,plate_normalized,responsible_user_id,notification_date,version)
       VALUES ($1,$2,2026,$3,$4,'traffic','open','reporting',$5,$6,$7,'2026-07-01',1)`,
      [
        caseId, organizationId, sequence, `2026/${sequence}`,
        `34 BC ${sequence}`, `34BC${sequence}`, userId,
      ],
    )
    const sheet = await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/labor-sheet`,
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedCaseVersion: 1, confirmed: true, items: [ITEM] },
    })
    expect(sheet.statusCode).toBe(201)
    return caseId
  }

  /**
   * Üç föy sürümlü zincir kurar ve ÜÇÜNCÜ analizin koşusunu döndürür.
   *
   * v1 → (boya uygulaması) → v2 → (boya uygulaması) → v3 → yeni analiz.
   * Üçüncü analiz kaporta önerir; baseline (v2'yi üreten uygulama) boyadır.
   */
  async function buildThreeVersionChain(laborV2 = 1_000_000) {
    const caseId = await createCase()

    // ── Föy sürümü 1: boya dağılımı uygulanır, föy 2. sürüme geçer.
    const runV1 = await analyze(paintApp, caseId, 1)
    await applyRun(paintApp, caseId, runV1.id, 1, 1_000_000)

    // ── Föy sürümü 2: yine boya uygulanır, föy 3. sürüme geçer. Artık
    // 2. sürümü ÜRETEN tamamlanmış uygulama vardır: baseline kategorisi budur.
    const runV2 = await analyze(paintApp, caseId, 2)
    await applyRun(paintApp, caseId, runV2.id, 2, laborV2)

    // ── Föy sürümü 3: kaporta öneren normal sağlayıcıyla analiz.
    const runV3 = await analyze(app, caseId, 3)
    return { caseId, runV3 }
  }

  async function suggestionRow(runId: string) {
    const rows = await pool.query(
      `SELECT category_conflict_codes,control_required,
              baseline_category_amounts,history_category_amounts,proposed_category_amounts
         FROM labor_allocation_line_suggestions WHERE run_id=$1`,
      [runId],
    )
    return rows.rows[0] as Record<string, never>
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })

    organizationId = uuidv7()
    foreignOrganizationId = uuidv7()
    userId = uuidv7()
    await pool.query(
      `INSERT INTO organizations (id,code,name)
       VALUES ($1,'p64-baseline','P64 Baseline'),($2,'p64-foreign','P64 Yabancı')`,
      [organizationId, foreignOrganizationId],
    )
    await pool.query(
      `INSERT INTO users (id,organization_id,email,display_name,password_hash)
       VALUES ($1,$2,'p64-baseline@test.local','P64 Yönetici',$3)`,
      [userId, organizationId, await hashPassword(PASSWORD)],
    )
    await pool.query(
      "INSERT INTO user_roles (user_id,role_id) SELECT $1::uuid,id FROM roles WHERE code='admin'",
      [userId],
    )
    for (const org of [organizationId, foreignOrganizationId]) {
      await pool.query(
        `INSERT INTO ai_provider_policies
           (id,organization_id,labor_allocation_enabled,labor_allocation_allowed_provider_ids,
            monthly_budget_minor,per_request_budget_minor)
         VALUES ($1,$2,true,ARRAY['deterministic-success']::text[],100000000,100000000)`,
        [uuidv7(), org],
      )
    }

    const options = {
      clock: fixedClock(NOW),
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 500, windowMs: 60_000 } },
      laborAllocationProviderId: 'deterministic-success',
    }
    app = buildApp({
      ...options,
      laborAllocationProviders: createDeterministicLaborAllocationProviderRegistry(),
    })
    paintApp = buildApp({ ...options, laborAllocationProviders: paintProviders() })
    await app.ready()
    await paintApp.ready()

    const login = await app.inject({
      method: 'POST', url: AUTH_LOGIN_ROUTE,
      payload: { email: 'p64-baseline@test.local', password: PASSWORD },
    })
    expect(login.statusCode).toBe(200)
    cookie = String(login.headers['set-cookie']).split(';')[0] as string
  })

  afterAll(async () => {
    await paintApp?.close()
    await app?.close()
    await closeDatabasePool(pool)
  })

  it('üçüncü sürümde ayrışan baseline sunucuda conflict kodu zorlar', async () => {
    const { runV3 } = await buildThreeVersionChain()
    const row = await suggestionRow(runV3.id)

    // Baseline gerçekten okundu ve boya ağırlıklıydı.
    const baseline = row.baseline_category_amounts as unknown as Record<string, number>
    expect(baseline).not.toBeNull()
    expect(baseline.paint).toBe(1_000_000)
    expect(baseline.bodywork).toBe(0)

    // Öneri kaportadır; paylar tamamen ayrışıyor.
    const proposed = row.proposed_category_amounts as unknown as Record<string, number>
    expect(proposed.bodywork).toBe(1_000_000)

    expect(row.category_conflict_codes).toContain('CATEGORY_BASELINE_CONFLICT')
    // Çelişki tek başına satırı insana taşır.
    expect(row.control_required).toBe(true)
  })

  it('okuma DTO baseline paylarını ve conflict kodunu taşır', async () => {
    const { caseId, runV3 } = await buildThreeVersionChain()
    const read = await app.inject({
      method: 'GET', url: `/api/v1/cases/${caseId}/labor-allocation-ai/${runV3.id}`,
      headers: { cookie },
    })
    const line = laborAllocationRunResponseSchema.parse(read.json()).run.suggestion?.lines[0]
    expect(line?.categoryAllocation?.conflictCodes).toContain('CATEGORY_BASELINE_CONFLICT')

    const baselineAmounts = line?.categoryAllocation?.baselineAmounts
    expect(baselineAmounts).not.toBeNull()
    // Sekiz anahtarın tamamı taşınır; UI payı buradan hesaplayabilir.
    expect(baselineAmounts).toHaveLength(CATEGORIES.length)
    const paint = baselineAmounts?.find((item) => item.category === 'paint')
    expect(paint?.amountMinor).toBe(1_000_000)
  })

  it('aynı paylar farklı toplam işçilik tutarında conflict ÜRETMEZ', () => {
    /*
     * Fiyat revizyonu meşrudur: aynı iş bugün daha pahalıya yapılabilir.
     *
     * Zincir: v1→v2→v3 boya dağılımıyla kurulur (baseline provenance'ı
     * v3'ü üreten uygulamadadır), sonra föy elle revize edilerek işçilik
     * tutarı düşürülür. v4 analizinde öneri yine %100 boyadır ama TOPLAM
     * farklıdır. Paylar örtüştüğü için kod basılmamalıdır.
     */
    return (async () => {
      const caseId = await createCase()
      const runV1 = await analyze(paintApp, caseId, 1)
      await applyRun(paintApp, caseId, runV1.id, 1, 1_000_000)
      const runV2 = await analyze(paintApp, caseId, 2)
      await applyRun(paintApp, caseId, runV2.id, 2, 1_000_000)

      // Föy elle revize edilir: işçilik tutarı düşer, sürüm 4 oluşur.
      const revised = await app.inject({
        method: 'POST', url: `/api/v1/cases/${caseId}/labor-sheet/versions`,
        headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
        payload: {
          expectedVersion: 3, confirmed: true, reason: 'Fiyat revizyonu',
          items: [{ ...ITEM, laborAmountMinor: 400_000 }],
        },
      })
      expect(revised.statusCode).toBe(200)

      const runV4 = await analyze(paintApp, caseId, 4)
      const row = await suggestionRow(runV4.id)

      const baseline = row.baseline_category_amounts as unknown as Record<string, number>
      const proposed = row.proposed_category_amounts as unknown as Record<string, number>
      // Baseline v3'ü üreten uygulamadan gelir: 1.000.000 boya.
      expect(baseline.paint).toBe(1_000_000)
      // Öneri revize edilmiş tutardadır: 400.000 boya. Toplamlar FARKLI.
      expect(proposed.paint).toBe(400_000)
      // Paylar aynı (%100 boya) olduğu için çelişki YOKTUR.
      expect(row.category_conflict_codes).not.toContain('CATEGORY_BASELINE_CONFLICT')
    })()
  })

  it('baseline kaynağı yalnız AYNI dosyanın önceki sürümüdür', async () => {
    // Başka bir dosyada boya zinciri kurulsa bile, temiz dosyanın ilk
    // analizinde baseline YOKTUR: kategori geçmişi ile baseline farklı
    // eksenlerdir ve baseline dosya sınırını aşmaz.
    await buildThreeVersionChain()

    const otherCase = await createCase()
    const firstRun = await analyze(app, otherCase, 1)
    const row = await suggestionRow(firstRun.id)
    expect(row.baseline_category_amounts).toBeNull()
    expect(row.category_conflict_codes).not.toContain('CATEGORY_BASELINE_CONFLICT')
  })

  it('tamamlanmamış uygulama baseline olamaz', async () => {
    // Föy 2. sürüme taşınır ama 2. sürümü üreten TAMAMLANMIŞ uygulama
    // 3. sürüm için baseline'dır. 2. sürümde analiz yapılıp uygulanmazsa
    // 2. analiz için baseline kaynağı yoktur (1. sürümü üreten uygulama yok).
    const caseId = await createCase()
    const runV1 = await analyze(paintApp, caseId, 1)
    await applyRun(paintApp, caseId, runV1.id, 1, 1_000_000)

    const runV2 = await analyze(app, caseId, 2)
    const row = await suggestionRow(runV2.id)
    // Föy sürüm 1 hiç kategorilenmeden oluştu; baseline kategorisi YOKTUR.
    expect(row.baseline_category_amounts).toBeNull()
    expect(row.category_conflict_codes).not.toContain('CATEGORY_BASELINE_CONFLICT')

    const orphan = await pool.query(
      `SELECT count(*)::int AS n FROM labor_allocation_applications
        WHERE case_id=$1 AND status='completed' AND target_sheet_version=1`,
      [caseId],
    )
    expect(orphan.rows[0].n).toBe(0)
  })

  it('mevcut run kendi baseline\'ı olamaz', async () => {
    const { caseId, runV3 } = await buildThreeVersionChain()
    // 3. koşunun kendi uygulaması henüz yoktur; baseline 2. sürümü üreten
    // uygulamadır ve o koşu bu koşudan farklıdır.
    const applications = await pool.query(
      `SELECT run_id::text AS run,target_sheet_version FROM labor_allocation_applications
        WHERE case_id=$1 AND status='completed' ORDER BY target_sheet_version`,
      [caseId],
    )
    expect(applications.rows.map((row) => row.target_sheet_version)).toEqual([2, 3])
    expect(applications.rows.some((row) => row.run === runV3.id)).toBe(false)
  })

  it('append-only ve provenance guard\'ları gevşetilmedi', async () => {
    const { runV3 } = await buildThreeVersionChain()
    // Kıyas anlık görüntüsü de immutable'dır.
    await expect(pool.query(
      `UPDATE labor_allocation_line_suggestions
          SET baseline_category_amounts=NULL WHERE run_id=$1`,
      [runV3.id],
    )).rejects.toMatchObject({ code: '23001' })
  })
})
