import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AGENT_CLAIM_ROUTE,
  AGENT_ID_HEADER,
  AGENT_SECRET_HEADER,
  AGENTS_ROUTE,
  AUTH_LOGIN_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  laborAllocationApplyResponseSchema,
  laborAllocationRunResponseSchema,
  laborExcelProfileResponseSchema,
  laborWorkbookApplyResponseSchema,
  type LaborWorkbookAuditEventRequest,
  type LaborWorkbookApplyJobPayload,
  type LaborWorkbookPreviewJobPayload,
} from '@hasarbotu/contracts'
import {
  assertTestDatabaseUrl,
  closeDatabasePool,
  createDatabasePool,
  runMigrations,
  uuidv7,
  type DatabaseConfig,
} from '@hasarbotu/database'
import { sha256WorkbookBytes } from '../../file-agent/src/ooxml-readonly-extractor.js'
import {
  executeLaborWorkbookApply,
  executeLaborWorkbookPreview,
} from '../../file-agent/src/labor-workbook-executor.js'
import { waitForRunTerminal } from './helpers/labor-allocation-run.js'
import {
  buildApp,
  createDeterministicLaborAllocationProviderRegistry,
  hashPassword,
} from '../src/index.js'

const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'p65b-sentetik-guclu-parola'

const xml = (body: string): Uint8Array =>
  strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body}`)

function workbookFixture(plate: string, officeNumber: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': xml(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    ),
    '_rels/.rels': xml(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="book" '
      + 'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
      + 'Target="xl/workbook.xml"/></Relationships>',
    ),
    'xl/workbook.xml': xml(
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
      + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<sheets><sheet name="İşçilik" sheetId="1" r:id="sheet"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': xml(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="sheet" '
      + 'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
      + 'Target="worksheets/labor.xml"/></Relationships>',
    ),
    'xl/worksheets/labor.xml': xml(
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<sheetData><row r="1">'
      + '<c r="A1" t="inlineStr"><is><t>Parça</t></is></c>'
      + `<c r="B1" t="inlineStr"><is><t>${plate}</t></is></c>`
      + `<c r="C1" t="inlineStr"><is><t>${officeNumber}</t></is></c>`
      + '<c r="D1" t="inlineStr"><is><t>İşçilik</t></is></c>'
      + '</row><row r="2">'
      + '<c r="A2" t="inlineStr"><is><t>Ön tampon</t></is></c>'
      + '<c r="D2" t="inlineStr"><is><t>100.00</t></is></c>'
      + '<c r="H2"><v>11</v></c><c r="I2"><v>12</v></c>'
      + '<c r="J2"><v>13</v></c><c r="K2"><v>14</v></c>'
      + '<c r="L2"><v>15</v></c><c r="M2"><v>16</v></c>'
      + '<c r="N2"><f>SUM(H2:M2)</f><v>81</v></c>'
      + '</row></sheetData></worksheet>',
    ),
    'docProps/core.xml': xml('<coreProperties><title>Sentetik P65B</title></coreProperties>'),
  })
}

describeDb('Paket 65B onaylı workbook apply runtime zinciri', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let root: string
  let organizationId: string
  let foreignOrganizationId: string
  let adminUserId: string
  let adminCookie: string
  let readerCookie: string
  let foreignCookie: string
  let agentId: string
  let agentSecret: string

  async function login(email: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: AUTH_LOGIN_ROUTE,
      payload: { email, password: PASSWORD },
    })
    expect(response.statusCode).toBe(200)
    return String(response.headers['set-cookie']).split(';')[0] as string
  }

  function agentHeaders(): Record<string, string> {
    return {
      [AGENT_ID_HEADER]: agentId,
      [AGENT_SECRET_HEADER]: agentSecret,
    }
  }

  async function claim() {
    const response = await app.inject({
      method: 'POST',
      url: AGENT_CLAIM_ROUTE,
      headers: agentHeaders(),
    })
    expect(response.statusCode).toBe(200)
    const body = response.json() as {
      job: {
        id: string
        type: string
        payload: LaborWorkbookPreviewJobPayload | LaborWorkbookApplyJobPayload
      } | null
    }
    expect(body.job).not.toBeNull()
    return body.job as NonNullable<typeof body.job>
  }

  async function report(jobId: string, result: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/agent/jobs/${jobId}/result`,
      headers: agentHeaders(),
      payload: result,
    })
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    root = await mkdtemp(join(tmpdir(), 'hasarbotu-p65b-api-'))

    organizationId = uuidv7()
    foreignOrganizationId = uuidv7()
    adminUserId = uuidv7()
    const readerId = uuidv7()
    const foreignId = uuidv7()
    const passwordHash = await hashPassword(PASSWORD)
    await pool.query(
      `INSERT INTO organizations (id,code,name)
       VALUES ($1,'p65b-main','P65B Sentetik'),($2,'p65b-foreign','P65B Yabancı')`,
      [organizationId, foreignOrganizationId],
    )
    await pool.query(
      `INSERT INTO users (id,organization_id,email,display_name,password_hash)
       VALUES ($1,$4,'p65b-admin@test.local','P65B Yönetici',$6),
              ($2,$4,'p65b-reader@test.local','P65B Okuyucu',$6),
              ($3,$5,'p65b-foreign@test.local','P65B Yabancı',$6)`,
      [
        adminUserId, readerId, foreignId, organizationId,
        foreignOrganizationId, passwordHash,
      ],
    )
    await pool.query(
      `INSERT INTO user_roles (user_id,role_id)
       SELECT $1::uuid,id FROM roles WHERE code='admin'
       UNION ALL SELECT $2::uuid,id FROM roles WHERE code='read_only'
       UNION ALL SELECT $3::uuid,id FROM roles WHERE code='admin'`,
      [adminUserId, readerId, foreignId],
    )
    await pool.query(
      `INSERT INTO storage_roots (id,organization_id,root_key,label,is_active)
       VALUES ($1,$2,'p65b-root','Sentetik kök',true)`,
      [uuidv7(), organizationId],
    )
    await pool.query(
      `INSERT INTO ai_provider_policies
         (id,organization_id,labor_allocation_enabled,labor_allocation_allowed_provider_ids,
          monthly_budget_minor,per_request_budget_minor)
       VALUES ($1,$2,true,ARRAY['deterministic-success']::text[],100000000,100000000)`,
      [uuidv7(), organizationId],
    )
    app = buildApp({
      loggerEnabled: false,
      auth: {
        pool,
        cookieSecure: false,
        loginRateLimit: { limit: 500, windowMs: 60_000 },
      },
      laborAllocationProviders: createDeterministicLaborAllocationProviderRegistry(),
      laborAllocationProviderId: 'deterministic-success',
    })
    await app.ready()
    adminCookie = await login('p65b-admin@test.local')
    readerCookie = await login('p65b-reader@test.local')
    foreignCookie = await login('p65b-foreign@test.local')
    const registration = await app.inject({
      method: 'POST',
      url: AGENTS_ROUTE,
      headers: { cookie: adminCookie },
      payload: { name: 'P65B Agent' },
    })
    expect(registration.statusCode).toBe(201)
    const registered = registration.json() as { agent: { id: string }; secret: string }
    agentId = registered.agent.id
    agentSecret = registered.secret
  }, 60_000)

  afterAll(async () => {
    await app?.close()
    await closeDatabasePool(pool)
    if (root !== undefined) await rm(root, { recursive: true, force: true })
  })

  it('preview, açık onay, lease, atomik yazım, idempotency ve tenant/RBAC sınırlarını korur', async () => {
    const caseId = uuidv7()
    const officeNumber = '2026/6501'
    const plate = '34 TEST 65'
    const caseRelative = '2026/34TEST65'
    await pool.query(
      `INSERT INTO cases
         (id,organization_id,office_year,office_sequence,office_number,case_type,
          lifecycle_status,workflow_stage,plate,plate_normalized,responsible_user_id,
          notification_date,version)
       VALUES ($1,$2,2026,6501,$3,'traffic','open','reporting',$4,'34TEST65',$5,
               '2026-07-24',1)`,
      [caseId, organizationId, officeNumber, plate, adminUserId],
    )
    await pool.query(
      `INSERT INTO case_locations
         (id,organization_id,case_id,storage_root_key,relative_path,
          verification_status,source)
       VALUES ($1,$2,$3,'p65b-root',$4,'verified','system')`,
      [uuidv7(), organizationId, caseId, caseRelative],
    )
    const workbookRelative = 'EVRAK/ISCILIK.xlsx'
    const workbookDirectory = join(root, caseRelative, 'EVRAK')
    await mkdir(workbookDirectory, { recursive: true })
    const workbookPath = join(workbookDirectory, 'ISCILIK.xlsx')
    const sourceBytes = workbookFixture(plate, officeNumber)
    await writeFile(workbookPath, sourceBytes)

    const sheet = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/labor-sheet`,
      headers: { cookie: adminCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        expectedCaseVersion: 1,
        confirmed: true,
        items: [{
          description: 'Ön tampon',
          action: 'Onarım',
          partAmountMinor: 0,
          laborAmountMinor: 1_000_000,
          partCode: 'PRC-001',
          partCodeSource: 'user_entered',
          damageRegion: 'Ön',
        }],
      },
    })
    expect(sheet.statusCode).toBe(201)
    const analyzed = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/labor-allocation-ai/analyze`,
      headers: { cookie: adminCookie },
      payload: {
        expectedSheetVersion: 1,
        damageDescription: 'Sentetik ön darbe.',
        confirmedEgress: false,
      },
    })
    const settled = await waitForRunTerminal(app, adminCookie, caseId, analyzed)
    const run = laborAllocationRunResponseSchema.parse(settled.json()).run
    expect(run.status).toBe('review_required')
    const applied = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/labor-allocation-ai/${run.id}/apply`,
      headers: { cookie: adminCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        expectedSheetVersion: 1,
        reason: 'P65B sentetik onay',
        confirmed: true,
        lines: [{
          lineOrdinal: 1,
          description: 'Ön tampon',
          action: 'Onarım',
          partAmountMinor: 0,
          laborAmountMinor: 900_000,
          categoryAmounts: [
            { category: 'bodywork', amountMinor: 500_000 },
            { category: 'mechanical', amountMinor: 0 },
            { category: 'electrical', amountMinor: 0 },
            { category: 'upholstery_lock', amountMinor: 0 },
            { category: 'glass', amountMinor: 0 },
            { category: 'calibration', amountMinor: 0 },
            { category: 'repair', amountMinor: 400_000 },
            { category: 'paint', amountMinor: 0 },
          ],
        }],
      },
    })
    expect(applied.statusCode).toBe(200)
    const application = laborAllocationApplyResponseSchema.parse(applied.json()).application
    expect(application.status).toBe('completed')

    const profileResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/labor-excel-profiles',
      headers: { cookie: adminCookie },
      payload: {
        fields: {
          name: 'P65B Sentetik Profil',
          insurerId: null,
          targetSheet: 'İşçilik',
          identityChecks: { plate: true, officeNumber: true },
          columns: [{ key: 'ISCILIK', label: 'İşçilik' }],
          mapping: {
            bodywork: 'ISCILIK',
            mechanical: 'ISCILIK',
            electrical: 'ISCILIK',
            upholstery_lock: 'ISCILIK',
            glass: 'ISCILIK',
            calibration: 'ISCILIK',
            repair: 'ISCILIK',
            paint: 'ISCILIK',
          },
        },
        expectedVersion: null,
        reason: null,
        confirmed: true,
      },
    })
    expect(profileResponse.statusCode).toBe(201)
    const profile = laborExcelProfileResponseSchema.parse(profileResponse.json()).profile
    expect(profile.writable).toBe(true)

    const previewKey = uuidv7()
    const previewRequest = {
      applicationId: application.id,
      profileId: profile.id,
      workbookRelativePath: workbookRelative,
      expectedSourceSha256: sha256WorkbookBytes(sourceBytes),
      headers: [
        { cell: 'A1', text: 'Parça' },
        { cell: 'D1', text: 'İşçilik' },
      ],
      identityCellReferences: { plateCell: 'B1', officeNumberCell: 'C1' },
      sourceRows: [{ lineOrdinal: 1, rowNumber: 2 }],
    }
    const queued = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/labor-workbook-applies/preview`,
      headers: { cookie: adminCookie, [IDEMPOTENCY_KEY_HEADER]: previewKey },
      payload: previewRequest,
    })
    expect(queued.statusCode).toBe(202)
    const pending = laborWorkbookApplyResponseSchema.parse(queued.json()).operation
    expect(pending.status).toBe('preview_pending')
    expect(JSON.stringify(queued.json())).not.toContain(root)

    const replay = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/labor-workbook-applies/preview`,
      headers: { cookie: adminCookie, [IDEMPOTENCY_KEY_HEADER]: previewKey },
      payload: previewRequest,
    })
    expect(laborWorkbookApplyResponseSchema.parse(replay.json()).operation.id)
      .toBe(pending.id)
    const foreignRead = await app.inject({
      method: 'GET',
      url: `/api/v1/cases/${caseId}/labor-workbook-applies/${pending.id}`,
      headers: { cookie: foreignCookie },
    })
    expect(foreignRead.statusCode).toBe(404)

    const previewJob = await claim()
    expect(previewJob.type).toBe('preview_labor_workbook_apply')
    const previewResult = await executeLaborWorkbookPreview(
      root,
      previewJob.payload as LaborWorkbookPreviewJobPayload,
    )
    expect(previewResult.outcome).toBe('verified')
    const previewReport = await report(previewJob.id, previewResult)
    expect(previewReport.statusCode).toBe(200)
    expect((previewReport.json() as { status: string }).status).toBe('succeeded')

    const readyResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/cases/${caseId}/labor-workbook-applies/${pending.id}`,
      headers: { cookie: adminCookie },
    })
    const ready = laborWorkbookApplyResponseSchema.parse(readyResponse.json()).operation
    expect(ready).toMatchObject({
      status: 'preview_ready',
      previousTotalMinor: 10_000,
      newTotalMinor: 900_000,
      changedRowCount: 1,
      unchangedRowCount: 0,
    })
    expect(ready.rows[0]).toMatchObject({
      cell: 'D2',
      previousValue: '100.00',
      newValue: '9000.00',
      valueSource: 'approved_final',
      matchConfidence: 'exact_source_row',
    })

    const readerApproval = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/labor-workbook-applies/${pending.id}/approve`,
      headers: { cookie: readerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        expectedVersion: ready.version,
        planHash: ready.planHash,
        approvedRevisionSnapshotHash: ready.approvedRevisionSnapshotHash,
        confirmed: true,
      },
    })
    expect(readerApproval.statusCode).toBe(403)
    const wrongPlan = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/labor-workbook-applies/${pending.id}/approve`,
      headers: { cookie: adminCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        expectedVersion: ready.version,
        planHash: createHash('sha256').update('yanlış-plan').digest('hex'),
        approvedRevisionSnapshotHash: ready.approvedRevisionSnapshotHash,
        confirmed: true,
      },
    })
    expect(wrongPlan.statusCode).toBe(409)

    const approveKey = uuidv7()
    const approvalPayload = {
      expectedVersion: ready.version,
      planHash: ready.planHash,
      approvedRevisionSnapshotHash: ready.approvedRevisionSnapshotHash,
      confirmed: true,
    }
    const approved = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/labor-workbook-applies/${pending.id}/approve`,
      headers: { cookie: adminCookie, [IDEMPOTENCY_KEY_HEADER]: approveKey },
      payload: approvalPayload,
    })
    expect(approved.statusCode).toBe(202)
    const approvedOperation =
      laborWorkbookApplyResponseSchema.parse(approved.json()).operation
    expect(approvedOperation.status).toBe('approved')

    const applyJob = await claim()
    expect(applyJob.type).toBe('apply_labor_workbook')
    const applyResult = await executeLaborWorkbookApply(
      root,
      applyJob.payload as LaborWorkbookApplyJobPayload,
      agentId,
      {
        reportLaborWorkbookAudit: async (
          jobId: string,
          event: LaborWorkbookAuditEventRequest,
        ) => {
          const auditResponse = await app.inject({
            method: 'POST',
            url: `/api/v1/agent/jobs/${jobId}/labor-workbook-audit`,
            headers: agentHeaders(),
            payload: event,
          })
          expect(auditResponse.statusCode).toBe(204)
        },
      } as never,
      applyJob.id,
    )
    expect(applyResult.outcome).toBe('verified')
    const applyReport = await report(applyJob.id, applyResult)
    expect(applyReport.statusCode).toBe(200)
    expect((applyReport.json() as { status: string }).status).toBe('succeeded')
    const repeatedReport = await report(applyJob.id, applyResult)
    expect((repeatedReport.json() as { status: string }).status).toBe('succeeded')

    const completedResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/cases/${caseId}/labor-workbook-applies/${pending.id}`,
      headers: { cookie: adminCookie },
    })
    const completed =
      laborWorkbookApplyResponseSchema.parse(completedResponse.json()).operation
    expect(completed.status).toBe('completed')
    expect(completed.approvedByUserId).toBe(adminUserId)
    expect(completed.sourceWorkbookHash).toBe(sha256WorkbookBytes(sourceBytes))
    expect(completed.resultWorkbookHash).not.toBe(completed.sourceWorkbookHash)
    expect(completed.backupReference).toMatch(/[.]bak[.]xlsx$/u)

    const files = await readdir(workbookDirectory)
    expect(files).toHaveLength(2)
    const backupPath = join(workbookDirectory, completed.backupReference as string)
    expect(await readFile(backupPath)).toEqual(Buffer.from(sourceBytes))
    const sourceArchive = unzipSync(sourceBytes)
    const resultBytes = await readFile(workbookPath)
    const resultArchive = unzipSync(resultBytes)
    const beforeSheet = strFromU8(sourceArchive['xl/worksheets/labor.xml'] as Uint8Array)
    const afterSheet = strFromU8(resultArchive['xl/worksheets/labor.xml'] as Uint8Array)
    expect(afterSheet).toMatch(/<t[^>]*>9000[.]00<\/t>/u)
    for (const cell of ['H2', 'I2', 'J2', 'K2', 'L2', 'M2', 'N2']) {
      const pattern = new RegExp(`<c[^>]*r="${cell}"[\\s\\S]*?</c>`)
      expect(pattern.exec(afterSheet)?.[0]).toBe(pattern.exec(beforeSheet)?.[0])
    }
    expect(resultArchive['docProps/core.xml']).toEqual(sourceArchive['docProps/core.xml'])

    const approvalReplay = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/labor-workbook-applies/${pending.id}/approve`,
      headers: { cookie: adminCookie, [IDEMPOTENCY_KEY_HEADER]: approveKey },
      payload: approvalPayload,
    })
    expect(approvalReplay.statusCode).toBe(202)
    expect((await pool.query(
      `SELECT count(*)::int AS n FROM jobs
        WHERE target_id=$1 AND type='apply_labor_workbook'`,
      [pending.id],
    )).rows[0].n).toBe(1)
    expect(await readFile(workbookPath)).toEqual(resultBytes)

    const audit = await pool.query(
      `SELECT action,actor_user_id::text,organization_id::text,details
         FROM audit_events
        WHERE organization_id=$1 AND resource_id=$2
        ORDER BY occurred_at`,
      [organizationId, pending.id],
    )
    expect(audit.rows.map((row) => row.action)).toEqual(expect.arrayContaining([
      'labor_workbook.preview_queued',
      'labor_workbook.preview_ready',
      'labor_workbook.apply_approved',
      'labor_workbook.writer_started',
      'labor_workbook.writer_completed',
      'labor_workbook.apply_completed',
    ]))
    expect(JSON.stringify(audit.rows)).not.toContain(root)
    expect(JSON.stringify(audit.rows)).not.toContain('9000.00')
    expect(audit.rows.some((row) => row.actor_user_id === adminUserId)).toBe(true)

  }, 60_000)
})
