import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import { failureEnvelopeSchema, type ApiErrorCode, type FailureEnvelope } from '@hasarbotu/contracts'
import { CaseTypeRequiredError } from '../cases/classification.js'

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
  const constraint = (error as { constraint?: string }).constraint
  if (error.code === '23505' && ['folder_path_owner_unique', 'folder_identity_canonical_unique', 'folder_identity_path_owner'].includes(constraint ?? '')) {
    void reply.code(409).send(failureEnvelopeSchema.parse({ ok: false,
      error: { code: 'conflict', message: 'Klasör başka bir dosyaya ait veya bir işlem için ayrılmış. Konumu yeniden denetleyin.', requestId, fieldErrors: [] },
    }))
    return
  }
  if (error instanceof CaseTypeRequiredError) {
    void reply.code(409).send(failureEnvelopeSchema.parse({
      ok: false,
      error: { code: 'conflict', message: 'Önce dosya türünü Trafik veya Kasko olarak seçin.', requestId,
        fieldErrors: [{ path: 'caseType', code: 'case_type_required', message: 'Dosya türü seçilmelidir.' }] },
    }))
    return
  }
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
