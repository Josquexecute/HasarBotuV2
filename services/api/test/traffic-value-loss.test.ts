import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AUTH_LOGIN_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  trafficValueLossReportPreviewResponseSchema,
  trafficValueLossReportResponseSchema,
  trafficValueLossReportsResponseSchema,
  trafficValueLossResponseSchema,
} from '@hasarbotu/contracts'
import {
  assertTestDatabaseUrl,
  closeDatabasePool,
  createDatabasePool,
  runMigrations,
  uuidv7,
  type DatabaseConfig,
} from '@hasarbotu/database'
import { buildApp, hashPassword } from '../src/index.js'

const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'p32-sentetik-guclu-parola-42'
const CONTENT_HASH = 'a'.repeat(64)

describeDb('01.07.2026 Trafik değer kaybı API (gerçek PostgreSQL)', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let organizationId: string
  let otherOrganizationId: string
  let trafficCaseId: string
  let cascoCaseId: string
  let documentId: string
  let documentVersionId: string
  let pendingDocumentId: string
  let pendingVersionId: string
  let adminCookie: string
  let managerCookie: string
  let secretaryCookie: string
  let otherCookie: string

  async function seedUser(orgId: string, email: string, role: 'admin' | 'case_manager' | 'secretary') {
    const id = uuidv7()
    await pool.query(
      'INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4,$5)',
      [id, orgId, email, email, await hashPassword(PASSWORD)],
    )
    await pool.query('INSERT INTO user_roles (user_id,role_id) VALUES ($1,(SELECT id FROM roles WHERE code=$2))', [id, role])
  }
  async function login(email: string) {
    const response = await app.inject({ method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email, password: PASSWORD } })
    expect(response.statusCode).toBe(200)
    return String(response.headers['set-cookie']).split(';')[0] as string
  }
  async function seedDocument(caseId: string, status: 'ready' | 'pending') {
    const doc = uuidv7()
    const version = uuidv7()
    const ready = status === 'ready'
    await pool.query("INSERT INTO documents (id,organization_id,case_id,document_type,status) VALUES ($1,$2,$3,'expert_report',$4)", [doc, organizationId, caseId, status])
    await pool.query(
      `INSERT INTO document_versions
       (id,organization_id,document_id,case_id,version_number,original_file_name,display_name,mime_type,byte_size,content_hash,
        storage_root_key,relative_path,source_type,status,hash_verified,size_verified,verified_at)
       VALUES ($1,$2,$3,$4,1,'sentetik-rapor.pdf','Sentetik Ekspertiz','application/pdf',100,$5,'test-root',$6,'manual',$7,$8,$8,$9)`,
      [version, organizationId, doc, caseId, CONTENT_HASH, `sentetik/${version}.pdf`, status, ready, ready ? new Date('2026-07-15T09:00:00Z') : null],
    )
    await pool.query('UPDATE documents SET current_version_id=$1,current_version_number=1 WHERE id=$2', [version, doc])
    return { documentId: doc, documentVersionId: version }
  }
  function payload(expectedVersion = 0, overrides: Record<string, unknown> = {}, source = { documentId, documentVersionId }) {
    const evidence = [
      {
        evidenceKey: 'expert-report',
        sourceType: 'document_version',
        documentId: source.documentId,
        documentVersionId: source.documentVersionId,
        sourceHash: CONTENT_HASH,
        supports: ['vehicle_identity', 'mileage', 'usage_type', 'damage_parts', 'prior_damage', 'fault_rate', 'heavy_damage_status'],
        verificationStatus: 'verified',
      },
      {
        evidenceKey: 'pre-market',
        sourceType: 'market_comparable',
        externalReference: 'ref:sentetik-pre-market',
        sourceHash: 'b'.repeat(64),
        observedAt: '2026-07-10',
        supports: ['pre_accident_market_value'],
        verificationStatus: 'verified',
      },
      {
        evidenceKey: 'post-market',
        sourceType: 'market_comparable',
        externalReference: 'ref:sentetik-post-market',
        sourceHash: 'c'.repeat(64),
        observedAt: '2026-07-11',
        supports: ['post_repair_market_value'],
        verificationStatus: 'verified',
      },
    ]
    const comparables = [
      ...Array.from({ length: 3 }, (_, index) => ({ comparableKey: `pre-${index}`, side: 'pre_accident', amountMinor: 100_000_000 + index, mileage: 50_000 + index, observedAt: '2026-07-10', evidenceKey: 'pre-market' })),
      ...Array.from({ length: 3 }, (_, index) => ({ comparableKey: `post-${index}`, side: 'post_repair', amountMinor: 90_000_000 + index, mileage: 50_000 + index, observedAt: '2026-07-11', evidenceKey: 'post-market' })),
    ]
    return {
      expectedVersion,
      evaluatedOn: '2026-07-16',
      heavyOrTotalDamage: false,
      vehicle: { make: 'Sentetik', model: 'Model', variant: 'Paket', modelYear: 2024, mileage: 50_000, usageType: 'hususi' },
      faultRateBasisPoints: 7_500,
      preAccidentMarketValueMinor: 100_000_000,
      postRepairMarketValueMinor: 90_000_000,
      damageParts: [{ partCode: 'SOL_CAMURLUK', partName: 'Sol çamurluk', repairAction: 'repair_paint', priorDamage: 'no' }],
      evidence,
      comparables,
      ...overrides,
    }
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    organizationId = uuidv7()
    otherOrganizationId = uuidv7()
    await pool.query(
      "INSERT INTO organizations (id,code,name) VALUES ($1,'p32-main','P32 Main'),($2,'p32-other','P32 Other')",
      [organizationId, otherOrganizationId],
    )
    await seedUser(organizationId, 'p32-admin@test.local', 'admin')
    await seedUser(organizationId, 'p32-manager@test.local', 'case_manager')
    await seedUser(organizationId, 'p32-secretary@test.local', 'secretary')
    await seedUser(otherOrganizationId, 'p32-other@test.local', 'admin')
    trafficCaseId = uuidv7()
    cascoCaseId = uuidv7()
    await pool.query(
      `INSERT INTO cases
       (id,organization_id,office_year,office_sequence,office_number,case_type,workflow_stage,plate,plate_normalized,loss_date,notification_date)
       VALUES ($1,$3,2026,3201,'2026/3201','traffic','new_notification','34 P 3201','34P3201','2026-07-02','2026-07-03'),
              ($2,$3,2026,3202,'2026/3202','casco','new_notification','34 P 3202','34P3202','2026-07-02','2026-07-03')`,
      [trafficCaseId, cascoCaseId, organizationId],
    )
    ;({ documentId, documentVersionId } = await seedDocument(trafficCaseId, 'ready'))
    ;({ documentId: pendingDocumentId, documentVersionId: pendingVersionId } = await seedDocument(trafficCaseId, 'pending'))
    app = buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false, loginRateLimit: { limit: 100, windowMs: 60_000 } } })
    adminCookie = await login('p32-admin@test.local')
    managerCookie = await login('p32-manager@test.local')
    secretaryCookie = await login('p32-secretary@test.local')
    otherCookie = await login('p32-other@test.local')
  }, 60_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  it('401, 403, Trafik ve ready/verified kaynak kapılarını uygular', async () => {
    expect((await app.inject({ method: 'GET', url: `/api/v1/cases/${trafficCaseId}/traffic-value-loss` })).statusCode).toBe(401)
    expect((await app.inject({
      method: 'POST', url: `/api/v1/cases/${trafficCaseId}/traffic-value-loss/versions`,
      headers: { cookie: secretaryCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() }, payload: payload(),
    })).statusCode).toBe(403)
    expect((await app.inject({
      method: 'POST', url: `/api/v1/cases/${cascoCaseId}/traffic-value-loss/versions`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() }, payload: payload(),
    })).statusCode).toBe(400)
    expect((await app.inject({
      method: 'POST', url: `/api/v1/cases/${trafficCaseId}/traffic-value-loss/versions`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: payload(0, {}, { documentId: pendingDocumentId, documentVersionId: pendingVersionId }),
    })).statusCode).toBe(400)
  })

  it('piyasa farkı taslağını atomik ve idempotent üretir; eski katsayı formülünü kullanmaz', async () => {
    const key = uuidv7()
    const first = await app.inject({
      method: 'POST', url: `/api/v1/cases/${trafficCaseId}/traffic-value-loss/versions`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: key }, payload: payload(),
    })
    expect(first.statusCode, first.payload).toBe(201)
    const body = trafficValueLossResponseSchema.parse(first.json())
    expect(body.assessment.currentVersion.evaluation).toMatchObject({
      ruleVersion: '2026.07.01.1',
      calculationMethod: 'market_value_difference',
      grossValueLossMinor: 10_000_000,
      faultAdjustedValueLossMinor: 7_500_000,
      canSubmitForApproval: true,
    })
    expect(body.assessment.currentVersion.evaluation.reasoning[0]).toContain('Ek-1')
    const replay = await app.inject({
      method: 'POST', url: `/api/v1/cases/${trafficCaseId}/traffic-value-loss/versions`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: key }, payload: payload(),
    })
    expect(replay.statusCode).toBe(201)
    expect(replay.json()).toEqual(first.json())
    expect((await pool.query('SELECT count(*)::int AS n FROM traffic_value_loss_assessments WHERE case_id=$1', [trafficCaseId])).rows).toEqual([{ n: 1 }])
  })

  it('submit, stale, onay ve immutable geçmiş akışını tamamlar', async () => {
    const current = trafficValueLossResponseSchema.parse((await app.inject({
      method: 'GET', url: `/api/v1/cases/${trafficCaseId}/traffic-value-loss`, headers: { cookie: managerCookie },
    })).json()).assessment
    const versionId = current.currentVersion.id
    const stale = await app.inject({
      method: 'POST', url: `/api/v1/cases/${trafficCaseId}/traffic-value-loss/versions/${versionId}/submit`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() }, payload: { expectedVersion: current.version + 1 },
    })
    expect(stale.statusCode).toBe(409)
    const submitted = await app.inject({
      method: 'POST', url: `/api/v1/cases/${trafficCaseId}/traffic-value-loss/versions/${versionId}/submit`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() }, payload: { expectedVersion: current.version },
    })
    expect(submitted.statusCode).toBe(200)
    const submittedBody = trafficValueLossResponseSchema.parse(submitted.json()).assessment
    expect(submittedBody.currentVersion.status).toBe('awaiting_approval')
    const approved = await app.inject({
      method: 'POST', url: `/api/v1/cases/${trafficCaseId}/traffic-value-loss/versions/${versionId}/approve`,
      headers: { cookie: adminCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedVersion: submittedBody.version, reason: 'Sentetik piyasa kanıtları doğrulandı.' },
    })
    expect(approved.statusCode).toBe(200)
    expect(trafficValueLossResponseSchema.parse(approved.json()).assessment.currentVersion).toMatchObject({
      status: 'approved', humanApprovalStatus: 'approved',
    })
    await expect(pool.query("UPDATE traffic_value_loss_versions SET result_code='no_value_loss' WHERE id=$1", [versionId])).rejects.toMatchObject({ code: '23001' })
    const events = await pool.query('SELECT action FROM traffic_value_loss_approval_events WHERE version_id=$1 ORDER BY created_at', [versionId])
    expect(events.rows).toEqual([{ action: 'submitted' }, { action: 'approved' }])
  })

  it('belirsizlikleri korur ve kontrol gereken taslağı submit etmez', async () => {
    const current = trafficValueLossResponseSchema.parse((await app.inject({
      method: 'GET', url: `/api/v1/cases/${trafficCaseId}/traffic-value-loss`, headers: { cookie: managerCookie },
    })).json()).assessment
    const created = await app.inject({
      method: 'POST', url: `/api/v1/cases/${trafficCaseId}/traffic-value-loss/versions`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: payload(current.version, { comparables: [], postRepairMarketValueMinor: null }),
    })
    expect(created.statusCode, created.payload).toBe(201)
    const body = trafficValueLossResponseSchema.parse(created.json()).assessment
    expect(body.currentVersion.status).toBe('control_required')
    expect(body.currentVersion.evaluation.uncertainties.map((item) => item.code)).toEqual(expect.arrayContaining([
      'MARKET_VALUES_MISSING', 'INSUFFICIENT_PRE_COMPARABLES', 'INSUFFICIENT_POST_COMPARABLES',
    ]))
    const blocked = await app.inject({
      method: 'POST', url: `/api/v1/cases/${trafficCaseId}/traffic-value-loss/versions/${body.currentVersion.id}/submit`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() }, payload: { expectedVersion: body.version },
    })
    expect(blocked.statusCode).toBe(409)
  })

  it('yeni sürümü oluşturur, önceki onaylı sürümü superseded ve append-only korur', async () => {
    const current = trafficValueLossResponseSchema.parse((await app.inject({
      method: 'GET', url: `/api/v1/cases/${trafficCaseId}/traffic-value-loss`, headers: { cookie: managerCookie },
    })).json()).assessment
    const created = await app.inject({
      method: 'POST', url: `/api/v1/cases/${trafficCaseId}/traffic-value-loss/versions`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() }, payload: payload(current.version),
    })
    expect(created.statusCode).toBe(201)
    const versions = await app.inject({
      method: 'GET', url: `/api/v1/cases/${trafficCaseId}/traffic-value-loss/versions`, headers: { cookie: managerCookie },
    })
    const items = (versions.json() as { versions: Array<{ assessmentVersion: number; status: string }> }).versions
    expect(items.length).toBeGreaterThanOrEqual(3)
    expect(items).toEqual(expect.arrayContaining([expect.objectContaining({ assessmentVersion: 1, status: 'superseded' })]))
    await expect(pool.query('DELETE FROM traffic_value_loss_evidence WHERE version_id=(SELECT id FROM traffic_value_loss_versions WHERE assessment_id=(SELECT id FROM traffic_value_loss_assessments WHERE case_id=$1) ORDER BY assessment_version LIMIT 1)', [trafficCaseId])).rejects.toMatchObject({ code: '23001' })
  })

  it('insan onayı reddetme kararını gerekçeli ve append-only saklar', async () => {
    const current = trafficValueLossResponseSchema.parse((await app.inject({
      method: 'GET', url: `/api/v1/cases/${trafficCaseId}/traffic-value-loss`, headers: { cookie: managerCookie },
    })).json()).assessment
    const submitted = await app.inject({
      method: 'POST', url: `/api/v1/cases/${trafficCaseId}/traffic-value-loss/versions/${current.currentVersion.id}/submit`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() }, payload: { expectedVersion: current.version },
    })
    const submittedBody = trafficValueLossResponseSchema.parse(submitted.json()).assessment
    const rejected = await app.inject({
      method: 'POST', url: `/api/v1/cases/${trafficCaseId}/traffic-value-loss/versions/${current.currentVersion.id}/reject`,
      headers: { cookie: adminCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedVersion: submittedBody.version, reason: 'Emsal seçimi yeniden hazırlanmalıdır.' },
    })
    expect(rejected.statusCode).toBe(200)
    expect(trafficValueLossResponseSchema.parse(rejected.json()).assessment.currentVersion).toMatchObject({
      status: 'rejected',
      humanApprovalStatus: 'rejected',
      approvalReason: 'Emsal seçimi yeniden hazırlanmalıdır.',
    })
    await expect(pool.query("UPDATE traffic_value_loss_approval_events SET reason='degistir' WHERE action='rejected' AND version_id=$1", [current.currentVersion.id])).rejects.toMatchObject({ code: '23001' })
  })

  it('tenant izolasyonu ve audit/response sızıntı sınırını uygular', async () => {
    expect((await app.inject({
      method: 'GET', url: `/api/v1/cases/${trafficCaseId}/traffic-value-loss`, headers: { cookie: otherCookie },
    })).statusCode).toBe(404)
    const response = await app.inject({
      method: 'GET', url: `/api/v1/cases/${trafficCaseId}/traffic-value-loss`, headers: { cookie: adminCookie },
    })
    const audit = await pool.query("SELECT details::text AS details FROM audit_events WHERE action LIKE 'traffic_value_loss.%'")
    const serialized = JSON.stringify({ response: response.json(), audit: audit.rows })
    expect(serialized).not.toMatch(/[A-Z]:\\|\\\\|p32-sentetik-guclu-parola|original_file_name|relative_path/i)
    expect(serialized).not.toContain('sentetik-rapor.pdf')
  })

  it('onaylı sürümden yazmasız önizleme ve immutable, idempotent PDF nihai çıktı üretir', async () => {
    const reportCaseId = uuidv7()
    await pool.query(
      `INSERT INTO cases
       (id,organization_id,office_year,office_sequence,office_number,case_type,workflow_stage,plate,plate_normalized,loss_date,notification_date)
       VALUES ($1,$2,2026,3401,'2026/3401','traffic','reporting','34 P 3401','34P3401','2026-07-02','2026-07-03')`,
      [reportCaseId, organizationId],
    )
    const reportSource = await seedDocument(reportCaseId, 'ready')
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${reportCaseId}/traffic-value-loss/versions`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: payload(0, {}, reportSource),
    })
    const createdAssessment = trafficValueLossResponseSchema.parse(created.json()).assessment
    const versionId = createdAssessment.currentVersion.id
    const blockedPreview = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${reportCaseId}/traffic-value-loss/versions/${versionId}/report-preview`,
      headers: { cookie: managerCookie },
      payload: { expectedAssessmentVersion: createdAssessment.version, reportNote: null },
    })
    expect(blockedPreview.statusCode).toBe(409)
    const submitted = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${reportCaseId}/traffic-value-loss/versions/${versionId}/submit`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedVersion: createdAssessment.version },
    })
    const submittedAssessment = trafficValueLossResponseSchema.parse(submitted.json()).assessment
    const approved = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${reportCaseId}/traffic-value-loss/versions/${versionId}/approve`,
      headers: { cookie: adminCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedVersion: submittedAssessment.version, reason: 'Sentetik rapor kanıtları incelendi.' },
    })
    const approvedAssessment = trafficValueLossResponseSchema.parse(approved.json()).assessment

    const beforePreviewReports = Number((await pool.query(
      'SELECT count(*) AS n FROM traffic_value_loss_reports WHERE case_id=$1',
      [reportCaseId],
    )).rows[0].n)
    const beforePreviewAudit = Number((await pool.query(
      "SELECT count(*) AS n FROM audit_events WHERE action='traffic_value_loss.report_generated' AND details->>'caseId'=$1",
      [reportCaseId],
    )).rows[0].n)
    const preview = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${reportCaseId}/traffic-value-loss/versions/${versionId}/report-preview`,
      headers: { cookie: managerCookie },
      payload: {
        expectedAssessmentVersion: approvedAssessment.version,
        reportNote: 'Kullanıcı kontrollü sentetik nihai rapor.',
      },
    })
    expect(preview.statusCode, preview.payload).toBe(200)
    const previewBody = trafficValueLossReportPreviewResponseSchema.parse(preview.json())
    expect(previewBody.content).toMatchObject({
      caseReference: { officeNumber: '2026/3401', plate: '34 P 3401' },
      assessment: { versionId, humanApprovalStatus: 'approved' },
      calculation: {
        grossValueLossMinor: 10_000_000,
        faultAdjustedValueLossMinor: 7_500_000,
      },
      rule: { ruleVersion: '2026.07.01.1' },
    })
    expect(previewBody.content.evidence).toHaveLength(3)
    expect(previewBody.content.comparables).toHaveLength(6)
    expect(Number((await pool.query('SELECT count(*) AS n FROM traffic_value_loss_reports WHERE case_id=$1', [reportCaseId])).rows[0].n))
      .toBe(beforePreviewReports)
    expect(Number((await pool.query(
      "SELECT count(*) AS n FROM audit_events WHERE action='traffic_value_loss.report_generated' AND details->>'caseId'=$1",
      [reportCaseId],
    )).rows[0].n)).toBe(beforePreviewAudit)

    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${reportCaseId}/traffic-value-loss/versions/${versionId}/reports`,
      headers: { cookie: secretaryCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        expectedAssessmentVersion: approvedAssessment.version,
        reportNote: 'Kullanıcı kontrollü sentetik nihai rapor.',
        confirmed: true,
        previewHash: previewBody.previewHash,
      },
    })
    expect(forbidden.statusCode).toBe(403)
    expect(Number((await pool.query('SELECT count(*) AS n FROM traffic_value_loss_reports WHERE case_id=$1', [reportCaseId])).rows[0].n))
      .toBe(beforePreviewReports)

    const stale = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${reportCaseId}/traffic-value-loss/versions/${versionId}/reports`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        expectedAssessmentVersion: approvedAssessment.version,
        reportNote: 'Kullanıcı kontrollü sentetik nihai rapor.',
        confirmed: true,
        previewHash: 'f'.repeat(64),
      },
    })
    expect(stale.statusCode).toBe(409)

    const idempotencyKey = uuidv7()
    const generatePayload = {
      expectedAssessmentVersion: approvedAssessment.version,
      reportNote: 'Kullanıcı kontrollü sentetik nihai rapor.',
      confirmed: true,
      previewHash: previewBody.previewHash,
    }
    const generated = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${reportCaseId}/traffic-value-loss/versions/${versionId}/reports`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
      payload: generatePayload,
    })
    expect(generated.statusCode, generated.payload).toBe(201)
    const report = trafficValueLossReportResponseSchema.parse(generated.json()).report
    expect(report).toMatchObject({
      assessmentVersionId: versionId,
      status: 'ready',
      format: 'pdf',
      ruleVersion: '2026.07.01.1',
      contentHash: previewBody.previewHash,
    })
    const replay = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${reportCaseId}/traffic-value-loss/versions/${versionId}/reports`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
      payload: generatePayload,
    })
    expect(replay.statusCode).toBe(201)
    expect(replay.json()).toEqual(generated.json())
    expect((await pool.query('SELECT count(*)::int AS n FROM traffic_value_loss_reports WHERE case_id=$1', [reportCaseId])).rows)
      .toEqual([{ n: 1 }])

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/cases/${reportCaseId}/traffic-value-loss/reports`,
      headers: { cookie: managerCookie },
    })
    expect(trafficValueLossReportsResponseSchema.parse(list.json()).reports).toHaveLength(1)
    const pdf = await app.inject({
      method: 'GET',
      url: `/api/v1/cases/${reportCaseId}/traffic-value-loss/reports/${report.id}/pdf`,
      headers: { cookie: managerCookie },
    })
    expect(pdf.statusCode).toBe(200)
    expect(pdf.headers['content-type']).toContain('application/pdf')
    expect(pdf.headers['content-disposition']).toContain('trafik-deger-kaybi-v1.pdf')
    expect(pdf.rawPayload.subarray(0, 8).toString()).toBe('%PDF-1.4')
    expect(pdf.rawPayload.length).toBe(report.pdfByteSize)
    expect((await app.inject({
      method: 'GET',
      url: `/api/v1/cases/${reportCaseId}/traffic-value-loss/reports/${report.id}/pdf`,
    })).statusCode).toBe(401)
    expect((await app.inject({
      method: 'GET',
      url: `/api/v1/cases/${reportCaseId}/traffic-value-loss/reports/${report.id}`,
      headers: { cookie: otherCookie },
    })).statusCode).toBe(404)

    await expect(pool.query(
      "UPDATE traffic_value_loss_reports SET rule_version='degisti' WHERE id=$1",
      [report.id],
    )).rejects.toMatchObject({ code: '23001' })
    await expect(pool.query('DELETE FROM traffic_value_loss_reports WHERE id=$1', [report.id]))
      .rejects.toMatchObject({ code: '23001' })
    const audit = await pool.query(
      "SELECT details::text AS details FROM audit_events WHERE action='traffic_value_loss.report_generated' AND resource_id=$1",
      [report.id],
    )
    expect(audit.rows).toHaveLength(1)
    const serialized = JSON.stringify({ report, audit: audit.rows })
    expect(serialized).not.toMatch(/[A-Z]:\\|\\\\|p32-sentetik-guclu-parola|relative_path|original_file_name/i)
    expect(serialized).not.toContain('sentetik-rapor.pdf')
  })

  it('gerçek TCP üzerinde login, taslak, replay, submit, approve ve güvenlik smoke akışını tamamlar', async () => {
    const liveCaseId = uuidv7()
    await pool.query(
      `INSERT INTO cases
       (id,organization_id,office_year,office_sequence,office_number,case_type,workflow_stage,plate,plate_normalized,loss_date,notification_date)
       VALUES ($1,$2,2026,3203,'2026/3203','traffic','new_notification','34 P 3203','34P3203','2026-07-02','2026-07-03')`,
      [liveCaseId, organizationId],
    )
    const liveSource = await seedDocument(liveCaseId, 'ready')
    await app.listen({ host: '127.0.0.1', port: 0 })
    const address = app.server.address()
    if (address === null || typeof address === 'string') throw new Error('TCP listener adresi alınamadı')
    const baseUrl = `http://127.0.0.1:${address.port}`

    async function liveLogin(email: string) {
      const response = await fetch(`${baseUrl}${AUTH_LOGIN_ROUTE}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: PASSWORD }),
      })
      expect(response.status).toBe(200)
      const cookie = response.headers.get('set-cookie')?.split(';')[0]
      if (cookie === undefined) throw new Error('Canlı login cookie üretmedi')
      return cookie
    }

    const liveAdminCookie = await liveLogin('p32-admin@test.local')
    const liveOtherCookie = await liveLogin('p32-other@test.local')
    const idempotencyKey = uuidv7()
    const createRequest = payload(0, {}, liveSource)
    const first = await fetch(`${baseUrl}/api/v1/cases/${liveCaseId}/traffic-value-loss/versions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: liveAdminCookie,
        [IDEMPOTENCY_KEY_HEADER]: idempotencyKey,
      },
      body: JSON.stringify(createRequest),
    })
    expect(first.status).toBe(201)
    const firstBody = trafficValueLossResponseSchema.parse(await first.json())
    expect(firstBody.assessment.version).toBe(1)
    expect(firstBody.assessment.currentVersion.evaluation).toMatchObject({
      grossValueLossMinor: 10_000_000,
      faultAdjustedValueLossMinor: 7_500_000,
      humanApprovalRequired: true,
    })

    const replay = await fetch(`${baseUrl}/api/v1/cases/${liveCaseId}/traffic-value-loss/versions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: liveAdminCookie,
        [IDEMPOTENCY_KEY_HEADER]: idempotencyKey,
      },
      body: JSON.stringify(createRequest),
    })
    expect(replay.status).toBe(201)
    expect(await replay.json()).toEqual(firstBody)

    const versionId = firstBody.assessment.currentVersion.id
    const submitted = await fetch(`${baseUrl}/api/v1/cases/${liveCaseId}/traffic-value-loss/versions/${versionId}/submit`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: liveAdminCookie,
        [IDEMPOTENCY_KEY_HEADER]: uuidv7(),
      },
      body: JSON.stringify({ expectedVersion: firstBody.assessment.version }),
    })
    expect(submitted.status).toBe(200)
    const submittedBody = trafficValueLossResponseSchema.parse(await submitted.json())

    const approved = await fetch(`${baseUrl}/api/v1/cases/${liveCaseId}/traffic-value-loss/versions/${versionId}/approve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: liveAdminCookie,
        [IDEMPOTENCY_KEY_HEADER]: uuidv7(),
      },
      body: JSON.stringify({
        expectedVersion: submittedBody.assessment.version,
        reason: 'Sentetik canlı TCP kanıtları incelendi.',
      }),
    })
    expect(approved.status).toBe(200)
    const approvedBody = trafficValueLossResponseSchema.parse(await approved.json())
    expect(approvedBody.assessment.currentVersion.status).toBe('approved')

    expect((await fetch(`${baseUrl}/api/v1/cases/${liveCaseId}/traffic-value-loss`)).status).toBe(401)
    expect((await fetch(`${baseUrl}/api/v1/cases/${liveCaseId}/traffic-value-loss`, {
      headers: { cookie: liveOtherCookie },
    })).status).toBe(404)
    const serialized = JSON.stringify(approvedBody)
    expect(serialized).not.toMatch(/[A-Z]:\\|\\\\|p32-sentetik-guclu-parola|relative_path|original_file_name/i)
  })
})
