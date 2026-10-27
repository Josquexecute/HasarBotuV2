import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AUTH_LOGIN_ROUTE,
  caseVehicleProfileResponseSchema,
} from '@hasarbotu/contracts'
import {
  assertTestDatabaseUrl,
  closeDatabasePool,
  createDatabasePool,
  runMigrations,
  uuidv7,
  type DatabaseConfig,
} from '@hasarbotu/database'
import {
  buildApp,
  fixedClock,
  hashPassword,
} from '../src/index.js'

/** Araç profili: sürümleme, doğrulama ve tenant sınırı regresyonları. */
const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'p56-sentetik-guclu-parola-56'
const NOW = '2026-07-18T10:30:00.000Z'

describeDb('Araç profili API', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let organizationId: string
  let foreignOrganizationId: string
  let userId: string
  let foreignUserId: string
  let caseId: string
  let foreignCaseId: string
  let cookie: string
  let foreignCookie: string

  const VEHICLE_FIELDS = {
    brand: 'Renault',
    model: 'Clio',
    modelYear: 2021,
    variant: 'Touch',
    vehicleClass: 'passenger_car' as const,
    chassisPrefix: 'VF1RJA00',
    engineCode: 'H4B',
    evidenceSource: 'registration_document' as const,
    evidenceReference: 'Ruhsat 2026/44',
  }

  async function login(email: string): Promise<string> {
    const response = await app.inject({
      method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email, password: PASSWORD },
    })
    expect(response.statusCode).toBe(200)
    return String(response.headers['set-cookie']).split(';')[0] as string
  }

  async function saveVehicle(
    sessionCookie: string,
    targetCaseId: string,
    fields: Record<string, unknown> = VEHICLE_FIELDS,
    expectedVersion: number | null = null,
    reason: string | null = null,
  ) {
    return app.inject({
      method: 'PUT', url: `/api/v1/cases/${targetCaseId}/vehicle-profile`,
      headers: { cookie: sessionCookie },
      payload: { fields, expectedVersion, reason, confirmed: true },
    })
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
    caseId = uuidv7()
    foreignCaseId = uuidv7()
    const passwordHash = await hashPassword(PASSWORD)
    await pool.query(
      `INSERT INTO organizations (id,code,name)
       VALUES ($1,'p56-main','P56 Sentetik'),($2,'p56-foreign','P56 Yabancı')`,
      [organizationId, foreignOrganizationId],
    )
    await pool.query(
      `INSERT INTO users (id,organization_id,email,display_name,password_hash)
       VALUES ($1,$3,'p56-manager@test.local','P56 Sorumlu',$5),
              ($2,$4,'p56-foreign@test.local','P56 Yabancı',$5)`,
      [userId, foreignUserId, organizationId, foreignOrganizationId, passwordHash],
    )
    await pool.query(
      `INSERT INTO user_roles (user_id,role_id)
       SELECT $1::uuid,id FROM roles WHERE code='case_manager'
       UNION ALL SELECT $2::uuid,id FROM roles WHERE code='case_manager'`,
      [userId, foreignUserId],
    )
    await pool.query(
      `INSERT INTO cases
         (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
          workflow_stage,plate,plate_normalized,responsible_user_id,notification_date,version)
       VALUES ($1,$3,2026,5601,'2026/5601','traffic','open','reporting','34 PC 5601','34PC5601',$5,'2026-07-01',1),
              ($2,$4,2026,5602,'2026/5602','traffic','open','reporting','35 PC 5602','35PC5602',$6,'2026-07-01',1)`,
      [caseId, foreignCaseId, organizationId, foreignOrganizationId, userId, foreignUserId],
    )

    app = buildApp({
      clock: fixedClock(NOW),
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 200, windowMs: 60_000 } },
    })
    cookie = await login('p56-manager@test.local')
    foreignCookie = await login('p56-foreign@test.local')
  }, 240_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  it('araç profili yoksa boş yanıt döner', async () => {
    const response = await app.inject({
      method: 'GET', url: `/api/v1/cases/${caseId}/vehicle-profile`, headers: { cookie },
    })
    expect(response.statusCode).toBe(200)
    const profile = caseVehicleProfileResponseSchema.parse(response.json())
    expect(profile.current).toBeNull()
    expect(profile.profileId).toBeNull()
  })

  it('araç profilini sürümlü kaydeder ve geçmiş tutar', async () => {
    const created = await saveVehicle(cookie, caseId)
    expect(created.statusCode).toBe(200)
    const first = caseVehicleProfileResponseSchema.parse(created.json())
    expect(first.version).toBe(1)
    expect(first.current?.brand).toBe('Renault')
    expect(first.current?.chassisPrefix).toBe('VF1RJA00')

    const revised = await saveVehicle(
      cookie, caseId, { ...VEHICLE_FIELDS, variant: 'Icon' }, 1, 'Ruhsattan düzeltildi',
    )
    expect(revised.statusCode).toBe(200)
    const second = caseVehicleProfileResponseSchema.parse(revised.json())
    expect(second.version).toBe(2)
    expect(second.current?.variant).toBe('Icon')
    expect(second.history).toHaveLength(2)
    // Eski sürüm değişmeden korunur.
    expect(second.history.find((item) => item.profileVersion === 1)?.variant).toBe('Touch')
  })

  it('stale sürümde çakışma döner ve gerekçe zorunludur', async () => {
    const stale = await saveVehicle(cookie, caseId, VEHICLE_FIELDS, 1, 'Tekrar')
    expect(stale.statusCode).toBe(409)
    const missingReason = await saveVehicle(cookie, caseId, VEHICLE_FIELDS, 2, null)
    expect(missingReason.statusCode).toBe(400)
  })

  it('tam şasi numarası reddedilir', async () => {
    const response = await saveVehicle(
      cookie, caseId, { ...VEHICLE_FIELDS, chassisPrefix: 'VF1RJA00567123456' }, 2, 'Deneme',
    )
    expect(response.statusCode).toBe(400)
  })

  it('tenant sınırı korunur', async () => {
    const read = await app.inject({
      method: 'GET', url: `/api/v1/cases/${caseId}/vehicle-profile`, headers: { cookie: foreignCookie },
    })
    expect(read.statusCode).toBe(404)
    const write = await saveVehicle(foreignCookie, caseId, VEHICLE_FIELDS, 2, 'Deneme')
    expect(write.statusCode).toBe(404)
  })

  it('persists transmission through case creation, profile saves and case edits with tenant isolation and immutable history', async () => {
    const create = await app.inject({ method: 'POST', url: '/api/v1/cases', headers: { cookie, 'idempotency-key': uuidv7() },
      payload: { caseType: 'traffic', plate: '34 TR 572', transmission: 'manual' } })
    expect(create.statusCode).toBe(201)
    const created = create.json().case
    expect(created.transmission).toBe('manual')
    const empty = await app.inject({ method: 'GET', url: `/api/v1/cases/${created.id}/vehicle-profile`, headers: { cookie } })
    expect(empty.json()).toMatchObject({ transmission: 'manual', current: null })
    const profile = await saveVehicle(cookie, created.id)
    expect(profile.statusCode).toBe(200)
    expect(profile.json().current.transmission).toBe('manual')
    const automatic = await saveVehicle(cookie, created.id, { ...VEHICLE_FIELDS, transmission: 'automatic' }, 1, 'Ruhsat doğrulaması')
    expect(automatic.statusCode).toBe(200)
    expect(automatic.json().current.transmission).toBe('automatic')
    const reloaded = await app.inject({ method: 'GET', url: `/api/v1/cases/${created.id}`, headers: { cookie } })
    expect(reloaded.json().case.transmission).toBe('automatic')
    // A profile change also advances the case version, preventing stale case editors from overwriting it.
    const stale = await app.inject({ method: 'PATCH', url: `/api/v1/cases/${created.id}`, headers: { cookie }, payload: { expectedVersion: created.version, transmission: 'manual' } })
    expect(stale.statusCode).toBe(409)
    const updated = await app.inject({ method: 'PATCH', url: `/api/v1/cases/${created.id}`, headers: { cookie }, payload: { expectedVersion: reloaded.json().case.version, transmission: 'semi_automatic' } })
    expect(updated.statusCode).toBe(200)
    expect(updated.json().case.transmission).toBe('semi_automatic')
    const history = await app.inject({ method: 'GET', url: `/api/v1/cases/${created.id}/vehicle-profile`, headers: { cookie } })
    expect(history.json().current.transmission).toBe('semi_automatic')
    expect(history.json().history.map((version: { transmission: string }) => version.transmission)).toEqual(['semi_automatic', 'automatic', 'manual'])
    const omitted = await saveVehicle(cookie, created.id, VEHICLE_FIELDS, 3, 'Eski istemciden model düzeltildi')
    expect(omitted.statusCode).toBe(200)
    expect(omitted.json().current.transmission).toBe('semi_automatic')
    const foreign = await app.inject({ method: 'PATCH', url: `/api/v1/cases/${created.id}`, headers: { cookie: foreignCookie }, payload: { expectedVersion: updated.json().case.version, transmission: 'manual' } })
    expect(foreign.statusCode).toBe(404)
    const invalid = await app.inject({ method: 'PATCH', url: `/api/v1/cases/${created.id}`, headers: { cookie }, payload: { expectedVersion: updated.json().case.version, transmission: 'CVT' } })
    expect(invalid.statusCode).toBe(400)
    expect((await pool.query('SELECT transmission FROM cases WHERE id=$1', [created.id])).rows[0].transmission).toBe('semi_automatic')
    const legacy = await app.inject({ method: 'POST', url: '/api/v1/cases', headers: { cookie, 'idempotency-key': uuidv7() }, payload: { caseType: 'traffic', plate: '34 TR 573' } })
    expect(legacy.statusCode).toBe(201)
    expect(legacy.json().case.transmission).toBe('unknown')
  })
})
