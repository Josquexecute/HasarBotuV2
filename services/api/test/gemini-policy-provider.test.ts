import { describe, expect, it, vi } from 'vitest'
import {
  createGeminiPolicyProvider,
  DEFAULT_GEMINI_API_ORIGIN,
  GEMINI_FREE_TIER_FALLBACK_MODEL_ID,
  GEMINI_FREE_TIER_MODEL_ID,
  GEMINI_UNAVAILABLE_BACKOFF_MS,
  MAX_GEMINI_API_KEY_LENGTH,
  normalizeGeminiApiKey,
} from '../src/index.js'

const config = {
  apiKey: 'gemini-test-only-not-a-real-secret-0001',
  modelId: GEMINI_FREE_TIER_MODEL_ID,
  maximumInputCharacters: 50_000,
  maximumOutputSize: 100_000,
  maximumOutputTokens: 2_048,
}

const request = {
  accountingInputCharacters: 64,
  providerRequestId: 'a'.repeat(64),
  systemContract: { promptTemplateVersion: 'policy-ai-extraction/1.0.0', instruction: 'Extract only source-grounded fields.' },
  outputContract: { schemaVersion: 'policy-ai-candidates/1.0.0', maximumCandidates: 10 },
  sourceBundle: { sourceBundleHash: 'b'.repeat(64), sources: [{ sourceAnchorId: 'c'.repeat(64), text: 'Muafiyet %10. [PII:NAME_1]', sourceQuality: 'high' as const, warnings: [] }] },
}

function successResponse(output: unknown, usage: Record<string, unknown> = { promptTokenCount: 80, candidatesTokenCount: 40, thoughtsTokenCount: 5 }): Response {
  const wireOutput = output !== null && typeof output === 'object' && !Array.isArray(output) && Array.isArray((output as Record<string, unknown>).candidates)
    ? {
        ...(output as Record<string, unknown>),
        candidates: ((output as Record<string, unknown>).candidates as unknown[]).map((candidate) => {
          if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate) || !('normalizedValue' in candidate)) return candidate
          const wireCandidate = { ...(candidate as Record<string, unknown>) }
          const normalizedValue = wireCandidate.normalizedValue
          delete wireCandidate.normalizedValue
          return { ...wireCandidate, normalizedValueJson: JSON.stringify(normalizedValue) }
        }),
      }
    : output
  return new Response(JSON.stringify({
    responseId: 'gemini_response_test',
    modelVersion: GEMINI_FREE_TIER_MODEL_ID,
    candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: JSON.stringify(wireOutput) }] } }],
    usageMetadata: usage,
  }), { status: 200, headers: { 'x-request-id': 'gemini_request_test' } })
}

describe('Gemini GenerateContent policy provider adapter', () => {
  it('API key biçimini tahmin etmeden yalnız boşluk ve güvenli uzunluk sınırını uygular', () => {
    expect(normalizeGeminiApiKey('  key.with+provider/specific=characters  ')).toBe('key.with+provider/specific=characters')
    expect(normalizeGeminiApiKey(undefined)).toBeNull()
    expect(normalizeGeminiApiKey(' \r\n\t ')).toBeNull()
    expect(normalizeGeminiApiKey('x'.repeat(MAX_GEMINI_API_KEY_LENGTH + 1))).toBeNull()
  })

  it('yalnız resmi endpoint, header secret, structured output ve ücretsiz sayaçla çalışır', async () => {
    let endpoint = '', sent: Record<string, unknown> | undefined, headers = new Headers()
    const output = { schemaVersion: 'policy-ai-candidates/1.0.0', candidates: [{ candidateId: 'd-10', category: 'deductible', canonicalField: 'deductible.conditional', normalizedValue: { percentage: 10 }, originalValue: '%10', conditions: [], exceptions: [], sourceAnchorIds: ['c'.repeat(64)], providerConfidence: 0.9 }] }
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      endpoint = String(input)
      headers = new Headers(init?.headers)
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>
      return successResponse(output)
    })
    const provider = createGeminiPolicyProvider(config, fetchMock)
    const result = await provider.execute(request, new AbortController().signal)
    if (sent === undefined) throw new Error('Gemini request payload was not captured.')
    const generationConfig = sent.generationConfig as Record<string, unknown>
    const systemInstruction = sent.systemInstruction as { parts?: Array<{ text?: string }> }
    const trustedOutputContract = systemInstruction.parts?.[0]?.text ?? ''
    expect(endpoint).toBe(`${DEFAULT_GEMINI_API_ORIGIN}/v1beta/models/${GEMINI_FREE_TIER_MODEL_ID}:generateContent`)
    expect(headers.get('x-goog-api-key')).toBe(config.apiKey)
    expect(headers.has('authorization')).toBe(false)
    expect(headers.get('x-client-request-id')).toBe('a'.repeat(64))
    expect(sent).toMatchObject({
      generationConfig: {
        candidateCount: 1,
        maxOutputTokens: 2_048,
        temperature: 0,
        responseMimeType: 'application/json',
        responseJsonSchema: { type: 'object', required: ['schemaVersion', 'candidates'] },
      },
    })
    expect(generationConfig).not.toHaveProperty('responseFormat')
    expect(generationConfig).not.toHaveProperty('responseSchema')
    expect(JSON.stringify(generationConfig.responseJsonSchema)).toContain('normalizedValueJson')
    expect(JSON.stringify(generationConfig.responseJsonSchema)).not.toMatch(/anyOf|additionalProperties|enum|minimum|maximum|minItems|maxItems|description|"normalizedValue"/)
    expect(sent).not.toHaveProperty('tools')
    expect(sent).not.toHaveProperty('cachedContent')
    expect(JSON.stringify(sent)).not.toContain('sourceBundleHash')
    expect(trustedOutputContract).toContain('policy-ai-candidates/1.0.0')
    expect(trustedOutputContract).toContain('"maximumCandidates":10')
    expect(trustedOutputContract).toContain('"candidateCategories":["policy_identity","coverage","deductible","service_rule","part_rule"')
    expect(trustedOutputContract).toContain('[A-Za-z0-9_.-]')
    expect(trustedOutputContract).toContain('[a-z0-9_.-]')
    expect(trustedOutputContract).not.toContain('Muafiyet %10')
    expect(provider.descriptor).toMatchObject({ retentionMode: 'free_tier_product_improvement', pricingVersion: 'gemini-free-tier/2026-07-15' })
    expect(result.usage).toMatchObject({ inputCharacters: 64, inputTokens: 80, outputTokens: 45, estimatedCostMinor: 0, actualCostMinor: 0 })
    expect(result.output).toEqual(output)
    expect(result.responseMetadata).toEqual({ providerResponseId: 'gemini_response_test', providerRequestId: 'gemini_request_test' })
  })

  it('4xx gövdesinden yalnız güvenli status ve alan yolunu teşhise taşır', async () => {
    const provider = createGeminiPolicyProvider(config, async () => new Response(JSON.stringify({
      error: {
        code: 400,
        status: 'INVALID_ARGUMENT',
        message: 'raw-secret-provider-error',
        details: [{ fieldViolations: [{ field: 'generation_config.response_json_schema', description: 'secret schema description' }] }],
      },
    }), { status: 400 }))
    const error = await provider.execute(request, new AbortController().signal).catch((value: unknown) => value)
    expect(error).toMatchObject({
      message: 'provider_request_rejected',
      requestOutcome: 'response_received',
      safeDiagnosticCode: 'GEMINI_HTTP_400_INVALID_ARGUMENT_FIELD_RESPONSE_JSON_SCHEMA_FIELD_GENERATION_CONFIG',
    })
    expect(JSON.stringify(error)).not.toMatch(/raw-secret|schema description/i)
  })

  it('503 UNAVAILABLE için iki sınırlı backoff sonrası aynı isteği başarıyla tamamlar', async () => {
    let calls = 0
    const waits: number[] = []
    const output = { schemaVersion: 'policy-ai-candidates/1.0.0', candidates: [] }
    const provider = createGeminiPolicyProvider(config, async () => {
      calls += 1
      return calls < 3
        ? new Response(null, { status: 503, headers: { 'x-request-id': `unavailable-${calls}` } })
        : successResponse(output)
    }, async (milliseconds) => { waits.push(milliseconds) })
    await expect(provider.execute(request, new AbortController().signal)).resolves.toMatchObject({ output })
    expect(calls).toBe(3)
    expect(waits).toEqual([...GEMINI_UNAVAILABLE_BACKOFF_MS])
  })

  it('503 retry sınırı tükenince retryable provider-unavailable üretir; diğer 5xx retry yapmaz', async () => {
    let unavailableCalls = 0
    const unavailable = createGeminiPolicyProvider(config, async () => {
      unavailableCalls += 1
      return new Response(null, { status: 503, headers: { 'x-request-id': 'unavailable-final' } })
    }, async () => undefined)
    await expect(unavailable.execute(request, new AbortController().signal)).rejects.toMatchObject({
      message: 'provider_unavailable', requestOutcome: 'response_received', providerRequestId: 'unavailable-final',
    })
    expect(unavailableCalls).toBe(3)

    let internalCalls = 0
    const internal = createGeminiPolicyProvider(config, async () => {
      internalCalls += 1
      return new Response(null, { status: 500 })
    }, async () => undefined)
    await expect(internal.execute(request, new AbortController().signal)).rejects.toMatchObject({ message: 'provider_unavailable' })
    expect(internalCalls).toBe(1)
  })

  it('stable ücretsiz 2.5 Flash fallback modelini aynı GenerateContent structured-output biçimiyle çalıştırabilir', async () => {
    let endpoint = '', sent: Record<string, unknown> | undefined
    const output = { schemaVersion: 'policy-ai-candidates/1.0.0', candidates: [] }
    const provider = createGeminiPolicyProvider({ ...config, modelId: GEMINI_FREE_TIER_FALLBACK_MODEL_ID }, async (input, init) => {
      endpoint = String(input)
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>
      return successResponse(output)
    })
    await provider.execute(request, new AbortController().signal)
    if (sent === undefined) throw new Error('Gemini fallback request payload was not captured.')
    const generationConfig = sent.generationConfig as Record<string, unknown>
    expect(endpoint).toBe(`${DEFAULT_GEMINI_API_ORIGIN}/v1beta/models/${GEMINI_FREE_TIER_FALLBACK_MODEL_ID}:generateContent`)
    expect(provider.descriptor.modelId).toBe(GEMINI_FREE_TIER_FALLBACK_MODEL_ID)
    expect(generationConfig).toMatchObject({
      responseMimeType: 'application/json',
      responseJsonSchema: { type: 'object', required: ['schemaVersion', 'candidates'] },
    })
    expect(generationConfig).not.toHaveProperty('responseFormat')
    expect(generationConfig).not.toHaveProperty('responseSchema')
  })

  it('network kesintisini sonucu belirsiz çağrı olarak işaretler', async () => {
    const provider = createGeminiPolicyProvider(config, async () => { throw new TypeError('socket kapandı ve secret sızmamalı') })
    await expect(provider.execute(request, new AbortController().signal)).rejects.toMatchObject({
      message: 'provider_network_failure', requestOutcome: 'unknown', providerRequestId: null,
    })
  })

  it('usage veya finish reason eksikliğini response-received fail-closed tutar', async () => {
    const output = { schemaVersion: 'policy-ai-candidates/1.0.0', candidates: [] }
    const invalidUsage = createGeminiPolicyProvider(config, async () => successResponse(output, { promptTokenCount: 'invalid', candidatesTokenCount: 1 }))
    await expect(invalidUsage.execute(request, new AbortController().signal)).rejects.toMatchObject({ message: 'provider_usage_invalid', requestOutcome: 'response_received' })
    const incomplete = createGeminiPolicyProvider(config, async () => new Response(JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: JSON.stringify(output) }] } }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } }), { status: 200 }))
    await expect(incomplete.execute(request, new AbortController().signal)).rejects.toMatchObject({ message: 'provider_response_incomplete', requestOutcome: 'response_received' })
    const invalidNormalizedValue = createGeminiPolicyProvider(config, async () => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ schemaVersion: 'policy-ai-candidates/1.0.0', candidates: [{ normalizedValueJson: '{invalid' }] }) }] } }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } }), { status: 200 }))
    await expect(invalidNormalizedValue.execute(request, new AbortController().signal)).rejects.toMatchObject({ message: 'provider_response_invalid', requestOutcome: 'response_received' })
  })

  it('thought metadata ve bölünmüş text part içeren structured outputu bounded biçimde birleştirir', async () => {
    const output = { schemaVersion: 'policy-ai-candidates/1.0.0', candidates: [] }
    const serialized = JSON.stringify(output)
    const provider = createGeminiPolicyProvider(config, async () => new Response(JSON.stringify({
      candidates: [{
        finishReason: 'STOP',
        content: { parts: [
          { thought: true, text: 'internal summary must not become output' },
          { text: '', thoughtSignature: 'opaque-signature' },
          { text: serialized.slice(0, 20) },
          { text: serialized.slice(20), thoughtSignature: 'opaque-final-signature' },
        ] },
      }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    }), { status: 200 }))
    await expect(provider.execute(request, new AbortController().signal)).resolves.toMatchObject({ output })
  })

  it('thought signature taşısa bile function partı structured output gibi kabul etmez', async () => {
    const provider = createGeminiPolicyProvider(config, async () => new Response(JSON.stringify({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ functionCall: { name: 'forbidden' }, thoughtSignature: 'opaque-signature' }] } }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    }), { status: 200 }))
    await expect(provider.execute(request, new AbortController().signal)).rejects.toMatchObject({
      message: 'provider_response_incomplete',
      requestOutcome: 'response_received',
    })
  })
})
