import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AUTH_LOGIN_ROUTE,
  CASES_ROUTE,
  caseDetailResponseSchema,
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
import { buildApp, hashPassword } from '../src/index.js'

const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe

const PASSWORD = 'cok-guclu-parola-42'
const EMAIL = 'okuyucu@baran.example'

describeDb('salt okunur Cases uclari (gercek veritabani)', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let cookie: string
  let userId: string
  let serviceId: string
  let caseIds: Record<string, string>

  async function seedCase(input: {
    seq: number
    type: 'traffic' | 'casco'
    stage: string
    plate: string
    status?: 'open' | 'closed'
    followUp?: string
    responsible?: string
    service?: string
    notice?: string
    updatedAt: string
  }): Promise<string> {
    const id = uuidv7()
    const normalized = input.plate.toUpperCase().replace(/[^A-Z0-9]/g, '')
    await pool.query(
      `INSERT INTO cases (id, organization_id, office_year, office_sequence, office_number,
         case_type, lifecycle_status, workflow_stage, notification_form_number, plate,
         plate_normalized, responsible_user_id, service_center_id, follow_up_date, updated_at)
       VALUES ($1, $2, 2026, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        id,
        orgId,
        input.seq,
        `2026/${input.seq}`,
        input.type,
        input.status ?? 'open',
        input.stage,
        input.notice ?? null,
        input.plate,
        normalized,
        input.responsible ?? null,
        input.service ?? null,
        input.followUp ?? null,
        input.updatedAt,
      ],
    )
    return id
  }

  let orgId: string

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })

    orgId = uuidv7()
    userId = uuidv7()
    serviceId = uuidv7()
    await pool.query('INSERT INTO organizations (id, code, name) VALUES ($1, $2, $3)', [
      orgId,
      'baran-global',
      'Baran Global',
    ])
    await pool.query(
      'INSERT INTO users (id, organization_id, email, display_name, password_hash) VALUES ($1, $2, $3, $4, $5)',
      [userId, orgId, EMAIL, 'Okuyucu', await hashPassword(PASSWORD)],
    )
    await pool.query(
      'INSERT INTO service_centers (id, organization_id, name, center_type, service_type, phone) VALUES ($1, $2, $3, $4, $5, $6)',
      [serviceId, orgId, 'Merkez Oto Servis', 'ozel', 'private', '0312 000 00 00'],
    )

    caseIds = {
      mpa: await seedCase({
        seq: 184,
        type: 'casco',
        stage: 'inspection_pending',
        plate: '34 MPA 764',
        followUp: '2026-07-14',
        responsible: userId,
        service: serviceId,
        notice: 'F-2026-0988',
        updatedAt: '2026-07-11T09:00:00Z',
      }),
      abc: await seedCase({
        seq: 185,
        type: 'traffic',
        stage: 'reporting',
        plate: '06 ABC 123',
        followUp: '2026-07-20',
        updatedAt: '2026-07-12T10:00:00Z',
      }),
      closed: await seedCase({
        seq: 186,
        type: 'traffic',
        stage: 'closed',
        plate: '16 BRS 916',
        status: 'closed',
        updatedAt: '2026-07-10T08:00:00Z',
      }),
    }

    app = buildApp({
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 100, windowMs: 60_000 } },
    })
    const login = await app.inject({
      method: 'POST',
      url: AUTH_LOGIN_ROUTE,
      payload: { email: EMAIL, password: PASSWORD },
    })
    expect(login.statusCode).toBe(200)
    const setCookie = login.headers['set-cookie']
    cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0] as string
  }, 60_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  it('oturumsuz istek 401 doner', async () => {
    const response = await app.inject({ method: 'GET', url: CASES_ROUTE })
    expect(response.statusCode).toBe(401)
  })

  it('varsayilan liste: sema uyumlu, updatedAt azalan sirali, pageInfo dogru', async () => {
    const response = await app.inject({ method: 'GET', url: CASES_ROUTE, headers: { cookie } })
    expect(response.statusCode).toBe(200)
    const body = response.json() as { items: { id: string }[]; pageInfo: { totalItems: number } }
    expect(caseListResponseSchema.safeParse(body).success).toBe(true)
    expect(body.pageInfo.totalItems).toBe(3)
    expect(body.items.map((i) => i.id)).toEqual([caseIds.abc, caseIds.mpa, caseIds.closed])
  })

  it('filtreler: tur, durum, asama, sorumlu, servis', async () => {
    const byType = await app.inject({ method: 'GET', url: `${CASES_ROUTE}?caseType=casco`, headers: { cookie } })
    expect((byType.json() as { pageInfo: { totalItems: number } }).pageInfo.totalItems).toBe(1)

    const byStatus = await app.inject({ method: 'GET', url: `${CASES_ROUTE}?status=closed`, headers: { cookie } })
    expect((byStatus.json() as { items: { id: string }[] }).items[0]?.id).toBe(caseIds.closed)

    const byStage = await app.inject({ method: 'GET', url: `${CASES_ROUTE}?stage=reporting`, headers: { cookie } })
    expect((byStage.json() as { items: { id: string }[] }).items[0]?.id).toBe(caseIds.abc)

    const byResponsible = await app.inject({
      method: 'GET',
      url: `${CASES_ROUTE}?responsibleUserId=${userId}`,
      headers: { cookie },
    })
    expect((byResponsible.json() as { items: { id: string }[] }).items[0]?.id).toBe(caseIds.mpa)

    const byService = await app.inject({
      method: 'GET',
      url: `${CASES_ROUTE}?serviceId=${serviceId}`,
      headers: { cookie },
    })
    expect((byService.json() as { pageInfo: { totalItems: number } }).pageInfo.totalItems).toBe(1)
  })

  it('takip araligi filtresi calisir; bozuk aralik 400 doner', async () => {
    const ranged = await app.inject({
      method: 'GET',
      url: `${CASES_ROUTE}?followUpFrom=2026-07-13&followUpTo=2026-07-15`,
      headers: { cookie },
    })
    const body = ranged.json() as { items: { id: string }[] }
    expect(body.items.map((i) => i.id)).toEqual([caseIds.mpa])

    const invalid = await app.inject({
      method: 'GET',
      url: `${CASES_ROUTE}?followUpFrom=2026-07-20&followUpTo=2026-07-01`,
      headers: { cookie },
    })
    expect(invalid.statusCode).toBe(400)
    expect((invalid.json() as { error: { code: string } }).error.code).toBe('validation_error')
  })

  it('arama: ayrac toleransli plaka ve ihbar numarasi (AND cok kelime)', async () => {
    const plate = await app.inject({
      method: 'GET',
      url: `${CASES_ROUTE}?search=${encodeURIComponent('34mpa764')}`,
      headers: { cookie },
    })
    expect((plate.json() as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([caseIds.mpa])

    const combined = await app.inject({
      method: 'GET',
      url: `${CASES_ROUTE}?search=${encodeURIComponent('34mpa F-2026')}`,
      headers: { cookie },
    })
    expect((combined.json() as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([caseIds.mpa])

    const noMatch = await app.inject({
      method: 'GET',
      url: `${CASES_ROUTE}?search=${encodeURIComponent('34mpa olmayan-kelime')}`,
      headers: { cookie },
    })
    expect((noMatch.json() as { pageInfo: { totalItems: number } }).pageInfo.totalItems).toBe(0)
  })

  it('siralama: followUpDate asc (null son) ve officeCaseNumber', async () => {
    const byFollowUp = await app.inject({
      method: 'GET',
      url: `${CASES_ROUTE}?sortBy=followUpDate&sortDirection=asc`,
      headers: { cookie },
    })
    expect((byFollowUp.json() as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([
      caseIds.mpa,
      caseIds.abc,
      caseIds.closed,
    ])

    const byOffice = await app.inject({
      method: 'GET',
      url: `${CASES_ROUTE}?sortBy=officeCaseNumber&sortDirection=asc`,
      headers: { cookie },
    })
    expect((byOffice.json() as { items: { officeCaseNumber: string }[] }).items.map((i) => i.officeCaseNumber)).toEqual([
      '2026/184',
      '2026/185',
      '2026/186',
    ])
  })

  it('sayfalama: pageSize=2 ikinci sayfa tek kayit; asiri sayfa bos doner', async () => {
    const page2 = await app.inject({
      method: 'GET',
      url: `${CASES_ROUTE}?pageSize=2&page=2`,
      headers: { cookie },
    })
    const body = page2.json() as { items: unknown[]; pageInfo: { totalPages: number } }
    expect(body.items).toHaveLength(1)
    expect(body.pageInfo.totalPages).toBe(2)

    const beyond = await app.inject({
      method: 'GET',
      url: `${CASES_ROUTE}?pageSize=2&page=50`,
      headers: { cookie },
    })
    expect((beyond.json() as { items: unknown[] }).items).toHaveLength(0)
  })

  it('bilinmeyen query alani 400 doner (strict)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${CASES_ROUTE}?bilinmeyen=1`,
      headers: { cookie },
    })
    expect(response.statusCode).toBe(400)
  })

  it('detay: sema uyumlu doner; baska org gorunmez; olmayan/gecersiz id 404/400', async () => {
    const detail = await app.inject({
      method: 'GET',
      url: `${CASES_ROUTE}/${caseIds.mpa}`,
      headers: { cookie },
    })
    expect(detail.statusCode).toBe(200)
    const body = detail.json() as { case: { plate: string; followUpDate: string; serviceProfile: { serviceType: string; agreement: { status: string } } } }
    expect(caseDetailResponseSchema.safeParse(body).success).toBe(true)
    expect(body.case.plate).toBe('34 MPA 764')
    expect(body.case.followUpDate).toBe('2026-07-14')
    expect(body.case.serviceProfile).toMatchObject({ serviceType: 'private', agreement: { status: 'control_required' } })
    expect(JSON.stringify(body)).not.toMatch(/[A-Z]:\\|password|source_reference/i)

    const missing = await app.inject({
      method: 'GET',
      url: `${CASES_ROUTE}/${uuidv7()}`,
      headers: { cookie },
    })
    expect(missing.statusCode).toBe(404)
    expect((missing.json() as { error: { code: string } }).error.code).toBe('not_found')

    // Tenant kapsami: baska organizasyonun dosyasi 404 gorunur.
    const otherOrg = uuidv7()
    await pool.query('INSERT INTO organizations (id, code, name) VALUES ($1, $2, $3)', [
      otherOrg,
      'baska-firma',
      'Baska Firma',
    ])
    const foreignCase = uuidv7()
    await pool.query(
      `INSERT INTO cases (id, organization_id, office_year, office_sequence, office_number,
         case_type, workflow_stage, plate, plate_normalized)
       VALUES ($1, $2, 2026, 1, '2026/1', 'traffic', 'reporting', '35 ZZZ 11', '35ZZZ11')`,
      [foreignCase, otherOrg],
    )
    const cross = await app.inject({
      method: 'GET',
      url: `${CASES_ROUTE}/${foreignCase}`,
      headers: { cookie },
    })
    expect(cross.statusCode).toBe(404)

    const invalid = await app.inject({
      method: 'GET',
      url: `${CASES_ROUTE}/${encodeURIComponent('kotu id!')}`,
      headers: { cookie },
    })
    expect(invalid.statusCode).toBe(400)
  })
})
