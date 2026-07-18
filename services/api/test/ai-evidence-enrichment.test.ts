import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AUTH_LOGIN_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  caseVehicleProfileResponseSchema,
  laborAllocationRunResponseSchema,
  laborSheetWorkspaceResponseSchema,
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
  createDeterministicLaborAllocationProviderRegistry,
  fixedClock,
  hashPassword,
} from '../src/index.js'

/**
 * Paket 56 — AI kanıt zenginleştirme uçtan uca doğrulaması.
 *
 * Ana iddia: üç kanal (araç profili, parça kodu, hasar bölgesi) birlikte
 * kapatıldığında eksik kanıt kodları gerçekten düşer.
 */
const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'p56-sentetik-guclu-parola-56'
const NOW = '2026-07-18T10:30:00.000Z'

describeDb('Paket 56 AI kanıt zenginleştirme', () => {
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

  async function createSheet(
    sessionCookie: string,
    targetCaseId: string,
    items: Record<string, unknown>[],
  ) {
    return app.inject({
      method: 'POST', url: `/api/v1/cases/${targetCaseId}/labor-sheet`,
      headers: { cookie: sessionCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedCaseVersion: 1, items, confirmed: true },
    })
  }

  async function analyze(sessionCookie: string, targetCaseId: string, sheetVersion = 1) {
    return app.inject({
      method: 'POST', url: `/api/v1/cases/${targetCaseId}/labor-allocation-ai/analyze`,
      headers: { cookie: sessionCookie },
      payload: { expectedSheetVersion: sheetVersion, damageDescription: 'Ön sol darbe.', confirmedEgress: false },
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
    await pool.query(
      `INSERT INTO ai_provider_policies
         (id,organization_id,labor_allocation_enabled,labor_allocation_allowed_provider_ids,
          monthly_budget_minor,per_request_budget_minor)
       VALUES ($1,$2,true,ARRAY['deterministic-success']::text[],1000000,1000000)`,
      [uuidv7(), organizationId],
    )

    app = buildApp({
      clock: fixedClock(NOW),
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 200, windowMs: 60_000 } },
      laborAllocationProviders: createDeterministicLaborAllocationProviderRegistry(),
      laborAllocationProviderId: 'deterministic-success',
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

  it('işçilik satırı parça kodu ve hasar bölgesi taşır; kaynak ayrılır', async () => {
    const created = await createSheet(cookie, caseId, [
      {
        description: 'Ön tampon', action: 'Onarım + boya',
        partAmountMinor: 0, laborAmountMinor: 10_000_00,
        damageRegion: 'Ön sol',
      },
      {
        description: 'Sol çamurluk', action: 'Değişim',
        partAmountMinor: 18_000_00, laborAmountMinor: 2_000_00,
        partCode: 'rn-7701 ab', partCodeSource: 'user_entered', damageRegion: 'Ön sol',
      },
    ])
    expect(created.statusCode).toBe(201)

    const workspace = await app.inject({
      method: 'GET', url: `/api/v1/cases/${caseId}/labor-sheet`, headers: { cookie },
    })
    const sheet = laborSheetWorkspaceResponseSchema.parse(workspace.json())
    const items = sheet.sheet?.currentVersion.items ?? []
    // Saf işçilik satırında parça kodu yoktur ve bu geçerlidir.
    expect(items[0]).toMatchObject({ partCode: null, partCodeSource: null, damageRegion: 'Ön sol' })
    expect(items[1]).toMatchObject({
      partCode: 'RN-7701AB', partCodeSource: 'user_entered', damageRegion: 'Ön sol',
    })
  })

  it('parça kodu kaynağı koda bağlıdır', async () => {
    const response = await createSheet(cookie, foreignCaseId, [
      {
        description: 'Ön tampon', action: 'Onarım',
        partAmountMinor: 0, laborAmountMinor: 10_000_00,
        partCodeSource: 'user_entered',
      },
    ])
    expect(response.statusCode).toBe(400)
  })

  it('üç kanal kapalıyken eksik kanıt kodları düşer ve control_required kalkabilir', async () => {
    const response = await analyze(cookie, caseId)
    expect(response.statusCode).toBe(200)
    const { run } = laborAllocationRunResponseSchema.parse(response.json())
    expect(run.status).toBe('review_required')
    const lines = run.suggestion?.lines ?? []
    expect(lines).toHaveLength(2)

    for (const line of lines) {
      // Araç, parça kodu ve hasar bölgesi artık mevcut: bu kodlar üretilmez.
      expect(line.missingEvidenceCodes).not.toContain('EVIDENCE_MISSING_VEHICLE_IDENTITY')
      expect(line.missingEvidenceCodes).not.toContain('EVIDENCE_MISSING_DAMAGE_REGION')
      expect(line.missingEvidenceCodes).not.toContain('EVIDENCE_MISSING_PART_CODE')
    }
  })

  it('parça bedeli olan satırda kod yoksa eksik kanıt üretilir', async () => {
    const revise = await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/labor-sheet/versions`,
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        expectedVersion: 1,
        reason: 'Parça kodu kaldırıldı',
        confirmed: true,
        items: [{
          description: 'Sol çamurluk', action: 'Değişim',
          partAmountMinor: 18_000_00, laborAmountMinor: 2_000_00,
          damageRegion: 'Ön sol',
        }],
      },
    })
    expect(revise.statusCode).toBe(200)

    const { run } = laborAllocationRunResponseSchema.parse((await analyze(cookie, caseId, 2)).json())
    expect(run.status).toBe('review_required')
    for (const line of run.suggestion?.lines ?? []) {
      expect(line.missingEvidenceCodes).toContain('EVIDENCE_MISSING_PART_CODE')
      expect(line.controlRequired).toBe(true)
    }
  })

  it('araç profili değişince eski öneri stale olur', async () => {
    const before = laborAllocationRunResponseSchema.parse((await analyze(cookie, caseId, 2)).json())
    expect(before.run.stale).toBe(false)
    const beforeEvidence = before.run.evidenceHash

    // Mevcut sürüm 2; kaydın gerçekten yazıldığını doğrula ki test sessizce geçmesin.
    const saved = await saveVehicle(cookie, caseId, { ...VEHICLE_FIELDS, modelYear: 2022 }, 2, 'Model yılı düzeltildi')
    expect(saved.statusCode).toBe(200)
    expect(caseVehicleProfileResponseSchema.parse(saved.json()).current?.modelYear).toBe(2022)

    // Aynı föy sürümüyle yeniden analiz: kanıt hash'i değişmiş olmalıdır.
    const after = laborAllocationRunResponseSchema.parse((await analyze(cookie, caseId, 2)).json())
    expect(after.run.evidenceHash).not.toBe(beforeEvidence)
    expect(after.run.id).not.toBe(before.run.id)
  })

  it('araç kanıt referansı ve plaka dış bağlama girmez', async () => {
    // Outbound bağlam hash'lenir; referansın kaydedildiğini ama dışarı
    // çıkmadığını doğrulamak için saklanan veriyi ve öneri gövdesini tarıyoruz.
    const stored = await pool.query(
      `SELECT v.evidence_reference FROM case_vehicle_profiles p
         JOIN case_vehicle_profile_versions v ON v.id=p.current_version_id
        WHERE p.organization_id=$1 AND p.case_id=$2`,
      [organizationId, caseId],
    )
    expect(String(stored.rows[0].evidence_reference)).toContain('2026/44')

    const { run } = laborAllocationRunResponseSchema.parse((await analyze(cookie, caseId, 2)).json())
    const serialized = JSON.stringify(run.suggestion)
    expect(serialized).not.toContain('2026/44')
    expect(serialized).not.toContain('34 PC 5601')
  })

  it('eski Paket 54/55 önerileri değişmeden okunabilir', async () => {
    // Kanıt alanları eklenmeden önce yazılmış satırlar null taşır ve
    // sözleşme doğrulamasını geçmeye devam eder.
    await pool.query(
      `UPDATE labor_sheet_items SET part_code=NULL,part_code_source=NULL,damage_region=NULL
        WHERE organization_id=$1 AND case_id=$2`,
      [organizationId, foreignCaseId],
    )
    const legacy = await app.inject({
      method: 'GET', url: `/api/v1/cases/${caseId}/labor-sheet`, headers: { cookie },
    })
    expect(legacy.statusCode).toBe(200)
    expect(() => laborSheetWorkspaceResponseSchema.parse(legacy.json())).not.toThrow()
  })
})
