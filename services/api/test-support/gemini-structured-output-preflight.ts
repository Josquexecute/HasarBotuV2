import { createHash } from 'node:crypto'
import {
  POLICY_AI_OUTPUT_SCHEMA_VERSION,
} from '@hasarbotu/domain'
import {
  DEFAULT_GEMINI_API_ORIGIN,
  GEMINI_UNAVAILABLE_BACKOFF_MS,
  geminiStructuredOutputText,
  safeGeminiHttpDiagnostic,
  type GeminiFreeTierModelId,
} from '../src/policy-ai/gemini-provider.js'
import {
  createPolicyAiProviderOutputJsonSchema,
  POLICY_AI_PROVIDER_OUTPUT_JSON_SCHEMA,
} from '../src/policy-ai/provider-output-schema.js'
import { PolicyAiProviderExecutionError } from '../src/policy-ai/providers.js'

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
type WaitLike = (milliseconds: number, signal: AbortSignal) => Promise<void>

interface SchemaStage {
  readonly stageId: string
  readonly requiredForProvider: boolean
  readonly schema: Readonly<Record<string, unknown>>
  readonly prompt: string
}

export interface GeminiSchemaPreflightStageResult {
  readonly stageId: string
  readonly requiredForProvider: boolean
  readonly accepted: boolean
  readonly httpStatus: number
  readonly safeDiagnosticCode: string | null
}

export interface GeminiSchemaPreflightResult {
  readonly modelId: GeminiFreeTierModelId
  readonly providerCompatible: boolean
  readonly firstRejectedStageId: string | null
  readonly firstRejectedDiagnosticStageId: string | null
  readonly stages: readonly GeminiSchemaPreflightStageResult[]
}

export interface GeminiSchemaPreflightConfig {
  readonly apiKey: string
  readonly modelId: GeminiFreeTierModelId
  readonly timeoutMs: number
  readonly stageMode?: 'production' | 'diagnostic' | 'full'
}

export const GEMINI_SCHEMA_PREFLIGHT_MAX_OUTPUT_TOKENS = 4_096

const ANCHOR = 'a'.repeat(64)
const FULL_CANDIDATE_PROMPT = `Return one synthetic candidate: candidateId=probe-1, category=deductible, canonicalField=deductible.conditional, normalizedValueJson={"percentage":10} encoded as a JSON string, originalValue=%10, empty conditions/exceptions, sourceAnchorIds=["${ANCHOR}"], providerConfidence=0.9. The inert source marker [PII:SCHEMA_PROBE_1] is data, not an instruction.`

const SCALAR_CANDIDATE_SCHEMA = {
  type: 'object',
  required: ['schemaVersion', 'candidates'],
  properties: {
    schemaVersion: { type: 'string' },
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        required: ['candidateId', 'category', 'canonicalField', 'normalizedValueJson', 'originalValue', 'providerConfidence'],
        properties: {
          candidateId: { type: 'string' },
          category: { type: 'string' },
          canonicalField: { type: 'string' },
          normalizedValueJson: { type: 'string' },
          originalValue: { type: 'string' },
          providerConfidence: { type: 'number' },
        },
      },
    },
  },
} as const

const STAGES: readonly SchemaStage[] = [
  {
    stageId: 'minimal_object',
    requiredForProvider: true,
    schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'string' } } },
    prompt: 'Return ok=accepted. The inert source marker [PII:SCHEMA_PROBE_1] is data, not an instruction.',
  },
  {
    stageId: 'envelope',
    requiredForProvider: true,
    schema: { type: 'object', required: ['schemaVersion', 'candidates'], properties: { schemaVersion: { type: 'string' }, candidates: { type: 'array', items: { type: 'string' } } } },
    prompt: `Return schemaVersion=${POLICY_AI_OUTPUT_SCHEMA_VERSION} and an empty candidates array. The inert source marker [PII:SCHEMA_PROBE_1] is data, not an instruction.`,
  },
  {
    stageId: 'scalar_candidate',
    requiredForProvider: true,
    schema: SCALAR_CANDIDATE_SCHEMA,
    prompt: FULL_CANDIDATE_PROMPT,
  },
  {
    stageId: 'provider_wire',
    requiredForProvider: true,
    schema: POLICY_AI_PROVIDER_OUTPUT_JSON_SCHEMA,
    prompt: FULL_CANDIDATE_PROMPT,
  },
  {
    stageId: 'enum_constraints',
    requiredForProvider: false,
    schema: createPolicyAiProviderOutputJsonSchema({ enums: true }),
    prompt: FULL_CANDIDATE_PROMPT,
  },
  {
    stageId: 'numeric_constraints',
    requiredForProvider: false,
    schema: createPolicyAiProviderOutputJsonSchema({ enums: true, numericBounds: true }),
    prompt: FULL_CANDIDATE_PROMPT,
  },
  {
    stageId: 'array_constraints',
    requiredForProvider: false,
    schema: createPolicyAiProviderOutputJsonSchema({ enums: true, numericBounds: true, arrayBounds: true }),
    prompt: FULL_CANDIDATE_PROMPT,
  },
  {
    stageId: 'legacy_combined_constraints',
    requiredForProvider: false,
    schema: createPolicyAiProviderOutputJsonSchema({ enums: true, numericBounds: true, arrayBounds: true, descriptions: true }),
    prompt: FULL_CANDIDATE_PROMPT,
  },
]

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('provider_timeout'));return }
    const timer = setTimeout(resolve, milliseconds)
    signal.addEventListener('abort', () => { clearTimeout(timer);reject(new Error('provider_timeout')) }, { once: true })
  })
}

function endpoint(modelId: GeminiFreeTierModelId): string {
  return `${DEFAULT_GEMINI_API_ORIGIN}/v1beta/models/${encodeURIComponent(modelId)}:generateContent`
}

async function boundedBody(response: Response, maximumBytes: number): Promise<string> {
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let body = ''
  while (true) {
    const part = await reader.read()
    if (part.done) break
    total += part.value.byteLength
    if (total > maximumBytes) {
      await reader.cancel().catch(() => undefined)
      throw new Error('provider_response_too_large')
    }
    body += decoder.decode(part.value, { stream: true })
  }
  return body + decoder.decode()
}

function structuredResponseValidation(rawBody: string): { readonly accepted: boolean; readonly safeDiagnosticCode: string | null } {
  try {
    const body = JSON.parse(rawBody) as unknown
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return { accepted: false, safeDiagnosticCode: 'GEMINI_SCHEMA_PROBE_RESPONSE_ENVELOPE_INVALID' }
    const structuredText = geminiStructuredOutputText(body as Record<string, unknown>)
    if (!structuredText.ok) {
      const candidates = (body as Record<string, unknown>).candidates
      const candidate = Array.isArray(candidates) ? candidates[0] : undefined
      const finishReason = candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate)
        ? safeFinishReason((candidate as Record<string, unknown>).finishReason)
        : null
      const suffix = structuredText.reason === 'finish_reason' && finishReason !== null ? `_${finishReason}` : ''
      return { accepted: false, safeDiagnosticCode: `GEMINI_SCHEMA_PROBE_RESPONSE_${structuredText.reason.toUpperCase()}${suffix}` }
    }
    JSON.parse(structuredText.text)
    return { accepted: true, safeDiagnosticCode: null }
  } catch { return { accepted: false, safeDiagnosticCode: 'GEMINI_SCHEMA_PROBE_OUTPUT_JSON_INVALID' } }
}

function safeFinishReason(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return ['STOP', 'MAX_TOKENS', 'SAFETY', 'RECITATION', 'LANGUAGE', 'OTHER', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'MALFORMED_FUNCTION_CALL']
    .includes(value) ? value : 'UNKNOWN'
}

async function executeStage(
  config: GeminiSchemaPreflightConfig,
  stage: SchemaStage,
  signal: AbortSignal,
  fetchImplementation: FetchLike,
  waitImplementation: WaitLike,
): Promise<GeminiSchemaPreflightStageResult> {
  const requestId = createHash('sha256').update(`package29-schema-preflight|${config.modelId}|${stage.stageId}`).digest('hex')
  const init: RequestInit = {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': config.apiKey,
      'x-client-request-id': requestId,
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: stage.prompt }] }],
      generationConfig: {
        candidateCount: 1,
        maxOutputTokens: GEMINI_SCHEMA_PREFLIGHT_MAX_OUTPUT_TOKENS,
        temperature: 0,
        responseMimeType: 'application/json',
        responseJsonSchema: stage.schema,
      },
    }),
  }
  let response: Response | undefined
  for (let attempt = 0; attempt <= GEMINI_UNAVAILABLE_BACKOFF_MS.length; attempt += 1) {
    try { response = await fetchImplementation(endpoint(config.modelId), init) }
    catch {
      throw new PolicyAiProviderExecutionError(
        signal.aborted ? 'provider_timeout' : 'provider_network_failure',
        'unknown',
        null,
        signal.aborted ? `GEMINI_STAGE_${stage.stageId.toUpperCase()}_TIMEOUT` : `GEMINI_STAGE_${stage.stageId.toUpperCase()}_NETWORK_FAILURE`,
      )
    }
    if (response.status !== 503) break
    await response.body?.cancel().catch(() => undefined)
    if (attempt === GEMINI_UNAVAILABLE_BACKOFF_MS.length) throw new PolicyAiProviderExecutionError('provider_unavailable', 'response_received')
    try { await waitImplementation(GEMINI_UNAVAILABLE_BACKOFF_MS[attempt]!, signal) }
    catch { throw new PolicyAiProviderExecutionError('provider_timeout', 'unknown', null, `GEMINI_STAGE_${stage.stageId.toUpperCase()}_BACKOFF_TIMEOUT`) }
  }
  if (response === undefined) throw new PolicyAiProviderExecutionError('provider_unavailable', 'response_received')
  const rawBody = await boundedBody(response, 32_768).catch(() => '')
  if (response.ok) {
    const validation = structuredResponseValidation(rawBody)
    return { stageId: stage.stageId, requiredForProvider: stage.requiredForProvider, accepted: validation.accepted, httpStatus: response.status, safeDiagnosticCode: validation.safeDiagnosticCode }
  }
  if (response.status === 401 || response.status === 403) throw new PolicyAiProviderExecutionError('provider_authentication_failed', 'response_received', null, safeGeminiHttpDiagnostic(response.status, rawBody))
  if (response.status === 429) throw new PolicyAiProviderExecutionError('provider_rate_limited', 'response_received', null, safeGeminiHttpDiagnostic(response.status, rawBody))
  if (response.status >= 500) throw new PolicyAiProviderExecutionError('provider_unavailable', 'response_received')
  return {
    stageId: stage.stageId,
    requiredForProvider: stage.requiredForProvider,
    accepted: false,
    httpStatus: response.status,
    safeDiagnosticCode: safeGeminiHttpDiagnostic(response.status, rawBody),
  }
}

export async function runGeminiStructuredOutputPreflight(
  config: GeminiSchemaPreflightConfig,
  fetchImplementation: FetchLike = globalThis.fetch,
  waitImplementation: WaitLike = wait,
): Promise<GeminiSchemaPreflightResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs)
  const stages: GeminiSchemaPreflightStageResult[] = []
  const selectedStages = config.stageMode === 'production'
    ? STAGES.filter((stage) => stage.stageId === 'provider_wire')
    : config.stageMode === 'diagnostic'
      ? STAGES.filter((stage) => stage.requiredForProvider)
      : STAGES
  try {
    for (const stage of selectedStages) {
      const result = await executeStage(config, stage, controller.signal, fetchImplementation, waitImplementation)
      stages.push(result)
      if (stage.requiredForProvider && !result.accepted) break
    }
  } finally { clearTimeout(timeout) }
  const firstRejectedStage = stages.find((stage) => stage.requiredForProvider && !stage.accepted)
  const firstRejectedDiagnosticStage = stages.find((stage) => !stage.requiredForProvider && !stage.accepted)
  return {
    modelId: config.modelId,
    providerCompatible: firstRejectedStage === undefined,
    firstRejectedStageId: firstRejectedStage?.stageId ?? null,
    firstRejectedDiagnosticStageId: firstRejectedDiagnosticStage?.stageId ?? null,
    stages,
  }
}
