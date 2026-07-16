import { describe, expect, it } from 'vitest'
import {
  GEMINI_FREE_TIER_FALLBACK_MODEL_ID,
  GEMINI_FREE_TIER_MODEL_ID,
  PolicyAiProviderExecutionError,
} from '../src/policy-ai/index.js'
import { executeGeminiPilotExtraction, executeGeminiPilotWithFallback } from '../test-support/gemini-pilot-model-fallback.js'

describe('Gemini sentetik pilot model fallback', () => {
  it('3.5 unavailable olursa stable ücretsiz 2.5 Flash ile bir kez devam eder', async () => {
    const attempts: string[] = []
    const result = await executeGeminiPilotWithFallback(async (modelId) => {
      attempts.push(modelId)
      if (modelId === GEMINI_FREE_TIER_MODEL_ID) throw new PolicyAiProviderExecutionError('provider_unavailable', 'response_received')
      return 'ok'
    })
    expect(result).toEqual({ modelId: GEMINI_FREE_TIER_FALLBACK_MODEL_ID, fallbackUsed: true, value: 'ok' })
    expect(attempts).toEqual([GEMINI_FREE_TIER_MODEL_ID, GEMINI_FREE_TIER_FALLBACK_MODEL_ID])
  })

  it('primary başarılıysa fallback çağrısı yapmaz', async () => {
    const attempts: string[] = []
    const result = await executeGeminiPilotWithFallback(async (modelId) => { attempts.push(modelId);return 'ok' })
    expect(result).toEqual({ modelId: GEMINI_FREE_TIER_MODEL_ID, fallbackUsed: false, value: 'ok' })
    expect(attempts).toEqual([GEMINI_FREE_TIER_MODEL_ID])
  })

  it('auth, kota veya doğrulama hatasını fallback ile gizlemez', async () => {
    for (const code of ['provider_authentication_failed', 'provider_rate_limited', 'provider_response_invalid']) {
      const attempts: string[] = []
      await expect(executeGeminiPilotWithFallback(async (modelId) => {
        attempts.push(modelId)
        throw new PolicyAiProviderExecutionError(code, 'response_received')
      })).rejects.toMatchObject({ message: code })
      expect(attempts).toEqual([GEMINI_FREE_TIER_MODEL_ID])
    }
  })

  it('gerçek extraction timeout aşamasını güvenli kodla açıklar', async () => {
    const error = await executeGeminiPilotExtraction(async () => {
      throw new PolicyAiProviderExecutionError('provider_timeout', 'unknown')
    }).catch((value: unknown) => value)
    expect(error).toMatchObject({
      message: 'provider_timeout',
      requestOutcome: 'unknown',
      safeDiagnosticCode: 'GEMINI_STAGE_EXTRACTION_TIMEOUT',
    })
  })
})
