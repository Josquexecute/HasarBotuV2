import type pg from 'pg'
import {
  DASHBOARD_HUMAN_APPROVAL_KINDS,
  DASHBOARD_OPEN_STAGES,
  dashboardResponseSchema,
  type DashboardHumanApprovalKindDto,
  type DashboardResponse,
} from '@hasarbotu/contracts'
import {
  DASHBOARD_PRIORITY_VERSION,
  compareDashboardItems,
  evaluateDashboardPriority,
  evaluateDocumentRequirements,
  type CanonicalDocumentType,
  type DocumentMetadataStatus,
  type DocumentRequirementRuleSet,
} from '@hasarbotu/domain'
import { toLocalDateString } from '../cases/store.js'

interface DashboardCaseRow {
  id: string
  case_type: 'traffic' | 'casco'
  office_number: string
  plate: string
  workflow_stage: (typeof DASHBOARD_OPEN_STAGES)[number]
  responsible_user_id: string | null
  responsible_user_name: string | null
  insurer_name: string | null
  service_name: string | null
  follow_up_date: Date | null
  recourse_status: 'confirmed' | 'not_confirmed' | 'unknown'
  updated_at: Date
  version: number
}

interface DocumentRow {
  case_id: string
  id: string
  document_type: CanonicalDocumentType
  status: DocumentMetadataStatus
  hash_verified: boolean
  size_verified: boolean
  verified_at: Date | null
}

interface RuleRow {
  rule_set_id: string
  version: string
  effective_from: Date | string
  effective_to: Date | string | null
  case_type: 'traffic' | 'casco'
  status: 'active' | 'retired'
  source_reference: string
}

interface ApprovalRow {
  case_id: string
  kind: DashboardHumanApprovalKindDto
  item_count: number
}

interface OperationIssueRow {
  case_id: string
  issue: 'manual_recovery' | 'failed' | 'blocked'
  item_count: number
}

interface TaskSummaryRow {
  case_id: string
  open_task_count: number
  overdue_task_count: number
  due_today_task_count: number
  upcoming_task_count: number
}

function dateOnly(value: Date | string): string {
  return typeof value === 'string' ? value.slice(0, 10) : toLocalDateString(value)
}

function ruleFromRow(row: RuleRow): DocumentRequirementRuleSet {
  return {
    ruleSetId: row.rule_set_id,
    version: row.version,
    effectiveFrom: dateOnly(row.effective_from),
    effectiveTo: row.effective_to === null ? null : dateOnly(row.effective_to),
    caseType: row.case_type,
    status: row.status,
    sourceReference: row.source_reference,
  }
}

function pushMapValue<T>(map: Map<string, T[]>, key: string, value: T): void {
  const current = map.get(key)
  if (current === undefined) map.set(key, [value])
  else current.push(value)
}

export function createDashboardStore(pool: pg.Pool) {
  return {
    async read(
      organizationId: string,
      asOfDate: string,
      evaluatedAt: string,
    ): Promise<DashboardResponse> {
      const casesResult = await pool.query(
        `SELECT c.id,c.case_type,c.office_number,c.plate,c.workflow_stage,c.responsible_user_id,
                responsible.display_name AS responsible_user_name,insurer.name AS insurer_name,
                service.name AS service_name,c.follow_up_date,c.recourse_status,c.updated_at,c.version
         FROM cases c
         LEFT JOIN users responsible
           ON responsible.organization_id=c.organization_id AND responsible.id=c.responsible_user_id
         LEFT JOIN insurers insurer
           ON insurer.organization_id=c.organization_id AND insurer.id=c.insurer_id
         LEFT JOIN service_centers service
           ON service.organization_id=c.organization_id AND service.id=c.service_center_id
         WHERE c.organization_id=$1 AND c.lifecycle_status='open'
         ORDER BY c.office_year DESC,c.office_sequence DESC,c.id`,
        [organizationId],
      )
      const rows = casesResult.rows as DashboardCaseRow[]
      const caseIds = rows.map((row) => row.id)

      const documentsByCase = new Map<string, DocumentRow[]>()
      if (caseIds.length > 0) {
        const documentsResult = await pool.query(
          `SELECT d.case_id::text,dv.id,d.document_type,dv.status,dv.hash_verified,dv.size_verified,dv.verified_at
           FROM documents d
           JOIN document_versions dv ON dv.id=d.current_version_id
           WHERE d.organization_id=$1 AND d.case_id=ANY($2::uuid[])`,
          [organizationId, caseIds],
        )
        for (const document of documentsResult.rows as DocumentRow[]) {
          pushMapValue(documentsByCase, document.case_id, document)
        }
      }

      const rulesResult = await pool.query(
        `SELECT DISTINCT ON (rs.case_type)
                rs.id AS rule_set_id,rv.version,rv.effective_from,rv.effective_to,
                rs.case_type,rv.status,rv.source_reference
         FROM document_rule_sets rs
         JOIN document_rule_versions rv ON rv.rule_set_id=rs.id
         WHERE rs.status='active' AND rv.status='active'
           AND rv.effective_from <= $1::date
           AND (rv.effective_to IS NULL OR rv.effective_to >= $1::date)
         ORDER BY rs.case_type,rv.effective_from DESC,rv.version DESC`,
        [asOfDate],
      )
      const rules = new Map(
        (rulesResult.rows as RuleRow[]).map((row) => [row.case_type, ruleFromRow(row)]),
      )
      if (!rules.has('traffic') || !rules.has('casco')) {
        throw new Error('active_document_rule_version_not_found')
      }

      const approvalsByCase = new Map<string, ApprovalRow[]>()
      const operationIssuesByCase = new Map<string, OperationIssueRow[]>()
      const tasksByCase = new Map<string, TaskSummaryRow>()
      if (caseIds.length > 0) {
        const approvalsResult = await pool.query(
          `WITH pending AS (
             SELECT pa.case_id,'policy_analysis'::text AS kind,count(*)::int AS item_count
             FROM policy_analyses pa
             JOIN policy_analysis_versions pav ON pav.id=pa.current_version_id
             WHERE pa.organization_id=$1 AND pa.case_id=ANY($2::uuid[])
               AND pav.analysis_status='awaiting_approval' AND pav.human_approval_status='pending'
             GROUP BY pa.case_id
             UNION ALL
             SELECT assessment.case_id,'traffic_value_loss'::text,count(*)::int
             FROM traffic_value_loss_assessments assessment
             JOIN traffic_value_loss_versions version ON version.id=assessment.current_version_id
             WHERE assessment.organization_id=$1 AND assessment.case_id=ANY($2::uuid[])
               AND version.status='awaiting_approval' AND version.human_approval_status='pending'
             GROUP BY assessment.case_id
             UNION ALL
             SELECT operation.case_id,'case_lifecycle'::text,count(*)::int
             FROM case_lifecycle_operations operation
             WHERE operation.organization_id=$1 AND operation.case_id=ANY($2::uuid[])
               AND operation.status='approval_required'
             GROUP BY operation.case_id
             UNION ALL
             SELECT run.case_id,'policy_ai_review'::text,count(*)::int
             FROM ai_extraction_runs run
             JOIN ai_extraction_candidates candidate ON candidate.run_id=run.id
             WHERE run.organization_id=$1 AND run.case_id=ANY($2::uuid[])
               AND run.status='review_required'
               AND NOT EXISTS (
                 SELECT 1 FROM ai_candidate_reviews review
                 WHERE review.run_id=candidate.run_id AND review.candidate_id=candidate.candidate_id
               )
             GROUP BY run.case_id
           )
           SELECT case_id::text,kind,item_count FROM pending`,
          [organizationId, caseIds],
        )
        for (const approval of approvalsResult.rows as ApprovalRow[]) {
          pushMapValue(approvalsByCase, approval.case_id, approval)
        }

        const issuesResult = await pool.query(
          `WITH issues AS (
             SELECT provisioning.case_id,
                    CASE WHEN provisioning.status='failed' THEN 'failed' END::text AS issue,
                    count(*)::int AS item_count
             FROM case_workspace_provisionings provisioning
             WHERE provisioning.organization_id=$1 AND provisioning.case_id=ANY($2::uuid[])
               AND provisioning.status='failed'
             GROUP BY provisioning.case_id,issue
             UNION ALL
             SELECT operation.case_id,
                    CASE WHEN operation.status='manual_recovery_required' THEN 'manual_recovery'
                         WHEN operation.status IN ('cleanup_pending','failed') THEN 'failed' END::text,
                    count(*)::int
             FROM case_file_operations operation
             WHERE operation.organization_id=$1 AND operation.case_id=ANY($2::uuid[])
               AND operation.status IN ('manual_recovery_required','cleanup_pending','failed')
             GROUP BY operation.case_id,2
             UNION ALL
             SELECT operation.case_id,
                    CASE WHEN operation.status='manual_recovery_required' THEN 'manual_recovery'
                         WHEN operation.status IN ('cleanup_pending','failed') THEN 'failed'
                         WHEN operation.status='blocked' THEN 'blocked' END::text,
                    count(*)::int
             FROM case_lifecycle_operations operation
             WHERE operation.organization_id=$1 AND operation.case_id=ANY($2::uuid[])
               AND operation.status IN ('manual_recovery_required','cleanup_pending','failed','blocked')
             GROUP BY operation.case_id,2
           )
           SELECT case_id::text,issue,item_count FROM issues WHERE issue IS NOT NULL`,
          [organizationId, caseIds],
        )
        for (const issue of issuesResult.rows as OperationIssueRow[]) {
          pushMapValue(operationIssuesByCase, issue.case_id, issue)
        }

        const tasksResult = await pool.query(
          `SELECT case_id::text,
                  count(*)::int AS open_task_count,
                  count(*) FILTER (WHERE due_date<$3::date)::int AS overdue_task_count,
                  count(*) FILTER (WHERE due_date=$3::date)::int AS due_today_task_count,
                  count(*) FILTER (WHERE due_date>$3::date AND due_date<=$3::date+7)::int AS upcoming_task_count
           FROM case_tasks
           WHERE organization_id=$1 AND case_id=ANY($2::uuid[]) AND status='open'
           GROUP BY case_id`,
          [organizationId, caseIds, asOfDate],
        )
        for (const task of tasksResult.rows as TaskSummaryRow[]) tasksByCase.set(task.case_id, task)
      }

      const items = rows.map((row) => {
        const rule = rules.get(row.case_type)
        if (rule === undefined) throw new Error('active_document_rule_version_not_found')
        const evaluation = evaluateDocumentRequirements({
          caseType: row.case_type,
          recourseStatus: row.recourse_status,
          documents: (documentsByCase.get(row.id) ?? []).map((document) => ({
            id: document.id,
            canonicalDocumentType: document.document_type,
            status: document.status,
            hashVerified: document.hash_verified,
            sizeVerified: document.size_verified,
            verifiedAt: document.verified_at?.toISOString() ?? null,
          })),
        }, evaluatedAt, rule)
        const missingDocumentCount = evaluation.requirements.filter((item) => item.status === 'missing').length
        const controlRequiredDocumentCount = evaluation.requirements.filter((item) => item.status === 'control_required').length
        const approvals = approvalsByCase.get(row.id) ?? []
        const pendingHumanApprovalKinds = DASHBOARD_HUMAN_APPROVAL_KINDS.filter((kind) =>
          approvals.some((approval) => approval.kind === kind),
        )
        const pendingHumanApprovalCount = approvals.reduce((sum, approval) => sum + approval.item_count, 0)
        const operationIssues = operationIssuesByCase.get(row.id) ?? []
        const issueCount = (kind: OperationIssueRow['issue']) => operationIssues
          .filter((issue) => issue.issue === kind)
          .reduce((sum, issue) => sum + issue.item_count, 0)
        const manualRecoveryCount = issueCount('manual_recovery')
        const failedOperationCount = issueCount('failed')
        const blockedOperationCount = issueCount('blocked')
        const taskSummary = tasksByCase.get(row.id)
        const openTaskCount = taskSummary?.open_task_count ?? 0
        const overdueTaskCount = taskSummary?.overdue_task_count ?? 0
        const dueTodayTaskCount = taskSummary?.due_today_task_count ?? 0
        const upcomingTaskCount = taskSummary?.upcoming_task_count ?? 0
        const priority = evaluateDashboardPriority({
          caseId: row.id,
          officeCaseNumber: row.office_number,
          updatedAt: row.updated_at.toISOString(),
          followUpDate: row.follow_up_date === null ? null : toLocalDateString(row.follow_up_date),
          responsibleUserId: row.responsible_user_id,
          missingDocumentCount,
          controlRequiredDocumentCount,
          pendingHumanApprovalCount,
          manualRecoveryCount,
          failedOperationCount,
          blockedOperationCount,
          openTaskCount,
          overdueTaskCount,
          dueTodayTaskCount,
          upcomingTaskCount,
        }, asOfDate)

        return {
          caseId: row.id,
          caseType: row.case_type,
          officeCaseNumber: row.office_number,
          plate: row.plate,
          stage: row.workflow_stage,
          responsibleUserId: row.responsible_user_id,
          responsibleUserName: row.responsible_user_name,
          insurerName: row.insurer_name,
          serviceName: row.service_name,
          followUpDate: row.follow_up_date === null ? null : toLocalDateString(row.follow_up_date),
          updatedAt: row.updated_at.toISOString(),
          version: row.version,
          missingDocumentCount,
          controlRequiredDocumentCount,
          documentRuleVersion: rule.version,
          pendingHumanApprovalCount,
          pendingHumanApprovalKinds,
          manualRecoveryCount,
          failedOperationCount,
          blockedOperationCount,
          openTaskCount,
          overdueTaskCount,
          dueTodayTaskCount,
          upcomingTaskCount,
          ...priority,
        }
      }).sort(compareDashboardItems)

      const stageCounts = DASHBOARD_OPEN_STAGES.map((stage) => ({
        stage,
        count: items.filter((item) => item.stage === stage).length,
      }))
      const summary = {
        openCaseCount: items.length,
        overdueFollowUpCount: items.filter((item) => item.attentionCodes.includes('overdue_follow_up')).length,
        dueTodayCount: items.filter((item) => item.attentionCodes.includes('follow_up_today')).length,
        upcomingFollowUpCount: items.filter((item) => item.attentionCodes.includes('upcoming_follow_up')).length,
        openTaskCount: items.reduce((sum, item) => sum + item.openTaskCount, 0),
        overdueTaskCaseCount: items.filter((item) => item.overdueTaskCount > 0).length,
        taskDueTodayCaseCount: items.filter((item) => item.dueTodayTaskCount > 0).length,
        upcomingTaskCaseCount: items.filter((item) => item.upcomingTaskCount > 0).length,
        missingDocumentCaseCount: items.filter((item) => item.missingDocumentCount > 0).length,
        controlRequiredDocumentCaseCount: items.filter((item) => item.controlRequiredDocumentCount > 0).length,
        pendingHumanApprovalCaseCount: items.filter((item) => item.pendingHumanApprovalCount > 0).length,
        actionRequiredCaseCount: items.filter((item) => item.requiresAction).length,
        criticalCaseCount: items.filter((item) => item.priority === 'critical').length,
      }

      return dashboardResponseSchema.parse({
        asOfDate,
        evaluatedAt,
        priorityVersion: DASHBOARD_PRIORITY_VERSION,
        summary,
        stageCounts,
        items,
      })
    },
  }
}

export type DashboardStore = ReturnType<typeof createDashboardStore>
