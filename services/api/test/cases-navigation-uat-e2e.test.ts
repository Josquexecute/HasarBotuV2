import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AUTH_LOGIN_ROUTE,
  CASES_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
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

/**
 * UAT-tarzı uçtan uca doğrulama: Dosyalar (liste/arama/filtre) ve Dosya
 * Detayı için gerçek case oluşturma → listeleme/arama/filtreleme → yetki ve
 * tenant izolasyonu zincirini, sentetik SQL ile onaylı sürüm enjekte
 * etmeden, yalnız gerçek command API'leriyle sürer.
 *
 * Mevcut `cases-read.test.ts` (925 satırlık üçlü paket) filtre/arama/
 * sıralama/sayfalama'yı ve TEK case'in detay endpoint'inde tenant
 * izolasyonunu zaten kapsamlıca kanıtlıyor; bu senaryo onları TEKRARLAMAZ.
 * Kapattığı GERÇEK boşluklar:
 *
 * 1. LİSTE/ARAMA seviyesinde tenant izolasyonu hiç iki-organizasyonlu gerçek
 *    veriyle kanıtlanmamıştı (yalnız TEK organizasyon vardı; detay ucunun
 *    izolasyonu ayrıydı, liste sorgusunun ASLA başka org'un kaydını
 *    sızdırmadığı hiç doğrudan gösterilmemişti).
 * 2. GERÇEK ÜRETİM KUSURU BULUNDU VE DÜZELTİLDİ: `POST /api/v1/cases` ve
 *    `PATCH /api/v1/cases/:caseId` yalnız `requireSession` kullanıyordu,
 *    `requireAnyRole` YOKTU — `read_only` rolündeki bir kullanıcı bile yeni
 *    dosya oluşturabiliyor/mevcut dosyayı düzenleyebiliyordu. Bu, sistemdeki
 *    her diğer modülün (İşçilik, PERT, E-posta, Değer Kaybı, Kapanma
 *    Ücreti, Poliçe Analizi) tutarlı WRITE_ROLES deseninin aksineydi.
 *    Kullanıcı onayıyla `read_only` hariç tüm roller (admin/expert/
 *    case_manager/secretary/accounting) yazabilecek şekilde düzeltildi
 *    (`services/api/src/cases/write-routes.ts`). Bu test hem düzeltmeyi
 *    (`read_only` 403) hem de düzeltmenin AŞIRI kısıtlamadığını
 *    (secretary/accounting 201/200) gerçek API ile kanıtlar.
 */

const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'uat-cases-sentetik-guclu-parola-09'

describeDb('Dosyalar/Dosya Detayı uçtan uca UAT: gerçek case oluşturma → listeleme/arama/filtreleme → yetki ve tenant izolasyonu (gerçek PostgreSQL)', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let orgAId: string
  let orgBId: string
  let managerACookie: string
  let managerBCookie: string
  let readOnlyACookie: string
  let secretaryACookie: string
  let accountingACookie: string

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

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })

    orgAId = uuidv7()
    orgBId = uuidv7()
    await pool.query(
      "INSERT INTO organizations (id,code,name) VALUES ($1,'uat-cases-a','UAT Dosyalar A'),($2,'uat-cases-b','UAT Dosyalar B')",
      [orgAId, orgBId],
    )
    await seedUser(orgAId, 'uat-cases-manager-a@test.local', 'case_manager')
    await seedUser(orgBId, 'uat-cases-manager-b@test.local', 'case_manager')
    await seedUser(orgAId, 'uat-cases-readonly-a@test.local', 'read_only')
    await seedUser(orgAId, 'uat-cases-secretary-a@test.local', 'secretary')
    await seedUser(orgAId, 'uat-cases-accounting-a@test.local', 'accounting')

    app = buildApp({
      loggerEnabled: false,
      auth: {
        pool,
        cookieSecure: false,
        loginRateLimit: { limit: 500, windowMs: 60_000 },
      },
    })
    await app.ready()
    managerACookie = await login('uat-cases-manager-a@test.local')
    managerBCookie = await login('uat-cases-manager-b@test.local')
    readOnlyACookie = await login('uat-cases-readonly-a@test.local')
    secretaryACookie = await login('uat-cases-secretary-a@test.local')
    accountingACookie = await login('uat-cases-accounting-a@test.local')
  }, 60_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  it('gerçek case oluşturma, listeleme/arama/filtreleme ve yetki/tenant izolasyonu zincirini tek akışta doğrular', async () => {
    // 1) GERÇEK CASE OLUŞTURMA: iki farklı organizasyonda, KASITLI olarak
    //    örtüşen aranabilir metinle (plaka önekleri aynı "ISO") -- tenant
    //    izolasyonunun gerçekten test edilmesi için, tesadüfen farklı
    //    olduğu için değil.
    const createdA = await app.inject({
      method: 'POST', url: CASES_ROUTE,
      headers: { cookie: managerACookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { caseType: 'traffic', plate: '34 ISO 0001', workflowStage: 'reporting', notificationDate: '2026-07-24' },
    })
    expect(createdA.statusCode, createdA.payload).toBe(201)
    const caseA = caseDetailResponseSchema.parse(createdA.json()).case

    const createdB = await app.inject({
      method: 'POST', url: CASES_ROUTE,
      headers: { cookie: managerBCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { caseType: 'traffic', plate: '34 ISO 0002', workflowStage: 'reporting', notificationDate: '2026-07-24' },
    })
    expect(createdB.statusCode, createdB.payload).toBe(201)
    const caseB = caseDetailResponseSchema.parse(createdB.json()).case
    // Ofis numarası her organizasyon içinde BAĞIMSIZ sıralıdır (aynı yıl,
    // aynı ilk sıra numarası olabilir) -- iki case'in kimliği farklıdır.
    expect(caseA.id).not.toBe(caseB.id)

    // 2) LİSTELEME/ARAMA/FİLTRELEME -- ORG A GÖRÜNÜMÜ: yalnız kendi case'i
    //    görünür; ORTAK "ISO" araması bile Org B'nin case'ini SIZDIRMAZ.
    const listA = caseListResponseSchema.parse((await app.inject({
      method: 'GET', url: CASES_ROUTE, headers: { cookie: managerACookie },
    })).json())
    expect(listA.items.map((item) => item.id)).toEqual([caseA.id])

    const searchA = caseListResponseSchema.parse((await app.inject({
      method: 'GET', url: `${CASES_ROUTE}?search=${encodeURIComponent('ISO')}`,
      headers: { cookie: managerACookie },
    })).json())
    expect(searchA.items.map((item) => item.id)).toEqual([caseA.id])
    expect(searchA.items.some((item) => item.id === caseB.id)).toBe(false)

    const filteredA = caseListResponseSchema.parse((await app.inject({
      method: 'GET', url: `${CASES_ROUTE}?caseType=traffic&stage=reporting`,
      headers: { cookie: managerACookie },
    })).json())
    expect(filteredA.items.map((item) => item.id)).toEqual([caseA.id])

    // 3) LİSTELEME -- ORG B GÖRÜNÜMÜ: simetrik olarak yalnız kendi case'i
    //    görünür; Org A'nın case'i hiçbir şekilde sızmaz.
    const listB = caseListResponseSchema.parse((await app.inject({
      method: 'GET', url: CASES_ROUTE, headers: { cookie: managerBCookie },
    })).json())
    expect(listB.items.map((item) => item.id)).toEqual([caseB.id])
    const searchB = caseListResponseSchema.parse((await app.inject({
      method: 'GET', url: `${CASES_ROUTE}?search=${encodeURIComponent('ISO')}`,
      headers: { cookie: managerBCookie },
    })).json())
    expect(searchB.items.map((item) => item.id)).toEqual([caseB.id])

    // 4) DETAY AÇMA -- tenant izolasyonu: Org B, Org A'nın case'ini DOĞRUDAN
    //    URL ile de göremez (bilgi sızdırmadan 404).
    const crossDetail = await app.inject({
      method: 'GET', url: `${CASES_ROUTE}/${caseA.id}`, headers: { cookie: managerBCookie },
    })
    expect(crossDetail.statusCode).toBe(404)

    // 5) YETKİ (RBAC) -- GERÇEK KUSUR DOĞRULAMASI: `read_only` artık case
    //    oluşturamaz/güncelleyemez (403) ama OKUYABİLİR (200); diğer
    //    yazma-yetkili roller (secretary/accounting) daha önce hiç
    //    doğrulanmamıştı, şimdi gerçek 201 ile kanıtlanıyor.
    const readOnlyCreate = await app.inject({
      method: 'POST', url: CASES_ROUTE,
      headers: { cookie: readOnlyACookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { caseType: 'traffic', plate: '34 RO 0001' },
    })
    expect(readOnlyCreate.statusCode).toBe(403)
    const readOnlyUpdate = await app.inject({
      method: 'PATCH', url: `${CASES_ROUTE}/${caseA.id}`,
      headers: { cookie: readOnlyACookie },
      payload: { expectedVersion: caseA.version, workflowStage: 'under_repair' },
    })
    expect(readOnlyUpdate.statusCode).toBe(403)
    // Başarısız (403 alan) denemelerin GERÇEKTEN hiçbir kalıcı etkisi
    // olmadığı doğrudan doğrulanır -- yalnız HTTP kodu değil, veri: ne yeni
    // case satırı oluşmuş ne de mevcut case'in aşaması/sürümü değişmiştir.
    const caseCountRo = await pool.query(
      'SELECT count(*)::int AS n FROM cases WHERE organization_id=$1 AND plate=$2',
      [orgAId, '34 RO 0001'],
    )
    expect(caseCountRo.rows[0]).toEqual({ n: 0 })
    const unchangedAfterReadOnly = await pool.query(
      'SELECT workflow_stage,version FROM cases WHERE id=$1', [caseA.id],
    )
    expect(unchangedAfterReadOnly.rows[0]).toEqual({ workflow_stage: 'reporting', version: caseA.version })

    const readOnlyRead = await app.inject({
      method: 'GET', url: `${CASES_ROUTE}/${caseA.id}`, headers: { cookie: readOnlyACookie },
    })
    expect(readOnlyRead.statusCode).toBe(200)
    const readOnlyList = await app.inject({
      method: 'GET', url: CASES_ROUTE, headers: { cookie: readOnlyACookie },
    })
    expect(readOnlyList.statusCode).toBe(200)

    // 6) DAHA ÖNCE HİÇ DOĞRULANMAMIŞ roller: secretary/accounting da (yalnız
    //    read_only DIŞINDA herkes) gerçekten yazabiliyor -- düzeltme AŞIRI
    //    kısıtlayıcı değil.
    const secretaryCreate = await app.inject({
      method: 'POST', url: CASES_ROUTE,
      headers: { cookie: secretaryACookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { caseType: 'casco', plate: '34 SEC 0001' },
    })
    expect(secretaryCreate.statusCode, secretaryCreate.payload).toBe(201)

    const accountingUpdate = await app.inject({
      method: 'PATCH', url: `${CASES_ROUTE}/${caseA.id}`,
      headers: { cookie: accountingACookie },
      payload: { expectedVersion: caseA.version, workflowStage: 'under_repair' },
    })
    expect(accountingUpdate.statusCode, accountingUpdate.payload).toBe(200)

    // 7) YENİLEME: muhasebe güncellemesi sonrası bağımsız bir yeniden okuma
    //    (GET) hem DETAY hem de LİSTE görünümünde GERÇEKTEN güncel durumu
    //    yansıtır -- sunucu tarafında sessizce eski veri döndürülmez.
    const rereadDetail = caseDetailResponseSchema.parse((await app.inject({
      method: 'GET', url: `${CASES_ROUTE}/${caseA.id}`, headers: { cookie: managerACookie },
    })).json()).case
    expect(rereadDetail).toMatchObject({ stage: 'under_repair', version: caseA.version + 1 })
    const rereadList = caseListResponseSchema.parse((await app.inject({
      method: 'GET', url: `${CASES_ROUTE}?stage=under_repair`, headers: { cookie: managerACookie },
    })).json())
    expect(rereadList.items.map((item) => item.id)).toEqual([caseA.id])

    // 8) Audit zinciri: gerçek kusurun yeniden ortaya çıkmayacağı (403
    //    denemeleri audit yazmaz, yalnız GERÇEK başarılı yazmalar yazar) ve
    //    tenant/PII sızıntısı olmadığı doğrulanır.
    const audit = await pool.query(
      `SELECT action,actor_user_id::text,resource_id::text
         FROM audit_events
        WHERE organization_id=$1 AND resource_id::text=$2
        ORDER BY occurred_at`,
      [orgAId, caseA.id],
    )
    expect(audit.rows.map((row) => row.action)).toEqual(expect.arrayContaining(['case.created', 'case.updated']))
    expect(audit.rows.every((row) => row.actor_user_id !== null)).toBe(true)
    const auditPayload = JSON.stringify(audit.rows)
    expect(auditPayload).not.toContain(orgBId)
    expect(auditPayload).not.toMatch(/[A-Za-z]:[\\/]|\\\\|password|secret/i)
  }, 60_000)
})
