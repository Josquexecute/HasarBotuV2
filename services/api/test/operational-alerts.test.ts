import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AUTH_LOGIN_ROUTE,
  OPERATIONAL_ALERTS_ROUTE,
  operationalAlertsResponseSchema,
  type OperationalAlertsResponse,
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
const PASSWORD = 'p49-sentetik-guclu-parola-49'
const NOW = '2026-07-18T10:30:00.000Z'

/** Trafik dosyası için zorunlu evrak kümesi; eksiltilerek eksik evrak üretilir. */
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

describeDb('Paket 49 operasyonel uyarılar gerçek API', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let organizationId: string
  let foreignOrganizationId: string
  let userId: string
  let foreignUserId: string
  let cookie: string
  let foreignCookie: string
  const caseIds: Record<string, string> = {}

  async function login(email: string): Promise<string> {
    const response = await app.inject({
      method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email, password: PASSWORD },
    })
    expect(response.statusCode).toBe(200)
    return String(response.headers['set-cookie']).split(';')[0] as string
  }

  async function read(sessionCookie: string): Promise<OperationalAlertsResponse> {
    const response = await app.inject({
      method: 'GET', url: OPERATIONAL_ALERTS_ROUTE, headers: { cookie: sessionCookie },
    })
    expect(response.statusCode).toBe(200)
    return operationalAlertsResponseSchema.parse(response.json())
  }

  async function seedCase(input: {
    readonly organizationId: string
    readonly responsibleUserId: string
    readonly sequence: number
    readonly plate: string
    readonly followUpDate: string | null
    readonly lifecycleStatus?: 'open' | 'closed'
  }): Promise<string> {
    const caseId = uuidv7()
    await pool.query(
      `INSERT INTO cases
       (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
        workflow_stage,plate,plate_normalized,responsible_user_id,follow_up_date,notification_date,version)
       VALUES ($1,$2,2026,$3,$4,'traffic',$8,$10,$5,$6,$7,$9,'2026-07-01',1)`,
      [
        caseId, input.organizationId, input.sequence, `2026/${input.sequence}`,
        input.plate, input.plate.replace(/[^A-Z0-9]/g, ''), input.responsibleUserId,
        input.lifecycleStatus ?? 'open', input.followUpDate,
        // cases_lifecycle_stage_consistent: kapalı dosya yalnız 'closed' aşamasında olabilir.
        (input.lifecycleStatus ?? 'open') === 'closed' ? 'closed' : 'reporting',
      ],
    )
    return caseId
  }

  async function seedDocument(
    targetOrganizationId: string,
    caseId: string,
    registeredBy: string,
    type: string,
  ): Promise<void> {
    const documentId = uuidv7()
    const versionId = uuidv7()
    await pool.query(
      `INSERT INTO documents (id,organization_id,case_id,document_type,current_version_number,status)
       VALUES ($1,$2,$3,$4,1,'ready')`,
      [documentId, targetOrganizationId, caseId, type],
    )
    await pool.query(
      `INSERT INTO document_versions
       (id,organization_id,document_id,case_id,version_number,original_file_name,display_name,
        extension,mime_type,byte_size,content_hash,storage_root_key,relative_path,source_type,
        status,hash_verified,size_verified,verified_at,registered_by_user_id)
       VALUES ($1,$2,$3,$4,1,$5,$5,'pdf','application/pdf',128,$6,'synthetic-root',$7,'manual',
               'ready',true,true,'2026-07-10T08:00:00Z',$8)`,
      [
        versionId, targetOrganizationId, documentId, caseId, `${type}.pdf`,
        'a'.repeat(64), `synthetic/${caseId}/${type}.pdf`, registeredBy,
      ],
    )
    await pool.query('UPDATE documents SET current_version_id=$2 WHERE id=$1', [documentId, versionId])
  }

  async function seedCompleteDocuments(
    targetOrganizationId: string,
    caseId: string,
    registeredBy: string,
    except: readonly string[] = [],
  ): Promise<void> {
    for (const type of READY_TRAFFIC_DOCUMENTS) {
      if (!except.includes(type)) await seedDocument(targetOrganizationId, caseId, registeredBy, type)
    }
  }

  async function seedTask(input: {
    readonly caseId: string
    readonly title: string
    readonly priority: 'low' | 'normal' | 'high'
    readonly dueDate: string
    readonly status?: 'open' | 'completed'
    readonly organizationId?: string
    readonly userId?: string
  }): Promise<string> {
    const taskId = uuidv7()
    const org = input.organizationId ?? organizationId
    const owner = input.userId ?? userId
    const status = input.status ?? 'open'
    // `completed` satırı çözüm alanlarını zorunlu kılar (case_tasks_resolution_valid).
    await pool.query(
      `INSERT INTO case_tasks
       (id,organization_id,case_id,title,priority,status,assigned_user_id,due_date,created_by_user_id,
        resolution_note,resolved_by_user_id,resolved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$7,$9,$10,$11)`,
      [
        taskId, org, input.caseId, input.title, input.priority, status, owner, input.dueDate,
        status === 'open' ? null : 'Sentetik çözüm notu',
        status === 'open' ? null : owner,
        status === 'open' ? null : '2026-07-06T09:00:00Z',
      ],
    )
    return taskId
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })

    organizationId = uuidv7()
    foreignOrganizationId = uuidv7()
    userId = uuidv7()
    foreignUserId = uuidv7()
    const passwordHash = await hashPassword(PASSWORD)
    await pool.query(
      `INSERT INTO organizations (id,code,name)
       VALUES ($1,'p49-main','P49 Sentetik'),($2,'p49-foreign','P49 Yabancı')`,
      [organizationId, foreignOrganizationId],
    )
    await pool.query(
      `INSERT INTO users (id,organization_id,email,display_name,password_hash)
       VALUES ($1,$3,'p49-manager@test.local','P49 Dosya Sorumlusu',$5),
              ($2,$4,'p49-foreign@test.local','P49 Yabancı',$5)`,
      [userId, foreignUserId, organizationId, foreignOrganizationId, passwordHash],
    )
    await pool.query(
      `INSERT INTO user_roles (user_id,role_id)
       SELECT $1::uuid,id FROM roles WHERE code='case_manager'
       UNION ALL SELECT $2::uuid,id FROM roles WHERE code='case_manager'`,
      [userId, foreignUserId],
    )

    // Temiz dosya: evrak tam, takip geleceğe ait, süresi geçmiş görev yok.
    caseIds.clean = await seedCase({
      organizationId, responsibleUserId: userId, sequence: 4901,
      plate: '34 P 4901', followUpDate: '2026-08-01',
    })
    await seedCompleteDocuments(organizationId, caseIds.clean, userId)
    await seedTask({ caseId: caseIds.clean, title: 'Yaklaşan görev', priority: 'high', dueDate: '2026-07-25' })

    // Geciken görev + geçmiş takip tarihi; evrak tam.
    caseIds.overdue = await seedCase({
      organizationId, responsibleUserId: userId, sequence: 4902,
      plate: '34 P 4902', followUpDate: '2026-07-10',
    })
    await seedCompleteDocuments(organizationId, caseIds.overdue, userId)
    await seedTask({ caseId: caseIds.overdue, title: 'Servisten onay al', priority: 'high', dueDate: '2026-07-12' })
    await seedTask({ caseId: caseIds.overdue, title: 'Tamamlanmış görev', priority: 'high', dueDate: '2026-07-05', status: 'completed' })

    // Eksik zorunlu evrak (iki kod).
    caseIds.missingDocuments = await seedCase({
      organizationId, responsibleUserId: userId, sequence: 4903,
      plate: '34 P 4903', followUpDate: null,
    })
    await seedCompleteDocuments(organizationId, caseIds.missingDocuments, userId, [
      'victim_traffic_policy', 'accident_report',
    ])

    // Kapalı dosya: uyarı üretmemelidir.
    caseIds.closed = await seedCase({
      organizationId, responsibleUserId: userId, sequence: 4904,
      plate: '34 P 4904', followUpDate: '2026-07-01', lifecycleStatus: 'closed',
    })
    await seedCompleteDocuments(organizationId, caseIds.closed, userId, ['victim_traffic_policy'])
    await seedTask({ caseId: caseIds.closed, title: 'Kapalı dosya görevi', priority: 'high', dueDate: '2026-07-02' })

    // Başka organization: tenant sızıntısı testi.
    caseIds.foreign = await seedCase({
      organizationId: foreignOrganizationId, responsibleUserId: foreignUserId, sequence: 4905,
      plate: '35 P 4905', followUpDate: '2026-07-05',
    })
    await seedCompleteDocuments(foreignOrganizationId, caseIds.foreign, foreignUserId, ['accident_report'])
    await seedTask({
      caseId: caseIds.foreign, title: 'Yabancı görev', priority: 'high', dueDate: '2026-07-03',
      organizationId: foreignOrganizationId, userId: foreignUserId,
    })

    app = buildApp({
      clock: fixedClock(NOW),
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 100, windowMs: 60_000 } },
    })
    cookie = await login('p49-manager@test.local')
    foreignCookie = await login('p49-foreign@test.local')
  }, 120_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  it('oturumsuz erişimi reddeder', async () => {
    expect((await app.inject({ method: 'GET', url: OPERATIONAL_ALERTS_ROUTE })).statusCode).toBe(401)
  })

  it('salt okunur çağrı audit kaydı yazmaz', async () => {
    const before = await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action NOT LIKE 'auth.%'")
    await read(cookie)
    const after = await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action NOT LIKE 'auth.%'")
    expect(after.rows).toEqual(before.rows)
  })

  it('süresi geçmiş görev ve takip için uyarı üretir', async () => {
    const result = await read(cookie)
    const task = result.alerts.find((alert) => alert.type === 'overdue_task')
    expect(task).toMatchObject({
      severity: 'high',
      caseId: caseIds.overdue,
      plate: '34 P 4902',
      officeNumber: '2026/4902',
      summary: 'Süresi geçmiş görev: Servisten onay al',
      sourceDate: '2026-07-12',
      caseDetailPath: `/dosyalar/${caseIds.overdue}`,
    })
    expect(result.alerts.find((alert) => alert.type === 'overdue_follow_up')).toMatchObject({
      caseId: caseIds.overdue,
      severity: 'medium',
      sourceDate: '2026-07-10',
    })
  })

  it('eksik zorunlu evrakları mevcut belge kurallarından türetir', async () => {
    const result = await read(cookie)
    const missing = result.alerts.filter((alert) => alert.type === 'missing_required_document')
    expect(missing.every((alert) => alert.caseId === caseIds.missingDocuments)).toBe(true)
    // Zabıt kaldırılınca alternatif grup (zabıt / KTT / beyan / Tramer) da açılır:
    // uyarılar kural motorunun `missing` sonucunu birebir yansıtır, yeniden yorumlamaz.
    expect(missing.map((alert) => alert.summary).sort()).toEqual([
      'Eksik zorunlu evrak: Beyan',
      'Eksik zorunlu evrak: Kaza Tespit Tutanağı',
      'Eksik zorunlu evrak: Mağdur trafik poliçesi',
      'Eksik zorunlu evrak: Tramer sonucu',
    ])
    expect(missing.every((alert) => alert.severity === 'high')).toBe(true)
  })

  it('temiz, kapalı ve tamamlanmış kayıtlar için uyarı üretmez', async () => {
    const result = await read(cookie)
    expect(result.alerts.some((alert) => alert.caseId === caseIds.clean)).toBe(false)
    expect(result.alerts.some((alert) => alert.caseId === caseIds.closed)).toBe(false)
    expect(result.alerts.some((alert) => alert.summary.includes('Tamamlanmış görev'))).toBe(false)
  })

  it('tenant sınırını uygular; başka organization uyarısı görünmez', async () => {
    const own = await read(cookie)
    expect(own.alerts.some((alert) => alert.caseId === caseIds.foreign)).toBe(false)
    expect(own.alerts.some((alert) => alert.plate === '35 P 4905')).toBe(false)

    const foreign = await read(foreignCookie)
    expect(foreign.alerts.every((alert) => alert.caseId === caseIds.foreign)).toBe(true)
    expect(foreign.alerts.some((alert) => alert.summary === 'Süresi geçmiş görev: Yabancı görev')).toBe(true)
  })

  it('aynı dosya ve aynı sebep için mükerrer uyarı üretmez', async () => {
    const result = await read(cookie)
    const keys = result.alerts.map((alert) => alert.dedupeKey)
    expect(new Set(keys).size).toBe(keys.length)
    const followUps = result.alerts.filter(
      (alert) => alert.type === 'overdue_follow_up' && alert.caseId === caseIds.overdue,
    )
    expect(followUps).toHaveLength(1)
  })

  it('sayaç gerçek uyarı sayısına eşittir ve sonuç deterministiktir', async () => {
    const first = await read(cookie)
    const second = await read(cookie)
    expect(first.totalCount).toBe(first.alerts.length)
    expect(second.alerts).toEqual(first.alerts)
    expect(first.evaluatedAt).toBe(NOW)
  })

  it('serbest not ve belge içeriği uyarı gövdesine veya audit kaydına sızmaz', async () => {
    const noteId = uuidv7()
    await pool.query(
      `INSERT INTO case_notes (id,organization_id,case_id,note_type,body,created_by_user_id)
       VALUES ($1,$2,$3,'internal',$4,$5)`,
      [noteId, organizationId, caseIds.overdue, 'GIZLI-SERBEST-NOT-49', userId],
    )
    const result = await read(cookie)
    expect(JSON.stringify(result)).not.toContain('GIZLI-SERBEST-NOT-49')
    const audit = await pool.query(
      "SELECT count(*)::int AS n FROM audit_events WHERE details::text LIKE '%GIZLI-SERBEST-NOT-49%'",
    )
    expect(audit.rows[0].n).toBe(0)
  })

  it('uyarısı olmayan organization için gerçek boş sonuç döner', async () => {
    const emptyOrganizationId = uuidv7()
    const emptyUserId = uuidv7()
    await pool.query(
      "INSERT INTO organizations (id,code,name) VALUES ($1,'p49-empty','P49 Boş')",
      [emptyOrganizationId],
    )
    await pool.query(
      `INSERT INTO users (id,organization_id,email,display_name,password_hash)
       VALUES ($1,$2,'p49-empty@test.local','P49 Boş Kullanıcı',$3)`,
      [emptyUserId, emptyOrganizationId, await hashPassword(PASSWORD)],
    )
    await pool.query(
      "INSERT INTO user_roles (user_id,role_id) SELECT $1::uuid,id FROM roles WHERE code='case_manager'",
      [emptyUserId],
    )
    const emptyCookie = await login('p49-empty@test.local')
    const result = await read(emptyCookie)
    expect(result.alerts).toEqual([])
    expect(result.totalCount).toBe(0)
  })
})
