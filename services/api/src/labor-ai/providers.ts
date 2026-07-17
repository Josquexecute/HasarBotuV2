import {
  LABOR_AI_OUTPUT_SCHEMA_VERSION,
  type LaborAiProviderId,
} from '@hasarbotu/domain'

export interface LaborAiProviderRequest {
  readonly accountingInputCharacters: number
  readonly providerRequestId: string
  readonly context: {
    readonly caseType: 'traffic' | 'casco'
    readonly damageDescription: string
    readonly currentItems: readonly {
      readonly description: string
      readonly action: string
      readonly partAmountMinor: number
      readonly laborAmountMinor: number
    }[]
  }
}

export interface LaborAiProviderUsage {
  readonly inputCharacters: number
  readonly outputCharacters: number
  readonly inputTokens: number | null
  readonly outputTokens: number | null
  readonly estimatedCostMinor: number
  readonly actualCostMinor: number
}

export interface LaborAiProviderResponse {
  readonly output: unknown
  readonly usage: LaborAiProviderUsage
  readonly responseMetadata?: {
    readonly providerResponseId: string | null
    readonly providerRequestId: string | null
  }
}

export class LaborAiProviderExecutionError extends Error {
  constructor(
    message: string,
    readonly requestOutcome: 'response_received' | 'unknown',
    readonly providerRequestId: string | null = null,
    readonly safeDiagnosticCode: string | null = null,
  ) {
    super(message)
  }
}

export interface LaborAiProviderDescriptor {
  readonly providerId: LaborAiProviderId
  readonly providerVersion: string
  readonly modelId: string
  readonly capabilities: readonly string[]
  readonly maximumInputCharacters: number
  readonly maximumOutputSize: number
  readonly externalProvider: boolean
  readonly retentionMode: 'local_only' | 'store_false' | 'free_tier_product_improvement'
  readonly pricingVersion: string
  estimateCostMinor(inputCharacters: number): number
}

export interface LaborAiProviderAdapter {
  readonly descriptor: LaborAiProviderDescriptor
  execute(request: LaborAiProviderRequest, signal: AbortSignal): Promise<LaborAiProviderResponse>
}

export interface LaborAiProviderRegistry {
  get(providerId: LaborAiProviderId): LaborAiProviderAdapter | undefined
  list(): readonly LaborAiProviderDescriptor[]
}

class DeterministicLaborProvider implements LaborAiProviderAdapter {
  readonly descriptor: LaborAiProviderDescriptor
  calls = 0

  constructor(readonly kind: Extract<LaborAiProviderId, `deterministic-${string}`>) {
    this.descriptor = {
      providerId: kind,
      providerVersion: 'deterministic-labor/1.0.0',
      modelId: 'local-labor-fixture-v1',
      capabilities: ['structured_output', 'pii_minimized_payload'],
      maximumInputCharacters: 200_000,
      maximumOutputSize: 100_000,
      externalProvider: false,
      retentionMode: 'local_only',
      pricingVersion: 'deterministic-cost/1.0.0',
      estimateCostMinor: (inputCharacters) => Math.max(1, Math.ceil(inputCharacters / 10_000)),
    }
  }

  async execute(request: LaborAiProviderRequest, signal: AbortSignal): Promise<LaborAiProviderResponse> {
    this.calls += 1
    if (this.kind === 'deterministic-timeout') {
      return await new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('provider_timeout')), { once: true })
      })
    }
    if (this.kind === 'deterministic-failure') throw new Error('provider_failed')
    if (this.kind === 'deterministic-invalid-schema') {
      const output = {
        schemaVersion: LABOR_AI_OUTPUT_SCHEMA_VERSION,
        items: [],
        reasoning: 'https://unsafe.example',
        rawProviderOutput: 'must-not-persist',
      }
      return { output, usage: this.usage(request, JSON.stringify(output).length) }
    }
    // Kullanıcı metni yankılanmaz: yerel modda metin redakte edilmediği için
    // olası PII'nin çıktı doğrulamasına taşınmaması sabit temiz kalemlerle sağlanır.
    const output = {
      schemaVersion: LABOR_AI_OUTPUT_SCHEMA_VERSION,
      items: [
        { description: 'Ön tampon kaplama', action: 'Değişim', partAmountMinor: 18_400_00, laborAmountMinor: 2_200_00 },
        { description: 'Sol ön çamurluk', action: 'Onarım + boya', partAmountMinor: 0, laborAmountMinor: 6_750_00 },
      ],
      reasoning: 'Deterministik test sağlayıcısı hasar tarifi için standart kontrollü dağılımı önerdi.',
      warnings: ['Kalem, işlem ve tutarlar eksper tarafından doğrulanmalıdır.'],
      confidence: 0.82,
      requiresHumanReview: true,
    }
    return { output, usage: this.usage(request, JSON.stringify(output).length) }
  }

  private usage(request: LaborAiProviderRequest, outputCharacters: number): LaborAiProviderUsage {
    const cost = this.descriptor.estimateCostMinor(request.accountingInputCharacters)
    return {
      inputCharacters: request.accountingInputCharacters,
      outputCharacters,
      inputTokens: null,
      outputTokens: null,
      estimatedCostMinor: cost,
      actualCostMinor: cost,
    }
  }
}

export interface DeterministicLaborAiProviderRegistry extends LaborAiProviderRegistry {
  getCallCount(providerId: LaborAiProviderId): number
}

export function createLaborAiProviderRegistry(
  adapters: readonly LaborAiProviderAdapter[],
): LaborAiProviderRegistry {
  const map = new Map<LaborAiProviderId, LaborAiProviderAdapter>()
  for (const adapter of adapters) {
    if (map.has(adapter.descriptor.providerId)) throw new Error('duplicate_labor_ai_provider')
    map.set(adapter.descriptor.providerId, adapter)
  }
  return {
    get: (providerId) => map.get(providerId),
    list: () => [...map.values()]
      .map((adapter) => adapter.descriptor)
      .sort((left, right) => left.providerId.localeCompare(right.providerId, 'en')),
  }
}

export function createDeterministicLaborAiProviderRegistry(): DeterministicLaborAiProviderRegistry {
  const map = new Map<LaborAiProviderId, DeterministicLaborProvider>()
  for (const providerId of [
    'deterministic-success',
    'deterministic-invalid-schema',
    'deterministic-timeout',
    'deterministic-failure',
  ] as const) {
    map.set(providerId, new DeterministicLaborProvider(providerId))
  }
  return {
    get: (providerId) => map.get(providerId),
    list: () => [...map.values()]
      .map((adapter) => adapter.descriptor)
      .sort((left, right) => left.providerId.localeCompare(right.providerId, 'en')),
    getCallCount: (providerId) => map.get(providerId)?.calls ?? 0,
  }
}

export function isLaborAiProviderDescriptorCompatible(
  descriptor: LaborAiProviderDescriptor,
  expected?: {
    readonly providerId: LaborAiProviderId
    readonly providerVersion: string
    readonly modelId: string
    readonly inputCharacters: number
  },
): boolean {
  if (!descriptor.capabilities.includes('structured_output')) return false
  if (
    !Number.isSafeInteger(descriptor.maximumInputCharacters)
    || descriptor.maximumInputCharacters < 1
    || descriptor.maximumInputCharacters > 200_000
    || !Number.isSafeInteger(descriptor.maximumOutputSize)
    || descriptor.maximumOutputSize < 1
    || descriptor.maximumOutputSize > 1_000_000
  ) return false
  if (descriptor.externalProvider && !['store_false', 'free_tier_product_improvement'].includes(descriptor.retentionMode)) {
    return false
  }
  if (expected === undefined) return true
  return descriptor.providerId === expected.providerId
    && descriptor.providerVersion === expected.providerVersion
    && descriptor.modelId === expected.modelId
    && expected.inputCharacters <= descriptor.maximumInputCharacters
}

export async function executeLaborAiProvider(
  adapter: LaborAiProviderAdapter,
  request: LaborAiProviderRequest,
  timeoutMs: number,
): Promise<LaborAiProviderResponse> {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort()
      reject(new LaborAiProviderExecutionError('provider_timeout', 'unknown'))
    }, timeoutMs)
  })
  try {
    return await Promise.race([adapter.execute(request, controller.signal), deadline])
  } finally {
    controller.abort()
    if (timeout !== undefined) clearTimeout(timeout)
  }
}
