import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import { failureEnvelopeSchema, type ApiErrorCode, type FailureEnvelope } from '@hasarbotu/contracts'

/**
 * Merkezi guvenli hata isleyicisi.
 *
 * - Beklenmeyen hatalar HTTP 500 + `internal_error` zarfiyla doner.
 * - Fastify'nin urettigi 4xx cercece hatalari (ornegin body limit 413) durum
 *   kodunu korur ve genel `validation_error` koduyla guvenli zarfa cevrilir.
 * - Ham exception mesaji, stack, path veya payload HTTP yanitina TASINMAZ;
 *   hata yalnizca yapilandirilmis `err` alaniyla loglanir. Log mesaji sabittir,
 *   kullanici girdisi interpolation ile eklenmez.
 */
export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply): void {
  const requestId = String(request.id)
  const isClientError =
    typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500
  const statusCode = isClientError ? (error.statusCode as number) : 500
  const code: ApiErrorCode = isClientError ? 'validation_error' : 'internal_error'

  if (isClientError) {
    request.log.warn({ err: error, requestId }, 'request rejected')
  } else {
    request.log.error({ err: error, requestId }, 'unhandled error')
  }

  const body: FailureEnvelope = {
    ok: false,
    error: {
      code,
      message: isClientError ? 'Request could not be processed.' : 'Unexpected server error.',
      fieldErrors: [],
      requestId,
    },
  }
  void reply.code(statusCode).send(failureEnvelopeSchema.parse(body))
}
