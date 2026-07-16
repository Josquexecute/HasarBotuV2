import { describe, expect, it, vi } from 'vitest'
import { GEMINI_FREE_TIER_FALLBACK_MODEL_ID, PolicyAiProviderExecutionError } from '../src/policy-ai/index.js'
import { GEMINI_SCHEMA_PREFLIGHT_MAX_OUTPUT_TOKENS, runGeminiStructuredOutputPreflight } from '../test-support/gemini-structured-output-preflight.js'

const config = {
  apiKey: 'gemini-test-only-secret-must-not-leak',
  modelId: GEMINI_FREE_TIER_FALLBACK_MODEL_ID,
  timeoutMs: 10_000,
}

function success(): Response {
  return new Response(JSON.stringify({
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"ok":"accepted"}' }] } }],
  }), { status: 200 })
}

describe('Gemini structured-output güvenli preflight', () => {
  it('minimal şemadan provider wire ve eski constraint gruplarına deterministik sırayla ilerler', async () => {
    const payloads: Array<Record<string, unknown>> = []
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return success()
    })
    const result = await runGeminiStructuredOutputPreflight(config, fetchMock)
    expect(result).toMatchObject({ providerCompatible: true, firstRejectedStageId: null, firstRejectedDiagnosticStageId: null })
    expect(result.stages.map((stage) => stage.stageId)).toEqual([
      'minimal_object', 'envelope', 'scalar_candidate', 'provider_wire',
      'enum_constraints', 'numeric_constraints', 'array_constraints', 'legacy_combined_constraints',
    ])
    expect(payloads).toHaveLength(8)
    for (const payload of payloads) {
      expect(payload).not.toHaveProperty('tools')
      expect(payload).not.toHaveProperty('cachedContent')
      expect(JSON.stringify(payload)).not.toContain(config.apiKey)
      expect(payload).toMatchObject({ generationConfig: { responseMimeType: 'application/json', responseJsonSchema: { type: 'object' } } })
    }
  })

  it('başarılı canlı yol için yalnız üretim wire probe çağrısını yapar', async () => {
    const fetchMock = vi.fn(async () => success())
    const result = await runGeminiStructuredOutputPreflight({ ...config, stageMode: 'production' }, fetchMock)
    expect(result).toMatchObject({ providerCompatible: true, firstRejectedStageId: null })
    expect(result.stages.map((stage) => stage.stageId)).toEqual(['provider_wire'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('preflight thinking için yeterli output bütçesi gönderir ve çoklu text part cevabını kabul eder', async () => {
    let payload: Record<string, unknown> | undefined
    const result = await runGeminiStructuredOutputPreflight({ ...config, stageMode: 'production' }, async (_input, init) => {
      payload = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [
        { thought: true, text: 'ignored thought summary' },
        { text: '{"schemaVersion":"policy-ai-candidates/1.0.0",' },
        { text: '"candidates":[]}', thoughtSignature: 'opaque-signature' },
      ] } }] }), { status: 200 })
    })
    expect(result.providerCompatible).toBe(true)
    expect(payload).toMatchObject({ generationConfig: { maxOutputTokens: GEMINI_SCHEMA_PREFLIGHT_MAX_OUTPUT_TOKENS } })
  })

  it('MAX_TOKENS cevabını genel invalid yerine güvenli finish reason ile açıklar', async () => {
    const result = await runGeminiStructuredOutputPreflight({ ...config, stageMode: 'diagnostic' }, async () => new Response(JSON.stringify({
      candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '' }] } }],
    }), { status: 200 }))
    expect(result.stages[0]).toMatchObject({
      accepted: false,
      safeDiagnosticCode: 'GEMINI_SCHEMA_PROBE_RESPONSE_FINISH_REASON_MAX_TOKENS',
    })
  })

  it('400 sonrası tanı yolu yalnız minimalden üretim wire aşamasına ilerler', async () => {
    const fetchMock = vi.fn(async () => success())
    const result = await runGeminiStructuredOutputPreflight({ ...config, stageMode: 'diagnostic' }, fetchMock)
    expect(result.stages.map((stage) => stage.stageId)).toEqual(['minimal_object', 'envelope', 'scalar_candidate', 'provider_wire'])
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('ilk reddedilen constraint grubunu ham provider metnini taşımadan görünür kılar', async () => {
    let call = 0
    const fetchMock = vi.fn(async () => {
      call += 1
      if (call < 5) return success()
      return new Response(JSON.stringify({
        error: {
          status: 'INVALID_ARGUMENT',
          message: 'Invalid JSON payload received. Unknown name "enum" at generationConfig.responseJsonSchema. raw-secret-value',
          details: [{ fieldViolations: [{ field: 'generation_config.response_json_schema.properties.category.enum', description: 'secret-description' }] }],
        },
      }), { status: 400 })
    })
    const result = await runGeminiStructuredOutputPreflight(config, fetchMock)
    expect(result).toMatchObject({ providerCompatible: true, firstRejectedDiagnosticStageId: 'enum_constraints' })
    expect(result.stages[4]).toMatchObject({
      accepted: false,
      safeDiagnosticCode: expect.stringMatching(/^GEMINI_HTTP_400_INVALID_ARGUMENT_REASON_INVALID_JSON_PAYLOAD_REASON_UNKNOWN_FIELD_FIELD_RESPONSE_JSON_SCHEMA/),
    })
    expect(JSON.stringify(result)).not.toMatch(/raw-secret|secret-description/i)
  })

  it('provider wire reddedilirse daha geniş constraint probe çağrılarına ilerlemez', async () => {
    let call = 0
    const result = await runGeminiStructuredOutputPreflight(config, async () => {
      call += 1
      return call < 4 ? success() : new Response(JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'Schema too complex at responseJsonSchema' } }), { status: 400 })
    })
    expect(result).toMatchObject({ providerCompatible: false, firstRejectedStageId: 'provider_wire' })
    expect(result.stages).toHaveLength(4)
  })

  it('503 için aynı aşamada sınırlı retry yapar ve retryable unavailable üretir', async () => {
    let calls = 0
    const waits: number[] = []
    const error = await runGeminiStructuredOutputPreflight(config, async () => {
      calls += 1
      return new Response(null, { status: 503 })
    }, async (milliseconds) => { waits.push(milliseconds) }).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(PolicyAiProviderExecutionError)
    expect(error).toMatchObject({ message: 'provider_unavailable', requestOutcome: 'response_received' })
    expect(calls).toBe(3)
    expect(waits).toEqual([500, 1_500])
  })

  it('ortak deadline dolarsa timeout aşamasını güvenli kodla bildirir', async () => {
    const error = await runGeminiStructuredOutputPreflight({ ...config, timeoutMs: 5, stageMode: 'production' }, async (_input, init) => await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('raw timeout detail must not leak')), { once: true })
    })).catch((value: unknown) => value)
    expect(error).toMatchObject({
      message: 'provider_timeout',
      requestOutcome: 'unknown',
      safeDiagnosticCode: 'GEMINI_STAGE_PROVIDER_WIRE_TIMEOUT',
    })
    expect(JSON.stringify(error)).not.toMatch(/raw timeout detail/i)
  })
})
