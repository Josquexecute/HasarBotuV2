import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AUTH_LOGIN_ROUTE,
  CASES_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  kascoMandatoryCheckGateResponseSchema,
  kascoMandatoryCheckHistoryResponseSchema,
  kascoMandatoryCheckResponseSchema,
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
const PASSWORD = 'kasko-kontrol-sentetik-guclu-parola-09'

function gateRoute(caseId: string): string {
  return `/api/v1/cases/${caseId}/kasco-mandatory-checks`
}
function checkRoute(caseId: string, code: string): string {
  return `/api/v1/cases/${caseId}/kasco-mandatory-checks/${code}`
}
function historyRoute(caseId: string, code: string): string {
  return `/api/v1/cases/${caseId}/kasco-mandatory-checks/${code}/history`
}

describeDb('Zorunlu Kasko Kontrolü gate (gerçek PostgreSQL)', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let orgId: string
  let adminCookie: string
  let secretaryCookie: string
  let readOnlyCookie: string
  let kascoCaseId: string
  let trafficCaseId: string
  let readyDocumentId: string
  let readyDocumentVersionId: string

  async function seedUser(email: string, role: string): Promise<string> {
    const id = uuidv7()
    await pool.query(
      'INSERT INTO users (id, organization_id, email, display_name, password_hash) VALUES ($1,$2,$3,$4,$5)',
      [id, orgId, email, email, await hashPassword(PASSWORD)],
    )
    await pool.query("INSERT INTO user_roles (user_id, role_id) SELECT $1::uuid, id FROM roles WHERE code = $2", [id, role])
    return id
  }
  async function login(email: string): Promise<string> {
    const response = await app.inject({ method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email, password: PASSWORD } })
    expect(response.statusCode).toBe(200)
    return String(response.headers['set-cookie']).split(';')[0] as string
  }
  async function createCase(cookie: string, caseType: 'traffic' | 'casco', plate: string): Promise<string> {
    const response = await app.inject({
      method: 'POST', url: CASES_ROUTE, headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { caseType, plate },
    })
    expect(response.statusCode, response.payload).toBe(201)
    return (response.json() as { case: { id: string } }).case.id
  }
  /** Kasko vaka için hash/boyut doğrulaması TAMAMLANMIŞ (ready) tek bir belge sürümü hazırlar. */
  async function seedReadyDocument(caseId: string): Promise<{ documentId: string; documentVersionId: string }> {
    const documentId = uuidv7()
    const versionId = uuidv7()
    await pool.query(
      "INSERT INTO documents (id,organization_id,case_id,document_type,status) VALUES ($1,$2,$3,'casco_registration','ready')",
      [documentId, orgId, caseId],
    )
    await pool.query(
      `INSERT INTO document_versions (id,organization_id,document_id,case_id,version_number,original_file_name,display_name,
         mime_type,byte_size,content_hash,storage_root_key,relative_path,source_type,status,hash_verified,size_verified,verified_at)
       VALUES ($1,$2,$3,$4,1,'ruhsat.pdf','Ruhsat','application/pdf',16,$5,'test-root','2026/T/ruhsat.pdf','manual','ready',true,true,now())`,
      [versionId, orgId, documentId, caseId, 'a'.repeat(64)],
    )
    await pool.query('UPDATE documents SET current_version_id=$1 WHERE id=$2', [versionId, documentId])
    return { documentId, documentVersionId: versionId }
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })

    orgId = uuidv7()
    await pool.query("INSERT INTO organizations (id,code,name) VALUES ($1,'kmc-org','KMC Org')", [orgId])
    await pool.query('INSERT INTO storage_roots (id,organization_id,root_key,label) VALUES ($1,$2,$3,$4)', [uuidv7(), orgId, 'test-root', 'Test Root'])
    await seedUser('kmc-admin@test.local', 'admin')
    await seedUser('kmc-secretary@test.local', 'secretary')
    await seedUser('kmc-readonly@test.local', 'read_only')

    app = buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false, loginRateLimit: { limit: 500, windowMs: 60_000 } } })
    await app.ready()
    adminCookie = await login('kmc-admin@test.local')
    secretaryCookie = await login('kmc-secretary@test.local')
    readOnlyCookie = await login('kmc-readonly@test.local')

    kascoCaseId = await createCase(adminCookie, 'casco', '34 KM 101')
    trafficCaseId = await createCase(adminCookie, 'traffic', '34 KM 102')
    const doc = await seedReadyDocument(kascoCaseId)
    readyDocumentId = doc.documentId
    readyDocumentVersionId = doc.documentVersionId
  }, 60_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  it('trafik dosyasında gate applicable=false döner ve 7 kontrol de not_applicable olur, hiçbir zaman engellemez', async () => {
    const response = await app.inject({ method: 'GET', url: gateRoute(trafficCaseId), headers: { cookie: adminCookie } })
    expect(response.statusCode).toBe(200)
    const gate = kascoMandatoryCheckGateResponseSchema.parse(response.json()).gate
    expect(gate.applicable).toBe(false)
    expect(gate.incomplete).toBe(false)
    expect(gate.checks).toHaveLength(7)
    expect(gate.checks.every((item) => item.status === 'not_applicable')).toBe(true)
  })

  it('yeni kasko dosyasında 7 kontrol de missing ve gate incomplete olur', async () => {
    const response = await app.inject({ method: 'GET', url: gateRoute(kascoCaseId), headers: { cookie: adminCookie } })
    expect(response.statusCode).toBe(200)
    const gate = kascoMandatoryCheckGateResponseSchema.parse(response.json()).gate
    expect(gate.applicable).toBe(true)
    expect(gate.missingCount).toBe(7)
    expect(gate.incomplete).toBe(true)
    expect(gate.checks.map((item) => item.checkCode).sort()).toEqual([
      'driver_license_restriction_codes', 'driver_registration_owner_match', 'equivalent_parts_clause',
      'market_value_general_deductible', 'occupation_information', 'policyholder_registration_owner_match',
      'service_deductible_clause',
    ].sort())
  })

  it('kesin sonuç (same/different/present/absent) kanıt olmadan 400 ile reddedilir -- "poliçe okunmadan kloz yok" korumasıdır', async () => {
    const response = await app.inject({
      method: 'PUT', url: checkRoute(kascoCaseId, 'equivalent_parts_clause'), headers: { cookie: adminCookie },
      payload: { result: 'present', evidence: null, expectedVersion: 1 },
    })
    expect(response.statusCode).toBe(400)
  })

  it('karşılaştırma kontrolüne (same/different/unknown) varlık sonucu (present) verilirse reddedilir', async () => {
    const response = await app.inject({
      method: 'PUT', url: checkRoute(kascoCaseId, 'driver_registration_owner_match'), headers: { cookie: adminCookie },
      payload: {
        result: 'present',
        evidence: { documentId: readyDocumentId, documentVersionId: readyDocumentVersionId, page: 1, section: 'Ruhsat', excerpt: 'ornek' },
        expectedVersion: 1,
      },
    })
    expect(response.statusCode).toBe(400)
  })

  it('unclear sonucu kanıtsız kabul edilir ve control_required üretir', async () => {
    const response = await app.inject({
      method: 'PUT', url: checkRoute(kascoCaseId, 'occupation_information'), headers: { cookie: adminCookie },
      payload: { result: 'unclear', evidence: null, reason: 'Meslek bilgisi belgede yok', expectedVersion: 1 },
    })
    expect(response.statusCode, response.payload).toBe(200)
    const check = kascoMandatoryCheckResponseSchema.parse(response.json()).check
    expect(check.status).toBe('control_required')
    expect(check.version).toBe(2)
  })

  it('kesin sonuç doğrulanmış (ready) kanıtla kabul edilir ve resolved olur; aynı bulgu geçmişe (history) düşer', async () => {
    const response = await app.inject({
      method: 'PUT', url: checkRoute(kascoCaseId, 'driver_registration_owner_match'), headers: { cookie: adminCookie },
      payload: {
        result: 'same',
        evidence: { documentId: readyDocumentId, documentVersionId: readyDocumentVersionId, page: 1, section: 'Ruhsat sahibi', excerpt: 'Ruhsat sahibi ile sürücü aynı kişi' },
        expectedVersion: 1,
      },
    })
    expect(response.statusCode, response.payload).toBe(200)
    const check = kascoMandatoryCheckResponseSchema.parse(response.json()).check
    expect(check.status).toBe('resolved')
    expect(check.confirmedResult).toBe('same')
    expect(check.confirmedEvidence?.documentVersionId).toBe(readyDocumentVersionId)

    const historyResponse = await app.inject({ method: 'GET', url: historyRoute(kascoCaseId, 'driver_registration_owner_match'), headers: { cookie: adminCookie } })
    expect(historyResponse.statusCode).toBe(200)
    const history = kascoMandatoryCheckHistoryResponseSchema.parse(historyResponse.json()).items
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ confirmedResult: 'same', previousConfirmedResult: null })
  })

  it('doğrulanmamış (ready olmayan) belge kanıt olarak kabul edilmez', async () => {
    const notReadyDocId = uuidv7()
    const notReadyVersionId = uuidv7()
    await pool.query("INSERT INTO documents (id,organization_id,case_id,document_type,status) VALUES ($1,$2,$3,'casco_driver_license','pending')", [notReadyDocId, orgId, kascoCaseId])
    await pool.query(
      `INSERT INTO document_versions (id,organization_id,document_id,case_id,version_number,original_file_name,display_name,
         mime_type,byte_size,content_hash,storage_root_key,relative_path,source_type,status)
       VALUES ($1,$2,$3,$4,1,'ehliyet.pdf','Ehliyet','application/pdf',10,$5,'test-root','2026/T/ehliyet.pdf','manual','pending')`,
      [notReadyVersionId, orgId, notReadyDocId, kascoCaseId, 'b'.repeat(64)],
    )
    await pool.query('UPDATE documents SET current_version_id=$1 WHERE id=$2', [notReadyVersionId, notReadyDocId])
    const response = await app.inject({
      method: 'PUT', url: checkRoute(kascoCaseId, 'driver_license_restriction_codes'), headers: { cookie: adminCookie },
      payload: {
        result: 'absent', evidence: { documentId: notReadyDocId, documentVersionId: notReadyVersionId, page: 1, section: '12. alan', excerpt: 'kod yok' },
        expectedVersion: 1,
      },
    })
    expect(response.statusCode).toBe(409)
  })

  it('bayat expectedVersion 409 version_conflict ile reddedilir', async () => {
    const response = await app.inject({
      method: 'PUT', url: checkRoute(kascoCaseId, 'occupation_information'), headers: { cookie: adminCookie },
      payload: { result: 'present', evidence: { documentId: readyDocumentId, documentVersionId: readyDocumentVersionId, page: 2, section: 'Meslek', excerpt: 'Serbest meslek' }, expectedVersion: 1 },
    })
    expect(response.statusCode).toBe(409)
  })

  it('kanıt belgesinin GÜNCEL sürümü değişince (yeni sürüm yüklenince) resolved bulgu needs_review olur', async () => {
    const confirm = await app.inject({
      method: 'PUT', url: checkRoute(kascoCaseId, 'market_value_general_deductible'), headers: { cookie: adminCookie },
      payload: { result: 'absent', evidence: { documentId: readyDocumentId, documentVersionId: readyDocumentVersionId, page: 3, section: 'Muafiyet', excerpt: 'Rayiç üzerinden muafiyet yok' }, expectedVersion: 1 },
    })
    expect(confirm.statusCode, confirm.payload).toBe(200)
    expect((confirm.json() as { check: { status: string } }).check.status).toBe('resolved')

    // Aynı belgeye YENİ bir sürüm yükle (documents.current_version_id artık degisir).
    const newVersionId = uuidv7()
    await pool.query(
      `INSERT INTO document_versions (id,organization_id,document_id,case_id,version_number,original_file_name,display_name,
         mime_type,byte_size,content_hash,storage_root_key,relative_path,source_type,status,hash_verified,size_verified,verified_at)
       VALUES ($1,$2,$3,$4,2,'ruhsat-v2.pdf','Ruhsat','application/pdf',20,$5,'test-root','2026/T/ruhsat-v2.pdf','manual','ready',true,true,now())`,
      [newVersionId, orgId, readyDocumentId, kascoCaseId, 'c'.repeat(64)],
    )
    await pool.query('UPDATE documents SET current_version_id=$1 WHERE id=$2', [newVersionId, readyDocumentId])

    const gate = await app.inject({ method: 'GET', url: gateRoute(kascoCaseId), headers: { cookie: adminCookie } })
    const parsed = kascoMandatoryCheckGateResponseSchema.parse(gate.json()).gate
    const item = parsed.checks.find((check) => check.checkCode === 'market_value_general_deductible')!
    expect(item.status).toBe('needs_review')
    expect(parsed.incomplete).toBe(true)
  })

  it('yetki: read_only okuyabilir ama yazamaz (403); secretary da yazamaz (403)', async () => {
    const readResponse = await app.inject({ method: 'GET', url: gateRoute(kascoCaseId), headers: { cookie: readOnlyCookie } })
    expect(readResponse.statusCode).toBe(200)
    expect(kascoMandatoryCheckGateResponseSchema.parse(readResponse.json()).gate.permissions.canWrite).toBe(false)
    const adminRead = await app.inject({ method: 'GET', url: gateRoute(kascoCaseId), headers: { cookie: adminCookie } })
    expect(kascoMandatoryCheckGateResponseSchema.parse(adminRead.json()).gate.permissions.canWrite).toBe(true)
    const writeAsReadOnly = await app.inject({
      method: 'PUT', url: checkRoute(kascoCaseId, 'service_deductible_clause'), headers: { cookie: readOnlyCookie },
      payload: { result: 'unclear', evidence: null, expectedVersion: 1 },
    })
    expect(writeAsReadOnly.statusCode).toBe(403)
    const writeAsSecretary = await app.inject({
      method: 'PUT', url: checkRoute(kascoCaseId, 'service_deductible_clause'), headers: { cookie: secretaryCookie },
      payload: { result: 'unclear', evidence: null, expectedVersion: 1 },
    })
    expect(writeAsSecretary.statusCode).toBe(403)
    const unauth = await app.inject({ method: 'GET', url: gateRoute(kascoCaseId) })
    expect(unauth.statusCode).toBe(401)
  })

  it('Trafik dosyasında onaylama denemesi not_applicable_case_type olarak 409 ile reddedilir', async () => {
    const response = await app.inject({
      method: 'PUT', url: checkRoute(trafficCaseId, 'occupation_information'), headers: { cookie: adminCookie },
      payload: { result: 'unclear', evidence: null, expectedVersion: 1 },
    })
    expect(response.statusCode).toBe(409)
  })

  it('var olmayan dosya 404 döner', async () => {
    const response = await app.inject({ method: 'GET', url: gateRoute(uuidv7()), headers: { cookie: adminCookie } })
    expect(response.statusCode).toBe(404)
  })

  it('dosya kapanınca gate salt-okunur olur ve onay denemesi case_closed olarak 409 ile reddedilir', async () => {
    await pool.query("UPDATE cases SET lifecycle_status='closed',workflow_stage='closed' WHERE id=$1", [kascoCaseId])
    const gate = await app.inject({ method: 'GET', url: gateRoute(kascoCaseId), headers: { cookie: adminCookie } })
    expect(gate.statusCode).toBe(200)
    expect(kascoMandatoryCheckGateResponseSchema.parse(gate.json()).gate.permissions.canWrite).toBe(false)
    const response = await app.inject({
      method: 'PUT', url: checkRoute(kascoCaseId, 'service_deductible_clause'), headers: { cookie: adminCookie },
      payload: { result: 'unclear', evidence: null, expectedVersion: 1 },
    })
    expect(response.statusCode).toBe(409)
  })
})
