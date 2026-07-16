import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AUTH_LOGIN_ROUTE,
  CASE_SUMMARY_REPORT_ROUTE,
  FEES_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  TRAFFIC_VALUE_LOSS_CLOSURE_SUMMARIES_ROUTE,
  caseClosureFeeResponseSchema,
  caseSummaryReportResponseSchema,
  closureFeeListResponseSchema,
  closureFeeResponseSchema,
  trafficValueLossClosureListResponseSchema,
} from '@hasarbotu/contracts'
import {
  assertTestDatabaseUrl,
  closeDatabasePool,
  createDatabasePool,
  runMigrations,
  uuidv7,
  type DatabaseConfig,
} from '@hasarbotu/database'
import { buildApp, fixedClock, hashPassword } from '../src/index.js'

const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'p39-sentetik-guclu-parola-42'

describeDb('Paket 39 kapanma ücreti ve dönem raporu gerçek API', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let organizationId: string
  let foreignOrganizationId: string
  let managerUserId: string
  let accountingUserId: string
  let closedCaseId: string
  let closedWithoutFeeCaseId: string
  let openCaseId: string
  let foreignCaseId: string
  let readyReportVersionId: string
  let managerCookie: string
  let accountingCookie: string

  const caseFeeUrl = (caseId: string) => `/api/v1/cases/${caseId}/fee`
  const candidateUrl = (caseId: string) => `${caseFeeUrl(caseId)}/candidates`

  async function login(email: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: AUTH_LOGIN_ROUTE,
      payload: { email, password: PASSWORD },
    })
    expect(response.statusCode).toBe(200)
    return String(response.headers['set-cookie']).split(';')[0] as string
  }

  async function seedExpertReport(caseId: string, status: 'ready' | 'pending'): Promise<string> {
    const documentId = uuidv7()
    const versionId = uuidv7()
    const ready = status === 'ready'
    await pool.query(
      `INSERT INTO documents
       (id,organization_id,case_id,document_type,current_version_number,status)
       VALUES ($1,$2,$3,'expert_report',1,$4)`,
      [documentId, organizationId, caseId, status],
    )
    await pool.query(
      `INSERT INTO document_versions
       (id,organization_id,document_id,case_id,version_number,original_file_name,display_name,
        extension,mime_type,byte_size,content_hash,storage_root_key,relative_path,source_type,
        status,hash_verified,size_verified,verified_at,registered_by_user_id)
       VALUES ($1,$2,$3,$4,1,'sentetik-nihai.pdf','Sentetik Nihai Rapor','pdf',
               'application/pdf',256,$5,'synthetic-root',$6,'manual',$7,$8,$8,$9,$10)`,
      [
        versionId,
        organizationId,
        documentId,
        caseId,
        'b'.repeat(64),
        `sentetik/${caseId}/nihai.pdf`,
        status,
        ready,
        ready ? '2026-07-15T08:00:00Z' : null,
        managerUserId,
      ],
    )
    await pool.query('UPDATE documents SET current_version_id=$2 WHERE id=$1', [documentId, versionId])
    return versionId
  }

  async function seedApprovedValueLoss(caseId: string): Promise<void> {
    const assessmentId = uuidv7()
    const versionId = uuidv7()
    await pool.query(
      `INSERT INTO traffic_value_loss_assessments
       (id,organization_id,case_id,created_by_user_id)
       VALUES ($1,$2,$3,$4)`,
      [assessmentId, organizationId, caseId, managerUserId],
    )
    await pool.query(
      `INSERT INTO traffic_value_loss_versions
       (id,organization_id,case_id,assessment_id,assessment_version,status,rule_set_id,rule_version,
        effective_from,evaluated_on,input_snapshot,result_snapshot,result_code,human_approval_status,
        approved_by_user_id,approved_at,is_active,created_by_user_id)
       VALUES ($1,$2,$3,$4,2,'approved','traffic-value-loss-market-difference','2026.07.01.1',
               '2026-07-01','2026-07-15','{}'::jsonb,$5::jsonb,'calculable','approved',$6,now(),true,$6)`,
      [versionId, organizationId, caseId, assessmentId, JSON.stringify({
        faultAdjustedValueLossMinor: 245_000,
        canSubmitForApproval: true,
      }), managerUserId],
    )
    await pool.query('UPDATE traffic_value_loss_assessments SET current_version_id=$2 WHERE id=$1', [assessmentId, versionId])
    await pool.query(
      `INSERT INTO traffic_value_loss_reports
       (id,organization_id,case_id,assessment_id,assessment_version_id,assessment_version,
        schema_version,template_version,rule_version,content_snapshot,content_hash,pdf_hash,
        pdf_byte_size,generated_by_user_id)
       VALUES ($1,$2,$3,$4,$5,2,'traffic-value-loss-final-report/1.0.0',
               'traffic-value-loss-final-report-tr/1.0.0','2026.07.01.1',$6::jsonb,$7,$8,128,$9)`,
      [uuidv7(), organizationId, caseId, assessmentId, versionId, JSON.stringify({
        schemaVersion: 'traffic-value-loss-final-report/1.0.0',
        templateVersion: 'traffic-value-loss-final-report-tr/1.0.0',
        assessment: { assessmentId, versionId, assessmentVersion: 2 },
        rule: { ruleVersion: '2026.07.01.1' },
        caseReference: { caseId, caseType: 'traffic' },
      }), 'c'.repeat(64), 'd'.repeat(64), managerUserId],
    )
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })

    organizationId = uuidv7()
    foreignOrganizationId = uuidv7()
    managerUserId = uuidv7()
    accountingUserId = uuidv7()
    const foreignUserId = uuidv7()
    closedCaseId = uuidv7()
    closedWithoutFeeCaseId = uuidv7()
    openCaseId = uuidv7()
    foreignCaseId = uuidv7()
    const insurerId = uuidv7()
    const serviceId = uuidv7()
    const passwordHash = await hashPassword(PASSWORD)
    await pool.query(
      `INSERT INTO organizations (id,code,name)
       VALUES ($1,'p39-main','P39 Sentetik'),($2,'p39-foreign','P39 Yabancı')`,
      [organizationId, foreignOrganizationId],
    )
    await pool.query(
      `INSERT INTO users (id,organization_id,email,display_name,password_hash)
       VALUES
       ($1,$4,'p39-manager@test.local','P39 Dosya Sorumlusu',$6),
       ($2,$4,'p39-accounting@test.local','P39 Muhasebe',$6),
       ($3,$5,'p39-foreign@test.local','P39 Yabancı',$6)`,
      [managerUserId, accountingUserId, foreignUserId, organizationId, foreignOrganizationId, passwordHash],
    )
    await pool.query(
      `INSERT INTO user_roles (user_id,role_id)
       SELECT $1::uuid,id FROM roles WHERE code='case_manager'
       UNION ALL SELECT $2::uuid,id FROM roles WHERE code='accounting'`,
      [managerUserId, accountingUserId],
    )
    await pool.query(
      `INSERT INTO insurers (id,organization_id,name) VALUES ($1,$2,'Sentetik Sigorta')`,
      [insurerId, organizationId],
    )
    await pool.query(
      `INSERT INTO service_centers
       (id,organization_id,name,center_type,service_type,is_active)
       VALUES ($1,$2,'Sentetik Servis','ozel','private',true)`,
      [serviceId, organizationId],
    )
    await pool.query(
      `INSERT INTO storage_roots (id,organization_id,root_key,label)
       VALUES ($1,$2,'synthetic-root','Sentetik Root')`,
      [uuidv7(), organizationId],
    )
    await pool.query(
      `INSERT INTO cases
       (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
        workflow_stage,plate,plate_normalized,responsible_user_id,insurer_id,service_center_id,
        created_at,closed_at,version)
       VALUES
       ($1,$5,2026,3901,'2026/3901','traffic','closed','closed','34 P 3901','34P3901',$6,$7,$8,
        '2026-07-01T09:00:00Z','2026-07-10T10:00:00Z',1),
       ($2,$5,2026,3902,'2026/3902','casco','closed','closed','34 P 3902','34P3902',$6,$7,$8,
        '2026-07-02T09:00:00Z','2026-07-11T10:00:00Z',1),
       ($3,$5,2026,3903,'2026/3903','traffic','open','reporting','34 P 3903','34P3903',$6,$7,$8,
        '2026-07-03T09:00:00Z',NULL,1),
       ($4,$9,2026,3904,'2026/3904','traffic','closed','closed','35 P 3904','35P3904',$10,NULL,NULL,
        '2026-07-03T09:00:00Z','2026-07-12T10:00:00Z',1)`,
      [
        closedCaseId,
        closedWithoutFeeCaseId,
        openCaseId,
        foreignCaseId,
        organizationId,
        managerUserId,
        insurerId,
        serviceId,
        foreignOrganizationId,
        foreignUserId,
      ],
    )
    readyReportVersionId = await seedExpertReport(closedCaseId, 'ready')
    await seedApprovedValueLoss(closedCaseId)
    await seedExpertReport(openCaseId, 'ready')
    await seedExpertReport(closedWithoutFeeCaseId, 'pending')

    app = buildApp({
      clock: fixedClock('2026-07-16T10:30:00.000Z'),
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 100, windowMs: 60_000 } },
    })
    managerCookie = await login('p39-manager@test.local')
    accountingCookie = await login('p39-accounting@test.local')
  }, 90_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  it('401, tenant 404 ve boş case ücret görünümünü uygular', async () => {
    expect((await app.inject({ method: 'GET', url: caseFeeUrl(closedCaseId) })).statusCode).toBe(401)
    expect((await app.inject({
      method: 'GET',
      url: caseFeeUrl(foreignCaseId),
      headers: { cookie: managerCookie },
    })).statusCode).toBe(404)
    const empty = await app.inject({
      method: 'GET',
      url: caseFeeUrl(closedCaseId),
      headers: { cookie: managerCookie },
    })
    expect(empty.statusCode).toBe(200)
    expect(caseClosureFeeResponseSchema.parse(empty.json())).toMatchObject({
      fee: null,
      permissions: { canCreateCandidate: true, canApprove: false, canCorrect: false },
    })
  })

  it('açık case veya doğrulanmamış kaynak için aday oluşturmaz', async () => {
    const openSource = (await pool.query(
      `SELECT dv.id FROM document_versions dv
       JOIN documents d ON d.id=dv.document_id
       WHERE d.case_id=$1 AND d.document_type='expert_report'`,
      [openCaseId],
    )).rows[0].id as string
    const open = await app.inject({
      method: 'POST',
      url: candidateUrl(openCaseId),
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        expectedCaseVersion: 1,
        candidateAmountMinor: 485_000,
        sourceDocumentVersionId: openSource,
        sourcePage: 12,
      },
    })
    expect(open.statusCode).toBe(409)
    const pendingSource = (await pool.query(
      `SELECT dv.id FROM document_versions dv
       JOIN documents d ON d.id=dv.document_id
       WHERE d.case_id=$1 AND d.document_type='expert_report'`,
      [closedWithoutFeeCaseId],
    )).rows[0].id as string
    const pending = await app.inject({
      method: 'POST',
      url: candidateUrl(closedWithoutFeeCaseId),
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        expectedCaseVersion: 1,
        candidateAmountMinor: 485_000,
        sourceDocumentVersionId: pendingSource,
        sourcePage: 12,
      },
    })
    expect(pending.statusCode).toBe(409)
    expect((pending.json() as { error: { code: string } }).error.code).toBe('closure_fee_source_invalid')
  })

  it('manuel adayı idempotent oluşturur ve muhasebe onayı öncesi kesin toplama almaz', async () => {
    const key = uuidv7()
    const payload = {
      expectedCaseVersion: 1,
      candidateAmountMinor: 485_000,
      sourceDocumentVersionId: readyReportVersionId,
      sourcePage: 12,
    }
    const created = await app.inject({
      method: 'POST',
      url: candidateUrl(closedCaseId),
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: key },
      payload,
    })
    const replay = await app.inject({
      method: 'POST',
      url: candidateUrl(closedCaseId),
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: key },
      payload,
    })
    expect(created.statusCode).toBe(201)
    expect(replay.json()).toEqual(created.json())
    const fee = closureFeeResponseSchema.parse(created.json()).fee
    expect(fee.currentVersion).toMatchObject({
      status: 'control_required',
      candidateAmountMinor: 485_000,
      approvedAmountMinor: null,
    })
    expect((await pool.query('SELECT count(*)::int AS n FROM fee_records WHERE case_id=$1', [closedCaseId])).rows)
      .toEqual([{ n: 1 }])

    const report = caseSummaryReportResponseSchema.parse((await app.inject({
      method: 'GET',
      url: `${CASE_SUMMARY_REPORT_ROUTE}?period=2026-07`,
      headers: { cookie: managerCookie },
    })).json())
    expect(report.summary).toMatchObject({
      totalCaseCount: 3,
      openCaseCount: 1,
      closedCaseCount: 2,
      approvedFeeCount: 0,
      approvedFeeTotalMinor: 0,
      controlRequiredFeeCount: 1,
      closedCaseWithoutFeeCount: 1,
      approvedValueLossCount: 1,
      approvedValueLossTotalMinor: 245_000,
      controlRequiredValueLossCount: 0,
      notApplicableValueLossCount: 1,
    })
    expect(report.pendingFees).toHaveLength(1)
  })

  it('rol, optimistic locking, açık onay, düzeltme ve append-only geçmişi uygular', async () => {
    const current = caseClosureFeeResponseSchema.parse((await app.inject({
      method: 'GET',
      url: caseFeeUrl(closedCaseId),
      headers: { cookie: managerCookie },
    })).json()).fee
    expect(current).not.toBeNull()
    const feeId = current?.id as string
    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/v1/fees/${feeId}/approve`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedVersion: 1, confirmed: true },
    })
    expect(forbidden.statusCode).toBe(403)
    const stale = await app.inject({
      method: 'POST',
      url: `/api/v1/fees/${feeId}/approve`,
      headers: { cookie: accountingCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedVersion: 2, confirmed: true },
    })
    expect(stale.statusCode).toBe(409)
    const approveKey = uuidv7()
    const approved = await app.inject({
      method: 'POST',
      url: `/api/v1/fees/${feeId}/approve`,
      headers: { cookie: accountingCookie, [IDEMPOTENCY_KEY_HEADER]: approveKey },
      payload: { expectedVersion: 1, confirmed: true },
    })
    const approveReplay = await app.inject({
      method: 'POST',
      url: `/api/v1/fees/${feeId}/approve`,
      headers: { cookie: accountingCookie, [IDEMPOTENCY_KEY_HEADER]: approveKey },
      payload: { expectedVersion: 1, confirmed: true },
    })
    expect(approved.statusCode).toBe(200)
    expect(approveReplay.json()).toEqual(approved.json())
    expect(closureFeeResponseSchema.parse(approved.json()).fee.currentVersion.status).toBe('approved')

    const corrected = await app.inject({
      method: 'POST',
      url: `/api/v1/fees/${feeId}/correct`,
      headers: { cookie: accountingCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        expectedVersion: 2,
        approvedAmountMinor: 510_000,
        sourceDocumentVersionId: readyReportVersionId,
        sourcePage: 13,
        reason: 'Sentetik tarife kontrolü sonrası kullanıcı düzeltmesi.',
        confirmed: true,
      },
    })
    expect(corrected.statusCode).toBe(200)
    const correctedFee = closureFeeResponseSchema.parse(corrected.json()).fee
    expect(correctedFee).toMatchObject({
      version: 3,
      currentVersion: { status: 'corrected', approvedAmountMinor: 510_000, sourcePage: 13 },
    })
    expect(correctedFee.history.map((item) => item.status)).toEqual([
      'corrected',
      'approved',
      'control_required',
    ])
    await expect(pool.query(
      'UPDATE fee_record_versions SET source_page=14 WHERE id=$1',
      [correctedFee.currentVersion.id],
    )).rejects.toMatchObject({ code: '23001' })
  })

  it('onaylı güncel tutarı raporlar, fee listesini tenant-kapsamlı döndürür ve audit sızdırmaz', async () => {
    const reportResponse = await app.inject({
      method: 'GET',
      url: `${CASE_SUMMARY_REPORT_ROUTE}?period=2026-07&responsibleUserId=${managerUserId}`,
      headers: { cookie: accountingCookie },
    })
    expect(reportResponse.statusCode).toBe(200)
    const report = caseSummaryReportResponseSchema.parse(reportResponse.json())
    expect(report.summary).toMatchObject({
      approvedFeeCount: 1,
      approvedFeeTotalMinor: 510_000,
      controlRequiredFeeCount: 0,
      closedCaseWithoutFeeCount: 1,
      approvedValueLossCount: 1,
      approvedValueLossTotalMinor: 245_000,
      controlRequiredValueLossCount: 0,
      notApplicableValueLossCount: 1,
    })
    expect(report.pendingFees).toEqual([])
    expect(report.responsibleUsers).toContainEqual({ id: managerUserId, name: 'P39 Dosya Sorumlusu' })

    const fees = closureFeeListResponseSchema.parse((await app.inject({
      method: 'GET',
      url: FEES_ROUTE,
      headers: { cookie: accountingCookie },
    })).json())
    expect(fees.items).toHaveLength(1)
    expect(fees.items[0]).toMatchObject({
      caseId: closedCaseId,
      fee: { currentVersion: { status: 'corrected', approvedAmountMinor: 510_000 } },
    })
    expect((await app.inject({
      method: 'GET',
      url: TRAFFIC_VALUE_LOSS_CLOSURE_SUMMARIES_ROUTE,
    })).statusCode).toBe(401)
    const valueLoss = trafficValueLossClosureListResponseSchema.parse((await app.inject({
      method: 'GET',
      url: TRAFFIC_VALUE_LOSS_CLOSURE_SUMMARIES_ROUTE,
      headers: { cookie: accountingCookie },
    })).json())
    expect(valueLoss.items).toHaveLength(2)
    expect(valueLoss.items.find((item) => item.caseId === closedCaseId)?.summary).toMatchObject({
      status: 'present',
      assessmentVersion: 2,
      amountMinor: 245_000,
    })
    expect(valueLoss.items.find((item) => item.caseId === closedWithoutFeeCaseId)?.summary.status)
      .toBe('not_applicable')
    const audit = JSON.stringify((await pool.query(
      "SELECT action,details FROM audit_events WHERE organization_id=$1 AND action LIKE 'closure_fee.%'",
      [organizationId],
    )).rows)
    expect(audit).not.toMatch(/[A-Z]:\\|password|secret|stack|SELECT |INSERT |sentetik tarife kontrolü/i)
    expect(audit).toContain('closure_fee.candidate_created')
    expect(audit).toContain('closure_fee.approved')
    expect(audit).toContain('closure_fee.corrected')
  })
})
