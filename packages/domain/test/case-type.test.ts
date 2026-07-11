import { describe, expect, it } from 'vitest'
import { CASE_TYPES, isCaseType, isValueLossRequired, parseCaseType } from '../src/index.js'

describe('CaseType', () => {
  it('yalnız iki ana dosya türünü listeler', () => {
    expect(CASE_TYPES).toEqual(['traffic', 'casco'])
  })

  it.each(CASE_TYPES)('%s kodunu kabul eder', (value) => {
    expect(parseCaseType(value)).toEqual({ ok: true, value })
  })

  it('dış boşlukları kırpar', () => {
    expect(parseCaseType('  traffic ')).toEqual({ ok: true, value: 'traffic' })
  })

  it('type guard yalnız kararlı makine kodlarını tanır', () => {
    expect(isCaseType('traffic')).toBe(true)
    expect(isCaseType('casco')).toBe(true)
    expect(isCaseType(' traffic ')).toBe(false)
    expect(isCaseType('Trafik')).toBe(false)
  })

  it('değer kaybını Trafik için zorunlu, Kasko için zorunlu değil olarak belirler', () => {
    expect(isValueLossRequired('traffic')).toBe(true)
    expect(isValueLossRequired('casco')).toBe(false)
  })

  it('Türkçe sunum etiketini domain kodu olarak kabul etmez', () => {
    expect(parseCaseType('Trafik')).toEqual({
      ok: false,
      error: { code: 'unsupported_value', field: 'caseType' },
    })
  })

  it('değer kaybını bağımsız dosya türü olarak reddeder', () => {
    expect(parseCaseType('value_loss')).toEqual({
      ok: false,
      error: { code: 'unsupported_value', field: 'caseType' },
    })
  })

  it('boş değeri reddeder', () => {
    expect(parseCaseType('')).toEqual({ ok: false, error: { code: 'required', field: 'caseType' } })
  })

  it('string olmayan değeri reddeder', () => {
    expect(parseCaseType(null)).toEqual({
      ok: false,
      error: { code: 'invalid_type', field: 'caseType' },
    })
  })
})
