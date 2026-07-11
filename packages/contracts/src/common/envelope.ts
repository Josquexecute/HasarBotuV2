import { z } from 'zod'
import { apiErrorSchema } from './errors.js'

/**
 * Ortak yanit meta bilgisi. Strict ve tamamen opsiyoneldir; korelasyon icin
 * `requestId` tasir. Ham girdi veya kisisel veri icermez.
 */
export const responseMetaSchema = z.strictObject({
  requestId: z.string().min(1).optional(),
})

export type ResponseMeta = z.infer<typeof responseMetaSchema>

/**
 * Ortak basari zarfi: `ok: true`, `data` ve opsiyonel `meta`.
 * Strict tutulur: bilinmeyen ust seviye alan reddedilir.
 */
export function successEnvelopeSchema<Schema extends z.ZodType>(dataSchema: Schema) {
  return z.strictObject({
    ok: z.literal(true),
    data: dataSchema,
    meta: responseMetaSchema.optional(),
  })
}

export type SuccessEnvelope<Data> = {
  readonly ok: true
  readonly data: Data
  readonly meta?: ResponseMeta
}

/**
 * Ortak hata zarfi: `ok: false` ve `error`. Basari zarfiyla `ok` ayirt edici
 * alaniyla ayrilir.
 */
export const failureEnvelopeSchema = z.strictObject({
  ok: z.literal(false),
  error: apiErrorSchema,
})

export type FailureEnvelope = z.infer<typeof failureEnvelopeSchema>
