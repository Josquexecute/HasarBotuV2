import type pg from 'pg'
import {
  operationalAlertsResponseSchema,
  type OperationalAlertsResponse,
} from '@hasarbotu/contracts'
import {
  OPERATIONAL_ALERT_SCHEMA_VERSION,
  collectOperationalAlerts,
  evaluateDocumentRequirements,
  type CanonicalDocumentType,
  type CaseTaskPriority,
  type DocumentMetadataStatus,
  type DocumentRequirementRuleSet,
  type MissingDocumentFact,
  type OverdueFollowUpFact,
  type OverdueTaskFact,
} from '@hasarbotu/domain'
import { toLocalDateString } from '../cases/store.js'

/**
 * Operasyonel uyarılar salt okunurdur: yeni tablo, kuyruk veya arka plan işçisi
 * yoktur. Uyarılar her istekte mevcut görev, takip ve evrak kuralı verisinden
 * deterministik türetilir; audit yazmaz ve serbest not/belge içeriği taşımaz.
 */

interface AlertCaseRow {
  id: string
  case_type: 'traffic' | 'casco'
  office_number: string
  plate: string
  follow_up_date: Date | null
  recourse_status: 'confirmed' | 'not_confirmed' | 'unknown'
}

interface TaskRow {
  id: string
  case_id: string
  title: string
  priority: CaseTaskPriority
  due_date: Date
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

export function createOperationalAlertStore(pool: pg.Pool) {
  return {
    async list(
      organizationId: string,
      asOfDate: string,
      evaluatedAt: string,
    ): Promise<OperationalAlertsResponse> {
      // Tenant sınırı: yalnız oturumun organization'ındaki açık dosyalar.
      const casesResult = await pool.query(
        `SELECT c.id::text,c.case_type,c.office_number,c.plate,c.follow_up_date,c.recourse_status
           FROM cases c
          WHERE c.organization_id=$1 AND c.lifecycle_status='open'
          ORDER BY c.office_year DESC,c.office_sequence DESC,c.id`,
        [organizationId],
      )
      const caseRows = casesResult.rows as AlertCaseRow[]
      const caseById = new Map(caseRows.map((row) => [row.id, row]))

      const overdueFollowUps: OverdueFollowUpFact[] = caseRows
        .filter((row) => row.follow_up_date !== null)
        .map((row) => ({
          caseId: row.id,
          plate: row.plate,
          officeNumber: row.office_number,
          followUpDate: toLocalDateString(row.follow_up_date as Date),
        }))

      const overdueTasks: OverdueTaskFact[] = []
      const missingDocuments: MissingDocumentFact[] = []

      if (caseRows.length > 0) {
        const tasksResult = await pool.query(
          `SELECT t.id::text,t.case_id::text,t.title,t.priority,t.due_date
             FROM case_tasks t
             JOIN cases c ON c.organization_id=t.organization_id AND c.id=t.case_id
                         AND c.lifecycle_status='open'
            WHERE t.organization_id=$1
              AND t.status='open' AND t.due_date<$2::date
            ORDER BY t.due_date,t.id`,
          [organizationId, asOfDate],
        )
        for (const row of tasksResult.rows as TaskRow[]) {
          const caseRow = caseById.get(row.case_id)
          if (caseRow === undefined) continue
          overdueTasks.push({
            caseId: row.case_id,
            plate: caseRow.plate,
            officeNumber: caseRow.office_number,
            taskId: row.id,
            title: row.title,
            priority: row.priority,
            dueDate: toLocalDateString(row.due_date),
          })
        }

        // Kapsam `cases` ile join'lenerek daraltılır: aynı küme (bu organization'ın
        // açık dosyaları), ancak binlerce UUID'lik dizi parametresi taşınmaz.
        const documentsResult = await pool.query(
          `SELECT d.case_id::text,dv.id,d.document_type,dv.status,dv.hash_verified,
                  dv.size_verified,dv.verified_at
             FROM documents d
             JOIN cases c ON c.organization_id=d.organization_id AND c.id=d.case_id
                         AND c.lifecycle_status='open'
             JOIN document_versions dv ON dv.id=d.current_version_id
            WHERE d.organization_id=$1`,
          [organizationId],
        )
        const documentsByCase = new Map<string, DocumentRow[]>()
        for (const document of documentsResult.rows as DocumentRow[]) {
          const current = documentsByCase.get(document.case_id)
          if (current === undefined) documentsByCase.set(document.case_id, [document])
          else current.push(document)
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

        for (const caseRow of caseRows) {
          const rule = rules.get(caseRow.case_type)
          if (rule === undefined) throw new Error('active_document_rule_version_not_found')
          const evaluation = evaluateDocumentRequirements({
            caseType: caseRow.case_type,
            recourseStatus: caseRow.recourse_status,
            documents: (documentsByCase.get(caseRow.id) ?? []).map((document) => ({
              id: document.id,
              canonicalDocumentType: document.document_type,
              status: document.status,
              hashVerified: document.hash_verified,
              sizeVerified: document.size_verified,
              verifiedAt: document.verified_at?.toISOString() ?? null,
            })),
          }, evaluatedAt, rule)
          for (const requirement of evaluation.requirements) {
            if (requirement.status !== 'missing') continue
            missingDocuments.push({
              caseId: caseRow.id,
              plate: caseRow.plate,
              officeNumber: caseRow.office_number,
              requirementCode: requirement.requirementCode,
              evaluatedDate: asOfDate,
            })
          }
        }
      }

      const alerts = collectOperationalAlerts(
        { overdueTasks, overdueFollowUps, missingDocuments },
        asOfDate,
      )
      return operationalAlertsResponseSchema.parse({
        schemaVersion: OPERATIONAL_ALERT_SCHEMA_VERSION,
        totalCount: alerts.length,
        evaluatedAt,
        alerts,
      })
    },
  }
}

export type OperationalAlertStore = ReturnType<typeof createOperationalAlertStore>
