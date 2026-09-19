import { describe, expect, it } from 'vitest'
import {
  MAX_VEHICLE_CHASSIS_PREFIX_LENGTH,
  VEHICLE_CLASSES,
  VEHICLE_EVIDENCE_SOURCES,
  normalizeChassisPrefix,
  normalizeEngineCode,
  toOutboundVehicleProfile,
  validateCaseVehicleProfile,
  type CaseVehicleProfileInput,
} from '../src/case-vehicle-profile.js'

function input(overrides: Partial<CaseVehicleProfileInput> = {}): CaseVehicleProfileInput {
  return {
    brand: 'Renault',
    model: 'Clio',
    modelYear: 2021,
    variant: 'Touch',
    vehicleClass: 'passenger_car',
    chassisPrefix: 'VF1RJA00',
    engineCode: 'H4B',
    evidenceSource: 'registration_document',
    evidenceReference: 'Ruhsat 2026/44',
    ...overrides,
  }
}

describe('araç profili doğrulaması', () => {
  it('geçerli profili normalize eder', () => {
    const result = validateCaseVehicleProfile(input({ brand: '  renault  ', model: 'Clio   V' }))
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.profile.brand).toBe('renault')
    expect(result.profile.model).toBe('Clio V')
    expect(result.profile.chassisPrefix).toBe('VF1RJA00')
    expect(result.profile.engineCode).toBe('H4B')
  })

  it('marka, model, model yılı ve sınıf zorunludur', () => {
    expect(validateCaseVehicleProfile(input({ brand: '   ' })))
      .toMatchObject({ valid: false, reasonCode: 'VEHICLE_BRAND_INVALID' })
    expect(validateCaseVehicleProfile(input({ model: '' })))
      .toMatchObject({ valid: false, reasonCode: 'VEHICLE_MODEL_INVALID' })
    expect(validateCaseVehicleProfile(input({ modelYear: 1900 })))
      .toMatchObject({ valid: false, reasonCode: 'VEHICLE_MODEL_YEAR_INVALID' })
    expect(validateCaseVehicleProfile(input({ modelYear: 2021.5 })))
      .toMatchObject({ valid: false, reasonCode: 'VEHICLE_MODEL_YEAR_INVALID' })
    expect(validateCaseVehicleProfile(input({ vehicleClass: 'spaceship' as never })))
      .toMatchObject({ valid: false, reasonCode: 'VEHICLE_CLASS_INVALID' })
  })

  it('varyant, şasi prefix ve motor kodu isteğe bağlıdır', () => {
    const result = validateCaseVehicleProfile(input({
      variant: null, chassisPrefix: null, engineCode: null, evidenceReference: null,
    }))
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.profile.variant).toBeNull()
    expect(result.profile.chassisPrefix).toBeNull()
  })

  it('tam şasi numarası prefix olarak kabul edilmez', () => {
    // 17 haneli tam VIN sınırı aşar ve reddedilir.
    expect(normalizeChassisPrefix('VF1RJA00567123456')).toBeNull()
    expect(validateCaseVehicleProfile(input({ chassisPrefix: 'VF1RJA00567123456' })))
      .toMatchObject({ valid: false, reasonCode: 'VEHICLE_CHASSIS_PREFIX_INVALID' })
    expect(MAX_VEHICLE_CHASSIS_PREFIX_LENGTH).toBeLessThan(17)
  })

  it('şasi prefix VIN alfabesine uyar ve normalize edilir', () => {
    expect(normalizeChassisPrefix(' vf1-rja00 ')).toBe('VF1RJA00')
    // I, O, Q VIN alfabesinde yoktur.
    expect(normalizeChassisPrefix('VIO')).toBeNull()
    expect(normalizeChassisPrefix('AB')).toBeNull()
  })

  it('motor kodu normalize edilir ve serbest metin kabul etmez', () => {
    expect(normalizeEngineCode(' h4b ')).toBe('H4B')
    expect(normalizeEngineCode('K9K 636')).toBe('K9K636')
    expect(normalizeEngineCode('motor bilinmiyor!')).toBeNull()
    expect(normalizeEngineCode('X')).toBeNull()
  })

  it('kanıt kaynağı listeden olmalıdır', () => {
    expect(validateCaseVehicleProfile(input({ evidenceSource: 'rumor' as never })))
      .toMatchObject({ valid: false, reasonCode: 'VEHICLE_EVIDENCE_SOURCE_INVALID' })
    for (const source of VEHICLE_EVIDENCE_SOURCES) {
      expect(validateCaseVehicleProfile(input({ evidenceSource: source })).valid).toBe(true)
    }
  })

  it('araç sınıfı kümesi dar ve other içerir', () => {
    expect(VEHICLE_CLASSES).toContain('other')
    expect(VEHICLE_CLASSES.length).toBeLessThanOrEqual(8)
  })
})

describe('dış sağlayıcıya çıkan araç profili', () => {
  it('kanıt referansını DIŞARI çıkarmaz', () => {
    const result = validateCaseVehicleProfile(input({ evidenceReference: 'Ruhsat 2026/44' }))
    expect(result.valid).toBe(true)
    if (!result.valid) return
    const outbound = toOutboundVehicleProfile(result.profile)
    expect(JSON.stringify(outbound)).not.toContain('2026/44')
    expect('evidenceReference' in outbound).toBe(false)
    expect(outbound.evidenceSource).toBe('registration_document')
  })

  it('yalnız normalize alanları taşır', () => {
    const result = validateCaseVehicleProfile(input())
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(Object.keys(toOutboundVehicleProfile(result.profile)).sort()).toEqual([
      'brand', 'chassisPrefix', 'engineCode', 'evidenceSource',
      'model', 'modelYear', 'variant', 'vehicleClass',
    ])
  })
})
