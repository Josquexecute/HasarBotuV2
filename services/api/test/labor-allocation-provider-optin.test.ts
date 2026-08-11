import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type pg from 'pg'
import { AUTH_LOGIN_ROUTE, IDEMPOTENCY_KEY_HEADER } from '@hasarbotu/contracts'
import {
  assertTestDatabaseUrl,
  closeDatabasePool,
  createDatabasePool,
  runMigrations,
  uuidv7,
  type DatabaseConfig,
} from '@hasarbotu/database'
import {
  ConfigError,
  buildApp,
  createConfiguredLaborAllocationProviderRegistry,
  createGeminiLaborAllocationProvider,
  createLaborAllocationProviderRegistry,
  fixedClock,
  hashPassword,
  parseConfig,
} from '../src/index.js'

/**
 * Paket 55 — opt-in ve egress sınırı.
 *
 * Doğrulananlar: organization politikası açık değilse dış çağrı HİÇ yapılmaz,
 * deterministik harness üretimde kullanılamaz ve gerçek adaptör yalnız kendi
 * opt-in'i ile kayda girer.
 */
const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'p55-sentetik-guclu-parola-55'

const GEMINI_CONFIG = {
  apiKey: 'sentetik-anahtar-55',
  modelId: 'gemini-2.5-flash' as const,
  maximumInputCharacters: 50_000,
  maximumOutputSize: 100_000,
  maximumOutputTokens: 8_192,
}

describe('sağlayıcı kaydı ve yapılandırma sınırları', () => {
  it('gerçek adaptör yalnız opt-in ile kayda girer', () => {
    expect(createLaborAllocationProviderRegistry({}).list()).toHaveLength(0)
    const withGemini = createLaborAllocationProviderRegistry({
      gemini: createGeminiLaborAllocationProvider(GEMINI_CONFIG),
    })
    expect(withGemini.list().map((adapter) => adapter.providerId)).toEqual(['gemini-generate-content'])
    expect(withGemini.get('deterministic-success')).toBeUndefined()
  })

  it('deterministik harness yalnız açık izinle görünür', () => {
    expect(createLaborAllocationProviderRegistry({ allowDeterministic: false }).list()).toHaveLength(0)
    const allowed = createLaborAllocationProviderRegistry({ allowDeterministic: true })
    expect(allowed.get('deterministic-success')).toBeDefined()
  })

  it('üretimde deterministik sağlayıcı yapılandırması reddedilir', () => {
    const base = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://user:pw@127.0.0.1:5432/hasarbotu',
      LABOR_ALLOCATION_ALLOW_DETERMINISTIC_PROVIDERS: 'true',
    }
    expect(() => parseConfig(base)).toThrow(ConfigError)
  })

  it('opt-in yokken Gemini yapılandırması kurulmaz', () => {
    const config = parseConfig({
      NODE_ENV: 'development',
      GEMINI_API_KEY: 'sentetik',
    })
    expect(config.geminiLaborAllocationProvider).toBeUndefined()
    expect(config.laborAllocationAllowDeterministicProviders).toBe(false)
  })

  it('opt-in açıkken anahtar zorunludur', () => {
    expect(() => parseConfig({
      NODE_ENV: 'development',
      GEMINI_LABOR_ALLOCATION_PROVIDER_ENABLED: 'true',
      GEMINI_LABOR_ALLOCATION_MODEL: 'gemini-2.5-flash',
    })).toThrow(ConfigError)
  })

  /**
   * HB-2026-198 — kök neden: `server.ts`'in gerçek `startServer()` giriş
   * noktası `createConfiguredLaborAllocationProviderRegistry`'yi tanımlıyor
   * ama `buildApp()` çağrısına hiç geçirmiyordu; sonuç olarak production'da
   * `laborAllocationProviders` seçeneği hep `undefined` kalıyor ve
   * `buildApp()`'in KENDİ (yalnız test amaçlı) `createDeterministicLaborAllocationProviderRegistry()`
   * varsayılanı sessizce devreye giriyordu — `NODE_ENV=production`'da
   * deterministik sağlayıcıları açıkça yasaklayan config kapısı (yukarıdaki
   * "üretimde deterministik sağlayıcı yapılandırması reddedilir" testi) bu
   * yolla tamamen atlanıyordu. Bu iki test, düzeltilmiş `server.ts`
   * kompozisyonunun `parseConfig` çıktısından TAM OLARAK ürettiği registry'yi
   * doğrudan, ağ çağrısı yapmadan sınar.
   */
  it('server kompozisyonu: hiç opt-in yokken registry BOŞ kalır (sahte determinist devreye girmez)', () => {
    const config = parseConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://user:pw@127.0.0.1:5432/hasarbotu',
    })
    expect(createConfiguredLaborAllocationProviderRegistry(config).list()).toHaveLength(0)
  })

  it('server kompozisyonu: opt-in açıkken registry TAM OLARAK gerçek Gemini adaptörünü içerir, secret sızdırmaz', () => {
    const secret = 'sentetik-server-wiring-anahtari-198'
    const config = parseConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://user:pw@127.0.0.1:5432/hasarbotu',
      GEMINI_LABOR_ALLOCATION_PROVIDER_ENABLED: 'true',
      GEMINI_API_KEY: secret,
      GEMINI_LABOR_ALLOCATION_MODEL: 'gemini-2.5-flash',
    })
    const descriptors = createConfiguredLaborAllocationProviderRegistry(config).list()
    expect(descriptors).toHaveLength(1)
    expect(descriptors[0]).toMatchObject({
      providerId: 'gemini-generate-content',
      modelId: 'gemini-2.5-flash',
      externalProvider: true,
    })
    expect(JSON.stringify(descriptors)).not.toContain(secret)
  })
})

describeDb('organization opt-in olmadan egress yapılmaz', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let organizationId: string
  let userId: string
  let caseId: string

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    organizationId = uuidv7()
    userId = uuidv7()
    caseId = uuidv7()
    await pool.query("INSERT INTO organizations (id,code,name) VALUES ($1,'p55','P55 Sentetik')", [organizationId])
    await pool.query(
      `INSERT INTO users (id,organization_id,email,display_name,password_hash)
       VALUES ($1,$2,'p55@test.local','P55 Sorumlu',$3)`,
      [userId, organizationId, await hashPassword(PASSWORD)],
    )
    await pool.query(
      "INSERT INTO user_roles (user_id,role_id) SELECT $1::uuid,id FROM roles WHERE code='case_manager'",
      [userId],
    )
    await pool.query(
      `INSERT INTO cases
         (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
          workflow_stage,plate,plate_normalized,responsible_user_id,notification_date,version)
       VALUES ($1,$2,2026,5501,'2026/5501','traffic','open','reporting','34 PB 5501','34PB5501',$3,'2026-07-01',1)`,
      [caseId, organizationId, userId],
    )
  }, 180_000)

  afterAll(async () => {
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  it('politika kapalıyken sağlayıcı hiç çağrılmaz', async () => {
    let calls = 0
    const spyProvider = {
      ...createGeminiLaborAllocationProvider(GEMINI_CONFIG),
      execute: async () => {
        calls += 1
        throw new Error('cagrilmamali')
      },
    }
    const app = buildApp({
      clock: fixedClock('2026-07-18T10:30:00.000Z'),
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 100, windowMs: 60_000 } },
      laborAllocationProviders: createLaborAllocationProviderRegistry({ gemini: spyProvider }),
      laborAllocationProviderId: 'gemini-generate-content',
    })
    const login = await app.inject({
      method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email: 'p55@test.local', password: PASSWORD },
    })
    const cookie = String(login.headers['set-cookie']).split(';')[0] as string

    const sheet = await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/labor-sheet`,
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        expectedCaseVersion: 1,
        items: [{ description: 'Ön tampon', action: 'Onarım', partAmountMinor: 0, laborAmountMinor: 10_000_00 }],
        confirmed: true,
      },
    })
    expect(sheet.statusCode).toBe(201)

    // `ai_provider_policies` satırı yok: opt-in yok.
    const response = await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/labor-allocation-ai/analyze`,
      headers: { cookie },
      payload: { expectedSheetVersion: 1, damageDescription: 'Ön darbe.', confirmedEgress: true },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().run.status).toBe('provider_disabled')
    expect(calls).toBe(0)

    // Sağlayıcı makbuzu da oluşmaz: dış çağrı hiç başlamadı.
    const receipts = await pool.query(
      'SELECT count(*)::int AS n FROM labor_allocation_provider_receipts WHERE organization_id=$1',
      [organizationId],
    )
    expect(receipts.rows[0].n).toBe(0)
    await app.close()
  })

  it('kullanıcı egress onayı olmadan dış sağlayıcı çağrılmaz', async () => {
    await pool.query(
      `INSERT INTO ai_provider_policies
         (id,organization_id,labor_allocation_enabled,labor_allocation_allowed_provider_ids,
          monthly_budget_minor,per_request_budget_minor)
       VALUES ($1,$2,true,ARRAY['gemini-generate-content']::text[],1000000,1000000)
       ON CONFLICT (organization_id) DO UPDATE
         SET labor_allocation_enabled=true,
             labor_allocation_allowed_provider_ids=EXCLUDED.labor_allocation_allowed_provider_ids`,
      [uuidv7(), organizationId],
    )
    let calls = 0
    const spyProvider = {
      ...createGeminiLaborAllocationProvider(GEMINI_CONFIG),
      execute: async () => {
        calls += 1
        throw new Error('cagrilmamali')
      },
    }
    const app = buildApp({
      clock: fixedClock('2026-07-18T10:30:00.000Z'),
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 100, windowMs: 60_000 } },
      laborAllocationProviders: createLaborAllocationProviderRegistry({ gemini: spyProvider }),
      laborAllocationProviderId: 'gemini-generate-content',
    })
    const login = await app.inject({
      method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email: 'p55@test.local', password: PASSWORD },
    })
    const cookie = String(login.headers['set-cookie']).split(';')[0] as string

    const response = await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/labor-allocation-ai/analyze`,
      headers: { cookie },
      // Dış sağlayıcı seçili ama kullanıcı egress onayı vermedi.
      payload: { expectedSheetVersion: 1, damageDescription: 'Ön darbe.', confirmedEgress: false },
    })
    expect(response.statusCode).toBe(409)
    expect(calls).toBe(0)
    await app.close()
  })

  it('server.ts kompozisyonu birebir: hiç yapılandırma yokken analiz eninde sonunda provider_disabled\'a düşer, sahte çıktı asla review_required\'a geçmez (HB-2026-198 regresyon kilidi)', async () => {
    // `parseConfig({})` + `createConfiguredLaborAllocationProviderRegistry` --
    // `server.ts`'in gerçek `startServer()` içinde ürettiği TAM ikili budur.
    // Düzeltmeden ÖNCE bu registry hiç geçirilmiyordu ve `buildApp()` kendi
    // determinist (yalnız test amaçlı, `controlRequired:true` sabit) sahte
    // çıktısını üretiyordu -- kullanıcı bunu gerçek bir AI cevabı sanabilirdi.
    const config = parseConfig({})
    const registry = createConfiguredLaborAllocationProviderRegistry(config)
    expect(registry.list()).toHaveLength(0)

    const app = buildApp({
      clock: fixedClock('2026-07-18T10:30:00.000Z'),
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 100, windowMs: 60_000 } },
      laborAllocationProviders: registry,
      // server.ts da aynı şekilde: config.geminiLaborAllocationProvider
      // tanımsızken laborAllocationProviderId hiç geçirilmez.
    })
    const login = await app.inject({
      method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email: 'p55@test.local', password: PASSWORD },
    })
    const cookie = String(login.headers['set-cookie']).split(';')[0] as string

    const response = await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/labor-allocation-ai/analyze`,
      headers: { cookie },
      payload: { expectedSheetVersion: 1, damageDescription: 'Ön darbe.', confirmedEgress: true },
    })
    expect(response.statusCode).toBe(200)
    const runId = (response.json() as { run: { id: string; status: string } }).run.id

    // Paket 62'den beri analiz ARKA PLANDA yürür (fire-and-forget); ilk yanıt
    // hâlâ 'queued' olabilir. Nihai/terminal duruma geçene kadar yoklarız --
    // eski (düzeltme öncesi) kodda bu asla 'provider_disabled'a düşmez,
    // determinist sahte çıktıyla 'review_required'a giderdi.
    let status = (response.json() as { run: { status: string } }).run.status
    for (let attempt = 0; attempt < 60 && status === 'queued'; attempt += 1) {
      await new Promise((resolve) => { setTimeout(resolve, 25) })
      const poll = await app.inject({
        method: 'GET', url: `/api/v1/cases/${caseId}/labor-allocation-ai/${runId}`, headers: { cookie },
      })
      status = (poll.json() as { run: { status: string } }).run.status
    }
    expect(status).toBe('provider_disabled')
    await app.close()
  })
})
