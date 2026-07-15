import { createHash } from 'node:crypto'
import type pg from 'pg'
import { uuidv7 } from '@hasarbotu/database'
import {
  POLICY_AI_PROMOTION_SCHEMA_VERSION,
  POLICY_AI_REVIEW_SCHEMA_VERSION,
  buildPolicyAiReviewSetHash,
  evaluatePolicyAiHumanReview,
  evaluatePolicyAiPromotionReadiness,
  type PolicyAiCandidateInput,
  type PolicyAiReviewFact,
  type PolicyAiSourceBundleItem,
  type PolicyAiSourceQuality,
  type PolicyAiValidationStatus,
} from '@hasarbotu/domain'
import {
  policyAiCandidateReviewResponseSchema,
  policyAiPromotionPreviewResponseSchema,
  policyAiPromotionResponseSchema,
  type PolicyAiCandidateReview,
  type PolicyAiCandidateReviewRequest,
  type PolicyAiPromotion,
  type PolicyAiPromotionPreview,
  type PolicyAiPromotionRequest,
} from '@hasarbotu/contracts'
import { createAuditService } from '../audit/service.js'
import { findIdempotent, insertIdempotent } from '../db/idempotency.js'
import type { Queryable } from '../db/executor.js'
import { withTransaction } from '../db/executor.js'

export interface PolicyAiReviewActor {
  readonly organizationId: string
  readonly actorUserId: string
  readonly requestId: string
}

export interface PolicyAiReviewIdempotency {
  readonly scope: string
  readonly key: string
  readonly requestHash: string
}

export interface PolicyAiReviewCommandResult<T> {
  readonly replay: boolean
  readonly status: number
  readonly body: T
}

export type PolicyAiReviewStoreErrorCode =
  | 'not_found'
  | 'state_conflict'
  | 'review_conflict'
  | 'review_stale'
  | 'promotion_blocked'
  | 'promotion_stale'
  | 'idempotency_conflict'

export class PolicyAiReviewStoreError extends Error {
  constructor(readonly code: PolicyAiReviewStoreErrorCode) { super(code) }
}

export interface PolicyAiReviewStore {
  review(actor: PolicyAiReviewActor, caseId: string, runId: string, candidateId: string,
    input: PolicyAiCandidateReviewRequest, idem: PolicyAiReviewIdempotency): Promise<PolicyAiReviewCommandResult<{ review: PolicyAiCandidateReview }>>
  preview(organizationId: string, caseId: string, runId: string): Promise<{ preview: PolicyAiPromotionPreview } | undefined>
  promote(actor: PolicyAiReviewActor, caseId: string, runId: string, input: PolicyAiPromotionRequest,
    idem: PolicyAiReviewIdempotency): Promise<PolicyAiReviewCommandResult<{ promotion: PolicyAiPromotion }>>
}

interface CandidateRow extends Record<string, unknown> {
  candidate_id: string
  category: PolicyAiCandidateInput['category']
  canonical_field: string
  normalized_value: unknown
  original_value: string
  conditions: string[]
  exceptions: string[]
  provider_confidence: string
  source_quality: PolicyAiSourceQuality
  validation_status: PolicyAiValidationStatus
  provider_id: string
  provider_version: string
  model_id: string
  prompt_template_version: string
  output_schema_version: string
}

interface ReviewRow extends Record<string, unknown> {
  run_id: string
  candidate_id: string
  review_version: number
  action: PolicyAiReviewFact['action']
  normalized_value: unknown
  original_value: string
  conditions: string[]
  exceptions: string[]
  source_anchor_ids: string[]
  reason: string | null
  evidence_status: PolicyAiValidationStatus
  reviewed_by_user_id: string
  reviewed_at: Date
}

interface PreviewData {
  readonly preview: PolicyAiPromotionPreview
  readonly run: { readonly version: number; readonly source_bundle_id: string }
  readonly candidates: readonly CandidateRow[]
  readonly reviews: readonly ReviewRow[]
  readonly sourceDocumentId: string | null
  readonly sourceDocumentVersionId: string | null
}

const audit = createAuditService()
const iso = (value: Date | string) => value instanceof Date ? value.toISOString() : value
const excerptHash = (value: string) => createHash('sha256').update(value).digest('hex')
function boundedExcerpt(value: string, evidence: string): string {
  const source = value.trim()
  const needle = evidence.trim()
  const match = needle.length === 0 ? -1 : source.toLocaleLowerCase('tr-TR').indexOf(needle.toLocaleLowerCase('tr-TR'))
  if (match < 0) return Array.from(source).slice(0, 1000).join('')
  const before = Array.from(source.slice(0, match))
  const evidenceCharacters = Array.from(source.slice(match, match + needle.length))
  const start = Math.max(0, before.length - Math.max(100, Math.floor((1000 - evidenceCharacters.length) / 2)))
  return [...before.slice(start), ...Array.from(source.slice(match))].slice(0, 1000).join('')
}

function candidateInput(row: CandidateRow, sourceAnchorIds: readonly string[], override?: {
  readonly normalizedValue: unknown
  readonly originalValue: string
  readonly conditions: readonly string[]
  readonly exceptions: readonly string[]
}): PolicyAiCandidateInput {
  return {
    candidateId: row.candidate_id,
    category: row.category,
    canonicalField: row.canonical_field,
    normalizedValue: override?.normalizedValue ?? row.normalized_value,
    originalValue: override?.originalValue ?? row.original_value,
    conditions: override?.conditions ?? row.conditions,
    exceptions: override?.exceptions ?? row.exceptions,
    sourceAnchorIds,
    providerConfidence: Number(row.provider_confidence),
  }
}

function toReview(row: ReviewRow): PolicyAiCandidateReview {
  return policyAiCandidateReviewResponseSchema.parse({ review: {
    schemaVersion: POLICY_AI_REVIEW_SCHEMA_VERSION,
    runId: row.run_id,
    candidateId: row.candidate_id,
    reviewVersion: row.review_version,
    action: row.action,
    normalizedValue: row.normalized_value,
    originalValue: row.original_value,
    conditions: row.conditions,
    exceptions: row.exceptions,
    sourceAnchorIds: row.source_anchor_ids,
    reason: row.reason,
    evidenceStatus: row.evidence_status,
    reviewedByUserId: row.reviewed_by_user_id,
    reviewedAt: iso(row.reviewed_at),
  } }).review
}

function toReviewFact(row: ReviewRow): PolicyAiReviewFact {
  return {
    candidateId: row.candidate_id,
    reviewVersion: row.review_version,
    action: row.action,
    normalizedValue: row.normalized_value,
    originalValue: row.original_value,
    conditions: row.conditions,
    exceptions: row.exceptions,
    sourceAnchorIds: row.source_anchor_ids,
  }
}

async function latestReviews(exec: Queryable, runId: string): Promise<ReviewRow[]> {
  const result = await exec.query(
    `SELECT DISTINCT ON (candidate_id) * FROM ai_candidate_reviews
     WHERE run_id=$1 ORDER BY candidate_id,review_version DESC`, [runId],
  )
  return result.rows as ReviewRow[]
}

async function loadPreview(exec: Queryable, organizationId: string, caseId: string, runId: string,
  lock = false): Promise<PreviewData | undefined> {
  const runResult = await exec.query(
    `SELECT id,version,source_bundle_id,status FROM ai_extraction_runs
     WHERE organization_id=$1 AND case_id=$2 AND id=$3${lock ? ' FOR UPDATE' : ''}`,
    [organizationId, caseId, runId],
  )
  const run = runResult.rows[0] as { version: number; source_bundle_id: string; status: string } | undefined
  if (run === undefined) return undefined
  if (run.status !== 'review_required') throw new PolicyAiReviewStoreError('state_conflict')

  const candidatesResult = await exec.query(
    `SELECT * FROM ai_extraction_candidates WHERE organization_id=$1 AND case_id=$2 AND run_id=$3
     ORDER BY category,canonical_field,candidate_id`, [organizationId, caseId, runId],
  )
  const candidates = candidatesResult.rows as CandidateRow[]
  const reviews = await latestReviews(exec, runId)
  const facts = reviews.map(toReviewFact)
  const readiness = evaluatePolicyAiPromotionReadiness(candidates.map((item) => item.candidate_id), facts)
  const reviewSetHash = buildPolicyAiReviewSetHash(runId, facts)
  const selected = reviews.filter((review) => review.action === 'accepted' || review.action === 'edited')
  const anchors = [...new Set(selected.flatMap((review) => review.source_anchor_ids))]

  const sourcesResult = await exec.query(
    `SELECT DISTINCT i.document_id,i.document_version_id,d.document_type
     FROM ai_source_bundle_items i JOIN documents d
       ON d.organization_id=i.organization_id AND d.case_id=i.case_id AND d.id=i.document_id
     WHERE i.organization_id=$1 AND i.case_id=$2 AND i.bundle_id=$3
     ORDER BY i.document_id,i.document_version_id`, [organizationId, caseId, run.source_bundle_id],
  )
  const sources = sourcesResult.rows as Array<{ document_id: string; document_version_id: string; document_type: string }>
  const policySources = sources.filter((source) => source.document_type === 'casco_policy')
  const blockers: string[] = [...readiness.blockers]
  const priorPromotion = await exec.query(
    'SELECT 1 FROM ai_candidate_promotions WHERE organization_id=$1 AND case_id=$2 AND run_id=$3 AND review_set_hash=$4 LIMIT 1',
    [organizationId, caseId, runId, reviewSetHash],
  )
  if (priorPromotion.rowCount !== 0) blockers.push('AI_REVIEW_SET_ALREADY_PROMOTED')
  let sourceDocumentId: string | null = null
  let sourceDocumentVersionId: string | null = null
  if (policySources.length !== 1) blockers.push('AI_PROMOTION_SOURCE_AMBIGUOUS')
  else {
    sourceDocumentId = policySources[0]!.document_id
    sourceDocumentVersionId = policySources[0]!.document_version_id
  }

  let targetAnalysisId: string | null = null
  let targetAnalysisVersion: number | null = null
  let nextAnalysisVersion = 1
  if (sourceDocumentId !== null) {
    const targetResult = await exec.query(
      `SELECT a.id,a.version,coalesce(max(v.analysis_version),0)::int max_analysis_version
       FROM policy_analyses a LEFT JOIN policy_analysis_versions v ON v.analysis_id=a.id
       WHERE a.organization_id=$1 AND a.case_id=$2 AND a.source_document_id=$3
       GROUP BY a.id,a.version ORDER BY a.created_at,a.id`, [organizationId, caseId, sourceDocumentId],
    )
    if (targetResult.rows.length > 1) blockers.push('AI_PROMOTION_TARGET_AMBIGUOUS')
    else if (targetResult.rows.length === 1) {
      const target = targetResult.rows[0] as { id: string; version: number; max_analysis_version: number }
      targetAnalysisId = target.id
      targetAnalysisVersion = target.version
      nextAnalysisVersion = target.max_analysis_version + 1
    }
  }

  const conflictsResult = await exec.query('SELECT count(*)::int n FROM ai_candidate_conflicts WHERE run_id=$1', [runId])
  const conflictCount = Number((conflictsResult.rows[0] as { n: number }).n)
  const warnings: string[] = []
  if (readiness.rejectedCount > 0) warnings.push('AI_REJECTED_CANDIDATES_EXCLUDED')
  if (readiness.controlRequiredCount > 0) warnings.push('AI_CONTROL_REQUIRED_CANDIDATES_EXCLUDED')
  if (conflictCount > 0) warnings.push('AI_CANDIDATE_CONFLICTS_PRESERVED')

  const preview = policyAiPromotionPreviewResponseSchema.parse({ preview: {
    schemaVersion: POLICY_AI_PROMOTION_SCHEMA_VERSION,
    runId,
    runVersion: run.version,
    reviewSetHash,
    totalCandidateCount: candidates.length,
    acceptedCount: readiness.acceptedCount,
    editedCount: readiness.editedCount,
    rejectedCount: readiness.rejectedCount,
    controlRequiredCount: readiness.controlRequiredCount,
    pendingCount: readiness.pendingCount,
    promotableCount: selected.length,
    sourceCount: anchors.length,
    conflictCount,
    preservedConflictCount: conflictCount,
    canPromote: blockers.length === 0,
    blockers,
    warnings,
    targetAnalysisId,
    targetAnalysisVersion,
    nextAnalysisVersion,
  } }).preview
  return { preview, run, candidates, reviews, sourceDocumentId, sourceDocumentVersionId }
}

async function idempotentWrite<T>(pool: pg.Pool, actor: PolicyAiReviewActor, caseId: string,
  idem: PolicyAiReviewIdempotency, status: number, work: (client: pg.PoolClient) => Promise<T>): Promise<PolicyAiReviewCommandResult<T>> {
  return withTransaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${actor.organizationId}:${idem.scope}:${idem.key}`])
    const replay = await findIdempotent(client, actor.organizationId, idem.scope, idem.key)
    if (replay !== undefined) {
      if (replay.requestHash !== idem.requestHash) throw new PolicyAiReviewStoreError('idempotency_conflict')
      return { replay: true, status: replay.responseStatus, body: replay.responseBody as T }
    }
    const body = await work(client)
    await insertIdempotent(client, { organizationId: actor.organizationId, scope: idem.scope, key: idem.key,
      requestHash: idem.requestHash, responseStatus: status, responseBody: body, caseId })
    return { replay: false, status, body }
  })
}

export function createPolicyAiReviewStore(pool: pg.Pool): PolicyAiReviewStore {
  return {
    async review(actor, caseId, runId, candidateId, input, idem) {
      return idempotentWrite(pool, actor, caseId, idem, 200, async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${runId}:${candidateId}`])
        const runResult = await client.query(
          `SELECT source_bundle_id,status FROM ai_extraction_runs
           WHERE organization_id=$1 AND case_id=$2 AND id=$3 FOR UPDATE`, [actor.organizationId, caseId, runId],
        )
        const run = runResult.rows[0] as { source_bundle_id: string; status: string } | undefined
        if (run === undefined) throw new PolicyAiReviewStoreError('not_found')
        if (run.status !== 'review_required') throw new PolicyAiReviewStoreError('state_conflict')
        const candidateResult = await client.query(
          `SELECT * FROM ai_extraction_candidates WHERE organization_id=$1 AND case_id=$2 AND run_id=$3 AND candidate_id=$4`,
          [actor.organizationId, caseId, runId, candidateId],
        )
        const candidate = candidateResult.rows[0] as CandidateRow | undefined
        if (candidate === undefined) throw new PolicyAiReviewStoreError('not_found')
        const currentResult = await client.query(
          'SELECT coalesce(max(review_version),0)::int version FROM ai_candidate_reviews WHERE run_id=$1 AND candidate_id=$2',
          [runId, candidateId],
        )
        const currentVersion = Number((currentResult.rows[0] as { version: number }).version)
        if (currentVersion !== input.expectedReviewVersion) throw new PolicyAiReviewStoreError('review_stale')
        const sourceResult = await client.query(
          `SELECT i.* FROM ai_candidate_source_links l JOIN ai_source_bundle_items i
             ON i.organization_id=l.organization_id AND i.case_id=l.case_id AND i.bundle_id=l.bundle_id AND i.source_anchor_id=l.source_anchor_id
           WHERE l.organization_id=$1 AND l.case_id=$2 AND l.run_id=$3 AND l.candidate_id=$4 ORDER BY i.source_anchor_id`,
          [actor.organizationId, caseId, runId, candidateId],
        )
        const sources: PolicyAiSourceBundleItem[] = sourceResult.rows.map((row: Record<string, unknown>) => ({
          sourceAnchorId: String(row.source_anchor_id), sourceType: row.source_type as 'pdf_text' | 'ocr',
          documentId: String(row.document_id), documentVersionId: String(row.document_version_id),
          extractionId: String(row.extraction_id), sourceItemId: String(row.source_item_id),
          pageNumber: Number(row.page_number), text: String(row.source_text), textHash: String(row.text_hash),
          sourceQuality: row.source_quality as PolicyAiSourceQuality, warnings: row.warnings as string[],
          historicalSelected: Boolean(row.historical_selected),
        }))
        const anchorIds = sources.map((source) => source.sourceAnchorId)
        const original = candidateInput(candidate, anchorIds)
        const edited = input.action === 'edited'
          ? candidateInput(candidate, anchorIds, input)
          : original
        const decision = evaluatePolicyAiHumanReview(original, input.action, edited, sources, candidate.validation_status)
        if (!decision.allowed) throw new PolicyAiReviewStoreError('review_conflict')
        const reviewVersion = currentVersion + 1
        const reviewId = uuidv7()
        const reviewedAt = new Date()
        await client.query(
          `INSERT INTO ai_candidate_reviews
           (id,organization_id,case_id,run_id,candidate_id,review_version,schema_version,action,normalized_value,
            original_value,conditions,exceptions,source_anchor_ids,reason,evidence_status,reviewed_by_user_id,reviewed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17)`,
          [reviewId, actor.organizationId, caseId, runId, candidateId, reviewVersion, POLICY_AI_REVIEW_SCHEMA_VERSION,
            input.action, JSON.stringify(edited.normalizedValue), edited.originalValue, JSON.stringify(edited.conditions),
            JSON.stringify(edited.exceptions), anchorIds, input.reason, decision.evidence.status, actor.actorUserId, reviewedAt],
        )
        const review = toReview({
          run_id: runId, candidate_id: candidateId, review_version: reviewVersion, action: input.action,
          normalized_value: edited.normalizedValue, original_value: edited.originalValue,
          conditions: [...edited.conditions], exceptions: [...edited.exceptions], source_anchor_ids: anchorIds,
          reason: input.reason, evidence_status: decision.evidence.status, reviewed_by_user_id: actor.actorUserId,
          reviewed_at: reviewedAt,
        })
        await audit.record(client, { organizationId: actor.organizationId, actorUserId: actor.actorUserId,
          action: `policy_ai_candidate.${input.action}`, entityType: 'policy_ai_candidate', entityId: reviewId,
          requestId: actor.requestId, details: { caseId, runId, candidateId, reviewVersion, action: input.action,
            evidenceStatus: decision.evidence.status, sourceCount: anchorIds.length } })
        return policyAiCandidateReviewResponseSchema.parse({ review })
      })
    },

    async preview(organizationId, caseId, runId) {
      const value = await loadPreview(pool, organizationId, caseId, runId)
      return value === undefined ? undefined : { preview: value.preview }
    },

    async promote(actor, caseId, runId, input, idem) {
      return idempotentWrite(pool, actor, caseId, idem, 201, async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`promotion:${runId}`])
        const data = await loadPreview(client, actor.organizationId, caseId, runId, true)
        if (data === undefined) throw new PolicyAiReviewStoreError('not_found')
        if (data.preview.runVersion !== input.expectedRunVersion || data.preview.reviewSetHash !== input.expectedReviewSetHash)
          throw new PolicyAiReviewStoreError('promotion_stale')
        if (data.preview.targetAnalysisId !== input.expectedAnalysisId || data.preview.targetAnalysisVersion !== input.expectedAnalysisVersion)
          throw new PolicyAiReviewStoreError('promotion_stale')
        if (!data.preview.canPromote || data.sourceDocumentId === null || data.sourceDocumentVersionId === null)
          throw new PolicyAiReviewStoreError('promotion_blocked')

        const promotedReviews = data.reviews.filter((review) => review.action === 'accepted' || review.action === 'edited')
        const candidateById = new Map(data.candidates.map((candidate) => [candidate.candidate_id, candidate]))
        const sourceResult = await client.query(
          `SELECT i.* FROM ai_source_bundle_items i WHERE i.organization_id=$1 AND i.case_id=$2 AND i.bundle_id=$3
           ORDER BY i.ordinal,i.source_anchor_id`, [actor.organizationId, caseId, data.run.source_bundle_id],
        )
        const sourceByAnchor = new Map((sourceResult.rows as Record<string, unknown>[]).map((row) => [String(row.source_anchor_id), row]))
        let analysisId = input.expectedAnalysisId
        let analysisVersion = data.preview.nextAnalysisVersion
        const analysisVersionId = uuidv7()
        const createdAnalysis = analysisId === null
        if (analysisId === null) {
          analysisId = uuidv7()
          const caseResult = await client.query('SELECT insurer_id FROM cases WHERE organization_id=$1 AND id=$2', [actor.organizationId, caseId])
          const caseRow = caseResult.rows[0] as { insurer_id: string | null } | undefined
          if (caseRow === undefined) throw new PolicyAiReviewStoreError('not_found')
          await client.query(
            `INSERT INTO policy_analyses
             (id,organization_id,case_id,insurer_id,source_document_id,source_document_version_id,created_by_user_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [analysisId, actor.organizationId, caseId, caseRow.insurer_id, data.sourceDocumentId,
              data.sourceDocumentVersionId, actor.actorUserId],
          )
          analysisVersion = 1
        } else {
          const locked = await client.query(
            'SELECT current_version_id,version FROM policy_analyses WHERE organization_id=$1 AND case_id=$2 AND id=$3 FOR UPDATE',
            [actor.organizationId, caseId, analysisId],
          )
          const target = locked.rows[0] as { current_version_id: string; version: number } | undefined
          if (target === undefined || target.version !== input.expectedAnalysisVersion)
            throw new PolicyAiReviewStoreError('promotion_stale')
          const previous = await client.query('SELECT analysis_status FROM policy_analysis_versions WHERE id=$1', [target.current_version_id])
          if ((previous.rows[0] as { analysis_status: string }).analysis_status === 'approved') {
            await client.query("UPDATE policy_analysis_versions SET analysis_status='superseded',is_active=false WHERE id=$1", [target.current_version_id])
          }
        }

        const conflictResult = await client.query('SELECT * FROM ai_candidate_conflicts WHERE run_id=$1 ORDER BY created_at,id', [runId])
        const promotedIds = new Set(promotedReviews.map((review) => review.candidate_id))
        const promotableConflicts = (conflictResult.rows as Array<Record<string, unknown>>).filter((row) =>
          row.status !== 'duplicate' && promotedIds.has(String(row.left_candidate_id)) && promotedIds.has(String(row.right_candidate_id)))
        const sourceCompleteness = data.preview.rejectedCount === 0 && data.preview.controlRequiredCount === 0
          && promotedReviews.every((review) => review.evidence_status === 'validated') ? 'complete' : 'partial'
        const analysisStatus = promotableConflicts.length > 0 ? 'conflict_detected' : sourceCompleteness === 'complete' ? 'draft' : 'control_required'
        await client.query(
          `INSERT INTO policy_analysis_versions
           (id,organization_id,case_id,analysis_id,source_document_id,source_document_version_id,analysis_version,
            analysis_status,source_completeness,human_approval_status,is_active,created_by_user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',false,$10)`,
          [analysisVersionId, actor.organizationId, caseId, analysisId, data.sourceDocumentId,
            data.sourceDocumentVersionId, analysisVersion, analysisStatus, sourceCompleteness, actor.actorUserId],
        )

        const sourceReferenceByFactAnchor = new Map<string, string>()
        const factByCandidate = new Map<string, string>()
        for (const review of promotedReviews) {
          const candidate = candidateById.get(review.candidate_id)
          if (candidate === undefined) throw new PolicyAiReviewStoreError('promotion_stale')
          const factId = uuidv7()
          factByCandidate.set(review.candidate_id, factId)
          await client.query(
            `INSERT INTO policy_analysis_ai_facts
             (id,organization_id,case_id,analysis_version_id,category,canonical_field,normalized_value,original_value,
              conditions,exceptions,review_action,origin_run_id,origin_candidate_id,origin_review_version,source_anchor_ids,
              provider_confidence,source_quality,provider_id,provider_version,model_id,reviewed_by_user_id,reviewed_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
            [factId, actor.organizationId, caseId, analysisVersionId, candidate.category, candidate.canonical_field,
              JSON.stringify(review.normalized_value), review.original_value, JSON.stringify(review.conditions),
              JSON.stringify(review.exceptions), review.action, runId, review.candidate_id, review.review_version,
              review.source_anchor_ids, Number(candidate.provider_confidence), candidate.source_quality, candidate.provider_id,
              candidate.provider_version, candidate.model_id, review.reviewed_by_user_id, review.reviewed_at],
          )
          for (const anchorId of review.source_anchor_ids) {
            const source = sourceByAnchor.get(anchorId)
            if (source === undefined) throw new PolicyAiReviewStoreError('promotion_stale')
            const excerpt = boundedExcerpt(String(source.source_text), review.original_value)
            const sourceReferenceId = uuidv7()
            sourceReferenceByFactAnchor.set(`${review.candidate_id}:${anchorId}`, sourceReferenceId)
            await client.query(
              `INSERT INTO policy_source_references
               (id,organization_id,case_id,analysis_version_id,document_id,document_version_id,page_number,
                section_heading,clause_identifier,raw_excerpt,excerpt_hash,locator,source_type,confidence)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'policy',$13)`,
              [sourceReferenceId, actor.organizationId, caseId, analysisVersionId, source.document_id,
                source.document_version_id, source.page_number, 'AI insan incelemesi', candidate.canonical_field,
                excerpt, excerptHash(excerpt), `ai-source-anchor:${anchorId}`, Number(candidate.provider_confidence)],
            )
            await client.query(
              `INSERT INTO policy_evidence_links
               (id,organization_id,case_id,analysis_version_id,owner_type,owner_id,source_reference_id)
               VALUES ($1,$2,$3,$4,'ai_candidate_fact',$5,$6)`,
              [uuidv7(), actor.organizationId, caseId, analysisVersionId, factId, sourceReferenceId],
            )
          }
        }

        const promotionId = uuidv7()
        const promotedAt = new Date()
        await client.query(
          `INSERT INTO ai_candidate_promotions
           (id,organization_id,case_id,run_id,schema_version,review_set_hash,analysis_id,analysis_version_id,
            analysis_version,promoted_candidate_count,preserved_conflict_count,promoted_by_user_id,promoted_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [promotionId, actor.organizationId, caseId, runId, POLICY_AI_PROMOTION_SCHEMA_VERSION,
            data.preview.reviewSetHash, analysisId, analysisVersionId, analysisVersion, promotedReviews.length,
            data.preview.preservedConflictCount, actor.actorUserId, promotedAt],
        )
        for (const review of promotedReviews) await client.query(
          `INSERT INTO ai_candidate_promotion_items
           (organization_id,case_id,promotion_id,run_id,candidate_id,review_version,policy_fact_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [actor.organizationId, caseId, promotionId, runId, review.candidate_id, review.review_version,
            factByCandidate.get(review.candidate_id)],
        )

        for (const row of conflictResult.rows as Array<Record<string, unknown>>) {
          let policyConflictId: string | null = null
          const leftCandidateId = String(row.left_candidate_id)
          const rightCandidateId = String(row.right_candidate_id)
          if (row.status !== 'duplicate' && promotedIds.has(leftCandidateId) && promotedIds.has(rightCandidateId)) {
            const leftReview = promotedReviews.find((review) => review.candidate_id === leftCandidateId)!
            const rightReview = promotedReviews.find((review) => review.candidate_id === rightCandidateId)!
            const sourceA = sourceReferenceByFactAnchor.get(`${leftCandidateId}:${leftReview.source_anchor_ids[0]}`)
            const sourceB = sourceReferenceByFactAnchor.get(`${rightCandidateId}:${rightReview.source_anchor_ids[0]}`)
            if (sourceA !== undefined && sourceB !== undefined && sourceA !== sourceB) {
              policyConflictId = uuidv7()
              const leftCandidate = candidateById.get(leftCandidateId)!
              await client.query(
                `INSERT INTO policy_conflicts
                 (id,organization_id,case_id,analysis_id,analysis_version_id,conflict_type,affected_topic,
                  source_a_id,source_b_id,explanation,severity)
                 VALUES ($1,$2,$3,$4,$5,'ai_candidate_conflict',$6,$7,$8,$9,$10)`,
                [policyConflictId, actor.organizationId, caseId, analysisId, analysisVersionId,
                  leftCandidate.canonical_field, sourceA, sourceB, String(row.reason),
                  row.status === 'conflict_detected' ? 'high' : 'medium'],
              )
            }
          }
          await client.query(
            `INSERT INTO ai_candidate_promotion_conflicts
             (organization_id,case_id,promotion_id,run_id,conflict_id,left_candidate_id,right_candidate_id,status,reason,promoted_policy_conflict_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [actor.organizationId, caseId, promotionId, runId, row.id, leftCandidateId, rightCandidateId,
              row.status, row.reason, policyConflictId],
          )
        }

        await client.query(
          `UPDATE policy_analyses SET source_document_id=$1,source_document_version_id=$2,current_version_id=$3,
           version=CASE WHEN $5 THEN version ELSE version+1 END,updated_at=now() WHERE id=$4`,
          [data.sourceDocumentId, data.sourceDocumentVersionId, analysisVersionId, analysisId, createdAnalysis],
        )
        const promotion = policyAiPromotionResponseSchema.parse({ promotion: {
          id: promotionId, schemaVersion: POLICY_AI_PROMOTION_SCHEMA_VERSION, runId,
          reviewSetHash: data.preview.reviewSetHash, analysisId, analysisVersionId, analysisVersion,
          promotedCandidateCount: promotedReviews.length, preservedConflictCount: data.preview.preservedConflictCount,
          promotedByUserId: actor.actorUserId, promotedAt: iso(promotedAt),
        } }).promotion
        await audit.record(client, { organizationId: actor.organizationId, actorUserId: actor.actorUserId,
          action: 'policy_ai_candidate.promoted', entityType: 'policy_ai_candidate_promotion', entityId: promotionId,
          requestId: actor.requestId, details: { caseId, runId, analysisId, analysisVersionId, analysisVersion,
            promotedCandidateCount: promotedReviews.length, preservedConflictCount: data.preview.preservedConflictCount,
            sourceCount: data.preview.sourceCount, status: analysisStatus } })
        await audit.record(client, { organizationId: actor.organizationId, actorUserId: actor.actorUserId,
          action: 'policy_analysis.version_created', entityType: 'policy_analysis', entityId: analysisId,
          requestId: actor.requestId, details: { caseId, analysisVersion, sourceDocumentId: data.sourceDocumentId,
            sourceDocumentVersionId: data.sourceDocumentVersionId, sourceReferenceCount: data.preview.sourceCount,
            conflictCount: promotableConflicts.length, status: analysisStatus, origin: 'ai_candidate_human_review' } })
        return policyAiPromotionResponseSchema.parse({ promotion })
      })
    },
  }
}
