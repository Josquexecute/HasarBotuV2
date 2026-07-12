import { failureEnvelopeSchema, type ApiErrorCode, type FailureEnvelope } from '@hasarbotu/contracts'

/** Guvenli, sabit mesajli failure envelope govdesi kurar ve semayla dogrular. */
export function failureBody(code: ApiErrorCode, message: string, requestId: string): FailureEnvelope {
  return failureEnvelopeSchema.parse({
    ok: false,
    error: { code, message, fieldErrors: [], requestId },
  })
}
