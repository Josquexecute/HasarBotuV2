import {
  GEMINI_FREE_TIER_FALLBACK_MODEL_ID,
  GEMINI_FREE_TIER_MODEL_ID,
  type GeminiFreeTierModelId,
} from '../src/policy-ai/gemini-provider.js'
import { PolicyAiProviderExecutionError } from '../src/policy-ai/providers.js'

export const GEMINI_PILOT_MODEL_ORDER = [
  GEMINI_FREE_TIER_MODEL_ID,
  GEMINI_FREE_TIER_FALLBACK_MODEL_ID,
] as const

export interface GeminiPilotModelResult<T> {
  readonly modelId: GeminiFreeTierModelId
  readonly fallbackUsed: boolean
  readonly value: T
}

export async function executeGeminiPilotExtraction<T>(execute: () => Promise<T>): Promise<T> {
  try { return await execute() }
  catch (error) {
    if (error instanceof PolicyAiProviderExecutionError && error.message === 'provider_timeout') {
      throw new PolicyAiProviderExecutionError(
        'provider_timeout',
        error.requestOutcome,
        error.providerRequestId,
        error.safeDiagnosticCode ?? 'GEMINI_STAGE_EXTRACTION_TIMEOUT',
      )
    }
    throw error
  }
}

/**
 * Yalnız sentetik canlı pilot için kontrollü model fallback'i. Primary model
 * kendi sınırlı 503 retry'larını tükettikten sonra provider_unavailable ise
 * stable ücretsiz fallback bir kez denenir. Auth, kota, schema veya kanıt
 * hataları model değiştirerek gizlenmez.
 */
export async function executeGeminiPilotWithFallback<T>(
  execute: (modelId: GeminiFreeTierModelId) => Promise<T>,
): Promise<GeminiPilotModelResult<T>> {
  try {
    return { modelId: GEMINI_FREE_TIER_MODEL_ID, fallbackUsed: false, value: await execute(GEMINI_FREE_TIER_MODEL_ID) }
  } catch (error) {
    if (!(error instanceof PolicyAiProviderExecutionError) || error.message !== 'provider_unavailable') throw error
  }
  return {
    modelId: GEMINI_FREE_TIER_FALLBACK_MODEL_ID,
    fallbackUsed: true,
    value: await execute(GEMINI_FREE_TIER_FALLBACK_MODEL_ID),
  }
}
