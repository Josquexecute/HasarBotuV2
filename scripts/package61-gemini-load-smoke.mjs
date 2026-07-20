import {
  assertTestDatabaseUrl,
  closeDatabasePool,
  createDatabasePool,
  runMigrations,
  uuidv7,
} from '../packages/database/dist/index.js'
import {
  buildApp,
  createGeminiLaborAllocationProvider,
  createLaborAllocationProviderRegistry,
  fixedClock,
  hashPassword,
} from '../services/api/dist/index.js'

/**
 * Paket 61 — İSTEĞE BAĞLI gerçek Gemini YÜK ölçümü.
 *
 * Amaç: büyük föylerde tek çağrının güvenilir olup olmadığını ÖLÇMEK. Ölçüm
 * yapılmadan timeout tavanı yükseltilmez, domain doğrulaması gevşetilmez ve
 * chunking eklenmez.
 *
 * Çalıştırma:
 *   $env:GEMINI_API_KEY="..."            (yalnız yerel ortam; log'a yazılmaz)
 *   $env:GEMINI_LABOR_ALLOCATION_MANUAL_SMOKE="true"
 *   $env:TEST_DATABASE_URL="postgres://hasarbotu_test:...@127.0.0.1:5432/hasarbotu_test"
 *   node scripts/package61-gemini-load-smoke.mjs
 *
 * Rapora ASLA girmeyenler: API anahtarı, ham prompt, ham model yanıtı, PII.
 * Yalnız sayaçlar, kapalı küme kodları ve süreler raporlanır. Föyler
 * sentetiktir; gerçek müşteri verisi kullanılmaz.
 */
if (process.env.GEMINI_LABOR_ALLOCATION_MANUAL_SMOKE !== 'true') {
  console.log(JSON.stringify({
    skipped: true,
    reason: 'GEMINI_LABOR_ALLOCATION_MANUAL_SMOKE is not true; manual opt-in required.',
  }))
  process.exit(0)
}
const apiKey = process.env.GEMINI_API_KEY
if (apiKey === undefined || apiKey.trim().length === 0) {
  throw new Error('GEMINI_API_KEY_REQUIRED_FOR_LOAD_SMOKE')
}
const DATABASE_URL = process.env.TEST_DATABASE_URL
if (DATABASE_URL === undefined || DATABASE_URL.length === 0) {
  throw new Error('TEST_DATABASE_URL_REQUIRED_FOR_LOAD_SMOKE')
}

const LINE_COUNTS = (process.env.GEMINI_LOAD_LINE_COUNTS ?? '1,2,5,10,20')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isSafeInteger(value) && value > 0)

/** Windows'ta undici keep-alive soketleri süreç çıkışında assertion tetikler. */
async function closeGlobalFetchSockets() {
  try {
    const dispatcher = globalThis[Symbol.for('undici.globalDispatcher.1')]
    if (dispatcher !== undefined && typeof dispatcher.close === 'function') {
      await dispatcher.close()
    }
  } catch {
    // Kapanış temizliği sonucu maskelemez.
  }
}

function sanitizeToken(value) {
  return String(value).slice(0, 48).replace(/[^A-Za-z0-9_/.:\-]/g, '?')
}

/**
 * Gerçekçi ama tamamen sentetik föy satırları. Gerçek plaka, kişi, şirket veya
 * dosya bilgisi YOKTUR; kalem adları jenerik parça sözlüğünden türetilir.
 */
const PARTS = [
  'On tampon', 'Arka tampon', 'Sol on camurluk', 'Sag on camurluk',
  'Sol arka kapi', 'Sag arka kapi', 'Motor kaputu', 'Bagaj kapagi',
  'Sol on far', 'Sag on far', 'Sol ayna', 'Sag ayna',
  'On panel', 'Arka panel', 'Sol marspiyel', 'Sag marspiyel',
  'On cam', 'Arka cam', 'Radyator', 'Klima kondenseri',
]
const ACTIONS = ['Onarim', 'Degisim', 'Onarim + boya', 'Sokme-takma', 'Boya']

function syntheticSheet(lineCount) {
  return Array.from({ length: lineCount }, (unused, index) => {
    const part = PARTS[index % PARTS.length]
    const action = ACTIONS[index % ACTIONS.length]
    const replaceShaped = action === 'Degisim'
    // Deterministik ama tekdüze olmayan tutarlar (kurus).
    const base = 50_000 + ((index * 37) % 40) * 12_500
    return {
      description: `${part} ${Math.floor(index / PARTS.length) + 1}`,
      action,
      partAmountMinor: replaceShaped ? base * 3 : 0,
      laborAmountMinor: replaceShaped ? Math.floor(base / 2) : base,
    }
  })
}

/**
 * Gerçek sağlayıcıyı saran ölçüm dekoratörü. Sözleşmeyi değiştirmez; yalnız
 * süre, retry ve `finishReason` gibi YAPISAL teşhisi kaydeder.
 */
function instrument(adapter, sink) {
  return {
    ...adapter,
    async execute(request, signal) {
      const startedAt = Date.now()
      try {
        const response = await adapter.execute(request, signal)
        sink.push({
          outcome: 'ok',
          durationMs: Date.now() - startedAt,
          finishReason: response.diagnostics?.finishReason ?? null,
          retryCount: response.diagnostics?.retryCount ?? 0,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          outputCharacters: response.usage.outputCharacters,
        })
        return response
      } catch (error) {
        sink.push({
          outcome: 'error',
          durationMs: Date.now() - startedAt,
          finishReason: error?.diagnostics?.finishReason ?? null,
          retryCount: error?.diagnostics?.retryCount ?? 0,
          safeErrorCode: sanitizeToken(error?.safeDiagnosticCode ?? 'unknown'),
          requestOutcome: sanitizeToken(error?.requestOutcome ?? 'unknown'),
        })
        throw error
      }
    },
  }
}

/**
 * KOTA KORUMASI (P64 ara dilim).
 *
 * Ücretsiz katman kotası bir 5'li seriyi zor kaldırıyor. Bu koruma gerçek
 * çağrı HARCAMADAN uygulanır ve üretim davranışını DEĞİŞTİRMEZ; yalnız ölçüm
 * betiğinin gereksiz çağrı yakmasını engeller.
 *
 * - `GEMINI_LOAD_MAX_CALLS`: tek koşumda izin verilen toplam sağlayıcı çağrısı.
 * - İlk `AI_PROVIDER_RATE_LIMITED` sonucunda kalan tekrarlar ÇALIŞTIRILMAZ.
 * - `Retry-After` sağlayıcı tarafından güvenli biçimde yüzeye çıkarılmıyor;
 *   bu yüzden TAHMİN ÜRETİLMEZ, yokluğu açıkça raporlanır.
 */
const MAX_PROVIDER_CALLS = Math.max(1, Number(process.env.GEMINI_LOAD_MAX_CALLS ?? '12') || 12)

/** Aynı boyut için ardışık gerçek tekrar; kapı 5 ardışık başarı ister. */
const REPEATS = Math.max(1, Number(process.env.GEMINI_LOAD_REPEATS ?? '1') || 1)

const config = assertTestDatabaseUrl(DATABASE_URL)
const pool = createDatabasePool({ config })
const PASSWORD = 'p61-load-smoke-sentetik-parola'
const providerCalls = []
const baseProvider = createGeminiLaborAllocationProvider({
  apiKey: apiKey.trim(),
  modelId: process.env.GEMINI_LABOR_ALLOCATION_MODEL ?? 'gemini-3.5-flash',
  maximumInputCharacters: 400_000,
  maximumOutputSize: 400_000,
  maximumOutputTokens: Number(process.env.GEMINI_LABOR_ALLOCATION_MAX_OUTPUT_TOKENS ?? 65_536),
})

let app
try {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await runMigrations({ databaseUrl: config.url, quiet: true })

  const organizationId = uuidv7()
  const userId = uuidv7()
  await pool.query(
    "INSERT INTO organizations (id,code,name) VALUES ($1,'p61-load','P61 Load')",
    [organizationId],
  )
  await pool.query(
    `INSERT INTO users (id,organization_id,email,display_name,password_hash,status)
     VALUES ($1,$2,'p61-load@test.local','P61 Yetkili',$3,'active')`,
    [userId, organizationId, await hashPassword(PASSWORD)],
  )
  await pool.query(
    "INSERT INTO user_roles (user_id,role_id) SELECT $1::uuid,id FROM roles WHERE code='admin'",
    [userId],
  )
  // Mevcut politika tavanı KORUNUR: 30 sn, ölçüm yapılmadan yükseltilmez.
  await pool.query(
    `INSERT INTO ai_provider_policies
       (id,organization_id,labor_allocation_enabled,labor_allocation_allowed_provider_ids,
        monthly_budget_minor,per_request_budget_minor,request_timeout_ms)
     VALUES ($1,$2,true,ARRAY['gemini-generate-content']::text[],100000000,100000000,30000)`,
    [uuidv7(), organizationId],
  )

  app = buildApp({
    clock: fixedClock('2026-07-19T20:00:00.000Z'),
    loggerEnabled: false,
    auth: { pool, cookieSecure: false, loginRateLimit: { limit: 500, windowMs: 60_000 } },
    laborAllocationProviders: createLaborAllocationProviderRegistry({
      gemini: instrument(baseProvider, providerCalls),
    }),
    laborAllocationProviderId: 'gemini-generate-content',
  })
  await app.ready()

  const login = await app.inject({
    method: 'POST', url: '/api/v1/auth/login',
    payload: { email: 'p61-load@test.local', password: PASSWORD },
  })
  if (login.statusCode !== 200) throw new Error(`LOGIN_FAILED_${login.statusCode}`)
  const cookie = String(login.headers['set-cookie']).split(';')[0]

  const scenarios = []
  // Her boyut REPEATS kez ardışık ölçülür; kapı 5 ardışık başarı ister.
  const runPlan = LINE_COUNTS.flatMap((count) => Array.from({ length: REPEATS }, () => count))
  let stoppedReason = null
  for (const [index, lineCount] of runPlan.entries()) {
    if (stoppedReason !== null) break
    if (providerCalls.length >= MAX_PROVIDER_CALLS) {
      stoppedReason = `MAX_PROVIDER_CALLS_${MAX_PROVIDER_CALLS}`
      break
    }
    const caseId = uuidv7()
    await pool.query(
      `INSERT INTO cases
         (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
          workflow_stage,plate,plate_normalized,responsible_user_id,notification_date,version)
       VALUES ($1,$2,2026,$3,$4,'traffic','open','reporting',$5,$6,$7,'2026-07-01',1)`,
      [
        caseId, organizationId, 6100 + index, `2026/${6100 + index}`,
        `34 LD ${6100 + index}`, `34LD${6100 + index}`, userId,
      ],
    )
    const items = syntheticSheet(lineCount)
    const sheet = await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/labor-sheet`,
      headers: { cookie, 'idempotency-key': uuidv7() },
      payload: { expectedCaseVersion: 1, confirmed: true, items },
    })
    if (sheet.statusCode !== 201) throw new Error(`SHEET_FAILED_${lineCount}_${sheet.statusCode}`)

    const callsBefore = providerCalls.length
    const startedAt = Date.now()
    const analyzed = await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/labor-allocation-ai/analyze`,
      headers: { cookie },
      payload: {
        expectedSheetVersion: 1,
        damageDescription: 'Coklu bolge darbe; on ve yan panellerde hasar.',
        confirmedEgress: true,
      },
    })
    const totalMs = Date.now() - startedAt
    if (analyzed.statusCode !== 200) throw new Error(`ANALYZE_HTTP_${lineCount}_${analyzed.statusCode}`)
    /*
     * Paket 62 den beri analiz ASENKRONDUR. Bu betik P61 de yazıldığı için
     * koşuyu beklemiyordu; ölçüm sonucu bekler, gerçek uçtaki asenkron
     * davranış korunur.
     */
    let run = analyzed.json().run
    const settleDeadline = Date.now() + 300_000
    while (['queued', 'running', 'cancel_requested'].includes(run.status)) {
      if (Date.now() > settleDeadline) throw new Error(`RUN_DID_NOT_SETTLE_${run.status}`)
      await new Promise((resolve) => { setTimeout(resolve, 250) })
      const polled = await app.inject({
        method: 'GET', url: `/api/v1/cases/${caseId}/labor-allocation-ai/${run.id}`,
        headers: { cookie },
      })
      if (polled.statusCode !== 200) throw new Error(`RUN_READ_${polled.statusCode}`)
      run = polled.json().run
    }
    const calls = providerCalls.slice(callsBefore)
    const lines = run.suggestion?.lines ?? []

    // Eksik kanıt ve çelişki dağılımı (kod bazında sayım).
    const missingHistogram = {}
    const conflictHistogram = {}
    for (const line of lines) {
      for (const code of line.missingEvidenceCodes) {
        missingHistogram[code] = (missingHistogram[code] ?? 0) + 1
      }
      for (const code of line.conflictCodes) {
        conflictHistogram[code] = (conflictHistogram[code] ?? 0) + 1
      }
    }

    const receipts = await pool.query(
      `SELECT status,input_tokens,output_tokens,output_characters,safe_error_code
         FROM labor_allocation_provider_receipts
        WHERE organization_id=$1 AND case_id=$2 ORDER BY dispatch_started_at`,
      [organizationId, caseId],
    )
    const ledger = await pool.query(
      `SELECT count(*)::int AS rows,
              coalesce(sum(input_tokens),0)::int AS input_tokens,
              coalesce(sum(output_tokens),0)::int AS output_tokens,
              coalesce(sum(estimated_cost_minor),0)::bigint AS estimated_cost_minor
         FROM ai_usage_ledger
        WHERE organization_id=$1 AND case_id=$2 AND usage_module='labor_allocation'`,
      [organizationId, caseId],
    )

    // İlk kota reddinde kalan tekrarlar harcanmaz; kapı yine BAŞARISIZ sayılır.
    if (run.safeErrorCode === 'AI_PROVIDER_RATE_LIMITED') {
      stoppedReason = 'RATE_LIMITED'
    }

    scenarios.push({
      requestedLineCount: lineCount,
      returnedLineCount: lines.length,
      // Satır kapsaması: her satır tam olarak bir kez ve doğru sırada.
      fullLineCoverage: lines.length === lineCount
        && lines.every((line, position) => line.lineOrdinal === position + 1),
      runStatus: run.status,
      domainValidation: run.status === 'review_required'
        ? 'passed'
        : sanitizeToken(run.safeErrorCode ?? run.status),
      totalMs,
      /*
       * Politika tavanı ÇAĞRI BAŞINADIR (`request_timeout_ms` her
       * `provider.execute` için ayrı AbortController'a verilir). Chunk'lı bir
       * run'da toplam duvar saati meşru biçimde tavanı aşabilir; ihlal olup
       * olmadığı en uzun TEK çağrıya bakılarak belirlenir.
       */
      maxProviderCallMs: calls.reduce((max, call) => Math.max(max, call.durationMs), 0),
      providerCallCount: calls.length,
      retryCount: calls.reduce((sum, call) => sum + call.retryCount, 0),
      finishReasons: calls.map((call) => sanitizeToken(call.finishReason ?? 'none')),
      providerOutcomes: calls.map((call) => call.outcome === 'ok'
        ? 'ok'
        : `${call.outcome}:${call.safeErrorCode}`),
      inputTokens: calls.reduce((sum, call) => sum + (call.inputTokens ?? 0), 0),
      outputTokens: calls.reduce((sum, call) => sum + (call.outputTokens ?? 0), 0),
      outputCharacters: calls.reduce((sum, call) => sum + (call.outputCharacters ?? 0), 0),
      controlRequiredCount: lines.filter((line) => line.controlRequired).length,
      // P64: kategori yapısı; tutar DEĞERLERİ raporlanmaz.
      categoryCompleteLineCount: lines.filter(
        (line) => (line.categoryAllocation?.amounts?.length ?? 0) === 8,
      ).length,
      categorySumMatchesLaborLineCount: lines.filter((line, position) => {
        const sum = (line.categoryAllocation?.amounts ?? [])
          .reduce((total, item) => total + item.amountMinor, 0)
        return sum === items[position]?.laborAmountMinor
      }).length,
      missingEvidenceHistogram: missingHistogram,
      conflictHistogram,
      receipts: receipts.rows.map((row) => ({
        status: row.status,
        inputTokens: row.input_tokens === null ? null : Number(row.input_tokens),
        outputTokens: row.output_tokens === null ? null : Number(row.output_tokens),
        safeErrorCode: row.safe_error_code === null ? null : sanitizeToken(row.safe_error_code),
      })),
      ledger: {
        rows: ledger.rows[0].rows,
        inputTokens: Number(ledger.rows[0].input_tokens),
        outputTokens: Number(ledger.rows[0].output_tokens),
        estimatedCostMinor: Number(ledger.rows[0].estimated_cost_minor),
      },
    })
  }

  // ── Kabul ölçütü: en az 50 satırlı föy tam kapsama + sıfır doğrulama hatası
  // + mevcut timeout politikası içinde + doğru ledger + gizli fallback yok.
  const POLICY_TIMEOUT_MS = 30_000
  const failures = []
  /*
   * Erken durdurma BAŞARI DEĞİLDİR. Kota koruması devreye girdiyse planlanan
   * tekrarların tamamı çalışmadı; kapı kapanmış sayılamaz ve bu açıkça bir
   * başarısızlık olarak raporlanır.
   */
  if (stoppedReason !== null) failures.push(`RUN_STOPPED_${stoppedReason}`)
  if (scenarios.length < LINE_COUNTS.length * REPEATS) {
    failures.push(`INCOMPLETE_PLAN_${scenarios.length}/${LINE_COUNTS.length * REPEATS}`)
  }
  for (const scenario of scenarios) {
    if (scenario.requestedLineCount < 50) continue
    if (!scenario.fullLineCoverage) failures.push(`${scenario.requestedLineCount}:LINE_COVERAGE`)
    if (scenario.domainValidation !== 'passed') {
      failures.push(`${scenario.requestedLineCount}:VALIDATION_${scenario.domainValidation}`)
    }
    // Politika tavanı çağrı başınadır; toplam süre bilgi amaçlı raporlanır.
    if (scenario.maxProviderCallMs > POLICY_TIMEOUT_MS) {
      failures.push(`${scenario.requestedLineCount}:CALL_EXCEEDS_POLICY_TIMEOUT`)
    }
    // Ledger, gerçekleşen sağlayıcı kullanımını taşımalı.
    if (scenario.ledger.rows !== 1) failures.push(`${scenario.requestedLineCount}:LEDGER_ROWS`)
    if (scenario.runStatus === 'review_required'
      && scenario.ledger.outputTokens !== scenario.outputTokens) {
      failures.push(`${scenario.requestedLineCount}:LEDGER_TOKEN_MISMATCH`)
    }
    // Sağlayıcı hatası varken sonuç üretilmiş olamaz (gizli fallback yok).
    if (scenario.runStatus === 'review_required'
      && scenario.providerOutcomes.some((outcome) => outcome !== 'ok')) {
      failures.push(`${scenario.requestedLineCount}:SILENT_FALLBACK_SUSPECTED`)
    }
  }

  const truncationObserved = scenarios.some((scenario) => (
    scenario.finishReasons.includes('MAX_TOKENS')
    || String(scenario.domainValidation).includes('TRUNCATED')
  ))
  const timeoutObserved = scenarios.some((scenario) => (
    String(scenario.domainValidation).includes('TIMEOUT')
    || scenario.maxProviderCallMs > POLICY_TIMEOUT_MS
  ))
  const coverageGapObserved = scenarios.some((scenario) => !scenario.fullLineCoverage)

  console.log(JSON.stringify({
    ok: failures.length === 0,
    modelId: baseProvider.modelId,
    providerVersion: baseProvider.providerVersion,
    policyTimeoutMs: POLICY_TIMEOUT_MS,
    /*
     * Kota koruması sonucu. `stoppedReason` doluysa PLANLANAN tüm tekrarlar
     * çalışmadı; bu bir başarı DEĞİL, erken durdurmadır ve kapı kapanmamış
     * sayılır. `Retry-After` sağlayıcı tarafından güvenli biçimde yüzeye
     * çıkarılmadığı için TAHMİN ÜRETİLMEZ.
     */
    quotaGuard: {
      plannedRuns: LINE_COUNTS.length * REPEATS,
      completedRuns: scenarios.length,
      providerCallsUsed: providerCalls.length,
      maxProviderCalls: MAX_PROVIDER_CALLS,
      stoppedReason,
      retryAfterAvailable: false,
    },
    scenarios,
    failures,
    /** Chunking kararının girdisi: üçü de false ise chunking GEREKMEZ. */
    chunkingSignals: { truncationObserved, timeoutObserved, coverageGapObserved },
  }))
  if (failures.length > 0) process.exitCode = 1
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: sanitizeToken(error?.message ?? 'unknown'),
    code: sanitizeToken(error?.code ?? ''),
  }))
  process.exitCode = 1
} finally {
  await app?.close().catch(() => undefined)
  await closeDatabasePool(pool)
  await closeGlobalFetchSockets()
}
