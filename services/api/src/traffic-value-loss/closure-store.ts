import type pg from 'pg'
import {
  trafficValueLossClosureListResponseSchema,
  trafficValueLossClosureSummarySchema,
  type TrafficValueLossClosureListResponse,
  type TrafficValueLossClosureSummaryDto,
} from '@hasarbotu/contracts'
import {
  evaluateTrafficValueLossClosure,
  type CaseType,
  type TrafficValueLossClosureAssessmentFact,
  type TrafficValueLossClosureReportFact,
} from '@hasarbotu/domain'
import type { Queryable } from '../db/executor.js'

interface CaseKey {
  readonly caseId: string
  readonly caseType: CaseType
}

interface ClosureFactRow {
  case_id: string
  assessment_id: string
  assessment_version_id: string
  assessment_version: number
  assessment_status: TrafficValueLossClosureAssessmentFact['status']
  human_approval_status: TrafficValueLossClosureAssessmentFact['humanApprovalStatus']
  calculation_rule_version: string
  result_code: TrafficValueLossClosureAssessmentFact['resultCode']
  result_snapshot: { finalResultMinor?: unknown; faultAdjustedValueLossMinor?: unknown }
  report_id: string | null
  report_assessment_version_id: string | null
  report_rule_version: string | null
  report_generated_at: Date | null
}

function amountMinor(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const amount = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null
}

export async function loadTrafficValueLossClosureSummaries(
  exec: Queryable,
  organizationId: string,
  cases: readonly CaseKey[],
): Promise<ReadonlyMap<string, TrafficValueLossClosureSummaryDto>> {
  if (cases.length === 0) return new Map()
  const ids = cases.map((item) => item.caseId)
  const result = await exec.query(
    `SELECT a.case_id,a.id AS assessment_id,v.id AS assessment_version_id,
            v.assessment_version,v.status AS assessment_status,v.human_approval_status,
            v.rule_version AS calculation_rule_version,v.result_code,v.result_snapshot,
            report.id AS report_id,report.assessment_version_id AS report_assessment_version_id,
            report.rule_version AS report_rule_version,report.generated_at AS report_generated_at
     FROM traffic_value_loss_assessments a
     JOIN traffic_value_loss_versions v
       ON v.assessment_id=a.id
      AND v.organization_id=a.organization_id
      AND v.case_id=a.case_id
      AND v.status='approved'
      AND v.human_approval_status='approved'
      AND v.is_active=true
     LEFT JOIN traffic_value_loss_reports report ON report.assessment_version_id=v.id
     WHERE a.organization_id=$1 AND a.case_id=ANY($2::uuid[])`,
    [organizationId, ids],
  )
  const facts = new Map((result.rows as ClosureFactRow[]).map((row) => [row.case_id, row]))
  const summaries = new Map<string, TrafficValueLossClosureSummaryDto>()
  for (const item of cases) {
    const row = facts.get(item.caseId)
    const assessment: TrafficValueLossClosureAssessmentFact | null = row === undefined ? null : {
      assessmentId: row.assessment_id,
      assessmentVersionId: row.assessment_version_id,
      assessmentVersion: row.assessment_version,
      status: row.assessment_status,
      humanApprovalStatus: row.human_approval_status,
      calculationRuleVersion: row.calculation_rule_version,
      resultCode: row.result_code,
      amountMinor: amountMinor(
        row.result_snapshot.finalResultMinor ?? row.result_snapshot.faultAdjustedValueLossMinor,
      ),
    }
    const report: TrafficValueLossClosureReportFact | null =
      row?.report_id === null || row?.report_id === undefined
        || row.report_assessment_version_id === null
        || row.report_rule_version === null
        || row.report_generated_at === null
        ? null
        : {
            reportId: row.report_id,
            assessmentVersionId: row.report_assessment_version_id,
            ruleVersion: row.report_rule_version,
            generatedAt: row.report_generated_at.toISOString(),
          }
    summaries.set(item.caseId, trafficValueLossClosureSummarySchema.parse(
      evaluateTrafficValueLossClosure({ caseType: item.caseType, assessment, report }),
    ))
  }
  return summaries
}

export function createTrafficValueLossClosureStore(pool: pg.Pool) {
  return {
    async list(organizationId: string): Promise<TrafficValueLossClosureListResponse> {
      const result = await pool.query(
        `SELECT c.id,c.office_number,c.plate,c.case_type,c.closed_at,
                history.closure_mode,history.user_reason
         FROM cases c
         LEFT JOIN LATERAL (
           SELECT closure_mode,user_reason
           FROM case_lifecycle_history
           WHERE organization_id=c.organization_id AND case_id=c.id AND operation_type='close'
           ORDER BY occurred_at DESC,id DESC
           LIMIT 1
         ) history ON true
         WHERE c.organization_id=$1 AND c.lifecycle_status='closed' AND c.closed_at IS NOT NULL
         ORDER BY c.closed_at DESC,c.id`,
        [organizationId],
      )
      const rows = result.rows as Array<{
        id: string
        office_number: string
        plate: string
        case_type: CaseType
        closed_at: Date
        closure_mode: 'normal' | 'with_missing_requirements' | null
        user_reason: string | null
      }>
      const summaries = await loadTrafficValueLossClosureSummaries(
        pool,
        organizationId,
        rows.map((row) => ({ caseId: row.id, caseType: row.case_type })),
      )
      return trafficValueLossClosureListResponseSchema.parse({
        items: rows.map((row) => ({
          caseId: row.id,
          officeCaseNumber: row.office_number,
          plate: row.plate,
          caseType: row.case_type,
          closedAt: row.closed_at.toISOString(),
          closureMode: row.closure_mode,
          closureReason: row.user_reason,
          summary: summaries.get(row.id),
        })),
      })
    },
  }
}

export type TrafficValueLossClosureStore = ReturnType<typeof createTrafficValueLossClosureStore>
