import type pg from 'pg'
import {
  caseIdSchema,
  v1ImportQuarantineSchema,
  type V1ImportQuarantine,
  type V1ImportQuarantinesQuery,
} from '@hasarbotu/contracts'

interface QuarantineRow {
  id: string
  source_path_token: string
  source_relative_path: string
  reason: V1ImportQuarantine['reason']
  reason_code: string
  mapping_version: string
  evidence: unknown
  quarantined_at: Date
  resolution_target_case_id: string | null
  resolved_case_type: 'traffic' | 'casco' | null
  resolution_kind: 'deterministic_replan' | 'explicit_reconciliation' | null
  resolved_at: Date | null
}

interface CandidateRow {
  id: string
  case_type: 'traffic' | 'casco'
  office_number: string
  lifecycle_status: 'open' | 'closed'
  created_at: Date
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function safeCode(value: unknown): string | null {
  return typeof value === 'string' && /^[a-z0-9_]{1,96}$/.test(value) ? value : null
}

function candidateIds(evidence: unknown): string[] {
  const value = objectValue(evidence).candidateCaseIds
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((candidate): candidate is string =>
    typeof candidate === 'string' && caseIdSchema.safeParse(candidate).success))]
}

function evidenceSummary(evidence: unknown): V1ImportQuarantine['evidenceSummary'] {
  const resolution = objectValue(objectValue(evidence).claimTypeResolution)
  const evidenceItems = Array.isArray(resolution.evidence) ? resolution.evidence : []
  const evidenceKinds = [...new Set(evidenceItems
    .map((item) => safeCode(objectValue(item).kind))
    .filter((item): item is string => item !== null))].sort()
  return {
    detectedCaseType: resolution.caseType === 'traffic' || resolution.caseType === 'casco' ? resolution.caseType : null,
    resolutionReason: safeCode(resolution.resolutionReason),
    sidecarConflictPreserved: resolution.sidecarConflictPreserved === true,
    evidenceCount: Math.min(evidenceItems.length, 100),
    evidenceKinds,
  }
}

export interface V1ImportQuarantineListResult {
  readonly items: readonly V1ImportQuarantine[]
  readonly totalItems: number
}

export function createV1ImportQuarantineStore(pool: pg.Pool) {
  return {
    async list(organizationId: string, query: V1ImportQuarantinesQuery): Promise<V1ImportQuarantineListResult> {
      const where = ['q.organization_id=$1']
      const params: unknown[] = [organizationId]
      if (query.reason !== undefined) {
        params.push(query.reason)
        where.push(`q.reason=$${params.length}`)
      }
      if (query.status !== undefined) {
        where.push(query.status === 'resolved' ? 'resolution.id IS NOT NULL' : 'resolution.id IS NULL')
      }
      const whereSql = where.join(' AND ')
      const count = await pool.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM v1_import_source_quarantines q
          LEFT JOIN v1_import_quarantine_resolutions resolution
            ON resolution.organization_id=q.organization_id AND resolution.quarantine_id=q.id
         WHERE ${whereSql}`,
        params,
      )
      const offset = (query.page - 1) * query.pageSize
      const result = await pool.query<QuarantineRow>(
        `SELECT q.id::text,q.source_path_token,q.source_relative_path,q.reason,q.reason_code,q.mapping_version,
                q.evidence,q.quarantined_at,resolution.target_case_id::text AS resolution_target_case_id,
                resolution.resolved_case_type,resolution.resolution_kind,resolution.resolved_at
           FROM v1_import_source_quarantines q
           LEFT JOIN v1_import_quarantine_resolutions resolution
             ON resolution.organization_id=q.organization_id AND resolution.quarantine_id=q.id
          WHERE ${whereSql}
          ORDER BY q.quarantined_at DESC,q.quarantine_identity DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, query.pageSize, offset],
      )
      const allCandidateIds = [...new Set(result.rows.flatMap((row) => candidateIds(row.evidence)))]
      const candidates = allCandidateIds.length === 0
        ? { rows: [] as CandidateRow[] }
        : await pool.query<CandidateRow>(
          `SELECT id::text,case_type,office_number,lifecycle_status,created_at
             FROM cases WHERE organization_id=$1 AND id::text=ANY($2::text[])`,
          [organizationId, allCandidateIds],
        )
      const byId = new Map(candidates.rows.map((row) => [row.id, row]))
      const items = result.rows.map((row) => {
        const ids = candidateIds(row.evidence)
        return v1ImportQuarantineSchema.parse({
          id: row.id,
          sourceToken: row.source_path_token,
          sourceRelativePath: row.source_relative_path,
          reason: row.reason,
          reasonCode: row.reason_code,
          status: row.resolution_target_case_id === null ? 'unresolved' : 'resolved',
          mappingVersion: row.mapping_version,
          evidenceSummary: evidenceSummary(row.evidence),
          candidateCount: ids.length,
          candidateTargets: ids.flatMap((id) => {
            const candidate = byId.get(id)
            return candidate === undefined ? [] : [{
              caseId: candidate.id,
              caseType: candidate.case_type,
              officeCaseNumber: candidate.office_number,
              lifecycleStatus: candidate.lifecycle_status,
              createdAt: candidate.created_at.toISOString(),
            }]
          }),
          createdAt: row.quarantined_at.toISOString(),
          resolution: row.resolution_target_case_id === null || row.resolved_case_type === null
            || row.resolution_kind === null || row.resolved_at === null
            ? null
            : {
                targetCaseId: row.resolution_target_case_id,
                resolvedCaseType: row.resolved_case_type,
                resolutionKind: row.resolution_kind,
                resolvedAt: row.resolved_at.toISOString(),
              },
        })
      })
      return { items, totalItems: count.rows[0]?.total ?? 0 }
    },
  }
}

export type V1ImportQuarantineStore = ReturnType<typeof createV1ImportQuarantineStore>
