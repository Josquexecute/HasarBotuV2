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

/**
 * Paket 52 — `caseIds` filtresi, tenant sınırı ve 200 sınırı kaynaklı
 * yanlış negatif koruması.
 */
const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'p52-sentetik-guclu-parola-52'
const NOW = '2026-07-18T10:30:00.000Z'

const TRAFFIC_DOCUMENTS = [
  'victim_traffic_policy',
  'insured_traffic_policy',
  'sbm_heavy_damage_result',
  'victim_registration',
  'insured_registration',
  'victim_driver_license',
  'insured_driver_license',
  'accident_report',
]

describeDb('Paket 52 operasyonel uyarı dosya filtresi', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let organizationId: string
  let foreignOrganizationId: string
  let userId: string
  let foreignUserId: string
  let cookie: string
  let foreignCookie: string
  /** Uyarı üreten dosyalar; ofis sırasına göre. */
  const noisyCaseIds: string[] = []
  /** Yalnız düşük önemli uyarı üreten dosyalar; kırpılmış listeye giremezler. */
  const quietCaseIds: string[] = []
  let cleanCaseId: string
  let foreignCaseId: string
  let closedCaseId: string

  async function login(email: string): Promise<string> {
    const response = await app.inject({
      method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email, password: PASSWORD },
    })
    expect(response.statusCode).toBe(200)
    return String(response.headers['set-cookie']).split(';')[0] as string
  }

  async function read(
    sessionCookie: string,
    caseIds?: readonly string[],
  ): Promise<OperationalAlertsResponse> {
    const url = caseIds === undefined
      ? OPERATIONAL_ALERTS_ROUTE
      : `${OPERATIONAL_ALERTS_ROUTE}?caseIds=${caseIds.join(',')}`
    const response = await app.inject({ method: 'GET', url, headers: { cookie: sessionCookie } })
    expect(response.statusCode).toBe(200)
    return operationalAlertsResponseSchema.parse(response.json())
  }

  async function seedCase(input: {
    readonly organizationId: string
    readonly userId: string
    readonly sequence: number
    readonly followUpDate: string | null
    readonly lifecycleStatus?: 'open' | 'closed'
    readonly missingDocuments?: readonly string[]
    readonly overdueTaskTitle?: string
    readonly overdueTaskPriority?: 'low' | 'normal' | 'high'
  }): Promise<string> {
    const caseId = uuidv7()
    const status = input.lifecycleStatus ?? 'open'
    await pool.query(
      `INSERT INTO cases
       (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
        workflow_stage,plate,plate_normalized,responsible_user_id,follow_up_date,notification_date,version)
       VALUES ($1,$2,2026,$3,$4,'traffic',$5,$6,$7,$8,$9,$10,'2026-07-01',1)`,
      [
        caseId, input.organizationId, input.sequence, `2026/${input.sequence}`, status,
        status === 'closed' ? 'closed' : 'reporting',
        `34 PT ${input.sequence}`, `34PT${input.sequence}`, input.userId, input.followUpDate,
      ],
    )
    const missing = input.missingDocuments ?? []
    for (const type of TRAFFIC_DOCUMENTS) {
      if (missing.includes(type)) continue
      const documentId = uuidv7()
      const versionId = uuidv7()
      await pool.query(
        `INSERT INTO documents (id,organization_id,case_id,document_type,current_version_number,status)
         VALUES ($1,$2,$3,$4,1,'ready')`,
        [documentId, input.organizationId, caseId, type],
      )
      await pool.query(
        `INSERT INTO document_versions
         (id,organization_id,document_id,case_id,version_number,original_file_name,display_name,
          extension,mime_type,byte_size,content_hash,storage_root_key,relative_path,source_type,
          status,hash_verified,size_verified,verified_at,registered_by_user_id)
         VALUES ($1,$2,$3,$4,1,$5,$5,'pdf','application/pdf',128,$6,'synthetic-root',$7,'manual',
                 'ready',true,true,'2026-07-10T08:00:00Z',$8)`,
        [
          versionId, input.organizationId, documentId, caseId, `${type}.pdf`,
          'a'.repeat(64), `synthetic/${caseId}/${type}.pdf`, input.userId,
        ],
      )
      await pool.query('UPDATE documents SET current_version_id=$2 WHERE id=$1', [documentId, versionId])
    }
    if (input.overdueTaskTitle !== undefined) {
      await pool.query(
        `INSERT INTO case_tasks
         (id,organization_id,case_id,title,priority,status,assigned_user_id,due_date,created_by_user_id,version)
         VALUES ($1,$2,$3,$4,$6,'open',$5,'2026-07-12',$5,1)`,
        [
          uuidv7(), input.organizationId, caseId, input.overdueTaskTitle, input.userId,
          input.overdueTaskPriority ?? 'high',
        ],
      )
    }
    return caseId
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
       VALUES ($1,'p52-main','P52 Sentetik'),($2,'p52-foreign','P52 Yabancı')`,
      [organizationId, foreignOrganizationId],
    )
    await pool.query(
      `INSERT INTO users (id,organization_id,email,display_name,password_hash)
       VALUES ($1,$3,'p52-manager@test.local','P52 Dosya Sorumlusu',$5),
              ($2,$4,'p52-foreign@test.local','P52 Yabancı',$5)`,
      [userId, foreignUserId, organizationId, foreignOrganizationId, passwordHash],
    )
    await pool.query(
      `INSERT INTO user_roles (user_id,role_id)
       SELECT $1::uuid,id FROM roles WHERE code='case_manager'
       UNION ALL SELECT $2::uuid,id FROM roles WHERE code='case_manager'`,
      [userId, foreignUserId],
    )

    // 60 "gürültülü" dosya: her biri geciken görev + geçmiş takip + iki eksik evrak
    // üretir. Toplam uyarı sayısı 200 genel sınırını rahatça aşar.
    for (let index = 0; index < 60; index += 1) {
      noisyCaseIds.push(await seedCase({
        organizationId, userId, sequence: 5200 + index,
        followUpDate: '2026-07-10',
        missingDocuments: ['victim_traffic_policy', 'accident_report'],
        overdueTaskTitle: `Geciken görev ${index}`,
      }))
    }
    // "Sessiz" dosyalar: yalnız DÜŞÜK önemli geciken görev üretirler. Gürültülü
    // dosyalar 200 sınırını yüksek önemli uyarılarla doldurduğu için bu uyarılar
    // kırpılmış genel listeye HİÇ giremez — paketin uyardığı yanlış negatif.
    for (let index = 0; index < 3; index += 1) {
      quietCaseIds.push(await seedCase({
        organizationId, userId, sequence: 5300 + index, followUpDate: null,
        overdueTaskTitle: `Düşük öncelikli görev ${index}`, overdueTaskPriority: 'low',
      }))
    }
    cleanCaseId = await seedCase({
      organizationId, userId, sequence: 5400, followUpDate: '2026-08-01',
    })
    closedCaseId = await seedCase({
      organizationId, userId, sequence: 5401, followUpDate: '2026-07-01',
      lifecycleStatus: 'closed', missingDocuments: ['victim_traffic_policy'],
    })
    foreignCaseId = await seedCase({
      organizationId: foreignOrganizationId, userId: foreignUserId, sequence: 5500,
      followUpDate: '2026-07-05', missingDocuments: ['accident_report'],
      overdueTaskTitle: 'Yabancı geciken görev',
    })

    app = buildApp({
      clock: fixedClock(NOW),
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 100, windowMs: 60_000 } },
    })
    cookie = await login('p52-manager@test.local')
    foreignCookie = await login('p52-foreign@test.local')
  }, 240_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  it('filtresiz çağrı davranışı değişmez ve dosya özeti taşımaz', async () => {
    const result = await read(cookie)
    expect(result.alerts).toHaveLength(200)
    expect(result.totalCount).toBe(200)
    expect(result.caseSummaries).toBeUndefined()
  })

  it('genel liste 200 ile kırpıldığı için yanlış negatif üretir; filtreli çağrı üretmez', async () => {
    // Paketin gerekçesini sabitler: düşük önemli uyarıları olan dosyalar
    // kırpılmış genel listede HİÇ görünmez. Satır göstergesi bu listeden
    // okunsaydı "uyarı yok" derdi — yanlış negatif.
    const unfiltered = await read(cookie)
    const covered = new Set(unfiltered.alerts.map((alert) => alert.caseId))
    for (const caseId of quietCaseIds) {
      expect(covered.has(caseId)).toBe(false)
    }

    // Filtreli çağrı aynı dosyalar için gerçek uyarı sayısını verir.
    const filtered = await read(cookie, quietCaseIds)
    for (const summary of filtered.caseSummaries ?? []) {
      expect(summary).toMatchObject({
        totalCount: 1,
        byType: { overdue_task: 1, overdue_follow_up: 0, missing_required_document: 0 },
      })
    }
    expect(filtered.caseSummaries).toHaveLength(quietCaseIds.length)
  })

  it('filtreli çağrı istenen her erişilebilir dosya için özet döndürür', async () => {
    const requested = [noisyCaseIds[0], cleanCaseId]
    const result = await read(cookie, requested)
    const summaries = result.caseSummaries ?? []
    expect(summaries.map((item) => item.caseId).sort()).toEqual([...requested].sort())

    // Zabıt eksilince alternatif grup da açılır (KTT/Beyan/Tramer): kural
    // motorunun `missing` sonucu birebir yansıtılır, yeniden yorumlanmaz.
    const noisy = summaries.find((item) => item.caseId === noisyCaseIds[0])
    expect(noisy).toMatchObject({
      totalCount: 6,
      byType: { overdue_task: 1, overdue_follow_up: 1, missing_required_document: 4 },
    })
    // Uyarısı olmayan dosya sıfır sayaçla döner: "uyarı yok" ile "bilinmiyor" ayrışır.
    expect(summaries.find((item) => item.caseId === cleanCaseId)).toMatchObject({
      totalCount: 0,
      byType: { overdue_task: 0, overdue_follow_up: 0, missing_required_document: 0 },
    })
  })

  it('özet sayıları ile dönen uyarılar aynı filtreli çağrıda tutarlıdır', async () => {
    const requested = noisyCaseIds.slice(0, 5)
    const result = await read(cookie, requested)
    for (const summary of result.caseSummaries ?? []) {
      const actual = result.alerts.filter((alert) => alert.caseId === summary.caseId)
      expect(actual).toHaveLength(summary.totalCount)
    }
  })

  it('tenant sınırı istemciden gelen kimliklere güvenmez', async () => {
    // Yabancı organization'ın dosyası istenirse ne uyarı ne özet döner.
    const result = await read(cookie, [foreignCaseId, noisyCaseIds[0]])
    expect(result.alerts.some((alert) => alert.caseId === foreignCaseId)).toBe(false)
    const summaries = result.caseSummaries ?? []
    expect(summaries.map((item) => item.caseId)).toEqual([noisyCaseIds[0]])

    // Yabancı oturum da kendi dosyası dışına çıkamaz.
    const foreign = await read(foreignCookie, [noisyCaseIds[0], foreignCaseId])
    expect((foreign.caseSummaries ?? []).map((item) => item.caseId)).toEqual([foreignCaseId])
  })

  it('kapalı ve var olmayan dosya özete girmez', async () => {
    const missingCaseId = uuidv7()
    const result = await read(cookie, [closedCaseId, missingCaseId, noisyCaseIds[0]])
    expect((result.caseSummaries ?? []).map((item) => item.caseId)).toEqual([noisyCaseIds[0]])
  })

  it('geçersiz, mükerrer ve sınır aşan filtre 400 döner', async () => {
    const invalid = await app.inject({
      method: 'GET', url: `${OPERATIONAL_ALERTS_ROUTE}?caseIds=abc`, headers: { cookie },
    })
    expect(invalid.statusCode).toBe(400)

    const duplicated = await app.inject({
      method: 'GET',
      url: `${OPERATIONAL_ALERTS_ROUTE}?caseIds=${noisyCaseIds[0]},${noisyCaseIds[0]}`,
      headers: { cookie },
    })
    expect(duplicated.statusCode).toBe(400)

    const tooMany = Array.from(
      { length: 101 },
      (_unused, index) => `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
    )
    const overLimit = await app.inject({
      method: 'GET', url: `${OPERATIONAL_ALERTS_ROUTE}?caseIds=${tooMany.join(',')}`, headers: { cookie },
    })
    expect(overLimit.statusCode).toBe(400)
  })

  it('filtreli çağrı da oturum ister ve audit yazmaz', async () => {
    const anonymous = await app.inject({
      method: 'GET', url: `${OPERATIONAL_ALERTS_ROUTE}?caseIds=${noisyCaseIds[0]}`,
    })
    expect(anonymous.statusCode).toBe(401)

    const before = await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action NOT LIKE 'auth.%'")
    await read(cookie, [noisyCaseIds[0]])
    const after = await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action NOT LIKE 'auth.%'")
    expect(after.rows).toEqual(before.rows)
  })

  it('filtreli sonuç tekrarlı çağrılarda birebir aynıdır', async () => {
    const requested = noisyCaseIds.slice(0, 8)
    const first = await read(cookie, requested)
    const second = await read(cookie, requested)
    expect(second.caseSummaries).toEqual(first.caseSummaries)
    expect(second.alerts).toEqual(first.alerts)
  })
})
