export const CLOSURE_FEE_RULE_VERSION = 'closure-fee/1.0.0' as const

export const CLOSURE_FEE_STATUSES = [
  'control_required',
  'approved',
  'corrected',
] as const

export type ClosureFeeStatus = (typeof CLOSURE_FEE_STATUSES)[number]

export const CLOSURE_FEE_SOURCE_TYPES = ['manual'] as const
export type ClosureFeeSourceType = (typeof CLOSURE_FEE_SOURCE_TYPES)[number]

export const CLOSURE_FEE_CURRENCY = 'TRY' as const
export const MAX_CLOSURE_FEE_MINOR = 100_000_000_00

export interface ClosureFeeSourceFacts {
  readonly caseLifecycleStatus: 'open' | 'closed'
  readonly documentType: string
  readonly documentStatus: 'pending' | 'ready' | 'failed' | 'missing'
  readonly hashVerified: boolean
  readonly sizeVerified: boolean
  readonly verifiedAt: string | null
}

export type ClosureFeeSourceEligibility =
  | { readonly eligible: true; readonly reasonCode: 'eligible' }
  | {
      readonly eligible: false
      readonly reasonCode:
        | 'case_not_closed'
        | 'final_report_required'
        | 'source_not_ready'
        | 'source_not_verified'
    }

export function evaluateClosureFeeSource(
  facts: ClosureFeeSourceFacts,
): ClosureFeeSourceEligibility {
  if (facts.caseLifecycleStatus !== 'closed') {
    return { eligible: false, reasonCode: 'case_not_closed' }
  }
  if (facts.documentType !== 'expert_report') {
    return { eligible: false, reasonCode: 'final_report_required' }
  }
  if (facts.documentStatus !== 'ready') {
    return { eligible: false, reasonCode: 'source_not_ready' }
  }
  if (!facts.hashVerified || !facts.sizeVerified || facts.verifiedAt === null) {
    return { eligible: false, reasonCode: 'source_not_verified' }
  }
  return { eligible: true, reasonCode: 'eligible' }
}

export function isValidClosureFeeMinor(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_CLOSURE_FEE_MINOR
}

export function isApprovedClosureFeeStatus(
  status: ClosureFeeStatus,
): status is 'approved' | 'corrected' {
  return status === 'approved' || status === 'corrected'
}
