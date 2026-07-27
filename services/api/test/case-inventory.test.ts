import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { strFromU8, unzipSync } from 'fflate'
import {
  AUTH_LOGIN_ROUTE,
  CASE_INVENTORY_EXPORT_ROUTE,
  CASE_INVENTORY_PREVIEW_ROUTE,
  caseInventoryPreviewResponseSchema,
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
const PASSWORD = 'p-inv-export-sentetik-guclu-45'

describeDb('Dosya Envanteri — liste önizleme ve export gerçek API', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let organizationId: string
  let expertUserId: string
  let trafficCaseId: string
  let cascoCaseId: string
  let expertCookie: string
  let secretaryCookie: string

  async function login(email: string): Promise<string> {
    const response = await app.inject({ method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email, password: PASSWORD } })
    expect(response.statusCode).toBe(200)
    return String(response.headers['set-cookie']).split(';')[0] as string
  }

  function readSheetXml(bytes: Buffer): string {
    const unzipped = unzipSync(new Uint8Array(bytes))
    const sheet = unzipped['xl/worksheets/sheet1.xml']
    expect(sheet).toBeDefined()
    return strFromU8(sheet as Uint8Array)
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })

    organizationId = uuidv7()
    expertUserId = uuidv7()
    const secretaryUserId = uuidv7()
    const insurerId = uuidv7()
    const serviceCenterId = uuidv7()
    trafficCaseId = uuidv7()
    cascoCaseId = uuidv7()
    const passwordHash = await hashPassword(PASSWORD)

    await pool.query("INSERT INTO organizations (id,code,name) VALUES ($1,'p-inv-export','Inv Export Sentetik')", [organizationId])
    await pool.query(
      `INSERT INTO users (id,organization_id,email,display_name,password_hash)
       VALUES ($1,$3,'inv-export-expert@test.local','Inv Export Eksper',$4),
              ($2,$3,'inv-export-secretary@test.local','Inv Export Sekreter',$4)`,
      [expertUserId, secretaryUserId, organizationId, passwordHash],
    )
    await pool.query(
      "INSERT INTO user_roles (user_id,role_id) SELECT $1::uuid,id FROM roles WHERE code='expert' UNION ALL SELECT $2::uuid,id FROM roles WHERE code='secretary'",
      [expertUserId, secretaryUserId],
    )
    await pool.query("INSERT INTO insurers (id,organization_id,name) VALUES ($1,$2,'Envanter Sigorta')", [insurerId, organizationId])
    await pool.query(
      "INSERT INTO service_centers (id,organization_id,name,center_type,service_type,phone) VALUES ($1,$2,'Envanter Servis','yetkili','authorized','02121234567')",
      [serviceCenterId, organizationId],
    )
    await pool.query(
      `INSERT INTO cases
         (id,organization_id,office_year,office_sequence,office_number,case_type,
          lifecycle_status,workflow_stage,plate,plate_normalized,responsible_user_id,insurer_id,service_center_id,
          loss_date,notification_date,version)
       VALUES
       ($1,$3,2026,4701,'2026/4701','traffic','open','reporting','34 IE 4701','34IE4701',$4,$5,$6,'2026-07-10','2026-07-11',1),
       ($2,$3,2026,4702,'2026/4702','casco','closed','closed','34 IE 4702','34IE4702',$4,NULL,NULL,'2026-07-01','2026-07-02',1)`,
      [trafficCaseId, cascoCaseId, organizationId, expertUserId, insurerId, serviceCenterId],
    )
    await pool.query(
      `INSERT INTO case_vehicle_owners (id,organization_id,case_id,set_version,ordinal,name,phone,created_by_user_id)
       VALUES ($1,$2,$3,1,0,'Envanter Sahip','05321112233',$4)`,
      [uuidv7(), organizationId, trafficCaseId, expertUserId],
    )
    await pool.query(
      'INSERT INTO case_vehicle_owner_sets (organization_id,case_id,current_set_version,updated_by_user_id) VALUES ($1,$2,1,$3)',
      [organizationId, trafficCaseId, expertUserId],
    )

    app = buildApp({
      clock: fixedClock('2026-07-18T10:30:00.000Z'),
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 100, windowMs: 60_000 } },
    })
    expertCookie = await login('inv-export-expert@test.local')
    secretaryCookie = await login('inv-export-secretary@test.local')
  }, 90_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  it('401 döner; önizleme sayımı ve rol bazlı telefon görünürlüğünü doğru hesaplar', async () => {
    expect((await app.inject({ method: 'GET', url: CASE_INVENTORY_PREVIEW_ROUTE })).statusCode).toBe(401)

    const expertPreview = await app.inject({ method: 'GET', url: CASE_INVENTORY_PREVIEW_ROUTE, headers: { cookie: expertCookie } })
    expect(expertPreview.statusCode).toBe(200)
    const parsedExpert = caseInventoryPreviewResponseSchema.parse(expertPreview.json())
    expect(parsedExpert.totalCount).toBe(2)
    expect(parsedExpert.truncated).toBe(false)
    expect(parsedExpert.includesPhones).toBe(true)

    const secretaryPreview = await app.inject({ method: 'GET', url: CASE_INVENTORY_PREVIEW_ROUTE, headers: { cookie: secretaryCookie } })
    expect(caseInventoryPreviewResponseSchema.parse(secretaryPreview.json()).includesPhones).toBe(false)

    const filtered = await app.inject({
      method: 'GET', url: `${CASE_INVENTORY_PREVIEW_ROUTE}?caseType=casco`, headers: { cookie: expertCookie },
    })
    expect(caseInventoryPreviewResponseSchema.parse(filtered.json()).totalCount).toBe(1)
  })

  it('export gerçek .xlsx üretir; PII yalnız yetkili rolde görünür ve export audit\'e düşer', async () => {
    const expertExport = await app.inject({ method: 'GET', url: CASE_INVENTORY_EXPORT_ROUTE, headers: { cookie: expertCookie } })
    expect(expertExport.statusCode).toBe(200)
    expect(expertExport.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(String(expertExport.headers['content-disposition'])).toContain('Dosya_Envanteri_')
    const expertSheet = readSheetXml(expertExport.rawPayload)
    expect(expertSheet).toContain('2026/4701')
    expect(expertSheet).toContain('Envanter Sahip')
    expect(expertSheet).toContain('05321112233')
    expect(expertSheet).toContain('02121234567')
    // Eksper raporu numarası hiçbir tabloda yok; tahmin edilmez, dürüstlükle "Eksik" kalır.
    expect(expertSheet).toContain('Eksik')

    const secretaryExport = await app.inject({ method: 'GET', url: CASE_INVENTORY_EXPORT_ROUTE, headers: { cookie: secretaryCookie } })
    expect(secretaryExport.statusCode).toBe(200)
    const secretarySheet = readSheetXml(secretaryExport.rawPayload)
    expect(secretarySheet).toContain('Envanter Sahip') // isim ayrı yetki, kalır
    expect(secretarySheet).not.toContain('05321112233')
    expect(secretarySheet).not.toContain('02121234567')

    const auditRows = await pool.query(
      "SELECT details FROM audit_events WHERE organization_id=$1 AND action='case_inventory.exported' ORDER BY occurred_at",
      [organizationId],
    )
    expect(auditRows.rows).toHaveLength(2)
    const first = (auditRows.rows[0] as { details: { rowCount: number; includesPhones: boolean } }).details
    expect(first.rowCount).toBe(2)
    expect(first.includesPhones).toBe(true)
    expect(JSON.stringify(auditRows.rows)).not.toContain('05321112233')
  })
})
