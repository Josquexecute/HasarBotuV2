import { describe, expect, it } from 'vitest'
import snapshotJson from '../../../reference-data/value-loss/real-market-analysis/2026-07-01/1.0.0/snapshot.json' with { type: 'json' }
import { VALUE_LOSS_VEHICLE_GROUPS, buildValueLossPartSuggestions, resolveValueLossCalculatorParts, valueLossBodyOptions, valueLossCalculatorAdditionalRules, type ValueLossCalculatorPartSelection, type ValueLossSourcePart } from '../src/value-loss-calculator-catalog.js'
import { calculateTrafficValueLossMarketDifference } from '../src/traffic-value-loss.js'

function source(group: string): ValueLossSourcePart[] { return snapshotJson.partRules.filter(rule => rule.vehicleGroupCode === group).map(rule => ({ stableRuleId: rule.stableId, label: rule.sourceLabel, supportedOperations: rule.operationCapabilities, coefficients: rule.coefficients })) }
function selection(rule: ValueLossSourcePart | null, patch: Partial<ValueLossCalculatorPartSelection> = {}): ValueLossCalculatorPartSelection {
  return { entryId: 'one', stableRuleId: rule?.stableRuleId ?? null, partName: rule?.label ?? 'ÖN GRENAJ', position: '', quantity: 1, material: 'unspecified', operation: 'replacement', paintMode: null, newPartPriceMinor: null, repairLaborMinor: null, partPriceAvailability: 'unavailable', priorPartState: 'none', treatment: 'standard', ...patch }
}

describe('vehicle-specific calculator suggestions and complete calculation coverage', () => {
  it.each(snapshotJson.vehicleMappings)('$vehicleType has distinct named suggestions and supports an unspecified body', mapping => {
    expect(VALUE_LOSS_VEHICLE_GROUPS[mapping.vehicleType as keyof typeof VALUE_LOSS_VEHICLE_GROUPS]).toBe(mapping.vehicleGroupCode)
    const parts = source(mapping.vehicleGroupCode)
    const suggestions = buildValueLossPartSuggestions(mapping.vehicleType, 'unspecified', parts)
    expect(suggestions.length).toBeGreaterThan(0)
    expect(new Set(suggestions.map(item => item.label)).size).toBe(suggestions.length)
    expect(new Set(suggestions.map(item => item.id)).size).toBe(suggestions.length)
    expect(valueLossBodyOptions(mapping.vehicleType)).toContain('unspecified')
  })
  it('separates a van minibus from coach luggage lids and does not create numbered body parts', () => {
    const minibus = buildValueLossPartSuggestions('MİNİBÜS', 'van_minibus', source('B'))
    const coach = buildValueLossPartSuggestions('OTOBÜS', 'coach', source('B'))
    expect(minibus.some(item => /YAN KAPAK|OTOBÜS/.test(item.label))).toBe(false)
    expect(minibus.some(item => item.label === 'SAĞ SÜRGÜLÜ KAPI')).toBe(true)
    expect(coach.filter(item => item.label === 'YAN KAPAK')).toEqual([expect.objectContaining({ stableRuleId: null })])
    expect(coach.some(item => /^YAN KAPAK \d/.test(item.label))).toBe(false)
  })
  it('provides scooter and sport body parts beyond the four reference coefficients', () => {
    const scooter = buildValueLossPartSuggestions('MOTORSİKLET', 'scooter', source('F'))
    expect(scooter.length).toBeGreaterThan(4)
    expect(scooter.find(item => item.label === 'ÖN GRENAJ')).toMatchObject({ stableRuleId: null })
    expect(scooter.some(item => item.label === 'AYAK BASMA TABANI')).toBe(true)
    expect(buildValueLossPartSuggestions('MOTORSİKLET', 'naked', source('F')).some(item => item.label === 'AYAK BASMA TABANI')).toBe(false)
  })
  it('keeps trailer and cabless tractor suggestions free of cab-specific parts', () => {
    expect(buildValueLossPartSuggestions('TANKER', 'tanker_trailer', source('Ç')).some(item => item.label.includes('KABİN'))).toBe(false)
    expect(buildValueLossPartSuggestions('TRAKTÖR', 'open_tractor', source('D')).some(item => /KABİN|TAVAN/.test(item.label))).toBe(false)
  })
  it('expands one repair and paint selection into its two supported atomic operations', () => {
    const parts = source('A'), row = selection(parts[0]!, { operation: 'repair_paint', paintMode: 'local' })
    const result = resolveValueLossCalculatorParts('OTOMOBİL', 'unspecified', parts, [row])
    expect(result.requiresMarketDifference).toBe(false)
    expect(result.referenceParts.map(part => [part.operation, part.paintMode])).toEqual([['repair', null], ['paint', 'local']])
  })
  it('never returns a partial set of coefficients when a known part is mixed with an unlisted part', () => {
    const parts = source('F')
    const result = resolveValueLossCalculatorParts('MOTORSİKLET', 'sport', parts, [selection(parts[0]!), selection(null, { entryId: 'two' })])
    expect(result).toMatchObject({ requiresMarketDifference: true, referenceParts: [], baseOnlyParts: [], issues: [] })
  })
  it('does not multiply a source coefficient for repeated physical panels or ambiguous source labels', () => {
    const parts = source('B'), rule = parts.find(part => part.label === 'TAVAN SACI')!
    expect(resolveValueLossCalculatorParts('OTOBÜS', 'coach', parts, [selection(rule, { quantity: 2, position: '1. ve 2. bölüm' })]).requiresMarketDifference).toBe(true)
    const caps = source('D').find(part => part.label === 'KAPAK SAC')!
    expect(resolveValueLossCalculatorParts('TRAKTÖR', 'cab_tractor', source('D'), [selection(caps)]).requiresMarketDifference).toBe(true)
  })
  it('rejects duplicate physical positions and foreign reference IDs even on market calculations', () => {
    const parts = source('F'), row = selection(parts[0]!)
    expect(resolveValueLossCalculatorParts('MOTORSİKLET', 'sport', parts, [row, { ...row, entryId: 'two' }]).issues).toHaveLength(1)
    expect(resolveValueLossCalculatorParts('MOTORSİKLET', 'sport', parts, [selection(source('A')[0]!)]).issues).toHaveLength(1)
  })
  it('distinguishes an explicitly documented base-only rule from a missing coefficient', () => {
    const parts = source('F')
    const unknown = selection(null, { material: 'plastic' })
    expect(resolveValueLossCalculatorParts('MOTORSİKLET', 'sport', parts, [unknown]).requiresMarketDifference).toBe(true)
    const plastic = resolveValueLossCalculatorParts('MOTORSİKLET', 'sport', parts, [{ ...unknown, material: 'plastic_bodywork' }])
    expect(plastic).toMatchObject({ requiresMarketDifference: false, referenceParts: [], baseOnlyParts: [{ entryId: 'one', principle: '3.9' }] })
    expect(resolveValueLossCalculatorParts('MOTORSİKLET', 'sport', parts, [selection(parts[0]!, { material: 'steel', operation: 'paintless_repair' })]).baseOnlyParts[0]?.principle).toBe('3.10')
    expect(resolveValueLossCalculatorParts('MOTORSİKLET', 'sport', parts, [{ ...unknown, material: 'plastic_bodywork', treatment: 'accessory' }]).requiresMarketDifference).toBe(true)
  })
  it('only exposes the verified additional side panels in their documented cabrio context', () => {
    const rules = valueLossCalculatorAdditionalRules('OTOMOBİL', 'cabriolet')
    expect(rules.map(rule => rule.sourceRow)).toEqual([264, 265])
    expect(valueLossCalculatorAdditionalRules('OTOMOBİL', 'sedan')).toEqual([])
    expect(valueLossCalculatorAdditionalRules('KAMYONET', 'pickup')).toEqual([])
    const suggestions = buildValueLossPartSuggestions('OTOMOBİL', 'cabriolet', source('A'))
    expect(suggestions.some(item => item.stableRuleId === rules[0]?.stableId)).toBe(true)
    expect(suggestions.some(item => /ARKA ÇAMURLUK|TAVAN SACI/.test(item.label))).toBe(false)
  })
})

describe('market value difference arithmetic', () => {
  it.each([[100_000_000, 90_000_000, 7500, 7_500_000], [101, 100, 5000, 1], [100, 100, 10000, 0], [100, 90, 0, 0], [Number.MAX_SAFE_INTEGER, 0, 10000, Number.MAX_SAFE_INTEGER]])('preserves safe minor-unit rounding for %s / %s', (before, after, fault, expected) => {
    expect(calculateTrafficValueLossMarketDifference(before, after, fault).faultAdjustedValueLossMinor).toBe(expected)
  })
})

describe('coefficient verification and manufacturer boundaries', () => {
  const parts = source('A')
  const rule = parts.find(part => part.label === 'MOTOR KAPUTU')!
  it.each([undefined, { ...rule.coefficients!, replacement: null }, { ...rule.coefficients!, replacement: '-1' }, { ...rule.coefficients!, replacement: 'NaN' }])('requires market difference for missing or invalid numeric coefficients', coefficients => {
    const incomplete = { stableRuleId: rule.stableRuleId, label: rule.label, supportedOperations: rule.supportedOperations, ...(coefficients === undefined ? {} : { coefficients }) }
    const result = resolveValueLossCalculatorParts('OTOMOBİL', 'sedan', [incomplete], [selection(rule)])
    expect(result).toMatchObject({ requiresMarketDifference: true, referenceParts: [], coverage: [{ reason: 'coefficient_unverified' }] })
  })
  it('accepts a source-documented zero rather than treating it as missing', () => {
    expect(resolveValueLossCalculatorParts('OTOMOBİL', 'sedan', [{ ...rule, coefficients: { ...rule.coefficients!, replacement: '0' } }], [selection(rule)]).requiresMarketDifference).toBe(false)
  })
  it('requires both coefficients for a combined operation and the selected paint mode', () => {
    const coefficients = { ...rule.coefficients!, paint: { full: '1', local: null } } as unknown as NonNullable<ValueLossSourcePart['coefficients']>
    const result = resolveValueLossCalculatorParts('OTOMOBİL', 'sedan', [{ ...rule, coefficients }], [selection(rule, { operation: 'replacement_paint', paintMode: 'local' })])
    expect(result).toMatchObject({ requiresMarketDifference: true, referenceParts: [], coverage: [{ reason: 'coefficient_unverified' }] })
  })
  it('does not equate a documented manufacturer category with verified VIN fitment or a model coefficient', () => {
    const result = resolveValueLossCalculatorParts('OTOMOBİL', 'sedan', parts, [selection(rule)], { identity: { manufacturer: 'Tesla', model: 'Model 3' }, modelYear: 2023 })
    expect(result).toMatchObject({ requiresMarketDifference: false, coverage: [{ reason: 'manufacturer_documented', manufacturerSource: { manufacturer: 'Tesla' } }] })
    expect(result.referenceParts).toEqual(resolveValueLossCalculatorParts('OTOMOBİL', 'sedan', parts, [selection(rule)]).referenceParts)
  })
  it('keeps documented base-only arithmetic independent of manufacturer fitment', () => {
    const result = resolveValueLossCalculatorParts('OTOMOBİL', 'sedan', parts, [selection(rule, { material: 'plastic_bodywork' })], { identity: { manufacturer: 'Unknown', model: 'Unknown' }, modelYear: 2023 })
    expect(result).toMatchObject({ requiresMarketDifference: false, referenceParts: [], baseOnlyParts: [{ entryId: 'one', principle: '3.9' }], coverage: [{ reason: 'documented_base_only' }] })
  })
})
