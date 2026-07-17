import {
  EMAIL_AI_OUTPUT_SCHEMA_VERSION,
  type EmailAiProviderId,
} from '@hasarbotu/domain'

export interface EmailAiProviderRequest {
  readonly accountingInputCharacters: number
  readonly providerRequestId: string
  readonly context: {
    readonly caseType: 'traffic' | 'casco'
    readonly draftType: string
    readonly sourceRule: string
    readonly baseBody: string
    readonly instruction: string | null
    readonly missingRequirementCodes: readonly string[]
    readonly controlRequiredRequirementCodes: readonly string[]
  }
}

export interface EmailAiProviderUsage {
  readonly inputCharacters: number
  readonly outputCharacters: number
  readonly inputTokens: number | null
  readonly outputTokens: number | null
  readonly estimatedCostMinor: number
  readonly actualCostMinor: number
}

export interface EmailAiProviderResponse {
  readonly output: unknown
  readonly usage: EmailAiProviderUsage
  readonly responseMetadata?: {
    readonly providerResponseId: string | null
    readonly providerRequestId: string | null
  }
}

export class EmailAiProviderExecutionError extends Error {
  constructor(
    message: string,
    readonly requestOutcome: 'response_received' | 'unknown',
    readonly providerRequestId: string | null = null,
    readonly safeDiagnosticCode: string | null = null,
  ) {
    super(message)
  }
}

export interface EmailAiProviderDescriptor {
  readonly providerId: EmailAiProviderId
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

export interface EmailAiProviderAdapter {
  readonly descriptor: EmailAiProviderDescriptor
  execute(request: EmailAiProviderRequest, signal: AbortSignal): Promise<EmailAiProviderResponse>
}

export interface EmailAiProviderRegistry {
  get(providerId: EmailAiProviderId): EmailAiProviderAdapter | undefined
  list(): readonly EmailAiProviderDescriptor[]
}

class DeterministicEmailProvider implements EmailAiProviderAdapter {
  readonly descriptor: EmailAiProviderDescriptor
  calls = 0

  constructor(readonly kind: Extract<EmailAiProviderId, `deterministic-${string}`>) {
    this.descriptor = {
      providerId: kind,
      providerVersion: 'deterministic-email/1.0.0',
      modelId: 'local-email-fixture-v1',
      capabilities: ['structured_output', 'pii_minimized_payload'],
      maximumInputCharacters: 200_000,
      maximumOutputSize: 100_000,
      externalProvider: false,
      retentionMode: 'local_only',
      pricingVersion: 'deterministic-cost/1.0.0',
      estimateCostMinor: (inputCharacters) => Math.max(1, Math.ceil(inputCharacters / 10_000)),
    }
  }

  async execute(request: EmailAiProviderRequest, signal: AbortSignal): Promise<EmailAiProviderResponse> {
    this.calls += 1
    if (this.kind === 'deterministic-timeout') {
      return await new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('provider_timeout')), { once: true })
      })
    }
    if (this.kind === 'deterministic-failure') throw new Error('provider_failed')
    if (this.kind === 'deterministic-invalid-schema') {
      const output = {
        schemaVersion: EMAIL_AI_OUTPUT_SCHEMA_VERSION,
        subjectSuffix: '',
        body: 'https://unsafe.example',
        rawProviderOutput: 'must-not-persist',
      }
      return { output, usage: this.usage(request, JSON.stringify(output).length) }
    }
    const subjectSuffix = request.context.draftType === 'missing_document_request'
      ? 'Eksik Evrak Hatırlatması'
      : 'Dosya Bilgilendirmesi'
    const output = {
      schemaVersion: EMAIL_AI_OUTPUT_SCHEMA_VERSION,
      subjectSuffix,
      body: request.context.baseBody,
      reasoning: 'Deterministik test sağlayıcısı mevcut şablonu kısa ve kontrollü biçimde korudu.',
      warnings: ['Alıcı, konu ve mesaj kullanıcı tarafından doğrulanmalıdır.'],
      confidence: 0.82,
      requiresHumanReview: true,
    }
    return { output, usage: this.usage(request, JSON.stringify(output).length) }
  }

  private usage(request: EmailAiProviderRequest, outputCharacters: number): EmailAiProviderUsage {
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

export interface DeterministicEmailAiProviderRegistry extends EmailAiProviderRegistry {
  getCallCount(providerId: EmailAiProviderId): number
}

export function createEmailAiProviderRegistry(
  adapters: readonly EmailAiProviderAdapter[],
): EmailAiProviderRegistry {
  const map = new Map<EmailAiProviderId, EmailAiProviderAdapter>()
  for (const adapter of adapters) {
    if (map.has(adapter.descriptor.providerId)) throw new Error('duplicate_email_ai_provider')
    map.set(adapter.descriptor.providerId, adapter)
  }
  return {
    get: (providerId) => map.get(providerId),
    list: () => [...map.values()]
      .map((adapter) => adapter.descriptor)
      .sort((left, right) => left.providerId.localeCompare(right.providerId, 'en')),
  }
}

export function createDeterministicEmailAiProviderRegistry(): DeterministicEmailAiProviderRegistry {
  const map = new Map<EmailAiProviderId, DeterministicEmailProvider>()
  for (const providerId of [
    'deterministic-success',
    'deterministic-invalid-schema',
    'deterministic-timeout',
    'deterministic-failure',
  ] as const) {
    map.set(providerId, new DeterministicEmailProvider(providerId))
  }
  return {
    get: (providerId) => map.get(providerId),
    list: () => [...map.values()]
      .map((adapter) => adapter.descriptor)
      .sort((left, right) => left.providerId.localeCompare(right.providerId, 'en')),
    getCallCount: (providerId) => map.get(providerId)?.calls ?? 0,
  }
}

export function isEmailAiProviderDescriptorCompatible(
  descriptor: EmailAiProviderDescriptor,
  expected?: {
    readonly providerId: EmailAiProviderId
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

export async function executeEmailAiProvider(
  adapter: EmailAiProviderAdapter,
  request: EmailAiProviderRequest,
  timeoutMs: number,
): Promise<EmailAiProviderResponse> {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort()
      reject(new EmailAiProviderExecutionError('provider_timeout', 'unknown'))
    }, timeoutMs)
  })
  try {
    return await Promise.race([adapter.execute(request, controller.signal), deadline])
  } finally {
    controller.abort()
    if (timeout !== undefined) clearTimeout(timeout)
  }
}
