import { createHash } from 'node:crypto'
import type pg from 'pg'
import {
  buildTrafficValueLossReportContent,
  canonicalizeTrafficValueLossReportContent,
  type TrafficValueLossReportSource,
} from '@hasarbotu/domain'
import {
  trafficValueLossReportContentSchema,
  trafficValueLossReportPreviewResponseSchema,
  trafficValueLossReportSchema,
  type TrafficValueLossReportDto,
  type TrafficValueLossReportGenerateRequest,
  type TrafficValueLossReportPreviewRequest,
  type TrafficValueLossReportPreviewResponse,
} from '@hasarbotu/contracts'
import { uuidv7 } from '@hasarbotu/database'
import { createAuditService } from '../audit/service.js'
import { findIdempotent, insertIdempotent } from '../db/idempotency.js'
import { withTransaction, type Queryable } from '../db/executor.js'
import type { Clock } from '../clock.js'
import { systemClock } from '../clock.js'
import { hashTrafficValueLossReportPdf, renderTrafficValueLossReportPdf } from './report-pdf.js'
import { loadTrafficValueLossVersion } from './store.js'

interface Actor { readonly organizationId: string; readonly actorUserId: string; readonly requestId: string }
interface Idempotency { readonly scope: string; readonly key: string; readonly requestHash: string }
interface Result<T> { readonly replay: boolean; readonly status: number; readonly body: T | unknown }

export interface TrafficValueLossReportPdf {
  readonly report: TrafficValueLossReportDto
  readonly bytes: Buffer
}

export interface TrafficValueLossReportStore {
  preview(
    organizationId: string,
    caseId: string,
    versionId: string,
    input: TrafficValueLossReportPreviewRequest,
  ): Promise<TrafficValueLossReportPreviewResponse>
  generate(
    actor: Actor,
    caseId: string,
    versionId: string,
    input: TrafficValueLossReportGenerateRequest,
    idem: Idempotency,
  ): Promise<Result<{ readonly report: TrafficValueLossReportDto }>>
  list(organizationId: string, caseId: string): Promise<readonly TrafficValueLossReportDto[] | undefined>
  find(organizationId: string, caseId: string, reportId: string): Promise<TrafficValueLossReportDto | undefined>
  pdf(organizationId: string, caseId: string, reportId: string): Promise<TrafficValueLossReportPdf | undefined>
}

export type TrafficValueLossReportStoreErrorCode =
  | 'not_found'
  | 'version_conflict'
  | 'not_approved'
  | 'invalid_content'
  | 'preview_mismatch'
  | 'report_exists'
  | 'render_mismatch'
  | 'idempotency_conflict'

export class TrafficValueLossReportStoreError extends Error {
  constructor(readonly code: TrafficValueLossReportStoreErrorCode) { super(code) }
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value
}

function localDate(value: Date | string | null): string | null {
  if (value === null) return null
  if (typeof value === 'string') return value.slice(0, 10)
  return `${String(value.getFullYear()).padStart(4, '0')}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function mapReport(row: Record<string, unknown>): TrafficValueLossReportDto {
  return trafficValueLossReportSchema.parse({
    id: row.id,
    caseId: row.case_id,
    assessmentId: row.assessment_id,
    assessmentVersionId: row.assessment_version_id,
    assessmentVersion: row.assessment_version,
    status: row.status,
    format: row.format,
    schemaVersion: row.schema_version,
    templateVersion: row.template_version,
    ruleVersion: row.rule_version,
    contentHash: row.content_hash,
    pdfHash: row.pdf_hash,
    pdfByteSize: row.pdf_byte_size,
    content: row.content_snapshot,
    generatedBy: row.generated_by_user_id,
    generatedAt: iso(row.generated_at as Date | string),
    version: row.version,
  })
}

async function loadSource(
  exec: Queryable,
  organizationId: string,
  caseId: string,
  versionId: string,
  expectedAssessmentVersion: number,
  lock: boolean,
): Promise<TrafficValueLossReportSource> {
  const assessmentResult = await exec.query(
    `SELECT a.id,a.version,c.office_number,c.plate,c.case_type,c.loss_date,c.notification_date
     FROM traffic_value_loss_assessments a
     JOIN cases c ON c.organization_id=a.organization_id AND c.id=a.case_id
     WHERE a.organization_id=$1 AND a.case_id=$2${lock ? ' FOR UPDATE OF a' : ''}`,
    [organizationId, caseId],
  )
  const assessment = assessmentResult.rows[0] as {
    id: string
    version: number
    office_number: string
    plate: string
    case_type: string
    loss_date: Date | string | null
    notification_date: Date | string | null
  } | undefined
  if (assessment === undefined || assessment.case_type !== 'traffic') {
    throw new TrafficValueLossReportStoreError('not_found')
  }
  if (assessment.version !== expectedAssessmentVersion) {
    throw new TrafficValueLossReportStoreError('version_conflict')
  }
  const membership = await exec.query(
    `SELECT 1 FROM traffic_value_loss_versions
     WHERE organization_id=$1 AND case_id=$2 AND assessment_id=$3 AND id=$4`,
    [organizationId, caseId, assessment.id, versionId],
  )
  if ((membership.rowCount ?? 0) === 0) throw new TrafficValueLossReportStoreError('not_found')
  const version = await loadTrafficValueLossVersion(exec, organizationId, caseId, versionId)
  if (version === undefined) throw new TrafficValueLossReportStoreError('not_found')
  return {
    caseReference: {
      caseId,
      officeNumber: assessment.office_number,
      plate: assessment.plate,
      caseType: 'traffic',
      lossDate: localDate(assessment.loss_date),
      notificationDate: localDate(assessment.notification_date),
    },
    assessmentId: assessment.id,
    version,
  } as unknown as TrafficValueLossReportSource
}

function buildContent(source: TrafficValueLossReportSource, reportNote: string | null) {
  const built = buildTrafficValueLossReportContent(source, reportNote)
  if (!built.ok) {
    if (built.error === 'REPORT_SOURCE_NOT_APPROVED' || built.error === 'REPORT_APPROVAL_FACTS_MISSING') {
      throw new TrafficValueLossReportStoreError('not_approved')
    }
    throw new TrafficValueLossReportStoreError('invalid_content')
  }
  const content = trafficValueLossReportContentSchema.parse(built.content)
  const contentHash = sha256(canonicalizeTrafficValueLossReportContent(built.content))
  return { content, contentHash }
}

async function idempotentWrite<T>(
  pool: pg.Pool,
  actor: Actor,
  caseId: string,
  idem: Idempotency,
  writer: (client: pg.PoolClient) => Promise<T>,
): Promise<Result<T>> {
  const existing = await findIdempotent(pool, actor.organizationId, idem.scope, idem.key)
  if (existing !== undefined) {
    if (existing.requestHash !== idem.requestHash) throw new TrafficValueLossReportStoreError('idempotency_conflict')
    return { replay: true, status: existing.responseStatus, body: existing.responseBody }
  }
  return withTransaction(pool, async (client) => {
    const replay = await findIdempotent(client, actor.organizationId, idem.scope, idem.key)
    if (replay !== undefined) {
      if (replay.requestHash !== idem.requestHash) throw new TrafficValueLossReportStoreError('idempotency_conflict')
      return { replay: true, status: replay.responseStatus, body: replay.responseBody }
    }
    const body = await writer(client)
    await insertIdempotent(client, {
      organizationId: actor.organizationId,
      scope: idem.scope,
      key: idem.key,
      requestHash: idem.requestHash,
      responseStatus: 201,
      responseBody: body,
      caseId,
    })
    return { replay: false, status: 201, body }
  })
}

export function createTrafficValueLossReportStore(
  pool: pg.Pool,
  clock: Clock = systemClock,
): TrafficValueLossReportStore {
  const audit = createAuditService()
  const findReport = async (organizationId: string, caseId: string, reportId: string) => {
    const result = await pool.query(
      'SELECT * FROM traffic_value_loss_reports WHERE organization_id=$1 AND case_id=$2 AND id=$3',
      [organizationId, caseId, reportId],
    )
    const row = result.rows[0] as Record<string, unknown> | undefined
    return row === undefined ? undefined : mapReport(row)
  }
  return {
    async preview(organizationId, caseId, versionId, input) {
      const source = await loadSource(pool, organizationId, caseId, versionId, input.expectedAssessmentVersion, false)
      const built = buildContent(source, input.reportNote)
      return trafficValueLossReportPreviewResponseSchema.parse({
        content: built.content,
        previewHash: built.contentHash,
        previewedAt: clock.nowUtcIso(),
      })
    },
    async generate(actor, caseId, versionId, input, idem) {
      return idempotentWrite(pool, actor, caseId, idem, async (client) => {
        const source = await loadSource(
          client,
          actor.organizationId,
          caseId,
          versionId,
          input.expectedAssessmentVersion,
          true,
        )
        const built = buildContent(source, input.reportNote)
        if (built.contentHash !== input.previewHash) throw new TrafficValueLossReportStoreError('preview_mismatch')
        const duplicate = await client.query(
          'SELECT 1 FROM traffic_value_loss_reports WHERE assessment_version_id=$1',
          [versionId],
        )
        if ((duplicate.rowCount ?? 0) > 0) throw new TrafficValueLossReportStoreError('report_exists')
        const reportId = uuidv7()
        const generatedAt = clock.nowUtcIso()
        const pdf = renderTrafficValueLossReportPdf({ reportId, generatedAt, content: built.content })
        const pdfHash = hashTrafficValueLossReportPdf(pdf)
        await client.query(
          `INSERT INTO traffic_value_loss_reports
           (id,organization_id,case_id,assessment_id,assessment_version_id,assessment_version,
            schema_version,template_version,rule_version,content_snapshot,content_hash,pdf_hash,pdf_byte_size,
            generated_by_user_id,generated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15)`,
          [
            reportId,
            actor.organizationId,
            caseId,
            built.content.assessment.assessmentId,
            versionId,
            built.content.assessment.assessmentVersion,
            built.content.schemaVersion,
            built.content.templateVersion,
            built.content.rule.ruleVersion,
            JSON.stringify(built.content),
            built.contentHash,
            pdfHash,
            pdf.length,
            actor.actorUserId,
            generatedAt,
          ],
        )
        const result = await client.query('SELECT * FROM traffic_value_loss_reports WHERE id=$1', [reportId])
        const report = mapReport(result.rows[0] as Record<string, unknown>)
        await audit.record(client, {
          organizationId: actor.organizationId,
          actorUserId: actor.actorUserId,
          action: 'traffic_value_loss.report_generated',
          entityType: 'traffic_value_loss_report',
          entityId: reportId,
          requestId: actor.requestId,
          details: {
            caseId,
            reportId,
            assessmentVersionId: versionId,
            assessmentVersion: report.assessmentVersion,
            ruleVersion: report.ruleVersion,
            schemaVersion: report.schemaVersion,
            templateVersion: report.templateVersion,
            evidenceCount: report.content.evidence.length,
            comparableCount: report.content.comparables.length,
            uncertaintyCount: report.content.uncertainties.length,
            pdfByteSize: report.pdfByteSize,
          },
        })
        return { report }
      })
    },
    async list(organizationId, caseId) {
      const exists = await pool.query('SELECT 1 FROM cases WHERE organization_id=$1 AND id=$2', [organizationId, caseId])
      if ((exists.rowCount ?? 0) === 0) return undefined
      const result = await pool.query(
        'SELECT * FROM traffic_value_loss_reports WHERE organization_id=$1 AND case_id=$2 ORDER BY generated_at DESC,id DESC',
        [organizationId, caseId],
      )
      return result.rows.map((row: Record<string, unknown>) => mapReport(row))
    },
    async find(organizationId, caseId, reportId) {
      return findReport(organizationId, caseId, reportId)
    },
    async pdf(organizationId, caseId, reportId) {
      const report = await findReport(organizationId, caseId, reportId)
      if (report === undefined) return undefined
      const bytes = renderTrafficValueLossReportPdf({
        reportId: report.id,
        generatedAt: report.generatedAt,
        content: report.content,
      })
      if (bytes.length !== report.pdfByteSize || hashTrafficValueLossReportPdf(bytes) !== report.pdfHash) {
        throw new TrafficValueLossReportStoreError('render_mismatch')
      }
      return { report, bytes }
    },
  }
}
