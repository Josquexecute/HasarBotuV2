import { z } from 'zod'

/**
 * Kararli, dil bagimsiz API hata kodlari. Kullanici metnine bagli degildir.
 */
export const API_ERROR_CODES = [
  'validation_error',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'version_conflict',
  'idempotency_conflict',
  'service_unavailable',
  'internal_error',
] as const

export type ApiErrorCode = (typeof API_ERROR_CODES)[number]

export const apiErrorCodeSchema = z.enum(API_ERROR_CODES)

/**
 * Alan hatasi guvenli ozeti: yalnizca alan yolu, kararli kod ve sabit guvenli mesaj.
 * Ham girdi degeri veya kullaniciya gosterilecek serbest metin tasimaz.
 */
export const fieldErrorSchema = z.strictObject({
  path: z.string(),
  code: z.string(),
  message: z.string(),
})

export type FieldError = z.infer<typeof fieldErrorSchema>

/**
 * Genel API hata modeli. `requestId` opsiyoneldir ve korelasyon icindir.
 */
export const apiErrorSchema = z.strictObject({
  code: apiErrorCodeSchema,
  message: z.string(),
  fieldErrors: z.array(fieldErrorSchema),
  requestId: z.string().min(1).optional(),
})

export type ApiError = z.infer<typeof apiErrorSchema>

/**
 * Zod issue kodlarini kararli, guvenli alan hata kodlarina esler.
 * Bilinmeyen kod `invalid` olur; hicbir durumda ham girdi tasinmaz.
 */
const ZOD_CODE_MAP: Record<string, string> = {
  invalid_type: 'invalid_type',
  invalid_value: 'invalid_value',
  invalid_format: 'invalid_format',
  invalid_string: 'invalid_format',
  invalid_enum_value: 'invalid_value',
  too_small: 'too_small',
  too_big: 'too_big',
  not_multiple_of: 'invalid_value',
  unrecognized_keys: 'unrecognized_keys',
  invalid_union: 'invalid_value',
  custom: 'invalid_value',
}

const SAFE_FIELD_MESSAGES: Record<string, string> = {
  invalid_type: 'Field type is invalid.',
  invalid_value: 'Field value is not allowed.',
  invalid_format: 'Field format is invalid.',
  too_small: 'Field value is below the allowed range.',
  too_big: 'Field value is above the allowed range.',
  unrecognized_keys: 'Unknown field is not allowed.',
  invalid: 'Field is invalid.',
}

function safeFieldCode(zodCode: string): string {
  return ZOD_CODE_MAP[zodCode] ?? 'invalid'
}

function safeFieldMessage(fieldCode: string): string {
  return SAFE_FIELD_MESSAGES[fieldCode] ?? SAFE_FIELD_MESSAGES.invalid ?? 'Field is invalid.'
}

/**
 * Zod dogrulama hatasini guvenli API hata nesnesine cevirir.
 *
 * Ham request, stack trace, SQL mesaji, mutlak dosya yolu, parola, token veya
 * kisisel veri hata nesnesine eklenmez. Yalnizca alan yolu ve kararli kod tasinir;
 * Zod'un urettigi serbest mesaj veya `received` degeri disari sizmaz.
 */
export function zodErrorToApiError(error: z.ZodError, requestId?: string): ApiError {
  const fieldErrors: FieldError[] = error.issues.map((issue) => {
    const code = safeFieldCode(issue.code)
    return {
      path: issue.path.map((segment) => String(segment)).join('.'),
      code,
      message: safeFieldMessage(code),
    }
  })

  return {
    code: 'validation_error',
    message: 'Request validation failed.',
    fieldErrors,
    ...(requestId !== undefined ? { requestId } : {}),
  }
}
