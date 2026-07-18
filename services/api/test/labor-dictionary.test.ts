import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AUTH_LOGIN_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  laborDictionaryResponseSchema,
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
const PASSWORD = 'p46-sentetik-guclu-parola-46'

describeDb('Paket 46 İşçilik öğrenme sözlüğü gerçek API', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let organizationId: string
  let foreignOrganizationId: string
  let managerUserId: string
  let firstCaseId: string
  let secondCaseId: string
  let foreignCaseId: string
  let managerCookie: string
  let foreignCookie: string

  const dictionaryUrl = '/api/v1/labor-dictionary'

  async function login(email: string): Promise<string> {
    const response = await app.inject({ method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email, password: PASSWORD } })
    expect(response.statusCode).toBe(200)
    return String(response.headers['set-cookie']).split(';')[0] as string
  }

  async function createSheet(
    targetCaseId: string,
    cookie: string,
    items: readonly { description: string; action: string; partAmountMinor: number; laborAmountMinor: number }[],
  ): Promise<void> {
    const response = await app.inject({
      method: 'POST', url: `/api/v1/cases/${targetCaseId}/labor-sheet`,
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedCaseVersion: 1, items, confirmed: true },
    })
    expect(response.statusCode).toBe(201)
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })

    organizationId = uuidv7()
    foreignOrganizationId = uuidv7()
    managerUserId = uuidv7()
    const foreignUserId = uuidv7()
    firstCaseId = uuidv7()
    secondCaseId = uuidv7()
    foreignCaseId = uuidv7()
    const passwordHash = await hashPassword(PASSWORD)
    await pool.query(
      `INSERT INTO organizations (id,code,name)
       VALUES ($1,'p46-main','P46 Sentetik'),($2,'p46-foreign','P46 Yabancı')`,
      [organizationId, foreignOrganizationId],
    )
    await pool.query(
      `INSERT INTO users (id,organization_id,email,display_name,password_hash)
       VALUES ($1,$3,'p46-manager@test.local','P46 Dosya Sorumlusu',$5),
              ($2,$4,'p46-foreign@test.local','P46 Yabancı',$5)`,
      [managerUserId, foreignUserId, organizationId, foreignOrganizationId, passwordHash],
    )
    await pool.query(
      `INSERT INTO user_roles (user_id,role_id)
       SELECT $1::uuid,id FROM roles WHERE code='case_manager'
       UNION ALL SELECT $2::uuid,id FROM roles WHERE code='case_manager'`,
      [managerUserId, foreignUserId],
    )
    await pool.query(
      `INSERT INTO cases
         (id,organization_id,office_year,office_sequence,office_number,case_type,
          lifecycle_status,workflow_stage,plate,plate_normalized,responsible_user_id,notification_date,version)
       VALUES
       ($1,$4,2026,4601,'2026/4601','traffic','open','reporting','34 P 4601','34P4601',$5,'2026-07-18',1),
       ($2,$4,2026,4602,'2026/4602','traffic','open','reporting','34 P 4602','34P4602',$5,'2026-07-18',1),
       ($3,$6,2026,4603,'2026/4603','traffic','open','reporting','35 P 4603','35P4603',$7,'2026-07-18',1)`,
      [firstCaseId, secondCaseId, foreignCaseId, organizationId, managerUserId, foreignOrganizationId, foreignUserId],
    )

    app = buildApp({
      clock: fixedClock('2026-07-18T10:30:00.000Z'),
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 100, windowMs: 60_000 } },
    })
    managerCookie = await login('p46-manager@test.local')
    foreignCookie = await login('p46-foreign@test.local')

    await createSheet(firstCaseId, managerCookie, [
      { description: 'Ön tampon kaplama', action: 'Değişim', partAmountMinor: 18_400_00, laborAmountMinor: 2_200_00 },
      { description: 'Sol ön çamurluk', action: 'Onarım + boya', partAmountMinor: 0, laborAmountMinor: 6_750_00 },
    ])
    await createSheet(secondCaseId, managerCookie, [
      { description: 'Ön tampon kaplama', action: 'Değişim', partAmountMinor: 19_000_00, laborAmountMinor: 2_400_00 },
    ])
    await createSheet(foreignCaseId, foreignCookie, [
      { description: 'Yabancı kalem', action: 'Değişim', partAmountMinor: 1_000_00, laborAmountMinor: 500_00 },
    ])
  }, 90_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  it('401 uygular ve salt okunur çağrı audit yazmaz', async () => {
    expect((await app.inject({ method: 'GET', url: dictionaryUrl })).statusCode).toBe(401)
    const before = await pool.query('SELECT count(*)::int AS n FROM audit_events')
    const response = await app.inject({ method: 'GET', url: dictionaryUrl, headers: { cookie: managerCookie } })
    expect(response.statusCode).toBe(200)
    expect((await pool.query('SELECT count(*)::int AS n FROM audit_events')).rows).toEqual(before.rows)
  })

  it('onaylı föy kalemlerinden kullanım sayısı ve son tutarlarla sözlük türetir', async () => {
    const response = await app.inject({ method: 'GET', url: dictionaryUrl, headers: { cookie: managerCookie } })
    const dictionary = laborDictionaryResponseSchema.parse(response.json())
    expect(dictionary.schemaVersion).toBe('labor-dictionary/1.0.0')
    expect(dictionary.items[0]).toMatchObject({
      description: 'Ön tampon kaplama',
      action: 'Değişim',
      usageCount: 2,
      lastPartAmountMinor: 19_000_00,
      lastLaborAmountMinor: 2_400_00,
    })
    expect(dictionary.items.map((item) => item.description)).toEqual(['Ön tampon kaplama', 'Sol ön çamurluk'])
  })

  it('tenant sınırını uygular; başka organization kalemi görünmez', async () => {
    const own = laborDictionaryResponseSchema.parse((await app.inject({
      method: 'GET', url: dictionaryUrl, headers: { cookie: managerCookie },
    })).json())
    expect(own.items.some((item) => item.description === 'Yabancı kalem')).toBe(false)
    const foreign = laborDictionaryResponseSchema.parse((await app.inject({
      method: 'GET', url: dictionaryUrl, headers: { cookie: foreignCookie },
    })).json())
    expect(foreign.items.map((item) => item.description)).toEqual(['Yabancı kalem'])
  })

  it('aksan duyarsız arama ve limit uygular; geçersiz limit reddedilir', async () => {
    const search = laborDictionaryResponseSchema.parse((await app.inject({
      method: 'GET', url: `${dictionaryUrl}?query=CAMURLUK`, headers: { cookie: managerCookie },
    })).json())
    expect(search.items.map((item) => item.description)).toEqual(['Sol ön çamurluk'])

    const limited = laborDictionaryResponseSchema.parse((await app.inject({
      method: 'GET', url: `${dictionaryUrl}?limit=1`, headers: { cookie: managerCookie },
    })).json())
    expect(limited.items).toHaveLength(1)

    expect((await app.inject({
      method: 'GET', url: `${dictionaryUrl}?limit=0`, headers: { cookie: managerCookie },
    })).statusCode).toBe(400)
  })

  it('yalnız güncel föy sürümünü sayar; eski sürüm kalemleri sözlüğe girmez', async () => {
    const revise = await app.inject({
      method: 'POST', url: `/api/v1/cases/${secondCaseId}/labor-sheet/versions`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        expectedVersion: 1,
        items: [{ description: 'Arka tampon', action: 'Onarım', partAmountMinor: 0, laborAmountMinor: 3_000_00 }],
        reason: 'Kalem değiştirildi',
        confirmed: true,
      },
    })
    expect(revise.statusCode).toBe(200)
    const dictionary = laborDictionaryResponseSchema.parse((await app.inject({
      method: 'GET', url: dictionaryUrl, headers: { cookie: managerCookie },
    })).json())
    const bumper = dictionary.items.find((item) => item.description === 'Ön tampon kaplama')
    expect(bumper?.usageCount).toBe(1)
    expect(dictionary.items.some((item) => item.description === 'Arka tampon')).toBe(true)
  })
})
