import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AUTH_LOGIN_ROUTE,
  EXPERTS_REFERENCE_ROUTE,
  INSURERS_REFERENCE_ROUTE,
  SERVICES_REFERENCE_ROUTE,
  USERS_REFERENCE_ROUTE,
  expertsReferenceResponseSchema,
  insurersReferenceResponseSchema,
  servicesReferenceResponseSchema,
  usersReferenceResponseSchema,
} from '@hasarbotu/contracts'
import { assertTestDatabaseUrl, closeDatabasePool, createDatabasePool, runMigrations, uuidv7, type DatabaseConfig } from '@hasarbotu/database'
import { buildApp, hashPassword } from '../src/index.js'

const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe

describeDb('Paket 18 referans uçları (gerçek veritabanı)', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let cookie: string
  const password = 'referans-test-parola-42'

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    const orgA = uuidv7()
    const orgB = uuidv7()
    const activeUser = uuidv7()
    const expertUser = uuidv7()
    const disabledExpert = uuidv7()
    await pool.query("INSERT INTO organizations (id,code,name) VALUES ($1,'ref-a','Referans A'),($2,'ref-b','Referans B')", [orgA, orgB])
    const hash = await hashPassword(password)
    await pool.query(
      `INSERT INTO users (id,organization_id,email,display_name,password_hash,status) VALUES
       ($1,$4,'ref-user@example.test','Aktif Kullanıcı',$6,'active'),
       ($2,$4,'ref-expert@example.test','Aktif Eksper',$6,'active'),
       ($3,$4,'ref-disabled@example.test','Pasif Eksper',$6,'disabled'),
       ($5,$7,'foreign@example.test','Yabancı Kullanıcı',$6,'active')`,
      [activeUser, expertUser, disabledExpert, orgA, uuidv7(), hash, orgB],
    )
    await pool.query(
      `INSERT INTO user_roles (user_id,role_id)
       SELECT candidate, id FROM roles CROSS JOIN (VALUES ($1::uuid),($2::uuid)) AS x(candidate) WHERE code='expert'`,
      [expertUser, disabledExpert],
    )
    await pool.query(
      `INSERT INTO insurers (id,organization_id,name,is_active) VALUES
       ($1,$4,'Aktif Sigorta',true),($2,$4,'Pasif Sigorta',false),($3,$5,'Yabancı Sigorta',true)`,
      [uuidv7(), uuidv7(), uuidv7(), orgA, orgB],
    )
    await pool.query(
      `INSERT INTO service_centers (id,organization_id,name,center_type,is_active) VALUES
       ($1,$4,'Aktif Servis','ozel',true),($2,$4,'Pasif Servis','yetkili',false),($3,$5,'Yabancı Servis','ozel',true)`,
      [uuidv7(), uuidv7(), uuidv7(), orgA, orgB],
    )
    app = buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false, loginRateLimit: { limit: 100, windowMs: 60_000 } } })
    const login = await app.inject({ method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email: 'ref-user@example.test', password } })
    cookie = String(login.headers['set-cookie']).split(';')[0] as string
  }, 60_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  it('oturumsuz tüm referans uçlarını 401 ile reddeder', async () => {
    for (const url of [INSURERS_REFERENCE_ROUTE, SERVICES_REFERENCE_ROUTE, USERS_REFERENCE_ROUTE, EXPERTS_REFERENCE_ROUTE]) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401)
    }
  })

  it('yalnız aynı organizasyondaki aktif referansları deterministik döndürür', async () => {
    const insurers = await app.inject({ method: 'GET', url: INSURERS_REFERENCE_ROUTE, headers: { cookie } })
    const services = await app.inject({ method: 'GET', url: SERVICES_REFERENCE_ROUTE, headers: { cookie } })
    const users = await app.inject({ method: 'GET', url: USERS_REFERENCE_ROUTE, headers: { cookie } })
    const experts = await app.inject({ method: 'GET', url: EXPERTS_REFERENCE_ROUTE, headers: { cookie } })
    expect(insurersReferenceResponseSchema.parse(insurers.json()).items.map((item) => item.name)).toEqual(['Aktif Sigorta'])
    expect(servicesReferenceResponseSchema.parse(services.json()).items.map((item) => item.name)).toEqual(['Aktif Servis'])
    expect(usersReferenceResponseSchema.parse(users.json()).items.map((item) => item.displayName)).toEqual(['Aktif Eksper', 'Aktif Kullanıcı'])
    expect(expertsReferenceResponseSchema.parse(experts.json()).items.map((item) => item.displayName)).toEqual(['Aktif Eksper'])
    expect(JSON.stringify([insurers.json(), services.json(), users.json(), experts.json()])).not.toMatch(/Pasif|Yabancı|password|email/i)
  })
})
