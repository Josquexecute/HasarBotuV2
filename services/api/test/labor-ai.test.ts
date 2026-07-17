import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AUTH_LOGIN_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  laborAiPlanResponseSchema,
  laborAiRunResponseSchema,
  laborSheetResponseSchema,
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
import {
  createDeterministicLaborAiProviderRegistry,
  createLaborAiProviderRegistry,
  type DeterministicLaborAiProviderRegistry,
  type LaborAiProviderAdapter,
} from '../src/labor-ai/index.js'

const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'p44-sentetik-guclu-parola-44'
const DAMAGE = 'Ön tampon ve sol çamurluk hasarlı. Sigortalı Ayşe Yılmaz, ayse@example.test, 0532 111 22 33.'

describeDb('Paket 44 işçilik AI önerisi gerçek API', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let registry: DeterministicLaborAiProviderRegistry
  let unknownNetworkCalls = 0
  let organizationId: string
  let foreignOrganizationId: string
  let managerUserId: string
  let caseId: string
  let closedCaseId: string
  let foreignCaseId: string
  let managerCookie: string
  let readOnlyCookie: string

  const runsUrl = (targetCaseId = caseId) => `/api/v1/cases/${targetCaseId}/labor-ai-suggestions`
  const planUrl = (targetCaseId = caseId) => `${runsUrl(targetCaseId)}/plan`
  const sheetUrl = (targetCaseId = caseId) => `/api/v1/cases/${targetCaseId}/labor-sheet`

  async function login(email: string): Promise<string> {
    const response = await app.inject({ method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email, password: PASSWORD } })
    expect(response.statusCode).toBe(200)
    return String(response.headers['set-cookie']).split(';')[0] as string
  }

  async function fetchPlan(providerId: string, damage = DAMAGE, cookie = managerCookie) {
    const response = await app.inject({
      method: 'POST', url: planUrl(),
      headers: { cookie },
      payload: { damageDescription: damage, providerId },
    })
    expect(response.statusCode).toBe(200)
    return laborAiPlanResponseSchema.parse(response.json())
  }

  async function startRun(providerId: string, damage = DAMAGE, key = uuidv7()) {
    const plan = await fetchPlan(providerId, damage)
    return app.inject({
      method: 'POST', url: runsUrl(),
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: key },
      payload: {
        damageDescription: damage,
        providerId,
        expectedCaseVersion: plan.caseVersion,
        expectedSheetVersion: plan.baseSheetVersion,
        planHash: plan.planHash,
        confirmed: true,
      },
    })
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
       VALUES ($1,'p44-main','P44 Sentetik'),($2,'p44-foreign','P44 Yabancı')`,
      [organizationId, foreignOrganizationId],
    )
    await pool.query(
      `INSERT INTO users (id,organization_id,email,display_name,password_hash)
       VALUES ($1,$4,'p44-manager@test.local','P44 Dosya Sorumlusu',$6),
              ($2,$4,'p44-readonly@test.local','P44 Salt Okunur',$6),
              ($3,$5,'p44-foreign@test.local','P44 Yabancı',$6)`,
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
       ($1,$4,2026,4401,'2026/4401','traffic','open','reporting','34 P 4401','34P4401',$5,'2026-07-17',3),
       ($2,$4,2026,4402,'2026/4402','traffic','closed','closed','34 P 4402','34P4402',$5,'2026-07-17',1),
       ($3,$6,2026,4403,'2026/4403','traffic','open','reporting','35 P 4403','35P4403',$7,'2026-07-17',1)`,
      [caseId, closedCaseId, foreignCaseId, organizationId, managerUserId, foreignOrganizationId, foreignUserId],
    )
    await pool.query(
      `INSERT INTO ai_provider_policies
         (id,organization_id,labor_enabled,labor_allowed_provider_ids,
          monthly_budget_minor,per_request_budget_minor,monthly_hard_stop,
          maximum_input_characters,request_timeout_ms)
       VALUES ($1,$2,false,ARRAY[]::text[],1000,100,true,50000,1000)`,
      [uuidv7(), organizationId],
    )

    registry = createDeterministicLaborAiProviderRegistry()
    const unknownNetworkAdapter: LaborAiProviderAdapter = {
      descriptor: {
        providerId: 'gemini-generate-content',
        providerVersion: 'gemini-labor-test/1.0.0',
        modelId: 'gemini-labor-fixture',
        capabilities: ['structured_output', 'pii_minimized_payload'],
        maximumInputCharacters: 50_000,
        maximumOutputSize: 100_000,
        externalProvider: true,
        retentionMode: 'free_tier_product_improvement',
        pricingVersion: 'gemini-labor-cost/1.0.0',
        estimateCostMinor: () => 5,
      },
      async execute() {
        unknownNetworkCalls += 1
        throw new Error('provider_network_failure')
      },
    }
    const combined = createLaborAiProviderRegistry([
      ...(['deterministic-success', 'deterministic-invalid-schema', 'deterministic-timeout', 'deterministic-failure'] as const)
        .map((id) => ({
          descriptor: registry.get(id)!.descriptor,
          execute: registry.get(id)!.execute.bind(registry.get(id)!),
        })),
      unknownNetworkAdapter,
    ])

    app = buildApp({
      clock: fixedClock('2026-07-17T12:30:00.000Z'),
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 100, windowMs: 60_000 } },
      laborAiProviders: combined,
    })
    managerCookie = await login('p44-manager@test.local')
    readOnlyCookie = await login('p44-readonly@test.local')
  }, 90_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  it('plan salt okunurdur ve provider kapalıyken start çağrı yapmadan provider_disabled kaydeder', async () => {
    const plan = await fetchPlan('deterministic-success')
    expect(plan.budget.enabled).toBe(false)
    expect(plan.canStart).toBe(false)
    expect(plan.privacy.policyVersion).toBe('labor-ai-pii/local-only')
    expect((await pool.query('SELECT count(*)::int AS n FROM labor_ai_suggestion_runs')).rows).toEqual([{ n: 0 }])

    const started = await startRun('deterministic-success')
    expect(started.statusCode).toBe(201)
    const run = laborAiRunResponseSchema.parse(started.json()).run
    expect(run.status).toBe('provider_disabled')
    expect(run.suggestion).toBeNull()
    expect(registry.getCallCount('deterministic-success')).toBe(0)
    const usage = await pool.query(
      "SELECT status,usage_module FROM ai_usage_ledger WHERE usage_module='labor_sheet'",
    )
    expect(usage.rows).toEqual([{ status: 'provider_disabled', usage_module: 'labor_sheet' }])
  })

  it('401, salt-okunur rol, tenant 404 ve kapalı case sınırlarını uygular', async () => {
    expect((await app.inject({ method: 'GET', url: runsUrl() })).statusCode).toBe(401)
    expect((await app.inject({
      method: 'POST', url: planUrl(),
      headers: { cookie: readOnlyCookie },
      payload: { damageDescription: DAMAGE, providerId: 'deterministic-success' },
    })).statusCode).toBe(403)
    expect((await app.inject({
      method: 'POST', url: planUrl(foreignCaseId),
      headers: { cookie: managerCookie },
      payload: { damageDescription: DAMAGE, providerId: 'deterministic-success' },
    })).statusCode).toBe(404)
    const closedPlan = await app.inject({
      method: 'POST', url: planUrl(closedCaseId),
      headers: { cookie: managerCookie },
      payload: { damageDescription: DAMAGE, providerId: 'deterministic-success' },
    })
    expect(laborAiPlanResponseSchema.parse(closedPlan.json()).canStart).toBe(false)
  })

  it('etkin sağlayıcıyla strict doğrulanmış öneri üretir ve idempotent replay ikinci çağrı yapmaz', async () => {
    await pool.query(
      `UPDATE ai_provider_policies
          SET labor_enabled=true,
              labor_allowed_provider_ids=ARRAY['deterministic-success','deterministic-invalid-schema','gemini-generate-content']::text[]
        WHERE organization_id=$1`,
      [organizationId],
    )
    const key = uuidv7()
    const damage = `${DAMAGE} Etkin senaryo.`
    const started = await startRun('deterministic-success', damage, key)
    expect(started.statusCode).toBe(201)
    const run = laborAiRunResponseSchema.parse(started.json()).run
    expect(run.status).toBe('review_required')
    expect(run.suggestion?.items).toHaveLength(2)
    expect(run.suggestion?.requiresHumanReview).toBe(true)
    expect(run.privacy.redactedValueCount).toBe(0)
    expect(registry.getCallCount('deterministic-success')).toBe(1)

    const plan = await fetchPlan('deterministic-success', damage)
    const replay = await app.inject({
      method: 'POST', url: runsUrl(),
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: key },
      payload: {
        damageDescription: damage,
        providerId: 'deterministic-success',
        expectedCaseVersion: plan.caseVersion,
        expectedSheetVersion: plan.baseSheetVersion,
        planHash: plan.planHash,
        confirmed: true,
      },
    })
    expect(replay.statusCode).toBe(201)
    expect(laborAiRunResponseSchema.parse(replay.json()).run.id).toBe(run.id)
    expect(registry.getCallCount('deterministic-success')).toBe(1)
    const usage = await pool.query(
      "SELECT count(*)::int AS n FROM ai_usage_ledger WHERE usage_module='labor_sheet' AND status='completed'",
    )
    expect(usage.rows).toEqual([{ n: 1 }])
  })

  it('stale plan hash veya yanlış föy sürümü version_conflict verir', async () => {
    const plan = await fetchPlan('deterministic-success')
    const stale = await app.inject({
      method: 'POST', url: runsUrl(),
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        damageDescription: `${DAMAGE} değişti`,
        providerId: 'deterministic-success',
        expectedCaseVersion: plan.caseVersion,
        expectedSheetVersion: plan.baseSheetVersion,
        planHash: plan.planHash,
        confirmed: true,
      },
    })
    expect(stale.statusCode).toBe(409)
  })

  it('geçersiz provider çıktısını raw saklamadan fail-closed yapar', async () => {
    const started = await startRun('deterministic-invalid-schema', `${DAMAGE} Geçersiz şema senaryosu.`)
    expect(started.statusCode).toBe(201)
    const run = laborAiRunResponseSchema.parse(started.json()).run
    expect(run.status).toBe('failed')
    expect(run.safeErrorCode).toBe('AI_OUTPUT_SCHEMA_INVALID')
    expect(run.suggestion).toBeNull()
    const receipt = await pool.query(
      `SELECT r.canonical_output,r.status FROM labor_ai_provider_receipts r
        JOIN labor_ai_suggestion_runs s ON s.id=r.labor_suggestion_run_id
       WHERE s.id=$1`,
      [run.id],
    )
    expect(receipt.rows[0]?.canonical_output).toBeNull()
    expect(receipt.rows[0]?.status).toBe('finalized')
    const persisted = await pool.query(
      'SELECT suggestion_items,reasoning FROM labor_ai_suggestion_runs WHERE id=$1',
      [run.id],
    )
    expect(persisted.rows).toEqual([{ suggestion_items: null, reasoning: null }])
  })

  it('bütçe hard-stop provider çağrısından önce çalışır', async () => {
    await pool.query(
      'UPDATE ai_provider_policies SET per_request_budget_minor=0 WHERE organization_id=$1',
      [organizationId],
    )
    const before = registry.getCallCount('deterministic-success')
    const started = await startRun('deterministic-success', `${DAMAGE} Bütçe senaryosu.`)
    await pool.query(
      'UPDATE ai_provider_policies SET per_request_budget_minor=100 WHERE organization_id=$1',
      [organizationId],
    )
    expect(started.statusCode).toBe(201)
    const run = laborAiRunResponseSchema.parse(started.json()).run
    expect(run.status).toBe('budget_blocked')
    expect(registry.getCallCount('deterministic-success')).toBe(before)
  })

  it('belirsiz network sonucunda otomatik retry yapmadan outcome_unknown kalır', async () => {
    const started = await startRun('gemini-generate-content', `${DAMAGE} Network senaryosu.`)
    expect(started.statusCode).toBe(200)
    const run = laborAiRunResponseSchema.parse(started.json()).run
    expect(run.status).toBe('outcome_unknown')
    expect(run.safeErrorCode).toBe('AI_PROVIDER_OUTCOME_UNKNOWN')
    expect(unknownNetworkCalls).toBe(1)
    expect(run.privacy.policyVersion).toBe('labor-ai-pii-redaction/1.0.0')
    expect(run.privacy.redactedValueCount).toBeGreaterThan(0)
  })

  it('review_required öneri föye ai_assisted provenance ile bağlanır; geçersiz run reddedilir', async () => {
    const runResult = await pool.query(
      "SELECT id FROM labor_ai_suggestion_runs WHERE status='review_required' LIMIT 1",
    )
    const runId = (runResult.rows[0] as { id: string }).id
    const invalid = await app.inject({
      method: 'POST', url: sheetUrl(),
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        expectedCaseVersion: 3,
        items: [{ description: 'Ön tampon kaplama', action: 'Değişim', partAmountMinor: 18_400_00, laborAmountMinor: 2_200_00 }],
        laborAiSuggestionRunId: uuidv7(),
        confirmed: true,
      },
    })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json().error.fieldErrors[0].path).toBe('laborAiSuggestionRunId')

    const created = await app.inject({
      method: 'POST', url: sheetUrl(),
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        expectedCaseVersion: 3,
        items: [{ description: 'Ön tampon kaplama', action: 'Değişim', partAmountMinor: 18_400_00, laborAmountMinor: 2_200_00 }],
        laborAiSuggestionRunId: runId,
        confirmed: true,
      },
    })
    expect(created.statusCode).toBe(201)
    const sheet = laborSheetResponseSchema.parse(created.json()).sheet
    expect(sheet.currentVersion.sourceType).toBe('ai_assisted')
    expect(sheet.currentVersion.laborAiSuggestionRunId).toBe(runId)
  })

  it('audit, run ve receipt sınırlarına hasar tarifi, PII veya path sızdırmaz', async () => {
    const audits = (await pool.query(
      "SELECT action,details FROM audit_events WHERE action LIKE 'labor_ai_suggestion.%'",
    )).rows
    expect(audits.length).toBeGreaterThan(0)
    const auditText = JSON.stringify(audits)
    const runsText = JSON.stringify((await pool.query(
      'SELECT plan_hash,outbound_payload_hash,privacy_warnings,safe_error_code FROM labor_ai_suggestion_runs',
    )).rows)
    for (const text of [auditText, runsText]) {
      expect(text).not.toMatch(/Ayşe|Yılmaz|ayse@example|0532 111|çamurluk hasarlı|[A-Z]:\\|password|secret/i)
    }
  })
})
