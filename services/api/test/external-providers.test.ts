import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import { createGeminiPolicyProvider, GEMINI_FREE_TIER_MODEL_ID } from '../src/policy-ai/gemini-provider.js'
import { createOpenAiPolicyProvider } from '../src/policy-ai/openai-provider.js'
import { createGeminiEmailAiProvider } from '../src/email-ai/gemini-provider.js'

const config = { apiKey: 'synthetic-provider-secret', modelId: GEMINI_FREE_TIER_MODEL_ID,
  maximumInputCharacters: 50_000, maximumOutputSize: 100_000, maximumOutputTokens: 2048 }
const policyRequest = {
  accountingInputCharacters: 64, providerRequestId: 'a'.repeat(64),
  systemContract: { promptTemplateVersion: 'policy-ai-extraction/1.0.0', instruction: 'Extract source-grounded facts.' },
  outputContract: { schemaVersion: 'policy-ai-candidates/1.0.0', maximumCandidates: 10 },
  sourceBundle: { sourceBundleHash: 'b'.repeat(64), sources: [{ sourceAnchorId: 'c'.repeat(64), text: 'Synthetic policy evidence', sourceQuality: 'high' as const, warnings: [] }] },
}
const emailRequest = { accountingInputCharacters: 64, providerRequestId: 'a'.repeat(64), context: {
  caseType: 'traffic' as const, draftType: 'missing_document_request', sourceRule: 'missing_document_request',
  baseBody: 'Synthetic email context', instruction: null, missingRequirementCodes: [], controlRequiredRequirementCodes: [],
} }
const providers = [
  { name: 'Gemini policy', execute: (origin: string, signal = AbortSignal.timeout(2000)) => createGeminiPolicyProvider({ ...config, apiOrigin: origin }).execute(policyRequest, signal) },
  { name: 'OpenAI policy', execute: (origin: string, signal = AbortSignal.timeout(2000)) => createOpenAiPolicyProvider({ ...config, endpoint: origin,
    inputCostMinorPerMillionTokens: 1, outputCostMinorPerMillionTokens: 1 }).execute(policyRequest, signal) },
  { name: 'Gemini email', execute: (origin: string, signal = AbortSignal.timeout(2000)) => createGeminiEmailAiProvider({ ...config, apiOrigin: origin }).execute(emailRequest, signal) },
]
const servers: Server[] = []
async function listen(server: Server) {
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`
}
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})

it.each(providers)('$name rejects redirects without forwarding credentials or claim evidence', async ({ execute }) => {
  const received = vi.fn()
  const target = await listen(createServer((request, response) => {
    received(request.url)
    response.setHeader('content-type', 'application/json')
    response.end('{}')
  }))
  const origin = await listen(createServer((_request, response) => {
    response.writeHead(307, { location: `${target}/capture` })
    response.end()
  }))
  await expect(execute(origin)).rejects.toThrow()
  expect(received).not.toHaveBeenCalled()
})

it.each(providers)('$name distinguishes a timeout before receiving headers', async ({ execute }) => {
  let started!: () => void
  const requestStarted = new Promise<void>(resolve => { started = resolve })
  const origin = await listen(createServer(() => started()))
  const controller = new AbortController()
  const result = execute(origin, controller.signal).catch(error => error)
  await requestStarted
  controller.abort()
  expect(await result).toMatchObject({ message: 'provider_timeout', requestOutcome: 'unknown' })
})

it.each(providers)('$name distinguishes a timeout while reading the response body', async ({ execute }) => {
  const controller = new AbortController()
  const origin = await listen(createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json', 'x-request-id': 'synthetic-response' })
    response.write('{"output":')
    const timer = setTimeout(() => controller.abort(), 100)
    response.once('close', () => clearTimeout(timer))
  }))
  await expect(execute(origin, controller.signal)).rejects.toMatchObject({
    message: 'provider_timeout', requestOutcome: 'response_received', providerRequestId: 'synthetic-response',
  })
})

it.each(providers)('$name keeps a truncated network response distinct from invalid JSON', async ({ execute }) => {
  const origin = await listen(createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json', 'content-length': '10000', connection: 'close', 'x-request-id': 'synthetic-response' })
    response.write('{"output":')
    response.end()
  }))
  await expect(execute(origin)).rejects.toMatchObject({
    message: 'provider_network_failure', requestOutcome: 'response_received', providerRequestId: 'synthetic-response',
  })
})

it.each(providers)('$name rejects rate limiting once without leaking the error body', async ({ execute }) => {
  const received = vi.fn()
  const origin = await listen(createServer((_request, response) => {
    received()
    response.writeHead(429, { 'content-type': 'application/json', 'retry-after': '60' })
    response.end('{"error":{"message":"synthetic-private-upstream-body"}}')
  }))
  const error: unknown = await execute(origin).catch(value => value)
  expect(error).toMatchObject({ message: 'provider_rate_limited', requestOutcome: 'response_received' })
  expect(String(error)).not.toContain('synthetic-private-upstream-body')
  expect(received).toHaveBeenCalledTimes(1)
})

it.each(providers)('$name preserves invalid JSON and response size errors', async ({ execute }) => {
  for (const [body, code] of [['{invalid', 'provider_response_invalid'], ['x'.repeat(config.maximumOutputSize * 4 + 1), 'provider_response_too_large']]) {
    const origin = await listen(createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(body)
    }))
    await expect(execute(origin)).rejects.toMatchObject({ message: code, requestOutcome: 'response_received' })
  }
})
