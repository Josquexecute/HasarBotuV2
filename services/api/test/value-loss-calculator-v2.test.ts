import { describe, expect, it } from 'vitest'
import { valueLossCalculatorRequestSchema } from '@hasarbotu/contracts'
import { calculateValueLoss } from '../src/traffic-value-loss/calculator.js'
import { realMarketValueLossRuleSnapshot } from '../src/traffic-value-loss/rule-source.js'
import cases from './fixtures/value-loss-v2-excel.json' with { type: 'json' }

// Microsoft Excel CalculateFull on a read-only copy of V2. Expected cells:
// H1 (total), C64+H64+K64 (parts), C7 (age), F9 (usage), J7 (history), J9 (proximity),
// and Tablolar!U10 (unrounded amount) or U2 for the motorcycle case.
const disputedHistoryCases = new Set([
  'bus base', 'trailer base', 'car actual formula at 110', 'base history 5', 'base history 7',
  'base history 8', 'base history 10', 'base history 11', 'base history 109', 'base history 110', 'base history 111',
])
const disputedRepairCases = new Set([
  'right fender at 15 percent', 'left fender at 30 percent', 'A fender 15.0000%', 'A fender 30.0000%',
  'fractional part price at 15 percent', 'fractional part price at 30 percent',
])

describe('Excel V2 calculation', () => {
  it.each(cases)('applies the documented source decision for $name', row => {
    const rule = realMarketValueLossRuleSnapshot.partRules.find(part => part.vehicleGroupCode === row.group && part.sourceRow === row.row)
    const input = valueLossCalculatorRequestSchema.parse({
      workbookVersion: 2, accidentDate: '2026-10-01', vehicleType: row.vehicleType,
      modelYear: row.year, usageValue: row.usage, marketValueMinor: Math.round(row.market * 100),
      damageAmountMinor: Math.round(row.damage * 100), previousDamageCount: row.count,
      commercialOrRental: false, vehicleCondition: 'normal', postRepairMarketValueMinor: null,
      faultRateBasisPoints: null, parts: [],
      partSelections: row.row === 0 ? [] : [{
        entryId: 'one', stableRuleId: rule!.stableId, partName: rule!.sourceLabel.trim(), position: '', quantity: 1,
        material: 'unspecified', operation: row.operation === 'blankLabor' ? 'repair' : row.operation, paintMode: row.operation.includes('paint') ? 'local' : null,
        newPartPriceMinor: (row.operation === 'repair' || row.operation === 'blankLabor') && row.labor >= 0 ? Math.round((row.price ?? 10_000) * 100) : null,
        repairLaborMinor: row.operation === 'repair' && row.labor >= 0 ? Math.round(row.labor * 100) : null,
        partPriceAvailability: row.labor < 0 ? 'unavailable' : 'available',
        priorPartState: 'none', treatment: 'standard',
      }],
    })
    const result = calculateValueLoss(input)
    if (disputedHistoryCases.has(row.name)) {
      expect(result.amountMinor).toBeNull()
      expect(result.breakdown).toBeUndefined()
      expect(result.issues).toContainEqual({
        field: 'previousDamageCount', message: expect.stringContaining('3.27'),
      })
      return
    }
    if (disputedRepairCases.has(row.name)) {
      expect(result.amountMinor).toBeNull()
      expect(result.breakdown).toBeUndefined()
      expect(result.issues).toContainEqual({
        field: 'parts.repairLaborMinor', message: expect.stringContaining('3.4'),
      })
      return
    }
    if (row.operation === 'blankLabor') {
      // Excel divides the blank cell as zero. Guide 3.3 requires the user to
      // explicitly declare missing cost on a confirmed repair before using the heavy rate.
      expect(row.part).toBe(0.4)
      expect(result.amountMinor).toBeNull()
      expect(result.issues).toContainEqual(expect.objectContaining({ field: 'parts.repairLaborMinor' }))
      const confirmed = calculateValueLoss({
        ...input,
        partSelections: [{ ...input.partSelections![0]!, partPriceAvailability: 'unavailable' }],
      })
      expect(confirmed.breakdown?.partCoefficient).toBe('0.8')
      return
    }
    expect(result.issues).toEqual([])
    // The workbook's binary residual pushes 24,500 TL to 25,000 TL. Guide 3.21 preserves the exact multiple.
    const expectedMinor = row.name === 'truck mileage 1001001' ? 2_450_000 : row.total * 100
    expect(result.amountMinor).toBe(expectedMinor)
    expect(result.breakdown?.grossAmountMinor).toBe(expectedMinor)
    expect(Number(result.breakdown?.partCoefficient)).toBeCloseTo(row.part)
    expect(Number(result.breakdown?.usageCoefficient)).toBeCloseTo(row.usageCoefficient)
    expect(Number(result.breakdown?.previousDamageModifier)).toBeCloseTo(row.previousModifier)
    if (row.mileageModifier !== undefined) expect(Number(result.breakdown?.mileageModifier)).toBeCloseTo(row.mileageModifier)
    if (row.ageCoefficient !== undefined) expect(Number(result.breakdown?.ageCoefficient)).toBeCloseTo(row.ageCoefficient)
    if (row.raw !== undefined) expect(Number(result.breakdown?.rawAmountMinor) / 100).toBeCloseTo(row.raw, 6)
    if (row.capApplied !== undefined) expect(result.breakdown?.capApplied).toBe(row.capApplied)
    if (row.capped !== undefined) expect(Number(result.breakdown?.cappedAmountMinor) / 100).toBeCloseTo(row.capped, 6)
    expect(result.breakdown?.faultRateBasisPoints).toBeNull()
  })
})
