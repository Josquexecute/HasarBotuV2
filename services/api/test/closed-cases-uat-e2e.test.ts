import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AGENTS_ROUTE,
  AUTH_LOGIN_ROUTE,
  CASES_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  caseLifecycleOperationResponseSchema,
  caseListResponseSchema,
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

// HB-2026-175: bkz. case-lifecycle.test.ts'deki aynı sabitin açıklaması.
const ALWAYS_READY_FRESHNESS_GATE_PATH = fileURLToPath(new URL('./fixtures/always-ready-freshness-gate.mjs', import.meta.url))

/**
 * UAT-tarzı uçtan uca doğrulama: Kapanan Dosyalar için gerçek kapanış saga'sı
 * (plan → onay → gerçek Agent taşıması → finalize) → `GET /api/v1/cases?
 * status=closed|open` liste üyeliği → gerçek yeniden açma → tenant izolasyonu
 * → salt-okunur rol görünürlüğü zincirini, sentetik SQL ile onaylı sürüm
 * enjekte etmeden sürer.
 *
 * Mevcut `case-lifecycle.test.ts` (432 satır) kapanış/yeniden açma saga'sını
 * ve RBAC/tenant/stale-version reddini kapsamlıca kanıtlıyor ama HER ZAMAN
 * `cases` tablosunu DOĞRUDAN SQL ile okuyor — hiçbir yerde gerçek `GET
 * /api/v1/cases?status=closed` ucu bir gerçek saga sonrasında çağrılmıyor.
 * `cases-pagination.test.ts`'in `status=closed` testi de SQL ile doğrudan
 * kapalı seedlenmiş TEK organizasyonlu bir case kullanıyor; çapraz-org kapalı
 * liste izolasyonu hiç kanıtlanmamış. Bu test üç GERÇEK boşluğu kapatır:
 *
 * 1. Gerçek saga ile kapatılan bir case'in `?status=closed` listesinde
 *    GERÇEKTEN belirdiğini ve `?status=open` listesinden GERÇEKTEN
 *    kaybolduğunu — ardından gerçek yeniden açma sonrası TERSİNİN de
 *    gerçekleştiğini doğrudan liste ucuyla kanıtlar.
 * 2. Kapalı liste tenant izolasyonunu iki organizasyonlu gerçek veriyle
 *    kanıtlar (yabancı organizasyonun kapalı case'i asla sızmaz).
 * 3. Salt-okunur komut yetkisi olmayan bir rolün (secretary) kapalı listeyi
 *    GÖREBİLDİĞİNİ (`GET` yalnız `requireSession` ister) ama yeniden açma
 *    KOMUTUNU veremediğini (403) AYNI case üzerinde birlikte kanıtlar —
 *    mevcut testler bu ikisini hiç aynı akışta eşleştirmiyor.
 */

const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'uat-kapanan-sentetik-guclu-parola-27'
const ROOT_KEY = 'uat-kapanan-root'
const READY_DOCUMENT_TYPES = [
  'victim_traffic_policy', 'insured_traffic_policy', 'sbm_heavy_damage_result',
  'victim_registration', 'insured_registration', 'victim_driver_license', 'insured_driver_license',
  'accident_report', 'expert_report', 'preliminary_report',
] as const

describeDb('Kapanan Dosyalar uçtan uca UAT: gerçek kapanış/yeniden açma saga\'sı → liste üyeliği → tenant izolasyonu → rol görünürlüğü (gerçek PostgreSQL + sentetik filesystem)', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let orgAId: string
  let orgBId: string
  let adminAId: string
  let adminACookie: string
  let secretaryACookie: string
  let adminBCookie: string
  let root: string
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

  async function seedDocument(caseId: string, documentType: string): Promise<void> {
    const documentId = uuidv7()
    const versionId = uuidv7()
    await pool.query(
      'INSERT INTO documents (id,organization_id,case_id,document_type,status) VALUES ($1,$2,$3,$4,$5)',
      [documentId, orgAId, caseId, documentType, 'ready'],
    )
    await pool.query(
      `INSERT INTO document_versions
       (id,organization_id,document_id,case_id,version_number,original_file_name,display_name,mime_type,byte_size,
        content_hash,storage_root_key,relative_path,source_type,status,hash_verified,size_verified,verified_at)
       VALUES ($1,$2,$3,$4,1,$5,$5,'application/pdf',10,$6,$7,$8,'imported','ready',true,true,$9)`,
      [versionId, orgAId, documentId, caseId, `${documentType}.pdf`, 'a'.repeat(64), ROOT_KEY,
        `2026/Temmuz 2026/METADATA/EVRAK/${caseId}-${documentType}.pdf`, new Date('2026-07-14T10:00:00.000Z')],
    )
    await pool.query(
      'UPDATE documents SET current_version_id=$2,current_version_number=1,status=$3 WHERE id=$1',
      [documentId, versionId, 'ready'],
    )
  }

  async function seedPhoto(caseId: string): Promise<void> {
    await pool.query(
      `INSERT INTO photos
       (id,organization_id,case_id,original_file_name,display_name,mime_type,byte_size,content_hash,storage_root_key,
        relative_path,source_type,status,hash_verified,size_verified,verified_at)
       VALUES ($1,$2,$3,'onarim.jpg','Onarim','image/jpeg',10,$4,$5,$6,'imported','ready',true,true,$7)`,
      [uuidv7(), orgAId, caseId, 'b'.repeat(64), ROOT_KEY,
        `2026/Temmuz 2026/METADATA/ONARIM/${caseId}-onarim.jpg`, new Date('2026-07-14T10:00:00.000Z')],
    )
  }

  /** Trafik kapanışı `closure.traffic_value_loss` gereksinimi için onaylı bir Değer Kaybı sürümü ister. */
  async function seedApprovedValueLoss(caseId: string): Promise<void> {
    const assessmentId = uuidv7()
    const versionId = uuidv7()
    const reportId = uuidv7()
    await pool.query(
      'INSERT INTO traffic_value_loss_assessments (id,organization_id,case_id,created_by_user_id) VALUES ($1,$2,$3,$4)',
      [assessmentId, orgAId, caseId, adminAId],
    )
    await pool.query(
      `INSERT INTO traffic_value_loss_versions
       (id,organization_id,case_id,assessment_id,assessment_version,status,rule_set_id,rule_version,
        effective_from,evaluated_on,input_snapshot,result_snapshot,result_code,human_approval_status,
        approved_by_user_id,approved_at,is_active,created_by_user_id)
       VALUES ($1,$2,$3,$4,1,'approved','traffic-value-loss-market-difference','2026.07.01.1',
               '2026-07-01','2026-07-14','{}'::jsonb,$5::jsonb,'calculable','approved',$6,now(),true,$6)`,
      [versionId, orgAId, caseId, assessmentId, JSON.stringify({ faultAdjustedValueLossMinor: 245_000, canSubmitForApproval: true }), adminAId],
    )
    await pool.query('UPDATE traffic_value_loss_assessments SET current_version_id=$2 WHERE id=$1', [assessmentId, versionId])
    await pool.query(
      `INSERT INTO traffic_value_loss_reports
       (id,organization_id,case_id,assessment_id,assessment_version_id,assessment_version,
        schema_version,template_version,rule_version,content_snapshot,content_hash,pdf_hash,
        pdf_byte_size,generated_by_user_id)
       VALUES ($1,$2,$3,$4,$5,1,'traffic-value-loss-final-report/1.0.0',
               'traffic-value-loss-final-report-tr/1.0.0','2026.07.01.1',$6::jsonb,$7,$8,128,$9)`,
      [reportId, orgAId, caseId, assessmentId, versionId, JSON.stringify({
        schemaVersion: 'traffic-value-loss-final-report/1.0.0',
        templateVersion: 'traffic-value-loss-final-report-tr/1.0.0',
        assessment: { assessmentId, versionId, assessmentVersion: 1 },
        rule: { ruleVersion: '2026.07.01.1' },
        caseReference: { caseId, caseType: 'traffic' },
      }), 'c'.repeat(64), 'd'.repeat(64), adminAId],
    )
  }

  async function seedCaseA(plate: string): Promise<{ caseId: string; openPath: string }> {
    const response = await app.inject({
      method: 'POST', url: CASES_ROUTE,
      headers: { cookie: adminACookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { caseType: 'traffic', plate, workflowStage: 'ready_to_close', lossDate: '2026-07-13', notificationDate: '2026-07-14' },
    })
    expect(response.statusCode, response.payload).toBe(201)
    const body = response.json() as { case: { id: string } }
    const normalized = plate.replaceAll(' ', '')
    const openPath = `2026/Temmuz 2026/${normalized}`
    await pool.query(
      `INSERT INTO case_locations (id,organization_id,case_id,storage_root_key,relative_path,verification_status,source)
       VALUES ($1,$2,$3,$4,$5,'verified','system')`,
      [uuidv7(), orgAId, body.case.id, ROOT_KEY, openPath],
    )
    const absolute = join(root, ...openPath.split('/'))
    for (const directory of ['EVRAK', 'HASAR', 'OLAY YERİ', 'ONARIM', 'DEĞER KAYBI']) {
      await mkdir(join(absolute, directory), { recursive: true })
    }
    await writeFile(join(absolute, 'EVRAK', 'sentetik.txt'), 'sentetik-kapanan-uat', 'utf8')
    for (const type of READY_DOCUMENT_TYPES) await seedDocument(body.case.id, type)
    await seedPhoto(body.case.id)
    await seedApprovedValueLoss(body.case.id)
    return { caseId: body.case.id, openPath }
  }

  /** Yabancı organizasyonun ZATEN kapalı case'i: kapsam dışı saga'yı tekrarlamadan yalnız liste izolasyonu için karşılaştırma verisi. */
  async function seedForeignClosedCase(plate: string): Promise<string> {
    const caseId = uuidv7()
    await pool.query(
      `INSERT INTO cases
       (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
        workflow_stage,plate,plate_normalized,notification_date,closed_at,version)
       VALUES ($1,$2,2026,9001,'2026/9001','traffic','closed','closed',$3,$4,'2026-07-01',now(),1)`,
      [caseId, orgBId, plate, plate.replaceAll(' ', '')],
    )
    return caseId
  }

  async function listCases(status: 'open' | 'closed', cookie: string) {
    const response = await app.inject({ method: 'GET', url: `${CASES_ROUTE}?status=${status}`, headers: { cookie } })
    expect(response.statusCode, response.payload).toBe(200)
    return caseListResponseSchema.parse(response.json())
  }

  async function planClose(caseId: string, cookie = adminACookie) {
    return app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/lifecycle/close/plan`,
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedCaseVersion: 1, expectedLocationVersion: 1, closeMode: 'normal' },
    })
  }

  async function planReopen(caseId: string, expectedCaseVersion: number, expectedLocationVersion: number, cookie = adminACookie) {
    return app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/lifecycle/reopen/plan`,
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedCaseVersion, expectedLocationVersion, reason: 'UAT: yeniden inceleme gerekli', targetWorkflowStage: 'reporting' },
    })
  }

  async function approve(caseId: string, operation: { id: string; operationType: 'close' | 'reopen'; version: number }, cookie = adminACookie) {
    return app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/lifecycle/${operation.operationType}/${operation.id}/approve`,
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { approved: true, expectedVersion: operation.version },
    })
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })

    orgAId = uuidv7()
    orgBId = uuidv7()
    await pool.query(
      "INSERT INTO organizations (id,code,name) VALUES ($1,'uat-kapanan-a','UAT Kapanan A'),($2,'uat-kapanan-b','UAT Kapanan B')",
      [orgAId, orgBId],
    )
    adminAId = await seedUser(orgAId, 'uat-kapanan-admin-a@test.local', 'admin')
    await seedUser(orgAId, 'uat-kapanan-secretary-a@test.local', 'secretary')
    await seedUser(orgBId, 'uat-kapanan-admin-b@test.local', 'admin')
    await pool.query('INSERT INTO storage_roots (id,organization_id,root_key,label) VALUES ($1,$2,$3,$4)',
      [uuidv7(), orgAId, ROOT_KEY, 'UAT Kapanan Dosyalar'])

    app = buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false, loginRateLimit: { limit: 1000, windowMs: 60_000 } } })
    await app.ready()
    adminACookie = await login('uat-kapanan-admin-a@test.local')
    secretaryACookie = await login('uat-kapanan-secretary-a@test.local')
    adminBCookie = await login('uat-kapanan-admin-b@test.local')

    const registered = await app.inject({ method: 'POST', url: AGENTS_ROUTE, headers: { cookie: adminACookie }, payload: { name: 'UAT Kapanan Dosyalar Agent' } })
    expect(registered.statusCode).toBe(201)
    const agent = registered.json() as { agent: { id: string }; secret: string }
    root = await mkdtemp(join(tmpdir(), 'hb-uat-kapanan-'))
    agentConfig = {
      apiBaseUrl: '',
      agentId: agent.agent.id,
      agentSecret: agent.secret,
      roots: { [ROOT_KEY]: root },
      leaseSeconds: 120,
      pollIntervalMs: 1000,
      freshnessGate: {
        toolPath: ALWAYS_READY_FRESHNESS_GATE_PATH,
        pcloudLocalDatabasePath: 'unused-in-always-ready-stub.db',
        topLevelFolderName: 'unused',
        attestationStoreDirectory: 'unused-store',
      },
    }
    agentClient = createAgentApiClient({ baseUrl: '', agentId: agent.agent.id, secret: agent.secret, fetchImpl: injectFetch })
  }, 60_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
    if (root !== undefined) await rm(root, { recursive: true, force: true })
  })

  it('gerçek kapanış → liste üyeliği → tenant izolasyonu → rol görünürlüğü → gerçek yeniden açma → liste üyeliği zincirini tek akışta doğrular', async () => {
    // 1) GERÇEK CASE OLUŞTURMA + gerçek kapanış saga'sı (plan → onay → Agent taşıması).
    const seeded = await seedCaseA('34 KAP 0001')
    const planned = caseLifecycleOperationResponseSchema.parse((await planClose(seeded.caseId)).json()).operation
    expect(planned).toMatchObject({ operationType: 'close', status: 'approval_required', blockers: [] })
    expect((await approve(seeded.caseId, planned)).statusCode).toBe(202)
    expect((await runOnce(agentClient, agentConfig)).kind).toBe('reported')
    const closedRow = await pool.query('SELECT lifecycle_status,version FROM cases WHERE id=$1', [seeded.caseId])
    expect(closedRow.rows[0]).toMatchObject({ lifecycle_status: 'closed', version: 2 })

    // 2) LİSTE ÜYELİĞİ — gerçek `GET ?status=closed/open` (SQL değil).
    const closedListAfterClose = await listCases('closed', adminACookie)
    expect(closedListAfterClose.items.map((item) => item.id)).toContain(seeded.caseId)
    expect(closedListAfterClose.items.find((item) => item.id === seeded.caseId)).toMatchObject({ status: 'closed' })
    const openListAfterClose = await listCases('open', adminACookie)
    expect(openListAfterClose.items.some((item) => item.id === seeded.caseId)).toBe(false)

    // 3) TENANT İZOLASYONU — yabancı organizasyonun (zaten) kapalı case'i asla sızmaz.
    const foreignClosedCaseId = await seedForeignClosedCase('35 KAP 9001')
    const closedListOrgAAfterForeign = await listCases('closed', adminACookie)
    expect(closedListOrgAAfterForeign.items.some((item) => item.id === foreignClosedCaseId)).toBe(false)
    const closedListOrgB = await listCases('closed', adminBCookie)
    expect(closedListOrgB.items.map((item) => item.id)).toEqual([foreignClosedCaseId])
    expect(closedListOrgB.items.some((item) => item.id === seeded.caseId)).toBe(false)
    const crossOrgDetail = await app.inject({ method: 'GET', url: `${CASES_ROUTE}/${seeded.caseId}`, headers: { cookie: adminBCookie } })
    expect(crossOrgDetail.statusCode).toBe(404)

    // 4) ROL GÖRÜNÜRLÜĞÜ — komut yetkisi olmayan secretary kapalı listeyi
    //    GÖREBİLİR (yalnız requireSession) ama yeniden açma KOMUTUNU veremez (403).
    const closedListSecretary = await listCases('closed', secretaryACookie)
    expect(closedListSecretary.items.map((item) => item.id)).toContain(seeded.caseId)
    const secretaryReopenAttempt = await planReopen(seeded.caseId, 2, 2, secretaryACookie)
    expect(secretaryReopenAttempt.statusCode).toBe(403)
    // Başarısız komut denemesi gerçekten hiçbir kalıcı etki bırakmadı.
    expect((await pool.query('SELECT lifecycle_status,version FROM cases WHERE id=$1', [seeded.caseId])).rows[0])
      .toMatchObject({ lifecycle_status: 'closed', version: 2 })

    // 5) GERÇEK YENİDEN AÇMA — admin ile, aynı saga (plan → onay → Agent taşıması).
    const reopenPlan = caseLifecycleOperationResponseSchema.parse((await planReopen(seeded.caseId, 2, 2)).json()).operation
    expect(reopenPlan.destination.relativePath).toBe(seeded.openPath)
    expect((await approve(seeded.caseId, reopenPlan)).statusCode).toBe(202)
    expect((await runOnce(agentClient, agentConfig)).kind).toBe('reported')
    const reopenedRow = await pool.query('SELECT lifecycle_status,workflow_stage,version FROM cases WHERE id=$1', [seeded.caseId])
    expect(reopenedRow.rows[0]).toMatchObject({ lifecycle_status: 'open', workflow_stage: 'reporting', version: 3 })

    // 6) LİSTE ÜYELİĞİ TERSİ — yeniden açma sonrası gerçek liste ucu ile doğrulanır.
    const openListAfterReopen = await listCases('open', adminACookie)
    expect(openListAfterReopen.items.map((item) => item.id)).toContain(seeded.caseId)
    const closedListAfterReopen = await listCases('closed', adminACookie)
    expect(closedListAfterReopen.items.some((item) => item.id === seeded.caseId)).toBe(false)
    // Yabancı organizasyonun kapalı case'i bu akıştan hiç etkilenmedi.
    expect(closedListOrgB.items).toEqual((await listCases('closed', adminBCookie)).items)

    // 7) Audit zinciri eksiksiz ve çapraz-org/gizli veri sızıntısı yok.
    const actions = await pool.query(
      "SELECT action FROM audit_events WHERE resource_id IN (SELECT id::text FROM case_lifecycle_operations WHERE case_id=$1)",
      [seeded.caseId],
    )
    expect((actions.rows as { action: string }[]).map((row) => row.action)).toEqual(expect.arrayContaining([
      'case_lifecycle.close_planned', 'case_lifecycle.close_approved', 'case_lifecycle.closed',
      'case_lifecycle.reopen_planned', 'case_lifecycle.reopen_approved', 'case_lifecycle.reopened',
    ]))
    expect(JSON.stringify(actions.rows)).not.toContain(orgBId)
  }, 90_000)
})
