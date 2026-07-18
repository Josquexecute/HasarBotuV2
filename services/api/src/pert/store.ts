import type pg from 'pg'
import {
  pertAssessmentResponseSchema,
  pertAssessmentSchema,
  pertAssessmentWorkspaceResponseSchema,
  type PertAssessment,
  type PertAssessmentCreateRequest,
  type PertAssessmentReviseRequest,
  type PertAssessmentWorkspaceResponse,
} from '@hasarbotu/contracts'
import {
  PERT_ASSESSMENT_CURRENCY,
  PERT_ASSESSMENT_SCHEMA_VERSION,
  computePertDamageRatioPercent,
  validatePertAssessment,
  type NormalizedPertAssessment,
  type PertAssessmentInvalidReason,
} from '@hasarbotu/domain'
import { uuidv7 } from '@hasarbotu/database'
import { createAuditService } from '../audit/service.js'
import type { Queryable } from '../db/executor.js'
import {
  findIdempotent,
  insertIdempotent,
  isIdempotencyRace,
  type IdempotentRecord,
} from '../db/idempotency.js'

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

interface CaseContextRow {
  readonly lifecycle_status: 'open' | 'closed'
  readonly version: number
}

interface AssessmentRow {
  readonly id: string
  readonly case_id: string
  readonly current_version_id: string
  readonly version: number
  readonly created_by_user_id: string
  readonly created_by_display_name: string
  readonly created_at: Date
  readonly updated_at: Date
}

interface VersionRow {
  readonly id: string
  readonly assessment_id: string
  readonly assessment_version: number
  readonly previous_version_id: string | null
  readonly workflow_status: PertAssessment['currentVersion']['workflowStatus']
  readonly estimated_damage_minor: string | null
  readonly market_value_minor: string | null
  readonly structural_note: string | null
  readonly expert_opinion: 'repair' | 'pert' | null
  readonly expert_rationale: string | null
  readonly center_decision: 'repair' | 'pert' | null
  readonly center_note: string | null
  readonly source_type: 'user_entered' | 'manual_revision'
  readonly currency: string
  readonly revision_reason: string | null
  readonly created_by_user_id: string
  readonly created_by_display_name: string
  readonly created_at: Date
}

export type PertCommandOutcome<T> =
  | { readonly kind: 'ok'; readonly response: T }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'case_closed' }
  | { readonly kind: 'version_conflict' }
  | { readonly kind: 'assessment_exists' }
  | { readonly kind: 'assessment_missing' }
  | { readonly kind: 'invalid_assessment'; readonly reasonCode: PertAssessmentInvalidReason }
  | { readonly kind: 'idempotency_race' }

function safeMinor(value: string | null): number | null {
  if (value === null) return null
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('pert_amount_out_of_range')
  return parsed
}

async function readCaseContext(
  exec: Queryable,
  organizationId: string,
  caseId: string,
  forUpdate = false,
): Promise<CaseContextRow | undefined> {
  const result = await exec.query(
    `SELECT lifecycle_status,version
       FROM cases WHERE organization_id=$1 AND id::text=$2${forUpdate ? ' FOR UPDATE' : ''}`,
    [organizationId, caseId],
  )
  return result.rows[0] as CaseContextRow | undefined
}

async function loadAssessment(
  exec: Queryable,
  organizationId: string,
  caseId: string,
): Promise<PertAssessment | undefined> {
  const aggregateResult = await exec.query(
    `SELECT a.id,a.case_id::text AS case_id,a.current_version_id,a.version,
            a.created_by_user_id,creator.display_name AS created_by_display_name,
            a.created_at,a.updated_at
       FROM pert_assessments a
       JOIN users creator ON creator.organization_id=a.organization_id AND creator.id=a.created_by_user_id
      WHERE a.organization_id=$1 AND a.case_id::text=$2`,
    [organizationId, caseId],
  )
  const aggregate = aggregateResult.rows[0] as AssessmentRow | undefined
  if (aggregate === undefined) return undefined
  const versionsResult = await exec.query(
    `SELECT v.id,v.assessment_id,v.assessment_version,v.previous_version_id,v.workflow_status,
            v.estimated_damage_minor::text AS estimated_damage_minor,
            v.market_value_minor::text AS market_value_minor,
            v.structural_note,v.expert_opinion,v.expert_rationale,v.center_decision,v.center_note,
            v.source_type,v.currency,v.revision_reason,
            v.created_by_user_id,creator.display_name AS created_by_display_name,v.created_at
       FROM pert_assessment_versions v
       JOIN users creator ON creator.organization_id=v.organization_id AND creator.id=v.created_by_user_id
      WHERE v.organization_id=$1 AND v.assessment_id=$2
      ORDER BY v.assessment_version DESC`,
    [organizationId, aggregate.id],
  )
  const mappedVersions = (versionsResult.rows as VersionRow[]).map((version) => {
    const estimatedDamageMinor = safeMinor(version.estimated_damage_minor)
    const marketValueMinor = safeMinor(version.market_value_minor)
    return {
      id: version.id,
      assessmentVersion: version.assessment_version,
      previousVersionId: version.previous_version_id,
      workflowStatus: version.workflow_status,
      estimatedDamageMinor,
      marketValueMinor,
      damageRatioPercent: computePertDamageRatioPercent(estimatedDamageMinor, marketValueMinor),
      structuralNote: version.structural_note,
      expertOpinion: version.expert_opinion,
      expertRationale: version.expert_rationale,
      centerDecision: version.center_decision,
      centerNote: version.center_note,
      schemaVersion: PERT_ASSESSMENT_SCHEMA_VERSION,
      currency: version.currency,
      sourceType: version.source_type,
      revisionReason: version.revision_reason,
      createdByUserId: version.created_by_user_id,
      createdByDisplayName: version.created_by_display_name,
      createdAt: version.created_at.toISOString(),
    }
  })
  const currentVersion = mappedVersions.find((version) => version.id === aggregate.current_version_id)
  if (currentVersion === undefined) throw new Error('pert_assessment_current_version_missing')
  return pertAssessmentSchema.parse({
    id: aggregate.id,
    caseId: aggregate.case_id,
    version: aggregate.version,
    currentVersion,
    versions: mappedVersions,
    createdByUserId: aggregate.created_by_user_id,
    createdByDisplayName: aggregate.created_by_display_name,
    createdAt: aggregate.created_at.toISOString(),
    updatedAt: aggregate.updated_at.toISOString(),
  })
}

async function insertVersion(
  client: pg.PoolClient,
  actor: ActorContext,
  caseId: string,
  assessmentId: string,
  versionId: string,
  assessmentVersion: number,
  previousVersionId: string | null,
  assessment: NormalizedPertAssessment,
  revisionReason: string | null,
): Promise<void> {
  await client.query(
    `INSERT INTO pert_assessment_versions
       (id,organization_id,case_id,assessment_id,assessment_version,previous_version_id,
        workflow_status,estimated_damage_minor,market_value_minor,structural_note,
        expert_opinion,expert_rationale,center_decision,center_note,
        source_type,currency,revision_reason,created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [
      versionId,
      actor.organizationId,
      caseId,
      assessmentId,
      assessmentVersion,
      previousVersionId,
      assessment.workflowStatus,
      assessment.estimatedDamageMinor,
      assessment.marketValueMinor,
      assessment.structuralNote,
      assessment.expertOpinion,
      assessment.expertRationale,
      assessment.centerDecision,
      assessment.centerNote,
      previousVersionId === null ? 'user_entered' : 'manual_revision',
      PERT_ASSESSMENT_CURRENCY,
      revisionReason,
      actor.actorUserId,
    ],
  )
}

/** Audit yalnız güvenli kod/oran/sürüm metadata'sı taşır; serbest metin taşımaz. */
function auditDetails(
  caseId: string,
  assessmentVersion: number,
  assessment: NormalizedPertAssessment,
): Record<string, unknown> {
  return {
    caseId,
    assessmentVersion,
    workflowStatus: assessment.workflowStatus,
    expertOpinion: assessment.expertOpinion,
    centerDecision: assessment.centerDecision,
    damageRatioPercent: computePertDamageRatioPercent(
      assessment.estimatedDamageMinor,
      assessment.marketValueMinor,
    ),
    hasStructuralNote: assessment.structuralNote !== null,
    sourceType: assessmentVersion === 1 ? 'user_entered' : 'manual_revision',
  }
}

export function createPertStore(pool: pg.Pool) {
  const audit = createAuditService()

  return {
    findIdempotent(organizationId: string, scope: string, key: string): Promise<IdempotentRecord | undefined> {
      return findIdempotent(pool, organizationId, scope, key)
    },

    async readWorkspace(
      organizationId: string,
      caseId: string,
      canWrite: boolean,
    ): Promise<PertAssessmentWorkspaceResponse | undefined> {
      const context = await readCaseContext(pool, organizationId, caseId)
      if (context === undefined) return undefined
      return pertAssessmentWorkspaceResponseSchema.parse({
        caseId,
        caseVersion: context.version,
        lifecycleStatus: context.lifecycle_status,
        assessment: await loadAssessment(pool, organizationId, caseId) ?? null,
        permissions: {
          canWrite: canWrite && context.lifecycle_status === 'open',
        },
      })
    },

    async createAssessment(
      actor: ActorContext,
      caseId: string,
      input: PertAssessmentCreateRequest,
      idempotency: IdempotencyContext,
    ): Promise<PertCommandOutcome<ReturnType<typeof pertAssessmentResponseSchema.parse>>> {
      const validation = validatePertAssessment(input)
      if (!validation.valid) {
        return { kind: 'invalid_assessment', reasonCode: validation.reasonCode }
      }
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const context = await readCaseContext(client, actor.organizationId, caseId, true)
        if (context === undefined) {
          await client.query('ROLLBACK')
          return { kind: 'not_found' }
        }
        if (context.lifecycle_status !== 'open') {
          await client.query('ROLLBACK')
          return { kind: 'case_closed' }
        }
        if (context.version !== input.expectedCaseVersion) {
          await client.query('ROLLBACK')
          return { kind: 'version_conflict' }
        }
        const existing = await client.query(
          'SELECT 1 FROM pert_assessments WHERE organization_id=$1 AND case_id::text=$2',
          [actor.organizationId, caseId],
        )
        if (existing.rowCount !== null && existing.rowCount > 0) {
          await client.query('ROLLBACK')
          return { kind: 'assessment_exists' }
        }
        const assessmentId = uuidv7()
        const versionId = uuidv7()
        await client.query(
          'INSERT INTO pert_assessments (id,organization_id,case_id,created_by_user_id) VALUES ($1,$2,$3,$4)',
          [assessmentId, actor.organizationId, caseId, actor.actorUserId],
        )
        await insertVersion(client, actor, caseId, assessmentId, versionId, 1, null, validation.assessment, null)
        await client.query(
          'UPDATE pert_assessments SET current_version_id=$1,updated_at=now() WHERE id=$2',
          [versionId, assessmentId],
        )
        const created = await loadAssessment(client, actor.organizationId, caseId)
        if (created === undefined) throw new Error('pert_assessment_create_readback_failed')
        const response = pertAssessmentResponseSchema.parse({ assessment: created })
        await audit.record(client, {
          organizationId: actor.organizationId,
          actorUserId: actor.actorUserId,
          requestId: actor.requestId,
          action: 'pert_assessment.created',
          entityType: 'pert_assessment',
          entityId: assessmentId,
          details: auditDetails(caseId, 1, validation.assessment),
        })
        await insertIdempotent(client, {
          organizationId: actor.organizationId,
          scope: idempotency.scope,
          key: idempotency.key,
          requestHash: idempotency.requestHash,
          responseStatus: 201,
          responseBody: response,
          caseId,
        })
        await client.query('COMMIT')
        return { kind: 'ok', response }
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        if (isIdempotencyRace(error)) return { kind: 'idempotency_race' }
        throw error
      } finally {
        client.release()
      }
    },

    async reviseAssessment(
      actor: ActorContext,
      caseId: string,
      input: PertAssessmentReviseRequest,
      idempotency: IdempotencyContext,
    ): Promise<PertCommandOutcome<ReturnType<typeof pertAssessmentResponseSchema.parse>>> {
      const validation = validatePertAssessment(input)
      if (!validation.valid) {
        return { kind: 'invalid_assessment', reasonCode: validation.reasonCode }
      }
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const context = await readCaseContext(client, actor.organizationId, caseId, true)
        if (context === undefined) {
          await client.query('ROLLBACK')
          return { kind: 'not_found' }
        }
        if (context.lifecycle_status !== 'open') {
          await client.query('ROLLBACK')
          return { kind: 'case_closed' }
        }
        const aggregateResult = await client.query(
          `SELECT id,version,current_version_id
             FROM pert_assessments
            WHERE organization_id=$1 AND case_id::text=$2 FOR UPDATE`,
          [actor.organizationId, caseId],
        )
        const aggregate = aggregateResult.rows[0] as { id: string; version: number; current_version_id: string } | undefined
        if (aggregate === undefined) {
          await client.query('ROLLBACK')
          return { kind: 'assessment_missing' }
        }
        if (aggregate.version !== input.expectedVersion) {
          await client.query('ROLLBACK')
          return { kind: 'version_conflict' }
        }
        const nextVersion = aggregate.version + 1
        const versionId = uuidv7()
        await insertVersion(
          client,
          actor,
          caseId,
          aggregate.id,
          versionId,
          nextVersion,
          aggregate.current_version_id,
          validation.assessment,
          input.reason,
        )
        await client.query(
          'UPDATE pert_assessments SET current_version_id=$1,version=$2,updated_at=now() WHERE id=$3',
          [versionId, nextVersion, aggregate.id],
        )
        const revised = await loadAssessment(client, actor.organizationId, caseId)
        if (revised === undefined) throw new Error('pert_assessment_revise_readback_failed')
        const response = pertAssessmentResponseSchema.parse({ assessment: revised })
        await audit.record(client, {
          organizationId: actor.organizationId,
          actorUserId: actor.actorUserId,
          requestId: actor.requestId,
          action: 'pert_assessment.revised',
          entityType: 'pert_assessment',
          entityId: aggregate.id,
          details: auditDetails(caseId, nextVersion, validation.assessment),
        })
        await insertIdempotent(client, {
          organizationId: actor.organizationId,
          scope: idempotency.scope,
          key: idempotency.key,
          requestHash: idempotency.requestHash,
          responseStatus: 200,
          responseBody: response,
          caseId,
        })
        await client.query('COMMIT')
        return { kind: 'ok', response }
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        if (isIdempotencyRace(error)) return { kind: 'idempotency_race' }
        throw error
      } finally {
        client.release()
      }
    },
  }
}
