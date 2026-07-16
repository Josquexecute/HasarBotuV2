import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AUTH_LOGIN_ROUTE,
  DASHBOARD_ROUTE,
  dashboardResponseSchema,
  type DashboardResponse,
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
const PASSWORD = 'p36-sentetik-guclu-parola-42'
const EMAIL = 'p36-dashboard@test.local'
const READY_TRAFFIC_DOCUMENTS = [
  'victim_traffic_policy',
  'insured_traffic_policy',
  'sbm_heavy_damage_result',
  'victim_registration',
  'insured_registration',
  'victim_driver_license',
  'insured_driver_license',
  'accident_report',
] as const

describeDb('Durum Panosu gerçek API verileri', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let organizationId: string
  let userId: string
  let cookie: string
  const caseIds: Record<string, string> = {}

  async function seedCase(
    sequence: number,
    stage: string,
    plate: string,
    followUpDate: string | null,
    responsibleUserId: string | null = userId,
  ): Promise<string> {
    const caseId = uuidv7()
    await pool.query(
      `INSERT INTO cases
       (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
        workflow_stage,plate,plate_normalized,responsible_user_id,follow_up_date,updated_at)
       VALUES ($1,$2,2026,$3,$4,'traffic','open',$5,$6,$7,$8,$9,$10)`,
      [
        caseId,
        organizationId,
        sequence,
        `2026/${sequence}`,
        stage,
        plate,
        plate.replace(/[^A-Z0-9]/g, ''),
        responsibleUserId,
        followUpDate,
        `2026-07-${String(Math.min(sequence, 15)).padStart(2, '0')}T09:00:00Z`,
      ],
    )
    return caseId
  }

  async function seedDocument(
    caseId: string,
    type: string,
    status: 'ready' | 'pending' = 'ready',
  ): Promise<void> {
    const documentId = uuidv7()
    const versionId = uuidv7()
    const verified = status === 'ready'
    await pool.query(
      `INSERT INTO documents
       (id,organization_id,case_id,document_type,current_version_number,status)
       VALUES ($1,$2,$3,$4,1,$5)`,
      [documentId, organizationId, caseId, type, status],
    )
    await pool.query(
      `INSERT INTO document_versions
       (id,organization_id,document_id,case_id,version_number,original_file_name,display_name,
        extension,mime_type,byte_size,content_hash,storage_root_key,relative_path,source_type,
        status,hash_verified,size_verified,verified_at,registered_by_user_id)
       VALUES ($1,$2,$3,$4,1,$5,$5,'pdf','application/pdf',128,$6,'synthetic-root',$7,'manual',
               $8,$9,$9,$10,$11)`,
      [
        versionId,
        organizationId,
        documentId,
        caseId,
        `${type}.pdf`,
        'a'.repeat(64),
        `synthetic/${caseId}/${type}.pdf`,
        status,
        verified,
        verified ? '2026-07-15T08:00:00Z' : null,
        userId,
      ],
    )
    await pool.query(
      'UPDATE documents SET current_version_id=$2 WHERE id=$1',
      [documentId, versionId],
    )
  }

  async function seedCompleteTrafficDocuments(caseId: string): Promise<void> {
    for (const type of READY_TRAFFIC_DOCUMENTS) await seedDocument(caseId, type)
  }

  async function seedTrafficDocumentsExcept(
    caseId: string,
    missingType: (typeof READY_TRAFFIC_DOCUMENTS)[number],
  ): Promise<void> {
    for (const type of READY_TRAFFIC_DOCUMENTS) {
      if (type !== missingType) await seedDocument(caseId, type)
    }
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })

    organizationId = uuidv7()
    userId = uuidv7()
    await pool.query(
      'INSERT INTO organizations (id,code,name) VALUES ($1,$2,$3)',
      [organizationId, 'p36-org', 'Paket 36 Sentetik Organizasyon'],
    )
    await pool.query(
      `INSERT INTO users (id,organization_id,email,display_name,password_hash)
       VALUES ($1,$2,$3,$4,$5)`,
      [userId, organizationId, EMAIL, 'Pano Sorumlusu', await hashPassword(PASSWORD)],
    )

    caseIds.overdue = await seedCase(11, 'inspection_pending', '34 PNO 011', '2026-07-15')
    caseIds.control = await seedCase(12, 'damage_assessment', '34 PNO 012', '2026-07-16')
    caseIds.approval = await seedCase(13, 'reporting', '34 PNO 013', '2026-07-20')
    caseIds.normal = await seedCase(14, 'under_repair', '34 PNO 014', null)
    caseIds.missing = await seedCase(15, 'closing_documents', '34 PNO 015', null)
    await seedCompleteTrafficDocuments(caseIds.overdue)
    await seedCompleteTrafficDocuments(caseIds.control)
    await pool.query(
      `UPDATE document_versions SET status='pending',hash_verified=false,size_verified=false,verified_at=NULL
       WHERE case_id=$1 AND document_id=(
         SELECT id FROM documents WHERE case_id=$1 AND document_type='victim_registration'
       )`,
      [caseIds.control],
    )
    await seedCompleteTrafficDocuments(caseIds.approval)
    await seedCompleteTrafficDocuments(caseIds.normal)
    await seedTrafficDocumentsExcept(caseIds.missing, 'victim_traffic_policy')
    await pool.query(
      `INSERT INTO case_tasks
       (id,organization_id,case_id,title,priority,assigned_user_id,due_date,created_by_user_id)
       VALUES ($1,$2,$3,'Geciken sentetik görev','high',$4,'2026-07-15',$4),
              ($5,$2,$6,'Bugünkü sentetik görev','normal',$4,'2026-07-16',$4),
              ($7,$2,$8,'Yaklaşan sentetik görev','low',$4,'2026-07-20',$4)`,
      [
        uuidv7(), organizationId, caseIds.overdue, userId,
        uuidv7(), caseIds.control,
        uuidv7(), caseIds.normal,
      ],
    )

    const assessmentId = uuidv7()
    const valueLossVersionId = uuidv7()
    await pool.query(
      `INSERT INTO traffic_value_loss_assessments
       (id,organization_id,case_id,created_by_user_id)
       VALUES ($1,$2,$3,$4)`,
      [assessmentId, organizationId, caseIds.approval, userId],
    )
    await pool.query(
      `INSERT INTO traffic_value_loss_versions
       (id,organization_id,case_id,assessment_id,assessment_version,status,rule_set_id,rule_version,
        effective_from,evaluated_on,input_snapshot,result_snapshot,result_code,human_approval_status,
        created_by_user_id)
       VALUES ($1,$2,$3,$4,1,'awaiting_approval','traffic-value-loss-market-difference','2026.07.01.1',
               '2026-07-01','2026-07-16','{}'::jsonb,'{}'::jsonb,'calculable','pending',$5)`,
      [valueLossVersionId, organizationId, caseIds.approval, assessmentId, userId],
    )
    await pool.query(
      'UPDATE traffic_value_loss_assessments SET current_version_id=$2 WHERE id=$1',
      [assessmentId, valueLossVersionId],
    )

    const foreignOrganizationId = uuidv7()
    await pool.query(
      'INSERT INTO organizations (id,code,name) VALUES ($1,$2,$3)',
      [foreignOrganizationId, 'p36-foreign', 'Başka Sentetik Organizasyon'],
    )
    await pool.query(
      `INSERT INTO cases
       (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
        workflow_stage,plate,plate_normalized)
       VALUES ($1,$2,2026,1,'2026/1','traffic','open','new_notification','35 YBN 001','35YBN001')`,
      [uuidv7(), foreignOrganizationId],
    )

    app = buildApp({
      clock: fixedClock('2026-07-16T10:30:00.000Z'),
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 50, windowMs: 60_000 } },
    })
    const login = await app.inject({
      method: 'POST',
      url: AUTH_LOGIN_ROUTE,
      payload: { email: EMAIL, password: PASSWORD },
    })
    expect(login.statusCode).toBe(200)
    const setCookie = login.headers['set-cookie']
    cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0] as string
  }, 90_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  it('oturumsuz istek 401 döner', async () => {
    const response = await app.inject({ method: 'GET', url: DASHBOARD_ROUTE })
    expect(response.statusCode).toBe(401)
  })

  it('tenant-kapsamlı gerçek sinyalleri doğru önceliklendirir ve salt okunur kalır', async () => {
    const auditBefore = await pool.query(
      'SELECT count(*)::int AS count FROM audit_events WHERE organization_id=$1',
      [organizationId],
    )
    const response = await app.inject({
      method: 'GET',
      url: DASHBOARD_ROUTE,
      headers: { cookie },
    })
    expect(response.statusCode).toBe(200)
    const body = response.json() as DashboardResponse
    expect(dashboardResponseSchema.safeParse(body).success).toBe(true)
    expect(body.asOfDate).toBe('2026-07-16')
    expect(body.priorityVersion).toBe('dashboard-priority/1.1.0')
    expect(body.summary).toMatchObject({
      openCaseCount: 5,
      overdueFollowUpCount: 1,
      dueTodayCount: 1,
      upcomingFollowUpCount: 1,
      openTaskCount: 3,
      overdueTaskCaseCount: 1,
      taskDueTodayCaseCount: 1,
      upcomingTaskCaseCount: 1,
      missingDocumentCaseCount: 1,
      controlRequiredDocumentCaseCount: 1,
      pendingHumanApprovalCaseCount: 1,
      actionRequiredCaseCount: 5,
      criticalCaseCount: 1,
    })
    expect(body.items.map((item) => item.caseId)).toEqual([
      caseIds.overdue,
      caseIds.approval,
      caseIds.missing,
      caseIds.control,
      caseIds.normal,
    ])
    expect(body.items.find((item) => item.caseId === caseIds.overdue)).toMatchObject({
      priority: 'critical',
      primaryAttention: 'overdue_task',
      missingDocumentCount: 0,
      openTaskCount: 1,
      overdueTaskCount: 1,
    })
    expect(body.items.find((item) => item.caseId === caseIds.approval)).toMatchObject({
      priority: 'high',
      primaryAttention: 'human_approval',
      pendingHumanApprovalKinds: ['traffic_value_loss'],
      pendingHumanApprovalCount: 1,
    })
    expect(body.items.find((item) => item.caseId === caseIds.control)).toMatchObject({
      priority: 'medium',
      controlRequiredDocumentCount: 1,
      missingDocumentCount: 0,
    })
    expect(body.items.find((item) => item.caseId === caseIds.missing)).toMatchObject({
      priority: 'high',
      primaryAttention: 'missing_documents',
      missingDocumentCount: 1,
      controlRequiredDocumentCount: 0,
    })
    expect(body.items.find((item) => item.caseId === caseIds.normal)).toMatchObject({
      priority: 'normal',
      primaryAttention: 'upcoming_task',
      upcomingTaskCount: 1,
      requiresAction: true,
    })
    expect(JSON.stringify(body)).not.toMatch(/[A-Z]:\\|password|secret|documentContent|rawExcerpt/i)
    const auditAfter = await pool.query(
      'SELECT count(*)::int AS count FROM audit_events WHERE organization_id=$1',
      [organizationId],
    )
    expect(auditAfter.rows[0]).toEqual(auditBefore.rows[0])
  })
})
