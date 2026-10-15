import type pg from 'pg'
import { createHash } from 'node:crypto'
import {
  operationalAlertsResponseSchema,
  type OperationalAlertsResponse,
} from '@hasarbotu/contracts'
import {
  OPERATIONAL_ALERT_SCHEMA_VERSION,
  buildOperationalAlerts,
  summarizeOperationalAlertsByCase,
  MAX_OPERATIONAL_ALERTS,
  evaluateDocumentRequirements,
  type CanonicalDocumentType,
  type CaseTaskPriority,
  type DocumentMetadataStatus,
  type MissingDocumentFact,
  type OverdueFollowUpFact,
  type OverdueTaskFact,
} from '@hasarbotu/domain'
import { toLocalDateString } from '../cases/store.js'
import { loadDocumentRequirementRules } from '../document-requirements/rules.js'

/**
 * Uyarılar kaynak veriden türetilir; kişisel okuma onayı kaynakları değiştirmez.
 * İçerik/tarih değiştiğinde parmak izi değişir ve uyarı yeniden okunmamış olur.
 */

interface AlertCaseRow {
  id: string
  case_type: 'traffic' | 'casco' | null
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

export function createOperationalAlertStore(pool: pg.Pool) {
    async function evaluate(
      organizationId: string,
      asOfDate: string,
      evaluatedAt: string,
      caseIdFilter?: readonly string[],
      responsibleUserId?: string,
      readMode: 'all' | 'unread' | 'mark_all_read' = 'all',
    ): Promise<OperationalAlertsResponse> {
      // Tenant sınırı: yalnız oturumun organization'ındaki açık dosyalar.
      // İstemciden gelen `caseIdFilter` kapsamı YALNIZ DARALTIR; erişim kararı
      // her zaman sunucudaki organization koşuluyla verilir.
      const filtered = caseIdFilter !== undefined || responsibleUserId !== undefined
      const casesResult = await pool.query(
        `SELECT c.id::text,c.case_type,c.office_number,c.plate,c.follow_up_date,c.recourse_status
           FROM cases c WHERE c.organization_id=$1 AND c.lifecycle_status='open' AND NOT c.is_archived
           AND ($2::uuid[] IS NULL OR c.id=ANY($2::uuid[]))
           AND ($3::uuid IS NULL OR c.responsible_user_id=$3)
           ORDER BY c.office_year DESC,c.office_sequence DESC,c.id`,
        [organizationId,caseIdFilter === undefined ? null : [...caseIdFilter],responsibleUserId ?? null],
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
        // Filtresiz çağrıda kapsam `cases` join'iyle daraltılır (Paket 51: hacimle
        // büyüyen dizi parametresi yok). Filtreli çağrıda kimlik sayısı sözleşme
        // ile sınırlı olduğundan sunucuda çözülmüş kimlikler doğrudan kullanılır.
        const scopedCaseIds = caseRows.map((row) => row.id)
        const tasksResult = await pool.query(
          filtered
            ? `SELECT t.id::text,t.case_id::text,t.title,t.priority,t.due_date
                 FROM case_tasks t
                WHERE t.organization_id=$1 AND t.case_id=ANY($3::uuid[])
                  AND t.status='open' AND t.due_date<$2::date
                ORDER BY t.due_date,t.id`
            : `SELECT t.id::text,t.case_id::text,t.title,t.priority,t.due_date
                 FROM case_tasks t
                 JOIN cases c ON c.organization_id=t.organization_id AND c.id=t.case_id
                             AND c.lifecycle_status='open'
                WHERE t.organization_id=$1
                  AND t.status='open' AND t.due_date<$2::date
                ORDER BY t.due_date,t.id`,
          filtered ? [organizationId, asOfDate, scopedCaseIds] : [organizationId, asOfDate],
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

        const documentsResult = await pool.query(
          filtered
            ? `SELECT d.case_id::text,d.id,d.document_type,d.status,d.hash_verified,
                      d.size_verified,d.verified_at
                 FROM tracking_requirement_documents d
                WHERE d.organization_id=$1 AND d.case_id=ANY($2::uuid[])`
            : `SELECT d.case_id::text,d.id,d.document_type,d.status,d.hash_verified,
                      d.size_verified,d.verified_at
                 FROM tracking_requirement_documents d
                 JOIN cases c ON c.organization_id=d.organization_id AND c.id=d.case_id
                             AND c.lifecycle_status='open'
                WHERE d.organization_id=$1`,
          filtered ? [organizationId, scopedCaseIds] : [organizationId],
        )
        const documentsByCase = new Map<string, DocumentRow[]>()
        for (const document of documentsResult.rows as DocumentRow[]) {
          const current = documentsByCase.get(document.case_id)
          if (current === undefined) documentsByCase.set(document.case_id, [document])
          else current.push(document)
        }

        const rules = await loadDocumentRequirementRules(pool,organizationId,asOfDate)
        if (!rules.has('traffic') || !rules.has('casco')) {
          throw new Error('active_document_rule_version_not_found')
        }

        for (const caseRow of caseRows) {
          if (caseRow.case_type === null) continue
          const rule = rules.get(caseRow.case_type)?.rule
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

      // Dosya başına özet KIRPILMAMIŞ listeden hesaplanır: 200 sınırı görünür
      // satırlar arasında yanlış negatif üretemez. Erişilemeyen (tenant dışı,
      // kapalı veya olmayan) kimlik özete hiç girmez; istemci bunu "bilinmiyor"
      // olarak gösterir, "uyarı yok" olarak değil.
      let full = buildOperationalAlerts({ overdueTasks, overdueFollowUps, missingDocuments }, asOfDate)
      if (readMode !== 'all') {
        if (!responsibleUserId) throw new Error('alert_read_user_required')
        const fingerprint = (alert: typeof full[number]) => createHash('sha256')
          .update(JSON.stringify([alert.dedupeKey, alert.severity, alert.summary, alert.sourceDate])).digest('hex')
        if (readMode === 'mark_all_read') {
          // Acknowledge the FULL server snapshot, including alerts beyond the 200-row display limit.
          await pool.query(`INSERT INTO operational_alert_reads (organization_id,user_id,case_id,dedupe_key,fingerprint,read_at)
            SELECT $1,$2,x.case_id,x.dedupe_key,x.fingerprint,$4::timestamptz
            FROM jsonb_to_recordset($3::jsonb) AS x(case_id uuid,dedupe_key text,fingerprint text)
            ON CONFLICT (organization_id,user_id,dedupe_key) DO UPDATE SET fingerprint=EXCLUDED.fingerprint,read_at=EXCLUDED.read_at`,
          [organizationId, responsibleUserId, JSON.stringify(full.map(alert => ({ case_id: alert.caseId, dedupe_key: alert.dedupeKey, fingerprint: fingerprint(alert) }))), evaluatedAt])
          full = []
        } else {
          const reads = await pool.query<{ dedupe_key: string; fingerprint: string }>(
            'SELECT dedupe_key,fingerprint FROM operational_alert_reads WHERE organization_id=$1 AND user_id=$2', [organizationId, responsibleUserId])
          const byKey = new Map(reads.rows.map(row => [row.dedupe_key, row.fingerprint]))
          full = full.filter(alert => byKey.get(alert.dedupeKey) !== fingerprint(alert))
        }
      }
      const caseSummaries = caseIdFilter === undefined ? undefined : summarizeOperationalAlertsByCase(full, caseRows.map(row => row.id))
      return operationalAlertsResponseSchema.parse({
        schemaVersion: OPERATIONAL_ALERT_SCHEMA_VERSION,
        ...(caseSummaries === undefined ? {} : { caseSummaries }),
        totalCount: full.length,
        evaluatedAt,
        alerts: full.slice(0, MAX_OPERATIONAL_ALERTS),
      })
    }
  return {
    list: evaluate,
    markAllRead: (organizationId: string, asOfDate: string, evaluatedAt: string, userId: string): Promise<OperationalAlertsResponse> =>
      evaluate(organizationId, asOfDate, evaluatedAt, undefined, userId, 'mark_all_read'),
  }
}

export type OperationalAlertStore = ReturnType<typeof createOperationalAlertStore>
