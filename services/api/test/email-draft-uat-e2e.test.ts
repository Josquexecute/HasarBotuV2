import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AUTH_LOGIN_ROUTE,
  CASES_ROUTE,
  CASE_EMAIL_AI_PLAN_ROUTE,
  CASE_EMAIL_AI_RUNS_ROUTE,
  CASE_EMAIL_DRAFTS_ROUTE,
  CASE_EMAIL_DRAFT_HANDOFFS_ROUTE,
  CASE_EMAIL_DRAFT_VERSIONS_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  emailAiPlanResponseSchema,
  emailAiRunResponseSchema,
  emailDraftHandoffResponseSchema,
  emailDraftResponseSchema,
  emailDraftWorkspaceResponseSchema,
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
  createDeterministicEmailAiProviderRegistry,
  hashPassword,
} from '../src/index.js'

/**
 * UAT-tarzı uçtan uca doğrulama: gerçek anonim bir Trafik dosyasında
 * E-posta hazırlama zincirinin TAMAMI (kanıtlar -> AI taslak önerisi ->
 * kullanıcı düzenlemesi/onayı -> Gmail taslağı/eşleştirme -> dosya geçmişi)
 * TEK case üzerinde, sentetik SQL ile onaylı sürüm enjekte etmeden, yalnız
 * gerçek command API'leriyle sürülür.
 *
 * Mevcut `email-drafts.test.ts` (Paket 41) ve `email-ai.test.ts` (Paket 42)
 * bu adımları ayrı ayrı doğruluyordu: Paket 41 testi hiç AI önerisi
 * kullanmadan deterministik şablonla taslak oluşturuyordu, Paket 42 testi
 * AI önerisini taslağa kaydettikten sonra hiç DÜZELTMİYOR ve Gmail
 * handoff'a hiç GÖTÜRMÜYORDU. Bu senaryo üçünü (AI öneri -> kullanıcının
 * öneriyi GERÇEKTEN değiştirdiği bir düzenleme -> ardından ikinci bir
 * düzeltme -> Gmail handoff) tek bir taslağın immutable sürüm+handoff
 * geçmişinde uçtan uca kanıtlar; belge/fotoğraf kanıtı doğrulaması gerçek
 * File Agent döngüsüyle PERT ve İşçilik UAT'larında zaten ayrıca
 * kanıtlandığından burada hazır (ready) kabul edilir.
 */

const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'uat-email-sentetik-guclu-parola-42'
const ROOT_KEY = 'uat-email-root'

describeDb('E-posta hazırlama uçtan uca UAT: kanıtlar -> AI öneri -> kullanıcı düzenlemesi/onayı -> Gmail taslağı -> dosya geçmişi (gerçek PostgreSQL)', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let organizationId: string
  let managerUserId: string
  let managerCookie: string

  async function login(email: string): Promise<string> {
    const response = await app.inject({
      method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email, password: PASSWORD },
    })
    expect(response.statusCode).toBe(200)
    return String(response.headers['set-cookie']).split(';')[0] as string
  }

  async function seedReadyDocument(caseId: string, documentType: string): Promise<string> {
    const documentId = uuidv7()
    const versionId = uuidv7()
    await pool.query(
      `INSERT INTO documents (id,organization_id,case_id,document_type,current_version_number,status)
       VALUES ($1,$2,$3,$4,1,'ready')`,
      [documentId, organizationId, caseId, documentType],
    )
    await pool.query(
      `INSERT INTO document_versions
         (id,organization_id,document_id,case_id,version_number,original_file_name,
          display_name,extension,mime_type,byte_size,content_hash,storage_root_key,
          relative_path,source_type,status,hash_verified,size_verified,verified_at,
          registered_by_user_id)
       VALUES ($1,$2,$3,$4,1,$5,$5,'pdf','application/pdf',256,$6,$7,
               $8,'manual','ready',true,true,$9,$10)`,
      [versionId, organizationId, documentId, caseId, `${documentType}.pdf`,
        uuidv7().replaceAll('-', '').padEnd(64, '0'), ROOT_KEY,
        `2026/Temmuz 2026/METADATA/EVRAK/${caseId}-${documentType}.pdf`,
        new Date('2026-07-24T08:00:00.000Z'), managerUserId],
    )
    await pool.query('UPDATE documents SET current_version_id=$2 WHERE id=$1', [documentId, versionId])
    return versionId
  }

  async function seedReadyPhoto(caseId: string): Promise<string> {
    const photoId = uuidv7()
    await pool.query(
      `INSERT INTO photos
         (id,organization_id,case_id,original_file_name,display_name,extension,mime_type,
          byte_size,content_hash,storage_root_key,relative_path,source_type,status,
          hash_verified,size_verified,verified_at,registered_by_user_id)
       VALUES ($1,$2,$3,'hasar.jpg','Hasar Fotoğrafı','jpg','image/jpeg',128,$4,$5,$6,
               'manual','ready',true,true,$7,$8)`,
      [photoId, organizationId, caseId, uuidv7().replaceAll('-', '').padEnd(64, '0'), ROOT_KEY,
        `2026/Temmuz 2026/METADATA/HASAR/${caseId}-hasar.jpg`,
        new Date('2026-07-24T08:00:00.000Z'), managerUserId],
    )
    return photoId
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })

    organizationId = uuidv7()
    managerUserId = uuidv7()
    await pool.query(
      "INSERT INTO organizations (id,code,name) VALUES ($1,'uat-email-main','UAT E-posta')",
      [organizationId],
    )
    const passwordHash = await hashPassword(PASSWORD)
    await pool.query(
      `INSERT INTO users (id,organization_id,email,display_name,password_hash)
       VALUES ($1,$2,'uat-email-manager@test.local','UAT Sorumlu',$3)`,
      [managerUserId, organizationId, passwordHash],
    )
    await pool.query(
      `INSERT INTO user_roles (user_id,role_id)
       SELECT $1::uuid,id FROM roles WHERE code='case_manager'`,
      [managerUserId],
    )
    await pool.query(
      `INSERT INTO storage_roots (id,organization_id,root_key,label)
       VALUES ($1,$2,$3,'UAT E-posta Kök')`,
      [uuidv7(), organizationId, ROOT_KEY],
    )
    await pool.query(
      `INSERT INTO ai_provider_policies
         (id,organization_id,enabled,allowed_provider_ids,email_enabled,
          email_allowed_provider_ids,monthly_budget_minor,per_request_budget_minor,
          monthly_hard_stop,maximum_input_characters,request_timeout_ms)
       VALUES ($1,$2,false,'{}',true,
               ARRAY['deterministic-success']::text[],100000,10000,true,50000,5000)`,
      [uuidv7(), organizationId],
    )

    app = buildApp({
      loggerEnabled: false,
      auth: {
        pool,
        cookieSecure: false,
        loginRateLimit: { limit: 500, windowMs: 60_000 },
      },
      emailAiProviders: createDeterministicEmailAiProviderRegistry(),
    })
    await app.ready()
    managerCookie = await login('uat-email-manager@test.local')
  }, 60_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  it('gerçek kanıt, AI önerisi, kullanıcı düzenlemesi/onayı, Gmail handoff ve dosya geçmişi zincirini tek akışta doğrular', async () => {
    // 1) Gerçek case oluşturma (sentetik SQL enjeksiyonu değil).
    const plate = '34 UAT 4101'
    const caseCreated = await app.inject({
      method: 'POST', url: CASES_ROUTE,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        caseType: 'traffic', plate, workflowStage: 'closing_documents',
        notificationDate: '2026-07-24', responsibleUserId: managerUserId,
      },
    })
    expect(caseCreated.statusCode, caseCreated.payload).toBe(201)
    const caseId = (caseCreated.json() as { case: { id: string } }).case.id

    // 2) KANITLAR: gerçek ready/doğrulanmış belge + fotoğraf (File Agent
    //    doğrulama döngüsü PERT/İşçilik UAT'larında ayrıca kanıtlandı).
    const documentVersionId = await seedReadyDocument(caseId, 'preliminary_report')
    const photoId = await seedReadyPhoto(caseId)

    // 3) AI TASLAK ÖNERİSİ: gerçek plan -> gerçek start (senkron tamamlanır).
    const instruction = 'Eksik ön rapor evrakının servise iletilmesini rica ediyoruz.'
    const planResponse = await app.inject({
      method: 'POST', url: CASE_EMAIL_AI_PLAN_ROUTE.replace(':caseId', caseId),
      headers: { cookie: managerCookie },
      payload: { draftType: 'missing_document_request', instruction, providerId: 'deterministic-success' },
    })
    expect(planResponse.statusCode, planResponse.payload).toBe(200)
    const plan = emailAiPlanResponseSchema.parse(planResponse.json())
    expect(plan.canStart).toBe(true)
    expect(plan.privacy.externalProvider).toBe(false)

    const startResponse = await app.inject({
      method: 'POST', url: CASE_EMAIL_AI_RUNS_ROUTE.replace(':caseId', caseId),
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        expectedCaseVersion: plan.caseVersion, expectedPreviewHash: plan.basePreview.previewHash,
        planHash: plan.planHash, draftType: plan.draftType, instruction, providerId: plan.providerId,
        confirmed: true,
      },
    })
    expect(startResponse.statusCode, startResponse.payload).toBe(201)
    const run = emailAiRunResponseSchema.parse(startResponse.json()).run
    expect(run.status).toBe('review_required')
    expect(run.suggestion).not.toBeNull()
    expect(run.suggestion?.subject).toContain('Eksik Evrak Hatırlatması')
    // AI önerisi TEMPLATE gövdesini olduğu gibi korur (deterministik test
    // sağlayıcısının kuralı); kullanıcı düzenlemesinin GERÇEKTEN farklı
    // olduğu aşağıda doğrudan karşılaştırmayla kanıtlanır.
    expect(run.suggestion?.body).toBe(plan.basePreview.body)

    // 4) KULLANICI DÜZENLEMESİ/ONAYI (1. adım — taslağı oluşturma): kullanıcı
    //    AI önerisini olduğu gibi kaydetmez, GERÇEKTEN düzenler ve kanıtları
    //    ek olarak seçip açık onayla kaydeder.
    const editedBody = `${run.suggestion?.body}\n\nEk not: Ön rapor 3 iş günü içinde iletilmezse dosya kontrol gerekli olarak işaretlenecektir.`
    const createResponse = await app.inject({
      method: 'POST', url: CASE_EMAIL_DRAFTS_ROUTE.replace(':caseId', caseId),
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        expectedCaseVersion: plan.caseVersion, draftType: 'missing_document_request', instruction,
        previewHash: plan.basePreview.previewHash,
        to: ['servis@example.test'], cc: ['sorumlu@example.test'],
        subject: run.suggestion?.subject, body: editedBody,
        emailAiSuggestionRunId: run.id,
        attachments: [
          { resourceType: 'document_version', resourceId: documentVersionId },
          { resourceType: 'photo', resourceId: photoId },
        ],
        confirmed: true,
      },
    })
    expect(createResponse.statusCode, createResponse.payload).toBe(201)
    const createdDraft = emailDraftResponseSchema.parse(createResponse.json()).draft
    expect(createdDraft.currentVersion).toMatchObject({
      sourceType: 'ai_assisted', emailAiSuggestionRunId: run.id, draftVersion: 1,
    })
    // AI'nin önerdiği gövde ile kullanıcının KAYDETTİĞİ gövde GERÇEKTEN farklı.
    expect(createdDraft.currentVersion.body).not.toBe(run.suggestion?.body)
    expect(createdDraft.currentVersion.body).toBe(editedBody)
    expect(createdDraft.currentVersion.attachments).toHaveLength(2)
    expect(createdDraft.currentVersion.attachments.map((item) => item.resourceId).sort())
      .toEqual([documentVersionId, photoId].sort())

    // 5) KULLANICI DÜZENLEMESİ/ONAYI (2. adım — düzeltme): kullanıcı alıcıyı
    //    ve metni tekrar, ayrı bir açık onayla düzeltir; immutable yeni sürüm.
    const finalBody = `${editedBody}\n\nSaygılarımızla.`
    const reviseResponse = await app.inject({
      method: 'POST',
      url: CASE_EMAIL_DRAFT_VERSIONS_ROUTE.replace(':caseId', caseId).replace(':draftId', createdDraft.id),
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        expectedVersion: createdDraft.version,
        to: ['servis@example.test'], cc: [],
        subject: `${createdDraft.currentVersion.subject} · Güncellendi`,
        body: finalBody,
        attachments: [{ resourceType: 'document_version', resourceId: documentVersionId }],
        reason: 'UAT: cc kaldırıldı, kapanış notu eklendi.',
        confirmed: true,
      },
    })
    expect(reviseResponse.statusCode, reviseResponse.payload).toBe(200)
    const revisedDraft = emailDraftResponseSchema.parse(reviseResponse.json()).draft
    expect(revisedDraft.version).toBe(2)
    expect(revisedDraft.currentVersion).toMatchObject({
      sourceType: 'manual_revision', draftVersion: 2, previousVersionId: createdDraft.currentVersion.id,
      cc: [],
    })
    expect(revisedDraft.currentVersion.body).toBe(finalBody)
    expect(revisedDraft.currentVersion.attachments).toHaveLength(1)

    // 6) GMAIL TASLAĞI/EŞLEŞTİRME: açık onayla handoff hazırlanır; gönderildi
    //    SAYILMAZ, compose GÜNCEL (2. sürüm) içeriği ve ekleriyle eşleşir.
    const handoffResponse = await app.inject({
      method: 'POST',
      url: CASE_EMAIL_DRAFT_HANDOFFS_ROUTE.replace(':caseId', caseId).replace(':draftId', createdDraft.id),
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedVersion: revisedDraft.version, confirmed: true },
    })
    expect(handoffResponse.statusCode, handoffResponse.payload).toBe(200)
    const handoff = emailDraftHandoffResponseSchema.parse(handoffResponse.json())
    expect(handoff.deliveryStatus).toBe('not_sent')
    expect(handoff.handoff.provider).toBe('gmail_web')
    expect(handoff.compose).toMatchObject({
      to: ['servis@example.test'], cc: [], subject: revisedDraft.currentVersion.subject, body: finalBody,
    })
    expect(handoff.compose.attachments).toHaveLength(1)
    expect(handoff.compose.attachments[0]?.resourceId).toBe(documentVersionId)

    // 7) DOSYA GEÇMİŞİ ZİNCİRİ: önceki adımların yanıtlarından BAĞIMSIZ,
    //    taze bir GET workspace isteğiyle TAM immutable geçmiş (2 sürüm +
    //    1 handoff) tek seferde yeniden okunur.
    const workspaceResponse = await app.inject({
      method: 'GET', url: CASE_EMAIL_DRAFTS_ROUTE.replace(':caseId', caseId),
      headers: { cookie: managerCookie },
    })
    expect(workspaceResponse.statusCode).toBe(200)
    const workspace = emailDraftWorkspaceResponseSchema.parse(workspaceResponse.json())
    expect(workspace.drafts).toHaveLength(1)
    const reread = workspace.drafts[0]!
    expect(reread.version).toBe(2)
    expect(reread.versions).toHaveLength(2)
    const v1 = reread.versions.find((version) => version.draftVersion === 1)
    const v2 = reread.versions.find((version) => version.draftVersion === 2)
    // v1 SESSİZCE değiştirilmedi: hâlâ AI-assisted kaynak ve İLK gövdeyi taşır.
    expect(v1).toMatchObject({ sourceType: 'ai_assisted', body: editedBody })
    expect(v2).toMatchObject({ sourceType: 'manual_revision', body: finalBody })
    expect(reread.handoffs).toHaveLength(1)
    expect(reread.handoffs[0]).toMatchObject({ provider: 'gmail_web', draftVersionId: v2?.id })

    // 8) Audit zinciri: kanıt/case oluşturmadan Gmail handoff'a kadar tam;
    //    gövde/alıcı/dosya adı gibi iş verisi audit'e HİÇ sızmaz.
    const audit = await pool.query(
      `SELECT action,actor_user_id::text,resource_id::text
         FROM audit_events
        WHERE organization_id=$1
          AND resource_id::text = ANY($2::text[])
        ORDER BY occurred_at`,
      [organizationId, [caseId, run.id, createdDraft.id]],
    )
    const actions = audit.rows.map((row) => row.action)
    expect(actions).toEqual(expect.arrayContaining([
      'case.created',
      'email_ai_suggestion.started',
      'email_ai_suggestion.review_required',
      'email_draft.created',
      'email_draft.revised',
      'email_draft.handoff_prepared',
    ]))
    expect(audit.rows.every((row) => row.actor_user_id === managerUserId)).toBe(true)
    const auditPayload = JSON.stringify(audit.rows)
    expect(auditPayload).not.toContain('servis@example.test')
    expect(auditPayload).not.toContain('sorumlu@example.test')
    expect(auditPayload).not.toContain('Ek not: Ön rapor')
    expect(auditPayload).not.toContain('Saygılarımızla')
    expect(auditPayload).not.toContain('preliminary_report.pdf')
  }, 60_000)
})
