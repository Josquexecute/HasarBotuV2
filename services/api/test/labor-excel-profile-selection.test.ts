import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AUTH_LOGIN_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  laborAllocationRunResponseSchema,
  laborExcelProfileCandidatesResponseSchema,
  laborExcelProfileResponseSchema,
  laborExcelProfilesResponseSchema,
  laborExcelProjectionResponseSchema,
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
 * Paket 63 — çoklu Excel profil seçimi.
 *
 * Ana iddia: seçilebilirlik SUNUCUDA zorlanır. İstemci istediği `profileId`'yi
 * gönderebilir; başka sigorta şirketine ait veya pasif profil kabul edilmez.
 * Otomatik öneri seçim yerine geçmez ve gerçek şablon eşleşmesi DEĞİLDİR.
 */
const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'p63-sentetik-guclu-parola-63'
const NOW = '2026-07-20T10:00:00.000Z'

const COLUMNS = [{ key: 'ISCILIK', label: 'İşçilik' }, { key: 'PARCA', label: 'Parça' }]
const MAPPING = {
  repair: 'ISCILIK',
  replace: 'PARCA',
  remove_install: null,
  paint: null,
  consumable: null,
  calibration: null,
  related_operation: null,
  other: null,
}

describeDb('Paket 63 çoklu Excel profil seçimi', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let organizationId: string
  let userId: string
  let insurerId: string
  let otherInsurerId: string
  let cookie: string
  let caseWithInsurerId: string
  let caseWithoutInsurerId: string

  async function createProfile(name: string, profileInsurerId: string | null) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/labor-excel-profiles',
      headers: { cookie },
      payload: {
        fields: {
          name,
          insurerId: profileInsurerId,
          targetSheet: 'Föy',
          identityChecks: { plate: true, officeNumber: false },
          columns: COLUMNS,
          mapping: MAPPING,
        },
        expectedVersion: null,
        reason: null,
        confirmed: true,
      },
    })
    expect(response.statusCode).toBe(201)
    return laborExcelProfileResponseSchema.parse(response.json()).profile
  }

  const candidates = (targetCaseId: string) => app.inject({
    method: 'GET',
    url: `/api/v1/cases/${targetCaseId}/labor-excel-profile-candidates`,
    headers: { cookie },
  })

  const setStatus = (
    profileId: string,
    status: 'active' | 'inactive',
    expectedVersion: number,
    reason: string | null,
  ) => app.inject({
    method: 'POST',
    url: `/api/v1/labor-excel-profiles/${profileId}/status`,
    headers: { cookie },
    payload: { status, expectedVersion, reason, confirmed: true },
  })

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })

    organizationId = uuidv7()
    userId = uuidv7()
    insurerId = uuidv7()
    otherInsurerId = uuidv7()
    caseWithInsurerId = uuidv7()
    caseWithoutInsurerId = uuidv7()
    await pool.query(
      "INSERT INTO organizations (id,code,name) VALUES ($1,'p63-main','P63 Sentetik')",
      [organizationId],
    )
    await pool.query(
      `INSERT INTO users (id,organization_id,email,display_name,password_hash)
       VALUES ($1,$2,'p63-admin@test.local','P63 Yönetici',$3)`,
      [userId, organizationId, await hashPassword(PASSWORD)],
    )
    await pool.query(
      "INSERT INTO user_roles (user_id,role_id) SELECT $1::uuid,id FROM roles WHERE code='admin'",
      [userId],
    )
    await pool.query(
      `INSERT INTO insurers (id,organization_id,name)
       VALUES ($1,$3,'Sentetik Sigorta A'),($2,$3,'Sentetik Sigorta B')`,
      [insurerId, otherInsurerId, organizationId],
    )
    await pool.query(
      `INSERT INTO cases
         (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
          workflow_stage,plate,plate_normalized,responsible_user_id,notification_date,version,insurer_id)
       VALUES
         ($1,$2,2026,6301,'2026/6301','traffic','open','reporting','34 EX 6301','34EX6301',$3,'2026-07-01',1,$4),
         ($5,$2,2026,6302,'2026/6302','traffic','open','reporting','34 EX 6302','34EX6302',$3,'2026-07-01',1,NULL)`,
      [caseWithInsurerId, organizationId, userId, insurerId, caseWithoutInsurerId],
    )

    app = buildApp({
      clock: fixedClock(NOW),
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 500, windowMs: 60_000 } },
      laborAllocationProviders: createDeterministicLaborAllocationProviderRegistry(),
      laborAllocationProviderId: 'deterministic-success',
    })
    await app.ready()
    const login = await app.inject({
      method: 'POST',
      url: AUTH_LOGIN_ROUTE,
      payload: { email: 'p63-admin@test.local', password: PASSWORD },
    })
    expect(login.statusCode).toBe(200)
    cookie = String(login.headers['set-cookie']).split(';')[0] as string
  })

  afterAll(async () => {
    await app?.close()
    await closeDatabasePool(pool)
  })

  it('hiç profil yokken açık boş durum döner ve öneri yapmaz', async () => {
    const response = await candidates(caseWithInsurerId)
    expect(response.statusCode).toBe(200)
    const body = laborExcelProfileCandidatesResponseSchema.parse(response.json())
    expect(body.candidates).toHaveLength(0)
    expect(body.suggestedProfileId).toBeNull()
    expect(body.reason).toBe('no_candidates')
    // Gerçek şablon dosyası OKUNMADI; sözleşme bunu literal olarak taşır.
    expect(body.templateVerified).toBe(false)
  })

  it('şirkete ait tek aktif profili önerir ve eşleşme bilgisini taşır', async () => {
    const profile = await createProfile('A Şablonu', insurerId)
    const body = laborExcelProfileCandidatesResponseSchema.parse(
      (await candidates(caseWithInsurerId)).json(),
    )
    expect(body.suggestedProfileId).toBe(profile.id)
    expect(body.reason).toBe('single_insurer_profile')
    const candidate = body.candidates[0]
    expect(candidate?.scope).toBe('insurer')
    expect(candidate?.insurerName).toBe('Sentetik Sigorta A')
    expect(candidate?.targetSheet).toBe('Föy')
    expect(candidate?.identityChecks).toEqual({ plate: true, officeNumber: false })
    // Eşlenmemiş türler açıkça listelenir; tutarları hiçbir sütuna yazılamaz.
    expect(candidate?.unmappedOperationTypes).toEqual(
      ['remove_install', 'paint', 'consumable', 'calibration', 'related_operation', 'other'],
    )
  })

  it('başka sigorta şirketinin profili aday değildir', async () => {
    await createProfile('B Şablonu', otherInsurerId)
    const body = laborExcelProfileCandidatesResponseSchema.parse(
      (await candidates(caseWithInsurerId)).json(),
    )
    expect(body.candidates.map((item) => item.name)).toEqual(['A Şablonu'])
    expect(body.suggestedProfileId).not.toBeNull()
  })

  it('genel profil adaydır ama öneriyi kendi başına üstlenmez', async () => {
    await createProfile('Genel Şablon', null)
    const body = laborExcelProfileCandidatesResponseSchema.parse(
      (await candidates(caseWithInsurerId)).json(),
    )
    expect(body.candidates.map((item) => item.scope).sort()).toEqual(['generic', 'insurer'])
    // Şirkete bağlı profil hâlâ tek olduğu için öneri korunur.
    expect(body.reason).toBe('single_insurer_profile')
  })

  it('sigorta şirketi olmayan dosyada yalnız genel profiller aday olur', async () => {
    const body = laborExcelProfileCandidatesResponseSchema.parse(
      (await candidates(caseWithoutInsurerId)).json(),
    )
    expect(body.insurerId).toBeNull()
    expect(body.candidates.map((item) => item.name)).toEqual(['Genel Şablon'])
    expect(body.suggestedProfileId).toBeNull()
    expect(body.reason).toBe('selection_required')
  })

  it('şirkete ait ikinci profil eklenince öneri düşer; seçim kullanıcıya kalır', async () => {
    await createProfile('A Şablonu 2', insurerId)
    const body = laborExcelProfileCandidatesResponseSchema.parse(
      (await candidates(caseWithInsurerId)).json(),
    )
    expect(body.suggestedProfileId).toBeNull()
    expect(body.reason).toBe('selection_required')
    expect(body.candidates.length).toBeGreaterThanOrEqual(3)
  })

  it('pasifleştirilen profil aday olmaz ama kaydı okunabilir kalır', async () => {
    const profile = await createProfile('Pasife Alınacak', insurerId)
    const deactivated = await setStatus(profile.id, 'inactive', profile.version, 'Şablon değişti')
    expect(deactivated.statusCode).toBe(200)
    const updated = laborExcelProfileResponseSchema.parse(deactivated.json()).profile
    expect(updated.status).toBe('inactive')
    expect(updated.deactivatedAt).not.toBeNull()
    expect(updated.statusReason).toBe('Şablon değişti')

    const body = laborExcelProfileCandidatesResponseSchema.parse(
      (await candidates(caseWithInsurerId)).json(),
    )
    expect(body.candidates.map((item) => item.profileId)).not.toContain(profile.id)

    // Profil SİLİNMEDİ; eski kayıtlarda okunabilir kalır.
    const listed = laborExcelProfilesResponseSchema.parse(
      (await app.inject({
        method: 'GET', url: '/api/v1/labor-excel-profiles', headers: { cookie },
      })).json(),
    )
    expect(listed.profiles.map((item) => item.id)).toContain(profile.id)
  })

  it('pasifleştirme gerekçesiz yapılamaz ve sürüm çakışması yakalanır', async () => {
    const profile = await createProfile('Gerekçesiz', insurerId)
    expect((await setStatus(profile.id, 'inactive', profile.version, null)).statusCode).toBe(400)
    expect((await setStatus(profile.id, 'inactive', profile.version + 5, 'Gerekçe')).statusCode)
      .toBe(409)
  })

  it('yeniden etkinleştirilen profil tekrar aday olur', async () => {
    const profile = await createProfile('Geri Gelecek', insurerId)
    const off = await setStatus(profile.id, 'inactive', profile.version, 'Geçici kapatma')
    const offProfile = laborExcelProfileResponseSchema.parse(off.json()).profile
    const on = await setStatus(offProfile.id, 'active', offProfile.version, null)
    expect(on.statusCode).toBe(200)
    const reactivated = laborExcelProfileResponseSchema.parse(on.json()).profile
    expect(reactivated.status).toBe('active')
    expect(reactivated.deactivatedAt).toBeNull()
    expect(reactivated.statusReason).toBeNull()

    const body = laborExcelProfileCandidatesResponseSchema.parse(
      (await candidates(caseWithInsurerId)).json(),
    )
    expect(body.candidates.map((item) => item.profileId)).toContain(profile.id)
  })

  it('geçersiz hedef sayfa adı profil kaydını reddeder', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/labor-excel-profiles',
      headers: { cookie },
      payload: {
        fields: {
          name: 'Kötü Sayfa',
          insurerId: null,
          targetSheet: 'Föy:1',
          identityChecks: { plate: false, officeNumber: false },
          columns: COLUMNS,
          mapping: MAPPING,
        },
        expectedVersion: null,
        reason: null,
        confirmed: true,
      },
    })
    expect(response.statusCode).toBe(400)
  })

  describe('projeksiyon seçilebilirliği sunucuda zorlanır', () => {
    let applicationId: string

    beforeAll(async () => {
      await pool.query(
        `INSERT INTO ai_provider_policies
           (id,organization_id,labor_allocation_enabled,labor_allocation_allowed_provider_ids,
            monthly_budget_minor,per_request_budget_minor)
         VALUES ($1,$2,true,ARRAY['deterministic-success']::text[],10000000,10000000)`,
        [uuidv7(), organizationId],
      )
      const sheet = await app.inject({
        method: 'POST',
        url: `/api/v1/cases/${caseWithInsurerId}/labor-sheet`,
        headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
        payload: {
          expectedCaseVersion: 1,
          confirmed: true,
          items: [{
            description: 'Ön tampon',
            action: 'Onarım',
            partAmountMinor: 0,
            laborAmountMinor: 1_000_000,
          }],
        },
      })
      expect(sheet.statusCode).toBe(201)
      const analyzed = await app.inject({
        method: 'POST',
        url: `/api/v1/cases/${caseWithInsurerId}/labor-allocation-ai/analyze`,
        headers: { cookie },
        payload: { expectedSheetVersion: 1, damageDescription: 'Ön darbe.', confirmedEgress: false },
      })
      const settled = await waitForRunTerminal(app, cookie, caseWithInsurerId, analyzed)
      const run = laborAllocationRunResponseSchema.parse(settled.json()).run
      const applied = await app.inject({
        method: 'POST',
        url: `/api/v1/cases/${caseWithInsurerId}/labor-allocation-ai/${run.id}/apply`,
        headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
        payload: {
          expectedSheetVersion: 1,
          reason: 'Onaylandı',
          confirmed: true,
          lines: [{
            lineOrdinal: 1,
            description: 'Ön tampon',
            action: 'Onarım',
            partAmountMinor: 0,
            laborAmountMinor: 1_000_000,
          }],
        },
      })
      expect(applied.statusCode).toBe(200)
      applicationId = (applied.json() as { application: { id: string } }).application.id
    })

    const project = (profileId: string) => app.inject({
      method: 'GET',
      url: `/api/v1/cases/${caseWithInsurerId}/labor-allocation-applications/${applicationId}`
        + `/excel-projection?profileId=${profileId}`,
      headers: { cookie },
    })

    it('başka şirkete ait profille projeksiyon reddedilir', async () => {
      const foreign = await createProfile('Yasak Şablon', otherInsurerId)
      expect((await project(foreign.id)).statusCode).toBe(409)
    })

    it('pasif profille yeni projeksiyon üretilmez', async () => {
      const profile = await createProfile('Pasif Projeksiyon', insurerId)
      expect((await setStatus(profile.id, 'inactive', profile.version, 'Kapatıldı')).statusCode)
        .toBe(200)
      expect((await project(profile.id)).statusCode).toBe(409)
    })

    it('genel profil her dosyada kullanılabilir', async () => {
      const generic = await createProfile('Genel Projeksiyon', null)
      const response = await project(generic.id)
      expect(response.statusCode).toBe(200)
      const body = laborExcelProjectionResponseSchema.parse(response.json())
      expect(body.written).toBe(false)
      expect(body.profileId).toBe(generic.id)
    })

    it('şirkete ait aktif profille projeksiyon üretilir', async () => {
      const profile = await createProfile('Geçerli Şablon', insurerId)
      const response = await project(profile.id)
      expect(response.statusCode).toBe(200)
      expect(laborExcelProjectionResponseSchema.parse(response.json()).written).toBe(false)
    })
  })
})
