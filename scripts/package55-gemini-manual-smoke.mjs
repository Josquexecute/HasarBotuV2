import {
  LABOR_OPERATION_TYPES,
  LABOR_OPERATION_TYPES_VERSION,
  LABOR_ECONOMIC_BUCKETS,
  validateLaborAllocationSuggestion,
} from '../packages/domain/dist/index.js'
import { createGeminiLaborAllocationProvider } from '../services/api/dist/index.js'

/**
 * Paket 55 — İSTEĞE BAĞLI manuel gerçek Gemini smoke'u.
 *
 * CI ve standart test kuşağı bu betiği ÇALIŞTIRMAZ ve gerçek API anahtarı
 * istemez. Elle çalıştırmak için iki değişken birlikte gerekir:
 *   $env:GEMINI_API_KEY="..."
 *   $env:GEMINI_LABOR_ALLOCATION_MANUAL_SMOKE="true"
 *   node scripts/package55-gemini-manual-smoke.mjs
 *
 * Yalnız sentetik kanıt gönderilir; gerçek müşteri verisi kullanılmaz.
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

const SHEET_LINES = [
  { description: 'On tampon', action: 'Onarim + boya', partAmountMinor: 0, laborAmountMinor: 10_000_00 },
  { description: 'Sol on camurluk', action: 'Degisim', partAmountMinor: 18_000_00, laborAmountMinor: 2_000_00 },
]

const provider = createGeminiLaborAllocationProvider({
  apiKey: apiKey.trim(),
  modelId: process.env.GEMINI_LABOR_ALLOCATION_MODEL ?? 'gemini-2.5-flash',
  maximumInputCharacters: 50_000,
  maximumOutputSize: 100_000,
  maximumOutputTokens: 8_192,
})

const controller = new AbortController()
const timeout = setTimeout(() => controller.abort(), 30_000)
try {
  const response = await provider.execute({
    accountingInputCharacters: 1_200,
    providerRequestId: 'manual-smoke',
    context: {
      caseType: 'traffic',
      operationTypesVersion: LABOR_OPERATION_TYPES_VERSION,
      allowedOperationTypes: LABOR_OPERATION_TYPES,
      economicBuckets: LABOR_ECONOMIC_BUCKETS,
      damageDescription: 'On sol bolgede darbe; tampon ve camurluk etkilendi.',
      lines: SHEET_LINES.map((line, index) => ({
        ordinal: index + 1,
        description: line.description,
        action: line.action,
        partAmountMinor: line.partAmountMinor,
        laborAmountMinor: line.laborAmountMinor,
      })),
      dictionary: [],
      approvedHistory: [],
      expertBaseline: null,
    },
  }, controller.signal)

  // Gerçek model çıktısı da aynı domain doğrulamasından geçer.
  const validation = validateLaborAllocationSuggestion(response.output, SHEET_LINES, [
    'EVIDENCE_MISSING_VEHICLE_IDENTITY',
  ])
  if (!validation.allowed) {
    console.error(JSON.stringify({ ok: false, code: validation.code }))
    process.exit(1)
  }
  const controlRequired = validation.suggestion.lines.filter((line) => line.controlRequired).length
  if (controlRequired !== validation.suggestion.lines.length) {
    // Eksik kanıt kodu verildiği için model ne derse desin kontrol zorunludur.
    throw new Error('CONTROL_REQUIRED_NOT_ENFORCED')
  }
  console.log(JSON.stringify({
    ok: true,
    modelId: provider.modelId,
    lineCount: validation.suggestion.lines.length,
    controlRequired,
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
  }))
} finally {
  clearTimeout(timeout)
}
