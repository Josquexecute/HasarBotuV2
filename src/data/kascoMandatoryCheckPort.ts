export const KASCO_MANDATORY_CHECK_CODES = [
  'driver_registration_owner_match',
  'driver_license_restriction_codes',
  'policyholder_registration_owner_match',
  'occupation_information',
  'equivalent_parts_clause',
  'service_deductible_clause',
  'market_value_general_deductible',
] as const
export type KascoMandatoryCheckCodeValue = (typeof KASCO_MANDATORY_CHECK_CODES)[number]

export type KascoCheckResultValue = 'same' | 'different' | 'present' | 'absent' | 'unclear' | 'unknown'
export type KascoCheckDerivedStatusValue = 'not_applicable' | 'missing' | 'control_required' | 'needs_review' | 'resolved'

export interface KascoCheckEvidenceRecord {
  readonly documentId: string
  readonly documentVersionId: string
  readonly page: number
  readonly section: string
  readonly excerpt: string
}

export interface KascoMandatoryCheckRecord {
  readonly checkCode: KascoMandatoryCheckCodeValue
  readonly label: string
  readonly description: string
  readonly kind: 'comparison' | 'presence'
  readonly validResults: readonly KascoCheckResultValue[]
  readonly status: KascoCheckDerivedStatusValue
  readonly reason: string
  readonly version: number
  readonly requiresHumanReview: boolean
  readonly aiSuggestedResult: KascoCheckResultValue | null
  readonly aiConfidenceBasisPoints: number | null
  readonly aiEvidence: KascoCheckEvidenceRecord | null
  readonly aiGeneratedAt: string | null
  readonly confirmedResult: KascoCheckResultValue | null
  readonly confirmedEvidence: KascoCheckEvidenceRecord | null
  readonly confirmedReason: string | null
  readonly confirmedByUserId: string | null
  readonly confirmedByDisplayName: string | null
  readonly confirmedAt: string | null
}

export interface KascoMandatoryCheckGateRecord {
  readonly caseId: string
  readonly applicable: boolean
  readonly ruleVersion: string
  readonly checks: readonly KascoMandatoryCheckRecord[]
  readonly missingCount: number
  readonly controlRequiredCount: number
  readonly needsReviewCount: number
  readonly resolvedCount: number
  readonly incomplete: boolean
  readonly permissions: { readonly canWrite: boolean }
}

export interface KascoMandatoryCheckHistoryItemRecord {
  readonly id: string
  readonly checkCode: KascoMandatoryCheckCodeValue
  readonly confirmedResult: KascoCheckResultValue
  readonly evidence: KascoCheckEvidenceRecord | null
  readonly reason: string | null
  readonly aiSuggestedResultAtTime: KascoCheckResultValue | null
  readonly previousConfirmedResult: KascoCheckResultValue | null
  readonly confirmedByUserId: string
  readonly confirmedByDisplayName: string
  readonly occurredAt: string
}

export interface KascoMandatoryCheckConfirmInput {
  readonly result: KascoCheckResultValue
  readonly evidence: KascoCheckEvidenceRecord | null
  readonly reason: string | null
  readonly expectedVersion: number
}

export interface KascoMandatoryCheckDataPort {
  loadGate(caseId: string): Promise<KascoMandatoryCheckGateRecord>
  loadHistory(caseId: string, checkCode: KascoMandatoryCheckCodeValue): Promise<readonly KascoMandatoryCheckHistoryItemRecord[]>
  confirmCheck(caseId: string, checkCode: KascoMandatoryCheckCodeValue, input: KascoMandatoryCheckConfirmInput): Promise<KascoMandatoryCheckRecord>
}

export type KascoMandatoryCheckErrorKind = 'unauthorized' | 'forbidden' | 'not_found' | 'validation' | 'conflict' | 'unavailable'

export class KascoMandatoryCheckError extends Error {
  readonly kind: KascoMandatoryCheckErrorKind

  constructor(kind: KascoMandatoryCheckErrorKind, message: string) {
    super(message)
    this.name = 'KascoMandatoryCheckError'
    this.kind = kind
  }
}

function mapError(status: number): KascoMandatoryCheckError {
  if (status === 401) return new KascoMandatoryCheckError('unauthorized', 'session required')
  if (status === 403) return new KascoMandatoryCheckError('forbidden', 'permission required')
  if (status === 404) return new KascoMandatoryCheckError('not_found', 'kasco mandatory check resource not found')
  if (status === 400) return new KascoMandatoryCheckError('validation', 'kasco mandatory check validation failed')
  if (status === 409) return new KascoMandatoryCheckError('conflict', 'kasco mandatory check conflict')
  return new KascoMandatoryCheckError('unavailable', `kasco mandatory check HTTP ${status}`)
}

export function createHttpKascoMandatoryCheckAdapter(options: {
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
} = {}): KascoMandatoryCheckDataPort {
  const baseUrl = options.baseUrl ?? ''
  const fetchImpl = options.fetchImpl ?? fetch

  const request = async (path: string, init?: RequestInit): Promise<unknown> => {
    let response: Response
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        credentials: 'include',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        ...init,
      })
    } catch {
      throw new KascoMandatoryCheckError('unavailable', 'kasco mandatory check endpoint unreachable')
    }
    if (!response.ok) throw mapError(response.status)
    try {
      return await response.json()
    } catch {
      throw new KascoMandatoryCheckError('unavailable', 'kasco mandatory check response invalid')
    }
  }

  return {
    async loadGate(caseId) {
      const value = await request(`/api/v1/cases/${encodeURIComponent(caseId)}/kasco-mandatory-checks`)
      const { kascoMandatoryCheckGateResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = kascoMandatoryCheckGateResponseSchema.safeParse(value)
      if (!parsed.success) throw new KascoMandatoryCheckError('unavailable', 'kasco mandatory check gate response invalid')
      return parsed.data.gate
    },
    async loadHistory(caseId, checkCode) {
      const value = await request(`/api/v1/cases/${encodeURIComponent(caseId)}/kasco-mandatory-checks/${encodeURIComponent(checkCode)}/history`)
      const { kascoMandatoryCheckHistoryResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = kascoMandatoryCheckHistoryResponseSchema.safeParse(value)
      if (!parsed.success) throw new KascoMandatoryCheckError('unavailable', 'kasco mandatory check history response invalid')
      return parsed.data.items
    },
    async confirmCheck(caseId, checkCode, input) {
      const value = await request(`/api/v1/cases/${encodeURIComponent(caseId)}/kasco-mandatory-checks/${encodeURIComponent(checkCode)}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      })
      const { kascoMandatoryCheckResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = kascoMandatoryCheckResponseSchema.safeParse(value)
      if (!parsed.success) throw new KascoMandatoryCheckError('unavailable', 'kasco mandatory check response invalid')
      return parsed.data.check
    },
  }
}
