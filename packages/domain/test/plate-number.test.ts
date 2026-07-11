import { describe, expect, it } from 'vitest'
import { parsePlateNumber, plateSearchKey } from '../src/index.js'

function parsePlate(value: unknown) {
  const result = parsePlateNumber(value)
  if (!result.ok) throw new Error(`Test fixture plate failed: ${result.error.code}`)
  return result.value
}

describe('PlateNumber', () => {
  it.each([
    ['34mpa764', '34 MPA 764'],
    ['  34   mpa   764  ', '34 MPA 764'],
    ['34-mpa-764', '34 MPA 764'],
    ['06 abc 123', '06 ABC 123'],
  ])('%s girdisini %s biçimine getirir', (input, canonical) => {
    expect(parsePlateNumber(input)).toEqual({ ok: true, value: canonical })
  })

  it('kanonik ayraçsız arama anahtarı üretir', () => {
    expect(plateSearchKey(parsePlate('34 MPA 764'))).toBe('34MPA764')
  })

  it('aynı plakanın farklı vakalarda kullanılmasını engelleyen global durum taşımaz', () => {
    expect(parsePlateNumber('34 MPA 764')).toEqual(parsePlateNumber('34mpa764'))
  })

  it('standart kalıba uymayan alfasayısal plakayı gereksiz yere reddetmez', () => {
    expect(parsePlateNumber('ab 12 xyz 98765')).toEqual({
      ok: true,
      value: 'AB 12 XYZ 98765',
    })
  })

  it('yalnız ayraç içeren girdiyi reddeder', () => {
    expect(parsePlateNumber(' - . / ')).toEqual({
      ok: false,
      error: { code: 'invalid_format', field: 'plateNumber' },
    })
  })

  it('boş girdiyi required ile reddeder', () => {
    expect(parsePlateNumber('  ')).toEqual({
      ok: false,
      error: { code: 'required', field: 'plateNumber' },
    })
  })

  it('string olmayan girdiyi reddeder', () => {
    expect(parsePlateNumber(34)).toEqual({
      ok: false,
      error: { code: 'invalid_type', field: 'plateNumber' },
    })
  })
})
