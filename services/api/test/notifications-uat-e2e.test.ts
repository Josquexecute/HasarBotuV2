import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AUTH_LOGIN_ROUTE,
  CASES_ROUTE,
  CASE_DETAIL_ROUTE,
  CASE_TASKS_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  OPERATIONAL_ALERTS_ROUTE,
  caseDetailResponseSchema,
  caseTaskResponseSchema,
  operationalAlertsResponseSchema,
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

/**
 * UAT-tarzı uçtan uca doğrulama: Bildirimler için gerçek uyarı üretimi →
 * bildirim listesi → okunma/durum değişimi → ilgili dosyaya navigasyon →
 * tenant ve yetki izolasyonu zincirini, sentetik SQL ile onaylı sürüm enjekte
 * etmeden, yalnız gerçek command API'leriyle sürer.
 *
 * ÖNEMLİ BULGU: Bildirimler kalıcı bir gelen kutusu DEĞİLDİR (HB-2026-055,
 * 2026-07-18). Her `GET /api/v1/operational-alerts` çağrısında görev/takip/
 * evrak verisinden DETERMİNİSTİK olarak türetilir; ne bir bildirim tablosu,
 * ne arka plan işçisi, ne de okundu/durum alanı vardır. Bu test o kasıtlı
 * tasarımı hem KANITLAR (tekrarlanan çağrı yan etkisiz, şema `isRead`/`status`
 * taşımaz, yazma ucu YOKTUR) hem de mevcut `operational-alerts.test.ts` /
 * `operational-alerts-case-filter.test.ts` / `operational-alerts-scaling.test.ts`
 * (925+ satır, kural motoru detayları, 200 sınırı, N+1 koruması) üçlüsünün
 * TEKRARLAMADIĞI iki gerçek boşluğu kapatır:
 *
 * 1. Uyarılar SENTETİK SQL ile değil, gerçek `POST /cases` + gerçek
 *    `POST /cases/:caseId/tasks` command API'leriyle üretilir (yalnız hazır
 *    evrak satırları, PERT/İşçilik/Kasko UAT'larında zaten ayrıca kanıtlanmış
 *    File Agent doğrulama döngüsünü tekrarlamamak için SQL ile hazır kabul
 *    edilir).
 * 2. "İlgili dosyaya navigasyon" `caseDetailPath` düzenli ifadesini değil,
 *    gerçek `GET /api/v1/cases/:caseId` çağrısının dönen kaydını —
 *    plaka/ofis no eşleşmesini — doğrular. Ayrıca TÜM rollerin (admin,
 *    expert, case_manager, secretary, accounting, read_only) uyarı listesini
 *    okuyabildiği gerçek oturumlarla kanıtlanır (kasıtlı tasarım: bu uçta rol
 *    kısıtı yoktur, `auth/guard.ts` "ilk aşamada tüm aktif kullanıcılar tam
 *    yetkilidir" yorumuyla tutarlı).
 */

const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'uat-bildirim-sentetik-guclu-parola-27'
const NOW = '2026-07-27T09:00:00.000Z'

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

describeDb('Bildirimler uçtan uca UAT: gerçek uyarı üretimi → liste → yenileme → ilgili dosyaya navigasyon → tenant/yetki izolasyonu (gerçek PostgreSQL)', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let orgAId: string
  let orgBId: string
  let managerAId: string
  let managerACookie: string
  let managerBCookie: string
  let adminACookie: string
  let expertACookie: string
  let secretaryACookie: string
  let accountingACookie: string
  let readOnlyACookie: string

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
    const response = await app.inject({
      method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email, password: PASSWORD },
    })
    expect(response.statusCode).toBe(200)
    return String(response.headers['set-cookie']).split(';')[0] as string
  }

  async function seedDocument(
    targetOrganizationId: string, caseId: string, registeredBy: string, type: string,
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

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })

    orgAId = uuidv7()
    orgBId = uuidv7()
    await pool.query(
      "INSERT INTO organizations (id,code,name) VALUES ($1,'uat-bildirim-a','UAT Bildirimler A'),($2,'uat-bildirim-b','UAT Bildirimler B')",
      [orgAId, orgBId],
    )
    managerAId = await seedUser(orgAId, 'uat-bildirim-manager-a@test.local', 'case_manager')
    await seedUser(orgBId, 'uat-bildirim-manager-b@test.local', 'case_manager')
    await seedUser(orgAId, 'uat-bildirim-admin-a@test.local', 'admin')
    await seedUser(orgAId, 'uat-bildirim-expert-a@test.local', 'expert')
    await seedUser(orgAId, 'uat-bildirim-secretary-a@test.local', 'secretary')
    await seedUser(orgAId, 'uat-bildirim-accounting-a@test.local', 'accounting')
    await seedUser(orgAId, 'uat-bildirim-readonly-a@test.local', 'read_only')

    app = buildApp({
      clock: fixedClock(NOW),
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 500, windowMs: 60_000 } },
    })
    await app.ready()
    managerACookie = await login('uat-bildirim-manager-a@test.local')
    managerBCookie = await login('uat-bildirim-manager-b@test.local')
    adminACookie = await login('uat-bildirim-admin-a@test.local')
    expertACookie = await login('uat-bildirim-expert-a@test.local')
    secretaryACookie = await login('uat-bildirim-secretary-a@test.local')
    accountingACookie = await login('uat-bildirim-accounting-a@test.local')
    readOnlyACookie = await login('uat-bildirim-readonly-a@test.local')

  }, 60_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  it('gerçek uyarı üretimi, liste/yenileme, ilgili dosyaya navigasyon ve tenant/yetki izolasyonu zincirini tek akışta doğrular', async () => {
    // 1) GERÇEK CASE OLUŞTURMA (org A) — geçmiş takip tarihiyle overdue_follow_up
    //    uyarısı için gerçek zemin.
    const createdA = await app.inject({
      method: 'POST', url: CASES_ROUTE,
      headers: { cookie: managerACookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        caseType: 'traffic', plate: '34 BIL 0001', workflowStage: 'reporting',
        notificationDate: '2026-07-01', followUpDate: '2026-07-20',
      },
    })
    expect(createdA.statusCode, createdA.payload).toBe(201)
    const caseA = caseDetailResponseSchema.parse(createdA.json()).case

    // 2) GERÇEK GÖREV OLUŞTURMA — geçmiş bitiş tarihiyle overdue_task uyarısı.
    const createdTask = await app.inject({
      method: 'POST', url: CASE_TASKS_ROUTE.replace(':caseId', caseA.id),
      headers: { cookie: managerACookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { title: 'Ekspertiz raporunu tamamla', priority: 'high', dueDate: '2026-07-15' },
    })
    expect(createdTask.statusCode, createdTask.payload).toBe(201)
    const taskA = caseTaskResponseSchema.parse(createdTask.json()).task

    // 3) Eksik zorunlu evrak — tek tip eksik (sigortalı ruhsat). Belge kaydı
    //    kendisi bu senaryoda kapsam dışıdır (PERT/İşçilik/Kasko UAT'larında
    //    ayrıca kanıtlı File Agent doğrulama döngüsü); hazır evrak satırları
    //    doğrudan yazılır.
    for (const type of READY_TRAFFIC_DOCUMENTS) {
      if (type !== 'insured_registration') {
        await seedDocument(orgAId, caseA.id, managerAId, type)
      }
    }

    // Karşılaştırma organizasyonu (org B): kendi geçmiş takip tarihiyle ayrı bir case.
    const createdB = await app.inject({
      method: 'POST', url: CASES_ROUTE,
      headers: { cookie: managerBCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        caseType: 'traffic', plate: '35 BIL 0002', workflowStage: 'reporting',
        notificationDate: '2026-07-01', followUpDate: '2026-07-18',
      },
    })
    expect(createdB.statusCode, createdB.payload).toBe(201)
    const caseB = caseDetailResponseSchema.parse(createdB.json()).case

    // 4) BİLDİRİM LİSTESİ (org A görünümü) — gerçek türetilmiş uyarılar.
    const rawFirst = await app.inject({
      method: 'GET', url: OPERATIONAL_ALERTS_ROUTE, headers: { cookie: managerACookie },
    })
    expect(rawFirst.statusCode).toBe(200)
    const firstJson = rawFirst.json() as Record<string, unknown>
    const listA = operationalAlertsResponseSchema.parse(firstJson)

    const overdueTask = listA.alerts.find(
      (alert) => alert.type === 'overdue_task' && alert.caseId === caseA.id,
    )
    if (overdueTask === undefined) throw new Error('overdue_task alert not found')
    expect(overdueTask).toMatchObject({
      severity: 'high', plate: '34 BIL 0001', sourceDate: '2026-07-15',
      summary: `Süresi geçmiş görev: ${taskA.title}`, caseDetailPath: `/dosyalar/${caseA.id}`,
    })
    const overdueFollowUp = listA.alerts.find(
      (alert) => alert.type === 'overdue_follow_up' && alert.caseId === caseA.id,
    )
    expect(overdueFollowUp).toMatchObject({
      severity: 'medium', plate: '34 BIL 0001', sourceDate: '2026-07-20',
      caseDetailPath: `/dosyalar/${caseA.id}`,
    })
    const missingDocuments = listA.alerts.filter(
      (alert) => alert.type === 'missing_required_document' && alert.caseId === caseA.id,
    )
    expect(missingDocuments.length).toBeGreaterThan(0)
    expect(missingDocuments.every((alert) => alert.severity === 'high')).toBe(true)

    // Org A listesinde org B'nin case'i hiç görünmez (liste seviyesinde tenant izolasyonu).
    expect(listA.alerts.some((alert) => alert.caseId === caseB.id)).toBe(false)
    expect(listA.alerts.some((alert) => alert.plate === '35 BIL 0002')).toBe(false)

    // 5) OKUNMA/DURUM DEĞİŞİMİ — KASITLI OLARAK YOK: ham JSON'da isRead/status
    //    alanı bulunmaz ve tekrarlanan çağrı yan etkisiz/deterministiktir.
    for (const alert of firstJson.alerts as Record<string, unknown>[]) {
      expect(Object.keys(alert)).not.toContain('isRead')
      expect(Object.keys(alert)).not.toContain('status')
      expect(Object.keys(alert)).not.toContain('id')
    }
    const rawSecond = await app.inject({
      method: 'GET', url: OPERATIONAL_ALERTS_ROUTE, headers: { cookie: managerACookie },
    })
    const listASecond = operationalAlertsResponseSchema.parse(rawSecond.json())
    expect(listASecond.alerts).toEqual(listA.alerts)
    expect(listASecond.totalCount).toBe(listA.totalCount)
    // Görüntülemenin GERÇEKTEN yan etkisi yok: audit kaydı yazılmadı.
    const auditAfterRead = await pool.query(
      "SELECT count(*)::int AS n FROM audit_events WHERE organization_id=$1 AND action LIKE 'operational_alert%'",
      [orgAId],
    )
    expect(auditAfterRead.rows[0]).toEqual({ n: 0 })
    // Yazma/durum-değiştirme ucu hiç yoktur (kasıtlı tasarım doğrulaması).
    const mutateAttempt = await app.inject({
      method: 'PATCH', url: OPERATIONAL_ALERTS_ROUTE, headers: { cookie: managerACookie }, payload: {},
    })
    expect(mutateAttempt.statusCode).toBe(404)

    // 6) İLGİLİ DOSYAYA NAVİGASYON — caseDetailPath yalnız BİÇİM olarak değil,
    //    GERÇEK case kaydına çözülerek doğrulanır.
    expect(overdueTask.caseDetailPath).toBe(`/dosyalar/${caseA.id}`)
    const navigated = await app.inject({
      method: 'GET', url: CASE_DETAIL_ROUTE.replace(':caseId', caseA.id), headers: { cookie: managerACookie },
    })
    expect(navigated.statusCode).toBe(200)
    const navigatedCase = caseDetailResponseSchema.parse(navigated.json()).case
    expect(navigatedCase.id).toBe(caseA.id)
    expect(navigatedCase.plate).toBe(overdueTask.plate)
    expect(navigatedCase.officeCaseNumber).toBe(overdueTask.officeNumber)

    // Çapraz-org navigasyon: org B kullanıcısı org A'nın case'ine bildirimden
    // gitmeye çalışsa dahi (varsayımsal sızıntı senaryosu) gerçek uçta 404 alır.
    const crossNavigate = await app.inject({
      method: 'GET', url: CASE_DETAIL_ROUTE.replace(':caseId', caseA.id), headers: { cookie: managerBCookie },
    })
    expect(crossNavigate.statusCode).toBe(404)

    // 7) TENANT İZOLASYONU — org B görünümü yalnız kendi case'ini görür.
    const listB = operationalAlertsResponseSchema.parse((await app.inject({
      method: 'GET', url: OPERATIONAL_ALERTS_ROUTE, headers: { cookie: managerBCookie },
    })).json())
    expect(listB.alerts.every((alert) => alert.caseId === caseB.id)).toBe(true)
    expect(listB.alerts.some((alert) => alert.type === 'overdue_follow_up')).toBe(true)
    expect(listB.alerts.some((alert) => alert.caseId === caseA.id)).toBe(false)

    // 8) YETKİ İZOLASYONU — bu uçta kasıtlı olarak rol kısıtı yoktur
    //    (auth/guard.ts: "ilk aşamada tüm aktif kullanıcılar tam yetkilidir").
    //    Tüm gerçek roller kendi organizasyonunun uyarılarını okuyabilir.
    for (const roleCookie of [adminACookie, expertACookie, secretaryACookie, accountingACookie, readOnlyACookie]) {
      const roleResponse = await app.inject({
        method: 'GET', url: OPERATIONAL_ALERTS_ROUTE, headers: { cookie: roleCookie },
      })
      expect(roleResponse.statusCode).toBe(200)
      const roleList = operationalAlertsResponseSchema.parse(roleResponse.json())
      expect(roleList.alerts.some((alert) => alert.caseId === caseA.id)).toBe(true)
      expect(roleList.alerts.some((alert) => alert.caseId === caseB.id)).toBe(false)
    }
    // Oturumsuz erişim kesin reddedilir.
    const anonymous = await app.inject({ method: 'GET', url: OPERATIONAL_ALERTS_ROUTE })
    expect(anonymous.statusCode).toBe(401)
  }, 60_000)
})
