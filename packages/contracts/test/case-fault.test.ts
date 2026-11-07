import { describe, expect, it } from 'vitest'
import { caseFaultSaveRequestSchema } from '../src/v1/case-fault.js'
import { auditActionLabel } from '../src/v1/audit/presentation.js'

describe('fault command boundary', () => {
  it('labels fault history explicitly in the existing audit vocabulary', () => {
    expect(auditActionLabel('case.fault_updated')).toBe('Dosya: kusur oranı güncellendi')
  })
  it.each([null, 0, 25, 50, 75, 100])('accepts only the fixed choices (%s)', insuredPercent => {
    expect(caseFaultSaveRequestSchema.parse({ insuredPercent, expectedVersion: 0 }).insuredPercent).toBe(insuredPercent)
  })
  it.each([-1, 1, 24, 26, 99, 101, 25.5, '25', '', undefined, true])('rejects manual or invalid percentage %s', insuredPercent => {
    expect(caseFaultSaveRequestSchema.safeParse({ insuredPercent, expectedVersion: 1 }).success).toBe(false)
  })
  it.each([null, undefined, -1, 0.5, '1', 2147483647])('requires a bounded optimistic version (%s)', expectedVersion => {
    expect(caseFaultSaveRequestSchema.safeParse({ insuredPercent: 0, expectedVersion }).success).toBe(false)
  })
  it('rejects client-supplied complement and confirmed recourse', () => {
    expect(caseFaultSaveRequestSchema.safeParse({ insuredPercent: 25, expectedVersion: 0, otherPercent: 25 }).success).toBe(false)
    expect(caseFaultSaveRequestSchema.safeParse({ insuredPercent: 25, expectedVersion: 0, recourseStatus: 'confirmed' }).success).toBe(false)
  })
})
