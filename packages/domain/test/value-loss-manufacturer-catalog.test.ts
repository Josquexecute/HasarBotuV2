import { describe, expect, it } from 'vitest'
import { findValueLossManufacturerPart, VALUE_LOSS_MANUFACTURER_PARTS } from '../src/value-loss-manufacturer-catalog.js'

describe('public manufacturer documentation matching', () => {
  it.each(VALUE_LOSS_MANUFACTURER_PARTS)('$partName matches only its documented model, years and body', part => {
    const identity = { manufacturer: part.manufacturer, model: part.model }
    for (const year of [part.firstModelYear, part.lastModelYear]) expect(findValueLossManufacturerPart(identity, year, part.vehicleType, part.bodyType, part.partName)).toEqual(part)
    for (const year of [null, part.firstModelYear - 1, part.lastModelYear + 1]) expect(findValueLossManufacturerPart(identity, year, part.vehicleType, part.bodyType, part.partName)).toBeNull()
    expect(findValueLossManufacturerPart({ ...identity, model: 'Model Y' }, 2023, part.vehicleType, part.bodyType, part.partName)).toBeNull()
    expect(findValueLossManufacturerPart(identity, 2023, 'KAMYON', part.bodyType, part.partName)).toBeNull()
    expect(findValueLossManufacturerPart(identity, 2023, part.vehicleType, 'cabriolet', part.partName)).toBeNull()
  })
  it('normalizes case and whitespace without fuzzy matching another component', () => {
    expect(findValueLossManufacturerPart({ manufacturer: ' tesla ', model: 'model   3' }, 2023, 'OTOMOBİL', 'sedan', 'motor kaputu')).not.toBeNull()
    expect(findValueLossManufacturerPart({ manufacturer: 'Tesla', model: 'Model 3' }, 2023, 'OTOMOBİL', 'sedan', 'SAĞ ÖN KAPI (KAPI SACI)')).toBeNull()
  })
})
