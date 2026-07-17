import { createHash } from 'node:crypto'
import type pg from 'pg'
import {
  emailDraftHandoffResponseSchema,
  emailDraftPreviewResponseSchema,
  emailDraftResponseSchema,
  emailDraftSchema,
  emailDraftWorkspaceResponseSchema,
  type EmailDraft,
  type EmailDraftAttachment,
  type EmailDraftAttachmentOption,
  type EmailDraftAttachmentReference,
  type EmailDraftCreateRequest,
  type EmailDraftHandoff,
  type EmailDraftHandoffResponse,
  type EmailDraftPreviewRequest,
  type EmailDraftPreviewResponse,
  type EmailDraftReviseRequest,
  type EmailDraftWorkspaceResponse,
} from '@hasarbotu/contracts'
import {
  EMAIL_DRAFT_TEMPLATE_VERSION,
  buildEmailDraftTemplate,
  validateEmailRecipients,
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
import { evaluateCaseDocumentRequirements } from '../document-requirements/evaluation.js'

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
  readonly id: string
  readonly case_type: 'traffic' | 'casco'
  readonly lifecycle_status: 'open' | 'closed'
  readonly office_number: string
  readonly plate: string
  readonly version: number
}

interface DraftRow {
  readonly id: string
  readonly case_id: string
  readonly draft_type: EmailDraft['draftType']
  readonly current_version_id: string
  readonly version: number
  readonly created_by_user_id: string
  readonly created_by_display_name: string
  readonly created_at: Date
  readonly updated_at: Date
}

interface VersionRow {
  readonly id: string
  readonly draft_id: string
  readonly draft_version: number
  readonly previous_version_id: string | null
  readonly subject: string
  readonly body: string
  readonly template_version: string
  readonly source_type: 'deterministic_template' | 'ai_assisted' | 'manual_revision'
  readonly email_ai_suggestion_run_id: string | null
  readonly preview_hash: string
  readonly revision_reason: string | null
  readonly created_by_user_id: string
  readonly created_by_display_name: string
  readonly created_at: Date
}

interface RecipientRow {
  readonly draft_version_id: string
  readonly recipient_kind: 'to' | 'cc'
  readonly address: string
  readonly ordinal: number
}

interface AttachmentRow {
  readonly draft_version_id: string
  readonly resource_type: 'document_version' | 'photo'
  readonly resource_id: string
  readonly document_type: string | null
  readonly display_name: string
  readonly mime_type: string
  readonly byte_size: string
  readonly ordinal: number
}

interface HandoffRow {
  readonly id: string
  readonly draft_id: string
  readonly draft_version_id: string
  readonly provider: 'gmail_web'
  readonly prepared_by_user_id: string
  readonly prepared_by_display_name: string
  readonly prepared_at: Date
}

interface AvailableAttachmentRow {
  readonly resource_type: 'document_version' | 'photo'
  readonly resource_id: string
  readonly document_type: string | null
  readonly display_name: string
  readonly mime_type: string
  readonly byte_size: string
}

export type EmailDraftCommandOutcome<T> =
  | { readonly kind: 'ok'; readonly response: T }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'case_closed' }
  | { readonly kind: 'version_conflict' }
  | { readonly kind: 'preview_stale' }
  | { readonly kind: 'invalid_recipients'; readonly code: string }
  | { readonly kind: 'invalid_attachment'; readonly field: string }
  | { readonly kind: 'invalid_ai_suggestion' }
  | { readonly kind: 'idempotency_race' }

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

async function readCaseContext(
  exec: Queryable,
  organizationId: string,
  caseId: string,
  forUpdate = false,
): Promise<CaseContextRow | undefined> {
  const result = await exec.query(
    `SELECT id,case_type,lifecycle_status,office_number,plate,version
     FROM cases WHERE organization_id=$1 AND id::text=$2${forUpdate ? ' FOR UPDATE' : ''}`,
    [organizationId, caseId],
  )
  return result.rows[0] as CaseContextRow | undefined
}

async function listAvailableAttachments(
  exec: Queryable,
  organizationId: string,
  caseId: string,
): Promise<readonly AvailableAttachmentRow[]> {
  const result = await exec.query(
    `SELECT 'document_version'::text AS resource_type,dv.id AS resource_id,
            d.document_type,dv.display_name,dv.mime_type,dv.byte_size
       FROM documents d
       JOIN document_versions dv ON dv.id=d.current_version_id
      WHERE d.organization_id=$1 AND d.case_id::text=$2
        AND dv.status='ready' AND dv.hash_verified=true AND dv.size_verified=true
        AND dv.verified_at IS NOT NULL
     UNION ALL
     SELECT 'photo'::text AS resource_type,p.id AS resource_id,NULL::text AS document_type,
            p.display_name,p.mime_type,p.byte_size
       FROM photos p
      WHERE p.organization_id=$1 AND p.case_id::text=$2
        AND p.status='ready' AND p.hash_verified=true AND p.size_verified=true
        AND p.verified_at IS NOT NULL
     ORDER BY resource_type,document_type NULLS LAST,display_name,resource_id`,
    [organizationId, caseId],
  )
  return result.rows as AvailableAttachmentRow[]
}

function attachmentOption(
  row: AvailableAttachmentRow,
  suggestedDocumentTypes: readonly string[],
): EmailDraftAttachmentOption {
  return {
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    documentType: row.document_type,
    displayName: row.display_name,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size),
    preferred: row.document_type !== null && suggestedDocumentTypes.includes(row.document_type),
    status: 'ready',
  }
}

export async function buildEmailDraftPreview(
  exec: Queryable,
  organizationId: string,
  caseId: string,
  input: EmailDraftPreviewRequest,
  evaluatedAt: string,
  caseContext?: CaseContextRow,
): Promise<EmailDraftPreviewResponse | undefined> {
  const context = caseContext ?? await readCaseContext(exec, organizationId, caseId)
  if (context === undefined) return undefined
  const requirements = await evaluateCaseDocumentRequirements(exec, organizationId, caseId, evaluatedAt)
  if (requirements === undefined) return undefined
  const missingRequirementCodes = requirements.requirements
    .filter((item) => item.status === 'missing')
    .map((item) => item.requirementCode)
    .sort((left, right) => left.localeCompare(right, 'tr'))
  const controlRequiredRequirementCodes = requirements.requirements
    .filter((item) => item.status === 'control_required')
    .map((item) => item.requirementCode)
    .sort((left, right) => left.localeCompare(right, 'tr'))
  const template = buildEmailDraftTemplate({
    draftType: input.draftType,
    officeNumber: context.office_number,
    plate: context.plate,
    caseType: context.case_type,
    missingRequirementCodes: [...missingRequirementCodes, ...controlRequiredRequirementCodes],
    instruction: input.instruction,
  })
  const available = await listAvailableAttachments(exec, organizationId, caseId)
  const attachmentOptions = available
    .map((row) => attachmentOption(row, template.suggestedDocumentTypes))
    .sort((left, right) => Number(right.preferred) - Number(left.preferred)
      || left.displayName.localeCompare(right.displayName, 'tr')
      || left.resourceId.localeCompare(right.resourceId))
  const previewFacts = {
    caseId,
    caseVersion: context.version,
    caseType: context.case_type,
    lifecycleStatus: context.lifecycle_status,
    draftType: input.draftType,
    instruction: input.instruction,
    templateVersion: template.templateVersion,
    subject: template.subject,
    body: template.body,
    sourceRule: template.sourceRule,
    missingRequirementCodes,
    controlRequiredRequirementCodes,
    attachmentOptions: attachmentOptions.map((item) => ({
      resourceType: item.resourceType,
      resourceId: item.resourceId,
      documentType: item.documentType,
      preferred: item.preferred,
    })),
  }
  return emailDraftPreviewResponseSchema.parse({
    caseId,
    caseVersion: context.version,
    draftType: input.draftType,
    templateVersion: template.templateVersion,
    subject: template.subject,
    body: template.body,
    sourceRule: template.sourceRule,
    recipientStatus: 'control_required',
    recipientReason: 'Alıcı adresleri otomatik tahmin edilmez; kullanıcı tarafından doğrulanmalıdır.',
    missingRequirementCodes,
    controlRequiredRequirementCodes,
    attachmentOptions,
    previewHash: stableHash(previewFacts),
    requiresHumanReview: true,
  })
}

function attachmentDto(row: AttachmentRow): EmailDraftAttachment {
  return {
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    documentType: row.document_type,
    displayName: row.display_name,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size),
    status: 'ready',
  }
}

async function loadDrafts(
  exec: Queryable,
  organizationId: string,
  caseId: string,
  draftId?: string,
): Promise<readonly EmailDraft[]> {
  const filter = draftId === undefined ? '' : ' AND d.id::text=$3'
  const values = draftId === undefined ? [organizationId, caseId] : [organizationId, caseId, draftId]
  const draftsResult = await exec.query(
    `SELECT d.id,d.case_id,d.draft_type,d.current_version_id,d.version,d.created_by_user_id,
            creator.display_name AS created_by_display_name,d.created_at,d.updated_at
       FROM email_drafts d
       JOIN users creator ON creator.organization_id=d.organization_id AND creator.id=d.created_by_user_id
      WHERE d.organization_id=$1 AND d.case_id::text=$2${filter}
      ORDER BY d.updated_at DESC,d.id DESC`,
    values,
  )
  const draftRows = draftsResult.rows as DraftRow[]
  if (draftRows.length === 0) return []
  const ids = draftRows.map((row) => row.id)
  const versionsResult = await exec.query(
      `SELECT v.id,v.draft_id,v.draft_version,v.previous_version_id,v.subject,v.body,
              v.template_version,v.source_type,v.email_ai_suggestion_run_id,
              v.preview_hash,v.revision_reason,
              v.created_by_user_id,creator.display_name AS created_by_display_name,v.created_at
         FROM email_draft_versions v
         JOIN users creator ON creator.organization_id=v.organization_id AND creator.id=v.created_by_user_id
        WHERE v.organization_id=$1 AND v.case_id::text=$2 AND v.draft_id=ANY($3::uuid[])
        ORDER BY v.draft_id,v.draft_version DESC`,
      [organizationId, caseId, ids],
    )
  const recipientsResult = await exec.query(
      `SELECT draft_version_id,recipient_kind,address,ordinal
         FROM email_draft_recipients
        WHERE organization_id=$1 AND case_id::text=$2 AND draft_id=ANY($3::uuid[])
        ORDER BY draft_version_id,recipient_kind,ordinal`,
      [organizationId, caseId, ids],
    )
  const attachmentsResult = await exec.query(
      `SELECT a.draft_version_id,a.resource_type,
              CASE WHEN a.resource_type='document_version' THEN dv.id ELSE p.id END AS resource_id,
              d.document_type,
              CASE WHEN a.resource_type='document_version' THEN dv.display_name ELSE p.display_name END AS display_name,
              CASE WHEN a.resource_type='document_version' THEN dv.mime_type ELSE p.mime_type END AS mime_type,
              CASE WHEN a.resource_type='document_version' THEN dv.byte_size ELSE p.byte_size END AS byte_size,
              a.ordinal
         FROM email_draft_attachments a
         LEFT JOIN document_versions dv ON dv.id=a.document_version_id
         LEFT JOIN documents d ON d.id=dv.document_id
         LEFT JOIN photos p ON p.id=a.photo_id
        WHERE a.organization_id=$1 AND a.case_id::text=$2 AND a.draft_id=ANY($3::uuid[])
        ORDER BY a.draft_version_id,a.ordinal`,
      [organizationId, caseId, ids],
    )
  const handoffsResult = await exec.query(
      `SELECT h.id,h.draft_id,h.draft_version_id,h.provider,h.prepared_by_user_id,
              actor.display_name AS prepared_by_display_name,h.prepared_at
         FROM email_handoffs h
         JOIN users actor ON actor.organization_id=h.organization_id AND actor.id=h.prepared_by_user_id
        WHERE h.organization_id=$1 AND h.case_id::text=$2 AND h.draft_id=ANY($3::uuid[])
        ORDER BY h.draft_id,h.prepared_at DESC,h.id DESC`,
      [organizationId, caseId, ids],
    )
  const versions = versionsResult.rows as VersionRow[]
  const recipients = recipientsResult.rows as RecipientRow[]
  const attachments = attachmentsResult.rows as AttachmentRow[]
  const handoffs = handoffsResult.rows as HandoffRow[]
  return draftRows.map((draft) => {
    const draftVersions = versions.filter((row) => row.draft_id === draft.id).map((row) => {
      const versionRecipients = recipients.filter((recipient) => recipient.draft_version_id === row.id)
      return {
        id: row.id,
        draftVersion: row.draft_version,
        previousVersionId: row.previous_version_id,
        to: versionRecipients.filter((recipient) => recipient.recipient_kind === 'to').map((recipient) => recipient.address),
        cc: versionRecipients.filter((recipient) => recipient.recipient_kind === 'cc').map((recipient) => recipient.address),
        subject: row.subject,
        body: row.body,
        attachments: attachments.filter((attachment) => attachment.draft_version_id === row.id).map(attachmentDto),
        templateVersion: row.template_version,
        sourceType: row.source_type,
        emailAiSuggestionRunId: row.email_ai_suggestion_run_id,
        previewHash: row.preview_hash,
        revisionReason: row.revision_reason,
        createdByUserId: row.created_by_user_id,
        createdByDisplayName: row.created_by_display_name,
        createdAt: row.created_at.toISOString(),
      }
    })
    const currentVersion = draftVersions.find((version) => version.id === draft.current_version_id)
    if (currentVersion === undefined) throw new Error('email_draft_current_version_missing')
    return emailDraftSchema.parse({
      id: draft.id,
      caseId: draft.case_id,
      draftType: draft.draft_type,
      version: draft.version,
      currentVersion,
      versions: draftVersions,
      handoffs: handoffs.filter((handoff) => handoff.draft_id === draft.id).map((handoff) => ({
        id: handoff.id,
        draftVersionId: handoff.draft_version_id,
        provider: handoff.provider,
        preparedByUserId: handoff.prepared_by_user_id,
        preparedByDisplayName: handoff.prepared_by_display_name,
        preparedAt: handoff.prepared_at.toISOString(),
      })),
      createdByUserId: draft.created_by_user_id,
      createdByDisplayName: draft.created_by_display_name,
      createdAt: draft.created_at.toISOString(),
      updatedAt: draft.updated_at.toISOString(),
    })
  })
}

function validateSelectedAttachments(
  selected: readonly EmailDraftAttachmentReference[],
  available: readonly EmailDraftAttachmentOption[],
): EmailDraftAttachmentReference[] | undefined {
  const keys = selected.map((item) => `${item.resourceType}:${item.resourceId}`)
  if (new Set(keys).size !== keys.length) return undefined
  const allowed = new Set(available.map((item) => `${item.resourceType}:${item.resourceId}`))
  if (keys.some((key) => !allowed.has(key))) return undefined
  return [...selected]
}

async function validEmailAiSuggestion(
  exec: Queryable,
  organizationId: string,
  caseId: string,
  runId: string,
  draftType: EmailDraft['draftType'],
  previewHash: string,
): Promise<boolean> {
  const result = await exec.query(
    `SELECT 1
       FROM email_ai_suggestion_runs
      WHERE organization_id=$1 AND case_id=$2 AND id=$3
        AND status='review_required' AND draft_type=$4 AND base_preview_hash=$5`,
    [organizationId, caseId, runId, draftType, previewHash],
  )
  return result.rowCount === 1
}

async function insertRecipients(
  client: pg.PoolClient,
  actor: ActorContext,
  caseId: string,
  draftId: string,
  versionId: string,
  to: readonly string[],
  cc: readonly string[],
): Promise<void> {
  for (const [kind, values] of [['to', to], ['cc', cc]] as const) {
    for (let index = 0; index < values.length; index += 1) {
      await client.query(
        `INSERT INTO email_draft_recipients
           (id,organization_id,case_id,draft_id,draft_version_id,recipient_kind,address,ordinal)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [uuidv7(), actor.organizationId, caseId, draftId, versionId, kind, values[index], index + 1],
      )
    }
  }
}

async function insertAttachments(
  client: pg.PoolClient,
  actor: ActorContext,
  caseId: string,
  draftId: string,
  versionId: string,
  attachments: readonly EmailDraftAttachmentReference[],
): Promise<void> {
  for (let index = 0; index < attachments.length; index += 1) {
    const attachment = attachments[index] as EmailDraftAttachmentReference
    await client.query(
      `INSERT INTO email_draft_attachments
         (id,organization_id,case_id,draft_id,draft_version_id,resource_type,
          document_version_id,photo_id,ordinal)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        uuidv7(),
        actor.organizationId,
        caseId,
        draftId,
        versionId,
        attachment.resourceType,
        attachment.resourceType === 'document_version' ? attachment.resourceId : null,
        attachment.resourceType === 'photo' ? attachment.resourceId : null,
        index + 1,
      ],
    )
  }
}

async function currentDraft(
  client: pg.PoolClient,
  organizationId: string,
  caseId: string,
  draftId: string,
): Promise<{ id: string; version: number; current_version_id: string; draft_type: EmailDraft['draftType'] } | undefined> {
  const result = await client.query(
    `SELECT id,version,current_version_id,draft_type
       FROM email_drafts
      WHERE organization_id=$1 AND case_id::text=$2 AND id::text=$3 FOR UPDATE`,
    [organizationId, caseId, draftId],
  )
  return result.rows[0] as { id: string; version: number; current_version_id: string; draft_type: EmailDraft['draftType'] } | undefined
}

export function createEmailDraftStore(pool: pg.Pool) {
  const audit = createAuditService()

  return {
    findIdempotent(organizationId: string, scope: string, key: string): Promise<IdempotentRecord | undefined> {
      return findIdempotent(pool, organizationId, scope, key)
    },

    preview(
      organizationId: string,
      caseId: string,
      input: EmailDraftPreviewRequest,
      evaluatedAt: string,
    ): Promise<EmailDraftPreviewResponse | undefined> {
      return buildEmailDraftPreview(pool, organizationId, caseId, input, evaluatedAt)
    },

    async readWorkspace(
      organizationId: string,
      caseId: string,
      canWrite: boolean,
    ): Promise<EmailDraftWorkspaceResponse | undefined> {
      const context = await readCaseContext(pool, organizationId, caseId)
      if (context === undefined) return undefined
      const allowed = canWrite && context.lifecycle_status === 'open'
      return emailDraftWorkspaceResponseSchema.parse({
        caseId,
        lifecycleStatus: context.lifecycle_status,
        drafts: await loadDrafts(pool, organizationId, caseId),
        permissions: {
          canWrite: allowed,
          canPrepareHandoff: allowed,
        },
      })
    },

    async createDraft(
      actor: ActorContext,
      caseId: string,
      input: EmailDraftCreateRequest,
      idempotency: IdempotencyContext,
      evaluatedAt: string,
    ): Promise<EmailDraftCommandOutcome<ReturnType<typeof emailDraftResponseSchema.parse>>> {
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
        const preview = await buildEmailDraftPreview(client, actor.organizationId, caseId, {
          draftType: input.draftType,
          instruction: input.instruction,
        }, evaluatedAt, context)
        if (preview === undefined) {
          await client.query('ROLLBACK')
          return { kind: 'not_found' }
        }
        if (preview.previewHash !== input.previewHash) {
          await client.query('ROLLBACK')
          return { kind: 'preview_stale' }
        }
        const recipients = validateEmailRecipients(input.to, input.cc)
        if (!recipients.valid) {
          await client.query('ROLLBACK')
          return { kind: 'invalid_recipients', code: recipients.reasonCode }
        }
        const attachments = validateSelectedAttachments(input.attachments, preview.attachmentOptions)
        if (attachments === undefined) {
          await client.query('ROLLBACK')
          return { kind: 'invalid_attachment', field: 'attachments' }
        }
        const aiRunId = input.emailAiSuggestionRunId
        const aiAssisted = aiRunId !== null
        if (
          aiAssisted
          && !await validEmailAiSuggestion(
            client,
            actor.organizationId,
            caseId,
            aiRunId,
            input.draftType,
            input.previewHash,
          )
        ) {
          await client.query('ROLLBACK')
          return { kind: 'invalid_ai_suggestion' }
        }

        const draftId = uuidv7()
        const versionId = uuidv7()
        await client.query(
          `INSERT INTO email_drafts
             (id,organization_id,case_id,draft_type,created_by_user_id)
           VALUES ($1,$2,$3,$4,$5)`,
          [draftId, actor.organizationId, caseId, input.draftType, actor.actorUserId],
        )
        await client.query(
          `INSERT INTO email_draft_versions
             (id,organization_id,case_id,draft_id,draft_version,subject,body,
              template_version,source_type,email_ai_suggestion_run_id,preview_hash,
              created_by_user_id)
           VALUES ($1,$2,$3,$4,1,$5,$6,$7,$8,$9,$10,$11)`,
          [
            versionId,
            actor.organizationId,
            caseId,
            draftId,
            input.subject,
            input.body,
            EMAIL_DRAFT_TEMPLATE_VERSION,
            aiAssisted ? 'ai_assisted' : 'deterministic_template',
            aiRunId,
            input.previewHash,
            actor.actorUserId,
          ],
        )
        await insertRecipients(
          client,
          actor,
          caseId,
          draftId,
          versionId,
          recipients.normalizedTo,
          recipients.normalizedCc,
        )
        await insertAttachments(client, actor, caseId, draftId, versionId, attachments)
        await client.query(
          'UPDATE email_drafts SET current_version_id=$1,updated_at=now() WHERE id=$2',
          [versionId, draftId],
        )
        const created = (await loadDrafts(client, actor.organizationId, caseId, draftId))[0]
        if (created === undefined) throw new Error('email_draft_create_readback_failed')
        const response = emailDraftResponseSchema.parse({ draft: created })
        await audit.record(client, {
          organizationId: actor.organizationId,
          actorUserId: actor.actorUserId,
          requestId: actor.requestId,
          action: 'email_draft.created',
          entityType: 'email_draft',
          entityId: draftId,
          details: {
            caseId,
            draftType: input.draftType,
            draftVersion: 1,
            recipientCount: recipients.normalizedTo.length + recipients.normalizedCc.length,
            attachmentCount: attachments.length,
            templateVersion: EMAIL_DRAFT_TEMPLATE_VERSION,
            sourceType: aiAssisted ? 'ai_assisted' : 'deterministic_template',
            emailAiSuggestionRunId: aiRunId,
          },
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

    async reviseDraft(
      actor: ActorContext,
      caseId: string,
      draftId: string,
      input: EmailDraftReviseRequest,
      idempotency: IdempotencyContext,
    ): Promise<EmailDraftCommandOutcome<ReturnType<typeof emailDraftResponseSchema.parse>>> {
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
        const draft = await currentDraft(client, actor.organizationId, caseId, draftId)
        if (draft === undefined) {
          await client.query('ROLLBACK')
          return { kind: 'not_found' }
        }
        if (draft.version !== input.expectedVersion) {
          await client.query('ROLLBACK')
          return { kind: 'version_conflict' }
        }
        const recipients = validateEmailRecipients(input.to, input.cc)
        if (!recipients.valid) {
          await client.query('ROLLBACK')
          return { kind: 'invalid_recipients', code: recipients.reasonCode }
        }
        const available = (await listAvailableAttachments(client, actor.organizationId, caseId))
          .map((row) => attachmentOption(row, []))
        const attachments = validateSelectedAttachments(input.attachments, available)
        if (attachments === undefined) {
          await client.query('ROLLBACK')
          return { kind: 'invalid_attachment', field: 'attachments' }
        }
        const nextVersion = draft.version + 1
        const versionId = uuidv7()
        const currentVersionRow = await client.query(
          'SELECT preview_hash FROM email_draft_versions WHERE id=$1',
          [draft.current_version_id],
        )
        const previewHash = (currentVersionRow.rows[0] as { preview_hash: string }).preview_hash
        await client.query(
          `INSERT INTO email_draft_versions
             (id,organization_id,case_id,draft_id,draft_version,previous_version_id,
              subject,body,template_version,source_type,preview_hash,revision_reason,created_by_user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual_revision',$10,$11,$12)`,
          [
            versionId,
            actor.organizationId,
            caseId,
            draftId,
            nextVersion,
            draft.current_version_id,
            input.subject,
            input.body,
            EMAIL_DRAFT_TEMPLATE_VERSION,
            previewHash,
            input.reason,
            actor.actorUserId,
          ],
        )
        await insertRecipients(
          client,
          actor,
          caseId,
          draftId,
          versionId,
          recipients.normalizedTo,
          recipients.normalizedCc,
        )
        await insertAttachments(client, actor, caseId, draftId, versionId, attachments)
        await client.query(
          `UPDATE email_drafts
             SET current_version_id=$1,version=$2,updated_at=now()
           WHERE id=$3`,
          [versionId, nextVersion, draftId],
        )
        const revised = (await loadDrafts(client, actor.organizationId, caseId, draftId))[0]
        if (revised === undefined) throw new Error('email_draft_revision_readback_failed')
        const response = emailDraftResponseSchema.parse({ draft: revised })
        await audit.record(client, {
          organizationId: actor.organizationId,
          actorUserId: actor.actorUserId,
          requestId: actor.requestId,
          action: 'email_draft.revised',
          entityType: 'email_draft',
          entityId: draftId,
          details: {
            caseId,
            fromVersion: draft.version,
            toVersion: nextVersion,
            recipientCount: recipients.normalizedTo.length + recipients.normalizedCc.length,
            attachmentCount: attachments.length,
            hasReason: true,
          },
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

    async prepareHandoff(
      actor: ActorContext,
      caseId: string,
      draftId: string,
      expectedVersion: number,
      idempotency: IdempotencyContext,
    ): Promise<EmailDraftCommandOutcome<EmailDraftHandoffResponse>> {
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
        const draft = await currentDraft(client, actor.organizationId, caseId, draftId)
        if (draft === undefined) {
          await client.query('ROLLBACK')
          return { kind: 'not_found' }
        }
        if (draft.version !== expectedVersion) {
          await client.query('ROLLBACK')
          return { kind: 'version_conflict' }
        }
        const sequenceResult = await client.query(
          'SELECT count(*)::int + 1 AS sequence FROM email_handoffs WHERE draft_id=$1',
          [draftId],
        )
        const handoffId = uuidv7()
        await client.query(
          `INSERT INTO email_handoffs
             (id,organization_id,case_id,draft_id,draft_version_id,handoff_sequence,
              provider,prepared_by_user_id,request_id)
           VALUES ($1,$2,$3,$4,$5,$6,'gmail_web',$7,$8)`,
          [
            handoffId,
            actor.organizationId,
            caseId,
            draftId,
            draft.current_version_id,
            (sequenceResult.rows[0] as { sequence: number }).sequence,
            actor.actorUserId,
            actor.requestId,
          ],
        )
        const loaded = (await loadDrafts(client, actor.organizationId, caseId, draftId))[0]
        if (loaded === undefined) throw new Error('email_handoff_readback_failed')
        const handoff = loaded.handoffs.find((item) => item.id === handoffId) as EmailDraftHandoff | undefined
        if (handoff === undefined) throw new Error('email_handoff_missing')
        const response = emailDraftHandoffResponseSchema.parse({
          draft: loaded,
          handoff,
          compose: {
            to: loaded.currentVersion.to,
            cc: loaded.currentVersion.cc,
            subject: loaded.currentVersion.subject,
            body: loaded.currentVersion.body,
            attachments: loaded.currentVersion.attachments,
          },
          deliveryStatus: 'not_sent',
        })
        await audit.record(client, {
          organizationId: actor.organizationId,
          actorUserId: actor.actorUserId,
          requestId: actor.requestId,
          action: 'email_draft.handoff_prepared',
          entityType: 'email_draft',
          entityId: draftId,
          details: {
            caseId,
            draftVersion: draft.version,
            provider: 'gmail_web',
            attachmentCount: loaded.currentVersion.attachments.length,
            deliveryStatus: 'not_sent',
          },
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

export type EmailDraftStore = ReturnType<typeof createEmailDraftStore>
