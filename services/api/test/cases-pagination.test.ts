import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { AUTH_LOGIN_ROUTE, caseListResponseSchema, type CaseListResponse } from '@hasarbotu/contracts'
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
 * Paket 53 — dosya listesinde sunucu tarafı sayfalama.
 *
 * Korunan davranışlar: tenant izolasyonu (hem sonuçlarda hem toplam sayımda),
 * filtre+sıralama+sayfalama birlikteliği, sayfalar arasında kayıp/mükerrer
 * kayıt olmaması, deterministik sıralama ve 100 kayıt sınırı.
 */
const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'p53-sentetik-guclu-parola-53'
const NOW = '2026-07-18T10:30:00.000Z'
const MAIN_CASE_COUNT = 137

describeDb('Paket 53 dosya listesi sunucu tarafı sayfalama', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let organizationId: string
  let foreignOrganizationId: string
  let userId: string
  let otherUserId: string
  let foreignUserId: string
  let cookie: string
  let foreignCookie: string

  async function login(email: string): Promise<string> {
    const response = await app.inject({
      method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email, password: PASSWORD },
    })
    expect(response.statusCode).toBe(200)
    return String(response.headers['set-cookie']).split(';')[0] as string
  }

  async function list(sessionCookie: string, query: string): Promise<CaseListResponse> {
    const response = await app.inject({
      method: 'GET', url: `/api/v1/cases?${query}`, headers: { cookie: sessionCookie },
    })
    expect(response.statusCode).toBe(200)
    return caseListResponseSchema.parse(response.json())
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })

    organizationId = uuidv7()
    foreignOrganizationId = uuidv7()
    userId = uuidv7()
    otherUserId = uuidv7()
    foreignUserId = uuidv7()
    const passwordHash = await hashPassword(PASSWORD)
    await pool.query(
      `INSERT INTO organizations (id,code,name)
       VALUES ($1,'p53-main','P53 Sentetik'),($2,'p53-foreign','P53 Yabancı')`,
      [organizationId, foreignOrganizationId],
    )
    await pool.query(
      `INSERT INTO users (id,organization_id,email,display_name,password_hash)
       VALUES ($1,$4,'p53-manager@test.local','P53 Sorumlu',$6),
              ($2,$4,'p53-other@test.local','P53 Diğer Sorumlu',$6),
              ($3,$5,'p53-foreign@test.local','P53 Yabancı',$6)`,
      [userId, otherUserId, foreignUserId, organizationId, foreignOrganizationId, passwordHash],
    )
    await pool.query(
      `INSERT INTO user_roles (user_id,role_id)
       SELECT id_list.user_id,roles.id FROM roles,
         (VALUES ($1::uuid),($2::uuid),($3::uuid)) AS id_list(user_id)
        WHERE roles.code='case_manager'`,
      [userId, otherUserId, foreignUserId],
    )

    // Ana organization: 137 açık dosya. Tür, sorumlu ve takip tarihi karışık.
    await pool.query(
      `INSERT INTO cases
         (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
          workflow_stage,plate,plate_normalized,responsible_user_id,follow_up_date,notification_date,
          updated_at,version)
       SELECT gen_random_uuid(),$1,2026,seq,'2026/'||seq,
              CASE WHEN seq % 3 = 0 THEN 'casco' ELSE 'traffic' END,
              'open','reporting',
              '34 PG '||seq,'34PG'||seq,
              CASE WHEN seq % 2 = 0 THEN $2::uuid ELSE $3::uuid END,
              CASE seq % 4
                WHEN 0 THEN DATE '2026-07-10'
                WHEN 1 THEN DATE '2026-07-18'
                WHEN 2 THEN DATE '2026-08-05'
                ELSE NULL
              END,
              DATE '2026-07-01',
              TIMESTAMPTZ '2026-07-01T00:00:00Z' + (seq || ' minutes')::interval,
              1
         FROM generate_series(1,$4) AS seq`,
      [organizationId, userId, otherUserId, MAIN_CASE_COUNT],
    )
    // Kapalı dosya: varsayılan `status=open` sorgusunda görünmemeli.
    await pool.query(
      `INSERT INTO cases
         (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
          workflow_stage,plate,plate_normalized,responsible_user_id,notification_date,version)
       VALUES (gen_random_uuid(),$1,2026,9001,'2026/9001','traffic','closed','closed',
               '34 PG 9001','34PG9001',$2,'2026-07-01',1)`,
      [organizationId, userId],
    )
    // Yabancı organization: 40 açık dosya.
    await pool.query(
      `INSERT INTO cases
         (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
          workflow_stage,plate,plate_normalized,responsible_user_id,notification_date,version)
       SELECT gen_random_uuid(),$1,2026,seq,'2026/'||seq,'traffic','open','reporting',
              '35 YB '||seq,'35YB'||seq,$2,DATE '2026-07-01',1
         FROM generate_series(1,40) AS seq`,
      [foreignOrganizationId, foreignUserId],
    )

    app = buildApp({
      clock: fixedClock(NOW),
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 100, windowMs: 60_000 } },
    })
    cookie = await login('p53-manager@test.local')
    foreignCookie = await login('p53-foreign@test.local')
  }, 240_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  it('toplam sayım ve sayfa bilgisi gerçek veriden gelir', async () => {
    const result = await list(cookie, 'status=open&page=1&pageSize=50')
    expect(result.pageInfo).toEqual({
      page: 1,
      pageSize: 50,
      totalItems: MAIN_CASE_COUNT,
      totalPages: 3,
    })
    expect(result.items).toHaveLength(50)
  })

  it('tenant sınırı hem sonuçlara hem toplam sayıma uygulanır', async () => {
    const own = await list(cookie, 'status=open&page=1&pageSize=100')
    expect(own.pageInfo.totalItems).toBe(MAIN_CASE_COUNT)
    expect(own.items.every((item) => item.plate.startsWith('34 PG '))).toBe(true)

    const foreign = await list(foreignCookie, 'status=open&page=1&pageSize=100')
    expect(foreign.pageInfo.totalItems).toBe(40)
    expect(foreign.items.every((item) => item.plate.startsWith('35 YB '))).toBe(true)
  })

  it('sayfalar arasında kayıp veya mükerrer kayıt yoktur', async () => {
    const collected: string[] = []
    for (let page = 1; page <= 3; page += 1) {
      const result = await list(cookie, `status=open&page=${page}&pageSize=50&sortBy=plate&sortDirection=asc`)
      expect(result.pageInfo.page).toBe(page)
      collected.push(...result.items.map((item) => item.id))
    }
    expect(collected).toHaveLength(MAIN_CASE_COUNT)
    expect(new Set(collected).size).toBe(MAIN_CASE_COUNT)
  })

  it('eşit sıralama değerlerinde dosya kimliğiyle deterministiktir', async () => {
    // `follow_up_date` çok sayıda dosyada aynıdır; sayfalama yine de kararlı olmalı.
    const first = await list(cookie, 'status=open&page=1&pageSize=25&sortBy=followUpDate&sortDirection=asc')
    const firstAgain = await list(cookie, 'status=open&page=1&pageSize=25&sortBy=followUpDate&sortDirection=asc')
    expect(firstAgain.items.map((item) => item.id)).toEqual(first.items.map((item) => item.id))

    const second = await list(cookie, 'status=open&page=2&pageSize=25&sortBy=followUpDate&sortDirection=asc')
    const overlap = second.items.filter((item) => first.items.some((other) => other.id === item.id))
    expect(overlap).toHaveLength(0)
  })

  it('filtre sayfalamadan ÖNCE uygulanır', async () => {
    const casco = await list(cookie, 'status=open&caseType=casco&page=1&pageSize=25')
    const expectedCasco = Math.floor(MAIN_CASE_COUNT / 3)
    expect(casco.pageInfo.totalItems).toBe(expectedCasco)
    expect(casco.items.every((item) => item.caseType === 'casco')).toBe(true)

    const byUser = await list(cookie, `status=open&responsibleUserId=${userId}&page=1&pageSize=100`)
    expect(byUser.items.every((item) => item.responsibleUserId === userId)).toBe(true)
    expect(byUser.pageInfo.totalItems).toBe(Math.floor(MAIN_CASE_COUNT / 2))
  })

  it('kapalı dosya varsayılan açık listesine girmez', async () => {
    const open = await list(cookie, 'status=open&page=1&pageSize=100')
    expect(open.items.some((item) => item.officeCaseNumber === '2026/9001')).toBe(false)
    const closed = await list(cookie, 'status=closed&page=1&pageSize=100')
    expect(closed.pageInfo.totalItems).toBe(1)
    expect(closed.items[0].officeCaseNumber).toBe('2026/9001')
  })

  it('plaka araması boşluksuz eşleşir ve AND davranışı korunur', async () => {
    const spaceless = await list(cookie, 'status=open&search=34PG7&page=1&pageSize=100')
    expect(spaceless.pageInfo.totalItems).toBeGreaterThan(0)
    expect(spaceless.items.every((item) => item.plate.replace(/\s/g, '').includes('34PG7'))).toBe(true)

    // İki terim birlikte daraltır (AND).
    const single = await list(cookie, 'status=open&search=34PG1&page=1&pageSize=100')
    const both = await list(cookie, 'status=open&search=34PG1%202026%2F12&page=1&pageSize=100')
    expect(both.pageInfo.totalItems).toBeLessThan(single.pageInfo.totalItems)
    expect(both.items.every((item) => item.officeCaseNumber.includes('2026/12'))).toBe(true)
  })

  it('takip tarihi aralığı sunucuda uygulanır', async () => {
    const overdue = await list(cookie, 'status=open&followUpTo=2026-07-17&page=1&pageSize=100')
    expect(overdue.items.every((item) => item.followUpDate !== null && item.followUpDate <= '2026-07-17')).toBe(true)
    expect(overdue.pageInfo.totalItems).toBe(Math.floor(MAIN_CASE_COUNT / 4))
  })

  it('sayfa boyutu 100 ile sınırlıdır ve geçersiz değerler reddedilir', async () => {
    const maxAllowed = await app.inject({
      method: 'GET', url: '/api/v1/cases?status=open&page=1&pageSize=100', headers: { cookie },
    })
    expect(maxAllowed.statusCode).toBe(200)

    for (const query of ['pageSize=101', 'pageSize=0', 'pageSize=10.5', 'page=0', 'page=-1', 'page=abc']) {
      const response = await app.inject({
        method: 'GET', url: `/api/v1/cases?status=open&${query}`, headers: { cookie },
      })
      expect(response.statusCode).toBe(400)
    }
  })

  it('aralık dışı sayfa boş sonuç döner ve toplam sayımı korur', async () => {
    const result = await list(cookie, 'status=open&page=99&pageSize=50')
    expect(result.items).toEqual([])
    expect(result.pageInfo.totalItems).toBe(MAIN_CASE_COUNT)
    expect(result.pageInfo.totalPages).toBe(3)
  })

  it('oturumsuz erişim reddedilir', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/cases?status=open' })
    expect(response.statusCode).toBe(401)
  })
})
