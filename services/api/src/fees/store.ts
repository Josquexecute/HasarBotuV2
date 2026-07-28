import type pg from 'pg'
import {
  CLOSURE_FEE_CURRENCY,
  CLOSURE_FEE_RULE_VERSION,
  evaluateClosureFeeSource,
} from '@hasarbotu/domain'
import {
  caseClosureFeeResponseSchema,
  caseSummaryReportResponseSchema,
  closureFeeListResponseSchema,
  closureFeeRecordSchema,
  closureFeeResponseSchema,
  closureFeeVersionSchema,
  type CaseClosureFeeResponse,
  type CaseSummaryReportQuery,
  type CaseSummaryReportResponse,
  type ClosureFeeApproveRequest,
  type ClosureFeeCandidateCreateRequest,
  type ClosureFeeCorrectRequest,
  type ClosureFeeListResponse,
  type ClosureFeeListQuery,
  type ClosureFeePermissions,
  type ClosureFeeRecord,
  type ClosureFeeResponse,
  type ClosureFeeVersion,
} from '@hasarbotu/contracts'
import { uuidv7 } from '@hasarbotu/database'
import { createAuditService } from '../audit/service.js'
import { withTransaction } from '../db/executor.js'
import { findIdempotent, insertIdempotent, isIdempotencyRace } from '../db/idempotency.js'

export const FEE_CANDIDATE_SCOPE = 'closure_fee.candidate'
export const FEE_APPROVE_SCOPE = 'closure_fee.approve'
export const FEE_CORRECT_SCOPE = 'closure_fee.correct'

interface ActorContext {
  readonly organizationId: string
  readonly actorUserId: string
  readonly requestId: string
}

interface IdempotencyContext {
  readonly scope: string
  readonly key: string
  readonly requestHash: string
}

export interface FeeCapabilities {
  readonly canCreateCandidate: boolean
  readonly canApprove: boolean
  /** HB-011: mali tutar/rapor görünürlüğü; `false` iken rapor tutarları/bekleyen ücretler maskelenir. */
  readonly canView: boolean
}

interface FeeRecordRow {
  id: string
  case_id: string
  version: number
  current_version_id: string
}

interface FeeVersionRow {
  id: string
  fee_record_id: string
  fee_version: number
  status: 'control_required' | 'approved' | 'corrected'
  candidate_amount_minor: string
  approved_amount_minor: string | null
  currency: 'TRY'
  source_document_version_id: string
  source_page: number
  source_type: 'manual'
  rule_version: typeof CLOSURE_FEE_RULE_VERSION
  correction_reason: string | null
  created_by_user_id: string
  approved_by_user_id: string | null
  approved_at: Date | null
  created_at: Date
}

interface SourceRow {
  lifecycle_status: 'open' | 'closed'
  version: number
  document_type: string
  status: 'pending' | 'ready' | 'failed' | 'missing'
  hash_verified: boolean
  size_verified: boolean
  verified_at: Date | null
}

interface FeeListRow {
  fee_id: string
  case_id: string
  office_number: string
  plate: string
  case_type: 'traffic' | 'casco'
  insurer_name: string | null
  service_name: string | null
  responsible_user_name: string | null
  closed_at: Date
}

function safeMinor(value: string): number {
  const number = Number(value)
  if (!Number.isSafeInteger(number)) throw new Error('closure_fee_amount_out_of_range')
  return number
}

function versionToDto(row: FeeVersionRow): ClosureFeeVersion {
  return closureFeeVersionSchema.parse({
    id: row.id,
    feeVersion: row.fee_version,
    status: row.status,
    candidateAmountMinor: safeMinor(row.candidate_amount_minor),
    approvedAmountMinor: row.approved_amount_minor === null ? null : safeMinor(row.approved_amount_minor),
    currency: CLOSURE_FEE_CURRENCY,
    sourceDocumentVersionId: row.source_document_version_id,
    sourcePage: row.source_page,
    sourceType: row.source_type,
    ruleVersion: row.rule_version,
    correctionReason: row.correction_reason,
    createdByUserId: row.created_by_user_id,
    approvedByUserId: row.approved_by_user_id,
    approvedAt: row.approved_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  })
}

function permissions(
  capabilities: FeeCapabilities,
  status: ClosureFeeVersion['status'] | null,
): ClosureFeePermissions {
  return {
    canCreateCandidate: capabilities.canCreateCandidate && status === null,
    canApprove: capabilities.canApprove && status === 'control_required',
    canCorrect: capabilities.canApprove && (status === 'approved' || status === 'corrected'),
  }
}

async function loadFeeRecords(
  exec: pg.Pool | pg.PoolClient,
  organizationId: string,
  feeIds: readonly string[],
  capabilities: FeeCapabilities,
): Promise<Map<string, ClosureFeeRecord>> {
  if (feeIds.length === 0) return new Map()
  const recordsResult = await exec.query(
    `SELECT id,case_id,version,current_version_id
     FROM fee_records WHERE organization_id=$1 AND id=ANY($2::uuid[])`,
    [organizationId, feeIds],
  )
  const versionsResult = await exec.query(
    `SELECT id,fee_record_id,fee_version,status,candidate_amount_minor,approved_amount_minor,
            currency,source_document_version_id,source_page,source_type,rule_version,
            correction_reason,created_by_user_id,approved_by_user_id,approved_at,created_at
     FROM fee_record_versions
     WHERE organization_id=$1 AND fee_record_id=ANY($2::uuid[])
     ORDER BY fee_record_id,fee_version DESC`,
    [organizationId, feeIds],
  )
  const versionsByRecord = new Map<string, FeeVersionRow[]>()
  for (const row of versionsResult.rows as FeeVersionRow[]) {
    const existing = versionsByRecord.get(row.fee_record_id)
    if (existing === undefined) versionsByRecord.set(row.fee_record_id, [row])
    else existing.push(row)
  }
  const mapped = new Map<string, ClosureFeeRecord>()
  for (const record of recordsResult.rows as FeeRecordRow[]) {
    const historyRows = versionsByRecord.get(record.id) ?? []
    const currentRow = historyRows.find((row) => row.id === record.current_version_id)
    if (currentRow === undefined) throw new Error('closure_fee_current_version_missing')
    mapped.set(record.id, closureFeeRecordSchema.parse({
      id: record.id,
      caseId: record.case_id,
      version: record.version,
      currentVersion: versionToDto(currentRow),
      history: historyRows.map(versionToDto),
      permissions: permissions(capabilities, currentRow.status),
    }))
  }
  return mapped
}

async function sourceForCase(
  exec: pg.Pool | pg.PoolClient,
  organizationId: string,
  caseId: string,
  sourceDocumentVersionId: string,
  lockCase: boolean,
): Promise<SourceRow | undefined> {
  const result = await exec.query(
    `SELECT c.lifecycle_status,c.version,d.document_type,dv.status,dv.hash_verified,
            dv.size_verified,dv.verified_at
     FROM cases c
     JOIN document_versions dv
       ON dv.organization_id=c.organization_id AND dv.case_id=c.id AND dv.id=$3
     JOIN documents d
       ON d.organization_id=dv.organization_id AND d.case_id=dv.case_id AND d.id=dv.document_id
     WHERE c.organization_id=$1 AND c.id=$2
     ${lockCase ? 'FOR UPDATE OF c' : ''}`,
    [organizationId, caseId, sourceDocumentVersionId],
  )
  return result.rows[0] as SourceRow | undefined
}

function sourceEligibility(source: SourceRow) {
  return evaluateClosureFeeSource({
    caseLifecycleStatus: source.lifecycle_status,
    documentType: source.document_type,
    documentStatus: source.status,
    hashVerified: source.hash_verified,
    sizeVerified: source.size_verified,
    verifiedAt: source.verified_at?.toISOString() ?? null,
  })
}

export type FeeCommandOutcome =
  | { readonly kind: 'ok'; readonly response: ClosureFeeResponse; readonly status: 200 | 201 }
  | { readonly kind: 'replay'; readonly status: number; readonly body: unknown }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'case_version_conflict' }
  | { readonly kind: 'fee_version_conflict' }
  | { readonly kind: 'source_invalid'; readonly reasonCode: string }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'idempotency_conflict' }

export interface FeeStore {
  getCase(
    organizationId: string,
    caseId: string,
    capabilities: FeeCapabilities,
  ): Promise<CaseClosureFeeResponse | undefined>
  list(
    organizationId: string,
    query: ClosureFeeListQuery,
    capabilities: FeeCapabilities,
  ): Promise<ClosureFeeListResponse>
  report(
    organizationId: string,
    query: CaseSummaryReportQuery,
    generatedAt: string,
    capabilities: FeeCapabilities,
  ): Promise<CaseSummaryReportResponse>
  createCandidate(
    actor: ActorContext,
    caseId: string,
    input: ClosureFeeCandidateCreateRequest,
    idem: IdempotencyContext,
    capabilities: FeeCapabilities,
  ): Promise<FeeCommandOutcome>
  approve(
    actor: ActorContext,
    feeId: string,
    input: ClosureFeeApproveRequest,
    idem: IdempotencyContext,
    capabilities: FeeCapabilities,
  ): Promise<FeeCommandOutcome>
  correct(
    actor: ActorContext,
    feeId: string,
    input: ClosureFeeCorrectRequest,
    idem: IdempotencyContext,
    capabilities: FeeCapabilities,
  ): Promise<FeeCommandOutcome>
}

export function createFeeStore(pool: pg.Pool): FeeStore {
  const audit = createAuditService()

  async function guard(
    actor: ActorContext,
    idem: IdempotencyContext,
  ): Promise<FeeCommandOutcome | undefined> {
    const existing = await findIdempotent(pool, actor.organizationId, idem.scope, idem.key)
    if (existing === undefined) return undefined
    if (existing.requestHash !== idem.requestHash) return { kind: 'idempotency_conflict' }
    return { kind: 'replay', status: existing.responseStatus, body: existing.responseBody }
  }

  async function recoverRace(actor: ActorContext, idem: IdempotencyContext): Promise<FeeCommandOutcome> {
    const raced = await findIdempotent(pool, actor.organizationId, idem.scope, idem.key)
    if (raced !== undefined && raced.requestHash === idem.requestHash) {
      return { kind: 'replay', status: raced.responseStatus, body: raced.responseBody }
    }
    return { kind: 'idempotency_conflict' }
  }

  return {
    async getCase(
      organizationId: string,
      caseId: string,
      capabilities: FeeCapabilities,
    ): Promise<CaseClosureFeeResponse | undefined> {
      const caseResult = await pool.query(
        'SELECT lifecycle_status FROM cases WHERE organization_id=$1 AND id=$2',
        [organizationId, caseId],
      )
      const caseRow = caseResult.rows[0] as { lifecycle_status: 'open' | 'closed' } | undefined
      if (caseRow === undefined) return undefined
      const feeResult = await pool.query(
        'SELECT id FROM fee_records WHERE organization_id=$1 AND case_id=$2',
        [organizationId, caseId],
      )
      const feeId = (feeResult.rows[0] as { id: string } | undefined)?.id
      if (feeId === undefined) {
        const caseCapabilities = {
          ...capabilities,
          canCreateCandidate: capabilities.canCreateCandidate && caseRow.lifecycle_status === 'closed',
        }
        return caseClosureFeeResponseSchema.parse({
          fee: null,
          permissions: permissions(caseCapabilities, null),
        })
      }
      const records = await loadFeeRecords(pool, organizationId, [feeId], capabilities)
      const fee = records.get(feeId)
      return caseClosureFeeResponseSchema.parse({
        fee: fee ?? null,
        permissions: fee?.permissions ?? permissions(capabilities, null),
      })
    },

    async list(
      organizationId: string,
      query: ClosureFeeListQuery,
      capabilities: FeeCapabilities,
    ) {
      const params: unknown[] = [organizationId]
      let statusClause = ''
      if (query.status !== undefined) {
        params.push(query.status)
        statusClause = `AND current.status=$${params.length}`
      }
      const result = await pool.query(
        `SELECT fee.id AS fee_id,c.id AS case_id,c.office_number,c.plate,c.case_type,
                insurer.name AS insurer_name,service.name AS service_name,
                responsible.display_name AS responsible_user_name,c.closed_at
         FROM fee_records fee
         JOIN fee_record_versions current ON current.id=fee.current_version_id
         JOIN cases c ON c.organization_id=fee.organization_id AND c.id=fee.case_id
         LEFT JOIN insurers insurer
           ON insurer.organization_id=c.organization_id AND insurer.id=c.insurer_id
         LEFT JOIN service_centers service
           ON service.organization_id=c.organization_id AND service.id=c.service_center_id
         LEFT JOIN users responsible
           ON responsible.organization_id=c.organization_id AND responsible.id=c.responsible_user_id
         WHERE fee.organization_id=$1 AND c.lifecycle_status='closed' AND c.closed_at IS NOT NULL
           ${statusClause}
         ORDER BY c.closed_at DESC,c.id`,
        params,
      )
      const rows = result.rows as FeeListRow[]
      const records = await loadFeeRecords(pool, organizationId, rows.map((row) => row.fee_id), capabilities)
      return closureFeeListResponseSchema.parse({
        items: rows.map((row) => ({
          caseId: row.case_id,
          officeCaseNumber: row.office_number,
          plate: row.plate,
          caseType: row.case_type,
          insurerName: row.insurer_name,
          serviceName: row.service_name,
          responsibleUserName: row.responsible_user_name,
          closedAt: row.closed_at.toISOString(),
          fee: records.get(row.fee_id),
        })),
      })
    },

    async report(
      organizationId: string,
      query: CaseSummaryReportQuery,
      generatedAt: string,
      capabilities: FeeCapabilities,
    ): Promise<CaseSummaryReportResponse> {
      const [year, month] = query.period.split('-').map(Number) as [number, number]
      const periodStart = `${query.period}-01`
      const nextYear = month === 12 ? year + 1 : year
      const nextMonth = month === 12 ? 1 : month + 1
      const periodEndExclusive = `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01`
      const params: unknown[] = [organizationId, periodStart, periodEndExclusive]
      const filters: string[] = []
      if (query.responsibleUserId !== undefined) {
        params.push(query.responsibleUserId)
        filters.push(`c.responsible_user_id=$${params.length}`)
      }
      if (query.serviceId !== undefined) {
        params.push(query.serviceId)
        filters.push(`c.service_center_id=$${params.length}`)
      }
      const filterSql = filters.length === 0 ? '' : `AND ${filters.join(' AND ')}`
      const scopedSql = `c.organization_id=$1
        AND (
          (c.lifecycle_status='open' AND c.created_at >= $2::date AND c.created_at < $3::date)
          OR (c.lifecycle_status='closed' AND c.closed_at >= $2::date AND c.closed_at < $3::date)
        ) ${filterSql}`
      const summaryResult = await pool.query(
        `SELECT
           count(*)::int AS total_case_count,
           count(*) FILTER (WHERE c.lifecycle_status='open')::int AS open_case_count,
           count(*) FILTER (WHERE c.lifecycle_status='closed')::int AS closed_case_count,
           count(*) FILTER (WHERE c.case_type='traffic')::int AS traffic_case_count,
           count(*) FILTER (WHERE c.case_type='casco')::int AS casco_case_count,
           count(*) FILTER (
             WHERE c.lifecycle_status='closed' AND current.status IN ('approved','corrected')
           )::int AS approved_fee_count,
           COALESCE(sum(current.approved_amount_minor)
             FILTER (
               WHERE c.lifecycle_status='closed' AND current.status IN ('approved','corrected')
             ),0)::text AS approved_fee_total_minor,
           count(*) FILTER (
             WHERE c.lifecycle_status='closed' AND current.status='control_required'
           )::int AS control_required_fee_count,
           count(*) FILTER (WHERE c.lifecycle_status='closed' AND fee.id IS NULL)::int AS closed_without_fee_count,
           count(*) FILTER (
             WHERE c.lifecycle_status='closed' AND c.case_type='traffic'
               AND value_loss.status='approved'
               AND value_loss.human_approval_status='approved'
               AND value_loss.result_code<>'control_required'
               AND value_loss_report.id IS NOT NULL
               AND value_loss_report.rule_version=value_loss.rule_version
           )::int AS approved_value_loss_count,
           COALESCE(sum(
             CASE WHEN c.lifecycle_status='closed' AND c.case_type='traffic'
               AND value_loss.status='approved'
               AND value_loss.human_approval_status='approved'
               AND value_loss.result_code<>'control_required'
               AND value_loss_report.id IS NOT NULL
               AND value_loss_report.rule_version=value_loss.rule_version
             THEN COALESCE((value_loss.result_snapshot->>'faultAdjustedValueLossMinor')::bigint,0)
             ELSE 0 END
           ),0)::text AS approved_value_loss_total_minor,
           count(*) FILTER (
             WHERE c.lifecycle_status='closed' AND c.case_type='traffic'
               AND NOT COALESCE((
                 value_loss.status='approved'
                 AND value_loss.human_approval_status='approved'
                 AND value_loss.result_code<>'control_required'
                 AND value_loss_report.id IS NOT NULL
                 AND value_loss_report.rule_version=value_loss.rule_version
               ),false)
           )::int AS control_required_value_loss_count,
           count(*) FILTER (WHERE c.lifecycle_status='closed' AND c.case_type='casco')::int AS not_applicable_value_loss_count
         FROM cases c
         LEFT JOIN fee_records fee
           ON fee.organization_id=c.organization_id AND fee.case_id=c.id
         LEFT JOIN fee_record_versions current ON current.id=fee.current_version_id
         LEFT JOIN traffic_value_loss_assessments value_loss_assessment
           ON value_loss_assessment.organization_id=c.organization_id
          AND value_loss_assessment.case_id=c.id
         LEFT JOIN traffic_value_loss_versions value_loss
           ON value_loss.id=value_loss_assessment.current_version_id
         LEFT JOIN traffic_value_loss_reports value_loss_report
           ON value_loss_report.assessment_version_id=value_loss.id
         WHERE ${scopedSql}`,
        params,
      )
      const summary = summaryResult.rows[0] as {
        total_case_count: number
        open_case_count: number
        closed_case_count: number
        traffic_case_count: number
        casco_case_count: number
        approved_fee_count: number
        approved_fee_total_minor: string
        control_required_fee_count: number
        closed_without_fee_count: number
        approved_value_loss_count: number
        approved_value_loss_total_minor: string
        control_required_value_loss_count: number
        not_applicable_value_loss_count: number
      }
      const pendingResult = await pool.query(
        `SELECT fee.id AS fee_id,c.id AS case_id,c.office_number,c.plate,c.case_type,
                insurer.name AS insurer_name,service.name AS service_name,
                responsible.display_name AS responsible_user_name,c.closed_at
         FROM cases c
         JOIN fee_records fee ON fee.organization_id=c.organization_id AND fee.case_id=c.id
         JOIN fee_record_versions current
           ON current.id=fee.current_version_id AND current.status='control_required'
         LEFT JOIN insurers insurer
           ON insurer.organization_id=c.organization_id AND insurer.id=c.insurer_id
         LEFT JOIN service_centers service
           ON service.organization_id=c.organization_id AND service.id=c.service_center_id
         LEFT JOIN users responsible
           ON responsible.organization_id=c.organization_id AND responsible.id=c.responsible_user_id
         WHERE ${scopedSql} AND c.lifecycle_status='closed' AND c.closed_at IS NOT NULL
         ORDER BY c.closed_at DESC,c.id`,
        params,
      )
      const pendingRows = pendingResult.rows as FeeListRow[]
      const records = await loadFeeRecords(
        pool,
        organizationId,
        pendingRows.map((row) => row.fee_id),
        capabilities,
      )
      const filtersResult = await pool.query(
        `SELECT DISTINCT c.responsible_user_id AS user_id,responsible.display_name AS user_name,
                c.service_center_id AS service_id,service.name AS service_name
         FROM cases c
         LEFT JOIN users responsible
           ON responsible.organization_id=c.organization_id AND responsible.id=c.responsible_user_id
         LEFT JOIN service_centers service
           ON service.organization_id=c.organization_id AND service.id=c.service_center_id
         WHERE c.organization_id=$1
           AND (
             (c.lifecycle_status='open' AND c.created_at >= $2::date AND c.created_at < $3::date)
             OR (c.lifecycle_status='closed' AND c.closed_at >= $2::date AND c.closed_at < $3::date)
           )`,
        [organizationId, periodStart, periodEndExclusive],
      )
      const responsibleUsers = new Map<string, string>()
      const services = new Map<string, string>()
      for (const row of filtersResult.rows as Array<{
        user_id: string | null
        user_name: string | null
        service_id: string | null
        service_name: string | null
      }>) {
        if (row.user_id !== null && row.user_name !== null) responsibleUsers.set(row.user_id, row.user_name)
        if (row.service_id !== null && row.service_name !== null) services.set(row.service_id, row.service_name)
      }
      return caseSummaryReportResponseSchema.parse({
        period: query.period,
        periodStart,
        periodEndExclusive,
        generatedAt,
        periodBasis: 'open_created_closed_finalized',
        includesFinancials: capabilities.canView,
        summary: {
          totalCaseCount: summary.total_case_count,
          openCaseCount: summary.open_case_count,
          closedCaseCount: summary.closed_case_count,
          trafficCaseCount: summary.traffic_case_count,
          cascoCaseCount: summary.casco_case_count,
          approvedFeeCount: summary.approved_fee_count,
          approvedFeeTotalMinor: capabilities.canView ? safeMinor(summary.approved_fee_total_minor) : null,
          controlRequiredFeeCount: summary.control_required_fee_count,
          closedCaseWithoutFeeCount: summary.closed_without_fee_count,
          approvedValueLossCount: summary.approved_value_loss_count,
          approvedValueLossTotalMinor: capabilities.canView ? safeMinor(summary.approved_value_loss_total_minor) : null,
          controlRequiredValueLossCount: summary.control_required_value_loss_count,
          notApplicableValueLossCount: summary.not_applicable_value_loss_count,
        },
        distribution: [
          { code: 'traffic', count: summary.traffic_case_count },
          { code: 'casco', count: summary.casco_case_count },
          { code: 'closed', count: summary.closed_case_count },
        ],
        responsibleUsers: [...responsibleUsers].map(([id, name]) => ({ id, name }))
          .sort((left, right) => left.name.localeCompare(right.name, 'tr')),
        services: [...services].map(([id, name]) => ({ id, name }))
          .sort((left, right) => left.name.localeCompare(right.name, 'tr')),
        pendingFees: capabilities.canView ? pendingRows.map((row) => ({
          caseId: row.case_id,
          officeCaseNumber: row.office_number,
          plate: row.plate,
          caseType: row.case_type,
          insurerName: row.insurer_name,
          serviceName: row.service_name,
          responsibleUserName: row.responsible_user_name,
          closedAt: row.closed_at.toISOString(),
          fee: records.get(row.fee_id),
        })) : [],
      })
    },

    async createCandidate(
      actor: ActorContext,
      caseId: string,
      input: ClosureFeeCandidateCreateRequest,
      idem: IdempotencyContext,
      capabilities: FeeCapabilities,
    ): Promise<FeeCommandOutcome> {
      const existing = await guard(actor, idem)
      if (existing !== undefined) return existing
      try {
        return await withTransaction(pool, async (client): Promise<FeeCommandOutcome> => {
          const source = await sourceForCase(
            client, actor.organizationId, caseId, input.sourceDocumentVersionId, true,
          )
          if (source === undefined) {
            const caseExists = await client.query(
              'SELECT 1 FROM cases WHERE organization_id=$1 AND id=$2',
              [actor.organizationId, caseId],
            )
            return (caseExists.rowCount ?? 0) === 0
              ? { kind: 'not_found' }
              : { kind: 'source_invalid', reasonCode: 'final_report_required' }
          }
          if (source.version !== input.expectedCaseVersion) return { kind: 'case_version_conflict' }
          const eligibility = sourceEligibility(source)
          if (!eligibility.eligible) return { kind: 'source_invalid', reasonCode: eligibility.reasonCode }
          const duplicate = await client.query(
            'SELECT 1 FROM fee_records WHERE organization_id=$1 AND case_id=$2',
            [actor.organizationId, caseId],
          )
          if ((duplicate.rowCount ?? 0) > 0) return { kind: 'conflict' }

          const feeId = uuidv7()
          const versionId = uuidv7()
          await client.query(
            'INSERT INTO fee_records (id,organization_id,case_id) VALUES ($1,$2,$3)',
            [feeId, actor.organizationId, caseId],
          )
          await client.query(
            `INSERT INTO fee_record_versions
             (id,organization_id,case_id,fee_record_id,fee_version,status,candidate_amount_minor,
              currency,source_document_version_id,source_page,source_type,rule_version,
              created_by_user_id,request_id)
             VALUES ($1,$2,$3,$4,1,'control_required',$5,'TRY',$6,$7,'manual',$8,$9,$10)`,
            [
              versionId, actor.organizationId, caseId, feeId, input.candidateAmountMinor,
              input.sourceDocumentVersionId, input.sourcePage, CLOSURE_FEE_RULE_VERSION,
              actor.actorUserId, actor.requestId,
            ],
          )
          await client.query('UPDATE fee_records SET current_version_id=$2 WHERE id=$1', [feeId, versionId])
          const records = await loadFeeRecords(client, actor.organizationId, [feeId], capabilities)
          const response = closureFeeResponseSchema.parse({ fee: records.get(feeId) })
          await audit.record(client, {
            organizationId: actor.organizationId,
            actorUserId: actor.actorUserId,
            requestId: actor.requestId,
            action: 'closure_fee.candidate_created',
            entityType: 'closure_fee',
            entityId: feeId,
            details: {
              caseId, feeVersion: 1, status: 'control_required',
              candidateAmountMinor: input.candidateAmountMinor,
              sourceDocumentVersionId: input.sourceDocumentVersionId,
              sourcePage: input.sourcePage, ruleVersion: CLOSURE_FEE_RULE_VERSION,
            },
          })
          await insertIdempotent(client, {
            organizationId: actor.organizationId, scope: idem.scope, key: idem.key,
            requestHash: idem.requestHash, responseStatus: 201, responseBody: response, caseId,
          })
          return { kind: 'ok', response, status: 201 }
        })
      } catch (error) {
        if (!isIdempotencyRace(error)) throw error
        return recoverRace(actor, idem)
      }
    },

    async approve(
      actor: ActorContext,
      feeId: string,
      input: ClosureFeeApproveRequest,
      idem: IdempotencyContext,
      capabilities: FeeCapabilities,
    ): Promise<FeeCommandOutcome> {
      const existing = await guard(actor, idem)
      if (existing !== undefined) return existing
      try {
        return await withTransaction(pool, async (client): Promise<FeeCommandOutcome> => {
          const result = await client.query(
            `SELECT fee.id,fee.case_id,fee.version,fee.current_version_id,current.status,
                    current.candidate_amount_minor,current.source_document_version_id,
                    current.source_page,current.created_by_user_id,current.fee_version
             FROM fee_records fee JOIN fee_record_versions current ON current.id=fee.current_version_id
             WHERE fee.organization_id=$1 AND fee.id=$2 FOR UPDATE OF fee`,
            [actor.organizationId, feeId],
          )
          const record = result.rows[0] as {
            id: string; case_id: string; version: number; current_version_id: string
            status: ClosureFeeVersion['status']; candidate_amount_minor: string
            source_document_version_id: string; source_page: number
            created_by_user_id: string; fee_version: number
          } | undefined
          if (record === undefined) return { kind: 'not_found' }
          if (record.version !== input.expectedVersion) return { kind: 'fee_version_conflict' }
          if (record.status !== 'control_required') return { kind: 'conflict' }
          const source = await sourceForCase(
            client, actor.organizationId, record.case_id, record.source_document_version_id, true,
          )
          if (source === undefined) return { kind: 'source_invalid', reasonCode: 'final_report_required' }
          const eligibility = sourceEligibility(source)
          if (!eligibility.eligible) return { kind: 'source_invalid', reasonCode: eligibility.reasonCode }

          const nextVersion = record.fee_version + 1
          const nextVersionId = uuidv7()
          const amount = safeMinor(record.candidate_amount_minor)
          await client.query(
            `INSERT INTO fee_record_versions
             (id,organization_id,case_id,fee_record_id,fee_version,previous_version_id,status,
              candidate_amount_minor,approved_amount_minor,currency,source_document_version_id,
              source_page,source_type,rule_version,created_by_user_id,approved_by_user_id,
              approved_at,request_id)
             VALUES ($1,$2,$3,$4,$5,$6,'approved',$7,$7,'TRY',$8,$9,'manual',$10,$11,$12,now(),$13)`,
            [
              nextVersionId, actor.organizationId, record.case_id, record.id, nextVersion,
              record.current_version_id, amount, record.source_document_version_id, record.source_page,
              CLOSURE_FEE_RULE_VERSION, record.created_by_user_id, actor.actorUserId, actor.requestId,
            ],
          )
          await client.query(
            'UPDATE fee_records SET current_version_id=$2,version=version+1,updated_at=now() WHERE id=$1',
            [record.id, nextVersionId],
          )
          const records = await loadFeeRecords(client, actor.organizationId, [record.id], capabilities)
          const response = closureFeeResponseSchema.parse({ fee: records.get(record.id) })
          await audit.record(client, {
            organizationId: actor.organizationId, actorUserId: actor.actorUserId,
            requestId: actor.requestId, action: 'closure_fee.approved',
            entityType: 'closure_fee', entityId: record.id,
            details: {
              caseId: record.case_id, feeVersion: nextVersion, approvedAmountMinor: amount,
              sourceDocumentVersionId: record.source_document_version_id,
              sourcePage: record.source_page, ruleVersion: CLOSURE_FEE_RULE_VERSION,
              selfApproved: record.created_by_user_id === actor.actorUserId,
            },
          })
          await insertIdempotent(client, {
            organizationId: actor.organizationId, scope: idem.scope, key: idem.key,
            requestHash: idem.requestHash, responseStatus: 200, responseBody: response,
            caseId: record.case_id,
          })
          return { kind: 'ok', response, status: 200 }
        })
      } catch (error) {
        if (!isIdempotencyRace(error)) throw error
        return recoverRace(actor, idem)
      }
    },

    async correct(
      actor: ActorContext,
      feeId: string,
      input: ClosureFeeCorrectRequest,
      idem: IdempotencyContext,
      capabilities: FeeCapabilities,
    ): Promise<FeeCommandOutcome> {
      const existing = await guard(actor, idem)
      if (existing !== undefined) return existing
      try {
        return await withTransaction(pool, async (client): Promise<FeeCommandOutcome> => {
          const result = await client.query(
            `SELECT fee.id,fee.case_id,fee.version,fee.current_version_id,current.status,
                    current.fee_version
             FROM fee_records fee JOIN fee_record_versions current ON current.id=fee.current_version_id
             WHERE fee.organization_id=$1 AND fee.id=$2 FOR UPDATE OF fee`,
            [actor.organizationId, feeId],
          )
          const record = result.rows[0] as {
            id: string; case_id: string; version: number; current_version_id: string
            status: ClosureFeeVersion['status']; fee_version: number
          } | undefined
          if (record === undefined) return { kind: 'not_found' }
          if (record.version !== input.expectedVersion) return { kind: 'fee_version_conflict' }
          if (record.status !== 'approved' && record.status !== 'corrected') return { kind: 'conflict' }
          const source = await sourceForCase(
            client, actor.organizationId, record.case_id, input.sourceDocumentVersionId, true,
          )
          if (source === undefined) return { kind: 'source_invalid', reasonCode: 'final_report_required' }
          const eligibility = sourceEligibility(source)
          if (!eligibility.eligible) return { kind: 'source_invalid', reasonCode: eligibility.reasonCode }

          const nextVersion = record.fee_version + 1
          const nextVersionId = uuidv7()
          await client.query(
            `INSERT INTO fee_record_versions
             (id,organization_id,case_id,fee_record_id,fee_version,previous_version_id,status,
              candidate_amount_minor,approved_amount_minor,currency,source_document_version_id,
              source_page,source_type,rule_version,correction_reason,created_by_user_id,
              approved_by_user_id,approved_at,request_id)
             VALUES ($1,$2,$3,$4,$5,$6,'corrected',$7,$7,'TRY',$8,$9,'manual',$10,$11,$12,$12,now(),$13)`,
            [
              nextVersionId, actor.organizationId, record.case_id, record.id, nextVersion,
              record.current_version_id, input.approvedAmountMinor, input.sourceDocumentVersionId,
              input.sourcePage, CLOSURE_FEE_RULE_VERSION, input.reason, actor.actorUserId,
              actor.requestId,
            ],
          )
          await client.query(
            'UPDATE fee_records SET current_version_id=$2,version=version+1,updated_at=now() WHERE id=$1',
            [record.id, nextVersionId],
          )
          const records = await loadFeeRecords(client, actor.organizationId, [record.id], capabilities)
          const response = closureFeeResponseSchema.parse({ fee: records.get(record.id) })
          await audit.record(client, {
            organizationId: actor.organizationId, actorUserId: actor.actorUserId,
            requestId: actor.requestId, action: 'closure_fee.corrected',
            entityType: 'closure_fee', entityId: record.id,
            details: {
              caseId: record.case_id, feeVersion: nextVersion,
              approvedAmountMinor: input.approvedAmountMinor,
              sourceDocumentVersionId: input.sourceDocumentVersionId,
              sourcePage: input.sourcePage, ruleVersion: CLOSURE_FEE_RULE_VERSION,
            },
          })
          await insertIdempotent(client, {
            organizationId: actor.organizationId, scope: idem.scope, key: idem.key,
            requestHash: idem.requestHash, responseStatus: 200, responseBody: response,
            caseId: record.case_id,
          })
          return { kind: 'ok', response, status: 200 }
        })
      } catch (error) {
        if (!isIdempotencyRace(error)) throw error
        return recoverRace(actor, idem)
      }
    },
  }
}
