import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AUTH_LOGIN_ROUTE,
  caseVehicleOwnersResponseSchema,
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
const PASSWORD = 'p-inv-owners-sentetik-guclu-45'

describeDb('Dosya Envanteri — araç sahibi mini-yakalama gerçek API', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let organizationId: string
  let expertUserId: string
  let caseId: string
  let closedCaseId: string
  let foreignCaseId: string
  let expertCookie: string
  let secretaryCookie: string

  const ownersUrl = (targetCaseId = caseId) => `/api/v1/cases/${targetCaseId}/vehicle-owners`

  async function login(email: string): Promise<string> {
    const response = await app.inject({ method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email, password: PASSWORD } })
    expect(response.statusCode).toBe(200)
    return String(response.headers['set-cookie']).split(';')[0] as string
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })

    organizationId = uuidv7()
    const foreignOrganizationId = uuidv7()
    expertUserId = uuidv7()
    const secretaryUserId = uuidv7()
    const foreignUserId = uuidv7()
    caseId = uuidv7()
    closedCaseId = uuidv7()
    foreignCaseId = uuidv7()
    const passwordHash = await hashPassword(PASSWORD)
    await pool.query(
      `INSERT INTO organizations (id,code,name)
       VALUES ($1,'p-inv-owners-main','Inv Owners Sentetik'),($2,'p-inv-owners-foreign','Inv Owners Yabancı')`,
      [organizationId, foreignOrganizationId],
    )
    await pool.query(
      `INSERT INTO users (id,organization_id,email,display_name,password_hash)
       VALUES ($1,$4,'inv-owners-expert@test.local','Inv Owners Eksper',$6),
              ($2,$4,'inv-owners-secretary@test.local','Inv Owners Sekreter',$6),
              ($3,$5,'inv-owners-foreign@test.local','Inv Owners Yabancı',$6)`,
      [expertUserId, secretaryUserId, foreignUserId, organizationId, foreignOrganizationId, passwordHash],
    )
    await pool.query(
      `INSERT INTO user_roles (user_id,role_id)
       SELECT $1::uuid,id FROM roles WHERE code='expert'
       UNION ALL SELECT $2::uuid,id FROM roles WHERE code='secretary'`,
      [expertUserId, secretaryUserId],
    )
    await pool.query(
      `INSERT INTO cases
         (id,organization_id,office_year,office_sequence,office_number,case_type,
          lifecycle_status,workflow_stage,plate,plate_normalized,responsible_user_id,notification_date,version)
       VALUES
       ($1,$4,2026,4601,'2026/4601','traffic','open','reporting','34 IO 4601','34IO4601',$5,'2026-07-18',1),
       ($2,$4,2026,4602,'2026/4602','traffic','closed','closed','34 IO 4602','34IO4602',$5,'2026-07-18',1),
       ($3,$6,2026,4603,'2026/4603','traffic','open','reporting','35 IO 4603','35IO4603',$7,'2026-07-18',1)`,
      [caseId, closedCaseId, foreignCaseId, organizationId, expertUserId, foreignOrganizationId, foreignUserId],
    )

    app = buildApp({
      clock: fixedClock('2026-07-18T10:30:00.000Z'),
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 100, windowMs: 60_000 } },
    })
    expertCookie = await login('inv-owners-expert@test.local')
    secretaryCookie = await login('inv-owners-secretary@test.local')
  }, 90_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  it('401, tenant 404, sekreterlik yazma reddi ve boş liste durumunu uygular', async () => {
    expect((await app.inject({ method: 'GET', url: ownersUrl() })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: ownersUrl(foreignCaseId), headers: { cookie: expertCookie } })).statusCode).toBe(404)

    const empty = await app.inject({ method: 'GET', url: ownersUrl(), headers: { cookie: expertCookie } })
    expect(empty.statusCode).toBe(200)
    const workspace = caseVehicleOwnersResponseSchema.parse(empty.json())
    expect(workspace.setVersion).toBeNull()
    expect(workspace.owners).toEqual([])
    expect(workspace.permissions.canEdit).toBe(true)

    const secretaryRead = await app.inject({ method: 'GET', url: ownersUrl(), headers: { cookie: secretaryCookie } })
    expect(secretaryRead.statusCode).toBe(200)
    expect(caseVehicleOwnersResponseSchema.parse(secretaryRead.json()).permissions.canEdit).toBe(false)

    const secretaryWrite = await app.inject({
      method: 'PUT', url: ownersUrl(), headers: { cookie: secretaryCookie },
      payload: { owners: [{ name: 'Ahmet Yılmaz', phone: null }], expectedSetVersion: null, confirmed: true },
    })
    expect(secretaryWrite.statusCode).toBe(403)
  })

  it('listeyi oluşturur, sürüm çakışmasını reddeder ve tek seferde değiştirir', async () => {
    const created = await app.inject({
      method: 'PUT', url: ownersUrl(), headers: { cookie: expertCookie },
      payload: {
        owners: [{ name: 'Ahmet Yılmaz', phone: '05321234567' }, { name: 'Ayşe Yılmaz', phone: null }],
        expectedSetVersion: null,
        confirmed: true,
      },
    })
    expect(created.statusCode).toBe(200)
    const first = caseVehicleOwnersResponseSchema.parse(created.json())
    expect(first.setVersion).toBe(1)
    expect(first.owners).toEqual([
      { name: 'Ahmet Yılmaz', phone: '05321234567' },
      { name: 'Ayşe Yılmaz', phone: null },
    ])

    // Bayat sürümle yazılamaz.
    const stale = await app.inject({
      method: 'PUT', url: ownersUrl(), headers: { cookie: expertCookie },
      payload: { owners: [{ name: 'Tek Sahip', phone: null }], expectedSetVersion: null, confirmed: true },
    })
    expect(stale.statusCode).toBe(409)

    // Doğru sürümle liste tek seferde değişir (append-only: eski satırlar silinmez, yeni set_version yazılır).
    const replaced = await app.inject({
      method: 'PUT', url: ownersUrl(), headers: { cookie: expertCookie },
      payload: { owners: [{ name: 'Tek Sahip', phone: '0532 000 00 00' }], expectedSetVersion: 1, confirmed: true },
    })
    expect(replaced.statusCode).toBe(200)
    const second = caseVehicleOwnersResponseSchema.parse(replaced.json())
    expect(second.setVersion).toBe(2)
    expect(second.owners).toEqual([{ name: 'Tek Sahip', phone: '0532 000 00 00' }])

    const historyRows = await pool.query(
      'SELECT count(*)::int AS n FROM case_vehicle_owners WHERE organization_id=$1 AND case_id=$2',
      [organizationId, caseId],
    )
    expect(historyRows.rows).toEqual([{ n: 3 }]) // 2 (set 1) + 1 (set 2); append-only, hiçbiri silinmedi.
  })

  it('geçersiz girdiyi ve kapalı dosyayı reddeder', async () => {
    const tooLong = Array.from({ length: 7 }, (_, index) => ({ name: `Sahip ${index}`, phone: null }))
    const tooMany = await app.inject({
      method: 'PUT', url: ownersUrl(), headers: { cookie: expertCookie },
      payload: { owners: tooLong, expectedSetVersion: 2, confirmed: true },
    })
    expect(tooMany.statusCode).toBe(400)

    const badPhone = await app.inject({
      method: 'PUT', url: ownersUrl(), headers: { cookie: expertCookie },
      payload: { owners: [{ name: 'Kötü Telefon', phone: 'call-me' }], expectedSetVersion: 2, confirmed: true },
    })
    expect(badPhone.statusCode).toBe(400)

    const closed = await app.inject({
      method: 'PUT', url: ownersUrl(closedCaseId), headers: { cookie: expertCookie },
      payload: { owners: [{ name: 'Ahmet Yılmaz', phone: null }], expectedSetVersion: null, confirmed: true },
    })
    expect(closed.statusCode).toBe(409)
  })
})
