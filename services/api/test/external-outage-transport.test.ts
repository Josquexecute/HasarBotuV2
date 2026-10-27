import { once } from 'node:events'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGeminiPolicyProvider, GEMINI_FREE_TIER_MODEL_ID } from '../src/policy-ai/gemini-provider.js'
import { createGeminiEmailAiProvider } from '../src/email-ai/gemini-provider.js'
import { createOpenAiPolicyProvider } from '../src/policy-ai/openai-provider.js'
import { createGoogleProvider } from '../src/tracking/google.js'

const config = { apiKey: 'synthetic-key', modelId: GEMINI_FREE_TIER_MODEL_ID,
  maximumInputCharacters: 50_000, maximumOutputSize: 10_000, maximumOutputTokens: 1_000 }
const policyRequest = { accountingInputCharacters: 10, providerRequestId: 'a'.repeat(64),
  systemContract: { promptTemplateVersion: 'policy-ai-extraction/1.0.0', instruction: 'Extract source fields.' },
  outputContract: { schemaVersion: 'policy-ai-candidates/1.0.0', maximumCandidates: 10 },
  sourceBundle: { sourceBundleHash: 'b'.repeat(64), sources: [] } }
const emailRequest = { accountingInputCharacters: 10, providerRequestId: 'a'.repeat(64),
  context: { caseType: 'traffic' as const, draftType: 'missing_document_request', sourceRule: 'missing_document_request',
    baseBody: 'Merhaba.', instruction: null, missingRequirementCodes: [], controlRequiredRequirementCodes: [] } }
const factories = [
  { name: 'Gemini policy', execute: (fetcher: typeof fetch, signal: AbortSignal) => createGeminiPolicyProvider(config, fetcher, async () => undefined).execute(policyRequest, signal) },
  { name: 'Gemini email', execute: (fetcher: typeof fetch, signal: AbortSignal) => createGeminiEmailAiProvider(config, fetcher, async () => undefined).execute(emailRequest, signal) },
  { name: 'OpenAI policy', execute: (fetcher: typeof fetch, signal: AbortSignal) => createOpenAiPolicyProvider({ ...config, inputCostMinorPerMillionTokens: 1, outputCostMinorPerMillionTokens: 1 }, fetcher).execute(policyRequest, signal) },
]
const servers: Server[] = []
async function listen(handler: (response: ServerResponse, attempt: number) => void) {
  let attempts = 0
  const server = createServer((_request, response) => { attempts++; handler(response, attempts) })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return { origin: `http://127.0.0.1:${(server.address() as { port: number }).port}`, attempts: () => attempts }
}
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})

describe.each(factories)('$name outage transport', ({ name, execute }) => {
  it('releases a response reader after a real truncated HTTP body without redispatch', async () => {
    const server = await listen(response => {
      response.writeHead(200, { 'content-type': 'application/json', 'content-length': '5000' })
      response.write('{"private":"synthetic-upstream-body"')
      setImmediate(() => response.destroy())
    })
    let received: Response | undefined
    const fetcher: typeof fetch = async (_input, init) => { received = await fetch(server.origin, init); return received }
    await expect(execute(fetcher, new AbortController().signal)).rejects.toMatchObject({
      message: 'provider_network_failure', requestOutcome: 'response_received',
    })
    expect(server.attempts()).toBe(1)
    expect(received?.body?.locked).toBe(false)
  })

  it.each([
    { kind: 'malformed', body: '{invalid', code: 'provider_response_invalid' },
    { kind: 'oversized', body: 'x'.repeat(config.maximumOutputSize * 4 + 1), code: 'provider_response_too_large' },
  ])('releases its reader after a $kind HTTP body', async ({ body, code }) => {
    const response = new Response(body)
    await expect(execute(async () => response, new AbortController().signal)).rejects.toMatchObject({ message: code })
    expect(response.body?.locked).toBe(false)
  })

  it('releases its reader after a complete valid response and preserves output', async () => {
    const output = name === 'Gemini email'
      ? { schemaVersion: 'email-ai-suggestion/1.0.0', subjectSuffix: 'Evrak', body: 'Merhaba.', reasoning: 'Kısa bilgi.', warnings: [], confidence: 0.8, requiresHumanReview: true }
      : { schemaVersion: 'policy-ai-candidates/1.0.0', candidates: [] }
    const response = new Response(JSON.stringify(name === 'OpenAI policy'
      ? { status: 'completed', output_text: JSON.stringify(output), usage: { input_tokens: 1, output_tokens: 1 } }
      : { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(output) }] } }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } }))
    await expect(execute(async () => response, new AbortController().signal)).resolves.toMatchObject({ output })
    expect(response.body?.locked).toBe(false)
  })
})

it.each(['policy', 'email'])('cancels %s backoff before another dispatch and closes the 503 body', async name => {
  const controller = new AbortController()
  let cancelled = false
  const response = new Response(new ReadableStream({ cancel() { cancelled = true } }), { status: 503 })
  const fetcher = vi.fn(async () => { queueMicrotask(() => controller.abort()); return response })
  const provider = name === 'policy' ? createGeminiPolicyProvider(config, fetcher) : createGeminiEmailAiProvider(config, fetcher)
  const result = name === 'policy'
    ? (provider as ReturnType<typeof createGeminiPolicyProvider>).execute(policyRequest, controller.signal)
    : (provider as ReturnType<typeof createGeminiEmailAiProvider>).execute(emailRequest, controller.signal)
  await expect(result).rejects.toMatchObject({ message: 'provider_timeout', requestOutcome: 'response_received' })
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(cancelled).toBe(true)
  expect(response.body?.locked).toBe(false)
})

it('recovers Gmail read transport after a real HTTP outage without automatic refresh replay', async () => {
  const server = await listen((response, attempt) => {
    response.writeHead(attempt === 1 ? 503 : 200, { 'content-type': 'application/json' })
    response.end(attempt === 1 ? '{"error":"synthetic-private-body"}' : '{"messages":[{"id":"recovered"}]}')
  })
  const provider = createGoogleProvider({ clientId: 'synthetic-client', clientSecret: 'synthetic-secret',
    redirectUri: 'https://example.test/callback', encryptionKey: 'ab'.repeat(32), sbmSenders: [], automaticSbmEnabled: false, loginDomain: 'office.example' },
  (_input, init) => fetch(server.origin, init))
  await expect(provider.gmail('synthetic-token', 'messages')).rejects.toMatchObject({ kind: 'temporary', status: 503 })
  expect(server.attempts()).toBe(1)
  await expect(provider.gmail('synthetic-token', 'messages')).resolves.toEqual({ messages: [{ id: 'recovered' }] })
  expect(server.attempts()).toBe(2)
})
