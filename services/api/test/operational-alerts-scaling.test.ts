import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type pg from 'pg'
import {
  assertTestDatabaseUrl,
  closeDatabasePool,
  createDatabasePool,
  runMigrations,
  uuidv7,
  type DatabaseConfig,
} from '@hasarbotu/database'
import { createOperationalAlertStore } from '../src/index.js'

/**
 * Paket 51 — operasyonel uyarı ucunun ÖLÇEKLENME regresyon koruması.
 *
 * Bu test SÜRE ÖLÇMEZ: kararsız zaman eşiği yerine algoritmik sınırlara bakar.
 * Korunan değişmezler:
 *  - sorgu sayısı dosya sayısından bağımsızdır (N+1 yasağı),
 *  - sorgu parametre yükü dosya sayısıyla büyümez (binlerce UUID'lik dizi yasağı),
 *  - sonuç 200 sınırında kalır, mükerrer üretilmez ve sıralama deterministiktir.
 */
const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const AS_OF_DATE = '2026-07-18'
const EVALUATED_AT = '2026-07-18T09:00:00.000Z'
const MAX_ALERTS = 200

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

interface QueryCall {
  readonly parameterElementCount: number
}

/** `pool.query` sarmalayıcısı: sorgu sayısı ve parametre yükü toplanır. */
function instrument(pool: pg.Pool) {
  const calls: QueryCall[] = []
  const proxy = {
    query: async (...args: unknown[]) => {
      const parameters = (args[1] ?? []) as unknown[]
      const parameterElementCount = parameters.reduce<number>(
        (sum, value) => sum + (Array.isArray(value) ? value.length : 1),
        0,
      )
      calls.push({ parameterElementCount })
      return (pool.query as (...inner: unknown[]) => Promise<unknown>)(...args)
    },
  } as unknown as pg.Pool
  return { proxy, calls, reset: () => calls.splice(0, calls.length) }
}

describeDb('Paket 51 operasyonel uyarı ölçeklenme sınırları', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let smallOrganizationId: string
  let largeOrganizationId: string
  let emptyOrganizationId: string

  const SMALL_CASE_COUNT = 25
  const LARGE_CASE_COUNT = 400

  async function seedOrganization(code: string, caseCount: number): Promise<string> {
    const organizationId = uuidv7()
    const userId = uuidv7()
    await pool.query('INSERT INTO organizations (id,code,name) VALUES ($1,$2,$2)', [organizationId, code])
    await pool.query(
      `INSERT INTO users (id,organization_id,email,display_name,password_hash,status)
       VALUES ($1,$2,$3,'P51 Ölçek',repeat('x',60),'active')`,
      [userId, organizationId, `${code}@test.local`],
    )
    if (caseCount === 0) return organizationId

    // Karışık dağılım: görev, takip ve evrak durumları modulo ile deterministik.
    await pool.query(
      `INSERT INTO cases
         (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
          workflow_stage,plate,plate_normalized,responsible_user_id,follow_up_date,notification_date,version)
       SELECT gen_random_uuid(),$1,2026,seq,'2026/'||seq,'traffic','open','reporting',
              '34 PS '||seq,'34PS'||seq,$2,
              CASE seq % 4 WHEN 0 THEN DATE '2026-07-10' WHEN 1 THEN DATE '2026-08-05' ELSE NULL END,
              DATE '2026-07-01',1
         FROM generate_series(1,$3) AS seq`,
      [organizationId, userId, caseCount],
    )
    await pool.query(
      `INSERT INTO case_tasks
         (id,organization_id,case_id,title,priority,status,assigned_user_id,due_date,created_by_user_id,version)
       SELECT gen_random_uuid(),$1,c.id,'Sentetik görev '||c.office_sequence,
              (ARRAY['low','normal','high'])[1 + (c.office_sequence % 3)],'open',$2,
              CASE WHEN c.office_sequence % 20 < 11 THEN DATE '2026-07-12' ELSE DATE '2026-07-25' END,
              $2,1
         FROM cases c
        WHERE c.organization_id=$1 AND c.office_sequence % 20 < 13`,
      [organizationId, userId],
    )
    await pool.query(
      `INSERT INTO documents (id,organization_id,case_id,document_type,current_version_number,status)
       SELECT gen_random_uuid(),$1,c.id,t.document_type,1,'ready'
         FROM cases c
         CROSS JOIN unnest($2::text[]) WITH ORDINALITY AS t(document_type,position)
        WHERE c.organization_id=$1
          AND NOT (c.office_sequence % 20 >= 8 AND t.position = 1)
          AND NOT (c.office_sequence % 20 >= 15 AND t.position = 8)`,
      [organizationId, TRAFFIC_DOCUMENTS],
    )
    await pool.query(
      `INSERT INTO document_versions
         (id,organization_id,document_id,case_id,version_number,original_file_name,display_name,
          extension,mime_type,byte_size,content_hash,storage_root_key,relative_path,source_type,
          status,hash_verified,size_verified,verified_at,registered_by_user_id)
       SELECT gen_random_uuid(),$1,d.id,d.case_id,1,d.document_type||'.pdf',d.document_type||'.pdf',
              'pdf','application/pdf',128,repeat('a',64),'synthetic-root',
              'synthetic/'||d.case_id||'/'||d.document_type||'.pdf','manual',
              'ready',true,true,TIMESTAMPTZ '2026-07-10T08:00:00Z',$2
         FROM documents d
        WHERE d.organization_id=$1 AND d.current_version_id IS NULL`,
      [organizationId, userId],
    )
    await pool.query(
      `UPDATE documents d SET current_version_id=v.id
         FROM document_versions v
        WHERE v.document_id=d.id AND d.organization_id=$1 AND d.current_version_id IS NULL`,
      [organizationId],
    )
    return organizationId
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    smallOrganizationId = await seedOrganization('p51-small', SMALL_CASE_COUNT)
    largeOrganizationId = await seedOrganization('p51-large', LARGE_CASE_COUNT)
    emptyOrganizationId = await seedOrganization('p51-empty', 0)
  }, 180_000)

  afterAll(async () => {
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  it('sorgu sayısı dosya sayısından bağımsızdır (N+1 yok)', async () => {
    const { proxy, calls, reset } = instrument(pool)
    const store = createOperationalAlertStore(proxy)

    reset()
    await store.list(smallOrganizationId, AS_OF_DATE, EVALUATED_AT)
    const smallQueryCount = calls.length

    reset()
    await store.list(largeOrganizationId, AS_OF_DATE, EVALUATED_AT)
    const largeQueryCount = calls.length

    // 16 kat dosya, aynı sorgu sayısı.
    expect(largeQueryCount).toBe(smallQueryCount)
    expect(smallQueryCount).toBe(4)
  })

  it('sorgu parametre yükü dosya sayısıyla büyümez', async () => {
    const { proxy, calls, reset } = instrument(pool)
    const store = createOperationalAlertStore(proxy)

    reset()
    await store.list(smallOrganizationId, AS_OF_DATE, EVALUATED_AT)
    const smallPayload = Math.max(...calls.map((call) => call.parameterElementCount))

    reset()
    await store.list(largeOrganizationId, AS_OF_DATE, EVALUATED_AT)
    const largePayload = Math.max(...calls.map((call) => call.parameterElementCount))

    // Dosya kimliği dizisi parametre olarak taşınmamalı.
    expect(largePayload).toBe(smallPayload)
    expect(largePayload).toBeLessThan(10)
  })

  it('açık dosyası olmayan organization için tek sorgu yeterlidir', async () => {
    const { proxy, calls, reset } = instrument(pool)
    const store = createOperationalAlertStore(proxy)

    reset()
    const result = await store.list(emptyOrganizationId, AS_OF_DATE, EVALUATED_AT)
    expect(calls).toHaveLength(1)
    expect(result.alerts).toEqual([])
    expect(result.totalCount).toBe(0)
  })

  it('hacim altında 200 sınırı, mükerrerlik ve sıralama korunur', async () => {
    const store = createOperationalAlertStore(pool)
    const result = await store.list(largeOrganizationId, AS_OF_DATE, EVALUATED_AT)

    expect(result.alerts.length).toBeLessThanOrEqual(MAX_ALERTS)
    expect(result.totalCount).toBe(result.alerts.length)

    const keys = result.alerts.map((item) => item.dedupeKey)
    expect(new Set(keys).size).toBe(keys.length)

    const rank = { high: 0, medium: 1, low: 2 } as const
    for (let index = 1; index < result.alerts.length; index += 1) {
      const previous = result.alerts[index - 1]
      const current = result.alerts[index]
      const ordered = rank[previous.severity] < rank[current.severity]
        || (rank[previous.severity] === rank[current.severity]
          && previous.sourceDate.localeCompare(current.sourceDate) <= 0)
      expect(ordered).toBe(true)
    }
  })

  it('sonuç tekrarlı çağrılarda birebir aynıdır', async () => {
    const store = createOperationalAlertStore(pool)
    const first = await store.list(largeOrganizationId, AS_OF_DATE, EVALUATED_AT)
    const second = await store.list(largeOrganizationId, AS_OF_DATE, EVALUATED_AT)
    expect(second.alerts).toEqual(first.alerts)
  })

  it('tenant sınırı hacim altında da korunur', async () => {
    const store = createOperationalAlertStore(pool)
    const small = await store.list(smallOrganizationId, AS_OF_DATE, EVALUATED_AT)
    const large = await store.list(largeOrganizationId, AS_OF_DATE, EVALUATED_AT)

    expect(small.alerts.every((item) => item.plate.startsWith('34 PS '))).toBe(true)
    expect(large.alerts.every((item) => item.plate.startsWith('34 PS '))).toBe(true)
    const smallCaseIds = new Set(small.alerts.map((item) => item.caseId))
    expect(large.alerts.some((item) => smallCaseIds.has(item.caseId))).toBe(false)
  })
})
