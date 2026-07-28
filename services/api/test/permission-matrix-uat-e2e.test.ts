import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AUTH_LOGIN_ROUTE,
  AUTH_SESSION_ROUTE,
  CASES_ROUTE,
  CASE_FILE_OPERATION_PLAN_ROUTE,
  CASE_LOCATION_ROUTE,
  CASE_WORKSPACE_PLANS_ROUTE,
  DOCUMENTS_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  USERS_ROUTE,
  USER_ROLES_ROUTE,
  caseDetailResponseSchema,
  sessionResponseSchema,
  usersResponseSchema,
  userResponseSchema,
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
 * UAT-tarzı uçtan uca doğrulama: HB-011 kaynak-bazlı yetki matrisi paketi
 * için gerçek kullanıcı/rol referansları → yetki değişikliği (artık gerçek
 * `PATCH /api/v1/users/:userId/roles` ucuyla, SQL enjeksiyonu değil) →
 * tenant izolasyonu → önceden bulunan write-role boşluklarının kapandığını
 * tek akışta doğrular.
 *
 * Bu paket öncesinde (bkz. `docs/PROJECT_STATUS.md` Yönetim UAT girdisi,
 * 2026-07-27) rol değişikliği yalnız doğrudan `user_roles` SQL mutasyonuyla
 * mümkündü — gerçek bir rol atama API'si/UI'ı yoktu. Bu test, o zamanki
 * SQL tabanlı "canlı oturum çözümlemesi" kanıtını GERÇEK API üzerinden
 * tekrarlar ve ayrıca bu görevde HARİTALANIP KAPATILAN dört gerçek write-role
 * boşluğunu (file-operations, workspace, storage/case-location, documents)
 * kanıtlar — bunlar önceden yalnız `requireSession` kullanıyordu, `read_only`
 * dahi fiziksel klasör taşıma/oluşturma planlayıp evrak kaydı girebiliyordu.
 *
 * Mali alan görünürlüğü (`includesFinancials`, `GET /fees` ve
 * `GET /cases/:caseId/fee` üzerindeki 403) `reports-fees-uat-e2e.test.ts`'te
 * ayrıca kanıtlıdır; burada TEKRARLANMAZ.
 */

const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'uat-yetki-matrisi-sentetik-guclu-parola-27'
const ROOT_KEY = 'uat-yetki-matrisi-root'

describeDb('HB-011 yetki matrisi uçtan uca UAT: gerçek rol ataması → tenant izolasyonu → write-role boşluk kapanışı (gerçek PostgreSQL)', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let orgAId: string
  let orgBId: string
  let adminAId: string
  let promoteTargetAId: string
  let adminACookie: string
  let secretaryACookie: string
  let readOnlyGateCookie: string
  let promoteTargetCookie: string
  let adminBCookie: string

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
    const response = await app.inject({ method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email, password: PASSWORD } })
    expect(response.statusCode).toBe(200)
    return String(response.headers['set-cookie']).split(';')[0] as string
  }

  async function attemptCreateCase(cookie: string): Promise<number> {
    const response = await app.inject({
      method: 'POST', url: CASES_ROUTE,
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { caseType: 'traffic', plate: `34 YMX ${Math.floor(Math.random() * 8999 + 1000)}` },
    })
    return response.statusCode
  }

  async function sessionRoles(cookie: string): Promise<{ statusCode: number; roles?: readonly string[] }> {
    const response = await app.inject({ method: 'GET', url: AUTH_SESSION_ROUTE, headers: { cookie } })
    if (response.statusCode !== 200) return { statusCode: response.statusCode }
    return { statusCode: 200, roles: sessionResponseSchema.parse(response.json()).user.roles }
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })

    orgAId = uuidv7()
    orgBId = uuidv7()
    await pool.query(
      "INSERT INTO organizations (id,code,name) VALUES ($1,'uat-yetki-a','UAT Yetki A'),($2,'uat-yetki-b','UAT Yetki B')",
      [orgAId, orgBId],
    )
    adminAId = await seedUser(orgAId, 'uat-yetki-admin-a@test.local', 'admin')
    await seedUser(orgAId, 'uat-yetki-secretary-a@test.local', 'secretary')
    await seedUser(orgAId, 'uat-yetki-readonly-gate-a@test.local', 'read_only')
    promoteTargetAId = await seedUser(orgAId, 'uat-yetki-promote-a@test.local', 'read_only')
    await seedUser(orgBId, 'uat-yetki-admin-b@test.local', 'admin')
    await pool.query('INSERT INTO storage_roots (id,organization_id,root_key,label) VALUES ($1,$2,$3,$4)',
      [uuidv7(), orgAId, ROOT_KEY, 'UAT Yetki Matrisi Kök'])

    app = buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false, loginRateLimit: { limit: 500, windowMs: 60_000 } } })
    await app.ready()
    adminACookie = await login('uat-yetki-admin-a@test.local')
    secretaryACookie = await login('uat-yetki-secretary-a@test.local')
    readOnlyGateCookie = await login('uat-yetki-readonly-gate-a@test.local')
    promoteTargetCookie = await login('uat-yetki-promote-a@test.local')
    adminBCookie = await login('uat-yetki-admin-b@test.local')
  }, 60_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  it('gerçek rol ataması → canlı oturum yansıması → self-lockout/version-conflict → tenant izolasyonu → write-role boşluk kapanışı zincirini tek akışta doğrular', async () => {
    // 1) LİSTE — yalnız admin görebilir.
    expect((await app.inject({ method: 'GET', url: USERS_ROUTE, headers: { cookie: secretaryACookie } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: USERS_ROUTE })).statusCode).toBe(401)
    const listA = usersResponseSchema.parse((await app.inject({
      method: 'GET', url: USERS_ROUTE, headers: { cookie: adminACookie },
    })).json())
    expect(listA.items.map((item) => item.email).sort()).toEqual([
      'uat-yetki-admin-a@test.local', 'uat-yetki-promote-a@test.local',
      'uat-yetki-readonly-gate-a@test.local', 'uat-yetki-secretary-a@test.local',
    ].sort())
    const promoteTargetBefore = listA.items.find((item) => item.id === promoteTargetAId)
    expect(promoteTargetBefore).toMatchObject({ roles: ['read_only'], version: 1 })

    // 2) GERÇEK YETKİ YÜKSELTME — SQL değil, gerçek PATCH. Hedef kullanıcının
    //    ZATEN açık oturumu (promoteTargetCookie) yeniden giriş yapmadan
    //    değişikliği bir sonraki istekte yansıtır.
    expect(await attemptCreateCase(promoteTargetCookie)).toBe(403)
    const promoteResponse = await app.inject({
      method: 'PATCH', url: USER_ROLES_ROUTE.replace(':userId', promoteTargetAId),
      headers: { cookie: adminACookie, 'content-type': 'application/json' },
      payload: { roles: ['case_manager'], expectedVersion: 1 },
    })
    expect(promoteResponse.statusCode, promoteResponse.payload).toBe(200)
    const promoted = userResponseSchema.parse(promoteResponse.json()).user
    expect(promoted).toMatchObject({ roles: ['case_manager'], version: 2 })
    expect((await sessionRoles(promoteTargetCookie)).roles).toEqual(['case_manager'])
    expect(await attemptCreateCase(promoteTargetCookie)).toBe(201)

    // 3) SÜRÜM ÇAKIŞMASI — bayat `expectedVersion` (artık 2, hâlâ 1 gönderilirse) reddedilir.
    const staleAttempt = await app.inject({
      method: 'PATCH', url: USER_ROLES_ROUTE.replace(':userId', promoteTargetAId),
      headers: { cookie: adminACookie, 'content-type': 'application/json' },
      payload: { roles: ['read_only'], expectedVersion: 1 },
    })
    expect(staleAttempt.statusCode).toBe(409)
    expect((await pool.query('SELECT version FROM users WHERE id=$1', [promoteTargetAId])).rows[0]).toEqual({ version: 2 })

    // 4) SELF-LOCKOUT KORUMASI — admin kendi admin rolünü kaldıramaz.
    const lockoutAttempt = await app.inject({
      method: 'PATCH', url: USER_ROLES_ROUTE.replace(':userId', adminAId),
      headers: { cookie: adminACookie, 'content-type': 'application/json' },
      payload: { roles: ['expert'], expectedVersion: 1 },
    })
    expect(lockoutAttempt.statusCode).toBe(409)
    expect((lockoutAttempt.json() as { error: { code: string } }).error.code).toBe('user_self_lockout_blocked')
    // Admin GERÇEKTEN admin kalmaya devam eder: kendi listesini hâlâ görebilir.
    expect((await app.inject({ method: 'GET', url: USERS_ROUTE, headers: { cookie: adminACookie } })).statusCode).toBe(200)

    // 5) TENANT İZOLASYONU — org A yöneticisi org B'nin kullanıcısını ne
    //    listesinde görür ne de değiştirebilir; org B kendi listesini görür.
    const adminBId = (await pool.query("SELECT id::text FROM users WHERE email='uat-yetki-admin-b@test.local'")).rows[0].id as string
    expect(listA.items.some((item) => item.id === adminBId)).toBe(false)
    const crossOrgPatch = await app.inject({
      method: 'PATCH', url: USER_ROLES_ROUTE.replace(':userId', adminBId),
      headers: { cookie: adminACookie, 'content-type': 'application/json' },
      payload: { roles: ['read_only'], expectedVersion: 1 },
    })
    expect(crossOrgPatch.statusCode).toBe(404)
    const listB = usersResponseSchema.parse((await app.inject({
      method: 'GET', url: USERS_ROUTE, headers: { cookie: adminBCookie },
    })).json())
    expect(listB.items.map((item) => item.id)).toEqual([adminBId])

    // 6) GERÇEK CASE + KÖK — write-role boşluk kapanışını sınamak için.
    const caseCreated = await app.inject({
      method: 'POST', url: CASES_ROUTE,
      headers: { cookie: adminACookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { caseType: 'traffic', plate: '34 YMX 9001' },
    })
    expect(caseCreated.statusCode, caseCreated.payload).toBe(201)
    const caseId = caseDetailResponseSchema.parse(caseCreated.json()).case.id

    // 7) WRITE-ROLE BOŞLUK KAPANIŞI — bu dört uç önceden yalnız `requireSession`
    //    kullanıyordu (read_only dahi fiziksel klasör planlayabiliyordu).
    const fileOpPlan = async (cookie: string) => app.inject({
      method: 'POST', url: CASE_FILE_OPERATION_PLAN_ROUTE.replace(':caseId', caseId),
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        operationType: 'move_case_workspace', destinationStorageRootKey: ROOT_KEY,
        destinationRelativePath: `2026/${caseId}-move`, expectedLocationVersion: 1,
      },
    })
    const workspacePlan = async (cookie: string) => app.inject({
      method: 'POST', url: CASE_WORKSPACE_PLANS_ROUTE.replace(':caseId', caseId),
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { storageRootKey: ROOT_KEY },
    })
    const assignLocation = async (cookie: string) => app.inject({
      method: 'PUT', url: CASE_LOCATION_ROUTE.replace(':caseId', caseId),
      headers: { cookie, 'content-type': 'application/json' },
      payload: { storageRootKey: ROOT_KEY, relativePath: `2026/${caseId}` },
    })
    const registerDocument = async (cookie: string) => app.inject({
      method: 'POST', url: DOCUMENTS_ROUTE.replace(':caseId', caseId),
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        documentType: 'accident_report', sourceType: 'manual', originalFileName: 'kaza-tutanagi.pdf',
        mimeType: 'application/pdf', byteSize: 128, contentHash: 'a'.repeat(64),
        storageRootKey: ROOT_KEY, relativePath: `2026/${caseId}/kaza-tutanagi.pdf`,
      },
    })

    // read_only: HİÇBİRİNİ yapamaz (gerçek kusur, bu görevde düzeltildi).
    expect((await fileOpPlan(readOnlyGateCookie)).statusCode).toBe(403)
    expect((await workspacePlan(readOnlyGateCookie)).statusCode).toBe(403)
    expect((await assignLocation(readOnlyGateCookie)).statusCode).toBe(403)
    expect((await registerDocument(readOnlyGateCookie)).statusCode).toBe(403)

    // secretary: fiziksel taşıma/kurulum uçlarında YASAK (case-lifecycle ile
    // aynı sınır) ama evrak kaydında (case-operations ile aynı sınır) SERBEST.
    expect((await fileOpPlan(secretaryACookie)).statusCode).toBe(403)
    expect((await workspacePlan(secretaryACookie)).statusCode).toBe(403)
    expect((await assignLocation(secretaryACookie)).statusCode).toBe(403)
    expect((await registerDocument(secretaryACookie)).statusCode).toBe(201)

    // admin: rol kapısını GERÇEKTEN geçer (403 almaz); alt seviye ön koşullar
    // (örn. `unknown_root`/`active_conflict`) bu testin kapsamı dışıdır.
    expect((await fileOpPlan(adminACookie)).statusCode).not.toBe(403)
    expect((await workspacePlan(adminACookie)).statusCode).not.toBe(403)
    const adminAssign = await assignLocation(adminACookie)
    expect(adminAssign.statusCode, adminAssign.payload).toBe(200)

    // 8) Audit zinciri: rol değişikliği kaydedilir, hassas veri sızmaz.
    const audit = await pool.query(
      "SELECT action,details FROM audit_events WHERE organization_id=$1 AND action='user.roles_changed' ORDER BY occurred_at",
      [orgAId],
    )
    expect(audit.rowCount).toBeGreaterThanOrEqual(1)
    const auditPayload = JSON.stringify(audit.rows)
    expect(auditPayload).not.toContain(PASSWORD)
    expect(auditPayload).not.toMatch(/[A-Za-z]:[\\/]/)
    expect(JSON.stringify(listA)).not.toContain(orgBId)
  }, 60_000)
})
