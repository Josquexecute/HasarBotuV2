import type { CaseType } from './case-type.js'
import type { TrafficValueLossEligibilityStatus, TrafficValueLossStatus } from './traffic-value-loss.js'

export const TRAFFIC_VALUE_LOSS_CLOSURE_RULE_VERSION = 'traffic-value-loss-closure/1.0.0' as const
export const TRAFFIC_VALUE_LOSS_CLOSURE_STATUSES = ['present', 'control_required', 'not_applicable'] as const
export type TrafficValueLossClosureStatus = (typeof TRAFFIC_VALUE_LOSS_CLOSURE_STATUSES)[number]

export interface TrafficValueLossClosureAssessmentFact {
  readonly assessmentId: string
  readonly assessmentVersionId: string
  readonly assessmentVersion: number
  readonly status: TrafficValueLossStatus
  readonly humanApprovalStatus: 'pending' | 'approved' | 'rejected'
  readonly calculationRuleVersion: string
  readonly resultCode: TrafficValueLossEligibilityStatus
  readonly amountMinor: number | null
}

export interface TrafficValueLossClosureReportFact {
  readonly reportId: string
  readonly assessmentVersionId: string
  readonly ruleVersion: string
  readonly generatedAt: string
}

export interface TrafficValueLossClosureEvaluation {
  readonly status: TrafficValueLossClosureStatus
  readonly reason: string
  readonly ruleVersion: typeof TRAFFIC_VALUE_LOSS_CLOSURE_RULE_VERSION
  readonly requiresHumanReview: boolean
  readonly assessmentId: string | null
  readonly assessmentVersionId: string | null
  readonly assessmentVersion: number | null
  readonly assessmentStatus: TrafficValueLossStatus | null
  readonly humanApprovalStatus: 'pending' | 'approved' | 'rejected' | null
  readonly calculationRuleVersion: string | null
  readonly resultCode: TrafficValueLossEligibilityStatus | null
  readonly amountMinor: number | null
  readonly reportId: string | null
  readonly reportGeneratedAt: string | null
}

function controlRequired(
  reason: string,
  assessment: TrafficValueLossClosureAssessmentFact | null,
  report: TrafficValueLossClosureReportFact | null,
): TrafficValueLossClosureEvaluation {
  return {
    status: 'control_required',
    reason,
    ruleVersion: TRAFFIC_VALUE_LOSS_CLOSURE_RULE_VERSION,
    requiresHumanReview: true,
    assessmentId: assessment?.assessmentId ?? null,
    assessmentVersionId: assessment?.assessmentVersionId ?? null,
    assessmentVersion: assessment?.assessmentVersion ?? null,
    assessmentStatus: assessment?.status ?? null,
    humanApprovalStatus: assessment?.humanApprovalStatus ?? null,
    calculationRuleVersion: assessment?.calculationRuleVersion ?? null,
    resultCode: assessment?.resultCode ?? null,
    amountMinor: assessment?.amountMinor ?? null,
    reportId: report?.reportId ?? null,
    reportGeneratedAt: report?.generatedAt ?? null,
  }
}

/** Kapanışta yalnız güncel, insan onaylı ve nihai raporu üretilmiş Trafik sonucunu mevcut sayar. */
export function evaluateTrafficValueLossClosure(input: {
  readonly caseType: CaseType
  readonly assessment: TrafficValueLossClosureAssessmentFact | null
  readonly report: TrafficValueLossClosureReportFact | null
}): TrafficValueLossClosureEvaluation {
  if (input.caseType === 'casco') {
    return {
      status: 'not_applicable',
      reason: 'Kasko dosyasında Trafik değer kaybı kapanış özeti uygulanmaz.',
      ruleVersion: TRAFFIC_VALUE_LOSS_CLOSURE_RULE_VERSION,
      requiresHumanReview: false,
      assessmentId: null,
      assessmentVersionId: null,
      assessmentVersion: null,
      assessmentStatus: null,
      humanApprovalStatus: null,
      calculationRuleVersion: null,
      resultCode: null,
      amountMinor: null,
      reportId: null,
      reportGeneratedAt: null,
    }
  }
  if (input.assessment === null) {
    return controlRequired('Trafik değer kaybı çalışması bulunamadı.', null, null)
  }
  if (input.assessment.status !== 'approved' || input.assessment.humanApprovalStatus !== 'approved') {
    return controlRequired('Güncel değer kaybı sürümü insan onaylı değildir.', input.assessment, input.report)
  }
  if (input.assessment.resultCode === 'control_required') {
    return controlRequired('Onaylı sürüm hâlâ kontrol gerektiren bir sonuç taşıyor.', input.assessment, input.report)
  }
  if (input.assessment.resultCode === 'calculable' && input.assessment.amountMinor === null) {
    return controlRequired('Hesaplanabilir sonuç için doğrulanmış minor-unit tutar bulunamadı.', input.assessment, input.report)
  }
  if (input.report === null) {
    return controlRequired('Onaylı değer kaybı sürümüne ait nihai rapor bulunamadı.', input.assessment, null)
  }
  if (input.report.assessmentVersionId !== input.assessment.assessmentVersionId) {
    return controlRequired('Nihai rapor güncel değer kaybı sürümüne ait değildir.', input.assessment, input.report)
  }
  if (input.report.ruleVersion !== input.assessment.calculationRuleVersion) {
    return controlRequired('Nihai rapor ile hesaplama kural sürümü uyuşmuyor.', input.assessment, input.report)
  }
  return {
    status: 'present',
    reason: 'Güncel insan onaylı değer kaybı sonucu ve aynı sürüme ait nihai rapor bulundu.',
    ruleVersion: TRAFFIC_VALUE_LOSS_CLOSURE_RULE_VERSION,
    requiresHumanReview: false,
    assessmentId: input.assessment.assessmentId,
    assessmentVersionId: input.assessment.assessmentVersionId,
    assessmentVersion: input.assessment.assessmentVersion,
    assessmentStatus: input.assessment.status,
    humanApprovalStatus: input.assessment.humanApprovalStatus,
    calculationRuleVersion: input.assessment.calculationRuleVersion,
    resultCode: input.assessment.resultCode,
    amountMinor: input.assessment.amountMinor,
    reportId: input.report.reportId,
    reportGeneratedAt: input.report.generatedAt,
  }
}
