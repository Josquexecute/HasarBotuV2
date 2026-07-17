import { describe, expect, it, vi } from 'vitest'
import {
  createGeminiEmailAiProvider,
  DEFAULT_GEMINI_API_ORIGIN,
  GEMINI_FREE_TIER_FALLBACK_MODEL_ID,
  GEMINI_UNAVAILABLE_BACKOFF_MS,
} from '../src/index.js'

const config = {
  apiKey: 'gemini-email-test-only-not-a-real-secret',
  modelId: GEMINI_FREE_TIER_FALLBACK_MODEL_ID,
  maximumInputCharacters: 50_000,
  maximumOutputSize: 100_000,
  maximumOutputTokens: 2_048,
}
const request = {
  accountingInputCharacters: 180,
  providerRequestId: 'a'.repeat(64),
  context: {
    caseType: 'traffic' as const,
    draftType: 'missing_document_request',
    sourceRule: 'missing_document_request',
    baseBody: 'Merhaba. Eksik evrakların iletilmesini rica ederiz.',
    instruction: null,
    missingRequirementCodes: ['victim_registration'],
    controlRequiredRequirementCodes: [],
  },
}
const output = {
  schemaVersion: 'email-ai-suggestion/1.0.0',
  subjectSuffix: 'Eksik Evrak Hatırlatması',
  body: 'Merhaba. Eksik evrakların iletilmesini rica ederiz.',
  reasoning: 'Sürümlü şablon sadeleştirildi.',
  warnings: ['Kullanıcı kontrolü zorunludur.'],
  confidence: 0.82,
  requiresHumanReview: true,
}

function successResponse(): Response {
  return new Response(JSON.stringify({
    responseId: 'gemini_email_response_test',
    candidates: [{
      finishReason: 'STOP',
      content: { role: 'model', parts: [{ text: JSON.stringify(output) }] },
    }],
    usageMetadata: {
      promptTokenCount: 80,
      candidatesTokenCount: 30,
      thoughtsTokenCount: 5,
    },
  }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-request-id': 'gemini_email_request_test' },
  })
}

describe('Gemini GenerateContent email AI adapter', () => {
  it('secretı yalnız headerda tutar ve minimal structured-output payload kullanır', async () => {
    let endpoint = ''
    let sent: Record<string, unknown> | undefined
    let headers = new Headers()
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      endpoint = String(input)
      headers = new Headers(init?.headers)
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>
      return successResponse()
    })
    const provider = createGeminiEmailAiProvider(config, fetchMock)
    const result = await provider.execute(request, new AbortController().signal)
    expect(endpoint).toBe(
      `${DEFAULT_GEMINI_API_ORIGIN}/v1beta/models/${GEMINI_FREE_TIER_FALLBACK_MODEL_ID}:generateContent`,
    )
    expect(headers.get('x-goog-api-key')).toBe(config.apiKey)
    expect(headers.has('authorization')).toBe(false)
    expect(headers.get('x-client-request-id')).toBe(request.providerRequestId)
    expect(sent).toMatchObject({
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: {
          type: 'object',
          required: [
            'schemaVersion',
            'subjectSuffix',
            'body',
            'reasoning',
            'warnings',
            'confidence',
            'requiresHumanReview',
          ],
        },
      },
    })
    expect(JSON.stringify(sent)).not.toContain(config.apiKey)
    expect(sent).not.toHaveProperty('tools')
    expect(sent).not.toHaveProperty('cachedContent')
    const contents = sent?.contents as Array<{ parts: Array<{ text: string }> }>
    const outboundContext = JSON.parse(contents[0]!.parts[0]!.text) as {
      context: Record<string, unknown>
    }
    expect(outboundContext.context).not.toHaveProperty('recipient')
    expect(outboundContext.context).not.toHaveProperty('toAddress')
    expect(outboundContext.context).not.toHaveProperty('ccAddress')
    expect(JSON.stringify((sent?.generationConfig as Record<string, unknown>).responseJsonSchema))
      .not.toMatch(/enum|minimum|maximum|minItems|maxItems|anyOf|additionalProperties/)
    expect(result.output).toEqual(output)
    expect(result.usage).toMatchObject({
      inputCharacters: 180,
      inputTokens: 80,
      outputTokens: 35,
      estimatedCostMinor: 0,
      actualCostMinor: 0,
    })
  })

  it('503 için sınırlı backoff uygular ve sonra güvenli unavailable üretir', async () => {
    let calls = 0
    const waits: number[] = []
    const provider = createGeminiEmailAiProvider(config, async () => {
      calls += 1
      return new Response(null, { status: 503, headers: { 'x-request-id': `email-${calls}` } })
    }, async (milliseconds) => { waits.push(milliseconds) })
    await expect(provider.execute(request, new AbortController().signal)).rejects.toMatchObject({
      message: 'provider_unavailable',
      requestOutcome: 'response_received',
      providerRequestId: 'email-3',
    })
    expect(calls).toBe(3)
    expect(waits).toEqual([...GEMINI_UNAVAILABLE_BACKOFF_MS])
  })

  it('network sonucu bilinmiyorsa unknown, 4xx ise response-received ayrımı yapar', async () => {
    const network = createGeminiEmailAiProvider(config, async () => {
      throw new TypeError('sentetik socket secret')
    })
    await expect(network.execute(request, new AbortController().signal)).rejects.toMatchObject({
      message: 'provider_network_failure',
      requestOutcome: 'unknown',
    })
    const rejected = createGeminiEmailAiProvider(config, async () => new Response(JSON.stringify({
      error: {
        status: 'INVALID_ARGUMENT',
        message: 'raw secret',
        details: [{ fieldViolations: [{ field: 'generation_config.response_json_schema' }] }],
      },
    }), { status: 400 }))
    const error = await rejected.execute(request, new AbortController().signal).catch((value) => value)
    expect(error).toMatchObject({
      message: 'provider_request_rejected',
      requestOutcome: 'response_received',
    })
    expect(JSON.stringify(error)).not.toContain('raw secret')
  })
})
