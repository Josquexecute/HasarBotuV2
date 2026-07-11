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

  it('bilinmeyen alan hatasinda anahtar ADINI raporlar, degeri asla tasimaz', () => {
    const schema = z.strictObject({ a: z.string() })
    const result = schema.safeParse({ a: 'x', unexpected: 'GIZLI_DEGER_123' })
    expect(result.success).toBe(false)
    if (result.success) return

    const apiError = zodErrorToApiError(result.error)
    const unknownEntry = apiError.fieldErrors.find((fieldError) => fieldError.code === 'unrecognized_keys')
    expect(unknownEntry?.path).toBe('unexpected')
    expect(JSON.stringify(apiError)).not.toContain('GIZLI_DEGER_123')
  })

  it('ic ice bilinmeyen anahtar yolu obje yoluyla birlesir', () => {
    const schema = z.strictObject({ inner: z.strictObject({ b: z.string() }) })
    const result = schema.safeParse({ inner: { b: 'x', rogue: 1 } })
    expect(result.success).toBe(false)
    if (result.success) return

    const apiError = zodErrorToApiError(result.error)
    expect(apiError.fieldErrors[0]?.path).toBe('inner.rogue')
  })

  it('bilinmeyen anahtar sayisi 10 ile sinirlanir', () => {
    const schema = z.strictObject({ a: z.string() })
    const noisy = Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`k${index}`, index]))
    const result = schema.safeParse({ a: 'x', ...noisy })
    expect(result.success).toBe(false)
    if (result.success) return

    const apiError = zodErrorToApiError(result.error)
    const unknownEntries = apiError.fieldErrors.filter((fieldError) => fieldError.code === 'unrecognized_keys')
    expect(unknownEntries.length).toBe(10)
  })

  it('prototype pollution anahtarlari ve kontrol karakterleri guvenli raporlanir', () => {
    const schema = z.strictObject({ a: z.string() })
    const payload = JSON.parse('{"a":"x","__proto__x":1,"constructor":2}')
    const result = schema.safeParse(payload)
    expect(result.success).toBe(false)
    if (result.success) return

    const before = ({} as Record<string, unknown>).polluted
    const apiError = zodErrorToApiError(result.error)
    expect(({} as Record<string, unknown>).polluted).toBe(before)
    const paths = apiError.fieldErrors.map((fieldError) => fieldError.path)
    expect(paths).toContain('__proto__x')
    // Kontrol karakterli ve asiri uzun anahtar adi temizlenir/kirpilir.
    const evilKey = `bad${String.fromCharCode(0)}key${'x'.repeat(100)}`
    const result2 = schema.safeParse({ a: 'x', [evilKey]: 1 })
    expect(result2.success).toBe(false)
    if (result2.success) return
    const apiError2 = zodErrorToApiError(result2.error)
    const reported = apiError2.fieldErrors[0]?.path ?? ''
    expect(reported.includes(String.fromCharCode(0))).toBe(false)
    expect(reported.length).toBeLessThanOrEqual(64)
  })
})
