import { describe, expect, it } from 'vitest'
import { incrementEntityVersion, isEntityVersion, parseEntityVersion, type EntityVersion } from '../src/index.js'

function version(value: number): EntityVersion {
  const result = parseEntityVersion(value)
  if (!result.ok) throw new Error(`Test fixture version failed: ${result.error.code}`)
  return result.value
}

describe('EntityVersion', () => {
  it.each([1, 2, Number.MAX_SAFE_INTEGER])('%s pozitif güvenli tam sayısını kabul eder', (value) => {
    expect(parseEntityVersion(value)).toEqual({ ok: true, value })
  })

  it.each([0, -1])('%s değerini aralık dışı olarak reddeder', (value) => {
    expect(parseEntityVersion(value)).toEqual({
      ok: false,
      error: { code: 'out_of_range', field: 'entityVersion' },
    })
  })

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])('%s değerini tam sayı olmadığı için reddeder', (value) => {
    expect(parseEntityVersion(value)).toEqual({
      ok: false,
      error: { code: 'invalid_format', field: 'entityVersion' },
    })
  })

  it('string değeri reddeder', () => {
    expect(parseEntityVersion('1')).toEqual({
      ok: false,
      error: { code: 'invalid_type', field: 'entityVersion' },
    })
  })

  it('type guard yalnız geçerli sürümü tanır', () => {
    expect(isEntityVersion(1)).toBe(true)
    expect(isEntityVersion(0)).toBe(false)
    expect(isEntityVersion(1.5)).toBe(false)
  })

  it('sürümü güvenli biçimde artırır', () => {
    expect(incrementEntityVersion(version(4))).toEqual({ ok: true, value: 5 })
  })

  it('maksimum güvenli tam sayıda overflow döndürür', () => {
    expect(incrementEntityVersion(version(Number.MAX_SAFE_INTEGER))).toEqual({
      ok: false,
      error: { code: 'overflow', field: 'entityVersion' },
    })
  })
})
