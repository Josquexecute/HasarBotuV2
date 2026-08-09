import type pg from 'pg'
import {
  kascoMandatoryCheckGateSchema,
  kascoMandatoryCheckSchema,
  kascoMandatoryCheckHistoryItemSchema,
  type KascoMandatoryCheckGate,
  type KascoMandatoryCheck,
  type KascoMandatoryCheckCode,
  type KascoMandatoryCheckConfirmRequest,
  type KascoMandatoryCheckHistoryItem,
  type KascoCheckResult,
} from '@hasarbotu/contracts'
import {
  KASCO_MANDATORY_CHECK_CODES,
  KASCO_MANDATORY_CHECK_DEFINITIONS,
  evaluateKascoMandatoryCheckGate,
  isValidResultForCheck,
  type KascoMandatoryCheckEvaluation,
  type KascoMandatoryCheckFact,
} from '@hasarbotu/domain'
import { uuidv7 } from '@hasarbotu/database'
import { createAuditService } from '../audit/service.js'
import { withTransaction, type Queryable } from '../db/executor.js'

interface ActorContext {
  readonly organizationId: string
  readonly actorUserId: string
  readonly requestId: string
}

interface CheckRow {
  id: string
  check_code: KascoMandatoryCheckCode
  version: number
  ai_suggested_result: KascoCheckResult | null
  ai_confidence_basis_points: number | null
  ai_evidence_document_id: string | null
  ai_evidence_document_version_id: string | null
  ai_evidence_page: number | null
  ai_evidence_section: string | null
  ai_evidence_excerpt: string | null
  ai_generated_at: Date | null
  confirmed_result: KascoCheckResult | null
  confirmed_evidence_document_id: string | null
  confirmed_evidence_document_version_id: string | null
  confirmed_evidence_page: number | null
  confirmed_evidence_section: string | null
  confirmed_evidence_excerpt: string | null
  confirmed_reason: string | null
  confirmed_by_user_id: string | null
  confirmed_by_display_name: string | null
  confirmed_at: Date | null
  evidence_document_current_version_id: string | null
}

const CHECK_ROW_FIELDS = `kmc.id,kmc.check_code,kmc.version,
  kmc.ai_suggested_result,kmc.ai_confidence_basis_points,kmc.ai_evidence_document_id,kmc.ai_evidence_document_version_id,
  kmc.ai_evidence_page,kmc.ai_evidence_section,kmc.ai_evidence_excerpt,kmc.ai_generated_at,
  kmc.confirmed_result,kmc.confirmed_evidence_document_id,kmc.confirmed_evidence_document_version_id,
  kmc.confirmed_evidence_page,kmc.confirmed_evidence_section,kmc.confirmed_evidence_excerpt,
  kmc.confirmed_reason,kmc.confirmed_by_user_id,u.display_name AS confirmed_by_display_name,kmc.confirmed_at,
  d.current_version_id AS evidence_document_current_version_id`

function toFact(row: CheckRow | undefined, code: KascoMandatoryCheckCode): KascoMandatoryCheckFact {
  if (row === undefined) {
    return {
      checkCode: code, confirmedResult: null, confirmedEvidenceDocumentId: null, confirmedEvidenceDocumentVersionId: null,
      confirmedAt: null, confirmedByUserId: null, aiSuggestedResult: null, aiSuggestedAt: null, evidenceDocumentCurrentVersionId: null,
    }
  }
  return {
    checkCode: code,
    confirmedResult: row.confirmed_result,
    confirmedEvidenceDocumentId: row.confirmed_evidence_document_id,
    confirmedEvidenceDocumentVersionId: row.confirmed_evidence_document_version_id,
    confirmedAt: row.confirmed_at?.toISOString() ?? null,
    confirmedByUserId: row.confirmed_by_user_id,
    aiSuggestedResult: row.ai_suggested_result,
    aiSuggestedAt: row.ai_generated_at?.toISOString() ?? null,
    evidenceDocumentCurrentVersionId: row.evidence_document_current_version_id,
  }
}

function toCheckDto(evaluation: KascoMandatoryCheckEvaluation, row: CheckRow | undefined): KascoMandatoryCheck {
  const definition = KASCO_MANDATORY_CHECK_DEFINITIONS[evaluation.checkCode]
  return kascoMandatoryCheckSchema.parse({
    checkCode: evaluation.checkCode,
    label: definition.labelTr,
    description: definition.descriptionTr,
    kind: definition.kind,
    validResults: definition.validResults,
    status: evaluation.status,
    reason: evaluation.reason,
    version: row?.version ?? 1,
    requiresHumanReview: evaluation.requiresHumanReview,
    aiSuggestedResult: row?.ai_suggested_result ?? null,
    aiConfidenceBasisPoints: row?.ai_confidence_basis_points ?? null,
    aiEvidence: row?.ai_evidence_document_id === undefined || row?.ai_evidence_document_id === null || row.ai_evidence_document_version_id === null
      || row.ai_evidence_page === null || row.ai_evidence_section === null || row.ai_evidence_excerpt === null
      ? null
      : {
        documentId: row.ai_evidence_document_id, documentVersionId: row.ai_evidence_document_version_id,
        page: row.ai_evidence_page, section: row.ai_evidence_section, excerpt: row.ai_evidence_excerpt,
      },
    aiGeneratedAt: row?.ai_generated_at?.toISOString() ?? null,
    confirmedResult: row?.confirmed_result ?? null,
    confirmedEvidence: row?.confirmed_evidence_document_id === undefined || row?.confirmed_evidence_document_id === null
      || row.confirmed_evidence_document_version_id === null || row.confirmed_evidence_page === null
      || row.confirmed_evidence_section === null || row.confirmed_evidence_excerpt === null
      ? null
      : {
        documentId: row.confirmed_evidence_document_id, documentVersionId: row.confirmed_evidence_document_version_id,
        page: row.confirmed_evidence_page, section: row.confirmed_evidence_section, excerpt: row.confirmed_evidence_excerpt,
      },
    confirmedReason: row?.confirmed_reason ?? null,
    confirmedByUserId: row?.confirmed_by_user_id ?? null,
    confirmedByDisplayName: row?.confirmed_by_display_name ?? null,
    confirmedAt: row?.confirmed_at?.toISOString() ?? null,
  })
}

async function loadCaseType(exec: Queryable, organizationId: string, caseId: string): Promise<'traffic' | 'casco' | undefined> {
  const result = await exec.query('SELECT case_type FROM cases WHERE organization_id=$1 AND id::text=$2', [organizationId, caseId])
  const row = result.rows[0] as { case_type: 'traffic' | 'casco' } | undefined
  return row?.case_type
}

async function loadCaseTypeAndLifecycle(
  exec: Queryable,
  organizationId: string,
  caseId: string,
): Promise<{ caseType: 'traffic' | 'casco'; lifecycleStatus: 'open' | 'closed' } | undefined> {
  const result = await exec.query(
    'SELECT case_type, lifecycle_status FROM cases WHERE organization_id=$1 AND id::text=$2',
    [organizationId, caseId],
  )
  const row = result.rows[0] as { case_type: 'traffic' | 'casco'; lifecycle_status: 'open' | 'closed' } | undefined
  return row === undefined ? undefined : { caseType: row.case_type, lifecycleStatus: row.lifecycle_status }
}

async function loadCheckRows(exec: Queryable, organizationId: string, caseId: string): Promise<Map<KascoMandatoryCheckCode, CheckRow>> {
  const result = await exec.query(
    `SELECT ${CHECK_ROW_FIELDS} FROM kasco_mandatory_checks kmc
     LEFT JOIN documents d ON d.id=kmc.confirmed_evidence_document_id AND d.organization_id=kmc.organization_id AND d.case_id=kmc.case_id
     LEFT JOIN users u ON u.id=kmc.confirmed_by_user_id
     WHERE kmc.organization_id=$1 AND kmc.case_id::text=$2`,
    [organizationId, caseId],
  )
  const map = new Map<KascoMandatoryCheckCode, CheckRow>()
  for (const row of result.rows as CheckRow[]) map.set(row.check_code, row)
  return map
}

/**
 * Gate + Paket 15/kapanış tarafının da kullandığı, salt-okunur ortak yükleyici.
 * `canWrite`, rol tabanlı yazma yetkisidir; kapanış/dahili çağrılarda önemsiz
 * olduğundan `false` verilir -- nihai `permissions.canWrite` ayrıca dosyanın
 * açık olmasını da şart koşar (kapalı dosyada salt-okunur).
 */
export async function loadKascoMandatoryCheckGate(
  exec: Queryable,
  organizationId: string,
  caseId: string,
  canWrite: boolean,
): Promise<KascoMandatoryCheckGate | undefined> {
  const context = await loadCaseTypeAndLifecycle(exec, organizationId, caseId)
  if (context === undefined) return undefined
  const rowsByCode = await loadCheckRows(exec, organizationId, caseId)
  const facts = KASCO_MANDATORY_CHECK_CODES.map((code) => toFact(rowsByCode.get(code), code))
  const evaluation = evaluateKascoMandatoryCheckGate(context.caseType, facts)
  const checks = evaluation.checks.map((item) => toCheckDto(item, rowsByCode.get(item.checkCode)))
  return kascoMandatoryCheckGateSchema.parse({
    caseId,
    applicable: evaluation.applicable,
    ruleVersion: evaluation.version,
    checks,
    missingCount: evaluation.missingCount,
    controlRequiredCount: evaluation.controlRequiredCount,
    needsReviewCount: evaluation.needsReviewCount,
    resolvedCount: evaluation.resolvedCount,
    incomplete: evaluation.incomplete,
    permissions: { canWrite: canWrite && context.lifecycleStatus === 'open' },
  })
}

export type ConfirmOutcome =
  | { readonly kind: 'ok'; readonly check: KascoMandatoryCheck }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'not_applicable_case_type' }
  | { readonly kind: 'case_closed' }
  | { readonly kind: 'invalid_result_for_check' }
  | { readonly kind: 'evidence_not_verified' }
  | { readonly kind: 'version_conflict' }

export function createKascoMandatoryCheckStore(pool: pg.Pool) {
  const audit = createAuditService()
  return {
    async getGate(organizationId: string, caseId: string, canWrite: boolean): Promise<KascoMandatoryCheckGate | undefined> {
      return loadKascoMandatoryCheckGate(pool, organizationId, caseId, canWrite)
    },

    async getHistory(organizationId: string, caseId: string, checkCode: KascoMandatoryCheckCode): Promise<readonly KascoMandatoryCheckHistoryItem[] | undefined> {
      const caseType = await loadCaseType(pool, organizationId, caseId)
      if (caseType === undefined) return undefined
      const result = await pool.query(
        `SELECT c.id,c.confirmed_result,c.evidence_document_id,c.evidence_document_version_id,c.evidence_page,c.evidence_section,
                c.evidence_excerpt,c.reason,c.ai_suggested_result_at_time,c.previous_confirmed_result,c.confirmed_by_user_id,
                u.display_name AS confirmed_by_display_name,c.occurred_at
         FROM kasco_mandatory_check_confirmations c
         LEFT JOIN users u ON u.id=c.confirmed_by_user_id
         WHERE c.organization_id=$1 AND c.case_id::text=$2 AND c.check_code=$3
         ORDER BY c.occurred_at DESC, c.id DESC`,
        [organizationId, caseId, checkCode],
      )
      return (result.rows as Array<{
        id: string; confirmed_result: KascoCheckResult; evidence_document_id: string | null; evidence_document_version_id: string | null
        evidence_page: number | null; evidence_section: string | null; evidence_excerpt: string | null; reason: string | null
        ai_suggested_result_at_time: KascoCheckResult | null; previous_confirmed_result: KascoCheckResult | null
        confirmed_by_user_id: string; confirmed_by_display_name: string | null; occurred_at: Date
      }>).map((row) => kascoMandatoryCheckHistoryItemSchema.parse({
        id: row.id,
        checkCode,
        confirmedResult: row.confirmed_result,
        evidence: row.evidence_document_id === null || row.evidence_document_version_id === null || row.evidence_page === null
          || row.evidence_section === null || row.evidence_excerpt === null
          ? null
          : { documentId: row.evidence_document_id, documentVersionId: row.evidence_document_version_id, page: row.evidence_page, section: row.evidence_section, excerpt: row.evidence_excerpt },
        reason: row.reason,
        aiSuggestedResultAtTime: row.ai_suggested_result_at_time,
        previousConfirmedResult: row.previous_confirmed_result,
        confirmedByUserId: row.confirmed_by_user_id,
        confirmedByDisplayName: row.confirmed_by_display_name ?? row.confirmed_by_user_id,
        occurredAt: row.occurred_at.toISOString(),
      }))
    },

    async confirmCheck(
      actor: ActorContext,
      caseId: string,
      checkCode: KascoMandatoryCheckCode,
      input: KascoMandatoryCheckConfirmRequest,
    ): Promise<ConfirmOutcome> {
      return withTransaction(pool, async (client): Promise<ConfirmOutcome> => {
        const caseResult = await client.query(
          'SELECT case_type, lifecycle_status FROM cases WHERE organization_id=$1 AND id::text=$2',
          [actor.organizationId, caseId],
        )
        const caseRow = caseResult.rows[0] as { case_type: 'traffic' | 'casco'; lifecycle_status: 'open' | 'closed' } | undefined
        if (caseRow === undefined) return { kind: 'not_found' }
        if (caseRow.case_type !== 'casco') return { kind: 'not_applicable_case_type' }
        if (caseRow.lifecycle_status !== 'open') return { kind: 'case_closed' }
        if (!isValidResultForCheck(checkCode, input.result)) return { kind: 'invalid_result_for_check' }

        if (input.evidence !== null) {
          const evidenceCheck = await client.query(
            `SELECT 1 FROM documents d JOIN document_versions dv ON dv.id=d.current_version_id
             WHERE d.organization_id=$1 AND d.case_id::text=$2 AND d.id::text=$3 AND dv.id::text=$4
               AND dv.status='ready' AND dv.hash_verified=true AND dv.size_verified=true AND dv.verified_at IS NOT NULL`,
            [actor.organizationId, caseId, input.evidence.documentId, input.evidence.documentVersionId],
          )
          if (evidenceCheck.rowCount === 0) return { kind: 'evidence_not_verified' }
        }

        // Satir yoksa version=1 ile olusturulur (INSERT ... ON CONFLICT DO
        // NOTHING); boylece istemci HER ZAMAN (ilk onay dahil) expectedVersion
        // gonderir -- storage/store.ts'teki "expectedVersion undefined ise
        // ilk atama" ikili sözleşmesi yerine TEK, basit bir kural.
        await client.query(
          `INSERT INTO kasco_mandatory_checks (id,organization_id,case_id,check_code,version)
           VALUES ($1,$2,$3,$4,1) ON CONFLICT (organization_id,case_id,check_code) DO NOTHING`,
          [uuidv7(), actor.organizationId, caseId, checkCode],
        )
        const current = await client.query(
          `SELECT id,version,confirmed_result,ai_suggested_result FROM kasco_mandatory_checks
           WHERE organization_id=$1 AND case_id::text=$2 AND check_code=$3 FOR UPDATE`,
          [actor.organizationId, caseId, checkCode],
        )
        const row = current.rows[0] as { id: string; version: number; confirmed_result: KascoCheckResult | null; ai_suggested_result: KascoCheckResult | null } | undefined
        if (row === undefined) throw new Error('kasco_mandatory_check_upsert_failed')
        if (row.version !== input.expectedVersion) return { kind: 'version_conflict' }

        const reason = input.reason ?? null
        await client.query(
          `UPDATE kasco_mandatory_checks SET
             confirmed_result=$3,
             confirmed_evidence_document_id=$4,confirmed_evidence_document_version_id=$5,
             confirmed_evidence_page=$6,confirmed_evidence_section=$7,confirmed_evidence_excerpt=$8,
             confirmed_reason=$9,confirmed_by_user_id=$10,confirmed_at=now(),
             version=version+1,updated_at=now()
           WHERE organization_id=$1 AND id=$2`,
          [
            actor.organizationId, row.id, input.result,
            input.evidence?.documentId ?? null, input.evidence?.documentVersionId ?? null,
            input.evidence?.page ?? null, input.evidence?.section ?? null, input.evidence?.excerpt ?? null,
            reason, actor.actorUserId,
          ],
        )
        await client.query(
          `INSERT INTO kasco_mandatory_check_confirmations
             (id,organization_id,case_id,check_id,check_code,confirmed_result,evidence_document_id,evidence_document_version_id,
              evidence_page,evidence_section,evidence_excerpt,reason,ai_suggested_result_at_time,previous_confirmed_result,
              confirmed_by_user_id,request_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [
            uuidv7(), actor.organizationId, caseId, row.id, checkCode, input.result,
            input.evidence?.documentId ?? null, input.evidence?.documentVersionId ?? null,
            input.evidence?.page ?? null, input.evidence?.section ?? null, input.evidence?.excerpt ?? null,
            reason, row.ai_suggested_result, row.confirmed_result, actor.actorUserId, actor.requestId,
          ],
        )
        await audit.record(client, {
          organizationId: actor.organizationId,
          actorUserId: actor.actorUserId,
          requestId: actor.requestId,
          action: 'kasco_mandatory_check.confirmed',
          entityType: 'kasco_mandatory_check',
          entityId: row.id,
          details: {
            caseId, checkCode, result: input.result,
            previousResult: row.confirmed_result,
            hasEvidence: input.evidence !== null,
            evidenceDocumentVersionId: input.evidence?.documentVersionId ?? null,
          },
        })

        // permissions alanı bu tekil-check yanıtında taşınmaz; canWrite önemsiz.
        const gate = await loadKascoMandatoryCheckGate(client, actor.organizationId, caseId, false)
        const check = gate?.checks.find((item) => item.checkCode === checkCode)
        if (check === undefined) throw new Error('kasco_mandatory_check_read_after_write_failed')
        return { kind: 'ok', check }
      })
    },
  }
}

export type KascoMandatoryCheckStore = ReturnType<typeof createKascoMandatoryCheckStore>
