import { createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { caseDetailResponseSchema, caseVehicleProfileFieldsSchema, eksistUploadSchema, quickCaseCreateSchema, idempotencyKeySchema, zodErrorToApiError } from '@hasarbotu/contracts'
import { parseEksist } from '@hasarbotu/domain'
import { uuidv7 } from '@hasarbotu/database'
import { requireAnyRole, requireSession } from '../auth/guard.js'
import { createAuthStore } from '../auth/store.js'
import { createCasesWriteStore, hashRequestBody, ReferenceCheckError } from '../cases/write-store.js'
import { createCasesStore } from '../cases/store.js'
import { createWorkspaceStore } from '../workspace/store.js'
import { createCaseVehicleProfileStore } from '../case-vehicle-profile/store.js'
import { createAuditService } from '../audit/service.js'
import { failureBody } from '../errors/failure.js'
import { extractEksist } from './extract.js'
import { withTransaction } from '../db/executor.js'
import { applyEksistSource, withEksistData } from './automatic.js'

const WRITE_ROLES = ['admin', 'expert', 'case_manager'] as const
const SCOPE = 'cases.quick-create'
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')
class ExistingSource extends Error { constructor(readonly caseId: string) { super('existing_source') } }

export function registerEksistRoutes(app: FastifyInstance, { pool }: { pool: pg.Pool }): void {
  const auth = createAuthStore(pool), cases = createCasesWriteStore(pool), workspace = createWorkspaceStore(pool), audit = createAuditService()
  app.post('/api/v1/eksist/sources', { bodyLimit: 14_100_000 }, async (request, reply) => {
    const session = await requireAnyRole(auth, request, reply, WRITE_ROLES)
    if (!session) return
    const parsed = eksistUploadSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ok: false, error: zodErrorToApiError(parsed.error, String(request.id)) })
    const input = parsed.data
    let text: string, method: string, mime = 'text/plain', bytes: Buffer | null = null
    if (input.kind === 'text') { text = input.text; method = 'clipboard' }
    else {
      if (input.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)) return reply.code(400).send(failureBody('validation_error', 'Invalid file encoding.', String(request.id)))
      bytes = Buffer.from(input.base64, 'base64')
      if (bytes.length > 10_000_000) return reply.code(413).send(failureBody('validation_error', 'File exceeds 10 MB.', String(request.id)))
      const pdf = bytes.subarray(0, 5).toString() === '%PDF-'
      const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      if (input.kind === 'pdf' ? !pdf : !(png || jpeg)) return reply.code(400).send(failureBody('validation_error', 'Only PDF, PNG and JPEG files are accepted.', String(request.id)))
      mime = pdf ? 'application/pdf' : png ? 'image/png' : 'image/jpeg'
      try { ({ text, method } = await extractEksist(input.kind, bytes)) }
      catch (error) { return reply.code(error instanceof Error && error.message === 'extraction_busy' ? 429 : 422).send(failureBody('validation_error', 'Text could not be read. Try clipboard text or a clearer document.', String(request.id))) }
    }
    const extraction = parseEksist(text), id = uuidv7()
    await withTransaction(pool, async client => {
      await client.query(`INSERT INTO eksist_sources (id,organization_id,input_kind,display_name,mime_type,source_bytes,source_hash,raw_text,extraction_method,extracted_fields,created_by_user_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`,
      [id, session.user.organizationId, input.kind, input.kind === 'text' ? 'Eksist kaynak metni' : input.name, mime, bytes, sha(bytes ?? text), text, method, JSON.stringify(extraction), session.user.id])
      await audit.record(client, { organizationId: session.user.organizationId, actorUserId: session.user.id, requestId: String(request.id), action: 'eksist.source_read', entityType: 'eksist_source', entityId: id, details: { kind: input.kind, method, sourceHash: sha(bytes ?? text) } })
    })
    return reply.code(201).send({ id, extraction, method, text })
  })

  app.post('/api/v1/cases/quick-create', async (request, reply) => {
    const session = await requireAnyRole(auth, request, reply, WRITE_ROLES)
    if (!session) return
    const parsed = quickCaseCreateSchema.safeParse(request.body), key = idempotencyKeySchema.safeParse(request.headers['idempotency-key'])
    if (!parsed.success || !key.success) return reply.code(400).send({ ok: false, error: zodErrorToApiError((!parsed.success ? parsed.error : !key.success ? key.error : null)!, String(request.id)) })
    const input = parsed.data, organizationId = session.user.organizationId
    const actor = { organizationId, actorUserId: session.user.id, requestId: String(request.id) }, requestHash = hashRequestBody(input)
    let caseId: string | undefined, duplicate = false
    const replay = await cases.findIdempotent(organizationId, SCOPE, key.data)
    if (replay) {
      if (replay.requestHash !== requestHash) return reply.code(409).send(failureBody('idempotency_conflict', 'Creation already submitted with different values.', String(request.id)))
      caseId = caseDetailResponseSchema.parse(replay.responseBody).case.id
    } else {
      try {
        const caseInput = { ...input.case }
        if (input.source) {
          delete caseInput.insurerId; delete caseInput.expertUserId; delete caseInput.serviceId; delete caseInput.notificationFormNumber
        }
        const item = await cases.createCase(actor, caseInput, { scope: SCOPE, key: key.data, requestHash, buildResponse: item => caseDetailResponseSchema.parse({ case: item }) }, async (client, createdId) => {
          let vehicle = input.vehicle
          if (input.source) {
            // Locks the source and reference independently: re-upload and concurrent requests cannot fork a case.
            await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`eksist:${organizationId}:${input.source.reference.toUpperCase()}`])
            const selected = await client.query('SELECT case_id,source_hash,raw_text,extraction_method FROM eksist_sources WHERE organization_id=$1 AND id::text=$2 FOR UPDATE', [organizationId, input.source.id])
            if (!selected.rowCount) throw new ReferenceCheckError('source.id')
            const sourceHash = (selected.rows[0] as { source_hash: string }).source_hash
            await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`eksist-hash:${organizationId}:${sourceHash}`])
            const previous = await client.query('SELECT case_id FROM eksist_sources WHERE organization_id=$1 AND (request_reference=$2 OR source_hash=$3) AND case_id IS NOT NULL', [organizationId, input.source.reference.toUpperCase(), sourceHash])
            const existing = (selected.rows[0] as { case_id: string | null }).case_id ?? (previous.rows[0] as { case_id: string } | undefined)?.case_id
            if (existing) throw new ExistingSource(existing)
            const automatic = await applyEksistSource(client, organizationId, createdId, input.source.id, String(selected.rows[0].raw_text), input.source.serviceRevision, { method: String(selected.rows[0].extraction_method), ...(input.source.expertReview ? { expertReview: input.source.expertReview } : {}) })
            const extracted = parseEksist(String(selected.rows[0].raw_text))
            const profile = caseVehicleProfileFieldsSchema.safeParse({ brand: extracted.brand, model: extracted.model, modelYear: Number(extracted.modelYear), vehicleClass: extracted.vehicleClass, evidenceSource: 'insurer_record', evidenceReference: `Eksist ${input.source.reference}` })
            vehicle = profile.success ? profile.data : undefined
            await client.query('UPDATE eksist_sources SET case_id=$3,request_reference=$4,reviewed_fields=$5::jsonb WHERE organization_id=$1 AND id::text=$2', [organizationId, input.source.id, createdId, input.source.reference.toUpperCase(), JSON.stringify({ automatic, vehicleDraft: input.source.vehicleDraft ?? null, ...(input.source.expertReview ? { expertReview: { ...input.source.expertReview, reviewedByUserId: session.user.id } } : {}) })])
            await audit.record(client, { ...actor, action: 'eksist.source_linked', entityType: 'case', entityId: createdId, details: { sourceId: input.source.id } })
          }
          if (vehicle) {
            await createCaseVehicleProfileStore(pool).save({ organizationId, userId: session.user.id }, createdId, { fields: vehicle, expectedVersion: null, reason: null }, client)
            await audit.record(client, { ...actor, action: 'case.vehicle_profile_created', entityType: 'case', entityId: createdId, details: { source: input.source ? 'eksist' : 'manual' } })
          }
          const plan = await workspace.createPlan(actor, createdId, { storageRootKey: input.storageRootKey }, { key: uuidv7(), requestHash }, client)
          if (plan.kind !== 'ok') throw new ReferenceCheckError(plan.kind === 'notification_date_required' ? 'case.notificationDate' : 'storageRootKey', plan.kind)
          const approved = await workspace.approvePlan(actor, createdId, plan.provisioning.id, { key: uuidv7(), requestHash }, client)
          if (approved.kind !== 'ok') throw new Error('workspace_queue_failed')
        })
        if (item) caseId = item.id
        else {
          const raced = await cases.findIdempotent(organizationId, SCOPE, key.data)
          if (raced?.requestHash === requestHash) caseId = caseDetailResponseSchema.parse(raced.responseBody).case.id
          else return reply.code(409).send(failureBody('idempotency_conflict', 'Creation already submitted.', String(request.id)))
        }
      } catch (error) {
        if (error instanceof ExistingSource) { caseId = error.caseId; duplicate = true }
        else if (error instanceof ReferenceCheckError) return reply.code(400).send({ ok: false, error: { code: 'validation_error', message: 'Check the indicated field.', requestId: String(request.id), fieldErrors: [{ path: error.field, code: error.code, message: 'Invalid value.' }] } })
        else throw error
      }
    }
    const detail = await createCasesStore(pool).findById(organizationId, caseId!)
    let provisioning = await workspace.findCurrentPlan(organizationId, caseId!)
    if (provisioning?.status === 'failed') {
      const retried = await workspace.approvePlan(actor, caseId!, provisioning.id, { key: uuidv7(), requestHash })
      if (retried.kind === 'ok') provisioning = retried.provisioning
    }
    const enriched = detail ? (await withEksistData(pool, organizationId, [detail]))[0] : detail
    return reply.code(provisioning?.status === 'ready' ? 200 : 202).send({ case: enriched, provisioning: provisioning ?? null, duplicate })
  })

  app.get<{ Params: { caseId: string } }>('/api/v1/cases/:caseId/eksist-sources', async (request, reply) => {
    const session = await requireSession(auth, request, reply)
    if (!session) return
    const result = await pool.query('SELECT id,request_reference,display_name,input_kind,raw_text,extraction_method,extracted_fields,reviewed_fields FROM eksist_sources WHERE organization_id=$1 AND case_id::text=$2 ORDER BY created_at', [session.user.organizationId, request.params.caseId])
    return { items: result.rows }
  })
  app.get<{ Params: { caseId: string; sourceId: string } }>('/api/v1/cases/:caseId/eksist-sources/:sourceId/content', async (request, reply) => {
    const session = await requireSession(auth, request, reply)
    if (!session) return
    const result = await pool.query('SELECT source_bytes,raw_text,mime_type FROM eksist_sources WHERE organization_id=$1 AND case_id::text=$2 AND id::text=$3', [session.user.organizationId, request.params.caseId, request.params.sourceId])
    const row = result.rows[0] as { source_bytes: Buffer | null; raw_text: string; mime_type: string } | undefined
    if (!row) return reply.code(404).send(failureBody('not_found', 'Source not found.', String(request.id)))
    return reply.header('content-disposition', 'attachment').header('x-content-type-options', 'nosniff').type(row.mime_type).send(row.source_bytes ?? row.raw_text)
  })
}
