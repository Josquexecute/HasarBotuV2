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
  { name: 'Gemini policy', execute: (origin: string) => createGeminiPolicyProvider({ ...config, apiOrigin: origin }).execute(policyRequest, AbortSignal.timeout(2000)) },
  { name: 'OpenAI policy', execute: (origin: string) => createOpenAiPolicyProvider({ ...config, endpoint: origin,
    inputCostMinorPerMillionTokens: 1, outputCostMinorPerMillionTokens: 1 }).execute(policyRequest, AbortSignal.timeout(2000)) },
  { name: 'Gemini email', execute: (origin: string) => createGeminiEmailAiProvider({ ...config, apiOrigin: origin }).execute(emailRequest, AbortSignal.timeout(2000)) },
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
