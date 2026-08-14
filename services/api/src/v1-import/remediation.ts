import { createHash } from 'node:crypto'
import type pg from 'pg'
import {
  buildV1SourceIdentityMaterial,
  buildV1StableItemIdentityMaterial,
  decideV1ClaimTypeFromEvidence,
  decideV1FieldBackfill,
  mapV1ClaimType,
  normalizeV1ResolutionName,
  plateSearchKey,
  validateCaseVehicleProfile,
  V1_IDENTITY_VERSION,
  type CaseType,
  type V1ClaimType,
  type V1ClaimTypeEvidenceDecisionReason,
} from '@hasarbotu/domain'
import { uuidv7 } from '@hasarbotu/database'
import { createAuditService } from '../audit/service.js'
import {
  discoverV1Folders,
  readV1ClaimTypeFolderEvidence,
  readV1Sidecar,
  type V1ClaimTypePathEvidence,
  type V1DiscoveredFolder,
} from './store.js'
import type { V1TakipJsonV1 } from './schema.js'

export const V1_REMEDIATION_MAPPING_VERSION = 'v1-remediation/2.2.0' as const
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u
const INITIAL_V1_CASE_IMPORT_STARTED_AT_MS = Date.parse('2026-08-10T14:20:00.000Z')
const INITIAL_V1_CASE_IMPORT_COMPLETED_AT_MS = Date.parse('2026-08-10T14:34:00.000Z')
const HARD_ENTRY_BLOCKERS = new Set([
  'stable_identity_evidence_missing',
  'stable_identity_collision',
  'target_plate_mismatch',
  'case_type_conflict',
  'claim_type_evidence_scan_failed',
  'conflicting_claim_type_evidence',
  'duplicate_content_needs_human_resolution',
  'duplicate_task_candidate_needs_human_resolution',
])

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
}

function safeTimestamp(value: string): string | null {
  if (value.trim().length === 0 || !Number.isFinite(Date.parse(value))) return null
  return new Date(value).toISOString()
}

function safeDate(value: string): string | null {
  return ISO_DATE.test(value) ? value : null
}

function pathToken(relativePath: string): string {
  return hash(relativePath).slice(0, 16)
}

const TURKISH_MONTHS = new Map([
  ['ocak', 1], ['subat', 2], ['mart', 3], ['nisan', 4], ['mayis', 5], ['haziran', 6],
  ['temmuz', 7], ['agustos', 8], ['eylul', 9], ['ekim', 10], ['kasim', 11], ['aralik', 12],
])

function historicalMonthKey(folder: V1DiscoveredFolder): string | null {
  const normalized = compactIdentity(folder.monthFolder)
  const month = [...TURKISH_MONTHS].find(([name]) => normalized.includes(name))?.[1]
  const year = /^\d{4}$/u.exec(folder.relativePath.split('/')[0] ?? '')?.[0]
  return month === undefined || year === undefined ? null : `${year}-${String(month).padStart(2, '0')}`
}

function itemIdentity(sourceIdentity: string, type: 'case' | 'field' | 'note' | 'task' | 'vehicle_profile' | 'closure' | 'follow_up', nativeId: string): string {
  const material = buildV1StableItemIdentityMaterial(sourceIdentity, type, nativeId)
  if (material === null) throw new Error('v1_stable_item_identity_missing')
  return hash(material)
}

export interface V1ExplicitResolutionManifest {
  readonly schemaVersion: 'hasarbotu-v1-resolution/1.0.0'
  readonly cases?: Readonly<Record<string, string>>
  readonly claimTypes?: Readonly<Record<string, CaseType>>
  readonly users?: Readonly<Record<string, string>>
  readonly experts?: Readonly<Record<string, string>>
  readonly services?: Readonly<Record<string, string>>
}

export interface V1RemediationOptions {
  readonly resolutions?: V1ExplicitResolutionManifest
}

interface CaseRow {
  readonly id: string
  readonly version: number
  readonly caseType: CaseType
  readonly lifecycleStatus: 'open' | 'closed'
  readonly workflowStage: string
  readonly plateKey: string
  readonly notificationFormNumber: string | null
  readonly insurerClaimNumber: string | null
  readonly officeNumber: string
  readonly officeSequence: number
  readonly createdAt: string
  readonly hasCreatedAudit: boolean
  readonly responsibleUserId: string | null
  readonly expertUserId: string | null
  readonly serviceId: string | null
  readonly followUpDate: string | null
  readonly vehicleProfileExists: boolean
}

interface LegacyRecordRow {
  readonly id: string
  readonly caseId: string | null
  readonly sourceRelativePath: string
  readonly sourceFileHash: string
  readonly itemType: string
  readonly sourceItemId: string
  readonly targetType: string
  readonly targetId: string | null
  readonly stableSourceIdentity: string | null
  readonly stableItemIdentity: string | null
}

export interface V1ResolutionEvidence {
  readonly code:
    | 'explicit_case_mapping'
    | 'stable_provenance'
    | 'legacy_path_provenance'
    | 'legacy_native_item_provenance'
    | 'exact_notification_number'
    | 'exact_claim_number'
    | 'exact_office_number'
    | 'unique_plate_and_case_type'
    | 'unique_plate_existing_case'
    | 'sibling_source_candidate_elimination'
    | 'initial_import_month_lineage'
    | 'new_case'
  readonly verifiableValue: string
}

export interface V1ClaimTypeResolution {
  readonly scanState: 'complete' | 'failed'
  readonly inventoryHash: string | null
  readonly evidenceFingerprint: string | null
  readonly sidecarClaimType: V1ClaimType
  readonly evidence: readonly V1ClaimTypePathEvidence[]
  readonly deterministicReason: V1ClaimTypeEvidenceDecisionReason | 'evidence_scan_failed'
  readonly resolutionReason: V1ClaimTypeEvidenceDecisionReason | 'explicit_mapping' | 'existing_case_deterministic' | 'evidence_scan_failed'
  readonly caseType: CaseType | null
  readonly humanRequired: boolean
}

export interface V1ResolvedReference {
  readonly sourceNameToken: string
  readonly targetId: string | null
  readonly state: 'not_present' | 'auto_resolved' | 'explicit_mapping' | 'legacy_unassigned' | 'legacy_only' | 'ambiguous_legacy'
  readonly resolutionReason: 'not_present' | 'exact_display_name' | 'exact_email_identity' | 'explicit_mapping' | 'unassigned_sentinel' | 'no_v2_entity' | 'ambiguous_v2_entity'
  readonly matchCount: number
}

export interface V1CandidateCaseEvidence {
  readonly caseId: string
  readonly caseType: CaseType
  readonly lifecycleStatus: 'open' | 'closed'
  readonly provenanceMatch: boolean
  readonly notificationNumberMatch: boolean
  readonly claimNumberMatch: boolean
  readonly officeNumberMatch: boolean
}

export interface V1RemediationNoteItem {
  readonly nativeId: string
  readonly stableItemIdentity: string
  readonly text: string
  readonly sourceAuthor: string
  readonly sourceOccurredAt: string | null
  readonly alreadyImported: boolean
  readonly legacyRecordId: string | null
  readonly targetId: string | null
  readonly duplicateContentCandidate: boolean
}

export interface V1RemediationTaskItem {
  readonly nativeId: string
  readonly stableItemIdentity: string
  readonly title: string
  readonly priority: 'low' | 'normal' | 'high'
  readonly completed: boolean
  readonly sourceCreatedAt: string | null
  readonly sourceCompletedAt: string | null
  readonly dueDate: string | null
  readonly sourceAssignee: string
  readonly assignee: V1ResolvedReference
  readonly alreadyImported: boolean
  readonly legacyRecordId: string | null
  readonly targetId: string | null
  readonly needsEventBackfill: boolean
  readonly duplicateContentCandidate: boolean
}

export interface V1RemediationFieldItem {
  readonly field: 'notificationFormNumber' | 'insurerClaimNumber' | 'followUpDate' | 'responsibleUserId' | 'expertUserId' | 'serviceId'
  readonly state: 'missing' | 'already_matches' | 'no_source_value' | 'conflict' | 'legacy_preserved'
  readonly value: string | null
}

export interface V1RemediationEntry {
  readonly folder: V1DiscoveredFolder
  readonly pathToken: string
  readonly sourceIdentity: string | null
  readonly sourceIdentityState: 'resolved' | 'missing_evidence' | 'collision'
  readonly sourceHash: string | null
  readonly sourceManifestFingerprint: string
  readonly rawSnapshot: V1TakipJsonV1 | null
  readonly schemaVersion: number | null
  readonly sourceWriteId: string | null
  readonly sourceRevision: number | null
  readonly targetCaseId: string | null
  readonly targetState: 'existing' | 'create' | 'human_claim_type' | 'human_ambiguous' | 'human_identity' | 'malformed' | 'missing_sidecar' | 'unparseable'
  readonly missingSidecarClassification: null | {
    readonly state: 'non_blocking_no_historical_payload'
    readonly existingV2CaseCount: number
    readonly filesystemFreshness: 'created_after_initial_import' | 'preexisting_or_unknown'
  }
  readonly caseType: CaseType | null
  readonly caseTypeAutoResolved: boolean
  readonly claimTypeResolution: V1ClaimTypeResolution | null
  readonly evidence: readonly V1ResolutionEvidence[]
  readonly candidateCaseIds: readonly string[]
  readonly candidateCaseEvidence: readonly V1CandidateCaseEvidence[]
  readonly responsible: V1ResolvedReference
  readonly expert: V1ResolvedReference
  readonly service: V1ResolvedReference
  readonly fields: readonly V1RemediationFieldItem[]
  readonly notes: readonly V1RemediationNoteItem[]
  readonly tasks: readonly V1RemediationTaskItem[]
  readonly shouldCloseHistorically: boolean
  readonly sourceClosureAt: string | null
  readonly needsFollowUpHistory: boolean
  readonly needsRawRevision: boolean
  readonly needsAlias: boolean
  readonly needsVehicleProfile: boolean
  readonly needsClaimTypeEvidenceProvenance: boolean
  readonly legacyRecordsToReconcile: readonly { readonly recordId: string; readonly stableItemIdentity: string; readonly evidenceCode: string }[]
  readonly blockers: readonly string[]
}

function isActionableEntry(entry: V1RemediationEntry): boolean {
  return (entry.targetState === 'existing' || entry.targetState === 'create')
    && !entry.blockers.some((blocker) => HARD_ENTRY_BLOCKERS.has(blocker))
}

function noteNeedsCreate(item: V1RemediationNoteItem): boolean {
  return !item.alreadyImported && !item.duplicateContentCandidate && item.text.trim().length > 0
}

function taskNeedsCreate(item: V1RemediationTaskItem): boolean {
  return !item.alreadyImported && !item.duplicateContentCandidate && item.title.trim().length > 0
    && item.dueDate !== null && (!item.completed || item.sourceCompletedAt !== null)
}

export interface V1RemediationSummary {
  readonly current: { readonly cases: number; readonly notes: number; readonly tasks: number; readonly provenance: number }
  readonly actionable: {
    readonly casesToCreate: number
    readonly casesToBackfill: number
    readonly notesToCreate: number
    readonly tasksToCreate: number
    readonly completedTasksToCreate: number
    readonly closuresToImport: number
    readonly otherFieldMappings: number
  }
  readonly safeRemediation: {
    readonly notesMissing: number
    readonly tasksMissing: number
    readonly completedTasksMissing: number
    readonly fieldsMissing: number
    readonly historicalClosures: number
    readonly followUpHistory: number
    readonly taskEvents: number
    readonly rawSnapshotsAndProvenance: number
    readonly moveRenameReconciliations: number
  }
  readonly blocked: {
    readonly unknownClaimType: number
    readonly ambiguousCase: number
    readonly unresolvedUser: number
    readonly unresolvedExpert: number
    readonly unresolvedService: number
    readonly malformed: number
    readonly missingSidecar: number
    readonly conflictingEvidence: number
    readonly other: number
  }
  readonly autoResolved: {
    readonly unknownClaimTypes: number
    readonly ambiguousCases: number
    readonly users: number
    readonly experts: number
    readonly services: number
    readonly unassignedResponsible: number
    readonly servicesPlanned: number
  }
  readonly blockingHumanDecisions: {
    readonly claimType: number
    readonly ambiguousTarget: number
  }
  readonly nonBlockingLegacy: {
    readonly responsibleRecords: number
    readonly responsibleNames: number
    readonly expertRecords: number
    readonly expertNames: number
    readonly serviceRecords: number
    readonly serviceNames: number
    readonly missingSidecar: number
    readonly other: number
  }
  readonly humanRequired: {
    readonly unresolvedClaimType: number
    readonly ambiguousTarget: number
    readonly userMapping: number
    readonly expertMapping: number
    readonly serviceMapping: number
    readonly other: number
  }
  readonly duplicatesThatWouldBeCreated: number
}

export interface V1RemediationPlan {
  readonly organizationId: string
  readonly rootPath: string
  readonly generatedAt: string
  readonly mappingVersion: typeof V1_REMEDIATION_MAPPING_VERSION
  readonly identityVersion: typeof V1_IDENTITY_VERSION
  readonly schemaReady: boolean
  readonly sourceManifestHash: string
  readonly planHash: string
  readonly summary: V1RemediationSummary
  readonly entries: readonly V1RemediationEntry[]
}

function emptyReference(): V1ResolvedReference {
  return { sourceNameToken: '', targetId: null, state: 'not_present', resolutionReason: 'not_present', matchCount: 0 }
}

interface ReferenceCandidate {
  readonly id: string
  readonly name: string
  readonly email?: string
}

function compactIdentity(value: string): string {
  return value.trim().toLocaleLowerCase('tr-TR').replace(/ı/gu, 'i').normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '').replace(/[^a-z0-9]/gu, '')
}

function resolveReference(
  sourceName: string,
  candidates: readonly ReferenceCandidate[],
  explicit: Readonly<Record<string, string>> | undefined,
  validTargets: ReadonlySet<string>,
): V1ResolvedReference {
  const normalized = normalizeV1ResolutionName(sourceName)
  if (normalized.length === 0) return emptyReference()
  const token = hash(normalized).slice(0, 16)
  if (compactIdentity(normalized) === 'atanmadi') {
    return { sourceNameToken: token, targetId: null, state: 'legacy_unassigned', resolutionReason: 'unassigned_sentinel', matchCount: 0 }
  }
  const explicitTarget = explicit?.[token]
  if (explicitTarget !== undefined && validTargets.has(explicitTarget)) {
    return { sourceNameToken: token, targetId: explicitTarget, state: 'explicit_mapping', resolutionReason: 'explicit_mapping', matchCount: 1 }
  }
  const displayMatches = candidates.filter((candidate) => normalizeV1ResolutionName(candidate.name) === normalized)
  if (displayMatches.length === 1) {
    return { sourceNameToken: token, targetId: displayMatches[0]?.id ?? null, state: 'auto_resolved', resolutionReason: 'exact_display_name', matchCount: 1 }
  }
  const compact = compactIdentity(sourceName)
  const emailMatches = candidates.filter((candidate) => {
    const localPart = candidate.email?.split('@', 1)[0] ?? ''
    return localPart.length > 0 && compactIdentity(localPart) === compact
  })
  if (displayMatches.length === 0 && emailMatches.length === 1) {
    return { sourceNameToken: token, targetId: emailMatches[0]?.id ?? null, state: 'auto_resolved', resolutionReason: 'exact_email_identity', matchCount: 1 }
  }
  const matchCount = displayMatches.length > 0 ? displayMatches.length : emailMatches.length
  return {
    sourceNameToken: token, targetId: null,
    state: matchCount === 0 ? 'legacy_only' : 'ambiguous_legacy',
    resolutionReason: matchCount === 0 ? 'no_v2_entity' : 'ambiguous_v2_entity',
    matchCount,
  }
}

function mapPriority(value: string): 'low' | 'normal' | 'high' {
  const normalized = normalizeV1ResolutionName(value)
  if (['kritik', 'yuksek', 'yüksek'].includes(normalized)) return 'high'
  if (['dusuk', 'düşük'].includes(normalized)) return 'low'
  return 'normal'
}

function fieldPlan(current: string | null, source: string | null, field: V1RemediationFieldItem['field']): V1RemediationFieldItem {
  const decision = decideV1FieldBackfill(current, source)
  if (decision.kind === 'safe_backfill') return { field, state: 'missing', value: decision.value }
  if (decision.kind === 'already_matches') return { field, state: 'already_matches', value: current }
  if (decision.kind === 'conflict') return { field, state: 'conflict', value: null }
  return { field, state: 'no_source_value', value: null }
}

function referenceFieldPlan(current: string | null, reference: V1ResolvedReference, field: V1RemediationFieldItem['field']): V1RemediationFieldItem {
  if (reference.state === 'not_present') return { field, state: 'no_source_value', value: null }
  if (reference.state === 'legacy_unassigned' || reference.state === 'legacy_only' || reference.state === 'ambiguous_legacy') {
    return { field, state: 'legacy_preserved', value: null }
  }
  if (current !== null) return { field, state: reference.targetId === current ? 'already_matches' : 'conflict', value: null }
  if (reference.targetId !== null) return { field, state: 'missing', value: reference.targetId }
  return { field, state: 'legacy_preserved', value: null }
}

function planHashPayload(plan: Omit<V1RemediationPlan, 'generatedAt' | 'planHash' | 'rootPath'>): unknown {
  return {
    organizationId: plan.organizationId,
    mappingVersion: plan.mappingVersion,
    identityVersion: plan.identityVersion,
    schemaReady: plan.schemaReady,
    sourceManifestHash: plan.sourceManifestHash,
    summary: plan.summary,
    entries: plan.entries.map((entry) => ({
      pathToken: entry.pathToken,
      sourceIdentity: entry.sourceIdentity,
      sourceHash: entry.sourceHash,
      targetCaseId: entry.targetCaseId,
      targetState: entry.targetState,
      missingSidecarClassification: entry.missingSidecarClassification,
      caseType: entry.caseType,
      claimTypeResolution: entry.claimTypeResolution,
      candidateCaseEvidence: entry.candidateCaseEvidence,
      fields: entry.fields,
      notes: entry.notes.map((note) => ({
        nativeId: note.nativeId,
        stableItemIdentity: note.stableItemIdentity,
        sourceOccurredAt: note.sourceOccurredAt,
        alreadyImported: note.alreadyImported,
        legacyRecordId: note.legacyRecordId,
        targetId: note.targetId,
        duplicateContentCandidate: note.duplicateContentCandidate,
      })),
      tasks: entry.tasks.map((task) => ({
        nativeId: task.nativeId,
        stableItemIdentity: task.stableItemIdentity,
        priority: task.priority,
        completed: task.completed,
        sourceCreatedAt: task.sourceCreatedAt,
        sourceCompletedAt: task.sourceCompletedAt,
        dueDate: task.dueDate,
        assignee: task.assignee,
        alreadyImported: task.alreadyImported,
        legacyRecordId: task.legacyRecordId,
        targetId: task.targetId,
        needsEventBackfill: task.needsEventBackfill,
        duplicateContentCandidate: task.duplicateContentCandidate,
      })),
      shouldCloseHistorically: entry.shouldCloseHistorically,
      needsFollowUpHistory: entry.needsFollowUpHistory,
      needsRawRevision: entry.needsRawRevision,
      needsAlias: entry.needsAlias,
      needsVehicleProfile: entry.needsVehicleProfile,
      needsClaimTypeEvidenceProvenance: entry.needsClaimTypeEvidenceProvenance,
      legacyRecordsToReconcile: entry.legacyRecordsToReconcile,
      blockers: entry.blockers,
    })),
  }
}

export async function planV1Remediation(
  pool: pg.Pool,
  organizationId: string,
  rootPath: string,
  options: V1RemediationOptions = {},
): Promise<V1RemediationPlan> {
  const folders = await discoverV1Folders(rootPath)
  const sidecars = await Promise.all(folders.map(async (folder) => ({
    folder,
    sidecar: await readV1Sidecar(folder),
    claimTypeFolderEvidence: folder.hasJson
      ? await readV1ClaimTypeFolderEvidence(folder)
      : { scanState: 'complete' as const, inventoryHash: hash('[]'), evidenceFingerprint: hash('[]'), evidence: [] },
  })))
  const schemaCheck = await pool.query<{ ready: boolean }>("SELECT to_regclass('public.v1_import_sources') IS NOT NULL AS ready")
  const schemaReady = schemaCheck.rows[0]?.ready === true

  const [usersResult, expertsResult, servicesResult, casesResult, recordsResult, currentResult, notesResult, tasksResult, followUpResult] = await Promise.all([
    pool.query<ReferenceCandidate>("SELECT id::text,display_name AS name,email FROM users WHERE organization_id=$1 AND status='active'", [organizationId]),
    pool.query<ReferenceCandidate>(
      `SELECT DISTINCT u.id::text,u.display_name AS name,u.email
         FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
        WHERE u.organization_id=$1 AND u.status='active' AND r.code='expert'`, [organizationId],
    ),
    pool.query<{ id: string; name: string }>("SELECT id::text,name FROM service_centers WHERE organization_id=$1 AND is_active=true", [organizationId]),
    pool.query(
      `SELECT c.id::text,c.version,c.case_type,c.lifecycle_status,c.workflow_stage,c.plate_normalized,
              c.notification_form_number,c.insurer_claim_number,c.office_number,c.office_sequence,c.created_at,c.responsible_user_id::text,
              c.expert_user_id::text,c.service_center_id::text,to_char(c.follow_up_date,'YYYY-MM-DD') AS follow_up_date,
              EXISTS(SELECT 1 FROM audit_events a WHERE a.organization_id=c.organization_id AND a.action='case.created'
                AND a.resource_type='case' AND a.resource_id=c.id::text) AS has_created_audit,
              EXISTS(SELECT 1 FROM case_vehicle_profiles p WHERE p.organization_id=c.organization_id AND p.case_id=c.id) AS vehicle_profile_exists
         FROM cases c WHERE c.organization_id=$1`,
      [organizationId],
    ),
    pool.query(
      `SELECT id::text,case_id::text,source_relative_path,source_file_hash,item_type,source_item_id,target_type,target_id::text,
              ${schemaReady ? 'stable_source_identity,stable_item_identity' : 'NULL::text AS stable_source_identity,NULL::text AS stable_item_identity'}
         FROM v1_import_records WHERE organization_id=$1`,
      [organizationId],
    ),
    pool.query(`SELECT
      (SELECT count(*)::int FROM cases WHERE organization_id=$1) AS cases,
      (SELECT count(*)::int FROM case_notes WHERE organization_id=$1) AS notes,
      (SELECT count(*)::int FROM case_tasks WHERE organization_id=$1) AS tasks,
      (SELECT count(*)::int FROM v1_import_records WHERE organization_id=$1) AS provenance`, [organizationId]),
    pool.query<{ id: string; case_id: string; body: string }>('SELECT id::text,case_id::text,body FROM case_notes WHERE organization_id=$1', [organizationId]),
    pool.query<{ id: string; case_id: string; title: string; event_count: number }>(
      `SELECT t.id::text,t.case_id::text,t.title,count(e.id)::int AS event_count
         FROM case_tasks t LEFT JOIN case_task_events e ON e.organization_id=t.organization_id AND e.task_id=t.id
        WHERE t.organization_id=$1 GROUP BY t.id,t.case_id,t.title`, [organizationId]),
    pool.query<{ case_id: string; source: string; source_identity: string | null }>(
      `SELECT case_id::text,source,${schemaReady ? 'source_identity' : 'NULL::text AS source_identity'}
         FROM case_follow_up_history WHERE organization_id=$1`, [organizationId]),
  ])

  const extra = schemaReady
    ? await Promise.all([
        pool.query<{ stable_source_identity: string; source_file_hash: string }>(
          'SELECT stable_source_identity,source_file_hash FROM v1_import_source_revisions WHERE organization_id=$1 AND mapping_version=$2',
          [organizationId, V1_REMEDIATION_MAPPING_VERSION],
        ),
        pool.query<{ stable_source_identity: string; source_relative_path: string }>(
          'SELECT stable_source_identity,source_relative_path FROM v1_import_source_aliases WHERE organization_id=$1', [organizationId]),
        pool.query<{ legacy_import_record_id: string; stable_source_identity: string; stable_item_identity: string }>(
          'SELECT legacy_import_record_id::text,stable_source_identity,stable_item_identity FROM v1_import_record_reconciliations WHERE organization_id=$1', [organizationId]),
        pool.query<{ stable_source_identity: string; item_type: string; stable_item_identity: string; target_id: string }>(
          'SELECT stable_source_identity,item_type,stable_item_identity,target_id::text FROM v1_import_item_metadata WHERE organization_id=$1', [organizationId]),
      ])
    : [
        { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] },
      ] as const

  const validUsers = new Set(usersResult.rows.map((row) => row.id))
  const validExperts = new Set(expertsResult.rows.map((row) => row.id))
  const validServices = new Set(servicesResult.rows.map((row) => row.id))
  const cases: CaseRow[] = (casesResult.rows as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id), version: Number(row.version), caseType: String(row.case_type) as CaseType,
    lifecycleStatus: String(row.lifecycle_status) as 'open' | 'closed', workflowStage: String(row.workflow_stage),
    plateKey: String(row.plate_normalized), notificationFormNumber: row.notification_form_number === null ? null : String(row.notification_form_number),
    insurerClaimNumber: row.insurer_claim_number === null ? null : String(row.insurer_claim_number), officeNumber: String(row.office_number),
    officeSequence: Number(row.office_sequence), createdAt: new Date(String(row.created_at)).toISOString(), hasCreatedAudit: row.has_created_audit === true,
    responsibleUserId: row.responsible_user_id === null ? null : String(row.responsible_user_id),
    expertUserId: row.expert_user_id === null ? null : String(row.expert_user_id), serviceId: row.service_center_id === null ? null : String(row.service_center_id),
    followUpDate: row.follow_up_date === null ? null : String(row.follow_up_date), vehicleProfileExists: row.vehicle_profile_exists === true,
  }))
  const byCaseId = new Map(cases.map((row) => [row.id, row]))
  const byPlate = new Map<string, CaseRow[]>()
  for (const row of cases) {
    const list = byPlate.get(row.plateKey) ?? []
    list.push(row)
    byPlate.set(row.plateKey, list)
  }
  const records: LegacyRecordRow[] = (recordsResult.rows as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id), caseId: row.case_id === null ? null : String(row.case_id), sourceRelativePath: String(row.source_relative_path),
    sourceFileHash: String(row.source_file_hash), itemType: String(row.item_type), sourceItemId: String(row.source_item_id),
    targetType: String(row.target_type), targetId: row.target_id === null ? null : String(row.target_id),
    stableSourceIdentity: row.stable_source_identity === null ? null : String(row.stable_source_identity),
    stableItemIdentity: row.stable_item_identity === null ? null : String(row.stable_item_identity),
  }))
  const noteRows = notesResult.rows
  const taskRows = tasksResult.rows
  const notesById = new Map(noteRows.map((row) => [row.id, row]))
  const tasksById = new Map(taskRows.map((row) => [row.id, row]))
  const reconciledByRecord = new Map(extra[2].rows.map((row) => [row.legacy_import_record_id, row]))
  const revisionKeys = new Set(extra[0].rows.map((row) => `${row.stable_source_identity}|${row.source_file_hash}`))
  const aliasKeys = new Set(extra[1].rows.map((row) => `${row.stable_source_identity}|${row.source_relative_path}`))

  const sourceNativeIdCounts = new Map<string, number>()
  for (const { sidecar } of sidecars) {
    if (sidecar.jsonParse?.ok !== true) continue
    for (const note of sidecar.jsonParse.data.notes) sourceNativeIdCounts.set(`note|${note.id}`, (sourceNativeIdCounts.get(`note|${note.id}`) ?? 0) + 1)
    for (const todo of sidecar.jsonParse.data.todos) sourceNativeIdCounts.set(`task|${todo.id}`, (sourceNativeIdCounts.get(`task|${todo.id}`) ?? 0) + 1)
  }
  const sourceIdentityCounts = new Map<string, number>()
  const precomputedIdentities = new Map<string, string | null>()
  for (const { folder, sidecar } of sidecars) {
    if (sidecar.jsonParse?.ok !== true) { precomputedIdentities.set(folder.relativePath, null); continue }
    const material = buildV1SourceIdentityMaterial({
      caseKey: sidecar.jsonParse.data.caseIdentity?.caseKey,
      createdAt: sidecar.jsonParse.data.metadata?.createdAt,
    })
    const identity = material.ok ? hash(material.material) : null
    precomputedIdentities.set(folder.relativePath, identity)
    if (identity !== null) sourceIdentityCounts.set(identity, (sourceIdentityCounts.get(identity) ?? 0) + 1)
  }

  // Ayni plakaya ait birden cok source/case varsa, en az bir source exact
  // immutable numarayla tek hedefe baglandiktan sonra geriye TEK source ve
  // TEK candidate kalmasi bir tahmin degil, bire-bir kume eliminasyonudur.
  const siblingTargetHints = new Map<string, string>()
  const sidecarsByPlate = new Map<string, typeof sidecars>()
  for (const item of sidecars) {
    if (item.folder.parsedName === null || item.sidecar.jsonParse?.ok !== true) continue
    const key = plateSearchKey(item.folder.parsedName.plate)
    const list = sidecarsByPlate.get(key) ?? []
    list.push(item)
    sidecarsByPlate.set(key, list)
  }
  for (const [plateKey, sources] of sidecarsByPlate) {
    const candidates = byPlate.get(plateKey) ?? []
    if (sources.length < 2 || sources.length !== candidates.length) continue
    const direct = new Map<string, string>()
    const duplicateTargets = new Set<string>()
    for (const source of sources) {
      const data = source.sidecar.jsonParse?.ok === true ? source.sidecar.jsonParse.data : null
      if (data === null) continue
      const values = [
        data.caseIdentity?.claimNoticeNo?.trim() ?? '',
        data.caseIdentity?.dosyaNo?.trim() ?? '',
        data.caseIdentity?.officeFileNo?.trim() ?? '',
      ].filter((value) => value.length > 0)
      const matches = new Set(candidates.filter((candidate) => values.some((value) =>
        candidate.notificationFormNumber === value || candidate.insurerClaimNumber === value || candidate.officeNumber === value))
        .map((candidate) => candidate.id))
      if (matches.size !== 1) continue
      const targetId = [...matches][0]
      if (targetId === undefined) continue
      if ([...direct.values()].includes(targetId)) duplicateTargets.add(targetId)
      direct.set(source.folder.relativePath, targetId)
    }
    for (const [path, target] of [...direct]) if (duplicateTargets.has(target)) direct.delete(path)
    const remainingSources = sources.filter((source) => !direct.has(source.folder.relativePath))
    const usedTargets = new Set(direct.values())
    const remainingCandidates = candidates.filter((candidate) => !usedTargets.has(candidate.id))
    if (remainingSources.length === 1 && remainingCandidates.length === 1) {
      const source = remainingSources[0]
      const candidate = remainingCandidates[0]
      if (source !== undefined && candidate !== undefined) siblingTargetHints.set(source.folder.relativePath, candidate.id)
    }
  }

  const lineageTargetHints = new Map<string, { readonly targetId: string; readonly evidenceHash: string }>()
  const auditedCases = cases.filter((item) => {
    const createdAtMs = Date.parse(item.createdAt)
    return item.hasCreatedAudit && createdAtMs >= INITIAL_V1_CASE_IMPORT_STARTED_AT_MS
      && createdAtMs <= INITIAL_V1_CASE_IMPORT_COMPLETED_AT_MS
  })
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.officeSequence - right.officeSequence)
  const clusters: CaseRow[][] = []
  for (const item of auditedCases) {
    const current = clusters.at(-1)
    const previous = current?.at(-1)
    if (previous === undefined || Date.parse(item.createdAt) - Date.parse(previous.createdAt) > 10_000) clusters.push([item])
    else current?.push(item)
  }
  const clusterEvidence = clusters.filter((cluster) => cluster.length >= 10).flatMap((cluster) => {
    const anchors = new Map<string, number[]>()
    for (const item of cluster) {
      const sources = sidecarsByPlate.get(item.plateKey) ?? []
      if (sources.length !== 1 || (byPlate.get(item.plateKey) ?? []).length !== 1) continue
      const source = sources[0]
      const monthKey = source === undefined ? null : historicalMonthKey(source.folder)
      if (monthKey === null) continue
      const values = anchors.get(monthKey) ?? []
      values.push(item.officeSequence)
      anchors.set(monthKey, values)
    }
    const ranges = [...anchors].map(([monthKey, values]) => ({
      monthKey, count: values.length, min: Math.min(...values), max: Math.max(...values),
    })).filter((range) => range.count >= 3).sort((left, right) => left.monthKey.localeCompare(right.monthKey))
    if (ranges.length < 2 || ranges.some((range, index) => index > 0 && (ranges[index - 1]?.max ?? Infinity) >= range.min)) return []
    const caseIds = new Set(cluster.map((item) => item.id))
    return [{ caseIds, ranges, clusterHash: hash(canonicalJson({
      first: cluster[0]?.createdAt, last: cluster.at(-1)?.createdAt,
      ranges: ranges.map((range) => ({ ...range })), size: cluster.length,
    })) }]
  })
  for (const [plateKey, sources] of sidecarsByPlate) {
    const candidates = byPlate.get(plateKey) ?? []
    if (sources.length < 2 || sources.length !== candidates.length) continue
    const proposed = new Map<string, { readonly targetId: string; readonly evidenceHash: string }>()
    for (const source of sources) {
      const monthKey = historicalMonthKey(source.folder)
      if (monthKey === null) continue
      const matches = candidates.flatMap((candidate) => clusterEvidence.flatMap((cluster) => {
        const range = cluster.ranges.find((item) => item.monthKey === monthKey)
        return cluster.caseIds.has(candidate.id) && range !== undefined
          && candidate.officeSequence >= range.min && candidate.officeSequence <= range.max
          ? [{ targetId: candidate.id, evidenceHash: hash(`${cluster.clusterHash}|${monthKey}|${range.count}|${range.min}|${range.max}`) }]
          : []
      }))
      const uniqueTargets = new Map(matches.map((match) => [match.targetId, match]))
      if (uniqueTargets.size === 1) proposed.set(source.folder.relativePath, [...uniqueTargets.values()][0]!)
    }
    const targetCounts = new Map<string, number>()
    for (const proposal of proposed.values()) targetCounts.set(proposal.targetId, (targetCounts.get(proposal.targetId) ?? 0) + 1)
    for (const [path, proposal] of proposed) {
      if (targetCounts.get(proposal.targetId) === 1) lineageTargetHints.set(path, proposal)
    }
  }

  const entries: V1RemediationEntry[] = []
  for (const { folder, sidecar, claimTypeFolderEvidence } of sidecars) {
    const token = pathToken(folder.relativePath)
    const baseFingerprint = hash(`${folder.relativePath}\n${sidecar.jsonHash ?? ''}\n${sidecar.txtHash ?? ''}\n${claimTypeFolderEvidence.scanState}\n${claimTypeFolderEvidence.inventoryHash ?? ''}`)
    if (folder.parsedName === null) {
      entries.push({
        folder, pathToken: token, sourceIdentity: null, sourceIdentityState: 'missing_evidence', sourceHash: sidecar.jsonHash,
        sourceManifestFingerprint: baseFingerprint, rawSnapshot: null, schemaVersion: null, sourceWriteId: null, sourceRevision: null,
        targetCaseId: null, targetState: 'unparseable', missingSidecarClassification: null, caseType: null, caseTypeAutoResolved: false, claimTypeResolution: null,
        evidence: [], candidateCaseIds: [], candidateCaseEvidence: [],
        responsible: emptyReference(), expert: emptyReference(), service: emptyReference(), fields: [], notes: [], tasks: [],
        shouldCloseHistorically: false, sourceClosureAt: null, needsFollowUpHistory: false, needsRawRevision: false, needsAlias: false,
        needsVehicleProfile: false, needsClaimTypeEvidenceProvenance: false, legacyRecordsToReconcile: [], blockers: ['unparseable_folder_name'],
      })
      continue
    }
    if (!folder.hasJson) {
      const existingV2CaseCount = (byPlate.get(plateSearchKey(folder.parsedName.plate)) ?? []).length
      const directoryCreatedAtMs = folder.directoryCreatedAt === null ? Number.NaN : Date.parse(folder.directoryCreatedAt)
      entries.push({
        folder, pathToken: token, sourceIdentity: null, sourceIdentityState: 'missing_evidence', sourceHash: null,
        sourceManifestFingerprint: baseFingerprint, rawSnapshot: null, schemaVersion: null, sourceWriteId: null, sourceRevision: null,
        targetCaseId: null, targetState: 'missing_sidecar',
        missingSidecarClassification: {
          state: 'non_blocking_no_historical_payload', existingV2CaseCount,
          filesystemFreshness: Number.isFinite(directoryCreatedAtMs) && directoryCreatedAtMs > INITIAL_V1_CASE_IMPORT_COMPLETED_AT_MS
            ? 'created_after_initial_import' : 'preexisting_or_unknown',
        },
        caseType: null, caseTypeAutoResolved: false, claimTypeResolution: null,
        evidence: [], candidateCaseIds: [], candidateCaseEvidence: [],
        responsible: emptyReference(), expert: emptyReference(), service: emptyReference(), fields: [], notes: [], tasks: [],
        shouldCloseHistorically: false, sourceClosureAt: null, needsFollowUpHistory: false, needsRawRevision: false, needsAlias: false,
        needsVehicleProfile: false, needsClaimTypeEvidenceProvenance: false, legacyRecordsToReconcile: [], blockers: [],
      })
      continue
    }
    if (sidecar.jsonParse?.ok !== true || sidecar.jsonHash === null) {
      entries.push({
        folder, pathToken: token, sourceIdentity: null, sourceIdentityState: 'missing_evidence', sourceHash: sidecar.jsonHash,
        sourceManifestFingerprint: baseFingerprint, rawSnapshot: null, schemaVersion: null, sourceWriteId: null, sourceRevision: null,
        targetCaseId: null, targetState: 'malformed', missingSidecarClassification: null, caseType: null, caseTypeAutoResolved: false, claimTypeResolution: null,
        evidence: [], candidateCaseIds: [], candidateCaseEvidence: [],
        responsible: emptyReference(), expert: emptyReference(), service: emptyReference(), fields: [], notes: [], tasks: [],
        shouldCloseHistorically: false, sourceClosureAt: null, needsFollowUpHistory: false, needsRawRevision: false, needsAlias: false,
        needsVehicleProfile: false, needsClaimTypeEvidenceProvenance: false, legacyRecordsToReconcile: [], blockers: ['malformed_or_unsupported_json'],
      })
      continue
    }

    const data = sidecar.jsonParse.data
    const sourceIdentity = precomputedIdentities.get(folder.relativePath) ?? null
    const collision = sourceIdentity !== null && (sourceIdentityCounts.get(sourceIdentity) ?? 0) > 1
    const plateKey = plateSearchKey(folder.parsedName.plate)
    const allPlateCandidates = byPlate.get(plateKey) ?? []
    const sourceClaimType = mapV1ClaimType(data.claimType)
    const explicitClaimType = sourceIdentity === null ? undefined : options.resolutions?.claimTypes?.[sourceIdentity]
    const deterministicClaimTypeDecision = claimTypeFolderEvidence.scanState === 'complete'
      ? decideV1ClaimTypeFromEvidence({
          sidecarClaimType: sourceClaimType,
          evidenceKinds: claimTypeFolderEvidence.evidence.map((item) => item.kind),
        })
      : null
    const unresolvedClaimTypeEvidenceConflict = explicitClaimType === undefined
      && deterministicClaimTypeDecision?.state === 'human_required'
      && ['conflicting_k_m_evidence', 'sidecar_filename_evidence_conflict', 'conflicting_claim_document_evidence']
        .includes(deterministicClaimTypeDecision.reason)
    const effectiveClaimType = explicitClaimType
      ?? (deterministicClaimTypeDecision?.state === 'resolved' ? deterministicClaimTypeDecision.caseType : null)
    const typeCandidates = effectiveClaimType === null ? allPlateCandidates : allPlateCandidates.filter((candidate) => candidate.caseType === effectiveClaimType)
    const evidence: V1ResolutionEvidence[] = []
    const provenanceTargets = new Set<string>()
    const sourceItemIds = new Set([
      ...data.notes.map((note) => `note|${note.id}`),
      ...data.todos.map((todo) => `task|${todo.id}`),
    ])
    for (const record of records) {
      if (record.caseId === null || !byCaseId.has(record.caseId)) continue
      if (sourceIdentity !== null && record.stableSourceIdentity === sourceIdentity) {
        provenanceTargets.add(record.caseId)
        evidence.push({ code: 'stable_provenance', verifiableValue: record.id })
      } else if (record.sourceRelativePath === folder.relativePath) {
        provenanceTargets.add(record.caseId)
        evidence.push({ code: 'legacy_path_provenance', verifiableValue: record.id })
      } else if (sourceItemIds.has(`${record.itemType}|${record.sourceItemId}`)
        && sourceNativeIdCounts.get(`${record.itemType}|${record.sourceItemId}`) === 1) {
        provenanceTargets.add(record.caseId)
        evidence.push({ code: 'legacy_native_item_provenance', verifiableValue: record.id })
      }
    }

    let targetCaseId: string | null = null
    const explicitCaseId = sourceIdentity === null ? undefined : options.resolutions?.cases?.[sourceIdentity]
    if (explicitCaseId !== undefined && byCaseId.has(explicitCaseId)) {
      targetCaseId = explicitCaseId
      evidence.push({ code: 'explicit_case_mapping', verifiableValue: explicitCaseId })
    } else if (provenanceTargets.size === 1) {
      targetCaseId = [...provenanceTargets][0] ?? null
    } else if (siblingTargetHints.has(folder.relativePath)) {
      targetCaseId = siblingTargetHints.get(folder.relativePath) ?? null
      if (targetCaseId !== null) evidence.push({ code: 'sibling_source_candidate_elimination', verifiableValue: targetCaseId })
    } else if (lineageTargetHints.has(folder.relativePath)) {
      const lineage = lineageTargetHints.get(folder.relativePath)
      targetCaseId = lineage?.targetId ?? null
      if (targetCaseId !== null && lineage !== undefined) evidence.push({ code: 'initial_import_month_lineage', verifiableValue: lineage.evidenceHash })
    } else {
      const identifiers = [
        { value: data.caseIdentity?.claimNoticeNo?.trim() ?? '', code: 'exact_notification_number' as const,
          matches: (candidate: CaseRow, value: string) => candidate.notificationFormNumber === value },
        { value: data.caseIdentity?.dosyaNo?.trim() ?? '', code: 'exact_claim_number' as const,
          matches: (candidate: CaseRow, value: string) => candidate.insurerClaimNumber === value },
        { value: data.caseIdentity?.officeFileNo?.trim() ?? '', code: 'exact_office_number' as const,
          matches: (candidate: CaseRow, value: string) => candidate.officeNumber === value },
      ].filter((identifier) => identifier.value.length > 0)
      const exactIdentifierTargets = new Set(identifiers.flatMap((identifier) =>
        typeCandidates.filter((candidate) => identifier.matches(candidate, identifier.value)).map((candidate) => candidate.id)))
      if (exactIdentifierTargets.size === 1) {
        targetCaseId = [...exactIdentifierTargets][0] ?? null
        for (const identifier of identifiers) {
          if (typeCandidates.some((candidate) => candidate.id === targetCaseId && identifier.matches(candidate, identifier.value))) {
            evidence.push({ code: identifier.code, verifiableValue: hash(identifier.value).slice(0, 16) })
          }
        }
      } else if (typeCandidates.length === 1) {
        targetCaseId = typeCandidates[0]?.id ?? null
        evidence.push({
          code: effectiveClaimType === null ? 'unique_plate_existing_case' : 'unique_plate_and_case_type',
          verifiableValue: targetCaseId ?? '',
        })
      }
    }

    let targetState: V1RemediationEntry['targetState']
    let caseType: CaseType | null = effectiveClaimType
    let caseTypeAutoResolved = explicitClaimType === undefined && sourceClaimType === 'unknown'
      && deterministicClaimTypeDecision?.state === 'resolved'
      && ['k_ruhsat', 'm_ruhsat', 'kasko_claim_policy', 'm_traffic_policy', 'sidecar_corroborated_over_conflicting_ruhsat']
        .includes(deterministicClaimTypeDecision.reason)
    const blockers: string[] = []
    if (sourceIdentity === null || collision) {
      targetState = 'human_identity'
      blockers.push(sourceIdentity === null ? 'stable_identity_evidence_missing' : 'stable_identity_collision')
    } else if (claimTypeFolderEvidence.scanState === 'failed') {
      targetState = 'human_claim_type'
      targetCaseId = null
      blockers.push('claim_type_evidence_scan_failed')
    } else if (unresolvedClaimTypeEvidenceConflict) {
      targetState = 'human_claim_type'
      targetCaseId = null
      blockers.push('conflicting_claim_type_evidence')
    } else if (targetCaseId !== null) {
      targetState = 'existing'
      const target = byCaseId.get(targetCaseId)
      if (target === undefined || target.plateKey !== plateKey) {
        targetState = 'human_ambiguous'
        targetCaseId = null
        blockers.push('target_plate_mismatch')
      } else {
        if (caseType === null) {
          caseType = target.caseType
          caseTypeAutoResolved = true
        } else if (caseType !== target.caseType) {
          targetState = 'human_ambiguous'
          targetCaseId = null
          blockers.push('case_type_conflict')
        }
      }
    } else if (caseType === null) {
      targetState = allPlateCandidates.length > 1 ? 'human_ambiguous' : 'human_claim_type'
      blockers.push(targetState === 'human_ambiguous' ? 'ambiguous_target' : 'unknown_claim_type')
    } else if (typeCandidates.length === 0 && provenanceTargets.size === 0) {
      targetState = 'create'
      evidence.push({ code: 'new_case', verifiableValue: sourceIdentity })
    } else {
      targetState = 'human_ambiguous'
      blockers.push('ambiguous_target')
    }

    const resolutionReason: V1ClaimTypeResolution['resolutionReason'] = claimTypeFolderEvidence.scanState === 'failed'
      ? 'evidence_scan_failed'
      : explicitClaimType !== undefined
        ? 'explicit_mapping'
        : deterministicClaimTypeDecision?.state === 'resolved'
          ? deterministicClaimTypeDecision.reason
          : caseTypeAutoResolved
            ? 'existing_case_deterministic'
            : deterministicClaimTypeDecision?.reason ?? 'no_deterministic_evidence'
    const claimTypeResolution: V1ClaimTypeResolution = {
      scanState: claimTypeFolderEvidence.scanState,
      inventoryHash: claimTypeFolderEvidence.inventoryHash,
      evidenceFingerprint: claimTypeFolderEvidence.evidenceFingerprint,
      sidecarClaimType: sourceClaimType,
      evidence: claimTypeFolderEvidence.evidence,
      deterministicReason: claimTypeFolderEvidence.scanState === 'failed'
        ? 'evidence_scan_failed'
        : deterministicClaimTypeDecision?.reason ?? 'no_deterministic_evidence',
      resolutionReason,
      caseType,
      humanRequired: targetState === 'human_claim_type',
    }

    const target = targetCaseId === null ? null : byCaseId.get(targetCaseId) ?? null
    const responsible = resolveReference(data.assignment?.sorumlu ?? '', usersResult.rows, options.resolutions?.users, validUsers)
    const expert = resolveReference(data.assignment?.eksper ?? '', expertsResult.rows, options.resolutions?.experts, validExperts)
    const service = resolveReference(data.service?.name ?? '', servicesResult.rows, options.resolutions?.services, validServices)
    const followUp = safeDate(data.assignment?.takipTarihi ?? '') ?? safeDate(data.assignment?.sonIslemTarihi ?? '')
    const fields: V1RemediationFieldItem[] = target === null ? [] : [
      fieldPlan(target.notificationFormNumber, data.caseIdentity?.claimNoticeNo ?? '', 'notificationFormNumber'),
      fieldPlan(target.insurerClaimNumber, data.caseIdentity?.dosyaNo ?? '', 'insurerClaimNumber'),
      fieldPlan(target.followUpDate, followUp, 'followUpDate'),
      referenceFieldPlan(target.responsibleUserId, responsible, 'responsibleUserId'),
      referenceFieldPlan(target.expertUserId, expert, 'expertUserId'),
      referenceFieldPlan(target.serviceId, service, 'serviceId'),
    ]
    const legacyRecordsToReconcile: Array<{ recordId: string; stableItemIdentity: string; evidenceCode: string }> = []
    const matchedLegacyPaths = new Set<string>([folder.relativePath])
    const notes: V1RemediationNoteItem[] = data.notes.map((note) => {
      const stableItemIdentity = itemIdentity(sourceIdentity ?? '0'.repeat(64), 'note', note.id)
      const stableRecord = records.find((record) => record.itemType === 'note' && record.stableSourceIdentity === sourceIdentity && record.stableItemIdentity === stableItemIdentity)
      const reconciled = extra[2].rows.find((row) => row.stable_source_identity === sourceIdentity && row.stable_item_identity === stableItemIdentity)
      const legacy = records.find((record) => record.stableSourceIdentity === null && record.itemType === 'note' && record.sourceItemId === note.id
        && record.caseId === targetCaseId && (record.sourceRelativePath === folder.relativePath || sourceNativeIdCounts.get(`note|${note.id}`) === 1))
      const existingRecord = stableRecord ?? (reconciled === undefined ? legacy : records.find((record) => record.id === reconciled.legacy_import_record_id))
      if (legacy !== undefined && reconciledByRecord.get(legacy.id) === undefined) {
        matchedLegacyPaths.add(legacy.sourceRelativePath)
        legacyRecordsToReconcile.push({ recordId: legacy.id, stableItemIdentity, evidenceCode: legacy.sourceRelativePath === folder.relativePath ? 'legacy_path' : 'native_item_unique' })
      }
      const targetId = existingRecord?.targetId ?? null
      const alreadyImported = targetId !== null && notesById.has(targetId)
      const attributed = `[V1 kaynak: ${note.createdBy || 'bilinmiyor'}, ${note.createdAt || 'tarih yok'}] ${note.text}`.slice(0, 5000)
      const duplicateContentCandidate = !alreadyImported && targetCaseId !== null
        && noteRows.some((row) => row.case_id === targetCaseId && (row.body === note.text || row.body === attributed))
      return {
        nativeId: note.id, stableItemIdentity, text: note.text, sourceAuthor: note.createdBy,
        sourceOccurredAt: safeTimestamp(note.createdAt), alreadyImported, legacyRecordId: legacy?.id ?? null,
        targetId, duplicateContentCandidate,
      }
    })
    if (notes.some((note) => note.text.trim().length === 0)) blockers.push('note_text_missing')

    const tasks: V1RemediationTaskItem[] = data.todos.map((todo) => {
      const stableItemIdentity = itemIdentity(sourceIdentity ?? '0'.repeat(64), 'task', todo.id)
      const stableRecord = records.find((record) => record.itemType === 'task' && record.stableSourceIdentity === sourceIdentity && record.stableItemIdentity === stableItemIdentity)
      const reconciled = extra[2].rows.find((row) => row.stable_source_identity === sourceIdentity && row.stable_item_identity === stableItemIdentity)
      const legacy = records.find((record) => record.stableSourceIdentity === null && record.itemType === 'task' && record.sourceItemId === todo.id
        && record.caseId === targetCaseId && (record.sourceRelativePath === folder.relativePath || sourceNativeIdCounts.get(`task|${todo.id}`) === 1))
      const existingRecord = stableRecord ?? (reconciled === undefined ? legacy : records.find((record) => record.id === reconciled.legacy_import_record_id))
      if (legacy !== undefined && reconciledByRecord.get(legacy.id) === undefined) {
        matchedLegacyPaths.add(legacy.sourceRelativePath)
        legacyRecordsToReconcile.push({ recordId: legacy.id, stableItemIdentity, evidenceCode: legacy.sourceRelativePath === folder.relativePath ? 'legacy_path' : 'native_item_unique' })
      }
      const targetId = existingRecord?.targetId ?? null
      const taskRow = targetId === null ? undefined : tasksById.get(targetId)
      const assignee = resolveReference(todo.assignedTo, usersResult.rows, options.resolutions?.users, validUsers)
      const sourceCreatedAt = safeTimestamp(todo.createdAt)
      const dueDate = safeDate(todo.dueDate) ?? followUp ?? (sourceCreatedAt?.slice(0, 10) ?? null)
      const sourceCompletedAt = todo.completed ? safeTimestamp(todo.completedAt) : null
      const duplicateContentCandidate = taskRow === undefined && targetCaseId !== null
        && taskRows.some((row) => row.case_id === targetCaseId && row.title === todo.title)
      if (todo.completed && sourceCompletedAt === null) blockers.push('completed_task_time_missing')
      if (dueDate === null) blockers.push('task_due_date_missing')
      if (todo.title.trim().length === 0) blockers.push('task_title_missing')
      return {
        nativeId: todo.id, stableItemIdentity, title: todo.title, priority: mapPriority(todo.priority), completed: todo.completed,
        sourceCreatedAt, sourceCompletedAt, dueDate, sourceAssignee: todo.assignedTo, assignee, alreadyImported: taskRow !== undefined,
        legacyRecordId: legacy?.id ?? null, targetId, needsEventBackfill: taskRow !== undefined && taskRow.event_count === 0,
        duplicateContentCandidate,
      }
    })
    if (notes.some((note) => note.duplicateContentCandidate)) blockers.push('duplicate_content_needs_human_resolution')
    if (tasks.some((task) => task.duplicateContentCandidate)) blockers.push('duplicate_task_candidate_needs_human_resolution')

    const sourceClosed = folder.physicallyUnderKapali
    // Gercek semada kapanis zamani yoktur; tracking audit yalniz created/updated
    // aksiyonlari tasir. metadata.updatedAt kapanis zamani diye UYDURULMAZ.
    const sourceClosureAt: string | null = null
    const shouldCloseHistorically = sourceClosed && ((target !== null && target.lifecycleStatus === 'open') || targetState === 'create')
    const needsFollowUpHistory = followUp !== null
      && ((target !== null && (target.followUpDate === followUp || target.followUpDate === null)) || targetState === 'create')
      && !followUpResult.rows.some((row) => row.case_id === target?.id && row.source === 'v1_historical_import' && row.source_identity === sourceIdentity)
    const vehicle = data.vehicleContext
    const modelYear = Number(vehicle?.modelYear)
    const vehicleValidation = vehicle === undefined ? null : validateCaseVehicleProfile({
      brand: vehicle.make, model: vehicle.model, modelYear,
      variant: null, vehicleClass: 'other', chassisPrefix: null, engineCode: null,
      evidenceSource: 'other', evidenceReference: 'V1 historical import',
    })
    const needsVehicleProfile = (targetState === 'create' || (target !== null && !target.vehicleProfileExists)) && vehicleValidation?.valid === true
    const hasDecisiveFilenameEvidence = claimTypeFolderEvidence.evidence.some((item) =>
      ['k_ruhsat', 'm_ruhsat', 'kasko_claim_policy', 'm_traffic_policy'].includes(item.kind))
    const claimTypeEvidenceStableItemIdentity = sourceIdentity !== null && claimTypeFolderEvidence.evidenceFingerprint !== null
      ? itemIdentity(sourceIdentity, 'field', `field:claimTypeEvidence:${claimTypeFolderEvidence.evidenceFingerprint}`)
      : null
    const needsClaimTypeEvidenceProvenance = targetState === 'existing' && targetCaseId !== null
      && hasDecisiveFilenameEvidence && claimTypeEvidenceStableItemIdentity !== null
      && !records.some((record) => record.itemType === 'field_backfill'
        && record.stableSourceIdentity === sourceIdentity && record.stableItemIdentity === claimTypeEvidenceStableItemIdentity)

    if (sourceIdentity !== null && targetCaseId !== null) {
      for (const legacy of records) {
        if (legacy.stableSourceIdentity !== null || legacy.caseId !== targetCaseId) continue
        const evidenceCode = legacy.sourceRelativePath === folder.relativePath
          ? 'legacy_path'
          : legacy.sourceFileHash === sidecar.jsonHash
            ? 'legacy_source_hash'
            : matchedLegacyPaths.has(legacy.sourceRelativePath)
              ? 'legacy_native_item_lineage'
              : null
        if (evidenceCode === null) continue
        if (legacy.itemType !== 'case' && legacy.itemType !== 'field_backfill' && legacy.itemType !== 'vehicle_profile') continue
        if (reconciledByRecord.has(legacy.id)) continue
        const type = legacy.itemType === 'case' ? 'case' : legacy.itemType === 'vehicle_profile' ? 'vehicle_profile' : 'field'
        legacyRecordsToReconcile.push({
          recordId: legacy.id,
          stableItemIdentity: itemIdentity(sourceIdentity, type, legacy.sourceItemId),
          evidenceCode,
        })
      }
    }

    entries.push({
      folder, pathToken: token, sourceIdentity, sourceIdentityState: collision ? 'collision' : sourceIdentity === null ? 'missing_evidence' : 'resolved',
      sourceHash: sidecar.jsonHash, sourceManifestFingerprint: baseFingerprint, rawSnapshot: data, schemaVersion: sidecar.jsonParse.schemaVersion,
      sourceWriteId: data.metadata?.writeId?.trim() || null, sourceRevision: data.metadata?.revision ?? null,
      targetCaseId, targetState, missingSidecarClassification: null, caseType, caseTypeAutoResolved, claimTypeResolution, evidence,
      candidateCaseIds: allPlateCandidates.map((candidate) => candidate.id),
      candidateCaseEvidence: allPlateCandidates.map((candidate) => ({
        caseId: candidate.id,
        caseType: candidate.caseType,
        lifecycleStatus: candidate.lifecycleStatus,
        provenanceMatch: provenanceTargets.has(candidate.id),
        notificationNumberMatch: (data.caseIdentity?.claimNoticeNo?.trim() ?? '').length > 0
          && candidate.notificationFormNumber === data.caseIdentity?.claimNoticeNo?.trim(),
        claimNumberMatch: (data.caseIdentity?.dosyaNo?.trim() ?? '').length > 0
          && candidate.insurerClaimNumber === data.caseIdentity?.dosyaNo?.trim(),
        officeNumberMatch: (data.caseIdentity?.officeFileNo?.trim() ?? '').length > 0
          && candidate.officeNumber === data.caseIdentity?.officeFileNo?.trim(),
      })),
      responsible, expert, service, fields, notes, tasks, shouldCloseHistorically, sourceClosureAt, needsFollowUpHistory,
      needsRawRevision: sourceIdentity !== null && !revisionKeys.has(`${sourceIdentity}|${sidecar.jsonHash}`),
      needsAlias: sourceIdentity !== null && !aliasKeys.has(`${sourceIdentity}|${folder.relativePath}`),
      needsVehicleProfile, needsClaimTypeEvidenceProvenance, legacyRecordsToReconcile, blockers: [...new Set(blockers)],
    })
  }

  const actionableEntries = entries.filter(isActionableEntry)
  const plannedNotes = actionableEntries.flatMap((entry) => entry.notes.filter(noteNeedsCreate))
  const plannedTasks = actionableEntries.flatMap((entry) => entry.tasks.filter(taskNeedsCreate))
  const moveRenameReconciliations = entries.reduce((sum, entry) => sum + entry.legacyRecordsToReconcile.filter((item) => item.evidenceCode === 'native_item_unique').length, 0)
  const duplicateCount = entries.reduce((sum, entry) => sum
    + entry.notes.filter((note) => !note.alreadyImported && note.duplicateContentCandidate).length
    + entry.tasks.filter((task) => !task.alreadyImported && task.duplicateContentCandidate).length, 0)
  const current = currentResult.rows[0] as { cases: number; notes: number; tasks: number; provenance: number }
  const legacyStates = new Set<V1ResolvedReference['state']>(['legacy_only', 'ambiguous_legacy'])
  const uniqueLegacyTokens = (selector: (entry: V1RemediationEntry) => V1ResolvedReference): number => new Set(
    entries.map(selector).filter((reference) => legacyStates.has(reference.state)).map((reference) => reference.sourceNameToken),
  ).size
  const summary: V1RemediationSummary = {
    current,
    actionable: {
      casesToCreate: actionableEntries.filter((entry) => entry.targetState === 'create').length,
      casesToBackfill: actionableEntries.filter((entry) => entry.targetState === 'existing' && (
        entry.fields.some((field) => field.state === 'missing') || entry.notes.some(noteNeedsCreate)
        || entry.tasks.some(taskNeedsCreate) || entry.shouldCloseHistorically || entry.needsFollowUpHistory || entry.needsVehicleProfile
        || entry.needsClaimTypeEvidenceProvenance
      )).length,
      notesToCreate: plannedNotes.length,
      tasksToCreate: plannedTasks.filter((task) => !task.completed).length,
      completedTasksToCreate: plannedTasks.filter((task) => task.completed).length,
      closuresToImport: actionableEntries.filter((entry) => entry.shouldCloseHistorically).length,
      otherFieldMappings: actionableEntries.reduce((sum, entry) => sum + entry.fields.filter((field) => field.state === 'missing').length + (entry.needsVehicleProfile ? 1 : 0), 0),
    },
    safeRemediation: {
      notesMissing: plannedNotes.length,
      tasksMissing: plannedTasks.filter((task) => !task.completed).length,
      completedTasksMissing: plannedTasks.filter((task) => task.completed).length,
      fieldsMissing: actionableEntries.reduce((sum, entry) => sum + entry.fields.filter((field) => field.state === 'missing').length + (entry.needsVehicleProfile ? 1 : 0), 0),
      historicalClosures: actionableEntries.filter((entry) => entry.shouldCloseHistorically).length,
      followUpHistory: actionableEntries.filter((entry) => entry.needsFollowUpHistory).length,
      taskEvents: actionableEntries.reduce((sum, entry) => sum + entry.tasks.reduce((taskSum, task) => {
        if (task.needsEventBackfill) return taskSum + 1
        if (!taskNeedsCreate(task)) return taskSum
        return taskSum + (task.completed ? 2 : 1)
      }, 0), 0),
      rawSnapshotsAndProvenance: entries.filter((entry) => entry.sourceIdentityState === 'resolved'
        && (entry.needsRawRevision || entry.needsAlias || entry.needsClaimTypeEvidenceProvenance)).length,
      moveRenameReconciliations,
    },
    blocked: {
      unknownClaimType: entries.filter((entry) => entry.targetState === 'human_claim_type').length,
      ambiguousCase: entries.filter((entry) => entry.targetState === 'human_ambiguous').length,
      unresolvedUser: 0,
      unresolvedExpert: 0,
      unresolvedService: 0,
      malformed: entries.filter((entry) => entry.targetState === 'malformed' || entry.targetState === 'unparseable').length,
      missingSidecar: 0,
      conflictingEvidence: entries.filter((entry) => entry.blockers.includes('conflicting_claim_type_evidence')).length,
      other: entries.filter((entry) => entry.targetState === 'human_identity'
        || entry.blockers.includes('duplicate_content_needs_human_resolution')
        || entry.blockers.includes('duplicate_task_candidate_needs_human_resolution')
        || entry.blockers.includes('note_text_missing')
        || entry.blockers.includes('task_title_missing')
        || entry.blockers.includes('task_due_date_missing')
        || entry.blockers.includes('completed_task_time_missing')).length,
    },
    autoResolved: {
      unknownClaimTypes: entries.filter((entry) => entry.caseTypeAutoResolved).length,
      ambiguousCases: entries.filter((entry) => entry.candidateCaseIds.length > 1 && entry.targetCaseId !== null
        && entry.evidence.some((item) => ['stable_provenance', 'legacy_path_provenance', 'legacy_native_item_provenance',
          'exact_notification_number', 'sibling_source_candidate_elimination', 'initial_import_month_lineage'].includes(item.code))).length,
      users: entries.filter((entry) => entry.responsible.state === 'auto_resolved').length,
      experts: entries.filter((entry) => entry.expert.state === 'auto_resolved').length,
      services: entries.filter((entry) => entry.service.state === 'auto_resolved').length,
      unassignedResponsible: entries.filter((entry) => entry.responsible.state === 'legacy_unassigned').length,
      // V1 servis adi servis turunu (authorized/private/...) kanitlamaz;
      // zorunlu domain alanini uydurarak master row yaratmak planlanmaz.
      servicesPlanned: 0,
    },
    blockingHumanDecisions: {
      claimType: entries.filter((entry) => entry.targetState === 'human_claim_type').length,
      ambiguousTarget: entries.filter((entry) => entry.targetState === 'human_ambiguous').length,
    },
    nonBlockingLegacy: {
      responsibleRecords: entries.filter((entry) => legacyStates.has(entry.responsible.state)).length,
      responsibleNames: uniqueLegacyTokens((entry) => entry.responsible),
      expertRecords: entries.filter((entry) => legacyStates.has(entry.expert.state)).length,
      expertNames: uniqueLegacyTokens((entry) => entry.expert),
      serviceRecords: entries.filter((entry) => legacyStates.has(entry.service.state)).length,
      serviceNames: uniqueLegacyTokens((entry) => entry.service),
      missingSidecar: entries.filter((entry) => entry.targetState === 'missing_sidecar').length,
      other: entries.filter((entry) => entry.responsible.state === 'legacy_unassigned').length,
    },
    humanRequired: {
      unresolvedClaimType: entries.filter((entry) => entry.targetState === 'human_claim_type').length,
      ambiguousTarget: entries.filter((entry) => entry.targetState === 'human_ambiguous').length,
      userMapping: 0,
      expertMapping: 0,
      serviceMapping: 0,
      other: entries.filter((entry) => entry.targetState === 'human_identity'
        || entry.blockers.includes('duplicate_content_needs_human_resolution')
        || entry.blockers.includes('duplicate_task_candidate_needs_human_resolution')
        || entry.blockers.includes('note_text_missing')
        || entry.blockers.includes('task_title_missing')
        || entry.blockers.includes('task_due_date_missing')
        || entry.blockers.includes('completed_task_time_missing')).length,
    },
    duplicatesThatWouldBeCreated: duplicateCount,
  }
  const sourceManifestHash = hash(canonicalJson(entries.map((entry) => ({ pathToken: entry.pathToken, fingerprint: entry.sourceManifestFingerprint })).sort((a, b) => a.pathToken.localeCompare(b.pathToken))))
  const withoutHash = {
    organizationId, mappingVersion: V1_REMEDIATION_MAPPING_VERSION, identityVersion: V1_IDENTITY_VERSION,
    schemaReady, sourceManifestHash, summary, entries,
  }
  const planHash = hash(canonicalJson(planHashPayload(withoutHash)))
  return {
    organizationId, rootPath, generatedAt: new Date().toISOString(), mappingVersion: V1_REMEDIATION_MAPPING_VERSION,
    identityVersion: V1_IDENTITY_VERSION, schemaReady, sourceManifestHash, planHash, summary, entries,
  }
}

export interface V1RemediationApplyResult {
  readonly planHash: string
  readonly sourcesRecorded: number
  readonly aliasesRecorded: number
  readonly legacyRecordsReconciled: number
  readonly casesCreated: number
  readonly fieldsBackfilled: number
  readonly notesCreated: number
  readonly tasksCreated: number
  readonly completedTasksCreated: number
  readonly taskEventsCreated: number
  readonly followUpHistoryCreated: number
  readonly historicalClosures: number
  readonly vehicleProfilesCreated: number
  readonly claimTypeEvidenceRecorded: number
  readonly failed: number
}

async function insertStableProvenance(
  client: pg.PoolClient,
  actor: { organizationId: string; actorUserId: string },
  entry: V1RemediationEntry,
  revisionId: string,
  itemType: 'case' | 'field_backfill' | 'note' | 'task' | 'vehicle_profile',
  nativeItemId: string,
  stableItemIdentity: string,
  targetType: 'case' | 'case_note' | 'case_task' | 'case_vehicle_profile',
  targetId: string,
  status: 'created' | 'backfilled',
  caseId: string,
  fieldDiffs: unknown = null,
): Promise<boolean> {
  const inserted = await client.query(
    `INSERT INTO v1_import_records
      (id,organization_id,case_id,source_relative_path,source_file_kind,source_file_hash,source_schema_version,
       source_write_id,source_revision,item_type,source_item_id,target_type,target_id,status,field_diffs,raw_snapshot,
       imported_by_user_id,stable_source_identity,stable_item_identity,source_revision_id)
     VALUES ($1,$2,$3,$4,'takip_json',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NULL,$15,$16,$17,$18)
     ON CONFLICT DO NOTHING`,
    [uuidv7(), actor.organizationId, caseId, entry.folder.relativePath, entry.sourceHash, entry.schemaVersion,
      entry.sourceWriteId, entry.sourceRevision, itemType, nativeItemId, targetType, targetId, status,
      fieldDiffs === null ? null : JSON.stringify(fieldDiffs), actor.actorUserId, entry.sourceIdentity, stableItemIdentity, revisionId],
  )
  return inserted.rowCount === 1
}

async function insertItemMetadata(
  client: pg.PoolClient,
  actor: { organizationId: string; actorUserId: string },
  entry: V1RemediationEntry,
  args: {
    caseId: string; stableItemIdentity: string; itemType: 'note' | 'task' | 'follow_up' | 'closure' | 'vehicle_profile' | 'field';
    nativeItemId: string; targetType: 'case' | 'case_note' | 'case_task' | 'case_follow_up_history' | 'case_lifecycle_history' | 'case_vehicle_profile';
    targetId: string; sourceAuthor?: string; sourceAssignee?: string; sourceOccurredAt?: string | null; sourceCompletedAt?: string | null; snapshot: unknown;
  },
): Promise<boolean> {
  const inserted = await client.query(
    `INSERT INTO v1_import_item_metadata
      (id,organization_id,case_id,stable_source_identity,stable_item_identity,item_type,native_item_id,target_type,target_id,
       source_author_name,source_assignee_name,source_occurred_at,source_completed_at,source_item_snapshot,imported_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15)
     ON CONFLICT DO NOTHING`,
    [uuidv7(), actor.organizationId, args.caseId, entry.sourceIdentity, args.stableItemIdentity, args.itemType, args.nativeItemId,
      args.targetType, args.targetId, args.sourceAuthor?.trim().slice(0, 160) || null, args.sourceAssignee?.trim().slice(0, 160) || null,
      args.sourceOccurredAt ?? null, args.sourceCompletedAt ?? null, JSON.stringify(args.snapshot), actor.actorUserId],
  )
  return inserted.rowCount === 1
}

/**
 * Production writer. CLI must require a real TTY, exact plan hash and explicit
 * confirmation. The function independently rebuilds the plan and fails closed
 * on any source/DB drift before the first mutation.
 */
export async function applyV1Remediation(
  pool: pg.Pool,
  actor: { readonly organizationId: string; readonly actorUserId: string; readonly requestId: string },
  approvedPlan: V1RemediationPlan,
  options: V1RemediationOptions = {},
): Promise<V1RemediationApplyResult> {
  if (!approvedPlan.schemaReady) throw new Error('v1_remediation_schema_not_applied')
  if (approvedPlan.summary.duplicatesThatWouldBeCreated !== 0) throw new Error('v1_remediation_duplicate_risk')
  const fresh = await planV1Remediation(pool, actor.organizationId, approvedPlan.rootPath, options)
  if (fresh.planHash !== approvedPlan.planHash || fresh.sourceManifestHash !== approvedPlan.sourceManifestHash) {
    throw new Error('v1_remediation_plan_stale')
  }
  const audit = createAuditService()
  const totals = {
    planHash: approvedPlan.planHash, sourcesRecorded: 0, aliasesRecorded: 0, legacyRecordsReconciled: 0,
    casesCreated: 0, fieldsBackfilled: 0, notesCreated: 0, tasksCreated: 0, completedTasksCreated: 0,
    taskEventsCreated: 0, followUpHistoryCreated: 0, historicalClosures: 0, vehicleProfilesCreated: 0,
    claimTypeEvidenceRecorded: 0, failed: 0,
  }

  for (const entry of fresh.entries) {
    if (entry.sourceIdentityState !== 'resolved' || entry.sourceIdentity === null
      || entry.rawSnapshot === null || entry.sourceHash === null || entry.schemaVersion === null) continue
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      let entryChanged = false
      const businessMutationBaseline = totals.casesCreated + totals.fieldsBackfilled + totals.notesCreated
        + totals.tasksCreated + totals.completedTasksCreated + totals.taskEventsCreated
        + totals.followUpHistoryCreated + totals.historicalClosures + totals.vehicleProfilesCreated
      await client.query(
        `INSERT INTO v1_import_sources
          (id,organization_id,stable_source_identity,identity_kind,identity_version,first_discovered_at,created_by_user_id)
         VALUES ($1,$2,$3,'case_key_created_at',$4,$5,$6) ON CONFLICT DO NOTHING`,
        [uuidv7(), actor.organizationId, entry.sourceIdentity, V1_IDENTITY_VERSION, fresh.generatedAt, actor.actorUserId],
      )
      const revisionId = uuidv7()
      const revisionInsert = await client.query(
        `INSERT INTO v1_import_source_revisions
          (id,organization_id,stable_source_identity,source_file_hash,source_schema_version,source_write_id,source_revision,
           mapping_version,raw_snapshot,discovered_at,recorded_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)
         ON CONFLICT DO NOTHING RETURNING id::text`,
        [revisionId, actor.organizationId, entry.sourceIdentity, entry.sourceHash, entry.schemaVersion, entry.sourceWriteId,
          entry.sourceRevision, V1_REMEDIATION_MAPPING_VERSION, JSON.stringify(entry.rawSnapshot), fresh.generatedAt, actor.actorUserId],
      )
      entryChanged = revisionInsert.rowCount === 1
      let stableRevisionId = revisionInsert.rows[0] === undefined ? null : String((revisionInsert.rows[0] as { id: string }).id)
      if (stableRevisionId === null) {
        const existing = await client.query<{ id: string }>(
          `SELECT id::text FROM v1_import_source_revisions
            WHERE organization_id=$1 AND stable_source_identity=$2 AND source_file_hash=$3 AND mapping_version=$4`,
          [actor.organizationId, entry.sourceIdentity, entry.sourceHash, V1_REMEDIATION_MAPPING_VERSION],
        )
        stableRevisionId = existing.rows[0]?.id ?? null
      }
      if (stableRevisionId === null) throw new Error('v1_source_revision_unavailable')
      if (entry.needsRawRevision) totals.sourcesRecorded += 1
      const alias = await client.query(
        `INSERT INTO v1_import_source_aliases
          (id,organization_id,stable_source_identity,source_relative_path,source_file_hash,discovered_at,recorded_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id`,
        [uuidv7(), actor.organizationId, entry.sourceIdentity, entry.folder.relativePath, entry.sourceHash, fresh.generatedAt, actor.actorUserId],
      )
      totals.aliasesRecorded += alias.rowCount ?? 0
      entryChanged = (alias.rowCount ?? 0) > 0 || entryChanged
      for (const reconciliation of entry.legacyRecordsToReconcile) {
        const inserted = await client.query(
          `INSERT INTO v1_import_record_reconciliations
            (id,organization_id,legacy_import_record_id,stable_source_identity,stable_item_identity,evidence,mapping_version,reconciled_by_user_id)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8) ON CONFLICT DO NOTHING RETURNING id`,
          [uuidv7(), actor.organizationId, reconciliation.recordId, entry.sourceIdentity, reconciliation.stableItemIdentity,
            JSON.stringify({ code: reconciliation.evidenceCode, sourceHash: entry.sourceHash }), V1_REMEDIATION_MAPPING_VERSION, actor.actorUserId],
        )
        totals.legacyRecordsReconciled += inserted.rowCount ?? 0
        entryChanged = (inserted.rowCount ?? 0) > 0 || entryChanged
      }

      const actionable = isActionableEntry(entry)
      let caseId = entry.targetCaseId
      if (actionable && entry.targetState === 'create') {
        const counter = await client.query(
          `INSERT INTO office_counters (organization_id,office_year,last_sequence) VALUES ($1,$2,1)
           ON CONFLICT (organization_id,office_year) DO UPDATE SET last_sequence=office_counters.last_sequence+1
           RETURNING last_sequence`, [actor.organizationId, new Date().getFullYear()],
        )
        const year = new Date().getFullYear()
        const sequence = Number((counter.rows[0] as { last_sequence: number }).last_sequence)
        caseId = uuidv7()
        const followUp = safeDate(entry.rawSnapshot.assignment?.takipTarihi ?? '') ?? safeDate(entry.rawSnapshot.assignment?.sonIslemTarihi ?? '')
        await client.query(
          `INSERT INTO cases
            (id,organization_id,office_year,office_sequence,office_number,case_type,workflow_stage,notification_form_number,
             insurer_claim_number,plate,plate_normalized,responsible_user_id,expert_user_id,service_center_id,follow_up_date)
           VALUES ($1,$2,$3,$4,$5,$6,'new_notification',$7,$8,$9,$10,$11,$12,$13,$14)`,
          [caseId, actor.organizationId, year, sequence, `${year}/${sequence}`, entry.caseType,
            entry.rawSnapshot.caseIdentity?.claimNoticeNo?.trim() || null, entry.rawSnapshot.caseIdentity?.dosyaNo?.trim() || null,
            entry.folder.parsedName?.plate, plateSearchKey(entry.folder.parsedName!.plate), entry.responsible.targetId,
            entry.expert.targetId, entry.service.targetId, followUp],
        )
        const stableCaseItem = itemIdentity(entry.sourceIdentity, 'case', 'case')
        const hasDecisiveClaimTypeEvidence = entry.claimTypeResolution?.evidence
          .some((item) => item.kind === 'k_ruhsat' || item.kind === 'm_ruhsat') === true
        await insertStableProvenance(client, actor, entry, stableRevisionId, 'case', 'case', stableCaseItem, 'case', caseId, 'created', caseId)
        if (hasDecisiveClaimTypeEvidence && entry.claimTypeResolution?.evidenceFingerprint != null) {
          const nativeId = `field:claimTypeEvidence:${entry.claimTypeResolution.evidenceFingerprint}`
          const stableEvidenceItem = itemIdentity(entry.sourceIdentity, 'field', nativeId)
          const inserted = await insertStableProvenance(
            client, actor, entry, stableRevisionId, 'field_backfill', nativeId, stableEvidenceItem,
            'case', caseId, 'backfilled', caseId,
            { source: 'v1_historical_import', claimTypeResolution: entry.claimTypeResolution },
          )
          totals.claimTypeEvidenceRecorded += inserted ? 1 : 0
        }
        totals.casesCreated += 1
      }

      if (actionable && caseId !== null) {
        if (entry.needsClaimTypeEvidenceProvenance && entry.claimTypeResolution?.evidenceFingerprint != null) {
          const nativeId = `field:claimTypeEvidence:${entry.claimTypeResolution.evidenceFingerprint}`
          const stableEvidenceItem = itemIdentity(entry.sourceIdentity, 'field', nativeId)
          const inserted = await insertStableProvenance(
            client, actor, entry, stableRevisionId, 'field_backfill', nativeId, stableEvidenceItem,
            'case', caseId, 'backfilled', caseId,
            { source: 'v1_historical_import', claimTypeResolution: entry.claimTypeResolution },
          )
          totals.claimTypeEvidenceRecorded += inserted ? 1 : 0
          entryChanged = inserted || entryChanged
        }
        for (const field of entry.fields) {
          if (field.state !== 'missing' || field.value === null) continue
          const column = field.field === 'notificationFormNumber' ? 'notification_form_number'
            : field.field === 'insurerClaimNumber' ? 'insurer_claim_number'
              : field.field === 'followUpDate' ? 'follow_up_date'
                : field.field === 'responsibleUserId' ? 'responsible_user_id'
                  : field.field === 'expertUserId' ? 'expert_user_id' : 'service_center_id'
          const updated = await client.query(
            `UPDATE cases SET ${column}=$3,version=version+1,updated_at=now()
              WHERE organization_id=$1 AND id=$2 AND ${column} IS NULL RETURNING version`,
            [actor.organizationId, caseId, field.value],
          )
          if (updated.rowCount === 1) {
            const stableFieldItem = itemIdentity(entry.sourceIdentity, 'field', `field:${field.field}`)
            await insertStableProvenance(client, actor, entry, stableRevisionId, 'field_backfill', `field:${field.field}`,
              stableFieldItem, 'case', caseId, 'backfilled', caseId, { source: 'v1_historical_import' })
            totals.fieldsBackfilled += 1
          }
        }

        for (const note of entry.notes) {
          if (note.alreadyImported || note.duplicateContentCandidate || note.text.trim().length === 0) {
            if (note.alreadyImported && note.targetId !== null) {
              entryChanged = await insertItemMetadata(client, actor, entry, {
                caseId, stableItemIdentity: note.stableItemIdentity, itemType: 'note', nativeItemId: note.nativeId,
                targetType: 'case_note', targetId: note.targetId, sourceAuthor: note.sourceAuthor,
                sourceOccurredAt: note.sourceOccurredAt, snapshot: { id: note.nativeId, text: note.text, createdBy: note.sourceAuthor, createdAt: note.sourceOccurredAt },
              }) || entryChanged
            }
            continue
          }
          const noteId = uuidv7()
          await client.query(
            `INSERT INTO case_notes (id,organization_id,case_id,note_type,body,created_by_user_id,created_at)
             VALUES ($1,$2,$3,'internal',$4,$5,COALESCE($6::timestamptz,now()))`,
            [noteId, actor.organizationId, caseId, note.text.trim().slice(0, 5000), actor.actorUserId, note.sourceOccurredAt],
          )
          await insertStableProvenance(client, actor, entry, stableRevisionId, 'note', note.nativeId, note.stableItemIdentity,
            'case_note', noteId, 'created', caseId)
          entryChanged = await insertItemMetadata(client, actor, entry, {
            caseId, stableItemIdentity: note.stableItemIdentity, itemType: 'note', nativeItemId: note.nativeId,
            targetType: 'case_note', targetId: noteId, sourceAuthor: note.sourceAuthor, sourceOccurredAt: note.sourceOccurredAt,
            snapshot: { id: note.nativeId, text: note.text, createdBy: note.sourceAuthor, createdAt: note.sourceOccurredAt },
          }) || entryChanged
          totals.notesCreated += 1
        }

        for (const task of entry.tasks) {
          if (task.alreadyImported && task.targetId !== null) {
            entryChanged = await insertItemMetadata(client, actor, entry, {
              caseId, stableItemIdentity: task.stableItemIdentity, itemType: 'task', nativeItemId: task.nativeId,
              targetType: 'case_task', targetId: task.targetId, sourceAssignee: task.sourceAssignee,
              sourceOccurredAt: task.sourceCreatedAt, sourceCompletedAt: task.sourceCompletedAt,
              snapshot: { id: task.nativeId, title: task.title, completed: task.completed, createdAt: task.sourceCreatedAt, completedAt: task.sourceCompletedAt },
            }) || entryChanged
            if (task.needsEventBackfill) {
              const event = await client.query(
                `INSERT INTO case_task_events
                  (id,organization_id,case_id,task_id,event_type,task_version,actor_user_id,occurred_at,event_source,source_identity,source_evidence)
                 VALUES ($1,$2,$3,$4,'created',1,$5,COALESCE($6::timestamptz,now()),'v1_historical_import',$7,$8::jsonb)
                 ON CONFLICT DO NOTHING RETURNING id`,
                [uuidv7(), actor.organizationId, caseId, task.targetId, actor.actorUserId, task.sourceCreatedAt,
                  entry.sourceIdentity, JSON.stringify({ stableItemIdentity: task.stableItemIdentity, mappingVersion: V1_REMEDIATION_MAPPING_VERSION })],
              )
              totals.taskEventsCreated += event.rowCount ?? 0
            }
            continue
          }
          if (task.duplicateContentCandidate) continue
          if (task.dueDate === null || (task.completed && task.sourceCompletedAt === null) || task.title.trim().length === 0) continue
          const taskId = uuidv7()
          const version = task.completed ? 2 : 1
          await client.query(
            `INSERT INTO case_tasks
              (id,organization_id,case_id,title,priority,status,assigned_user_id,due_date,resolution_note,resolved_by_user_id,
               resolved_at,version,created_by_user_id,created_at,updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,COALESCE($14::timestamptz,now()),
                     COALESCE($15::timestamptz,COALESCE($14::timestamptz,now())))`,
            [taskId, actor.organizationId, caseId, task.title.trim().slice(0, 300), task.priority,
              task.completed ? 'completed' : 'open', task.assignee.targetId, task.dueDate,
              task.completed ? 'V1 tarihsel tamamlanma kaydı' : null, task.completed ? actor.actorUserId : null,
              task.completed ? task.sourceCompletedAt : null, version, actor.actorUserId, task.sourceCreatedAt, task.sourceCompletedAt],
          )
          await client.query(
            `INSERT INTO case_task_events
              (id,organization_id,case_id,task_id,event_type,task_version,actor_user_id,occurred_at,event_source,source_identity,source_evidence)
             VALUES ($1,$2,$3,$4,'created',1,$5,COALESCE($6::timestamptz,now()),'v1_historical_import',$7,$8::jsonb)`,
            [uuidv7(), actor.organizationId, caseId, taskId, actor.actorUserId, task.sourceCreatedAt,
              entry.sourceIdentity, JSON.stringify({ stableItemIdentity: task.stableItemIdentity, mappingVersion: V1_REMEDIATION_MAPPING_VERSION })],
          )
          totals.taskEventsCreated += 1
          if (task.completed) {
            await client.query(
              `INSERT INTO case_task_events
                (id,organization_id,case_id,task_id,event_type,task_version,actor_user_id,occurred_at,event_source,source_identity,source_evidence)
               VALUES ($1,$2,$3,$4,'completed',2,$5,$6,'v1_historical_import',$7,$8::jsonb)`,
              [uuidv7(), actor.organizationId, caseId, taskId, actor.actorUserId, task.sourceCompletedAt,
                entry.sourceIdentity, JSON.stringify({ stableItemIdentity: task.stableItemIdentity, mappingVersion: V1_REMEDIATION_MAPPING_VERSION })],
            )
            totals.taskEventsCreated += 1
            totals.completedTasksCreated += 1
          } else totals.tasksCreated += 1
          await insertStableProvenance(client, actor, entry, stableRevisionId, 'task', task.nativeId, task.stableItemIdentity,
            'case_task', taskId, 'created', caseId)
          entryChanged = await insertItemMetadata(client, actor, entry, {
            caseId, stableItemIdentity: task.stableItemIdentity, itemType: 'task', nativeItemId: task.nativeId,
            targetType: 'case_task', targetId: taskId, sourceAssignee: task.sourceAssignee,
            sourceOccurredAt: task.sourceCreatedAt, sourceCompletedAt: task.sourceCompletedAt,
            snapshot: { id: task.nativeId, title: task.title, completed: task.completed, createdAt: task.sourceCreatedAt, completedAt: task.sourceCompletedAt },
          }) || entryChanged
        }

        if (entry.needsFollowUpHistory) {
          const followUp = safeDate(entry.rawSnapshot.assignment?.takipTarihi ?? '') ?? safeDate(entry.rawSnapshot.assignment?.sonIslemTarihi ?? '')
          if (followUp !== null) {
            const current = await client.query<{ version: number }>('SELECT version FROM cases WHERE organization_id=$1 AND id=$2', [actor.organizationId, caseId])
            const historyId = uuidv7()
            const history = await client.query(
              `INSERT INTO case_follow_up_history
                (id,organization_id,case_id,previous_follow_up_date,new_follow_up_date,source,case_version,actor_user_id,source_identity,source_evidence)
               VALUES ($1,$2,$3,NULL,$4,'v1_historical_import',$5,$6,$7,$8::jsonb)
               ON CONFLICT DO NOTHING RETURNING id`,
              [historyId, actor.organizationId, caseId, followUp, current.rows[0]?.version ?? 1, actor.actorUserId,
                entry.sourceIdentity, JSON.stringify({ sourceHash: entry.sourceHash, mappingVersion: V1_REMEDIATION_MAPPING_VERSION })],
            )
            if (history.rowCount === 1) {
              const stableFollowUp = itemIdentity(entry.sourceIdentity, 'follow_up', 'follow-up-history')
              entryChanged = await insertItemMetadata(client, actor, entry, {
                caseId, stableItemIdentity: stableFollowUp, itemType: 'follow_up', nativeItemId: 'follow-up-history',
                targetType: 'case_follow_up_history', targetId: historyId,
                snapshot: { value: followUp, source: 'v1_historical_import' },
              }) || entryChanged
              totals.followUpHistoryCreated += 1
            }
          }
        }

        if (entry.needsVehicleProfile) {
          const vehicle = entry.rawSnapshot.vehicleContext
          const validation = vehicle === undefined ? null : validateCaseVehicleProfile({
            brand: vehicle.make, model: vehicle.model, modelYear: Number(vehicle.modelYear), variant: null,
            vehicleClass: 'other', chassisPrefix: null, engineCode: null, evidenceSource: 'other', evidenceReference: 'V1 historical import',
          })
          if (validation?.valid === true) {
            const profileId = uuidv7()
            const versionId = uuidv7()
            await client.query(
              'INSERT INTO case_vehicle_profiles (id,organization_id,case_id,created_by_user_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
              [profileId, actor.organizationId, caseId, actor.actorUserId],
            )
            const inserted = await client.query(
              `INSERT INTO case_vehicle_profile_versions
                (id,organization_id,case_id,profile_id,profile_version,schema_version,brand,model,model_year,vehicle_class,
                 evidence_source,evidence_reference,created_by_user_id)
               SELECT $1,$2,$3,$4,1,'case-vehicle-profile/1.0.0',$5,$6,$7,$8,$9,$10,$11
                WHERE EXISTS(SELECT 1 FROM case_vehicle_profiles WHERE id=$4 AND current_version_id IS NULL)
               ON CONFLICT DO NOTHING RETURNING id`,
              [versionId, actor.organizationId, caseId, profileId, validation.profile.brand, validation.profile.model,
                validation.profile.modelYear, validation.profile.vehicleClass, validation.profile.evidenceSource,
                validation.profile.evidenceReference, actor.actorUserId],
            )
            if (inserted.rowCount === 1) {
              await client.query('UPDATE case_vehicle_profiles SET current_version_id=$2 WHERE id=$1 AND current_version_id IS NULL', [profileId, versionId])
              const stableVehicle = itemIdentity(entry.sourceIdentity, 'vehicle_profile', 'vehicle-profile')
              await insertStableProvenance(client, actor, entry, stableRevisionId, 'vehicle_profile', 'vehicle-profile', stableVehicle,
                'case_vehicle_profile', profileId, 'created', caseId)
              entryChanged = await insertItemMetadata(client, actor, entry, {
                caseId, stableItemIdentity: stableVehicle, itemType: 'vehicle_profile', nativeItemId: 'vehicle-profile',
                targetType: 'case_vehicle_profile', targetId: profileId, snapshot: vehicle,
              }) || entryChanged
              totals.vehicleProfilesCreated += 1
            }
          }
        }

        if (entry.shouldCloseHistorically) {
          const current = await client.query<{ version: number; workflow_stage: string }>(
            "SELECT version,workflow_stage FROM cases WHERE organization_id=$1 AND id=$2 AND lifecycle_status='open' FOR UPDATE",
            [actor.organizationId, caseId],
          )
          if (current.rows[0] !== undefined) {
            await client.query(
              `UPDATE cases SET lifecycle_status='closed',workflow_stage='closed',closed_at=$3,closed_by_user_id=$4,
                 version=version+1,updated_at=now() WHERE organization_id=$1 AND id=$2 AND lifecycle_status='open'`,
              [actor.organizationId, caseId, entry.sourceClosureAt, actor.actorUserId],
            )
            const historyId = uuidv7()
            await client.query(
              `INSERT INTO case_lifecycle_history
                (id,organization_id,case_id,lifecycle_operation_id,operation_type,previous_lifecycle_status,lifecycle_status,
                 previous_workflow_stage,workflow_stage,source_storage_root_key,source_relative_path,storage_root_key,relative_path,
                 actor_user_id,request_id,history_source,source_identity,source_evidence,source_occurred_at)
               VALUES ($1,$2,$3,NULL,'historical_close','open','closed',$4,'closed','v1-legacy',$5,'v1-legacy',$5,
                       $6,$7,'v1_historical_import',$8,$9::jsonb,$10)`,
              [historyId, actor.organizationId, caseId, current.rows[0].workflow_stage, entry.folder.relativePath,
                actor.actorUserId, actor.requestId, entry.sourceIdentity,
                JSON.stringify({ sourceHash: entry.sourceHash, physicallyUnderKapali: entry.folder.physicallyUnderKapali,
                  kapaliMi: entry.rawSnapshot.status?.kapaliMi ?? null, isClosedFolder: entry.rawSnapshot.caseIdentity?.isClosedFolder ?? null,
                  mappingVersion: V1_REMEDIATION_MAPPING_VERSION }), entry.sourceClosureAt],
            )
            const stableClosure = itemIdentity(entry.sourceIdentity, 'closure', 'historical-close')
            entryChanged = await insertItemMetadata(client, actor, entry, {
              caseId, stableItemIdentity: stableClosure, itemType: 'closure', nativeItemId: 'historical-close',
              targetType: 'case_lifecycle_history', targetId: historyId, sourceOccurredAt: entry.sourceClosureAt,
              snapshot: { closed: true, sourceOccurredAt: entry.sourceClosureAt },
            }) || entryChanged
            totals.historicalClosures += 1
          }
        }

        const businessMutationCount = totals.casesCreated + totals.fieldsBackfilled + totals.notesCreated
          + totals.tasksCreated + totals.completedTasksCreated + totals.taskEventsCreated
          + totals.followUpHistoryCreated + totals.historicalClosures + totals.vehicleProfilesCreated
        if (entryChanged || businessMutationCount > businessMutationBaseline) await audit.record(client, {
          organizationId: actor.organizationId, actorUserId: actor.actorUserId, requestId: actor.requestId,
          action: 'v1_remediation.applied', entityType: 'case', entityId: caseId,
          details: { stableSourceIdentity: entry.sourceIdentity, mappingVersion: V1_REMEDIATION_MAPPING_VERSION,
            historical: true, sourceHash: entry.sourceHash,
            claimTypeResolution: entry.claimTypeResolution?.evidence.length === 0 ? undefined : entry.claimTypeResolution },
        })
      }
      await client.query('COMMIT')
    } catch {
      await client.query('ROLLBACK').catch(() => undefined)
      totals.failed += 1
    } finally {
      client.release()
    }
  }
  return totals
}
