import { describe, expect, it, vi } from 'vitest'
import { createOpenAiPolicyProvider } from '../src/index.js'

const config = {
  apiKey: 'sk-test-only-not-a-real-secret-0001',
  modelId: 'gpt-5-mini-test-pinned',
  inputCostMinorPerMillionTokens: 25,
  outputCostMinorPerMillionTokens: 200,
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

describe('OpenAI Responses policy provider adapter', () => {
  it('store false, strict schema, arac kapali ve token usage ile calisir', async () => {
    let sent: Record<string, unknown> | undefined
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(new Headers(init?.headers).get('x-client-request-id')).toBe('a'.repeat(64))
      const output = { schemaVersion: 'policy-ai-candidates/1.0.0', candidates: [{ candidateId: 'd-10', category: 'deductible', canonicalField: 'deductible.conditional', normalizedValue: 10, originalValue: '%10', conditions: [], exceptions: [], sourceAnchorIds: ['c'.repeat(64)], providerConfidence: 0.9 }] }
      return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(output) }] }], usage: { input_tokens: 80, output_tokens: 40 } }), { status: 200 })
    })
    const provider = createOpenAiPolicyProvider(config, fetchMock)
    const result = await provider.execute(request, new AbortController().signal)
    expect(sent).toMatchObject({ model: config.modelId, store: false, tools: [], text: { format: { type: 'json_schema', strict: true } } })
    expect(JSON.stringify(sent)).not.toContain('sourceBundleHash')
    expect(result.output).toMatchObject({ schemaVersion: 'policy-ai-candidates/1.0.0' })
    expect(result.usage).toMatchObject({ inputCharacters: 64, inputTokens: 80, outputTokens: 40, actualCostMinor: 1 })
  })

  it('provider hata govdesini sizdirmadan kanonik hata uretir', async () => {
    const provider = createOpenAiPolicyProvider(config, async () => new Response(JSON.stringify({ error: { message: 'raw-secret-provider-error' } }), { status: 401 }))
    let caught: unknown
    try { await provider.execute(request, new AbortController().signal) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toBe('provider_authentication_failed')
    expect((caught as Error).message).not.toContain('raw-secret-provider-error')
  })
})
