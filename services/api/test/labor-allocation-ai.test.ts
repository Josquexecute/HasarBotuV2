import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AUTH_LOGIN_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  laborAllocationApplyPreviewResponseSchema,
  laborAllocationRunResponseSchema,
  laborAllocationWorkspaceResponseSchema,
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
 * Paket 54 dilim 2 — AI işçilik dağıtımı uçtan uca doğrulaması.
 *
 * Kontrollü provider harness ile: no-fallback, tenant izolasyonu, stale föy
 * sürümü, idempotency, tüm satır kapsaması, audit/PII sızıntısı ve usage ledger.
 */
const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'p54-sentetik-guclu-parola-54'
const NOW = '2026-07-18T10:30:00.000Z'
const SECRET_DESCRIPTION = 'GIZLI-PARCA-ACIKLAMASI-54'

describeDb('Paket 54 AI işçilik dağıtımı', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let organizationId: string
  let foreignOrganizationId: string
  let userId: string
  let foreignUserId: string
  let caseId: string
  let foreignCaseId: string

  function app(providerId = 'deterministic-success'): FastifyInstance {
    return buildApp({
      clock: fixedClock(NOW),
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 200, windowMs: 60_000 } },
      laborAllocationProviders: createDeterministicLaborAllocationProviderRegistry(),
      laborAllocationProviderId: providerId,
    })
  }

  async function login(instance: FastifyInstance, email: string): Promise<string> {
    const response = await instance.inject({
      method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email, password: PASSWORD },
    })
    expect(response.statusCode).toBe(200)
    return String(response.headers['set-cookie']).split(';')[0] as string
  }

  async function seedSheet(
    instance: FastifyInstance,
    cookie: string,
    targetCaseId: string,
    caseVersion = 1,
  ): Promise<void> {
    const response = await instance.inject({
      method: 'POST', url: `/api/v1/cases/${targetCaseId}/labor-sheet`,
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        expectedCaseVersion: caseVersion,
        items: [
          { description: 'Ön tampon', action: 'Onarım + boya', partAmountMinor: 0, laborAmountMinor: 10_000_00 },
          { description: SECRET_DESCRIPTION, action: 'Değişim', partAmountMinor: 18_000_00, laborAmountMinor: 2_000_00 },
        ],
        confirmed: true,
      },
    })
    expect(response.statusCode).toBe(201)
  }

  async function enablePolicy(target: string, providerIds: string[], monthly = 1_000_000): Promise<void> {
    await pool.query(
      `INSERT INTO ai_provider_policies
         (id,organization_id,labor_allocation_enabled,labor_allocation_allowed_provider_ids,
          monthly_budget_minor,per_request_budget_minor)
       VALUES ($1,$2,true,$3,$4,$4)
       ON CONFLICT (organization_id) DO UPDATE
         SET labor_allocation_enabled=true,
             labor_allocation_allowed_provider_ids=EXCLUDED.labor_allocation_allowed_provider_ids,
             monthly_budget_minor=EXCLUDED.monthly_budget_minor,
             per_request_budget_minor=EXCLUDED.per_request_budget_minor`,
      [uuidv7(), target, providerIds, monthly],
    )
  }

  async function analyze(
    instance: FastifyInstance,
    cookie: string,
    targetCaseId: string,
    sheetVersion = 1,
  ) {
    return waitForRunTerminal(instance, cookie, targetCaseId, await instance.inject({
      method: 'POST', url: `/api/v1/cases/${targetCaseId}/labor-allocation-ai/analyze`,
      headers: { cookie },
      payload: { expectedSheetVersion: sheetVersion, damageDescription: 'Ön sol darbe.', confirmedEgress: false },
    }))
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
       VALUES ($1,'p54-main','P54 Sentetik'),($2,'p54-foreign','P54 Yabancı')`,
      [organizationId, foreignOrganizationId],
    )
    await pool.query(
      `INSERT INTO users (id,organization_id,email,display_name,password_hash)
       VALUES ($1,$3,'p54-manager@test.local','P54 Sorumlu',$5),
              ($2,$4,'p54-foreign@test.local','P54 Yabancı',$5)`,
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
       VALUES ($1,$3,2026,5401,'2026/5401','traffic','open','reporting','34 PA 5401','34PA5401',$5,'2026-07-01',1),
              ($2,$4,2026,5402,'2026/5402','traffic','open','reporting','35 PA 5402','35PA5402',$6,'2026-07-01',1)`,
      [caseId, foreignCaseId, organizationId, foreignOrganizationId, userId, foreignUserId],
    )

    const instance = app()
    const cookie = await login(instance, 'p54-manager@test.local')
    const foreignCookie = await login(instance, 'p54-foreign@test.local')
    await seedSheet(instance, cookie, caseId)
    await seedSheet(instance, foreignCookie, foreignCaseId)
    await instance.close()
  }, 240_000)

  afterAll(async () => {
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  it('workspace taksonomi ve sürüm bilgisini gerçek föyle döndürür', async () => {
    const instance = app()
    const cookie = await login(instance, 'p54-manager@test.local')
    const response = await instance.inject({
      method: 'GET', url: `/api/v1/cases/${caseId}/labor-allocation-ai`, headers: { cookie },
    })
    expect(response.statusCode).toBe(200)
    const workspace = laborAllocationWorkspaceResponseSchema.parse(response.json())
    expect(workspace.operationTypesVersion).toBe('labor-operation-types/1.0.0')
    expect(workspace.operationTypes).toContain('remove_install')
    expect(workspace.economicBuckets).toContain('paint_and_consumable')
    expect(workspace.sourceLineCount).toBe(2)
    expect(workspace.sourceSheetVersion).toBe(1)
    await instance.close()
  })

  it('sağlayıcı kapalıyken sahte sonuç üretmez', async () => {
    const instance = app()
    const cookie = await login(instance, 'p54-manager@test.local')
    const response = await analyze(instance, cookie, caseId)
    expect(response.statusCode).toBe(200)
    const { run } = laborAllocationRunResponseSchema.parse(response.json())
    expect(run.status).toBe('provider_disabled')
    expect(run.suggestion).toBeNull()
    expect(run.safeErrorCode).toBe('AI_PROVIDER_DISABLED')
    await instance.close()
  })

  it('tüm satırları kapsar, kanıt eksikliğini kontrol gerekli yapar ve ledger yazar', async () => {
    await enablePolicy(organizationId, ['deterministic-success'])
    const instance = app()
    const cookie = await login(instance, 'p54-manager@test.local')
    const response = await analyze(instance, cookie, caseId)
    expect(response.statusCode).toBe(200)
    const { run } = laborAllocationRunResponseSchema.parse(response.json())
    expect(run.status).toBe('review_required')
    expect(run.suggestion).not.toBeNull()
    expect(run.suggestion?.lines).toHaveLength(2)
    expect(run.suggestion?.lines.map((line) => line.lineOrdinal)).toEqual([1, 2])
    expect(run.operationTypesVersion).toBe('labor-operation-types/1.0.0')
    expect(run.ruleVersion).toBe('labor-allocation-rules/1.0.0')

    // Şemada bulunmayan kanıt kanalları her satırı kontrol gerekli yapar.
    for (const line of run.suggestion?.lines ?? []) {
      expect(line.missingEvidenceCodes).toContain('EVIDENCE_MISSING_VEHICLE_IDENTITY')
      expect(line.controlRequired).toBe(true)
      // Tahsis toplamı satır toplamına eşittir.
      const total = line.allocations.reduce((sum, item) => sum + item.amountMinor, 0)
      expect(total).toBe(line.sourcePartAmountMinor + line.sourceLaborAmountMinor)
    }

    const ledger = await pool.query(
      `SELECT status,usage_module FROM ai_usage_ledger
        WHERE organization_id=$1 AND labor_allocation_run_id=$2`,
      [organizationId, run.id],
    )
    expect(ledger.rows).toEqual([{ status: 'completed', usage_module: 'labor_allocation' }])
    await instance.close()
  })

  it('aynı analiz anahtarı için idempotency korunur', async () => {
    const instance = app()
    const cookie = await login(instance, 'p54-manager@test.local')
    const first = laborAllocationRunResponseSchema.parse((await analyze(instance, cookie, caseId)).json())
    const second = laborAllocationRunResponseSchema.parse((await analyze(instance, cookie, caseId)).json())
    expect(second.run.id).toBe(first.run.id)
    // Başarılı sonuç tek kez üretilir; tekrar çağrı yeni run açmaz.
    const count = await pool.query(
      `SELECT count(*)::int AS n FROM labor_allocation_runs
        WHERE organization_id=$1 AND case_id=$2 AND status='review_required'`,
      [organizationId, caseId],
    )
    expect(count.rows[0].n).toBe(1)
    await instance.close()
  })

  it('stale föy sürümü reddedilir', async () => {
    const instance = app()
    const cookie = await login(instance, 'p54-manager@test.local')
    const response = await analyze(instance, cookie, caseId, 99)
    expect(response.statusCode).toBe(409)
    expect((response.json() as { error: { code: string } }).error.code).toBe('version_conflict')
    await instance.close()
  })

  it('sağlayıcı hatası ve geçersiz şemada gizli fallback yoktur', async () => {
    for (const [providerId, expected] of [
      ['deterministic-failure', 'failed'],
      ['deterministic-timeout', 'outcome_unknown'],
      ['deterministic-invalid-schema', 'failed'],
    ] as const) {
      await enablePolicy(organizationId, [providerId])
      const instance = app(providerId)
      const cookie = await login(instance, 'p54-manager@test.local')
      const { run } = laborAllocationRunResponseSchema.parse((await analyze(instance, cookie, caseId)).json())
      expect(run.status).toBe(expected)
      expect(run.suggestion).toBeNull()
      expect(run.safeErrorCode).not.toBeNull()
      const lines = await pool.query(
        'SELECT count(*)::int AS n FROM labor_allocation_line_suggestions WHERE run_id=$1',
        [run.id],
      )
      // Doğrulamadan geçmeyen çıktı için HİÇBİR satır yazılmaz.
      expect(lines.rows[0].n).toBe(0)
      await instance.close()
    }
    await enablePolicy(organizationId, ['deterministic-success'])
  })

  it('bütçe aşımında sahte sonuç üretmez', async () => {
    await enablePolicy(foreignOrganizationId, ['deterministic-success'], 0)
    const instance = app()
    const cookie = await login(instance, 'p54-foreign@test.local')
    const { run } = laborAllocationRunResponseSchema.parse(
      (await analyze(instance, cookie, foreignCaseId)).json(),
    )
    expect(['budget_blocked', 'provider_disabled']).toContain(run.status)
    expect(run.suggestion).toBeNull()
    await instance.close()
  })

  it('tenant sınırı korunur', async () => {
    const instance = app()
    const foreignCookie = await login(instance, 'p54-foreign@test.local')
    const response = await instance.inject({
      method: 'GET', url: `/api/v1/cases/${caseId}/labor-allocation-ai`, headers: { cookie: foreignCookie },
    })
    expect(response.statusCode).toBe(404)

    const runs = await pool.query(
      'SELECT id::text FROM labor_allocation_runs WHERE organization_id=$1 AND status=$2 LIMIT 1',
      [organizationId, 'review_required'],
    )
    const runId = String(runs.rows[0].id)
    const foreignRun = await instance.inject({
      method: 'GET', url: `/api/v1/cases/${caseId}/labor-allocation-ai/${runId}`,
      headers: { cookie: foreignCookie },
    })
    expect(foreignRun.statusCode).toBe(404)
    await instance.close()
  })

  it('oturumsuz erişim reddedilir', async () => {
    const instance = app()
    expect((await instance.inject({
      method: 'GET', url: `/api/v1/cases/${caseId}/labor-allocation-ai`,
    })).statusCode).toBe(401)
    await instance.close()
  })

  it('apply-preview föyü değiştirmez ve seçili satırları taşır', async () => {
    const instance = app()
    const cookie = await login(instance, 'p54-manager@test.local')
    const runs = await pool.query(
      `SELECT id::text FROM labor_allocation_runs
        WHERE organization_id=$1 AND case_id=$2 AND status='review_required' LIMIT 1`,
      [organizationId, caseId],
    )
    const runId = String(runs.rows[0].id)
    const before = await pool.query(
      'SELECT sheet_version FROM labor_sheet_versions v JOIN labor_sheets s ON s.current_version_id=v.id WHERE s.case_id=$1',
      [caseId],
    )

    const response = await instance.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/labor-allocation-ai/${runId}/apply-preview`,
      headers: { cookie },
      payload: { expectedSheetVersion: 1, selectedLineOrdinals: [1] },
    })
    expect(response.statusCode).toBe(200)
    const preview = laborAllocationApplyPreviewResponseSchema.parse(response.json())
    expect(preview.applied).toBe(false)
    expect(preview.selectedCount).toBe(1)
    expect(preview.lines[0].lineOrdinal).toBe(1)

    const after = await pool.query(
      'SELECT sheet_version FROM labor_sheet_versions v JOIN labor_sheets s ON s.current_version_id=v.id WHERE s.case_id=$1',
      [caseId],
    )
    // Föy sürümü DEĞİŞMEZ: bu dilimde otomatik revize yoktur.
    expect(after.rows).toEqual(before.rows)
    await instance.close()
  })

  it('apply-preview stale föy sürümünü reddeder', async () => {
    const instance = app()
    const cookie = await login(instance, 'p54-manager@test.local')
    const runs = await pool.query(
      `SELECT id::text FROM labor_allocation_runs
        WHERE organization_id=$1 AND case_id=$2 AND status='review_required' LIMIT 1`,
      [organizationId, caseId],
    )
    const response = await instance.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/labor-allocation-ai/${String(runs.rows[0].id)}/apply-preview`,
      headers: { cookie },
      payload: { expectedSheetVersion: 42, selectedLineOrdinals: [1] },
    })
    expect(response.statusCode).toBe(409)
    await instance.close()
  })

  it('serbest metin ve parça açıklaması audit kayıtlarına sızmaz', async () => {
    const audit = await pool.query(
      "SELECT count(*)::int AS n FROM audit_events WHERE details::text LIKE '%' || $1 || '%'",
      [SECRET_DESCRIPTION],
    )
    expect(audit.rows[0].n).toBe(0)

    // Dağıtım ucu audit yazmaz (oturum auditleri hariç).
    const moduleAudit = await pool.query(
      "SELECT count(*)::int AS n FROM audit_events WHERE action LIKE 'labor_allocation%'",
    )
    expect(moduleAudit.rows[0].n).toBe(0)
  })
})
