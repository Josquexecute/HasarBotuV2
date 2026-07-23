import { createHash } from 'node:crypto'
import type pg from 'pg'
import { uuidv7 } from '@hasarbotu/database'
import {
  canonicalValueLossJson,
  evaluateRealMarketValueLoss,
  evaluateTrafficValueLoss,
  listRealMarketPartRules,
  parseLocalDate,
  selectTrafficValueLossRule,
  type RealMarketValueLossInput,
  type TrafficValueLossEvidenceFact,
  type TrafficValueLossInput,
  type ValueLossVehicleGroupCode,
} from '@hasarbotu/domain'
import {
  trafficValueLossAssessmentSchema,
  trafficValueLossEvaluationSchema,
  trafficValueLossInputSnapshotSchema,
  trafficValueLossPartCatalogResponseSchema,
  trafficValueLossPreviewResponseSchema,
  trafficValueLossVersionSchema,
  type TrafficValueLossApproveRequest,
  type TrafficValueLossAssessmentDto,
  type TrafficValueLossPartCatalogResponse,
  type TrafficValueLossPreviewResponse,
  type TrafficValueLossRejectRequest,
  type TrafficValueLossSubmitRequest,
  type TrafficValueLossVersionCreateRequest,
  type TrafficValueLossVersionDto,
} from '@hasarbotu/contracts'
import { createAuditService } from '../audit/service.js'
import { findIdempotent, insertIdempotent } from '../db/idempotency.js'
import { withTransaction, type Queryable } from '../db/executor.js'
import { realMarketValueLossRuleSnapshot } from './rule-source.js'

interface Actor { readonly organizationId: string; readonly actorUserId: string; readonly requestId: string }
interface Idempotency { readonly scope: string; readonly key: string; readonly requestHash: string }
interface Result<T> { readonly replay: boolean; readonly status: number; readonly body: T | unknown }

export interface TrafficValueLossStore {
  find(organizationId: string, caseId: string): Promise<TrafficValueLossAssessmentDto | undefined>
  currentApproved(organizationId: string, caseId: string): Promise<TrafficValueLossVersionDto | undefined>
  versions(organizationId: string, caseId: string): Promise<readonly TrafficValueLossVersionDto[] | undefined>
  preview(
    actor: Actor,
    caseId: string,
    input: TrafficValueLossVersionCreateRequest,
  ): Promise<TrafficValueLossPreviewResponse>
  partCatalog(
    organizationId: string,
    caseId: string,
    vehicleGroupCode: ValueLossVehicleGroupCode,
  ): Promise<TrafficValueLossPartCatalogResponse | undefined>
  createVersion(
    actor: Actor,
    caseId: string,
    input: TrafficValueLossVersionCreateRequest,
    idem: Idempotency,
  ): Promise<Result<{ readonly assessment: TrafficValueLossAssessmentDto }>>
  submit(
    actor: Actor,
    caseId: string,
    versionId: string,
    input: TrafficValueLossSubmitRequest,
    idem: Idempotency,
  ): Promise<Result<{ readonly assessment: TrafficValueLossAssessmentDto }>>
  approve(
    actor: Actor,
    caseId: string,
    versionId: string,
    input: TrafficValueLossApproveRequest,
    idem: Idempotency,
  ): Promise<Result<{ readonly assessment: TrafficValueLossAssessmentDto }>>
  reject(
    actor: Actor,
    caseId: string,
    versionId: string,
    input: TrafficValueLossRejectRequest,
    idem: Idempotency,
  ): Promise<Result<{ readonly assessment: TrafficValueLossAssessmentDto }>>
}

export type TrafficValueLossStoreErrorCode =
  | 'not_found'
  | 'wrong_case_type'
  | 'invalid_source'
  | 'version_conflict'
  | 'state_conflict'
  | 'approval_blocked'
  | 'rule_selection_required'
  | 'rule_input_required'
  | 'preview_mismatch'
  | 'idempotency_conflict'

export class TrafficValueLossStoreError extends Error {
  constructor(readonly code: TrafficValueLossStoreErrorCode) { super(code) }
}

function date(value: Date | string | null): string | null {
  if (value === null) return null
  return typeof value === 'string'
    ? value.slice(0, 10)
    : `${String(value.getFullYear()).padStart(4, '0')}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}
function domainDate(value: string) {
  const parsed = parseLocalDate(value)
  if (!parsed.ok) throw new TrafficValueLossStoreError('state_conflict')
  return parsed.value
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function orderedByCanonicalValue<T>(items: readonly T[]): T[] {
  return [...items].sort((left, right) =>
    compareText(canonicalValueLossJson(left), canonicalValueLossJson(right)),
  )
}

function canonicalPreviewInput(input: TrafficValueLossVersionCreateRequest): unknown {
  return {
    ...input,
    confirmedPreviewHash: null,
    damageParts: orderedByCanonicalValue(input.damageParts),
    comparables: orderedByCanonicalValue(input.comparables),
    evidence: orderedByCanonicalValue(input.evidence.map((item) => ({
      ...item,
      supports: [...item.supports].sort(compareText),
    }))),
    realMarket: input.realMarket === null
      ? null
      : {
          ...input.realMarket,
          parts: orderedByCanonicalValue(input.realMarket.parts),
          prefillProvenance: orderedByCanonicalValue(input.realMarket.prefillProvenance),
        },
  }
}

export function createTrafficValueLossPreviewHash(input: {
  readonly organizationId: string
  readonly caseId: string
  readonly request: TrafficValueLossVersionCreateRequest
  readonly evaluation: unknown
}): string {
  return createHash('sha256').update(canonicalValueLossJson({
    organizationId: input.organizationId,
    caseId: input.caseId,
    ruleSetId: (input.evaluation as { readonly ruleSetId?: unknown }).ruleSetId,
    ruleVersion: (input.evaluation as { readonly ruleVersion?: unknown }).ruleVersion,
    input: canonicalPreviewInput(input.request),
    evaluation: input.evaluation,
  })).digest('hex')
}

export async function loadTrafficValueLossVersion(exec: Queryable, organizationId: string, caseId: string, versionId: string): Promise<TrafficValueLossVersionDto | undefined> {
  const versionResult = await exec.query(
    'SELECT * FROM traffic_value_loss_versions WHERE organization_id=$1 AND case_id=$2 AND id=$3',
    [organizationId, caseId, versionId],
  )
  const row = versionResult.rows[0] as Record<string, unknown> | undefined
  if (row === undefined) return undefined
  const evidenceResult = await exec.query('SELECT * FROM traffic_value_loss_evidence WHERE version_id=$1 ORDER BY evidence_key', [versionId])
  const comparableResult = await exec.query('SELECT * FROM traffic_value_loss_comparables WHERE version_id=$1 ORDER BY side,comparable_key', [versionId])
  const evidence = evidenceResult.rows.map((item: Record<string, unknown>) => ({
    id: item.id,
    evidenceKey: item.evidence_key,
    sourceType: item.source_type,
    documentId: item.document_id,
    documentVersionId: item.document_version_id,
    externalReference: item.external_reference,
    sourceHash: item.source_hash,
    observedAt: date(item.observed_at as Date | string | null),
    supports: item.supports,
    verificationStatus: item.verification_status,
    conflict: item.conflict,
    notes: item.notes,
    createdAt: (item.created_at as Date).toISOString(),
  }))
  return trafficValueLossVersionSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    caseId: row.case_id,
    calculationId: row.assessment_id,
    revisionId: row.id,
    assessmentVersion: row.assessment_version,
    status: row.status,
    ruleSetId: row.rule_set_id,
    ruleVersion: row.rule_version,
    effectiveFrom: date(row.effective_from as Date | string),
    input: trafficValueLossInputSnapshotSchema.parse(row.input_snapshot),
    evaluation: trafficValueLossEvaluationSchema.parse(row.result_snapshot),
    evidence,
    comparables: comparableResult.rows.map((item: Record<string, unknown>) => ({
      id: item.id,
      comparableKey: item.comparable_key,
      side: item.side,
      amountMinor: Number(item.amount_minor),
      mileage: item.mileage,
      observedAt: date(item.observed_at as Date | string),
      evidenceId: item.evidence_id,
      excluded: item.excluded,
      exclusionReason: item.exclusion_reason,
    })),
    humanApprovalStatus: row.human_approval_status,
    approvedBy: row.approved_by_user_id,
    approvedAt: row.approved_at instanceof Date ? row.approved_at.toISOString() : row.approved_at,
    approvalReason: row.approval_reason,
    createdBy: row.created_by_user_id,
    createdAt: (row.created_at as Date).toISOString(),
  })
}

async function loadAssessment(exec: Queryable, organizationId: string, caseId: string): Promise<TrafficValueLossAssessmentDto | undefined> {
  const result = await exec.query(
    'SELECT * FROM traffic_value_loss_assessments WHERE organization_id=$1 AND case_id=$2',
    [organizationId, caseId],
  )
  const row = result.rows[0] as Record<string, unknown> | undefined
  if (row === undefined || row.current_version_id === null) return undefined
  const currentVersion = await loadTrafficValueLossVersion(exec, organizationId, caseId, String(row.current_version_id))
  if (currentVersion === undefined) return undefined
  return trafficValueLossAssessmentSchema.parse({
    id: row.id,
    caseId: row.case_id,
    currentVersion,
    version: row.version,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  })
}

async function idempotentWrite<T>(
  pool: pg.Pool,
  actor: Actor,
  caseId: string,
  idem: Idempotency,
  responseStatus: number,
  writer: (client: pg.PoolClient) => Promise<T>,
): Promise<Result<T>> {
  const existing = await findIdempotent(pool, actor.organizationId, idem.scope, idem.key)
  if (existing !== undefined) {
    if (existing.requestHash !== idem.requestHash) throw new TrafficValueLossStoreError('idempotency_conflict')
    return { replay: true, status: existing.responseStatus, body: existing.responseBody }
  }
  return withTransaction(pool, async (client) => {
    const replay = await findIdempotent(client, actor.organizationId, idem.scope, idem.key)
    if (replay !== undefined) {
      if (replay.requestHash !== idem.requestHash) throw new TrafficValueLossStoreError('idempotency_conflict')
      return { replay: true, status: replay.responseStatus, body: replay.responseBody }
    }
    const body = await writer(client)
    await insertIdempotent(client, {
      organizationId: actor.organizationId,
      scope: idem.scope,
      key: idem.key,
      requestHash: idem.requestHash,
      responseStatus,
      responseBody: body,
      caseId,
    })
    return { replay: false, status: responseStatus, body }
  })
}

async function validateEvidence(
  client: Queryable,
  organizationId: string,
  caseId: string,
  input: TrafficValueLossVersionCreateRequest,
): Promise<Map<string, string>> {
  const ids = new Map<string, string>()
  for (const item of input.evidence) {
    const id = uuidv7()
    ids.set(item.evidenceKey, id)
    if (item.sourceType !== 'document_version') continue
    const result = await client.query(
      `SELECT dv.content_hash,dv.status,dv.hash_verified,dv.size_verified,dv.verified_at
       FROM document_versions dv
       JOIN documents d ON d.id=dv.document_id AND d.organization_id=dv.organization_id AND d.case_id=dv.case_id
       WHERE dv.organization_id=$1 AND dv.case_id=$2 AND d.id=$3 AND dv.id=$4`,
      [organizationId, caseId, item.documentId, item.documentVersionId],
    )
    const row = result.rows[0] as { content_hash: string; status: string; hash_verified: boolean; size_verified: boolean; verified_at: Date | null } | undefined
    if (row === undefined || row.status !== 'ready' || !row.hash_verified || !row.size_verified || row.verified_at === null || row.content_hash !== item.sourceHash) {
      throw new TrafficValueLossStoreError('invalid_source')
    }
  }
  return ids
}

interface CaseRuleFacts {
  readonly case_type: 'traffic' | 'casco'
  readonly loss_date: Date | string | null
  readonly notification_date: Date | string | null
}

async function evaluateVersionInput(
  client: Queryable,
  actor: Actor,
  caseId: string,
  caseRow: CaseRuleFacts,
  input: TrafficValueLossVersionCreateRequest,
) {
  const evidenceIds = await validateEvidence(client, actor.organizationId, caseId, input)
  const lossDate = date(caseRow.loss_date)
  const notificationDate = date(caseRow.notification_date)
  const selected = selectTrafficValueLossRule(
    lossDate === null ? null : domainDate(lossDate),
    input.ruleOverride,
  )
  if (selected.status !== 'selected') {
    throw new TrafficValueLossStoreError('rule_selection_required')
  }
  for (const provenance of input.realMarket?.prefillProvenance ?? []) {
    if (provenance.source === 'case') {
      if (provenance.field !== 'accidentDate'
        || provenance.sourceRevisionId !== null
        || provenance.originalValue !== lossDate
        || provenance.newValue !== lossDate) {
        throw new TrafficValueLossStoreError('invalid_source')
      }
      continue
    }
    if (provenance.source !== 'user_input' || provenance.sourceRevisionId !== null) {
      // Henüz bu akışa bağlanmış onaylı upstream revision tablosu yoktur.
      // İstemcinin "approved_*" etiketiyle kanıt uydurmasına izin verilmez.
      throw new TrafficValueLossStoreError('invalid_source')
    }
  }
  const domainEvidence: TrafficValueLossEvidenceFact[] = input.evidence.map((item) => ({
    evidenceKey: item.evidenceKey,
    sourceType: item.sourceType,
    sourceHash: item.sourceHash,
    supports: item.supports,
    verificationStatus: item.verificationStatus,
    conflict: item.conflict,
  }))
  const domainComparables = input.comparables.map((item) => ({
    ...item,
    observedAt: domainDate(item.observedAt),
  }))
  const evaluation = selected.kind === 'legacy'
    ? trafficValueLossEvaluationSchema.parse(evaluateTrafficValueLoss({
        caseType: 'traffic',
        // Legacy evaluator kendi dönem kapısını taşır; selector önceki sürümü seçtiği
        // için değerlendirme bu sürümün sabit effective date'iyle çalıştırılır.
        lossDate: selected.effectiveFrom,
        evaluatedOn: domainDate(input.evaluatedOn),
        heavyOrTotalDamage: input.heavyOrTotalDamage,
        vehicle: input.vehicle,
        faultRateBasisPoints: input.faultRateBasisPoints,
        preAccidentMarketValueMinor: input.preAccidentMarketValueMinor,
        postRepairMarketValueMinor: input.postRepairMarketValueMinor,
        damageParts: input.damageParts,
        comparables: domainComparables,
        evidence: domainEvidence,
      } satisfies TrafficValueLossInput))
    : (() => {
        if (input.realMarket === null) throw new TrafficValueLossStoreError('rule_input_required')
        const realMarketInput: RealMarketValueLossInput = {
          caseType: 'traffic',
          accidentDate: lossDate === null ? null : domainDate(lossDate),
          evaluatedOn: domainDate(input.evaluatedOn),
          vehicleType: input.realMarket.vehicleType,
          vehicleGroupCode: input.realMarket.vehicleGroupCode,
          modelYear: input.vehicle.modelYear,
          usageMetric: input.realMarket.usageMetric,
          usageValue: input.realMarket.usageValue,
          commercialOrRental: input.realMarket.commercialOrRental,
          previousDamageCount: input.realMarket.previousDamageCount,
          marketValueMinor: input.realMarket.marketValueMinor,
          damageAmountMinor: input.realMarket.damageAmountMinor,
          parts: input.realMarket.parts,
          eligibilityFacts: input.realMarket.eligibilityFacts,
          comparables: domainComparables,
          evidence: domainEvidence,
        }
        return trafficValueLossEvaluationSchema.parse(
          evaluateRealMarketValueLoss(realMarketValueLossRuleSnapshot, realMarketInput),
        )
      })()
  const changedAt = new Date().toISOString()
  const inputSnapshot = trafficValueLossInputSnapshotSchema.parse({
    lossDate,
    notificationDate,
    evaluatedOn: input.evaluatedOn,
    heavyOrTotalDamage: input.heavyOrTotalDamage,
    vehicle: input.vehicle,
    faultRateBasisPoints: input.faultRateBasisPoints,
    preAccidentMarketValueMinor: input.preAccidentMarketValueMinor,
    postRepairMarketValueMinor: input.postRepairMarketValueMinor,
    damageParts: input.damageParts,
    realMarket: input.realMarket,
    inputOverrides: input.realMarket?.prefillProvenance
      .filter((item) => item.source === 'user_input' && item.overrideReason !== null)
      .map((item) => ({
        field: item.field,
        originalValue: item.originalValue,
        newValue: item.newValue,
        reason: item.overrideReason ?? '',
        changedBy: actor.actorUserId,
        changedAt,
      })) ?? [],
    ruleOverride: input.ruleOverride === null
      ? null
      : {
          ...input.ruleOverride,
          authorizedBy: actor.actorUserId,
          authorizedAt: changedAt,
        },
  })
  const previewHash = createTrafficValueLossPreviewHash({
    organizationId: actor.organizationId,
    caseId,
    request: input,
    evaluation,
  })
  return { evidenceIds, evaluation, inputSnapshot, previewHash }
}

export function createTrafficValueLossStore(pool: pg.Pool): TrafficValueLossStore {
  const audit = createAuditService()
  return {
    async find(organizationId: string, caseId: string) {
      const exists = await pool.query('SELECT 1 FROM cases WHERE organization_id=$1 AND id=$2', [organizationId, caseId])
      if ((exists.rowCount ?? 0) === 0) return undefined
      return loadAssessment(pool, organizationId, caseId)
    },
    async currentApproved(organizationId: string, caseId: string) {
      const result = await pool.query(
        `SELECT id FROM traffic_value_loss_versions
         WHERE organization_id=$1 AND case_id=$2
           AND status='approved' AND human_approval_status='approved' AND is_active=true
         ORDER BY assessment_version DESC LIMIT 1`,
        [organizationId, caseId],
      )
      const row = result.rows[0] as { id: string } | undefined
      return row === undefined
        ? undefined
        : loadTrafficValueLossVersion(pool, organizationId, caseId, row.id)
    },
    async versions(organizationId: string, caseId: string) {
      const assessment = await pool.query('SELECT id FROM traffic_value_loss_assessments WHERE organization_id=$1 AND case_id=$2', [organizationId, caseId])
      const row = assessment.rows[0] as { id: string } | undefined
      if (row === undefined) return undefined
      const result = await pool.query('SELECT id FROM traffic_value_loss_versions WHERE assessment_id=$1 ORDER BY assessment_version DESC', [row.id])
      const versions: TrafficValueLossVersionDto[] = []
      for (const item of result.rows as Array<{ id: string }>) {
        const version = await loadTrafficValueLossVersion(pool, organizationId, caseId, item.id)
        if (version !== undefined) versions.push(version)
      }
      return versions
    },
    async preview(actor: Actor, caseId: string, input: TrafficValueLossVersionCreateRequest) {
      const caseResult = await pool.query(
        'SELECT case_type,loss_date,notification_date FROM cases WHERE organization_id=$1 AND id=$2',
        [actor.organizationId, caseId],
      )
      const caseRow = caseResult.rows[0] as CaseRuleFacts | undefined
      if (caseRow === undefined) throw new TrafficValueLossStoreError('not_found')
      if (caseRow.case_type !== 'traffic') throw new TrafficValueLossStoreError('wrong_case_type')
      const assessment = await pool.query(
        'SELECT version FROM traffic_value_loss_assessments WHERE organization_id=$1 AND case_id=$2',
        [actor.organizationId, caseId],
      )
      const assessmentVersion = (assessment.rows[0] as { version: number } | undefined)?.version ?? 0
      if (assessmentVersion !== input.expectedVersion) {
        throw new TrafficValueLossStoreError('version_conflict')
      }
      const { evaluation, inputSnapshot, previewHash } = await evaluateVersionInput(
        pool,
        actor,
        caseId,
        caseRow,
        input,
      )
      return trafficValueLossPreviewResponseSchema.parse({
        previewHash,
        ruleSetId: evaluation.ruleSetId,
        ruleVersion: evaluation.ruleVersion,
        input: inputSnapshot,
        evaluation,
      })
    },
    async partCatalog(organizationId: string, caseId: string, vehicleGroupCode: ValueLossVehicleGroupCode) {
      const exists = await pool.query(
        "SELECT 1 FROM cases WHERE organization_id=$1 AND id=$2 AND case_type='traffic'",
        [organizationId, caseId],
      )
      if ((exists.rowCount ?? 0) === 0) return undefined
      return trafficValueLossPartCatalogResponseSchema.parse({
        ruleIdentity: realMarketValueLossRuleSnapshot.identity,
        vehicleGroupCode,
        parts: listRealMarketPartRules(realMarketValueLossRuleSnapshot, vehicleGroupCode).map((item) => ({
          stableRuleId: item.stableId,
          label: item.sourceLabel,
          sourceTable: item.sourceTable,
          sourceRow: item.sourceRow,
          supportedOperations: item.operationCapabilities,
          coefficients: item.coefficients,
        })),
      })
    },
    async createVersion(actor: Actor, caseId: string, input: TrafficValueLossVersionCreateRequest, idem: Idempotency) {
      return idempotentWrite(pool, actor, caseId, idem, 201, async (client) => {
        const caseResult = await client.query(
          'SELECT case_type,loss_date,notification_date FROM cases WHERE organization_id=$1 AND id=$2 FOR UPDATE',
          [actor.organizationId, caseId],
        )
        const caseRow = caseResult.rows[0] as CaseRuleFacts | undefined
        if (caseRow === undefined) throw new TrafficValueLossStoreError('not_found')
        if (caseRow.case_type !== 'traffic') throw new TrafficValueLossStoreError('wrong_case_type')

        const assessmentResult = await client.query(
          'SELECT * FROM traffic_value_loss_assessments WHERE organization_id=$1 AND case_id=$2 FOR UPDATE',
          [actor.organizationId, caseId],
        )
        let assessment = assessmentResult.rows[0] as { id: string; current_version_id: string | null; version: number } | undefined
        let assessmentCreated = false
        if (assessment === undefined) {
          if (input.expectedVersion !== 0) throw new TrafficValueLossStoreError('version_conflict')
          assessment = { id: uuidv7(), current_version_id: null, version: 1 }
          assessmentCreated = true
          await client.query(
            `INSERT INTO traffic_value_loss_assessments
              (id,organization_id,case_id,created_by_user_id)
             VALUES ($1,$2,$3,$4)`,
            [assessment.id, actor.organizationId, caseId, actor.actorUserId],
          )
        } else if (assessment.version !== input.expectedVersion) {
          throw new TrafficValueLossStoreError('version_conflict')
        }

        const { evidenceIds, evaluation, inputSnapshot, previewHash } = await evaluateVersionInput(
          client,
          actor,
          caseId,
          caseRow,
          input,
        )
        if (evaluation.ruleSetId === 'real-market-analysis'
          && input.confirmedPreviewHash !== previewHash) {
          throw new TrafficValueLossStoreError('preview_mismatch')
        }
        const nextResult = await client.query(
          'SELECT coalesce(max(assessment_version),0)::int+1 AS n FROM traffic_value_loss_versions WHERE assessment_id=$1',
          [assessment.id],
        )
        const next = Number((nextResult.rows[0] as { n: number }).n)
        const versionId = uuidv7()
        const status = evaluation.canSubmitForApproval ? 'draft' : 'control_required'
        await client.query(
          `INSERT INTO traffic_value_loss_versions
            (id,organization_id,case_id,assessment_id,assessment_version,status,rule_set_id,rule_version,effective_from,
             evaluated_on,input_snapshot,result_snapshot,result_code,created_by_user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14)`,
          [versionId, actor.organizationId, caseId, assessment.id, next, status, evaluation.ruleSetId, evaluation.ruleVersion,
            evaluation.effectiveFrom, input.evaluatedOn, JSON.stringify(inputSnapshot), JSON.stringify(evaluation),
            evaluation.eligibilityStatus, actor.actorUserId],
        )
        for (const item of input.evidence) {
          await client.query(
            `INSERT INTO traffic_value_loss_evidence
              (id,organization_id,case_id,version_id,evidence_key,source_type,document_id,document_version_id,
               external_reference,source_hash,observed_at,supports,verification_status,conflict,notes,created_by_user_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
            [evidenceIds.get(item.evidenceKey), actor.organizationId, caseId, versionId, item.evidenceKey, item.sourceType,
              item.documentId, item.documentVersionId, item.externalReference, item.sourceHash, item.observedAt,
              [...item.supports], item.verificationStatus, item.conflict, item.notes, actor.actorUserId],
          )
        }
        for (const item of input.comparables) {
          await client.query(
            `INSERT INTO traffic_value_loss_comparables
              (id,organization_id,case_id,version_id,comparable_key,side,amount_minor,mileage,observed_at,evidence_id,excluded,exclusion_reason)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [uuidv7(), actor.organizationId, caseId, versionId, item.comparableKey, item.side, item.amountMinor,
              item.mileage, item.observedAt, evidenceIds.get(item.evidenceKey), item.excluded, item.exclusionReason],
          )
        }
        await client.query(
          assessmentCreated
            ? 'UPDATE traffic_value_loss_assessments SET current_version_id=$1,updated_at=now() WHERE id=$2'
            : 'UPDATE traffic_value_loss_assessments SET current_version_id=$1,version=version+1,updated_at=now() WHERE id=$2',
          [versionId, assessment.id],
        )
        const detail = await loadAssessment(client, actor.organizationId, caseId)
        if (detail === undefined) throw new TrafficValueLossStoreError('not_found')
        await audit.record(client, {
          organizationId: actor.organizationId,
          actorUserId: actor.actorUserId,
          action: next === 1 ? 'traffic_value_loss.draft_created' : 'traffic_value_loss.version_created',
          entityType: 'traffic_value_loss_assessment',
          entityId: assessment.id,
          requestId: actor.requestId,
          details: {
            caseId,
            assessmentVersion: next,
            ruleVersion: evaluation.ruleVersion,
            resultCode: evaluation.eligibilityStatus,
            uncertaintyCount: evaluation.uncertainties.length,
            evidenceCount: input.evidence.length,
            comparableCount: input.comparables.length,
          },
        })
        if (input.ruleOverride !== null) await audit.record(client, {
          organizationId: actor.organizationId,
          actorUserId: actor.actorUserId,
          action: 'traffic_value_loss.rule_overridden',
          entityType: 'traffic_value_loss_assessment',
          entityId: assessment.id,
          requestId: actor.requestId,
          details: {
            caseId,
            assessmentVersion: next,
            selectedRuleIdentity: input.ruleOverride.ruleIdentity,
            reason: input.ruleOverride.reason,
          },
        })
        if (status === 'control_required') await audit.record(client, {
          organizationId: actor.organizationId,
          actorUserId: actor.actorUserId,
          action: 'traffic_value_loss.control_required',
          entityType: 'traffic_value_loss_assessment',
          entityId: assessment.id,
          requestId: actor.requestId,
          details: { caseId, assessmentVersion: next, ruleVersion: evaluation.ruleVersion, uncertaintyCount: evaluation.uncertainties.length },
        })
        return { assessment: detail }
      })
    },
    async submit(actor: Actor, caseId: string, versionId: string, input: TrafficValueLossSubmitRequest, idem: Idempotency) {
      return idempotentWrite(pool, actor, caseId, idem, 200, async (client) => {
        const assessmentResult = await client.query(
          'SELECT * FROM traffic_value_loss_assessments WHERE organization_id=$1 AND case_id=$2 FOR UPDATE',
          [actor.organizationId, caseId],
        )
        const assessment = assessmentResult.rows[0] as { id: string; current_version_id: string; version: number } | undefined
        if (assessment === undefined || assessment.current_version_id !== versionId) throw new TrafficValueLossStoreError('not_found')
        if (assessment.version !== input.expectedVersion) throw new TrafficValueLossStoreError('version_conflict')
        const versionResult = await client.query('SELECT status,result_snapshot FROM traffic_value_loss_versions WHERE id=$1 FOR UPDATE', [versionId])
        const version = versionResult.rows[0] as { status: string; result_snapshot: { canSubmitForApproval?: boolean } } | undefined
        if (version === undefined || !['draft', 'control_required'].includes(version.status)) throw new TrafficValueLossStoreError('state_conflict')
        if (version.result_snapshot.canSubmitForApproval !== true) throw new TrafficValueLossStoreError('approval_blocked')
        await client.query("UPDATE traffic_value_loss_versions SET status='awaiting_approval' WHERE id=$1", [versionId])
        await client.query('UPDATE traffic_value_loss_assessments SET version=version+1,updated_at=now() WHERE id=$1', [assessment.id])
        await client.query(
          'INSERT INTO traffic_value_loss_approval_events (id,organization_id,case_id,assessment_id,version_id,action,actor_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [uuidv7(), actor.organizationId, caseId, assessment.id, versionId, 'submitted', actor.actorUserId],
        )
        await audit.record(client, { organizationId: actor.organizationId, actorUserId: actor.actorUserId, action: 'traffic_value_loss.submitted', entityType: 'traffic_value_loss_assessment', entityId: assessment.id, requestId: actor.requestId, details: { caseId, versionId } })
        const detail = await loadAssessment(client, actor.organizationId, caseId)
        if (detail === undefined) throw new TrafficValueLossStoreError('not_found')
        return { assessment: detail }
      })
    },
    async approve(actor: Actor, caseId: string, versionId: string, input: TrafficValueLossApproveRequest, idem: Idempotency) {
      return idempotentWrite(pool, actor, caseId, idem, 200, async (client) => {
        const assessmentResult = await client.query(
          'SELECT * FROM traffic_value_loss_assessments WHERE organization_id=$1 AND case_id=$2 FOR UPDATE',
          [actor.organizationId, caseId],
        )
        const assessment = assessmentResult.rows[0] as { id: string; current_version_id: string; version: number } | undefined
        if (assessment === undefined || assessment.current_version_id !== versionId) throw new TrafficValueLossStoreError('not_found')
        if (assessment.version !== input.expectedVersion) throw new TrafficValueLossStoreError('version_conflict')
        const current = await client.query('SELECT status,created_by_user_id FROM traffic_value_loss_versions WHERE id=$1 FOR UPDATE', [versionId])
        const version = current.rows[0] as { status: string; created_by_user_id: string } | undefined
        if (version === undefined || version.status !== 'awaiting_approval') throw new TrafficValueLossStoreError('state_conflict')
        await client.query(
          `UPDATE traffic_value_loss_versions
           SET status='superseded',is_active=false
           WHERE organization_id=$1 AND case_id=$2 AND status='approved' AND is_active=true AND id<>$3`,
          [actor.organizationId, caseId, versionId],
        )
        await client.query(
          `UPDATE traffic_value_loss_versions SET status='approved',human_approval_status='approved',
            approved_by_user_id=$1,approved_at=now(),approval_reason=$2,is_active=true WHERE id=$3`,
          [actor.actorUserId, input.reason, versionId],
        )
        await client.query('UPDATE traffic_value_loss_assessments SET version=version+1,updated_at=now() WHERE id=$1', [assessment.id])
        await client.query(
          'INSERT INTO traffic_value_loss_approval_events (id,organization_id,case_id,assessment_id,version_id,action,actor_user_id,reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [uuidv7(), actor.organizationId, caseId, assessment.id, versionId, 'approved', actor.actorUserId, input.reason],
        )
        await audit.record(client, { organizationId: actor.organizationId, actorUserId: actor.actorUserId, action: 'traffic_value_loss.approved', entityType: 'traffic_value_loss_assessment', entityId: assessment.id, requestId: actor.requestId, details: { caseId, versionId, selfApproved: version.created_by_user_id === actor.actorUserId } })
        const detail = await loadAssessment(client, actor.organizationId, caseId)
        if (detail === undefined) throw new TrafficValueLossStoreError('not_found')
        return { assessment: detail }
      })
    },
    async reject(actor: Actor, caseId: string, versionId: string, input: TrafficValueLossRejectRequest, idem: Idempotency) {
      return idempotentWrite(pool, actor, caseId, idem, 200, async (client) => {
        const assessmentResult = await client.query(
          'SELECT * FROM traffic_value_loss_assessments WHERE organization_id=$1 AND case_id=$2 FOR UPDATE',
          [actor.organizationId, caseId],
        )
        const assessment = assessmentResult.rows[0] as { id: string; current_version_id: string; version: number } | undefined
        if (assessment === undefined || assessment.current_version_id !== versionId) throw new TrafficValueLossStoreError('not_found')
        if (assessment.version !== input.expectedVersion) throw new TrafficValueLossStoreError('version_conflict')
        const current = await client.query('SELECT status FROM traffic_value_loss_versions WHERE id=$1 FOR UPDATE', [versionId])
        if ((current.rows[0] as { status: string } | undefined)?.status !== 'awaiting_approval') throw new TrafficValueLossStoreError('state_conflict')
        await client.query(
          `UPDATE traffic_value_loss_versions SET status='rejected',human_approval_status='rejected',
            approved_by_user_id=$1,approved_at=now(),approval_reason=$2,is_active=false WHERE id=$3`,
          [actor.actorUserId, input.reason, versionId],
        )
        await client.query('UPDATE traffic_value_loss_assessments SET version=version+1,updated_at=now() WHERE id=$1', [assessment.id])
        await client.query(
          'INSERT INTO traffic_value_loss_approval_events (id,organization_id,case_id,assessment_id,version_id,action,actor_user_id,reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [uuidv7(), actor.organizationId, caseId, assessment.id, versionId, 'rejected', actor.actorUserId, input.reason],
        )
        await audit.record(client, { organizationId: actor.organizationId, actorUserId: actor.actorUserId, action: 'traffic_value_loss.rejected', entityType: 'traffic_value_loss_assessment', entityId: assessment.id, requestId: actor.requestId, details: { caseId, versionId, reasonProvided: true } })
        const detail = await loadAssessment(client, actor.organizationId, caseId)
        if (detail === undefined) throw new TrafficValueLossStoreError('not_found')
        return { assessment: detail }
      })
    },
  }
}
