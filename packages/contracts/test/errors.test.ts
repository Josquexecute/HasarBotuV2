import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  apiErrorSchema,
  caseTypeSchema,
  failureEnvelopeSchema,
  successEnvelopeSchema,
  zodErrorToApiError,
} from '../src/index.js'

describe('zarf ve guvenli hata modeli', () => {
  it('basari zarfi strict, ayirt edici ok=true ve opsiyonel meta tasir', () => {
    const schema = successEnvelopeSchema(z.strictObject({ value: z.number() }))
    expect(schema.safeParse({ ok: true, data: { value: 1 } }).success).toBe(true)
    expect(schema.safeParse({ ok: true, data: { value: 1 }, meta: {} }).success).toBe(true)
    expect(schema.safeParse({ ok: true, data: { value: 1 }, meta: { requestId: 'req_1' } }).success).toBe(true)
    expect(schema.safeParse({ ok: false, data: { value: 1 } }).success).toBe(false)
    expect(schema.safeParse({ ok: true, data: { value: 1 }, extra: 1 }).success).toBe(false)
    // meta strict: bilinmeyen meta alani reddedilir.
    expect(schema.safeParse({ ok: true, data: { value: 1 }, meta: { trace: 'x' } }).success).toBe(false)
  })

  it('hata zarfi kararli kod setini dogrular', () => {
    const failure = {
      ok: false,
      error: { code: 'not_found', message: 'x', fieldErrors: [] },
    }
    expect(failureEnvelopeSchema.safeParse(failure).success).toBe(true)

    const unknownCode = {
      ok: false,
      error: { code: 'teapot', message: 'x', fieldErrors: [] },
    }
    expect(failureEnvelopeSchema.safeParse(unknownCode).success).toBe(false)
  })

  it('Zod hatasini kararli validation_error nesnesine cevirir', () => {
    const schema = z.strictObject({ caseType: caseTypeSchema })
    const result = schema.safeParse({ caseType: 'nope' })
    expect(result.success).toBe(false)
    if (result.success) return

    const apiError = zodErrorToApiError(result.error, 'req_test_1')
    expect(apiError.code).toBe('validation_error')
    expect(apiError.requestId).toBe('req_test_1')
    expect(apiError.fieldErrors.length).toBeGreaterThan(0)
    expect(apiError.fieldErrors[0]?.path).toBe('caseType')
    // Uretilen hata nesnesi kendi semasina uyar.
    expect(apiErrorSchema.safeParse(apiError).success).toBe(true)
  })

  it('ham girdi degeri hata nesnesine sizmaz', () => {
    const schema = z.strictObject({ token: z.string().min(1) })
    const sensitive = 'SUPER_SECRET_LEAK_VALUE_42'
    const result = schema.safeParse({ token: 123, injected: sensitive })
    expect(result.success).toBe(false)
    if (result.success) return

    const apiError = zodErrorToApiError(result.error)
    const serialized = JSON.stringify(apiError)
    expect(serialized).not.toContain(sensitive)
    expect(serialized).not.toContain('123')
    // requestId verilmezse alan hic bulunmaz.
    expect(apiError.requestId).toBeUndefined()
  })

  it('bilinmeyen alan hatasini unrecognized_keys olarak guvenli tasir', () => {
    const schema = z.strictObject({ a: z.string() })
    const result = schema.safeParse({ a: 'x', unexpected: 'y' })
    expect(result.success).toBe(false)
    if (result.success) return

    const apiError = zodErrorToApiError(result.error)
    expect(apiError.fieldErrors.some((fieldError) => fieldError.code === 'unrecognized_keys')).toBe(true)
  })
})
