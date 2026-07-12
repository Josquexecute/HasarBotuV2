import type { FastifyReply, FastifyRequest } from 'fastify'
import { failureEnvelopeSchema, type FailureEnvelope } from '@hasarbotu/contracts'

/**
 * Bilinmeyen route ve eslesmeyen method icin guvenli 404 yaniti.
 * Contracts failure envelope kullanilir; istek yolu veya kullanici girdisi
 * yanita ve log mesajina yazilmaz.
 */
export function notFoundHandler(request: FastifyRequest, reply: FastifyReply): void {
  const body: FailureEnvelope = {
    ok: false,
    error: {
      code: 'not_found',
      message: 'Route not found.',
      fieldErrors: [],
      requestId: String(request.id),
    },
  }
  void reply.code(404).send(failureEnvelopeSchema.parse(body))
}
