import { createHash, randomBytes } from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { AGENT_ID_HEADER, AGENT_SECRET_HEADER } from '@hasarbotu/contracts'
import { failureBody } from '../errors/failure.js'
import type { AgentStore } from './store.js'

/**
 * Agent kimliği kullanıcı oturumundan AYRIDIR. Ham secret 256-bit rastgeledir,
 * base64url; DB'de yalnız SHA-256 hash'i tutulur (session token modeliyle aynı).
 * Ham secret DB/audit/log'a yazılmaz.
 */
export function generateAgentSecret(): string {
  return randomBytes(32).toString('base64url')
}

export function hashAgentSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

export interface AuthedAgent {
  readonly id: string
  readonly organizationId: string
}

function firstHeader(value: unknown): string | undefined {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined
  return typeof value === 'string' ? value : undefined
}

/**
 * Agent kimlik doğrulaması: `x-agent-id` + `x-agent-secret` başlıkları. Geçersiz
 * kimlik → tekdüze 401; devre dışı agent → 403. Başarıda son görülme zamanı
 * güncellenir ve agent yalnız KENDİ organizasyonuyla sınırlı döner.
 */
export async function requireAgent(
  store: AgentStore,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthedAgent | undefined> {
  const requestId = String(request.id)
  const agentId = firstHeader(request.headers[AGENT_ID_HEADER])
  const secret = firstHeader(request.headers[AGENT_SECRET_HEADER])
  if (agentId === undefined || secret === undefined || agentId.length === 0 || secret.length === 0) {
    void reply.code(401).send(failureBody('unauthorized', 'Agent authentication required.', requestId))
    return undefined
  }

  const agent = await store.findAgentForAuth(agentId, hashAgentSecret(secret))
  if (agent === undefined) {
    void reply.code(401).send(failureBody('unauthorized', 'Agent authentication required.', requestId))
    return undefined
  }
  if (agent.status !== 'active') {
    void reply.code(403).send(failureBody('forbidden', 'Agent is disabled.', requestId))
    return undefined
  }
  await store.touchLastSeen(agent.id)
  return { id: agent.id, organizationId: agent.organizationId }
}
