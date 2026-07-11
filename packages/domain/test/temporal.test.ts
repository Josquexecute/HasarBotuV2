import { describe, expect, it } from 'vitest'
import {
  isLocalDate,
  isUtcDateTime,
  parseLocalDate,
  parseUtcDateTime,
  type LocalDate,
  type UtcDateTime,
} from '../src/index.js'

describe('LocalDate', () => {
  it.each(['2026-07-11', '2024-02-29', '2000-01-01'])('%s gerçek tarihini kabul eder', (value) => {
    expect(parseLocalDate(value)).toEqual({ ok: true, value })
  })

  it.each(['2026-2-01', '11.07.2026', ' 2026-07-11 '])('%s kanonik olmayan biçimi reddeder', (value) => {
    expect(parseLocalDate(value)).toEqual({
      ok: false,
      error: { code: 'invalid_format', field: 'localDate' },
    })
  })

  it.each(['2023-02-29', '2026-04-31', '2026-13-01', '0000-01-01'])('%s geçersiz tarihi reddeder', (value) => {
    expect(parseLocalDate(value)).toEqual({
      ok: false,
      error: { code: 'out_of_range', field: 'localDate' },
    })
  })

  it('type guard yalnız gerçek kanonik tarihi tanır', () => {
    expect(isLocalDate('2024-02-29')).toBe(true)
    expect(isLocalDate('2026-02-30')).toBe(false)
  })
})

describe('UtcDateTime', () => {
  it.each(['2026-07-11T11:30:00Z', '2026-07-11T11:30:00.123Z'])('%s kanonik UTC değerini kabul eder', (value) => {
    expect(parseUtcDateTime(value)).toEqual({ ok: true, value })
  })

  it.each([
    '2026-07-11T14:30:00+03:00',
    '2026-07-11T11:30:00',
    '2026-07-11 11:30:00Z',
    '2026-07-11T11:30:00.1Z',
    ' 2026-07-11T11:30:00Z ',
  ])('%s belirsiz veya kanonik olmayan değeri reddeder', (value) => {
    expect(parseUtcDateTime(value)).toEqual({
      ok: false,
      error: { code: 'invalid_format', field: 'utcDateTime' },
    })
  })

  it('type guard yalnız canonical Z değerini tanır', () => {
    expect(isUtcDateTime('2026-07-11T11:30:00Z')).toBe(true)
    expect(isUtcDateTime('2026-07-11T14:30:00+03:00')).toBe(false)
  })

  it.each([
    '2023-02-29T11:30:00Z',
    '2026-07-11T24:00:00Z',
    '2026-07-11T23:60:00Z',
    '2026-07-11T23:59:60Z',
  ])('%s takvim/saat aralığını reddeder', (value) => {
    expect(parseUtcDateTime(value)).toEqual({
      ok: false,
      error: { code: 'out_of_range', field: 'utcDateTime' },
    })
  })
})

function assertTemporalBrandSeparation(): void {
  const localDate = '' as LocalDate
  const utcDateTime = '' as UtcDateTime
  // @ts-expect-error Yalnız tarih ile UTC tarih-saat birbirine atanamaz.
  const invalidUtc: UtcDateTime = localDate
  // @ts-expect-error Ters yönde de nominal ayrım korunur.
  const invalidLocal: LocalDate = utcDateTime
  void invalidUtc
  void invalidLocal
}

void assertTemporalBrandSeparation
