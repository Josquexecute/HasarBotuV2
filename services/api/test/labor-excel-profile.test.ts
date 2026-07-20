import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AUTH_LOGIN_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  laborExcelProfileResponseSchema,
  laborExcelProfilesResponseSchema,
  laborExcelProjectionResponseSchema,
  laborAllocationRunResponseSchema,
} from '@hasarbotu/contracts'
import {
  assertTestDatabaseUrl,
  closeDatabasePool,
  createDatabasePool,
  runMigrations,
  uuidv7,
  type DatabaseConfig,
} from '@hasarbotu/database'
import { waitForRunTerminal } from './helpers/labor-allocation-run.js'
import {
  buildApp,
  createDeterministicLaborAllocationProviderRegistry,
  fixedClock,
  hashPassword,
} from '../src/index.js'

/**
 * Paket 60 — Excel şablon profilleri ve salt okunur projeksiyon.
 *
 * Ana iddialar: profil sürümlü ve tenant sınırlı; projeksiyon yalnız
 * TAMAMLANMIŞ uygulamadan beslenir, dosyaya yazmaz ve kullanıcı tutarı
 * değiştirdiyse sayı uydurmaz.
 */
const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'p60-sentetik-guclu-parola-60'
const NOW = '2026-07-19T18:00:00.000Z'

const COLUMNS = [
  { key: 'ISCILIK', label: 'İşçilik Bedeli' },
  { key: 'PARCA', label: 'Parça Bedeli' },
]
const MAPPING = {
  repair: 'ISCILIK',
  replace: 'PARCA',
  remove_install: 'ISCILIK',
  paint: null,
  consumable: null,
  calibration: null,
  related_operation: null,
  other: null,
}

describeDb('Paket 60 Excel şablon profilleri', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let organizationId: string
  let foreignOrganizationId: string
  let userId: string
  let foreignUserId: string
  let insurerId: string
  let foreignInsurerId: string
  let cookie: string
  let foreignCookie: string
  let readerCookie: string

  async function login(email: string): Promise<string> {
    const response = await app.inject({
      method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email, password: PASSWORD },
    })
    expect(response.statusCode).toBe(200)
    return String(response.headers['set-cookie']).split(';')[0] as string
  }

  const saveProfile = (
    sessionCookie: string,
    body: Record<string, unknown>,
    profileId?: string,
  ) => app.inject({
    method: 'POST',
    url: profileId === undefined
      ? '/api/v1/labor-excel-profiles'
      : `/api/v1/labor-excel-profiles/${profileId}`,
    headers: { cookie: sessionCookie },
    payload: body,
  })

  const fields = (overrides: Record<string, unknown> = {}) => ({
    name: 'Sentetik Şablon',
    insurerId: null,
    columns: COLUMNS,
    mapping: MAPPING,
    ...overrides,
  })

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })

    organizationId = uuidv7()
    foreignOrganizationId = uuidv7()
    userId = uuidv7()
    foreignUserId = uuidv7()
    insurerId = uuidv7()
    foreignInsurerId = uuidv7()
    const readerId = uuidv7()
    const passwordHash = await hashPassword(PASSWORD)
    await pool.query(
      `INSERT INTO organizations (id,code,name)
       VALUES ($1,'p60-main','P60 Sentetik'),($2,'p60-foreign','P60 Yabancı')`,
      [organizationId, foreignOrganizationId],
    )
    await pool.query(
      `INSERT INTO users (id,organization_id,email,display_name,password_hash)
       VALUES ($1,$4,'p60-admin@test.local','P60 Yönetici',$6),
              ($2,$5,'p60-foreign@test.local','P60 Yabancı',$6),
              ($3,$4,'p60-reader@test.local','P60 Okuyucu',$6)`,
      [userId, foreignUserId, readerId, organizationId, foreignOrganizationId, passwordHash],
    )
    await pool.query(
      `INSERT INTO user_roles (user_id,role_id)
       SELECT $1::uuid,id FROM roles WHERE code='admin'
       UNION ALL SELECT $2::uuid,id FROM roles WHERE code='admin'
       UNION ALL SELECT $3::uuid,id FROM roles WHERE code='read_only'`,
      [userId, foreignUserId, readerId],
    )
    await pool.query(
      `INSERT INTO insurers (id,organization_id,name)
       VALUES ($1,$3,'Sentetik Sigorta'),($2,$4,'Yabancı Sigorta')`,
      [insurerId, foreignInsurerId, organizationId, foreignOrganizationId],
    )

    app = buildApp({
      clock: fixedClock(NOW),
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 500, windowMs: 60_000 } },
      laborAllocationProviders: createDeterministicLaborAllocationProviderRegistry(),
      laborAllocationProviderId: 'deterministic-success',
    })
    await app.ready()
    cookie = await login('p60-admin@test.local')
    foreignCookie = await login('p60-foreign@test.local')
    readerCookie = await login('p60-reader@test.local')
  })

  afterAll(async () => {
    await app?.close()
    await closeDatabasePool(pool)
  })

  it('profil oluşturur ve ilk sürümde gerekçe istemez', async () => {
    const response = await saveProfile(cookie, {
      fields: fields({ insurerId }), expectedVersion: null, reason: null, confirmed: true,
    })
    expect(response.statusCode).toBe(201)
    const body = laborExcelProfileResponseSchema.parse(response.json())
    expect(body.profile.version).toBe(1)
    expect(body.profile.current.name).toBe('Sentetik Şablon')
    expect(body.profile.current.insurerId).toBe(insurerId)
    expect(body.profile.current.revisionReason).toBeNull()
    expect(body.profile.current.mapping.repair).toBe('ISCILIK')
  })

  it('yeni sürüm gerekçe ister ve geçmişi korur', async () => {
    const created = laborExcelProfileResponseSchema.parse(
      (await saveProfile(cookie, {
        fields: fields({ name: 'Sürümlenecek' }), expectedVersion: null, reason: null, confirmed: true,
      })).json(),
    )
    const withoutReason = await saveProfile(cookie, {
      fields: fields({ name: 'Yeni Ad' }), expectedVersion: 1, reason: null, confirmed: true,
    }, created.profile.id)
    expect(withoutReason.statusCode).toBe(400)

    const revised = await saveProfile(cookie, {
      fields: fields({ name: 'Yeni Ad' }), expectedVersion: 1, reason: 'Kolon adı düzeltildi', confirmed: true,
    }, created.profile.id)
    expect(revised.statusCode).toBe(200)
    const body = laborExcelProfileResponseSchema.parse(revised.json())
    expect(body.profile.version).toBe(2)
    expect(body.profile.current.name).toBe('Yeni Ad')
    expect(body.profile.history).toHaveLength(2)
    // Eski sürüm değişmeden okunur.
    expect(body.profile.history[1]?.name).toBe('Sürümlenecek')
  })

  it('sürüm çakışmasını reddeder', async () => {
    const created = laborExcelProfileResponseSchema.parse(
      (await saveProfile(cookie, {
        fields: fields({ name: 'Çakışma' }), expectedVersion: null, reason: null, confirmed: true,
      })).json(),
    )
    const stale = await saveProfile(cookie, {
      fields: fields({ name: 'X' }), expectedVersion: 99, reason: 'Gerekçe', confirmed: true,
    }, created.profile.id)
    expect(stale.statusCode).toBe(409)
  })

  it('eksik eşleme sözleşme seviyesinde reddedilir', async () => {
    const partial: Record<string, unknown> = { ...MAPPING }
    delete partial.other
    const response = await saveProfile(cookie, {
      fields: fields({ mapping: partial }), expectedVersion: null, reason: null, confirmed: true,
    })
    expect(response.statusCode).toBe(400)
  })

  it('tanımsız sütuna eşleme reddedilir', async () => {
    const response = await saveProfile(cookie, {
      fields: fields({ mapping: { ...MAPPING, repair: 'YOK_BOYLE' } }),
      expectedVersion: null, reason: null, confirmed: true,
    })
    expect(response.statusCode).toBe(400)
  })

  it('başka organizationın sigorta şirketi kullanılamaz', async () => {
    const response = await saveProfile(cookie, {
      fields: fields({ insurerId: foreignInsurerId }),
      expectedVersion: null, reason: null, confirmed: true,
    })
    expect(response.statusCode).toBe(404)
  })

  it('yabancı organization profili göremez ve düzenleyemez', async () => {
    const list = await app.inject({
      method: 'GET', url: '/api/v1/labor-excel-profiles', headers: { cookie: foreignCookie },
    })
    expect(list.statusCode).toBe(200)
    expect(laborExcelProfilesResponseSchema.parse(list.json()).profiles).toHaveLength(0)

    const mine = laborExcelProfilesResponseSchema.parse(
      (await app.inject({
        method: 'GET', url: '/api/v1/labor-excel-profiles', headers: { cookie },
      })).json(),
    )
    expect(mine.profiles.length).toBeGreaterThan(0)
    const target = mine.profiles[0]?.id as string
    const attempt = await saveProfile(foreignCookie, {
      fields: fields(), expectedVersion: 1, reason: 'Yetkisiz', confirmed: true,
    }, target)
    expect(attempt.statusCode).toBe(404)
  })

  it('salt-okunur rol profil yazamaz ama listeleyebilir', async () => {
    const list = await app.inject({
      method: 'GET', url: '/api/v1/labor-excel-profiles', headers: { cookie: readerCookie },
    })
    expect(list.statusCode).toBe(200)
    expect(laborExcelProfilesResponseSchema.parse(list.json()).permissions.canWrite).toBe(false)
    const write = await saveProfile(readerCookie, {
      fields: fields(), expectedVersion: null, reason: null, confirmed: true,
    })
    expect(write.statusCode).toBe(403)
  })

  describe('projeksiyon', () => {
    let caseId: string
    let applicationId: string
    let profileId: string

    beforeAll(async () => {
      caseId = uuidv7()
      await pool.query(
        `INSERT INTO cases
           (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
            workflow_stage,plate,plate_normalized,responsible_user_id,notification_date,version)
         VALUES ($1,$2,2026,6001,'2026/6001','traffic','open','reporting','34 EX 6001','34EX6001',$3,'2026-07-01',1)`,
        [caseId, organizationId, userId],
      )
      await pool.query(
        `INSERT INTO ai_provider_policies
           (id,organization_id,labor_allocation_enabled,labor_allocation_allowed_provider_ids,
            monthly_budget_minor,per_request_budget_minor)
         VALUES ($1,$2,true,ARRAY['deterministic-success']::text[],10000000,10000000)`,
        [uuidv7(), organizationId],
      )
      const sheet = await app.inject({
        method: 'POST', url: `/api/v1/cases/${caseId}/labor-sheet`,
        headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
        payload: {
          expectedCaseVersion: 1, confirmed: true,
          items: [
            { description: 'Ön tampon', action: 'Onarım', partAmountMinor: 0, laborAmountMinor: 1_000_000 },
            { description: 'Sol çamurluk', action: 'Değişim', partAmountMinor: 1_800_000, laborAmountMinor: 200_000 },
          ],
        },
      })
      expect(sheet.statusCode).toBe(201)
      const analyzed = await app.inject({
        method: 'POST', url: `/api/v1/cases/${caseId}/labor-allocation-ai/analyze`,
        headers: { cookie },
        payload: { expectedSheetVersion: 1, damageDescription: 'Ön sol darbe.', confirmedEgress: false },
      })
      // P62'den beri analiz ASENKRONDUR; koşu sonlanmadan uygulama yapılamaz.
      const settled = await waitForRunTerminal(app, cookie, caseId, analyzed)
      const run = laborAllocationRunResponseSchema.parse(settled.json()).run

      // 1. satır önerildiği gibi, 2. satır KULLANICI TARAFINDAN DEĞİŞTİRİLEREK
      // uygulanır; projeksiyon ikincisi için sayı üretmemelidir.
      const applied = await app.inject({
        method: 'POST', url: `/api/v1/cases/${caseId}/labor-allocation-ai/${run.id}/apply`,
        headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
        payload: {
          expectedSheetVersion: 1, reason: 'AI dağıtımı onaylandı', confirmed: true,
          lines: [
            {
              lineOrdinal: 1, description: 'Ön tampon', action: 'Onarım',
              partAmountMinor: 0, laborAmountMinor: 1_000_000,
            },
            {
              lineOrdinal: 2, description: 'Sol çamurluk', action: 'Değişim',
              partAmountMinor: 1_700_000, laborAmountMinor: 300_000,
            },
          ],
        },
      })
      expect(applied.statusCode).toBe(200)
      applicationId = (applied.json() as { application: { id: string } }).application.id

      const profile = laborExcelProfileResponseSchema.parse(
        (await saveProfile(cookie, {
          fields: fields({ name: 'Projeksiyon Şablonu' }),
          expectedVersion: null, reason: null, confirmed: true,
        })).json(),
      )
      profileId = profile.profile.id
    })

    const project = (sessionCookie: string, targetProfileId = profileId) => app.inject({
      method: 'GET',
      url: `/api/v1/cases/${caseId}/labor-allocation-applications/${applicationId}`
        + `/excel-projection?profileId=${targetProfileId}`,
      headers: { cookie: sessionCookie },
    })

    it('değiştirilmemiş satırı sütunlara dağıtır, değiştirileni manuel bırakır', async () => {
      const response = await project(cookie)
      expect(response.statusCode).toBe(200)
      const body = laborExcelProjectionResponseSchema.parse(response.json())

      // Dosyaya yazılmadığı sözleşme seviyesinde garanti.
      expect(body.written).toBe(false)
      expect(body.lines).toHaveLength(2)
      expect(body.projectedLineCount).toBe(1)
      expect(body.manualEntryLineCount).toBe(1)

      const first = body.lines.find((line) => line.lineOrdinal === 1)
      expect(first?.status).toBe('projected')
      expect(first?.cells.ISCILIK).toBeGreaterThan(0)

      const second = body.lines.find((line) => line.lineOrdinal === 2)
      expect(second?.status).toBe('manual_entry_required')
      expect(second?.reviewRequired).toBe(true)
      // Kullanıcı tutarı değiştirdiği için hücre tutarı UYDURULMAZ.
      expect(second?.cells.PARCA).toBe(0)
      expect(second?.cells.ISCILIK).toBe(0)
      // Uygulanan toplam referans olarak korunur.
      expect(second?.totalMinor).toBe(2_000_000)
    })

    it('yabancı organization projeksiyonu okuyamaz', async () => {
      const response = await project(foreignCookie)
      expect(response.statusCode).toBe(404)
    })

    it('tamamlanmamış uygulama projekte edilemez', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/cases/${caseId}/labor-allocation-applications/${uuidv7()}`
          + `/excel-projection?profileId=${profileId}`,
        headers: { cookie },
      })
      expect(response.statusCode).toBe(404)
    })

    it('başka organizationın profiliyle projeksiyon yapılamaz', async () => {
      const foreignProfile = laborExcelProfileResponseSchema.parse(
        (await saveProfile(foreignCookie, {
          fields: fields({ name: 'Yabancı Şablon' }),
          expectedVersion: null, reason: null, confirmed: true,
        })).json(),
      )
      const response = await project(cookie, foreignProfile.profile.id)
      expect(response.statusCode).toBe(404)
    })

    it('salt-okunur rol projeksiyonu görebilir', async () => {
      const response = await project(readerCookie)
      expect(response.statusCode).toBe(200)
    })
  })
})
