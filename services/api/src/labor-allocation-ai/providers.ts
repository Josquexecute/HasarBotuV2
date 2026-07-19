import {
  LABOR_ALLOCATION_OUTPUT_SCHEMA_VERSION,
  LABOR_ALLOCATION_RULE_VERSION,
  LABOR_OPERATION_TYPES_VERSION,
  computeEconomicTotals,
  type LaborAllocationOutboundContext,
} from '@hasarbotu/domain'

/**
 * Paket 54 dilim 2 — kontrollü sağlayıcı harness'i.
 *
 * Deterministik sağlayıcılar YALNIZ test/geliştirme içindir ve dış egress
 * yapmaz. Hiçbir sağlayıcı hata durumunda kural tabanlı gizli fallback
 * üretmez: hata hatadır, çıktı yoktur.
 */
export interface LaborAllocationProviderRequest {
  readonly accountingInputCharacters: number
  readonly providerRequestId: string
  readonly context: LaborAllocationOutboundContext['context']
}

export interface LaborAllocationProviderUsage {
  readonly inputCharacters: number
  readonly outputCharacters: number
  readonly inputTokens: number | null
  readonly outputTokens: number | null
  readonly estimatedCostMinor: number
  readonly actualCostMinor: number
}

/**
 * Paket 61: sağlayıcıya özgü YAPISAL teşhis. Yalnız kapalı küme değerleri ve
 * sayaçlar taşınır; içerik, ham yanıt veya PII taşımaz. Yük ölçümünde çıktı
 * kesilmesini timeout'tan ayırmak için gereklidir.
 */
export interface LaborAllocationProviderDiagnostics {
  /** Gemini kapalı enum'u (STOP, MAX_TOKENS, SAFETY, ...); içerik değildir. */
  readonly finishReason: string | null
  /** Kaç kez geçici hata nedeniyle yeniden denendi. */
  readonly retryCount: number
}

export interface LaborAllocationProviderResponse {
  readonly output: unknown
  readonly usage: LaborAllocationProviderUsage
  readonly diagnostics?: LaborAllocationProviderDiagnostics
}

export class LaborAllocationProviderExecutionError extends Error {
  constructor(
    message: string,
    readonly requestOutcome: 'response_received' | 'unknown',
    readonly safeDiagnosticCode: string | null = null,
    readonly diagnostics: LaborAllocationProviderDiagnostics | null = null,
  ) {
    super(message)
    this.name = 'LaborAllocationProviderExecutionError'
  }
}

export interface LaborAllocationProviderAdapter {
  readonly providerId: string
  readonly providerVersion: string
  readonly modelId: string
  readonly externalProvider: boolean
  readonly retentionMode: 'local_only' | 'store_false' | 'free_tier_product_improvement'
  readonly pricingVersion: string
  readonly maximumInputCharacters: number
  estimateCostMinor(inputCharacters: number): number
  /** `signal` bounded timeout içindir; dış sağlayıcı bunu zorunlu kullanır. */
  execute(
    request: LaborAllocationProviderRequest,
    signal: AbortSignal,
  ): Promise<LaborAllocationProviderResponse>
}

export interface LaborAllocationProviderRegistry {
  get(providerId: string): LaborAllocationProviderAdapter | undefined
  list(): readonly LaborAllocationProviderAdapter[]
}

function usage(inputCharacters: number, outputCharacters: number): LaborAllocationProviderUsage {
  const cost = Math.max(1, Math.ceil(inputCharacters / 1_000))
  return {
    inputCharacters,
    outputCharacters,
    inputTokens: null,
    outputTokens: null,
    estimatedCostMinor: cost,
    actualCostMinor: cost,
  }
}

/**
 * Deterministik başarı çıktısı. Satır tutarını tarifteki işleme göre kanonik
 * operasyon türlerine böler. Bu bir ÜRÜN dağıtıcısı değildir; yalnız gerçek
 * sağlayıcı olmadan uçtan uca akışı doğrulamak içindir ve bu yüzden her satırı
 * `controlRequired` bırakır.
 */
function deterministicOutput(context: LaborAllocationProviderRequest['context']): unknown {
  return {
    schemaVersion: LABOR_ALLOCATION_OUTPUT_SCHEMA_VERSION,
    operationTypesVersion: LABOR_OPERATION_TYPES_VERSION,
    lines: context.lines.map((line) => {
      const total = line.partAmountMinor + line.laborAmountMinor
      const replaceShaped = line.partAmountMinor > line.laborAmountMinor
      const primaryType = replaceShaped ? 'replace' : 'repair'
      const installShare = Math.min(line.laborAmountMinor, Math.floor(total / 10))
      const allocations = installShare > 0
        ? [
            { operationType: primaryType, amountMinor: total - installShare },
            { operationType: 'remove_install', amountMinor: installShare },
          ]
        : [{ operationType: primaryType, amountMinor: total }]
      const bucketValues = {
        repair_labor: replaceShaped ? 0 : total - installShare,
        new_part_or_ownership: replaceShaped ? total - installShare : 0,
        remove_install: installShare,
        paint_and_consumable: 0,
        calibration: 0,
        related_operations: 0,
      }
      return {
        lineOrdinal: line.ordinal,
        allocations,
        repairReplaceOpinion: replaceShaped ? 'replace_indicated' : 'repair_indicated',
        economicComparison: {
          buckets: bucketValues,
          ...computeEconomicTotals(bucketValues),
          note: 'Kanonik operasyon dagilimi uzerinden ekonomik karsilastirma.',
        },
        reasoning: 'Kalem tutar dagilimi ve islem tarifi degerlendirildi.',
        evidenceRefs: [`line-${line.ordinal}-description`, `line-${line.ordinal}-action`],
        confidence: 0.55,
        conflictCodes: [],
        missingEvidenceCodes: [],
        controlRequired: true,
      }
    }),
    requiresHumanReview: true,
  }
}

function deterministicAdapter(
  providerId: string,
  behaviour: 'success' | 'invalid-schema' | 'timeout' | 'failure',
): LaborAllocationProviderAdapter {
  return {
    providerId,
    providerVersion: '1.0.0',
    modelId: 'deterministic',
    externalProvider: false,
    retentionMode: 'local_only',
    pricingVersion: 'labor-allocation-deterministic/1.0.0',
    maximumInputCharacters: 400_000,
    // Sıfır olmayan sembolik maliyet: bütçe kapısı harness'te de gerçekten
    // değerlendirilir, sıfır maliyet yüzünden sessizce atlanmaz.
    estimateCostMinor: (inputCharacters) => Math.max(1, Math.ceil(inputCharacters / 1_000)),
    execute: async (request) => {
      if (behaviour === 'timeout') {
        // Sonucun sunucuda bilinmediği durum: retry veya fallback üretilmez.
        throw new LaborAllocationProviderExecutionError('timeout', 'unknown', 'AI_PROVIDER_TIMEOUT')
      }
      if (behaviour === 'failure') {
        throw new LaborAllocationProviderExecutionError('failure', 'response_received', 'AI_PROVIDER_FAILED')
      }
      if (behaviour === 'invalid-schema') {
        return { output: { schemaVersion: 'wrong', lines: [] }, usage: usage(request.accountingInputCharacters, 32) }
      }
      const output = deterministicOutput(request.context)
      return { output, usage: usage(request.accountingInputCharacters, JSON.stringify(output).length) }
    },
  }
}

/**
 * Yalnız deterministik sağlayıcılar. Bunlar TEST ve açık geliştirme içindir;
 * üretim yolunda sessizce devreye girmezler — `createLaborAllocationProviderRegistry`
 * üretimde deterministik adaptörleri yalnız açık izinle ekler.
 */
export function createDeterministicLaborAllocationProviderRegistry(): LaborAllocationProviderRegistry {
  return registryOf([
    deterministicAdapter('deterministic-success', 'success'),
    deterministicAdapter('deterministic-invalid-schema', 'invalid-schema'),
    deterministicAdapter('deterministic-timeout', 'timeout'),
    deterministicAdapter('deterministic-failure', 'failure'),
  ])
}

function registryOf(adapters: readonly LaborAllocationProviderAdapter[]): LaborAllocationProviderRegistry {
  const index = new Map(adapters.map((adapter) => [adapter.providerId, adapter]))
  return {
    get: (providerId) => index.get(providerId),
    list: () => adapters,
  }
}

/**
 * Üretim kaydı. Gerçek Gemini adaptörü yalnız açık opt-in yapılandırma ile
 * eklenir; deterministik harness yalnız `allowDeterministic` açıkken görünür.
 * Böylece üretimde sahte sağlayıcı sessizce devreye giremez.
 */
export function createLaborAllocationProviderRegistry(input: {
  readonly gemini?: LaborAllocationProviderAdapter
  readonly allowDeterministic?: boolean
}): LaborAllocationProviderRegistry {
  const adapters: LaborAllocationProviderAdapter[] = []
  if (input.gemini !== undefined) adapters.push(input.gemini)
  if (input.allowDeterministic === true) {
    adapters.push(
      deterministicAdapter('deterministic-success', 'success'),
      deterministicAdapter('deterministic-invalid-schema', 'invalid-schema'),
      deterministicAdapter('deterministic-timeout', 'timeout'),
      deterministicAdapter('deterministic-failure', 'failure'),
    )
  }
  return registryOf(adapters)
}

export const LABOR_ALLOCATION_RULE_VERSION_EXPORT = LABOR_ALLOCATION_RULE_VERSION
