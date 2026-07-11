import { describe, expect, it } from 'vitest'
import {
  MAX_OFFICE_CASE_YEAR,
  MIN_OFFICE_CASE_YEAR,
  createOfficeCaseNumber,
  formatOfficeCaseNumber,
  parseInsurerClaimNumber,
  parseNotificationFormNumber,
  parseOfficeCaseNumber,
  type InsurerClaimNumber,
  type NotificationFormNumber,
} from '../src/index.js'

describe('OfficeCaseNumber', () => {
  it('YYYY/N biçimini yapısal değere dönüştürür', () => {
    expect(parseOfficeCaseNumber('2026/184')).toEqual({
      ok: true,
      value: { year: 2026, sequence: 184 },
    })
  })

  it('dış boşlukları kırpar', () => {
    expect(parseOfficeCaseNumber(' 2026/1 ')).toEqual({
      ok: true,
      value: { year: 2026, sequence: 1 },
    })
  })

  it.each(['2026184', '2026-184', '26/184', '2026/0', '2026/01'])('%s biçimini reddeder', (value) => {
    expect(parseOfficeCaseNumber(value)).toEqual({
      ok: false,
      error: { code: 'invalid_format', field: 'officeCaseNumber' },
    })
  })

  it('yıl sınırlarını uygular', () => {
    expect(createOfficeCaseNumber(MIN_OFFICE_CASE_YEAR - 1, 1)).toEqual({
      ok: false,
      error: { code: 'out_of_range', field: 'officeCaseNumber' },
    })
    expect(createOfficeCaseNumber(MAX_OFFICE_CASE_YEAR + 1, 1)).toEqual({
      ok: false,
      error: { code: 'out_of_range', field: 'officeCaseNumber' },
    })
  })

  it('pozitif güvenli tam sayı sıra ister', () => {
    expect(createOfficeCaseNumber(2026, 1.5)).toEqual({
      ok: false,
      error: { code: 'invalid_format', field: 'officeCaseNumber' },
    })
    expect(createOfficeCaseNumber(2026, Number.MAX_SAFE_INTEGER + 1)).toEqual({
      ok: false,
      error: { code: 'invalid_format', field: 'officeCaseNumber' },
    })
  })

  it('kanonik değeri yeniden biçimler', () => {
    expect(formatOfficeCaseNumber({ year: 2026, sequence: 184 })).toBe('2026/184')
  })

  it('parse ve format round-trip sonucunu korur', () => {
    const parsed = parseOfficeCaseNumber('2026/17')
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parseOfficeCaseNumber(formatOfficeCaseNumber(parsed.value))).toEqual(parsed)
  })

  it.each([0, -1])('%s sıra değerini reddeder', (sequence) => {
    expect(createOfficeCaseNumber(2026, sequence)).toEqual({
      ok: false,
      error: { code: 'out_of_range', field: 'officeCaseNumber' },
    })
  })
})

describe('external case references', () => {
  it('ihbar föy numarasını kırpar', () => {
    expect(parseNotificationFormNumber(' F-2026-0988 ')).toEqual({
      ok: true,
      value: 'F-2026-0988',
    })
  })

  it('sigorta hasar numarasını kırpar', () => {
    expect(parseInsurerClaimNumber(' HSR-992-881 ')).toEqual({
      ok: true,
      value: 'HSR-992-881',
    })
  })

  it('boş referansları reddeder', () => {
    expect(parseNotificationFormNumber(' ')).toEqual({
      ok: false,
      error: { code: 'required', field: 'notificationFormNumber' },
    })
    expect(parseInsurerClaimNumber(' ')).toEqual({
      ok: false,
      error: { code: 'required', field: 'insurerClaimNumber' },
    })
  })

  it('gerçek dünya biçimlerini destekler: slash ve tire içeren numaralar', () => {
    expect(parseNotificationFormNumber('11/18882475')).toEqual({ ok: true, value: '11/18882475' })
    expect(parseInsurerClaimNumber('F-2026-0977')).toEqual({ ok: true, value: 'F-2026-0977' })
  })

  it('128 karakteri aşan referansı reddeder', () => {
    expect(parseNotificationFormNumber('9'.repeat(129))).toEqual({
      ok: false,
      error: { code: 'out_of_range', field: 'notificationFormNumber' },
    })
    expect(parseInsurerClaimNumber('9'.repeat(128))).toEqual({ ok: true, value: '9'.repeat(128) })
  })

  it('kontrol karakteri ve backslash içeren referansı reddeder', () => {
    const withControl = `A${String.fromCharCode(9)}B`
    const withNull = `A${String.fromCharCode(0)}B`
    const withBackslash = `A${String.fromCharCode(92)}B`
    for (const bad of [withControl, withNull, withBackslash]) {
      expect(parseInsurerClaimNumber(bad)).toEqual({
        ok: false,
        error: { code: 'invalid_format', field: 'insurerClaimNumber' },
      })
    }
  })

  it('yalnız ayraçtan oluşan referansı reddeder', () => {
    for (const bad of ['---', '///', '..-..', '№№']) {
      expect(parseNotificationFormNumber(bad)).toEqual({
        ok: false,
        error: { code: 'invalid_format', field: 'notificationFormNumber' },
      })
    }
  })
})

function assertReferenceBrandSeparation(): void {
  const notification = '' as NotificationFormNumber
  const claim = '' as InsurerClaimNumber
  // @ts-expect-error Harici referansların anlamları nominal olarak ayrıdır.
  const invalidClaim: InsurerClaimNumber = notification
  // @ts-expect-error Ters yönde de nominal ayrım korunur.
  const invalidNotification: NotificationFormNumber = claim
  void invalidClaim
  void invalidNotification
}

void assertReferenceBrandSeparation
