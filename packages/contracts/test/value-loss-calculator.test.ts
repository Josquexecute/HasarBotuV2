import { describe, expect, it } from 'vitest'
import { valueLossCalculatorRequestSchema } from '../src/index.js'

const entry = { entryId: 'one', stableRuleId: null, partName: 'Ön grenaj', position: '', quantity: 1, material: 'plastic', operation: 'replacement', paintMode: null, newPartPriceMinor: null, repairLaborMinor: null, partPriceAvailability: 'unavailable', priorPartState: 'none', treatment: 'standard' }
const request = { accidentDate: '2026-10-01', vehicleType: 'MOTORSİKLET', bodyType: 'scooter', calculationBasis: 'market_difference', modelYear: null, usageValue: null, marketValueMinor: 10_000_000, damageAmountMinor: 0, previousDamageCount: 0, commercialOrRental: false, vehicleCondition: 'normal', parts: [], partSelections: [entry], postRepairMarketValueMinor: 9_000_000, faultRateBasisPoints: 7500 }

describe('calculator additive request compatibility and physical part validation', () => {
  it('accepts manufacturer identity only together with physical part selections', () => {
    expect(valueLossCalculatorRequestSchema.parse({ ...request, vehicleIdentity: { manufacturer: ' Tesla ', model: 'Model 3' } }).vehicleIdentity).toEqual({ manufacturer: 'Tesla', model: 'Model 3' })
    expect(valueLossCalculatorRequestSchema.safeParse({ ...request, partSelections: undefined, vehicleIdentity: { manufacturer: 'Tesla', model: 'Model 3' } }).success).toBe(false)
    for (const vehicleIdentity of [{ manufacturer: '', model: 'Model 3' }, { manufacturer: 'Tesla', model: '' }, { manufacturer: 'Tesla', model: 'Model 3', verified: true }]) expect(valueLossCalculatorRequestSchema.safeParse({ ...request, vehicleIdentity }).success).toBe(false)
  })
  it('accepts complete unlisted parts and modern market values without a per-part coefficient', () => expect(valueLossCalculatorRequestSchema.safeParse(request).success).toBe(true))
  it.each([
    { bodyType: 'sedan' }, { partSelections: [{ ...entry, partName: '  ' }] }, { partSelections: [{ ...entry, quantity: 0 }] }, { partSelections: [{ ...entry, quantity: 21 }] },
    { partSelections: [{ ...entry, quantity: 2 }] }, { partSelections: [{ ...entry, quantity: 1.5 }] }, { partSelections: [entry, entry] }, { partSelections: [{ ...entry, operation: 'repair_paint' }] },
    { postRepairMarketValueMinor: null }, { postRepairMarketValueMinor: 11_000_000 }, { faultRateBasisPoints: 10001 }, { partSelections: [] },
  ])('rejects an invalid or incomplete physical request: %j', patch => expect(valueLossCalculatorRequestSchema.safeParse({ ...request, ...patch }).success).toBe(false))
  it('preserves actual positions and quantities', () => expect(valueLossCalculatorRequestSchema.parse({ ...request, partSelections: [{ ...entry, quantity: 2, position: 'sağ ve sol' }] }).partSelections?.[0]).toMatchObject({ quantity: 2, position: 'sağ ve sol' }))
  it('rejects mixing old atomic rows and new physical entries', () => {
    expect(valueLossCalculatorRequestSchema.safeParse({ ...request, parts: [{ ...entry, stableRuleId: 'old-rule' }] }).success).toBe(false)
  })
})
