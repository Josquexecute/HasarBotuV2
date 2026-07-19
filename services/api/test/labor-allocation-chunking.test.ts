import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AUTH_LOGIN_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  laborAllocationRunResponseSchema,
} from '@hasarbotu/contracts'
import {
  LABOR_ALLOCATION_CHUNK_SIZE,
  LABOR_ALLOCATION_OUTPUT_SCHEMA_VERSION,
  LABOR_OPERATION_TYPES_VERSION,
  computeEconomicTotals,
} from '@hasarbotu/domain'
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
  LaborAllocationProviderExecutionError,
  buildApp,
  createLaborAllocationProviderRegistry,
  fixedClock,
  hashPassword,
} from '../src/index.js'

/**
 * Paket 61 — büyük föy chunking'i (HB-2026-068).
 *
 * Gerçek Gemini yük ölçümü sağlayıcı kotasına bağlıdır ve CI'da koşmaz; bu
 * kuşak chunking değişmezlerini deterministik sağlayıcıyla korur.
 */
const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'p61-sentetik-guclu-parola-61'
const NOW = '2026-07-19T21:00:00.000Z'

/** Chunk indeksini `providerRequestId` sonekinden okur (`runId:index`). */
function chunkIndexOf(providerRequestId: string): number {
  const parts = providerRequestId.split(':')
  return Number(parts[parts.length - 1])
}

function chunkOutput(context: { lines: readonly { ordinal: number; partAmountMinor: number; laborAmountMinor: number }[] }) {
  return {
    schemaVersion: LABOR_ALLOCATION_OUTPUT_SCHEMA_VERSION,
    operationTypesVersion: LABOR_OPERATION_TYPES_VERSION,
    lines: context.lines.map((line) => {
      const total = line.partAmountMinor + line.laborAmountMinor
      const buckets = {
        repair_labor: total,
        new_part_or_ownership: 0,
        remove_install: 0,
        paint_and_consumable: 0,
        calibration: 0,
        related_operations: 0,
      }
      return {
        lineOrdinal: line.ordinal,
        allocations: [{ operationType: 'repair', amountMinor: total }],
        repairReplaceOpinion: 'repair_indicated',
        economicComparison: { buckets, ...computeEconomicTotals(buckets), note: 'Sentetik karsilastirma.' },
        reasoning: 'Sentetik gerekce.',
        evidenceRefs: [],
        confidence: 0.55,
        conflictCodes: [],
        missingEvidenceCodes: [],
        controlRequired: true,
      }
    }),
    requiresHumanReview: true,
  }
}

/** Her grubu doğru satır sayısıyla yanıtlayan sentetik sağlayıcı. */
function chunkAwareAdapter(behaviour: {
  readonly failChunkIndex?: number
  readonly dropLineInChunkIndex?: number
} = {}) {
  const calls: number[] = []
  return {
    adapter: {
      /*
       * Migration 0031 CHECK'i `gemini-generate-content` kimliğini DIŞ
       * sağlayıcı olmaya zorlar (redaction politikası + retention modu).
       * Sentetik adaptör bu sözleşmeye uyar; kısıt gevşetilmez.
       */
      providerId: 'gemini-generate-content',
      providerVersion: 'chunk-test/1.0.0',
      modelId: 'chunk-test',
      externalProvider: true,
      retentionMode: 'free_tier_product_improvement' as const,
      pricingVersion: 'chunk-test/1.0.0',
      maximumInputCharacters: 400_000,
      estimateCostMinor: () => 1,
      async execute(request: { providerRequestId: string; context: never }) {
        const index = chunkIndexOf(request.providerRequestId)
        calls.push(index)
        if (behaviour.failChunkIndex === index) {
          throw new LaborAllocationProviderExecutionError(
            'synthetic failure', 'response_received', 'AI_PROVIDER_FAILED',
          )
        }
        const context = request.context as unknown as {
          lines: { ordinal: number; partAmountMinor: number; laborAmountMinor: number }[]
        }
        const output = chunkOutput(
          behaviour.dropLineInChunkIndex === index
            ? { lines: context.lines.slice(0, -1) }
            : context,
        )
        const text = JSON.stringify(output)
        return {
          output,
          usage: {
            inputCharacters: 1_000,
            outputCharacters: text.length,
            inputTokens: 100,
            outputTokens: 200,
            estimatedCostMinor: 1,
            actualCostMinor: 1,
          },
          diagnostics: { finishReason: 'STOP', retryCount: 0 },
        }
      },
    },
    calls,
  }
}

describeDb('Paket 61 büyük föy chunking', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let organizationId: string
  let userId: string

  async function makeApp(adapter: ReturnType<typeof chunkAwareAdapter>['adapter']) {
    const app = buildApp({
      clock: fixedClock(NOW),
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 500, windowMs: 60_000 } },
      laborAllocationProviders: createLaborAllocationProviderRegistry({ gemini: adapter as never }),
      laborAllocationProviderId: 'gemini-generate-content',
    })
    await app.ready()
    const login = await app.inject({
      method: 'POST', url: AUTH_LOGIN_ROUTE,
      payload: { email: 'p61-chunk@test.local', password: PASSWORD },
    })
    expect(login.statusCode).toBe(200)
    return { app, cookie: String(login.headers['set-cookie']).split(';')[0] as string }
  }

  async function seedCase(app: FastifyInstance, cookie: string, sequence: number, lineCount: number) {
    const caseId = uuidv7()
    await pool.query(
      `INSERT INTO cases
         (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
          workflow_stage,plate,plate_normalized,responsible_user_id,notification_date,version)
       VALUES ($1,$2,2026,$3,$4,'traffic','open','reporting',$5,$6,$7,'2026-07-01',1)`,
      [
        caseId, organizationId, sequence, `2026/${sequence}`,
        `34 CH ${sequence}`, `34CH${sequence}`, userId,
      ],
    )
    const items = Array.from({ length: lineCount }, (_unused, index) => ({
      description: `Kalem ${index + 1}`,
      action: 'Onarim',
      partAmountMinor: 0,
      laborAmountMinor: 100_000 + index * 1_000,
    }))
    const sheet = await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/labor-sheet`,
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedCaseVersion: 1, confirmed: true, items },
    })
    expect(sheet.statusCode).toBe(201)
    return caseId
  }

  const analyze = async (app: FastifyInstance, cookie: string, caseId: string) =>
    waitForRunTerminal(app, cookie, caseId, await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/labor-allocation-ai/analyze`,
      headers: { cookie },
      payload: { expectedSheetVersion: 1, damageDescription: 'Coklu bolge darbe.', confirmedEgress: true },
    }))

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })

    organizationId = uuidv7()
    userId = uuidv7()
    await pool.query(
      "INSERT INTO organizations (id,code,name) VALUES ($1,'p61-chunk','P61 Chunk')",
      [organizationId],
    )
    await pool.query(
      `INSERT INTO users (id,organization_id,email,display_name,password_hash)
       VALUES ($1,$2,'p61-chunk@test.local','P61 Yetkili',$3)`,
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
       VALUES ($1,$2,true,ARRAY['gemini-generate-content']::text[],100000000,100000000)`,
      [uuidv7(), organizationId],
    )
  })

  afterAll(async () => {
    await closeDatabasePool(pool)
  })

  it('chunk sınırının altındaki föy TEK çağrıyla işlenir', async () => {
    const provider = chunkAwareAdapter()
    const { app, cookie } = await makeApp(provider.adapter)
    try {
      const caseId = await seedCase(app, cookie, 6110, LABOR_ALLOCATION_CHUNK_SIZE - 5)
      const response = await analyze(app, cookie, caseId)
      expect(response.statusCode).toBe(200)
      const run = laborAllocationRunResponseSchema.parse(response.json()).run
      expect(run.status).toBe('review_required')
      expect(provider.calls).toEqual([0])
      expect(run.suggestion?.lines).toHaveLength(LABOR_ALLOCATION_CHUNK_SIZE - 5)
    } finally {
      await app.close()
    }
  })

  it('büyük föy deterministik gruplara bölünür ve tam kapsamayla birleşir', async () => {
    const provider = chunkAwareAdapter()
    const { app, cookie } = await makeApp(provider.adapter)
    try {
      const lineCount = LABOR_ALLOCATION_CHUNK_SIZE * 2 + 7
      const caseId = await seedCase(app, cookie, 6111, lineCount)
      const response = await analyze(app, cookie, caseId)
      expect(response.statusCode).toBe(200)
      const run = laborAllocationRunResponseSchema.parse(response.json()).run

      expect(run.status).toBe('review_required')
      expect(provider.calls).toEqual([0, 1, 2])
      const lines = run.suggestion?.lines ?? []
      expect(lines).toHaveLength(lineCount)
      // Her satır tam olarak bir kez, global sırada.
      expect(lines.map((line) => line.lineOrdinal))
        .toEqual(Array.from({ length: lineCount }, (_unused, index) => index + 1))
      // Kaynak satır eşlemesi doğru: son satırın kaynak tutarı föydeki son satır.
      expect(lines[lineCount - 1]?.sourceLaborAmountMinor).toBe(100_000 + (lineCount - 1) * 1_000)

      // Her alt çağrı kendi makbuzunu üretir.
      const receipts = await pool.query(
        `SELECT count(*)::int AS n,count(DISTINCT client_request_id)::int AS distinct_ids
           FROM labor_allocation_provider_receipts WHERE case_id=$1`,
        [caseId],
      )
      expect(receipts.rows[0].n).toBe(3)
      expect(receipts.rows[0].distinct_ids).toBe(3)

      // Ledger bütün alt çağrıların GERÇEK toplamını taşır.
      const ledger = await pool.query(
        `SELECT count(*)::int AS rows,sum(input_tokens)::int AS input_tokens,
                sum(output_tokens)::int AS output_tokens
           FROM ai_usage_ledger WHERE case_id=$1 AND usage_module='labor_allocation'`,
        [caseId],
      )
      expect(ledger.rows[0].rows).toBe(1)
      expect(ledger.rows[0].input_tokens).toBe(300)
      expect(ledger.rows[0].output_tokens).toBe(600)
    } finally {
      await app.close()
    }
  })

  it('bir grup düşerse TÜM run düşer ve hiçbir satır kaydedilmez', async () => {
    const provider = chunkAwareAdapter({ failChunkIndex: 1 })
    const { app, cookie } = await makeApp(provider.adapter)
    try {
      const caseId = await seedCase(app, cookie, 6112, LABOR_ALLOCATION_CHUNK_SIZE * 2)
      const response = await analyze(app, cookie, caseId)
      expect(response.statusCode).toBe(200)
      const run = laborAllocationRunResponseSchema.parse(response.json()).run

      expect(run.status).toBe('failed')
      expect(run.suggestion).toBeNull()
      // İkinci grup düştüğü için üçüncüye hiç geçilmez; kısmi sonuç yok.
      expect(provider.calls).toEqual([0, 1])
      const stored = await pool.query(
        'SELECT count(*)::int AS n FROM labor_allocation_line_suggestions WHERE case_id=$1',
        [caseId],
      )
      expect(stored.rows[0].n).toBe(0)
    } finally {
      await app.close()
    }
  })

  it('bir grup eksik satır döndürürse run düşer (sessiz tamamlama yok)', async () => {
    const provider = chunkAwareAdapter({ dropLineInChunkIndex: 0 })
    const { app, cookie } = await makeApp(provider.adapter)
    try {
      const caseId = await seedCase(app, cookie, 6113, LABOR_ALLOCATION_CHUNK_SIZE * 2)
      const response = await analyze(app, cookie, caseId)
      expect(response.statusCode).toBe(200)
      const run = laborAllocationRunResponseSchema.parse(response.json()).run

      expect(run.status).toBe('failed')
      expect(run.safeErrorCode).toBe('AI_OUTPUT_LINE_COVERAGE_INVALID')
      const stored = await pool.query(
        'SELECT count(*)::int AS n FROM labor_allocation_line_suggestions WHERE case_id=$1',
        [caseId],
      )
      expect(stored.rows[0].n).toBe(0)
    } finally {
      await app.close()
    }
  })
})
