export const CASE_FAULT_PERCENTAGES = [0, 25, 50, 75, 100] as const
export type CaseFaultPercentage = typeof CASE_FAULT_PERCENTAGES[number]

/** Store one side only: a determined two-party allocation always totals 100. */
export function complementaryFault(value: CaseFaultPercentage | null): CaseFaultPercentage | null {
  return value === null ? null : (100 - value) as CaseFaultPercentage
}

export function potentialRecourse(caseType: 'traffic' | 'casco' | null, insuredPercent: CaseFaultPercentage | null): CaseFaultPercentage | null {
  const other = complementaryFault(insuredPercent)
  return caseType === 'casco' && other !== null && other > 0 ? other : null
}
