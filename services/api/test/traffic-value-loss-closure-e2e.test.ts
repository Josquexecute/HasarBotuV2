import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AGENTS_ROUTE,
  AUTH_LOGIN_ROUTE,
  CASES_ROUTE,
  CASE_SUMMARY_REPORT_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  TRAFFIC_VALUE_LOSS_CLOSURE_SUMMARIES_ROUTE,
  caseLifecycleOperationResponseSchema,
  caseSummaryReportResponseSchema,
  trafficValueLossClosureListResponseSchema,
  trafficValueLossReportPreviewResponseSchema,
  trafficValueLossReportResponseSchema,
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
import { createAgentApiClient, runOnce, type AgentConfig } from '@hasarbotu/file-agent'
import { buildApp, hashPassword } from '../src/index.js'

/**
 * UAT-tarzı uçtan uca doğrulama: gerçek anonim bir Trafik dosyasında
 * hesaplama -> revizyon -> onay -> nihai rapor -> Paket 40 kapanış zincirini
 * TEK case üzerinde, sentetik SQL ile onaylı sürüm enjekte etmeden, yalnız
 * gerçek command API'leri (create/submit/approve/report/lifecycle close)
 * ile sürer. Mevcut testler bu adımları ayrı ayrı doğrular; bu senaryo
 * revizyonun eski nihai raporu geçersiz kıldığını ve yeni raporun kapanış
 * hazırlığını yeniden `present` yaptığını tek akışta kanıtlar.
 */

const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'uat-vl-sentetik-guclu-parola-42'
const ROOT_KEY = 'uat-vl-root'
const BASE_TYPES = [
  'victim_traffic_policy', 'insured_traffic_policy', 'sbm_heavy_damage_result',
  'victim_registration', 'insured_registration', 'victim_driver_license', 'insured_driver_license',
  'accident_report', 'preliminary_report',
] as const

describeDb('Değer Kaybı uçtan uca UAT: hesaplama -> revizyon -> onay -> rapor -> Paket 40 kapanış (gerçek PostgreSQL)', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let organizationId: string
  let managerCookie: string
  let expertCookie: string
  let root: string
  let agentConfig: AgentConfig
  let agentClient: ReturnType<typeof createAgentApiClient>
  let caseId: string
  let openPath: string

  const injectFetch = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const response = await app.inject({
      method: (init?.method ?? 'GET') as 'GET' | 'POST',
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      ...(init?.body !== undefined && init.body !== null ? { payload: String(init.body) } : {}),
    })
    return { ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode,
      json: async () => response.json(), headers: { get: () => null } } as unknown as Response
  }) as unknown as typeof fetch

  async function seedUser(email: string, role: 'admin' | 'case_manager' | 'expert'): Promise<string> {
    const id = uuidv7()
    await pool.query(
      'INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4,$5)',
      [id, organizationId, email, email, await hashPassword(PASSWORD)],
    )
    await pool.query('INSERT INTO user_roles (user_id,role_id) VALUES ($1,(SELECT id FROM roles WHERE code=$2))', [id, role])
    return id
  }

  async function login(email: string): Promise<string> {
    const response = await app.inject({ method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email, password: PASSWORD } })
    expect(response.statusCode).toBe(200)
    return String(response.headers['set-cookie']).split(';')[0] as string
  }

  let documentHashCounter = 0

  async function seedReadyDocument(type: string): Promise<{ documentId: string; documentVersionId: string; contentHash: string }> {
    const documentId = uuidv7()
    const versionId = uuidv7()
    documentHashCounter += 1
    const contentHash = documentHashCounter.toString(16).padStart(64, '0')
    await pool.query(
      "INSERT INTO documents (id,organization_id,case_id,document_type,status) VALUES ($1,$2,$3,$4,'ready')",
      [documentId, organizationId, caseId, type],
    )
    await pool.query(
      `INSERT INTO document_versions
       (id,organization_id,document_id,case_id,version_number,original_file_name,display_name,mime_type,byte_size,content_hash,
        storage_root_key,relative_path,source_type,status,hash_verified,size_verified,verified_at)
       VALUES ($1,$2,$3,$4,1,'sentetik.pdf','Sentetik Belge','application/pdf',100,$5,'uat-vl-doc-root',$6,'manual','ready',true,true,$7)`,
      [versionId, organizationId, documentId, caseId, contentHash, `sentetik/${versionId}.pdf`, new Date('2026-07-01T09:00:00Z')],
    )
    await pool.query('UPDATE documents SET current_version_id=$1,current_version_number=1 WHERE id=$2', [versionId, documentId])
    return { documentId, documentVersionId: versionId, contentHash }
  }

  async function seedReadyPhoto(): Promise<void> {
    await pool.query(
      `INSERT INTO photos
       (id,organization_id,case_id,original_file_name,display_name,mime_type,byte_size,content_hash,storage_root_key,
        relative_path,source_type,status,hash_verified,size_verified,verified_at)
       VALUES ($1,$2,$3,'onarim.jpg','Onarım','image/jpeg',10,$4,'uat-vl-doc-root',$5,'imported','ready',true,true,$6)`,
      [uuidv7(), organizationId, caseId, 'b'.repeat(64), `sentetik/ONARIM/${caseId}-onarim.jpg`, new Date('2026-07-01T09:00:00Z')],
    )
  }

  function valueLossPayload(expectedVersion: number, source: { documentId: string; documentVersionId: string; contentHash: string }, overrides: Record<string, unknown> = {}) {
    const evidence = [
      {
        evidenceKey: 'expert-report',
        sourceType: 'document_version',
        documentId: source.documentId,
        documentVersionId: source.documentVersionId,
        sourceHash: source.contentHash,
        supports: ['vehicle_identity', 'mileage', 'usage_type', 'damage_parts', 'prior_damage', 'fault_rate', 'heavy_damage_status'],
        verificationStatus: 'verified',
      },
      {
        evidenceKey: 'pre-market',
        sourceType: 'market_comparable',
        externalReference: 'ref:uat-pre-market',
        sourceHash: 'b'.repeat(64),
        observedAt: '2026-07-10',
        supports: ['pre_accident_market_value'],
        verificationStatus: 'verified',
      },
      {
        evidenceKey: 'post-market',
        sourceType: 'market_comparable',
        externalReference: 'ref:uat-post-market',
        sourceHash: 'c'.repeat(64),
        observedAt: '2026-07-11',
        supports: ['post_repair_market_value'],
        verificationStatus: 'verified',
      },
    ]
    const comparables = [
      ...Array.from({ length: 3 }, (_, index) => ({ comparableKey: `pre-${index}`, side: 'pre_accident', amountMinor: 120_000_000 + index, mileage: 42_000 + index, observedAt: '2026-07-10', evidenceKey: 'pre-market' })),
      ...Array.from({ length: 3 }, (_, index) => ({ comparableKey: `post-${index}`, side: 'post_repair', amountMinor: 108_000_000 + index, mileage: 42_000 + index, observedAt: '2026-07-11', evidenceKey: 'post-market' })),
    ]
    return {
      expectedVersion,
      evaluatedOn: '2026-07-16',
      heavyOrTotalDamage: false,
      vehicle: { make: 'Anonim', model: 'Sedan', variant: 'Comfort', modelYear: 2023, mileage: 42_000, usageType: 'hususi' },
      faultRateBasisPoints: 10_000,
      preAccidentMarketValueMinor: 120_000_000,
      postRepairMarketValueMinor: 108_000_000,
      damageParts: [{ partCode: 'SAG_KAPI', partName: 'Sağ ön kapı', repairAction: 'repair_paint', priorDamage: 'no' }],
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
    await pool.query("INSERT INTO organizations (id,code,name) VALUES ($1,'uat-vl-main','UAT Değer Kaybı')", [organizationId])
    await seedUser('uat-vl-admin@test.local', 'admin')
    await seedUser('uat-vl-manager@test.local', 'case_manager')
    await seedUser('uat-vl-expert@test.local', 'expert')
    await pool.query('INSERT INTO storage_roots (id,organization_id,root_key,label) VALUES ($1,$2,$3,$4)',
      [uuidv7(), organizationId, ROOT_KEY, 'UAT Değer Kaybı Root'])

    app = buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false, loginRateLimit: { limit: 1000, windowMs: 60_000 } } })
    managerCookie = await login('uat-vl-manager@test.local')
    expertCookie = await login('uat-vl-expert@test.local')
    const adminCookie = await login('uat-vl-admin@test.local')

    const caseResponse = await app.inject({
      method: 'POST', url: CASES_ROUTE,
      headers: { cookie: adminCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { caseType: 'traffic', plate: '34 UAT 401', workflowStage: 'ready_to_close', lossDate: '2026-06-30', notificationDate: '2026-07-01' },
    })
    expect(caseResponse.statusCode).toBe(201)
    caseId = (caseResponse.json() as { case: { id: string } }).case.id
    openPath = '2026/Temmuz 2026/34UAT401'
    await pool.query(
      `INSERT INTO case_locations (id,organization_id,case_id,storage_root_key,relative_path,verification_status,source)
       VALUES ($1,$2,$3,$4,$5,'verified','system')`,
      [uuidv7(), organizationId, caseId, ROOT_KEY, openPath],
    )

    const registered = await app.inject({ method: 'POST', url: AGENTS_ROUTE, headers: { cookie: adminCookie }, payload: { name: 'UAT Value Loss Agent' } })
    expect(registered.statusCode).toBe(201)
    const agent = registered.json() as { agent: { id: string }; secret: string }
    root = await mkdtemp(join(tmpdir(), 'hb-uat-vl-'))
    const absolute = join(root, ...openPath.split('/'))
    for (const directory of ['EVRAK', 'HASAR', 'OLAY YERİ', 'ONARIM', 'DEĞER KAYBI']) {
      await mkdir(join(absolute, directory), { recursive: true })
    }
    await writeFile(join(absolute, 'EVRAK', 'sentetik.txt'), 'uat-deger-kaybi', 'utf8')
    agentConfig = { apiBaseUrl: '', agentId: agent.agent.id, agentSecret: agent.secret, roots: { [ROOT_KEY]: root }, leaseSeconds: 120, pollIntervalMs: 1000, freshnessGate: undefined }
    agentClient = createAgentApiClient({ baseUrl: '', agentId: agent.agent.id, secret: agent.secret, fetchImpl: injectFetch })

    for (const type of BASE_TYPES) await seedReadyDocument(type)
    await seedReadyPhoto()
  }, 60_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
    if (root !== undefined) await rm(root, { recursive: true, force: true })
  })

  it('gerçek hesaplama, revizyon, onay, nihai rapor ve Paket 40 kapanış zincirini tek case üzerinde tamamlar', async () => {
    const expertReportSource = await seedReadyDocument('expert_report')

    // 1) İlk hesap (v1): case_manager taslak oluşturur.
    const created = await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/traffic-value-loss/versions`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: valueLossPayload(0, expertReportSource),
    })
    expect(created.statusCode, created.payload).toBe(201)
    const v1 = trafficValueLossResponseSchema.parse(created.json()).assessment
    expect(v1.currentVersion.evaluation).toMatchObject({
      ruleVersion: '2026.07.01.1',
      grossValueLossMinor: 12_000_000,
      faultAdjustedValueLossMinor: 12_000_000,
      canSubmitForApproval: true,
    })
    const v1Id = v1.currentVersion.id

    // 2) Submit + onay (expert): v1 approved+active olur.
    const v1Submitted = await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/traffic-value-loss/versions/${v1Id}/submit`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() }, payload: { expectedVersion: v1.version },
    })
    expect(v1Submitted.statusCode).toBe(200)
    const v1SubmittedBody = trafficValueLossResponseSchema.parse(v1Submitted.json()).assessment
    const v1Approved = await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/traffic-value-loss/versions/${v1Id}/approve`,
      headers: { cookie: expertCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedVersion: v1SubmittedBody.version, reason: 'Sentetik ilk emsal seti doğrulandı.' },
    })
    expect(v1Approved.statusCode).toBe(200)
    const v1ApprovedBody = trafficValueLossResponseSchema.parse(v1Approved.json()).assessment
    expect(v1ApprovedBody.currentVersion).toMatchObject({ status: 'approved', humanApprovalStatus: 'approved' })

    // 3) v1 için nihai rapor üretilir (henüz revizyon yok).
    const v1Preview = await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/traffic-value-loss/versions/${v1Id}/report-preview`,
      headers: { cookie: managerCookie },
      payload: { expectedAssessmentVersion: v1ApprovedBody.version, reportNote: 'UAT ilk sürüm nihai raporu.' },
    })
    expect(v1Preview.statusCode, v1Preview.payload).toBe(200)
    const v1PreviewBody = trafficValueLossReportPreviewResponseSchema.parse(v1Preview.json())
    const v1Report = await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/traffic-value-loss/versions/${v1Id}/reports`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedAssessmentVersion: v1ApprovedBody.version, reportNote: 'UAT ilk sürüm nihai raporu.', confirmed: true, previewHash: v1PreviewBody.previewHash },
    })
    expect(v1Report.statusCode, v1Report.payload).toBe(201)

    // 4) Kapanış ön izlemesi ŞİMDİ present olmalı (güncel onaylı sürüm = v1, aynı sürüme rapor var).
    const planBeforeRevision = await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/lifecycle/close/plan`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedCaseVersion: 1, expectedLocationVersion: 1, closeMode: 'normal' },
    })
    expect(planBeforeRevision.statusCode, planBeforeRevision.payload).toBe(201)
    const planBeforeRevisionOp = caseLifecycleOperationResponseSchema.parse(planBeforeRevision.json()).operation
    expect(planBeforeRevisionOp.requirementSummary.valueLossSummary).toMatchObject({
      status: 'present', assessmentVersion: 1, amountMinor: 12_000_000,
    })
    expect(planBeforeRevisionOp.status).toBe('approval_required')
    // Plan açık kaldığı sürece yeni bir plan oluşturulamaz (aktif lifecycle kilidi);
    // bu ön izleme adımını iptal ederek gerçek kapanışa yer açıyoruz.
    const cancelled = await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/lifecycle-operations/${planBeforeRevisionOp.id}/cancel`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedVersion: planBeforeRevisionOp.version, cancelled: true },
    })
    expect(cancelled.statusCode, cancelled.payload).toBe(200)

    // 5) Revizyon (v2): ek emsallerle onarım sonrası piyasa değeri düşürülür.
    const revisionCreated = await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/traffic-value-loss/versions`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: valueLossPayload(v1ApprovedBody.version, expertReportSource, { postRepairMarketValueMinor: 104_000_000 }),
    })
    expect(revisionCreated.statusCode, revisionCreated.payload).toBe(201)
    const v2 = trafficValueLossResponseSchema.parse(revisionCreated.json()).assessment
    expect(v2.currentVersion.evaluation).toMatchObject({ grossValueLossMinor: 16_000_000, faultAdjustedValueLossMinor: 16_000_000 })
    const v2Id = v2.currentVersion.id
    expect(v2Id).not.toBe(v1Id)

    // v1 hâlâ onaylı ve aktif (yeni sürüm onaylanana kadar append-only geçmiş korunur).
    expect((await pool.query('SELECT status,is_active FROM traffic_value_loss_versions WHERE id=$1', [v1Id])).rows[0])
      .toEqual({ status: 'approved', is_active: true })

    // 6) v2 submit + onay (expert): v1 superseded olur, v2 approved+active olur.
    const v2Submitted = await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/traffic-value-loss/versions/${v2Id}/submit`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() }, payload: { expectedVersion: v2.version },
    })
    expect(v2Submitted.statusCode).toBe(200)
    const v2SubmittedBody = trafficValueLossResponseSchema.parse(v2Submitted.json()).assessment
    const v2Approved = await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/traffic-value-loss/versions/${v2Id}/approve`,
      headers: { cookie: expertCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedVersion: v2SubmittedBody.version, reason: 'Sentetik ek emsallerle revize sonuç doğrulandı.' },
    })
    expect(v2Approved.statusCode).toBe(200)
    const v2ApprovedBody = trafficValueLossResponseSchema.parse(v2Approved.json()).assessment
    expect(v2ApprovedBody.currentVersion).toMatchObject({ status: 'approved', humanApprovalStatus: 'approved' })
    expect((await pool.query('SELECT status FROM traffic_value_loss_versions WHERE id=$1', [v1Id])).rows[0]).toEqual({ status: 'superseded' })

    // 7) Revizyondan SONRA, v2 için henüz rapor yok: kapanış hazırlığı control_required'a düşmeli
    //    (eski v1 raporu artık güncel onaylı sürüme ait değil).
    const planAfterRevision = await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/lifecycle/close/plan`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedCaseVersion: 1, expectedLocationVersion: 1, closeMode: 'normal' },
    })
    expect(planAfterRevision.statusCode, planAfterRevision.payload).toBe(201)
    const planAfterRevisionOp = caseLifecycleOperationResponseSchema.parse(planAfterRevision.json()).operation
    expect(planAfterRevisionOp.status).toBe('blocked')
    expect(planAfterRevisionOp.requirementSummary.valueLossSummary?.status).toBe('control_required')

    // 8) v2 için nihai rapor üretilir.
    const v2Preview = await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/traffic-value-loss/versions/${v2Id}/report-preview`,
      headers: { cookie: managerCookie },
      payload: { expectedAssessmentVersion: v2ApprovedBody.version, reportNote: 'UAT revize sürüm nihai raporu.' },
    })
    expect(v2Preview.statusCode, v2Preview.payload).toBe(200)
    const v2PreviewBody = trafficValueLossReportPreviewResponseSchema.parse(v2Preview.json())
    expect(v2PreviewBody.content.calculation).toMatchObject({ grossValueLossMinor: 16_000_000, faultAdjustedValueLossMinor: 16_000_000 })
    const v2ReportResponse = await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/traffic-value-loss/versions/${v2Id}/reports`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedAssessmentVersion: v2ApprovedBody.version, reportNote: 'UAT revize sürüm nihai raporu.', confirmed: true, previewHash: v2PreviewBody.previewHash },
    })
    expect(v2ReportResponse.statusCode, v2ReportResponse.payload).toBe(201)
    const v2Report = trafficValueLossReportResponseSchema.parse(v2ReportResponse.json()).report
    const pdf = await app.inject({
      method: 'GET', url: `/api/v1/cases/${caseId}/traffic-value-loss/reports/${v2Report.id}/pdf`,
      headers: { cookie: managerCookie },
    })
    expect(pdf.statusCode).toBe(200)
    expect(pdf.rawPayload.subarray(0, 8).toString()).toBe('%PDF-1.4')
    expect(pdf.rawPayload.length).toBe(v2Report.pdfByteSize)

    // 9) Kapanış hazırlığı v2 raporuyla yeniden present olmalı.
    const planReady = await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/lifecycle/close/plan`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedCaseVersion: 1, expectedLocationVersion: 1, closeMode: 'normal' },
    })
    expect(planReady.statusCode, planReady.payload).toBe(201)
    const planReadyOp = caseLifecycleOperationResponseSchema.parse(planReady.json()).operation
    expect(planReadyOp.status).toBe('approval_required')
    expect(planReadyOp.blockers).toEqual([])
    expect(planReadyOp.requirementSummary.valueLossSummary).toMatchObject({
      status: 'present', assessmentVersion: 2, amountMinor: 16_000_000,
    })
    expect(planReadyOp.requirementSummary.valueLossSummary?.reportId).toBe(v2Report.id)

    // 10) Gerçek Agent taşımasıyla kapanışı tamamla (Paket 21 mekanizması).
    const approveKey = uuidv7()
    const approvedClose = await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/lifecycle/close/${planReadyOp.id}/approve`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: approveKey },
      payload: { approved: true, expectedVersion: planReadyOp.version },
    })
    expect(approvedClose.statusCode).toBe(202)
    expect((await runOnce(agentClient, agentConfig)).kind).toBe('reported')
    const closedRow = await pool.query('SELECT lifecycle_status FROM cases WHERE id=$1', [caseId])
    expect(closedRow.rows[0]).toEqual({ lifecycle_status: 'closed' })

    // 11) Paket 40 kapanış özeti listesi gerçek sonucu döndürür.
    const closureList = trafficValueLossClosureListResponseSchema.parse((await app.inject({
      method: 'GET', url: TRAFFIC_VALUE_LOSS_CLOSURE_SUMMARIES_ROUTE, headers: { cookie: managerCookie },
    })).json())
    const closureItem = closureList.items.find((item) => item.caseId === caseId)
    expect(closureItem?.summary).toMatchObject({ status: 'present', assessmentVersion: 2, amountMinor: 16_000_000 })
    expect(closureItem?.summary.reportId).toBe(v2Report.id)

    // 12) Aylık dönem raporu, yeniden hesaplama yapmadan onaylı+raporlu tutarı toplar.
    const period = new Date().toISOString().slice(0, 7)
    const summaryReport = caseSummaryReportResponseSchema.parse((await app.inject({
      method: 'GET', url: `${CASE_SUMMARY_REPORT_ROUTE}?period=${period}`, headers: { cookie: managerCookie },
    })).json())
    expect(summaryReport.summary).toMatchObject({
      closedCaseCount: 1,
      approvedValueLossCount: 1,
      approvedValueLossTotalMinor: 16_000_000,
      controlRequiredValueLossCount: 0,
    })
  }, 60_000)
})
