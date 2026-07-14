import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AGENTS_ROUTE,
  AGENT_CLAIM_ROUTE,
  AGENT_DETAIL_ROUTE,
  AGENT_JOB_HEARTBEAT_ROUTE,
  AGENT_JOB_RESULT_ROUTE,
  AGENT_JOB_EXTRACTION_CHUNKS_ROUTE,
  agentParamsSchema,
  agentRegisterRequestSchema,
  agentRegisterResponseSchema,
  agentResponseSchema,
  agentUpdateRequestSchema,
  agentsListResponseSchema,
  claimResponseSchema,
  failureEnvelopeSchema,
  heartbeatResponseSchema,
  jobHeartbeatRequestSchema,
  jobParamsSchema,
  jobResultRequestSchema,
  jobResultResponseSchema,
  pdfExtractionChunkRequestSchema,
  pdfExtractionChunkResponseSchema,
  zodErrorToApiError,
} from '@hasarbotu/contracts'
import { failureBody } from '../errors/failure.js'
import { requireSession, sendForbidden } from '../auth/guard.js'
import { createAuthStore } from '../auth/store.js'
import { createAgentStore } from './store.js'
import { requireAgent } from './auth.js'
import { acceptPdfExtractionChunk, TextExtractionStoreError } from '../text-extractions/store.js'

export interface AgentRoutesOptions {
  readonly pool: pg.Pool
}

const AGENT_ADMIN_ROLES = new Set(['admin'])

/**
 * File Agent uçları (Paket 14). İş uçları AGENT kimliğiyle (x-agent-id/secret);
 * yönetim uçları kullanıcı oturumu + yönetici rolüyle korunur. Agent yalnız
 * kendi organizasyonu ve atanmış işiyle sınırlıdır; mutlak yol/secret/ham hata
 * yanıta taşınmaz.
 */
export function registerAgentRoutes(app: FastifyInstance, options: AgentRoutesOptions): void {
  const authStore = createAuthStore(options.pool)
  const agentStore = createAgentStore(options.pool)

  // ---- Agent iş uçları (agent kimliği) ----
  app.post(AGENT_CLAIM_ROUTE, async (request, reply) => {
    const agent = await requireAgent(agentStore, request, reply)
    if (agent === undefined) return
    const job = await agentStore.claimJob(agent)
    return claimResponseSchema.parse({ job })
  })

  app.post(AGENT_JOB_HEARTBEAT_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const agent = await requireAgent(agentStore, request, reply)
    if (agent === undefined) return
    const params = jobParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(params.error, requestId) }))
    }
    const body = jobHeartbeatRequestSchema.safeParse(request.body ?? {})
    if (!body.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(body.error, requestId) }))
    }
    const leaseExpiresAt = await agentStore.heartbeat(agent, params.data.jobId, body.data.phase, requestId)
    if (leaseExpiresAt === undefined) {
      return reply.code(409).send(failureBody('conflict', 'Job lease is not held or has expired.', requestId))
    }
    return heartbeatResponseSchema.parse({ jobId: params.data.jobId, leaseExpiresAt: leaseExpiresAt.toISOString() })
  })

  app.post(AGENT_JOB_RESULT_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const agent = await requireAgent(agentStore, request, reply)
    if (agent === undefined) return
    const params = jobParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(params.error, requestId) }))
    }
    const parsed = jobResultRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(parsed.error, requestId) }))
    }
    const outcome = await agentStore.reportResult(agent, params.data.jobId, parsed.data, requestId)
    if (outcome.kind === 'not_found') return reply.code(404).send(failureBody('not_found', 'Job not found.', requestId))
    if (outcome.kind === 'not_leaseholder') return reply.code(403).send(failureBody('forbidden', 'Job is leased by another agent.', requestId))
    if (outcome.kind === 'conflict') return reply.code(409).send(failureBody('conflict', 'Job lease is not held or has expired.', requestId))
    return jobResultResponseSchema.parse({ jobId: params.data.jobId, status: outcome.status, lastErrorCode: outcome.lastErrorCode })
  })

  app.post(AGENT_JOB_EXTRACTION_CHUNKS_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const agent = await requireAgent(agentStore, request, reply)
    if (agent === undefined) return
    const params = jobParamsSchema.safeParse(request.params)
    const body = pdfExtractionChunkRequestSchema.safeParse(request.body)
    if (!params.success || !body.success) {
      const zod = (!params.success ? params.error : !body.success ? body.error : undefined)!
      return reply.code(400).send(failureEnvelopeSchema.parse({ ok:false, error:zodErrorToApiError(zod, requestId) }))
    }
    try {
      const accepted = await acceptPdfExtractionChunk(options.pool, agent, params.data.jobId, body.data)
      return pdfExtractionChunkResponseSchema.parse({ jobId:params.data.jobId, extractionId:body.data.extractionId, sequence:body.data.sequence, acceptedPageCount:accepted.acceptedPageCount })
    } catch (error) {
      if (error instanceof TextExtractionStoreError) {
        if (error.code === 'not_found') return reply.code(404).send(failureBody('not_found', 'Job not found.', requestId))
        if (error.code === 'lease_conflict') return reply.code(409).send(failureBody('conflict', 'Job lease is not held or has expired.', requestId))
        return reply.code(409).send(failureBody('pdf_extraction_stale', 'Extraction chunk was rejected.', requestId))
      }
      throw error
    }
  })

  // ---- Agent yönetimi (kullanıcı oturumu + yönetici) ----
  async function requireAdmin(request: Parameters<typeof requireSession>[1], reply: Parameters<typeof requireSession>[2]) {
    const session = await requireSession(authStore, request, reply)
    if (session === undefined) return undefined
    if (!session.user.roles.some((role) => AGENT_ADMIN_ROLES.has(role))) {
      sendForbidden(reply, String(request.id))
      return undefined
    }
    return session
  }

  app.post(AGENTS_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAdmin(request, reply)
    if (session === undefined) return
    const parsed = agentRegisterRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(parsed.error, requestId) }))
    }
    const created = await agentStore.registerAgent(session.user.organizationId, parsed.data.name)
    return reply.code(201).send(agentRegisterResponseSchema.parse(created))
  })

  app.get(AGENTS_ROUTE, async (request, reply) => {
    const session = await requireAdmin(request, reply)
    if (session === undefined) return
    const items = await agentStore.listAgents(session.user.organizationId)
    return agentsListResponseSchema.parse({ items })
  })

  app.patch(AGENT_DETAIL_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireAdmin(request, reply)
    if (session === undefined) return
    const params = agentParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(params.error, requestId) }))
    }
    const parsed = agentUpdateRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({ ok: false, error: zodErrorToApiError(parsed.error, requestId) }))
    }
    const agent = await agentStore.setAgentStatus(session.user.organizationId, params.data.agentId, parsed.data.status)
    if (agent === undefined) return reply.code(404).send(failureBody('not_found', 'Agent not found.', requestId))
    return agentResponseSchema.parse({ agent })
  })
}
