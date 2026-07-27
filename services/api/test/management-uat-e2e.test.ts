import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AUTH_LOGIN_ROUTE,
  AUTH_SESSION_ROUTE,
  CASES_ROUTE,
  EXPERTS_REFERENCE_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  USERS_REFERENCE_ROUTE,
  expertsReferenceResponseSchema,
  sessionResponseSchema,
  usersReferenceResponseSchema,
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

/**
 * UAT-tarzı uçtan uca doğrulama: Yönetim modülü için gerçek kullanıcı/rol/
 * eksper referansları → yetki değişikliği → tenant izolasyonu → oturum
 * yenileme zincirini, sentetik SQL ile onaylı sürüm enjekte etmeden sürer.
 *
 * ÖNEMLİ BULGU (kusur değil, belgelenmiş kapsam boşluğu): "Yönetim" sayfası
 * bugün GERÇEK bir yönetim konsolu DEĞİLDİR. Kullanıcılar/Servisler
 * sekmeleri yalnız salt-okunur referans listeleridir (`GET /references/*`,
 * `services/api/src/references/routes.ts`); "Erişim ve Yetki" sekmesi
 * tamamen statik metindir. Hiçbir kullanıcı oluşturma, rol atama veya
 * servis/eksper referans CRUD ucu YOKTUR — bu, HB-2026-053/Paket 47'de
 * (`docs/DECISION_LOG.md`) tekrarlanan biçimde KASITLI olarak kapsam dışı
 * bırakılmıştır ("Yeni tablo, migration, endpoint veya sözleşme eklenmez").
 * Bu görev kapsamında yeni bir rol atama API'si veya UI'ı EKLENMEMİŞTİR
 * (bu, tek bir UAT görevinin kapsamını aşan yeni bir paket gerektirir).
 *
 * Bunun yerine bu test, "yetki değişikliği" (authorization change) zincirini
 * bugün GERÇEKTEN var olan tek mekanizmayla — `user_roles`/`users.status`
 * doğrudan mutasyonu, yani gelecekteki bir rol atama API'sinin sonunda
 * kendisi de yapacağı persistence adımı — sürer ve ASIL doğrulanması
 * gereken üretim davranışını kanıtlar: `services/api/src/auth/store.ts`
 * `findActiveSession()` rolleri HER İSTEKTE canlı JOIN ile çözer (oturum
 * satırında rol önbelleği YOKTUR). Yani zaten AÇIK olan bir oturum, yeniden
 * giriş yapılmadan, bir SONRAKİ isteğinde değişikliği anında yansıtır —
 * hem yetki YÜKSELTİLİRKEN hem de yetki GERİ ALINIRKEN/hesap DEVRE DIŞI
 * BIRAKILIRKEN. Bu, mevcut `references.test.ts`'in (401/tenant/aktif-
 * filtre/anlaşma değerlendirmesi, ~130 satır) hiç dokunmadığı gerçek
 * bir boşluktur; bu test onu TEKRARLAMAZ.
 */

const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'uat-yonetim-sentetik-guclu-parola-27'

describeDb('Yönetim uçtan uca UAT: gerçek kullanıcı/rol/eksper referansı → yetki değişikliği → tenant izolasyonu → oturum yenileme (gerçek PostgreSQL)', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let orgAId: string
  let orgBId: string
  let probeUserId: string
  let observerACookie: string
  let probeCookie: string
  let managerBCookie: string

  async function seedUser(orgId: string, email: string, role: string): Promise<string> {
    const id = uuidv7()
    await pool.query(
      'INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4,$5)',
      [id, orgId, email, email, await hashPassword(PASSWORD)],
    )
    await pool.query(
      "INSERT INTO user_roles (user_id,role_id) SELECT $1::uuid,id FROM roles WHERE code=$2",
      [id, role],
    )
    return id
  }

  async function login(email: string): Promise<string> {
    const response = await app.inject({
      method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email, password: PASSWORD },
    })
    expect(response.statusCode).toBe(200)
    return String(response.headers['set-cookie']).split(';')[0] as string
  }

  async function setProbeRole(role: string | null): Promise<void> {
    await pool.query('DELETE FROM user_roles WHERE user_id=$1', [probeUserId])
    if (role !== null) {
      await pool.query(
        "INSERT INTO user_roles (user_id,role_id) SELECT $1::uuid,id FROM roles WHERE code=$2",
        [probeUserId, role],
      )
    }
  }

  let attemptSequence = 0
  async function attemptCreateCase(cookie: string): Promise<number> {
    attemptSequence += 1
    const response = await app.inject({
      method: 'POST', url: CASES_ROUTE,
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { caseType: 'traffic', plate: `34 YNT ${String(1000 + attemptSequence).padStart(4, '0')}` },
    })
    return response.statusCode
  }

  async function currentSessionRoles(cookie: string): Promise<{ statusCode: number; roles?: readonly string[] }> {
    const response = await app.inject({ method: 'GET', url: AUTH_SESSION_ROUTE, headers: { cookie } })
    if (response.statusCode !== 200) return { statusCode: response.statusCode }
    const parsed = sessionResponseSchema.parse(response.json())
    return { statusCode: 200, roles: parsed.user.roles }
  }

  async function expertNames(cookie: string): Promise<readonly string[]> {
    const response = await app.inject({ method: 'GET', url: EXPERTS_REFERENCE_ROUTE, headers: { cookie } })
    expect(response.statusCode).toBe(200)
    return expertsReferenceResponseSchema.parse(response.json()).items.map((item) => item.displayName)
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })

    orgAId = uuidv7()
    orgBId = uuidv7()
    await pool.query(
      "INSERT INTO organizations (id,code,name) VALUES ($1,'uat-yonetim-a','UAT Yönetim A'),($2,'uat-yonetim-b','UAT Yönetim B')",
      [orgAId, orgBId],
    )
    await seedUser(orgAId, 'uat-yonetim-observer-a@test.local', 'admin')
    probeUserId = await seedUser(orgAId, 'uat-yonetim-probe-a@test.local', 'read_only')
    await seedUser(orgBId, 'uat-yonetim-manager-b@test.local', 'case_manager')

    app = buildApp({
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 500, windowMs: 60_000 } },
    })
    await app.ready()
    observerACookie = await login('uat-yonetim-observer-a@test.local')
    probeCookie = await login('uat-yonetim-probe-a@test.local')
    managerBCookie = await login('uat-yonetim-manager-b@test.local')
  }, 60_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  it('yetki değişikliği (yükseltme, geri alma, hesap devre dışı bırakma) zaten açık bir oturumda yeniden giriş yapılmadan anında yansır; tenant sınırı korunur', async () => {
    // 1) BAŞLANGIÇ: probe kullanıcı read_only. Yazma reddedilir, eksper
    //    referans listesinde görünmez (henüz 'expert' rolü yok).
    expect(await attemptCreateCase(probeCookie)).toBe(403)
    expect(await expertNames(observerACookie)).not.toContain('uat-yonetim-probe-a@test.local')
    const baseline = await currentSessionRoles(probeCookie)
    expect(baseline).toEqual({ statusCode: 200, roles: ['read_only'] })

    // 2) YETKİ YÜKSELTME — bugün yalnız doğrudan persistence mutasyonuyla
    //    mümkün (gerçek rol atama API'si yok, yukarıdaki dosya başlığına bkz.).
    //    probeCookie ASLA yeniden giriş yapmaz; AYNI oturum kullanılır.
    await setProbeRole('expert')
    const afterPromotion = await currentSessionRoles(probeCookie)
    expect(afterPromotion).toEqual({ statusCode: 200, roles: ['expert'] })
    expect(await attemptCreateCase(probeCookie)).toBe(201)
    expect(await expertNames(observerACookie)).toContain('uat-yonetim-probe-a@test.local')

    // 3) YETKİ GERİ ALMA — aynı canlı çözümleme, tersi yönde de anında çalışır.
    await setProbeRole('read_only')
    const afterDemotion = await currentSessionRoles(probeCookie)
    expect(afterDemotion).toEqual({ statusCode: 200, roles: ['read_only'] })
    expect(await attemptCreateCase(probeCookie)).toBe(403)
    expect(await expertNames(observerACookie)).not.toContain('uat-yonetim-probe-a@test.local')

    // 4) EN SERT YETKİ DEĞİŞİKLİĞİ: hesap devre dışı bırakma. Oturum satırı
    //    silinmez/iptal edilmez (revoked_at hâlâ NULL) ama `findActiveSession`
    //    `u.status='active'` şartını canlı sorguladığından AYNI çerez artık
    //    hiçbir korumalı uca erişemez.
    await pool.query("UPDATE users SET status='disabled' WHERE id=$1", [probeUserId])
    expect((await currentSessionRoles(probeCookie)).statusCode).toBe(401)
    expect(await attemptCreateCase(probeCookie)).toBe(401)
    const usersAfterDisable = usersReferenceResponseSchema.parse((await app.inject({
      method: 'GET', url: USERS_REFERENCE_ROUTE, headers: { cookie: observerACookie },
    })).json())
    expect(usersAfterDisable.items.some((item) => item.displayName === 'uat-yonetim-probe-a@test.local')).toBe(false)

    // 5) TENANT İZOLASYONU: org A'nın probe kullanıcısı üzerindeki tüm bu
    //    mutasyonlar org B'nin kendi oturumunu/rolünü hiç etkilemedi.
    const orgBRoles = await currentSessionRoles(managerBCookie)
    expect(orgBRoles).toEqual({ statusCode: 200, roles: ['case_manager'] })
    expect(await attemptCreateCase(managerBCookie)).toBe(201)
    const orgBExperts = await expertNames(managerBCookie)
    expect(orgBExperts.some((name) => name.includes('probe-a'))).toBe(false)
  }, 60_000)
})
