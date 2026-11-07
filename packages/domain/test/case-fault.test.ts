import { describe, expect, it } from 'vitest'
import { CASE_FAULT_PERCENTAGES, complementaryFault, potentialRecourse } from '../src/case-fault.js'

describe('case fault allocation', () => {
  it.each(CASE_FAULT_PERCENTAGES)('complements %s in both directions', value => {
    const other = complementaryFault(value)
    expect(value + other!).toBe(100)
    expect(complementaryFault(other)).toBe(value)
    expect(potentialRecourse('traffic', value)).toBeNull()
    expect(potentialRecourse('casco', value)).toBe(other! > 0 ? other : null)
  })
  it('does not infer any fault or recourse when undetermined', () => {
    expect(complementaryFault(null)).toBeNull()
    expect(potentialRecourse('casco', null)).toBeNull()
    expect(potentialRecourse(null, 0)).toBeNull()
  })
})
