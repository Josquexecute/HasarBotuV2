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
import {
  buildLaborAllocationOutboundContext,
  validateLaborAllocationSuggestion,
} from '../packages/domain/dist/index.js'

/**
 * Paket 55/59 — İSTEĞE BAĞLI manuel gerçek Gemini smoke'u (release kapısı).
 *
 * CI ve standart test kuşağı bu betiği ÇALIŞTIRMAZ ve gerçek API anahtarı
 * istemez. Elle çalıştırmak için:
 *   $env:GEMINI_API_KEY="..."            (yalnız yerel ortam; log'a yazılmaz)
 *   $env:GEMINI_LABOR_ALLOCATION_MANUAL_SMOKE="true"
 *   $env:TEST_DATABASE_URL="postgres://hasarbotu_test:...@127.0.0.1:5432/hasarbotu_test"
 *   node scripts/package55-gemini-manual-smoke.mjs
 *
 * Paket 59: betik artık P56–P58 sonrası GERÇEK akışı kullanır — policy opt-in,
 * bütçe, ledger, kanıt yükleme ve immutable kayıt dahil, `analyze` ucundan
 * geçer. İki senaryo koşulur:
 *   A) Çıplak kanıt: yalnız föy satırları (tüm eksik kanıt kodları aktif).
 *   B) Zengin kanıt: araç profili + parça kodu + hasar bölgesi + baseline.
 *
 * Ölçülen üç sonuç (HB-2026-062 release kapısı):
 *   1. `responseJsonSchema` gerçek API tarafından kabul edildi mi?
 *   2. Tüm satırlar eksiksiz döndü mü?
 *   3. Gerçek çıktıda `control_required` ve doğrulama hata oranı nedir?
 *
 * Yalnız sentetik kanıt gönderilir; gerçek müşteri verisi kullanılmaz. Ham
 * model çıktısı ve API anahtarı hiçbir koşulda log'a yazılmaz; teşhis yalnız
 * YAPISAL rapor üretir (anahtar adları, kapalı küme değerleri, uzunluklar).
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
  throw new Error('GEMINI_API_KEY_REQUIRED_FOR_MANUAL_SMOKE')
}
const DATABASE_URL = process.env.TEST_DATABASE_URL
if (DATABASE_URL === undefined || DATABASE_URL.length === 0) {
  throw new Error('TEST_DATABASE_URL_REQUIRED_FOR_MANUAL_SMOKE')
}

/**
 * Windows'ta undici keep-alive TLS soketleri süreç çıkışında libuv
 * `UV_HANDLE_CLOSING` assertion'ını tetikleyebiliyor. Çıkıştan önce global
 * dispatcher kapatılır ve `process.exit` yerine `exitCode` kullanılır.
 */
async function closeGlobalFetchSockets() {
  try {
    const dispatcher = globalThis[Symbol.for('undici.globalDispatcher.1')]
    if (dispatcher !== undefined && typeof dispatcher.close === 'function') {
      await dispatcher.close()
    }
  } catch {
    // Kapanış temizliği asla sonucu maskelemez.
  }
}

/** Serbest metin log'a girmez: kapalı küme değerleri budanır ve süzülür. */
function sanitizeToken(value) {
  return String(value).slice(0, 48).replace(/[^A-Za-z0-9_/.:\-]/g, '?')
}

/** Yapısal teşhis raporu; ham metin yerine yalnız şekil bilgisi. */
function shapeReport(output, expectedLines) {
  if (output === null || typeof output !== 'object' || Array.isArray(output)) {
    return { kind: typeof output, isArray: Array.isArray(output) }
  }
  const top = output
  const lines = Array.isArray(top.lines) ? top.lines : []
  return {
    topLevelKeys: Object.keys(top).map(sanitizeToken),
    schemaVersion: sanitizeToken(top.schemaVersion),
    operationTypesVersion: sanitizeToken(top.operationTypesVersion),
    requiresHumanReview: top.requiresHumanReview,
    lineCount: lines.length,
    expectedLineCount: expectedLines.length,
    lines: lines.map((line) => {
      const source = expectedLines[(Number(line?.lineOrdinal) || 0) - 1]
      const expectedTotal = source === undefined
        ? null
        : source.partAmountMinor + source.laborAmountMinor
      const allocations = Array.isArray(line?.allocations) ? line.allocations : []
      const allocationSum = allocations.reduce(
        (sum, item) => sum + (Number.isSafeInteger(item?.amountMinor) ? item.amountMinor : Number.NaN),
        0,
      )
      const buckets = line?.economicComparison?.buckets
      // Paket 64 ara dilim — kategori dağılımı ölçümü. Tutar DEĞERLERİ
      // raporlanmaz; yalnız yapısal uygunluk ve toplam eşitliği ölçülür.
      const CATEGORIES = [
        'bodywork', 'mechanical', 'electrical', 'upholstery_lock',
        'glass', 'calibration', 'repair', 'paint',
      ]
      const categoryAmounts = line?.categoryAllocation?.amounts
      const categoryKeys = categoryAmounts === null || typeof categoryAmounts !== 'object'
        ? []
        : Object.keys(categoryAmounts)
      const categorySum = categoryKeys.length === 0
        ? Number.NaN
        : CATEGORIES.reduce(
          (sum, key) => sum + (Number.isSafeInteger(categoryAmounts?.[key])
            ? categoryAmounts[key]
            : Number.NaN),
          0,
        )
      return {
        categoryKeysComplete: CATEGORIES.every((key) => categoryKeys.includes(key)),
        categoryKeyCount: categoryKeys.length,
        categoryAmountsAllSafeIntegers: CATEGORIES
          .every((key) => Number.isSafeInteger(categoryAmounts?.[key])),
        categorySum,
        expectedLaborMinor: source?.laborAmountMinor ?? null,
        // Kritik kural: kategori toplamı YALNIZ işçilik tutarına eşit olmalı;
        // parça bedeli karışmamalı.
        categorySumMatchesLabor: source !== undefined && categorySum === source.laborAmountMinor,
        categorySumWronglyIncludesPart: source !== undefined
          && categorySum === source.partAmountMinor + source.laborAmountMinor
          && source.partAmountMinor > 0,
        categoryConfidence: line?.categoryAllocation?.confidence,
        categoryConflictCodes: Array.isArray(line?.categoryAllocation?.conflictCodes)
          ? line.categoryAllocation.conflictCodes.map(sanitizeToken)
          : [],
        keys: line === null || typeof line !== 'object' ? [] : Object.keys(line).map(sanitizeToken),
        lineOrdinal: line?.lineOrdinal,
        opinion: sanitizeToken(line?.repairReplaceOpinion),
        allocationTypes: allocations.map((item) => sanitizeToken(item?.operationType)),
        amountsAllSafeIntegers: allocations.every((item) => Number.isSafeInteger(item?.amountMinor)),
        allocationSum,
        expectedTotal,
        sumMatches: expectedTotal !== null && allocationSum === expectedTotal,
        bucketKeys: buckets === null || typeof buckets !== 'object'
          ? []
          : Object.keys(buckets).map(sanitizeToken),
        repairTotalMinor: line?.economicComparison?.repairTotalMinor,
        replaceTotalMinor: line?.economicComparison?.replaceTotalMinor,
        confidence: line?.confidence,
        reasoningLength: typeof line?.reasoning === 'string' ? line.reasoning.length : null,
        noteLength: typeof line?.economicComparison?.note === 'string'
          ? line.economicComparison.note.length
          : null,
        evidenceRefs: Array.isArray(line?.evidenceRefs)
          ? line.evidenceRefs.map((ref) => ({
            length: String(ref).length,
            anchorLike: /^[A-Za-z0-9_.:\-]{1,120}$/.test(String(ref)),
          }))
          : null,
        conflictCodes: Array.isArray(line?.conflictCodes)
          ? line.conflictCodes.map(sanitizeToken)
          : null,
        missingEvidenceCodes: Array.isArray(line?.missingEvidenceCodes)
          ? line.missingEvidenceCodes.map(sanitizeToken)
          : null,
        controlRequired: line?.controlRequired,
      }
    }),
  }
}

const config = assertTestDatabaseUrl(DATABASE_URL)
const pool = createDatabasePool({ config })
const PASSWORD = 'p59-gemini-smoke-sentetik-parola'
const provider = createGeminiLaborAllocationProvider({
  apiKey: apiKey.trim(),
  // Varsayılan, üretim yapılandırmasının birincil modeliyle aynıdır; fallback
  // model env ile seçilebilir. Her iki model de 2026-07-19 kapı ölçümünü geçti.
  modelId: process.env.GEMINI_LABOR_ALLOCATION_MODEL ?? 'gemini-3.5-flash',
  maximumInputCharacters: 400_000,
  maximumOutputSize: 200_000,
  maximumOutputTokens: Number(process.env.GEMINI_LABOR_ALLOCATION_MAX_OUTPUT_TOKENS ?? 16_384),
})

const BARE_LINES = [
  { description: 'On tampon', action: 'Onarim + boya', partAmountMinor: 0, laborAmountMinor: 10_000_00 },
  { description: 'Sol on camurluk', action: 'Degisim', partAmountMinor: 18_000_00, laborAmountMinor: 2_000_00 },
]
const ENRICHED_LINES = [
  {
    description: 'On tampon', action: 'Onarim + boya',
    partAmountMinor: 0, laborAmountMinor: 10_000_00,
    damageRegion: 'On orta',
  },
  {
    description: 'Sol on camurluk', action: 'Degisim',
    partAmountMinor: 18_000_00, laborAmountMinor: 2_000_00,
    partCode: 'CMR-7701-SOL', partCodeSource: 'user_entered', damageRegion: 'Sol on',
  },
]

let app
try {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await runMigrations({ databaseUrl: config.url, quiet: true })

  const organizationId = uuidv7()
  const userId = uuidv7()
  const bareCaseId = uuidv7()
  const enrichedCaseId = uuidv7()
  await pool.query(
    "INSERT INTO organizations (id,code,name) VALUES ($1,'p59-gemini','P59 Gemini Smoke')",
    [organizationId],
  )
  await pool.query(
    `INSERT INTO users (id,organization_id,email,display_name,password_hash,status)
     VALUES ($1,$2,'p59-gemini@test.local','P59 Yetkili',$3,'active')`,
    [userId, organizationId, await hashPassword(PASSWORD)],
  )
  await pool.query(
    "INSERT INTO user_roles (user_id,role_id) SELECT $1::uuid,id FROM roles WHERE code='admin'",
    [userId],
  )
  await pool.query(
    `INSERT INTO cases
       (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
        workflow_stage,plate,plate_normalized,responsible_user_id,notification_date,version)
     VALUES ($1,$3,2026,5901,'2026/5901','traffic','open','reporting','34 GS 5901','34GS5901',$4,'2026-07-01',1),
            ($2,$3,2026,5902,'2026/5902','traffic','open','reporting','34 GS 5902','34GS5902',$4,'2026-07-01',1)`,
    [bareCaseId, enrichedCaseId, organizationId, userId],
  )
  // Gerçek dış çağrı 5 sn'lik varsayılan policy timeout'una sığmayabilir;
  // release kapısı ölçümünde timeout, şema uyumsuzluğuyla karışmamalıdır.
  // DB kısıtı üst sınırı 30 sn'dir (0018 budget_valid); tavan kullanılır.
  await pool.query(
    `INSERT INTO ai_provider_policies
       (id,organization_id,labor_allocation_enabled,labor_allocation_allowed_provider_ids,
        monthly_budget_minor,per_request_budget_minor,request_timeout_ms)
     VALUES ($1,$2,true,ARRAY['gemini-generate-content']::text[],10000000,10000000,30000)`,
    [uuidv7(), organizationId],
  )

  app = buildApp({
    clock: fixedClock('2026-07-19T16:00:00.000Z'),
    loggerEnabled: false,
    auth: { pool, cookieSecure: false, loginRateLimit: { limit: 200, windowMs: 60_000 } },
    laborAllocationProviders: createLaborAllocationProviderRegistry({ gemini: provider }),
    laborAllocationProviderId: 'gemini-generate-content',
  })
  await app.ready()

  const login = await app.inject({
    method: 'POST', url: '/api/v1/auth/login',
    payload: { email: 'p59-gemini@test.local', password: PASSWORD },
  })
  if (login.statusCode !== 200) throw new Error(`LOGIN_FAILED_${login.statusCode}`)
  const cookie = String(login.headers['set-cookie']).split(';')[0]

  const inject = (method, url, payload) => app.inject({
    method,
    url,
    headers: { cookie, 'idempotency-key': uuidv7() },
    payload,
  })

  // ── Senaryo A: çıplak kanıt.
  const bareSheet = await inject('POST', `/api/v1/cases/${bareCaseId}/labor-sheet`, {
    expectedCaseVersion: 1, confirmed: true, items: BARE_LINES,
  })
  if (bareSheet.statusCode !== 201) throw new Error(`BARE_SHEET_FAILED_${bareSheet.statusCode}`)

  // ── Senaryo B hazırlığı: araç profili + kanıt alanlı föy + baseline revizyonu.
  const vehicle = await inject('PUT', `/api/v1/cases/${enrichedCaseId}/vehicle-profile`, {
    expectedVersion: null,
    reason: null,
    confirmed: true,
    fields: {
      brand: 'Renault', model: 'Clio', modelYear: 2021, variant: null,
      vehicleClass: 'passenger_car', chassisPrefix: 'VF1RJA00', engineCode: 'H4B',
      evidenceSource: 'registration_document', evidenceReference: 'Ruhsat s.1',
    },
  })
  if (vehicle.statusCode !== 200) throw new Error(`VEHICLE_PROFILE_FAILED_${vehicle.statusCode}`)
  const enrichedSheet = await inject('POST', `/api/v1/cases/${enrichedCaseId}/labor-sheet`, {
    expectedCaseVersion: 1, confirmed: true, items: ENRICHED_LINES,
  })
  if (enrichedSheet.statusCode !== 201) {
    throw new Error(`ENRICHED_SHEET_FAILED_${enrichedSheet.statusCode}`)
  }
  const revision = await inject('POST', `/api/v1/cases/${enrichedCaseId}/labor-sheet/versions`, {
    expectedVersion: 1, confirmed: true, reason: 'Kanit dogrulandi', items: ENRICHED_LINES,
  })
  if (revision.statusCode !== 200) throw new Error(`BASELINE_REVISION_FAILED_${revision.statusCode}`)

  const analyze = async (caseId, sheetVersion) => {
    const response = await inject('POST', `/api/v1/cases/${caseId}/labor-allocation-ai/analyze`, {
      expectedSheetVersion: sheetVersion,
      damageDescription: 'On sol bolgede darbe; tampon ve camurluk etkilendi.',
      confirmedEgress: true,
    })
    if (response.statusCode !== 200) throw new Error(`ANALYZE_HTTP_${response.statusCode}`)
    /*
     * Paket 62'den beri analiz ASENKRONDUR: bu uç koşuyu `queued` yaratıp
     * hemen döner. Betik P62'de güncellenmemişti ve koşuyu beklemeden
     * durumunu okuyup "review_required değil" diye hata veriyordu. Gerçek
     * uçtaki asenkron davranış korunur; yalnız ölçüm sonucu bekler.
     */
    const started = response.json().run
    const deadline = Date.now() + 120_000
    let current = started
    while (['queued', 'running', 'cancel_requested'].includes(current.status)) {
      if (Date.now() > deadline) throw new Error(`RUN_DID_NOT_SETTLE_${current.status}`)
      await new Promise((resolve) => { setTimeout(resolve, 250) })
      const polled = await inject('GET', `/api/v1/cases/${caseId}/labor-allocation-ai/${started.id}`)
      if (polled.statusCode !== 200) throw new Error(`RUN_READ_HTTP_${polled.statusCode}`)
      current = polled.json().run
    }
    return current
  }

  const scenarios = []
  const bareRun = await analyze(bareCaseId, 1)
  scenarios.push({ name: 'bare', expectedLineCount: BARE_LINES.length, run: bareRun })
  const enrichedRun = await analyze(enrichedCaseId, 2)
  scenarios.push({ name: 'enriched', expectedLineCount: ENRICHED_LINES.length, run: enrichedRun })

  // ── Ölçümler.
  const reports = []
  let validationFailures = 0
  for (const scenario of scenarios) {
    const run = scenario.run
    const failedByOutput = run.status === 'failed'
      && typeof run.safeErrorCode === 'string'
      && run.safeErrorCode.startsWith('AI_OUTPUT_')
    if (failedByOutput || (run.status !== 'review_required')) validationFailures += 1
    const lines = run.suggestion?.lines ?? []
    reports.push({
      scenario: scenario.name,
      runStatus: run.status,
      safeErrorCode: run.safeErrorCode,
      providerVersion: run.providerVersion,
      // 1. ölçüm: HTTP 200 döndüyse (çıktı doğrulanamamış olsa bile) gerçek API
      // responseJsonSchema'yı kabul etmiş demektir; 400 reddi false, timeout
      // gibi sonuca ulaşmayan durumlar null (bilinmiyor) sayılır.
      responseJsonSchemaAcceptedByApi: run.status === 'review_required' || failedByOutput
        ? true
        : (run.safeErrorCode === 'AI_PROVIDER_REQUEST_REJECTED' ? false : null),
      // 2. ölçüm: satır kapsaması. review_required ise domain bunu zaten
      // garanti eder; yine de açıkça sayılır.
      expectedLineCount: scenario.expectedLineCount,
      returnedLineCount: lines.length,
      allLinesReturned: lines.length === scenario.expectedLineCount
        && lines.every((line, index) => line.lineOrdinal === index + 1),
      // 3. ölçüm: kontrol oranı ve satır başına eksik kanıt kodları.
      controlRequiredCount: lines.filter((line) => line.controlRequired).length,
      confidences: lines.map((line) => line.confidence),
      missingEvidenceCodesPerLine: lines.map((line) => line.missingEvidenceCodes),
      conflictCodesPerLine: lines.map((line) => line.conflictCodes),
    })
  }

  // Senaryo bazlı sunucu iddiaları (model davranışından bağımsız olanlar).
  const failures = []
  for (const report of reports) {
    if (report.runStatus !== 'review_required') {
      failures.push(`${report.scenario}:RUN_NOT_REVIEWABLE:${report.safeErrorCode ?? report.runStatus}`)
      continue
    }
    if (!report.allLinesReturned) failures.push(`${report.scenario}:LINE_COVERAGE`)
    // Her iki senaryoda da en az bir eksik kanıt kanalı açık (onaylı geçmiş);
    // sunucu zorlaması modelin güvenine bakmadan kontrolü korumalıdır.
    if (report.controlRequiredCount !== report.expectedLineCount) {
      failures.push(`${report.scenario}:CONTROL_NOT_ENFORCED`)
    }
  }
  const enrichedReport = reports.find((report) => report.scenario === 'enriched')
  if (enrichedReport !== undefined && enrichedReport.runStatus === 'review_required') {
    for (const codes of enrichedReport.missingEvidenceCodesPerLine) {
      if (!codes.includes('EVIDENCE_MISSING_APPROVED_HISTORY')) {
        failures.push('enriched:APPROVED_HISTORY_CODE_LOST')
      }
      for (const closed of [
        'EVIDENCE_MISSING_VEHICLE_IDENTITY',
        'EVIDENCE_MISSING_PART_CODE',
        'EVIDENCE_MISSING_DAMAGE_REGION',
        'EVIDENCE_MISSING_EXPERT_BASELINE',
      ]) {
        if (codes.includes(closed)) failures.push(`enriched:CLOSED_CHANNEL_REPORTED_${closed}`)
      }
    }
  }

  // Ledger ve makbuz: gerçek çağrı kayıt altına alınmış olmalı.
  const ledger = await pool.query(
    "SELECT count(*)::int AS n FROM ai_usage_ledger WHERE usage_module='labor_allocation' AND organization_id=$1",
    [organizationId],
  )
  if (ledger.rows[0].n !== scenarios.length) failures.push('LEDGER_ROWS_MISSING')
  const receipts = await pool.query(
    `SELECT status,input_tokens,output_tokens FROM labor_allocation_provider_receipts
      WHERE organization_id=$1 ORDER BY dispatch_started_at`,
    [organizationId],
  )
  const usage = receipts.rows.map((row) => ({
    status: row.status,
    inputTokens: row.input_tokens === null ? null : Number(row.input_tokens),
    outputTokens: row.output_tokens === null ? null : Number(row.output_tokens),
  }))

  // ── Doğrulama hatasında yapısal teşhis (tek ek çağrı; ham metin yok).
  let diagnostic = null
  if (reports.some((report) => String(report.safeErrorCode ?? '').startsWith('AI_OUTPUT_'))) {
    const planContext = {
      organizationId: 'diagnostic-org',
      caseId: 'diagnostic-case',
      caseVersion: 1,
      caseType: 'traffic',
      sheetId: 'diagnostic-sheet',
      sheetVersion: 1,
      damageDescription: 'On sol bolgede darbe; tampon ve camurluk etkilendi.',
      lines: BARE_LINES,
      vehicleProfile: null,
      dictionary: [],
      approvedHistory: [],
      approvedHistoryComplete: false,
      expertBaseline: null,
      providerId: provider.providerId,
      providerVersion: provider.providerVersion,
      modelId: provider.modelId,
      externalProvider: true,
      retentionMode: provider.retentionMode,
      pricingVersion: provider.pricingVersion,
    }
    const outbound = buildLaborAllocationOutboundContext(planContext)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 60_000)
    try {
      const direct = await provider.execute({
        accountingInputCharacters: outbound.outboundInputCharacters,
        providerRequestId: `diagnostic-${uuidv7()}`,
        context: outbound.context,
      }, controller.signal)
      const validation = validateLaborAllocationSuggestion(
        direct.output, BARE_LINES, outbound.missingEvidenceCodes,
      )
      diagnostic = {
        validationCode: validation.allowed ? null : validation.code,
        shape: shapeReport(direct.output, BARE_LINES),
      }
    } catch (error) {
      diagnostic = { providerError: sanitizeToken(error?.safeDiagnosticCode ?? error?.message) }
    } finally {
      clearTimeout(timer)
    }
  }

  const summary = {
    ok: failures.length === 0,
    modelId: provider.modelId,
    providerVersion: provider.providerVersion,
    // Üç release kapısı ölçümü:
    responseJsonSchemaAcceptedByApi: reports.every(
      (report) => report.responseJsonSchemaAcceptedByApi === true,
    ),
    allLinesReturned: reports.every((report) => report.allLinesReturned),
    validationErrorRate: `${validationFailures}/${scenarios.length}`,
    controlRequiredRate: `${reports.reduce((sum, report) => sum + report.controlRequiredCount, 0)}`
      + `/${reports.reduce((sum, report) => sum + report.expectedLineCount, 0)}`,
    scenarios: reports,
    usage,
    failures,
    diagnostic,
  }
  console.log(JSON.stringify(summary))
  if (failures.length > 0) process.exitCode = 1
} catch (error) {
  /*
   * Yakalanmamış hata Node'u zorla çıkışa götürür ve Windows'ta kapanmakta
   * olan libuv async handle'larıyla yarışıp `UV_HANDLE_CLOSING` assertion'ını
   * tetikler. Hata burada yakalanır, sınıflandırılmış biçimde raporlanır ve
   * süreç temizlik sonrası DOĞAL olarak çıkar.
   */
  console.error(JSON.stringify({
    ok: false,
    error: sanitizeToken(error?.message ?? 'unknown'),
    code: sanitizeToken(error?.code ?? ''),
    constraint: sanitizeToken(error?.constraint ?? ''),
  }))
  process.exitCode = 1
} finally {
  await app?.close().catch(() => undefined)
  await closeDatabasePool(pool)
  await closeGlobalFetchSockets()
}
