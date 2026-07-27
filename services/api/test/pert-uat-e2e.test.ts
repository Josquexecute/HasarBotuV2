import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AGENTS_ROUTE,
  AUTH_LOGIN_ROUTE,
  CASES_ROUTE,
  DOCUMENTS_ROUTE,
  DOCUMENT_DETAIL_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  PHOTOS_ROUTE,
  PHOTO_DETAIL_ROUTE,
  CASE_PERT_ASSESSMENT_ROUTE,
  CASE_PERT_ASSESSMENT_VERSIONS_ROUTE,
  pertAssessmentResponseSchema,
  pertAssessmentWorkspaceResponseSchema,
} from '@hasarbotu/contracts'
import {
  assertTestDatabaseUrl,
  closeDatabasePool,
  createDatabasePool,
  runMigrations,
  uuidv7,
  type DatabaseConfig,
} from '@hasarbotu/database'
import { createAgentApiClient, runOnce, type AgentConfig } from '@hasarbotu/file-agent'
import { buildApp, hashPassword } from '../src/index.js'

/**
 * UAT-tarzı uçtan uca doğrulama: gerçek anonim bir case üzerinde PERT/Ağır
 * Hasar zincirinin TAMAMI (rayiç + hasar bedeli girişi -> fotoğraf/kanıt ->
 * eksper kanaati -> merkez kararı -> nihai PERT sonucu) TEK case üzerinde,
 * sentetik SQL ile onaylı sürüm enjekte etmeden, yalnız gerçek command
 * API'leri ile sürülür.
 *
 * Mevcut `pert.test.ts` bu geçişleri ayrı ayrı doğruluyordu (her `it` kendi
 * senaryosu için ayrı sürüm zinciri kuruyordu) ve kanıt/fotoğraf hiç işin
 * içinde değildi. Bu senaryo: (a) gerçek File Agent `runOnce` ile kayıt ->
 * doğrulama zincirinden geçmiş GERÇEK kanıt (SBM ağır hasar sonucu belgesi +
 * hasar fotoğrafı) önce case'e eklenir, (b) PERT değerlendirmesi
 * `data_missing`'den başlayıp rayiç/hasar bedeli girildikten sonra
 * `pert_candidate`'a, ardından gerçek `expert` kullanıcısının kanaatiyle
 * `expert_opinion_issued`'a, sonra `center_decision_pending` üzerinden
 * gerçek `admin` kullanıcısının merkez kararıyla nihai `pert_decided`'a
 * kadar TEK akışta, beş immutable/append-only sürüm olarak ilerler, (c) her
 * adımda türetilen hasar/rayiç oranının sunucu tarafından doğru
 * hesaplandığı ve serbest metinlerin (gerekçe/not) audit'e hiç
 * kopyalanmadığı doğrudan doğrulanır.
 */

const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'uat-pert-sentetik-guclu-parola-45'
const ROOT_KEY = 'uat-pert-root'
const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex')

describeDb('PERT uçtan uca UAT: rayiç -> fotoğraf/kanıt -> eksper kanaati -> merkez kararı -> nihai sonuç (gerçek PostgreSQL)', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let root: string
  let organizationId: string
  let managerUserId: string
  let expertUserId: string
  let adminUserId: string
  let managerCookie: string
  let expertCookie: string
  let adminCookie: string
  let agentConfig: AgentConfig
  let agentClient: ReturnType<typeof createAgentApiClient>

  const injectFetch = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const response = await app.inject({
      method: (init?.method ?? 'GET') as 'GET' | 'POST',
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      ...(init?.body !== undefined && init.body !== null ? { payload: String(init.body) } : {}),
    })
    return {
      ok: response.statusCode >= 200 && response.statusCode < 300,
      status: response.statusCode,
      json: async () => response.json(),
      headers: { get: () => null },
    } as unknown as Response
  }) as unknown as typeof fetch

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

    organizationId = uuidv7()
    managerUserId = uuidv7()
    expertUserId = uuidv7()
    adminUserId = uuidv7()
    await pool.query(
      "INSERT INTO organizations (id,code,name) VALUES ($1,'uat-pert-main','UAT PERT')",
      [organizationId],
    )
    const passwordHash = await hashPassword(PASSWORD)
    await pool.query(
      `INSERT INTO users (id,organization_id,email,display_name,password_hash)
       VALUES ($1,$2,'uat-pert-manager@test.local','UAT Sorumlu',$3),
              ($4,$2,'uat-pert-expert@test.local','UAT Eksper',$3),
              ($5,$2,'uat-pert-admin@test.local','UAT Yönetici',$3)`,
      [managerUserId, organizationId, passwordHash, expertUserId, adminUserId],
    )
    await pool.query(
      `INSERT INTO user_roles (user_id,role_id)
       SELECT $1::uuid,id FROM roles WHERE code='case_manager'
       UNION ALL SELECT $2::uuid,id FROM roles WHERE code='expert'
       UNION ALL SELECT $3::uuid,id FROM roles WHERE code='admin'`,
      [managerUserId, expertUserId, adminUserId],
    )
    await pool.query(
      `INSERT INTO storage_roots (id,organization_id,root_key,label,is_active)
       VALUES ($1,$2,$3,'UAT PERT Kök',true)`,
      [uuidv7(), organizationId, ROOT_KEY],
    )

    app = buildApp({
      loggerEnabled: false,
      auth: {
        pool,
        cookieSecure: false,
        loginRateLimit: { limit: 500, windowMs: 60_000 },
      },
    })
    await app.ready()
    managerCookie = await login('uat-pert-manager@test.local')
    expertCookie = await login('uat-pert-expert@test.local')
    adminCookie = await login('uat-pert-admin@test.local')

    const registered = await app.inject({
      method: 'POST', url: AGENTS_ROUTE, headers: { cookie: adminCookie },
      payload: { name: 'UAT PERT Agent' },
    })
    expect(registered.statusCode).toBe(201)
    const agent = registered.json() as { agent: { id: string }; secret: string }
    root = await mkdtemp(join(tmpdir(), 'hb-uat-pert-'))
    agentConfig = {
      apiBaseUrl: '', agentId: agent.agent.id, agentSecret: agent.secret,
      roots: { [ROOT_KEY]: root }, leaseSeconds: 120, pollIntervalMs: 1000,
    }
    agentClient = createAgentApiClient({
      baseUrl: '', agentId: agent.agent.id, secret: agent.secret, fetchImpl: injectFetch,
    })
  }, 60_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
    if (root !== undefined) await rm(root, { recursive: true, force: true })
  })

  it('gerçek case, kanıt doğrulaması, rayiç/hasar girişi, eksper kanaati, merkez kararı ve nihai PERT sonucunu tek akışta doğrular', async () => {
    // 1) Gerçek case oluşturma (sentetik SQL enjeksiyonu değil).
    const plate = '34 UAT 4501'
    const caseCreated = await app.inject({
      method: 'POST', url: CASES_ROUTE,
      headers: { cookie: adminCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        caseType: 'traffic', plate, workflowStage: 'damage_assessment',
        notificationDate: '2026-07-24', responsibleUserId: managerUserId,
      },
    })
    expect(caseCreated.statusCode, caseCreated.payload).toBe(201)
    const createdCase = (caseCreated.json() as {
      case: { id: string; version: number }
    }).case
    const caseId = createdCase.id

    // 2) GERÇEK kanıt: SBM ağır hasar sonucu belgesi + hasar fotoğrafı, gerçek
    //    File Agent `runOnce` doğrulamasından geçerek `ready` olur (agent
    //    beyan edilen hash'e değil GERÇEK dosya içeriğine güvenir).
    const evrakDir = join(root, 'EVRAK')
    const hasarDir = join(root, 'HASAR')
    await mkdir(evrakDir, { recursive: true })
    await mkdir(hasarDir, { recursive: true })
    const sbmContent = Buffer.from('sentetik SBM ağır hasar sonucu içeriği '.repeat(200))
    const photoContent = Buffer.from('sentetik hasar fotoğrafı ikili verisi '.repeat(200))
    await writeFile(join(evrakDir, 'sbm-agir-hasar.pdf'), sbmContent)
    await writeFile(join(hasarDir, 'hasar_001.jpg'), photoContent)

    const docRegistered = await app.inject({
      method: 'POST', url: DOCUMENTS_ROUTE.replace(':caseId', caseId),
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        documentType: 'sbm_heavy_damage_result', sourceType: 'upload',
        originalFileName: 'sbm-agir-hasar.pdf', mimeType: 'application/pdf',
        byteSize: sbmContent.length, contentHash: sha256(sbmContent),
        storageRootKey: ROOT_KEY, relativePath: 'EVRAK/sbm-agir-hasar.pdf',
      },
    })
    expect(docRegistered.statusCode, docRegistered.payload).toBe(201)
    const docBody = docRegistered.json() as { document: { id: string }; version: { id: string; status: string } }
    expect(docBody.version.status).toBe('pending')

    const photoRegistered = await app.inject({
      method: 'POST', url: PHOTOS_ROUTE.replace(':caseId', caseId),
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        sourceType: 'upload', originalFileName: 'hasar_001.jpg', mimeType: 'image/jpeg',
        byteSize: photoContent.length, contentHash: sha256(photoContent),
        storageRootKey: ROOT_KEY, relativePath: 'HASAR/hasar_001.jpg',
      },
    })
    expect(photoRegistered.statusCode, photoRegistered.payload).toBe(201)
    const photoBody = photoRegistered.json() as { photo: { id: string; status: string } }
    expect(photoBody.photo.status).toBe('pending')

    const docVerifyRun = await runOnce(agentClient, agentConfig)
    expect(docVerifyRun.kind).toBe('reported')
    const photoVerifyRun = await runOnce(agentClient, agentConfig)
    expect(photoVerifyRun.kind).toBe('reported')

    // Bağımsız YENİDEN OKUMA: kayıt sırasında dönen yanıt değil, ayrı GET
    // istekleriyle diskteki gerçek doğrulama sonucu okunur.
    const docReread = await app.inject({
      method: 'GET', url: DOCUMENT_DETAIL_ROUTE.replace(':documentId', docBody.document.id),
      headers: { cookie: managerCookie },
    })
    expect(docReread.statusCode).toBe(200)
    const docDetail = (docReread.json() as {
      document: { versions: { status: string; hashVerified: boolean; sizeVerified: boolean; verifiedAt: string | null }[] }
    }).document
    expect(docDetail.versions[0]).toMatchObject({ status: 'ready', hashVerified: true, sizeVerified: true })
    expect(docDetail.versions[0]?.verifiedAt).not.toBeNull()

    const photoReread = await app.inject({
      method: 'GET', url: PHOTO_DETAIL_ROUTE.replace(':photoId', photoBody.photo.id),
      headers: { cookie: managerCookie },
    })
    expect(photoReread.statusCode).toBe(200)
    const photoDetail = (photoReread.json() as {
      photo: { status: string; hashVerified: boolean; sizeVerified: boolean; verifiedAt: string | null }
    }).photo
    expect(photoDetail).toMatchObject({ status: 'ready', hashVerified: true, sizeVerified: true })
    expect(photoDetail.verifiedAt).not.toBeNull()

    const pertUrl = CASE_PERT_ASSESSMENT_ROUTE.replace(':caseId', caseId)
    const versionsUrl = CASE_PERT_ASSESSMENT_VERSIONS_ROUTE.replace(':caseId', caseId)

    // 3) v1: değerlendirme kanıt yüklenince açılır ama rayiç/hasar bedeli
    //    henüz girilmemiştir (`data_missing`).
    const v1 = await app.inject({
      method: 'POST', url: pertUrl,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        workflowStatus: 'data_missing',
        structuralNote: 'SBM ağır hasar sonucu ve hasar fotoğrafı yüklendi; rayiç/hasar bedeli bekleniyor.',
        expectedCaseVersion: 1, confirmed: true,
      },
    })
    expect(v1.statusCode, v1.payload).toBe(201)
    const v1Body = pertAssessmentResponseSchema.parse(v1.json()).assessment
    expect(v1Body.currentVersion).toMatchObject({
      workflowStatus: 'data_missing', damageRatioPercent: null, expertOpinion: null, centerDecision: null,
    })

    // 4) v2: kullanıcı GERÇEK anonim rayiç (piyasa) ve hasar bedelini girer;
    //    oran SUNUCUDA türetilir (istemci hesaplamaz/göndermez).
    const estimatedDamageMinor = 72_000_000 // 720.000,00 TL
    const marketValueMinor = 85_000_000 // 850.000,00 TL rayiç
    const v2 = await app.inject({
      method: 'POST', url: versionsUrl,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        workflowStatus: 'pert_candidate',
        estimatedDamageMinor, marketValueMinor,
        structuralNote: 'Şasi hasarlı; kanıt fotoğrafı ve SBM ağır hasar sonucu incelendi, hasar/rayiç oranı yüksek.',
        expectedVersion: v1Body.version,
        reason: 'UAT: rayiç ve hasar bedeli girildi, PERT adayı olarak işaretlendi.',
        confirmed: true,
      },
    })
    expect(v2.statusCode, v2.payload).toBe(200)
    const v2Body = pertAssessmentResponseSchema.parse(v2.json()).assessment
    expect(v2Body.currentVersion).toMatchObject({
      workflowStatus: 'pert_candidate', damageRatioPercent: 85,
      estimatedDamageMinor, marketValueMinor, expertOpinion: null, centerDecision: null,
    })

    // 5) v3: GERÇEK eksper kullanıcısı kanaatini kaydeder (repair | pert +
    //    zorunlu gerekçe).
    const v3 = await app.inject({
      method: 'POST', url: versionsUrl,
      headers: { cookie: expertCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        workflowStatus: 'expert_opinion_issued',
        estimatedDamageMinor, marketValueMinor,
        structuralNote: 'Şasi hasarlı; kanıt fotoğrafı ve SBM ağır hasar sonucu incelendi, hasar/rayiç oranı yüksek.',
        expertOpinion: 'pert',
        expertRationale: 'Şasi hasarı ve %85 hasar/rayiç oranı nedeniyle onarım ekonomik değildir; PERT önerilir.',
        expectedVersion: v2Body.version,
        reason: 'UAT: eksper kanaati kaydedildi.',
        confirmed: true,
      },
    })
    expect(v3.statusCode, v3.payload).toBe(200)
    const v3Body = pertAssessmentResponseSchema.parse(v3.json()).assessment
    expect(v3Body.currentVersion).toMatchObject({
      workflowStatus: 'expert_opinion_issued', expertOpinion: 'pert', centerDecision: null,
    })

    // 6) v4: merkez kararı bekleniyor (housekeeping geçişi; kanaat korunur).
    const v4 = await app.inject({
      method: 'POST', url: versionsUrl,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        workflowStatus: 'center_decision_pending',
        estimatedDamageMinor, marketValueMinor,
        structuralNote: 'Şasi hasarlı; kanıt fotoğrafı ve SBM ağır hasar sonucu incelendi, hasar/rayiç oranı yüksek.',
        expertOpinion: 'pert',
        expertRationale: 'Şasi hasarı ve %85 hasar/rayiç oranı nedeniyle onarım ekonomik değildir; PERT önerilir.',
        expectedVersion: v3Body.version,
        reason: 'UAT: dosya merkez kararına gönderildi.',
        confirmed: true,
      },
    })
    expect(v4.statusCode, v4.payload).toBe(200)
    const v4Body = pertAssessmentResponseSchema.parse(v4.json()).assessment
    expect(v4Body.currentVersion.workflowStatus).toBe('center_decision_pending')

    // 7) v5: GERÇEK admin (merkez) kullanıcısı kararı kesinleştirir -- NİHAİ
    //    PERT SONUCU.
    const v5 = await app.inject({
      method: 'POST', url: versionsUrl,
      headers: { cookie: adminCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        workflowStatus: 'pert_decided',
        estimatedDamageMinor, marketValueMinor,
        structuralNote: 'Şasi hasarlı; kanıt fotoğrafı ve SBM ağır hasar sonucu incelendi, hasar/rayiç oranı yüksek.',
        expertOpinion: 'pert',
        expertRationale: 'Şasi hasarı ve %85 hasar/rayiç oranı nedeniyle onarım ekonomik değildir; PERT önerilir.',
        centerDecision: 'pert',
        centerNote: 'Merkez, eksper kanaatini onayladı; PERT kararı kesinleşti.',
        expectedVersion: v4Body.version,
        reason: 'UAT: merkez kararı kaydedildi, PERT kesinleşti.',
        confirmed: true,
      },
    })
    expect(v5.statusCode, v5.payload).toBe(200)
    const v5Body = pertAssessmentResponseSchema.parse(v5.json()).assessment
    expect(v5Body.currentVersion).toMatchObject({
      workflowStatus: 'pert_decided', expertOpinion: 'pert', centerDecision: 'pert', damageRatioPercent: 85,
    })
    expect(v5Body.version).toBe(5)

    // 8) Bağımsız YENİDEN OKUMA: taze bir GET workspace isteği, önceki adımların
    //    yanıt gövdelerinden BAĞIMSIZ olarak nihai durumu ve tam sürüm
    //    geçmişini doğrular; hiçbir eski sürüm ezilmemiştir (append-only).
    const workspace = await app.inject({
      method: 'GET', url: pertUrl, headers: { cookie: managerCookie },
    })
    expect(workspace.statusCode).toBe(200)
    const workspaceBody = pertAssessmentWorkspaceResponseSchema.parse(workspace.json())
    expect(workspaceBody.assessment?.currentVersion.workflowStatus).toBe('pert_decided')
    expect(workspaceBody.assessment?.versions).toHaveLength(5)
    const statuses = workspaceBody.assessment?.versions.map((version) => version.workflowStatus)
    expect(statuses).toEqual([
      'pert_decided', 'center_decision_pending', 'expert_opinion_issued',
      'pert_candidate', 'data_missing',
    ])
    // v1'in kaydı hâlâ orijinal (null) hasar/rayiç değerlerini taşır; sonraki
    // sürümler eski sürümü asla geriye dönük değiştirmez.
    const rereadV1 = workspaceBody.assessment?.versions.find((version) => version.assessmentVersion === 1)
    expect(rereadV1).toMatchObject({ estimatedDamageMinor: null, marketValueMinor: null, damageRatioPercent: null })
    const rereadV2 = workspaceBody.assessment?.versions.find((version) => version.assessmentVersion === 2)
    expect(rereadV2).toMatchObject({ damageRatioPercent: 85, expertOpinion: null })

    // 9) Audit zinciri: kanıt kaydı/doğrulamasından nihai PERT kararına kadar
    //    tam; serbest metin (gerekçe/not/yapısal not) audit'e HİÇ kopyalanmaz.
    // Job (Agent doğrulaması) audit'i `job` entity'sine bağlıdır (job.id);
    // hedef belge/fotoğraf kimliği yalnız `details.targetId` içinde taşınır.
    const assessmentId = v1Body.id
    const audit = await pool.query(
      `SELECT action,actor_user_id::text,resource_id::text,details
         FROM audit_events
        WHERE organization_id=$1
          AND (resource_id::text = ANY($2::text[])
            OR (action='job.verified'
              AND details->>'targetId' = ANY($3::text[])))
        ORDER BY occurred_at`,
      [
        organizationId, [caseId, assessmentId],
        [docBody.version.id, photoBody.photo.id],
      ],
    )
    const actions = audit.rows.map((row) => row.action)
    expect(actions).toEqual(expect.arrayContaining([
      'case.created',
      'document.registered',
      'photo.registered',
      'job.verified',
      'pert_assessment.created',
      'pert_assessment.revised',
    ]))
    expect(actions.filter((action) => action === 'pert_assessment.revised')).toHaveLength(4)
    expect(actions.filter((action) => action === 'job.verified')).toHaveLength(2)
    const pertAudit = audit.rows.filter((row) => row.resource_id === assessmentId)
    expect(pertAudit.every((row) => row.actor_user_id === managerUserId
      || row.actor_user_id === expertUserId
      || row.actor_user_id === adminUserId)).toBe(true)
    const lastPertAudit = pertAudit[pertAudit.length - 1]
    expect(lastPertAudit.details).toMatchObject({
      workflowStatus: 'pert_decided', expertOpinion: 'pert', centerDecision: 'pert', damageRatioPercent: 85,
    })
    const auditPayload = JSON.stringify(audit.rows)
    expect(auditPayload).not.toContain(root)
    expect(auditPayload).not.toContain('PERT önerilir')
    expect(auditPayload).not.toContain('Merkez, eksper kanaatini onayladı')
    expect(auditPayload).not.toContain('Şasi hasarlı')
  }, 60_000)
})
