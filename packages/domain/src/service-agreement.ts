export const SERVICE_TYPES = ['authorized', 'private', 'glass', 'mobile', 'other'] as const
export type ServiceType = (typeof SERVICE_TYPES)[number]

export const INSURER_SERVICE_AGREEMENT_STATUSES = ['active', 'inactive', 'pending', 'terminated'] as const
export type InsurerServiceAgreementStatus = (typeof INSURER_SERVICE_AGREEMENT_STATUSES)[number]

export const SERVICE_SUPPORTED_OPERATIONS = [
  'closure_documents',
  'deductible_assessment',
  'policy_assessment',
  'repair_authorization',
] as const
export type ServiceSupportedOperation = (typeof SERVICE_SUPPORTED_OPERATIONS)[number]

export const SERVICE_ELIGIBILITY_STATUSES = ['eligible', 'not_eligible', 'control_required'] as const
export type ServiceEligibilityStatus = (typeof SERVICE_ELIGIBILITY_STATUSES)[number]

export const SERVICE_AGREEMENT_EVALUATION_VERSION = '2026.07.14.1' as const

export interface InsurerServiceAgreementFact {
  readonly id: string
  readonly insurerId: string
  readonly status: InsurerServiceAgreementStatus
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
  readonly supportedOperations: readonly ServiceSupportedOperation[]
  readonly humanApproved: boolean
}

export interface ServiceEligibilityEvaluation {
  readonly status: ServiceEligibilityStatus
  readonly agreementStatus: 'agreed' | 'not_agreed' | 'control_required'
  readonly serviceType: ServiceType
  readonly operation: ServiceSupportedOperation
  readonly evaluationDate: string | null
  readonly dateSource: 'loss_date' | 'policy_date'
  readonly isAuthorized: boolean
  readonly isInsurerAgreed: boolean | null
  readonly reason: string
  readonly ruleVersion: typeof SERVICE_AGREEMENT_EVALUATION_VERSION
  readonly matchedAgreementIds: readonly string[]
  readonly requiresHumanReview: boolean
}

interface AgreementOutcome {
  readonly status: 'agreed' | 'not_agreed' | 'control_required'
  readonly matchedAgreementIds: readonly string[]
  readonly reason: string
}

function evaluateAgreement(input: {
  readonly insurerId: string | null
  readonly evaluationDate: string | null
  readonly operation: ServiceSupportedOperation
  readonly agreements: readonly InsurerServiceAgreementFact[]
}): AgreementOutcome {
  if (input.insurerId === null) {
    return { status: 'control_required', matchedAgreementIds: [], reason: 'Sigorta sirketi secilmedigi icin anlasma dogrulanamadi.' }
  }
  if (input.evaluationDate === null) {
    return { status: 'control_required', matchedAgreementIds: [], reason: 'Hasar veya police tarihi olmadigi icin tarihsel anlasma dogrulanamadi.' }
  }

  const insurerAgreements = input.agreements
    .filter((item) => item.insurerId === input.insurerId)
    .sort((left, right) => left.id.localeCompare(right.id))
  if (insurerAgreements.length === 0) {
    return { status: 'control_required', matchedAgreementIds: [], reason: 'Bu sigorta sirketi ve servis icin onayli bir anlasma kaydi bulunmuyor.' }
  }

  const effective = insurerAgreements.filter((item) =>
    item.effectiveFrom <= input.evaluationDate!
      && (item.effectiveTo === null || item.effectiveTo >= input.evaluationDate!),
  )
  if (effective.length === 0) {
    return { status: 'not_agreed', matchedAgreementIds: [], reason: 'Degerlendirme tarihinde gecerli bir anlasma bulunmuyor.' }
  }

  const uncertain = effective.filter((item) => item.status === 'pending' || !item.humanApproved)
  const eligible = effective.filter((item) =>
    item.status === 'active'
      && item.humanApproved
      && item.supportedOperations.includes(input.operation),
  )
  const explicitlyIneligible = effective.filter((item) =>
    item.status === 'inactive' || item.status === 'terminated'
      || (item.status === 'active' && item.humanApproved && !item.supportedOperations.includes(input.operation)),
  )

  if (uncertain.length > 0 || (eligible.length > 0 && explicitlyIneligible.length > 0)) {
    return {
      status: 'control_required',
      matchedAgreementIds: effective.map((item) => item.id),
      reason: 'Ayni tarih icin onay veya anlasma kayitlari kesin bir sonuc vermiyor.',
    }
  }
  if (eligible.length > 0) {
    return {
      status: 'agreed',
      matchedAgreementIds: eligible.map((item) => item.id),
      reason: 'Tarih, sigorta sirketi ve islem kapsami icin insan onayli aktif anlasma bulundu.',
    }
  }
  return {
    status: 'not_agreed',
    matchedAgreementIds: explicitlyIneligible.map((item) => item.id),
    reason: 'Gecerli kayit bu islem icin aktif ve onayli bir anlasma gostermiyor.',
  }
}

/** Database ve HTTP bagimliligi olmayan, tarih ve facts girdisi enjekte edilen servis uygunluk siniri. */
export function evaluateServiceEligibility(input: {
  readonly serviceType: ServiceType
  readonly insurerId: string | null
  readonly evaluationDate: string | null
  readonly dateSource: 'loss_date' | 'policy_date'
  readonly operation: ServiceSupportedOperation
  readonly agreements: readonly InsurerServiceAgreementFact[]
}): ServiceEligibilityEvaluation {
  const agreement = evaluateAgreement(input)
  const isAuthorized = input.serviceType === 'authorized'
  const status: ServiceEligibilityStatus = isAuthorized
    ? 'eligible'
    : agreement.status === 'agreed'
      ? 'eligible'
      : agreement.status === 'not_agreed'
        ? 'not_eligible'
        : 'control_required'
  return {
    status,
    agreementStatus: agreement.status,
    serviceType: input.serviceType,
    operation: input.operation,
    evaluationDate: input.evaluationDate,
    dateSource: input.dateSource,
    isAuthorized,
    isInsurerAgreed: agreement.status === 'control_required' ? null : agreement.status === 'agreed',
    reason: isAuthorized
      ? `Servis yetkili profildedir; anlasma durumu ayri degerlendirilir. ${agreement.reason}`
      : agreement.reason,
    ruleVersion: SERVICE_AGREEMENT_EVALUATION_VERSION,
    matchedAgreementIds: agreement.matchedAgreementIds,
    requiresHumanReview: agreement.status === 'control_required',
  }
}
