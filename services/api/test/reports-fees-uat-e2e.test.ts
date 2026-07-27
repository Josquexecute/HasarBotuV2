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
  CASE_FEE_CANDIDATES_ROUTE,
  CASE_SUMMARY_REPORT_ROUTE,
  FEE_APPROVE_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  caseLifecycleOperationResponseSchema,
  caseSummaryReportResponseSchema,
  closureFeeResponseSchema,
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
 * UAT-tarzı uçtan uca doğrulama: Raporlar ve Ücretler (üst düzey, dosya-içi
 * ücret sekmesinden AYRI) için gerçek kapanış → ücret onayı → aylık
 * rapora yansıma zincirini, gerçek command API'leriyle sürer ve
 * `closure-fee-uat-e2e.test.ts`'in HİÇ kapsamadığı iki gerçek boşluğu kapatır:
 *
 * 1. Aylık rapor ucunun (`GET /api/v1/reports/case-summary`) tenant
 *    izolasyonu hiçbir zaman YABANCI organizasyonun KENDİ oturumundan
 *    sorgulanarak kanıtlanmamıştı (`closure-fees-reports.test.ts` yabancı
 *    case'i yalnız detay 404'ü için seedliyordu, hiç ücret eklemiyordu ve
 *    hiç o organizasyon olarak GİRİŞ YAPMIYORDU). Bu test yabancı
 *    organizasyonda GERÇEKTEN onaylı bir ücret oluşturur (SQL ile — kapsam
 *    dışı saga'yı tekrarlamadan yalnız karşılaştırma verisi olarak) ve HER
 *    İKİ organizasyonun KENDİ oturumuyla raporu sorgulayıp `summary`,
 *    `distribution`, `responsibleUsers`, `services` VE `pendingFees`
 *    alanlarının TAMAMININ sızmadığını doğrudan kanıtlar.
 * 2. Bu uçta rol kısıtı YOKTUR (yalnız `requireSession`) — `secretary` ve
 *    `read_only` rollerinin GERÇEKTEN aynı gerçek mali toplamları
 *    görebildiği hiç kanıtlanmamıştı; bu test bunu gerçek oturumlarla
 *    doğrudan doğrular (kasıtlı tasarım, HB-2026-045/DECISIONS ile tutarlı).
 *
 * Onaylı ücretin GERÇEK yeniden açmadan sonra aylık toplamdan doğru şekilde
 * düştüğü (önceki oturumda bulunup düzeltilen kusur) zaten
 * `closure-fee-uat-e2e.test.ts`'te BU AYNI uç üzerinden kanıtlı; burada
 * TEKRARLANMAZ.
 */

const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'uat-raporlar-sentetik-guclu-parola-27'
const ROOT_KEY = 'uat-raporlar-root'
const BASE_READY_DOCUMENT_TYPES = [
  'casco_policy', 'sbm_heavy_damage_result', 'casco_vehicle_registration', 'casco_driver_license', 'ktt',
  'preliminary_report',
] as const

describeDb('Raporlar ve Ücretler uçtan uca UAT: gerçek kapanış → ücret onayı → aylık rapor → tenant izolasyonu → rol görünürlüğü (gerçek PostgreSQL)', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let root: string
  let orgAId: string
  let orgBId: string
  let managerAId: string
  let managerACookie: string
  let accountingACookie: string
  let adminACookie: string
  let secretaryACookie: string
  let readOnlyACookie: string
  let adminBCookie: string
  let managerBName: string
  let serviceBName: string
  let agentConfig: AgentConfig
  let agentClient: ReturnType<typeof createAgentApiClient>

  const injectFetch = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const response = await app.inject({
      method: (init?.method ?? 'GET') as 'GET' | 'POST',
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      ...(init?.body !== undefined && init.body !== null ? { payload: String(init.body) } : {}),
    })
    return {
      ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode,
      json: async () => response.json(), headers: { get: () => null },
    } as unknown as Response
  }) as unknown as typeof fetch

  async function seedUser(orgId: string, email: string, role: string): Promise<string> {
    const id = uuidv7()
    await pool.query(
      'INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4,$5)',
      [id, orgId, email, email, await hashPassword(PASSWORD)],
    )
    await pool.query(
      "INSERT INTO user_roles (user_id,role_id) SELECT $1::uuid,id FROM roles WHERE code=$2",
      [id, role],
    )
    return id
  }

  async function login(email: string): Promise<string> {
    const response = await app.inject({ method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email, password: PASSWORD } })
    expect(response.statusCode).toBe(200)
    return String(response.headers['set-cookie']).split(';')[0] as string
  }

  async function seedReadyDocument(caseId: string, documentType: string): Promise<string> {
    const documentId = uuidv7()
    const versionId = uuidv7()
    await pool.query(
      "INSERT INTO documents (id,organization_id,case_id,document_type,status) VALUES ($1,$2,$3,$4,'ready')",
      [documentId, orgAId, caseId, documentType],
    )
    await pool.query(
      `INSERT INTO document_versions
       (id,organization_id,document_id,case_id,version_number,original_file_name,display_name,mime_type,byte_size,
        content_hash,storage_root_key,relative_path,source_type,status,hash_verified,size_verified,verified_at)
       VALUES ($1,$2,$3,$4,1,$5,$5,'application/pdf',10,$6,$7,$8,'imported','ready',true,true,$9)`,
      [versionId, orgAId, documentId, caseId, `${documentType}.pdf`, uuidv7().replaceAll('-', '').padEnd(64, '0'),
        ROOT_KEY, `2026/Temmuz 2026/METADATA/EVRAK/${caseId}-${documentType}.pdf`, new Date('2026-07-20T09:00:00.000Z')],
    )
    await pool.query('UPDATE documents SET current_version_id=$2,current_version_number=1 WHERE id=$1', [documentId, versionId])
    return versionId
  }

  async function seedReadyPhoto(caseId: string): Promise<void> {
    await pool.query(
      `INSERT INTO photos
       (id,organization_id,case_id,original_file_name,display_name,mime_type,byte_size,content_hash,storage_root_key,
        relative_path,source_type,status,hash_verified,size_verified,verified_at)
       VALUES ($1,$2,$3,'onarim.jpg','Onarım','image/jpeg',10,$4,$5,$6,'imported','ready',true,true,$7)`,
      [uuidv7(), orgAId, caseId, uuidv7().replaceAll('-', '').padEnd(64, '0'), ROOT_KEY,
        `2026/Temmuz 2026/METADATA/ONARIM/${caseId}-onarim.jpg`, new Date('2026-07-20T09:00:00.000Z')],
    )
  }

  /**
   * Yabancı organizasyonun GERÇEKTEN onaylı bir ücreti: kapsam dışı ikinci
   * bir kapanış saga'sını (gerçek Agent taşıması) tekrarlamadan, yalnız
   * tenant izolasyonu için karşılaştırma verisi olarak SQL ile yazılır.
   */
  async function seedForeignApprovedFee(): Promise<{ caseId: string; approvedAmountMinor: number }> {
    const managerBId = uuidv7()
    const adminBId = uuidv7()
    managerBName = 'Yabancı Dosya Sorumlusu'
    serviceBName = 'Yabancı Servis Merkezi'
    const passwordHash = await hashPassword(PASSWORD)
    await pool.query(
      `INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES
       ($1,$2,'uat-raporlar-manager-b@test.local',$4,$5),
       ($3,$2,'uat-raporlar-admin-b@test.local','Yabancı Yönetici',$5)`,
      [managerBId, orgBId, adminBId, managerBName, passwordHash],
    )
    await pool.query(
      "INSERT INTO user_roles (user_id,role_id) SELECT $1::uuid,id FROM roles WHERE code='admin'",
      [adminBId],
    )
    const serviceBId = uuidv7()
    await pool.query(
      "INSERT INTO service_centers (id,organization_id,name,center_type,service_type,is_active) VALUES ($1,$2,$3,'ozel','private',true)",
      [serviceBId, orgBId, serviceBName],
    )
    const caseBId = uuidv7()
    await pool.query(
      `INSERT INTO cases
       (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
        workflow_stage,plate,plate_normalized,responsible_user_id,service_center_id,notification_date,closed_at,version)
       VALUES ($1,$2,2026,7701,'2026/7701','casco','closed','closed','35 UAT 7701','35UAT7701',$3,$4,'2026-07-01',now(),1)`,
      [caseBId, orgBId, managerBId, serviceBId],
    )
    const documentId = uuidv7()
    const versionId = uuidv7()
    await pool.query(
      "INSERT INTO documents (id,organization_id,case_id,document_type,status) VALUES ($1,$2,$3,'expert_report','ready')",
      [documentId, orgBId, caseBId],
    )
    await pool.query(
      `INSERT INTO document_versions
       (id,organization_id,document_id,case_id,version_number,original_file_name,display_name,mime_type,byte_size,
        content_hash,storage_root_key,relative_path,source_type,status,hash_verified,size_verified,verified_at)
       VALUES ($1,$2,$3,$4,1,'expert_report.pdf','expert_report.pdf','application/pdf',10,$5,'synthetic-root',$6,
               'imported','ready',true,true,now())`,
      [versionId, orgBId, documentId, caseBId, uuidv7().replaceAll('-', '').padEnd(64, '0'), `foreign/${caseBId}/expert_report.pdf`],
    )
    await pool.query('UPDATE documents SET current_version_id=$2,current_version_number=1 WHERE id=$1', [documentId, versionId])

    const approvedAmountMinor = 777_000
    const feeRecordId = uuidv7()
    const feeVersionId = uuidv7()
    await pool.query('INSERT INTO fee_records (id,organization_id,case_id,version) VALUES ($1,$2,$3,1)', [feeRecordId, orgBId, caseBId])
    await pool.query(
      `INSERT INTO fee_record_versions
       (id,organization_id,case_id,fee_record_id,fee_version,status,candidate_amount_minor,approved_amount_minor,
        source_document_version_id,source_page,rule_version,created_by_user_id,approved_by_user_id,approved_at)
       VALUES ($1,$2,$3,$4,1,'approved',$5,$5,$6,1,'closure-fee/1.0.0',$7,$7,now())`,
      [feeVersionId, orgBId, caseBId, feeRecordId, approvedAmountMinor, versionId, adminBId],
    )
    await pool.query('UPDATE fee_records SET current_version_id=$2 WHERE id=$1', [feeRecordId, feeVersionId])

    adminBCookie = await login('uat-raporlar-admin-b@test.local')
    return { caseId: caseBId, approvedAmountMinor }
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })

    orgAId = uuidv7()
    orgBId = uuidv7()
    await pool.query(
      "INSERT INTO organizations (id,code,name) VALUES ($1,'uat-raporlar-a','UAT Raporlar A'),($2,'uat-raporlar-b','UAT Raporlar B')",
      [orgAId, orgBId],
    )
    managerAId = await seedUser(orgAId, 'uat-raporlar-manager-a@test.local', 'case_manager')
    await seedUser(orgAId, 'uat-raporlar-accounting-a@test.local', 'accounting')
    await seedUser(orgAId, 'uat-raporlar-admin-a@test.local', 'admin')
    await seedUser(orgAId, 'uat-raporlar-secretary-a@test.local', 'secretary')
    await seedUser(orgAId, 'uat-raporlar-readonly-a@test.local', 'read_only')
    await pool.query('INSERT INTO storage_roots (id,organization_id,root_key,label) VALUES ($1,$2,$3,$4)',
      [uuidv7(), orgAId, ROOT_KEY, 'UAT Raporlar Kök'])

    app = buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false, loginRateLimit: { limit: 500, windowMs: 60_000 } } })
    await app.ready()
    managerACookie = await login('uat-raporlar-manager-a@test.local')
    accountingACookie = await login('uat-raporlar-accounting-a@test.local')
    adminACookie = await login('uat-raporlar-admin-a@test.local')
    secretaryACookie = await login('uat-raporlar-secretary-a@test.local')
    readOnlyACookie = await login('uat-raporlar-readonly-a@test.local')

    const registered = await app.inject({ method: 'POST', url: AGENTS_ROUTE, headers: { cookie: adminACookie }, payload: { name: 'UAT Raporlar Agent' } })
    expect(registered.statusCode).toBe(201)
    const agent = registered.json() as { agent: { id: string }; secret: string }
    root = await mkdtemp(join(tmpdir(), 'hb-uat-raporlar-'))
    agentConfig = { apiBaseUrl: '', agentId: agent.agent.id, agentSecret: agent.secret, roots: { [ROOT_KEY]: root }, leaseSeconds: 120, pollIntervalMs: 1000 }
    agentClient = createAgentApiClient({ baseUrl: '', agentId: agent.agent.id, secret: agent.secret, fetchImpl: injectFetch })
  }, 60_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
    if (root !== undefined) await rm(root, { recursive: true, force: true })
  })

  it('gerçek kapanış → ücret onayı → aylık rapor → tenant izolasyonu → rol görünürlüğü zincirini tek akışta doğrular', async () => {
    // 1) GERÇEK CASE OLUŞTURMA + kapanış için hazır kanıt (org A).
    const plate = '34 UAT 4501'
    const caseCreated = await app.inject({
      method: 'POST', url: CASES_ROUTE,
      headers: { cookie: adminACookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { caseType: 'casco', plate, workflowStage: 'ready_to_close', notificationDate: '2026-07-20', responsibleUserId: managerAId },
    })
    expect(caseCreated.statusCode, caseCreated.payload).toBe(201)
    const caseId = (caseCreated.json() as { case: { id: string } }).case.id
    await pool.query("UPDATE cases SET recourse_status='not_confirmed' WHERE id=$1", [caseId])
    const openPath = `2026/Temmuz 2026/${plate.replaceAll(' ', '')}`
    await pool.query(
      `INSERT INTO case_locations (id,organization_id,case_id,storage_root_key,relative_path,verification_status,source)
       VALUES ($1,$2,$3,$4,$5,'verified','system')`,
      [uuidv7(), orgAId, caseId, ROOT_KEY, openPath],
    )
    const absolute = join(root, ...openPath.split('/'))
    for (const directory of ['EVRAK', 'HASAR', 'OLAY YERİ', 'ONARIM', 'DEĞER KAYBI']) await mkdir(join(absolute, directory), { recursive: true })
    await writeFile(join(absolute, 'EVRAK', 'sentetik.txt'), 'uat-raporlar-ucretler', 'utf8')
    for (const type of BASE_READY_DOCUMENT_TYPES) await seedReadyDocument(caseId, type)
    const expertReportVersionId = await seedReadyDocument(caseId, 'expert_report')
    await seedReadyPhoto(caseId)

    // 2) GERÇEK KAPANIŞ: plan → onay → gerçek Agent fiziksel taşıması.
    const closePlan = await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/lifecycle/close/plan`,
      headers: { cookie: managerACookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedCaseVersion: 1, expectedLocationVersion: 1, closeMode: 'normal' },
    })
    expect(closePlan.statusCode, closePlan.payload).toBe(201)
    const closeOp = caseLifecycleOperationResponseSchema.parse(closePlan.json()).operation
    expect(closeOp).toMatchObject({ status: 'approval_required', blockers: [] })
    expect((await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/lifecycle/close/${closeOp.id}/approve`,
      headers: { cookie: managerACookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedVersion: closeOp.version, approved: true },
    })).statusCode).toBe(202)
    expect((await runOnce(agentClient, agentConfig)).kind).toBe('reported')
    expect((await pool.query('SELECT lifecycle_status FROM cases WHERE id=$1', [caseId])).rows[0]).toEqual({ lifecycle_status: 'closed' })

    // 3) GERÇEK ÜCRET ADAYI + ONAY.
    const candidateAmountMinor = 512_000
    const candidateCreated = await app.inject({
      method: 'POST', url: CASE_FEE_CANDIDATES_ROUTE.replace(':caseId', caseId),
      headers: { cookie: managerACookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedCaseVersion: 2, candidateAmountMinor, sourceDocumentVersionId: expertReportVersionId, sourcePage: 1 },
    })
    expect(candidateCreated.statusCode, candidateCreated.payload).toBe(201)
    const candidateFee = closureFeeResponseSchema.parse(candidateCreated.json()).fee
    const approved = await app.inject({
      method: 'POST', url: FEE_APPROVE_ROUTE.replace(':feeId', candidateFee.id),
      headers: { cookie: accountingACookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedVersion: candidateFee.currentVersion.feeVersion, confirmed: true },
    })
    expect(approved.statusCode, approved.payload).toBe(200)

    // 4) YABANCI ORGANİZASYONUN GERÇEKTEN onaylı ücreti (karşılaştırma verisi).
    const foreign = await seedForeignApprovedFee()

    const period = new Date().toISOString().slice(0, 7)
    const reportUrl = `${CASE_SUMMARY_REPORT_ROUTE}?period=${period}`

    // 5) TENANT İZOLASYONU — org A kendi oturumuyla YALNIZ kendi verisini görür.
    const reportA = caseSummaryReportResponseSchema.parse((await app.inject({
      method: 'GET', url: reportUrl, headers: { cookie: adminACookie },
    })).json())
    expect(reportA.summary).toMatchObject({
      closedCaseCount: 1, approvedFeeCount: 1, approvedFeeTotalMinor: candidateAmountMinor, controlRequiredFeeCount: 0,
    })
    expect(reportA.pendingFees.some((item) => item.caseId === foreign.caseId)).toBe(false)
    expect(reportA.responsibleUsers.some((item) => item.name === managerBName)).toBe(false)
    expect(reportA.services.some((item) => item.name === serviceBName)).toBe(false)
    expect(JSON.stringify(reportA)).not.toContain(foreign.caseId)
    expect(JSON.stringify(reportA)).not.toContain(orgBId)

    // Org B KENDİ oturumuyla YALNIZ kendi verisini görür (daha önce hiç
    // kanıtlanmamış: yabancı organizasyonun kendi bakış açısı).
    const reportB = caseSummaryReportResponseSchema.parse((await app.inject({
      method: 'GET', url: reportUrl, headers: { cookie: adminBCookie },
    })).json())
    expect(reportB.summary).toMatchObject({
      closedCaseCount: 1, approvedFeeCount: 1, approvedFeeTotalMinor: foreign.approvedAmountMinor, controlRequiredFeeCount: 0,
    })
    expect(reportB.responsibleUsers).toEqual([{ id: expect.any(String), name: managerBName }])
    expect(reportB.services).toEqual([{ id: expect.any(String), name: serviceBName }])
    expect(reportB.pendingFees.some((item) => item.caseId === caseId)).toBe(false)
    expect(JSON.stringify(reportB)).not.toContain(caseId)
    expect(JSON.stringify(reportB)).not.toContain(orgAId)

    // 6) FİLTRE + TENANT — yabancı bir kullanıcı kimliği filtre olarak
    //    geçilse dahi organizasyon sınırının İÇİNDE kalır; sızıntı yerine
    //    GERÇEKTEN boş sonuç döner (hata da vermez).
    const crossOrgFilterAttempt = caseSummaryReportResponseSchema.parse((await app.inject({
      method: 'GET', url: `${reportUrl}&responsibleUserId=${managerAId}`, headers: { cookie: adminBCookie },
    })).json())
    expect(crossOrgFilterAttempt.summary).toMatchObject({ totalCaseCount: 0, closedCaseCount: 0, approvedFeeCount: 0 })

    // 7) ROL GÖRÜNÜRLÜĞÜ — bu uçta kasıtlı olarak rol kısıtı yoktur; secretary
    //    ve read_only GERÇEKTEN aynı mali toplamları görebilir.
    for (const roleCookie of [secretaryACookie, readOnlyACookie]) {
      const roleReport = caseSummaryReportResponseSchema.parse((await app.inject({
        method: 'GET', url: reportUrl, headers: { cookie: roleCookie },
      })).json())
      expect(roleReport.summary).toEqual(reportA.summary)
    }
    // Oturumsuz erişim kesin reddedilir.
    expect((await app.inject({ method: 'GET', url: reportUrl })).statusCode).toBe(401)
  }, 90_000)
})
