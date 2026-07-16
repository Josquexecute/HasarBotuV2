import type { LocalDate, UtcDateTime } from './temporal.js'
import type {
  TrafficValueLossDamagePart,
  TrafficValueLossEligibilityStatus,
  TrafficValueLossEvidenceField,
  TrafficValueLossEvidenceSourceType,
  TrafficValueLossRuleSource,
  TrafficValueLossStatus,
  TrafficValueLossUncertainty,
} from './traffic-value-loss.js'

export const TRAFFIC_VALUE_LOSS_REPORT_SCHEMA_VERSION = 'traffic-value-loss-final-report/1.0.0' as const
export const TRAFFIC_VALUE_LOSS_REPORT_TEMPLATE_VERSION = 'traffic-value-loss-final-report-tr/1.0.0' as const
export const TRAFFIC_VALUE_LOSS_REPORT_TITLE = 'Trafik Değer Kaybı Nihai Raporu' as const
export const MAX_TRAFFIC_VALUE_LOSS_REPORT_NOTE_LENGTH = 500

export interface TrafficValueLossReportEvidence {
  readonly id: string
  readonly evidenceKey: string
  readonly sourceType: TrafficValueLossEvidenceSourceType
  readonly documentId: string | null
  readonly documentVersionId: string | null
  readonly externalReference: string | null
  readonly sourceHash: string
  readonly observedAt: LocalDate | null
  readonly supports: readonly TrafficValueLossEvidenceField[]
  readonly verificationStatus: 'verified' | 'control_required'
  readonly conflict: boolean
  readonly notes: string | null
}

export interface TrafficValueLossReportComparable {
  readonly id: string
  readonly comparableKey: string
  readonly side: 'pre_accident' | 'post_repair'
  readonly amountMinor: number
  readonly mileage: number | null
  readonly observedAt: LocalDate
  readonly evidenceId: string
  readonly evidenceKey: string
  readonly sourceReference: string | null
  readonly excluded: boolean
  readonly exclusionReason: string | null
}

export interface TrafficValueLossReportContent {
  readonly schemaVersion: typeof TRAFFIC_VALUE_LOSS_REPORT_SCHEMA_VERSION
  readonly templateVersion: typeof TRAFFIC_VALUE_LOSS_REPORT_TEMPLATE_VERSION
  readonly title: typeof TRAFFIC_VALUE_LOSS_REPORT_TITLE
  readonly caseReference: {
    readonly caseId: string
    readonly officeNumber: string
    readonly plate: string
    readonly caseType: 'traffic'
    readonly lossDate: LocalDate | null
    readonly notificationDate: LocalDate | null
  }
  readonly assessment: {
    readonly assessmentId: string
    readonly versionId: string
    readonly assessmentVersion: number
    readonly status: 'approved' | 'superseded'
    readonly humanApprovalStatus: 'approved'
    readonly approvedBy: string
    readonly approvedAt: UtcDateTime
    readonly approvalReason: string | null
  }
  readonly vehicle: {
    readonly make: string | null
    readonly model: string | null
    readonly variant: string | null
    readonly modelYear: number | null
    readonly mileage: number | null
    readonly usageType: string | null
  }
  readonly damageParts: readonly TrafficValueLossDamagePart[]
  readonly calculation: {
    readonly eligibilityStatus: TrafficValueLossEligibilityStatus
    readonly calculationMethod: 'market_value_difference'
    readonly roundingRule: 'half_up_minor_unit'
    readonly preAccidentMarketValueMinor: number | null
    readonly postRepairMarketValueMinor: number | null
    readonly grossValueLossMinor: number | null
    readonly faultRateBasisPoints: number | null
    readonly faultAdjustedValueLossMinor: number | null
    readonly qualifyingPreComparableCount: number
    readonly qualifyingPostComparableCount: number
    readonly reasoning: readonly string[]
  }
  readonly evidence: readonly TrafficValueLossReportEvidence[]
  readonly comparables: readonly TrafficValueLossReportComparable[]
  readonly uncertainties: readonly TrafficValueLossUncertainty[]
  readonly rule: {
    readonly ruleSetId: string
    readonly ruleVersion: string
    readonly effectiveFrom: LocalDate
    readonly sources: readonly TrafficValueLossRuleSource[]
  }
  readonly reportNote: string | null
}

export interface TrafficValueLossReportSource {
  readonly caseReference: TrafficValueLossReportContent['caseReference']
  readonly assessmentId: string
  readonly version: {
    readonly id: string
    readonly assessmentVersion: number
    readonly status: TrafficValueLossStatus
    readonly humanApprovalStatus: 'pending' | 'approved' | 'rejected'
    readonly approvedBy: string | null
    readonly approvedAt: UtcDateTime | null
    readonly approvalReason: string | null
    readonly input: {
      readonly vehicle: TrafficValueLossReportContent['vehicle']
      readonly faultRateBasisPoints: number | null
      readonly preAccidentMarketValueMinor: number | null
      readonly postRepairMarketValueMinor: number | null
      readonly damageParts: readonly TrafficValueLossDamagePart[]
    }
    readonly evaluation: {
      readonly eligibilityStatus: TrafficValueLossEligibilityStatus
      readonly calculationMethod: 'market_value_difference'
      readonly roundingRule: 'half_up_minor_unit'
      readonly grossValueLossMinor: number | null
      readonly faultAdjustedValueLossMinor: number | null
      readonly qualifyingPreComparableCount: number
      readonly qualifyingPostComparableCount: number
      readonly reasoning: readonly string[]
      readonly uncertainties: readonly TrafficValueLossUncertainty[]
      readonly ruleSetId: string
      readonly ruleVersion: string
      readonly effectiveFrom: LocalDate
      readonly ruleSources: readonly TrafficValueLossRuleSource[]
    }
    readonly evidence: readonly TrafficValueLossReportEvidence[]
    readonly comparables: readonly Omit<TrafficValueLossReportComparable, 'evidenceKey' | 'sourceReference'>[]
  }
}

export type TrafficValueLossReportBuildError =
  | 'REPORT_SOURCE_NOT_APPROVED'
  | 'REPORT_APPROVAL_FACTS_MISSING'
  | 'REPORT_NOTE_INVALID'
  | 'REPORT_COMPARABLE_SOURCE_MISSING'
  | 'REPORT_UNSAFE_CONTENT'

export type TrafficValueLossReportBuildResult =
  | { readonly ok: true; readonly content: TrafficValueLossReportContent }
  | { readonly ok: false; readonly error: TrafficValueLossReportBuildError }

function normalizedNote(value: string | null): string | null | undefined {
  if (value === null) return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_TRAFFIC_VALUE_LOSS_REPORT_NOTE_LENGTH) return undefined
  return trimmed
}

export function buildTrafficValueLossReportContent(
  source: TrafficValueLossReportSource,
  reportNote: string | null,
): TrafficValueLossReportBuildResult {
  const version = source.version
  if (!['approved', 'superseded'].includes(version.status) || version.humanApprovalStatus !== 'approved') {
    return { ok: false, error: 'REPORT_SOURCE_NOT_APPROVED' }
  }
  const reportStatus: 'approved' | 'superseded' = version.status === 'approved' ? 'approved' : 'superseded'
  if (version.approvedBy === null || version.approvedAt === null) {
    return { ok: false, error: 'REPORT_APPROVAL_FACTS_MISSING' }
  }
  const note = normalizedNote(reportNote)
  if (note === undefined) return { ok: false, error: 'REPORT_NOTE_INVALID' }

  const evidence = [...version.evidence]
    .map((item) => ({
      id: item.id,
      evidenceKey: item.evidenceKey,
      sourceType: item.sourceType,
      documentId: item.documentId,
      documentVersionId: item.documentVersionId,
      externalReference: item.externalReference,
      sourceHash: item.sourceHash,
      observedAt: item.observedAt,
      supports: [...item.supports].sort(),
      verificationStatus: item.verificationStatus,
      conflict: item.conflict,
      notes: item.notes,
    }))
    .sort((left, right) => left.evidenceKey.localeCompare(right.evidenceKey) || left.id.localeCompare(right.id))
  const evidenceById = new Map(evidence.map((item) => [item.id, item]))
  const comparables: TrafficValueLossReportComparable[] = []
  for (const item of version.comparables) {
    const linkedEvidence = evidenceById.get(item.evidenceId)
    if (linkedEvidence === undefined) return { ok: false, error: 'REPORT_COMPARABLE_SOURCE_MISSING' }
    comparables.push({
      ...item,
      evidenceKey: linkedEvidence.evidenceKey,
      sourceReference: linkedEvidence.externalReference,
    })
  }
  comparables.sort((left, right) =>
    left.side.localeCompare(right.side)
    || left.comparableKey.localeCompare(right.comparableKey)
    || left.id.localeCompare(right.id))

  const content: TrafficValueLossReportContent = {
    schemaVersion: TRAFFIC_VALUE_LOSS_REPORT_SCHEMA_VERSION,
    templateVersion: TRAFFIC_VALUE_LOSS_REPORT_TEMPLATE_VERSION,
    title: TRAFFIC_VALUE_LOSS_REPORT_TITLE,
    caseReference: source.caseReference,
    assessment: {
      assessmentId: source.assessmentId,
      versionId: version.id,
      assessmentVersion: version.assessmentVersion,
      status: reportStatus,
      humanApprovalStatus: 'approved',
      approvedBy: version.approvedBy,
      approvedAt: version.approvedAt,
      approvalReason: version.approvalReason,
    },
    vehicle: version.input.vehicle,
    damageParts: version.input.damageParts.map((item) => ({ ...item })),
    calculation: {
      eligibilityStatus: version.evaluation.eligibilityStatus,
      calculationMethod: version.evaluation.calculationMethod,
      roundingRule: version.evaluation.roundingRule,
      preAccidentMarketValueMinor: version.input.preAccidentMarketValueMinor,
      postRepairMarketValueMinor: version.input.postRepairMarketValueMinor,
      grossValueLossMinor: version.evaluation.grossValueLossMinor,
      faultRateBasisPoints: version.input.faultRateBasisPoints,
      faultAdjustedValueLossMinor: version.evaluation.faultAdjustedValueLossMinor,
      qualifyingPreComparableCount: version.evaluation.qualifyingPreComparableCount,
      qualifyingPostComparableCount: version.evaluation.qualifyingPostComparableCount,
      reasoning: [...version.evaluation.reasoning],
    },
    evidence,
    comparables,
    uncertainties: [...version.evaluation.uncertainties]
      .sort((left, right) => left.code.localeCompare(right.code) || left.field.localeCompare(right.field)),
    rule: {
      ruleSetId: version.evaluation.ruleSetId,
      ruleVersion: version.evaluation.ruleVersion,
      effectiveFrom: version.evaluation.effectiveFrom,
      sources: [...version.evaluation.ruleSources]
        .sort((left, right) => left.code.localeCompare(right.code)),
    },
    reportNote: note,
  }
  if (/(?:^|[\s"'(])[A-Za-z]:[\\/]|\\\\/.test(JSON.stringify(content))) {
    return { ok: false, error: 'REPORT_UNSAFE_CONTENT' }
  }
  return {
    ok: true,
    content,
  }
}

export function canonicalizeTrafficValueLossReportContent(content: TrafficValueLossReportContent): string {
  return JSON.stringify(content)
}
