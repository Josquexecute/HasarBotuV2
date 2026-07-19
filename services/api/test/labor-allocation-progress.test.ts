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
 * Paket 62 — analiz ilerlemesi, iptal ve dayanıklılık.
 *
 * Analiz artık arka planda çalışır; bu kuşak durum modelinin, gerçek
 * ilerlemenin ve iptalin deterministik sağlayıcıyla doğrulanmasıdır.
 */
const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'p62-sentetik-guclu-parola-62'
const NOW = '2026-07-19T22:00:00.000Z'

function chunkIndexOf(providerRequestId: string): number {
  const parts = providerRequestId.split(':')
  return Number(parts[parts.length - 1])
}

function chunkOutput(lines: readonly { ordinal: number; partAmountMinor: number; laborAmountMinor: number }[]) {
  return {
    schemaVersion: LABOR_ALLOCATION_OUTPUT_SCHEMA_VERSION,
    operationTypesVersion: LABOR_OPERATION_TYPES_VERSION,
    lines: lines.map((line) => {
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
        economicComparison: { buckets, ...computeEconomicTotals(buckets), note: 'Sentetik.' },
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

/** Testin çağrıları adım adım serbest bırakabildiği sağlayıcı. */
function gatedAdapter(behaviour: { readonly failChunkIndex?: number; readonly failCode?: string } = {}) {
  const gates: (() => void)[] = []
  const arrived: number[] = []
  let paused = false
  return {
    pause() { paused = true },
    releaseAll() { for (const gate of gates.splice(0)) gate() },
    arrived,
    adapter: {
      providerId: 'gemini-generate-content',
      providerVersion: 'progress-test/1.0.0',
      modelId: 'progress-test',
      externalProvider: true,
      retentionMode: 'free_tier_product_improvement' as const,
      pricingVersion: 'progress-test/1.0.0',
      maximumInputCharacters: 400_000,
      estimateCostMinor: () => 1,
      async execute(request: { providerRequestId: string; context: never }, signal: AbortSignal) {
        const index = chunkIndexOf(request.providerRequestId)
        arrived.push(index)
        if (paused) {
          await new Promise<void>((resolve, reject) => {
            gates.push(resolve)
            signal.addEventListener('abort', () => reject(
              new LaborAllocationProviderExecutionError('aborted', 'unknown', 'AI_PROVIDER_TIMEOUT'),
            ), { once: true })
          })
        }
        if (behaviour.failChunkIndex === index) {
          throw new LaborAllocationProviderExecutionError(
            'synthetic', 'response_received', behaviour.failCode ?? 'AI_PROVIDER_FAILED',
          )
        }
        const context = request.context as unknown as {
          lines: { ordinal: number; partAmountMinor: number; laborAmountMinor: number }[]
        }
        const output = chunkOutput(context.lines)
        return {
          output,
          usage: {
            inputCharacters: 1_000,
            outputCharacters: JSON.stringify(output).length,
            inputTokens: 100,
            outputTokens: 200,
            estimatedCostMinor: 1,
            actualCostMinor: 1,
          },
          diagnostics: { finishReason: 'STOP', retryCount: 0 },
        }
      },
    },
  }
}

describeDb('Paket 62 analiz ilerlemesi ve iptali', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let organizationId: string
  let userId: string
  let sequence = 6200

  async function makeApp(adapter: ReturnType<typeof gatedAdapter>['adapter']) {
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
      payload: { email: 'p62@test.local', password: PASSWORD },
    })
    return { app, cookie: String(login.headers['set-cookie']).split(';')[0] as string }
  }

  async function seedCase(app: FastifyInstance, cookie: string, lineCount: number) {
    sequence += 1
    const caseId = uuidv7()
    await pool.query(
      `INSERT INTO cases
         (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
          workflow_stage,plate,plate_normalized,responsible_user_id,notification_date,version)
       VALUES ($1,$2,2026,$3,$4,'traffic','open','reporting',$5,$6,$7,'2026-07-01',1)`,
      [
        caseId, organizationId, sequence, `2026/${sequence}`,
        `34 PR ${sequence}`, `34PR${sequence}`, userId,
      ],
    )
    const items = Array.from({ length: lineCount }, (_unused, index) => ({
      description: `Kalem ${index + 1}`,
      action: 'Onarim',
      partAmountMinor: 0,
      laborAmountMinor: 100_000 + index,
    }))
    const sheet = await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/labor-sheet`,
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedCaseVersion: 1, confirmed: true, items },
    })
    expect(sheet.statusCode).toBe(201)
    return caseId
  }

  const start = (app: FastifyInstance, cookie: string, caseId: string) => app.inject({
    method: 'POST', url: `/api/v1/cases/${caseId}/labor-allocation-ai/analyze`,
    headers: { cookie },
    payload: { expectedSheetVersion: 1, damageDescription: 'Coklu darbe.', confirmedEgress: true },
  })

  const readRun = (app: FastifyInstance, cookie: string, caseId: string, runId: string) => app.inject({
    method: 'GET', url: `/api/v1/cases/${caseId}/labor-allocation-ai/${runId}`, headers: { cookie },
  })

  const parse = (response: { json: () => unknown }) =>
    laborAllocationRunResponseSchema.parse(response.json()).run

  /** Belirli sayıda grup sağlayıcıya ulaşana kadar bekler. */
  async function waitForArrivals(provider: ReturnType<typeof gatedAdapter>, count: number) {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      if (provider.arrived.length >= count) return
      await new Promise((resolve) => { setTimeout(resolve, 10) })
    }
    throw new Error(`CHUNK_DID_NOT_ARRIVE_${count}`)
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })

    organizationId = uuidv7()
    userId = uuidv7()
    await pool.query(
      "INSERT INTO organizations (id,code,name) VALUES ($1,'p62','P62 Progress')",
      [organizationId],
    )
    await pool.query(
      `INSERT INTO users (id,organization_id,email,display_name,password_hash)
       VALUES ($1,$2,'p62@test.local','P62 Yetkili',$3)`,
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

  it('analiz hemen run kimliği ve aktif durum döner', async () => {
    const provider = gatedAdapter()
    provider.pause()
    const { app, cookie } = await makeApp(provider.adapter)
    try {
      const caseId = await seedCase(app, cookie, 5)
      const response = await start(app, cookie, caseId)
      expect(response.statusCode).toBe(200)
      const run = parse(response)
      expect(run.id).toBeTruthy()
      expect(['queued', 'running']).toContain(run.status)
      // Gerçek ilerleme alanları başından itibaren doğrudur.
      expect(run.progress.totalLineCount).toBe(5)
      expect(run.progress.totalChunkCount).toBe(1)
      expect(run.progress.completedChunkCount).toBe(0)
      expect(run.progress.processedLineCount).toBe(0)
      expect(run.progress.startedAt).not.toBeNull()
      provider.releaseAll()
      await waitForRunTerminal(app, cookie, caseId, response)
    } finally {
      provider.releaseAll()
      await app.close()
    }
  })

  it('çok gruplu analizde ilerleme grup grup ilerler', async () => {
    const provider = gatedAdapter()
    provider.pause()
    const { app, cookie } = await makeApp(provider.adapter)
    try {
      // 5 grup: 4 tam + 1 kısmi.
      const lineCount = LABOR_ALLOCATION_CHUNK_SIZE * 4 + 3
      const caseId = await seedCase(app, cookie, lineCount)
      const started = await start(app, cookie, caseId)
      const runId = parse(started).id

      await waitForArrivals(provider, 1)
      let current = parse(await readRun(app, cookie, caseId, runId))
      expect(current.progress.totalChunkCount).toBe(5)
      expect(current.progress.completedChunkCount).toBe(0)

      // İlk grubu serbest bırak; ikinci gruba geçilir.
      provider.releaseAll()
      await waitForArrivals(provider, 2)
      current = parse(await readRun(app, cookie, caseId, runId))
      expect(current.progress.completedChunkCount).toBe(1)
      expect(current.progress.processedLineCount).toBe(LABOR_ALLOCATION_CHUNK_SIZE)
      expect(current.status).toBe('running')

      provider.releaseAll()
      await waitForArrivals(provider, 3)
      current = parse(await readRun(app, cookie, caseId, runId))
      expect(current.progress.completedChunkCount).toBe(2)
      expect(current.progress.processedLineCount).toBe(LABOR_ALLOCATION_CHUNK_SIZE * 2)

      // Kalanları bitir.
      for (let step = 0; step < 6; step += 1) {
        provider.releaseAll()
        await new Promise((resolve) => { setTimeout(resolve, 20) })
      }
      const settled = parse(await waitForRunTerminal(app, cookie, caseId, started))
      expect(settled.status).toBe('review_required')
      expect(settled.progress.completedChunkCount).toBe(5)
      expect(settled.progress.processedLineCount).toBe(lineCount)
      expect(settled.suggestion?.lines).toHaveLength(lineCount)
    } finally {
      provider.releaseAll()
      await app.close()
    }
  })

  it('sayfadan ayrılıp dönünce mevcut durum okunabilir ve iş devam eder', async () => {
    const provider = gatedAdapter()
    provider.pause()
    const { app, cookie } = await makeApp(provider.adapter)
    try {
      const caseId = await seedCase(app, cookie, LABOR_ALLOCATION_CHUNK_SIZE * 2)
      const started = await start(app, cookie, caseId)
      const runId = parse(started).id
      await waitForArrivals(provider, 1)

      // "Sayfadan ayrılma": istemci hiçbir şey yapmaz, iş sürer.
      provider.releaseAll()
      await waitForArrivals(provider, 2)
      provider.releaseAll()

      // "Geri dönme": çalışma alanı okunduğunda run görünür.
      const workspace = await app.inject({
        method: 'GET', url: `/api/v1/cases/${caseId}/labor-allocation-ai`, headers: { cookie },
      })
      expect(workspace.statusCode).toBe(200)
      const runs = (workspace.json() as { runs: { id: string }[] }).runs
      expect(runs.some((item) => item.id === runId)).toBe(true)

      const settled = parse(await waitForRunTerminal(app, cookie, caseId, started))
      expect(settled.status).toBe('review_required')
    } finally {
      provider.releaseAll()
      await app.close()
    }
  })

  it('aynı föy sürümü için ikinci analiz başlatılamaz', async () => {
    const provider = gatedAdapter()
    provider.pause()
    const { app, cookie } = await makeApp(provider.adapter)
    try {
      const caseId = await seedCase(app, cookie, 5)
      const first = await start(app, cookie, caseId)
      expect(first.statusCode).toBe(200)
      await waitForArrivals(provider, 1)

      const second = await start(app, cookie, caseId)
      expect(second.statusCode).toBe(409)
      expect((second.json() as { error: { code: string } }).error.code).toBe('conflict')

      // Yalnız TEK run oluşmuştur.
      const runs = await pool.query(
        'SELECT count(*)::int AS n FROM labor_allocation_runs WHERE case_id=$1',
        [caseId],
      )
      expect(runs.rows[0].n).toBe(1)

      provider.releaseAll()
      await waitForRunTerminal(app, cookie, caseId, first)
    } finally {
      provider.releaseAll()
      await app.close()
    }
  })

  it('iptal aktif çağrıyı durdurur ve kısmi öneri sızmaz', async () => {
    const provider = gatedAdapter()
    provider.pause()
    const { app, cookie } = await makeApp(provider.adapter)
    try {
      const caseId = await seedCase(app, cookie, LABOR_ALLOCATION_CHUNK_SIZE * 3)
      const started = await start(app, cookie, caseId)
      const runId = parse(started).id
      await waitForArrivals(provider, 1)
      // İlk grup tamamlansın, ikinci grup beklerken iptal edilsin.
      provider.releaseAll()
      await waitForArrivals(provider, 2)

      const cancelled = await app.inject({
        method: 'POST', url: `/api/v1/cases/${caseId}/labor-allocation-ai/${runId}/cancel`,
        headers: { cookie },
      })
      expect(cancelled.statusCode).toBe(200)
      const afterCancel = parse(cancelled)
      // İptal isteği kaydedildi; sonuç henüz kesin değilse "iptal edildi" denmez.
      expect(['cancel_requested', 'cancelled']).toContain(afterCancel.status)
      expect(afterCancel.progress.cancelRequestedAt).not.toBeNull()

      const settled = parse(await waitForRunTerminal(app, cookie, caseId, started))
      expect(settled.status).toBe('cancelled')
      expect(settled.suggestion).toBeNull()

      // Kısmi öneri sızıntısı yok.
      const stored = await pool.query(
        'SELECT count(*)::int AS n FROM labor_allocation_line_suggestions WHERE case_id=$1',
        [caseId],
      )
      expect(stored.rows[0].n).toBe(0)
    } finally {
      provider.releaseAll()
      await app.close()
    }
  })

  it('terminal run iptal edilemez', async () => {
    const provider = gatedAdapter()
    const { app, cookie } = await makeApp(provider.adapter)
    try {
      const caseId = await seedCase(app, cookie, 3)
      const started = await start(app, cookie, caseId)
      const settled = parse(await waitForRunTerminal(app, cookie, caseId, started))
      expect(settled.status).toBe('review_required')

      const response = await app.inject({
        method: 'POST', url: `/api/v1/cases/${caseId}/labor-allocation-ai/${settled.id}/cancel`,
        headers: { cookie },
      })
      expect(response.statusCode).toBe(409)
    } finally {
      await app.close()
    }
  })

  it('grup ortasındaki 429 ayrı güvenli kodla raporlanır ve kısmi sonuç bırakmaz', async () => {
    const provider = gatedAdapter({ failChunkIndex: 1, failCode: 'AI_PROVIDER_RATE_LIMITED' })
    const { app, cookie } = await makeApp(provider.adapter)
    try {
      const caseId = await seedCase(app, cookie, LABOR_ALLOCATION_CHUNK_SIZE * 3)
      const started = await start(app, cookie, caseId)
      const settled = parse(await waitForRunTerminal(app, cookie, caseId, started))

      expect(settled.status).toBe('failed')
      expect(settled.safeErrorCode).toBe('AI_PROVIDER_RATE_LIMITED')
      expect(settled.suggestion).toBeNull()
      // İlk grup tamamlanmıştı; ilerleme dürüstçe 1 grup gösterir.
      expect(settled.progress.completedChunkCount).toBe(1)

      const stored = await pool.query(
        'SELECT count(*)::int AS n FROM labor_allocation_line_suggestions WHERE case_id=$1',
        [caseId],
      )
      expect(stored.rows[0].n).toBe(0)

      // Ledger ve makbuz kayıtları korunur: gerçekleşen çağrı muhasebeleşir.
      const receipts = await pool.query(
        'SELECT count(*)::int AS n FROM labor_allocation_provider_receipts WHERE case_id=$1',
        [caseId],
      )
      expect(receipts.rows[0].n).toBe(2)
      const ledger = await pool.query(
        `SELECT count(*)::int AS rows,sum(input_tokens)::int AS input_tokens
           FROM ai_usage_ledger WHERE case_id=$1 AND usage_module='labor_allocation'`,
        [caseId],
      )
      expect(ledger.rows[0].rows).toBe(1)
      expect(ledger.rows[0].input_tokens).toBe(100)
    } finally {
      await app.close()
    }
  })

  it('başarısız run sonrası yeniden deneme YENİ run oluşturur; eskisi değişmez', async () => {
    const failing = gatedAdapter({ failChunkIndex: 0, failCode: 'AI_PROVIDER_FAILED' })
    const first = await makeApp(failing.adapter)
    const caseId = await seedCase(first.app, first.cookie, 5)
    const failedRun = parse(await waitForRunTerminal(
      first.app, first.cookie, caseId, await start(first.app, first.cookie, caseId),
    ))
    expect(failedRun.status).toBe('failed')
    await first.app.close()

    const healthy = gatedAdapter()
    const second = await makeApp(healthy.adapter)
    try {
      const retried = parse(await waitForRunTerminal(
        second.app, second.cookie, caseId, await start(second.app, second.cookie, caseId),
      ))
      expect(retried.status).toBe('review_required')
      // Yeni ve ayrı bir run; önceki değişmedi.
      expect(retried.id).not.toBe(failedRun.id)
      const previous = parse(await readRun(second.app, second.cookie, caseId, failedRun.id))
      expect(previous.status).toBe('failed')
      expect(previous.suggestion).toBeNull()
    } finally {
      await second.app.close()
    }
  })
})
