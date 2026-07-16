import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AUTH_LOGIN_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  emailDraftHandoffResponseSchema,
  emailDraftPreviewResponseSchema,
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
import { buildApp, fixedClock, hashPassword } from '../src/index.js'

const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'p41-sentetik-guclu-parola-42'

describeDb('Paket 41 e-posta taslak ve Gmail handoff gerçek API', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let organizationId: string
  let foreignOrganizationId: string
  let managerUserId: string
  let caseId: string
  let closedCaseId: string
  let foreignCaseId: string
  let readyDocumentVersionId: string
  let pendingDocumentVersionId: string
  let readyPhotoId: string
  let managerCookie: string
  let readOnlyCookie: string

  const draftsUrl = (targetCaseId = caseId) => `/api/v1/cases/${targetCaseId}/email-drafts`
  const previewUrl = (targetCaseId = caseId) => `${draftsUrl(targetCaseId)}/preview`

  async function login(email: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: AUTH_LOGIN_ROUTE,
      payload: { email, password: PASSWORD },
    })
    expect(response.statusCode).toBe(200)
    return String(response.headers['set-cookie']).split(';')[0] as string
  }

  async function seedDocument(
    documentType: string,
    status: 'ready' | 'pending',
    fileName: string,
  ): Promise<string> {
    const documentId = uuidv7()
    const versionId = uuidv7()
    const ready = status === 'ready'
    await pool.query(
      `INSERT INTO documents
         (id,organization_id,case_id,document_type,current_version_number,status)
       VALUES ($1,$2,$3,$4,1,$5)`,
      [documentId, organizationId, caseId, documentType, status],
    )
    await pool.query(
      `INSERT INTO document_versions
         (id,organization_id,document_id,case_id,version_number,original_file_name,
          display_name,extension,mime_type,byte_size,content_hash,storage_root_key,
          relative_path,source_type,status,hash_verified,size_verified,verified_at,
          registered_by_user_id)
       VALUES ($1,$2,$3,$4,1,$5,$5,'pdf','application/pdf',256,$6,'synthetic-root',
               $7,'manual',$8,$9,$9,$10,$11)`,
      [
        versionId,
        organizationId,
        documentId,
        caseId,
        fileName,
        status === 'ready' ? 'a'.repeat(64) : 'b'.repeat(64),
        `sentetik/${versionId}/${fileName}`,
        status,
        ready,
        ready ? '2026-07-16T08:00:00.000Z' : null,
        managerUserId,
      ],
    )
    await pool.query('UPDATE documents SET current_version_id=$2 WHERE id=$1', [documentId, versionId])
    return versionId
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })

    organizationId = uuidv7()
    foreignOrganizationId = uuidv7()
    managerUserId = uuidv7()
    const readOnlyUserId = uuidv7()
    const foreignUserId = uuidv7()
    caseId = uuidv7()
    closedCaseId = uuidv7()
    foreignCaseId = uuidv7()
    const passwordHash = await hashPassword(PASSWORD)
    await pool.query(
      `INSERT INTO organizations (id,code,name)
       VALUES ($1,'p41-main','P41 Sentetik'),($2,'p41-foreign','P41 Yabancı')`,
      [organizationId, foreignOrganizationId],
    )
    await pool.query(
      `INSERT INTO users (id,organization_id,email,display_name,password_hash)
       VALUES
       ($1,$4,'p41-manager@test.local','P41 Dosya Sorumlusu',$6),
       ($2,$4,'p41-readonly@test.local','P41 Salt Okunur',$6),
       ($3,$5,'p41-foreign@test.local','P41 Yabancı',$6)`,
      [managerUserId, readOnlyUserId, foreignUserId, organizationId, foreignOrganizationId, passwordHash],
    )
    await pool.query(
      `INSERT INTO user_roles (user_id,role_id)
       SELECT $1::uuid,id FROM roles WHERE code='case_manager'
       UNION ALL SELECT $2::uuid,id FROM roles WHERE code='read_only'`,
      [managerUserId, readOnlyUserId],
    )
    await pool.query(
      `INSERT INTO cases
         (id,organization_id,office_year,office_sequence,office_number,case_type,
          lifecycle_status,workflow_stage,plate,plate_normalized,responsible_user_id,
          notification_date,version)
       VALUES
       ($1,$4,2026,4101,'2026/4101','traffic','open','reporting','34 P 4101','34P4101',$5,'2026-07-16',3),
       ($2,$4,2026,4102,'2026/4102','traffic','closed','closed','34 P 4102','34P4102',$5,'2026-07-16',1),
       ($3,$6,2026,4103,'2026/4103','traffic','open','reporting','35 P 4103','35P4103',$7,'2026-07-16',1)`,
      [caseId, closedCaseId, foreignCaseId, organizationId, managerUserId, foreignOrganizationId, foreignUserId],
    )
    await pool.query(
      `INSERT INTO storage_roots (id,organization_id,root_key,label)
       VALUES ($1,$2,'synthetic-root','Sentetik Root')`,
      [uuidv7(), organizationId],
    )
    readyDocumentVersionId = await seedDocument('preliminary_report', 'ready', 'Sentetik Ön Rapor.pdf')
    pendingDocumentVersionId = await seedDocument('casco_policy', 'pending', 'Bekleyen Poliçe.pdf')
    readyPhotoId = uuidv7()
    await pool.query(
      `INSERT INTO photos
         (id,organization_id,case_id,original_file_name,display_name,extension,mime_type,
          byte_size,content_hash,storage_root_key,relative_path,source_type,status,
          hash_verified,size_verified,verified_at,registered_by_user_id)
       VALUES ($1,$2,$3,'Sentetik Hasar.jpg','Sentetik Hasar.jpg','jpg','image/jpeg',
               128,$4,'synthetic-root',$5,'manual','ready',true,true,
               '2026-07-16T08:00:00.000Z',$6)`,
      [readyPhotoId, organizationId, caseId, 'c'.repeat(64), `sentetik/${readyPhotoId}/hasar.jpg`, managerUserId],
    )

    app = buildApp({
      clock: fixedClock('2026-07-16T10:30:00.000Z'),
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 100, windowMs: 60_000 } },
    })
    managerCookie = await login('p41-manager@test.local')
    readOnlyCookie = await login('p41-readonly@test.local')
  }, 90_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  it('preview salt okunurdur, alıcı tahmin etmez ve yalnız ready/verified eki önerir', async () => {
    const before = await pool.query('SELECT count(*)::int AS n FROM email_drafts')
    const response = await app.inject({
      method: 'POST',
      url: previewUrl(),
      headers: { cookie: managerCookie },
      payload: { draftType: 'preliminary_report_notice' },
    })
    expect(response.statusCode).toBe(200)
    const preview = emailDraftPreviewResponseSchema.parse(response.json())
    expect(preview).toMatchObject({
      caseId,
      caseVersion: 3,
      recipientStatus: 'control_required',
      requiresHumanReview: true,
    })
    expect(preview.attachmentOptions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        resourceType: 'document_version',
        resourceId: readyDocumentVersionId,
        preferred: true,
        status: 'ready',
      }),
      expect.objectContaining({
        resourceType: 'photo',
        resourceId: readyPhotoId,
        status: 'ready',
      }),
    ]))
    expect(preview.attachmentOptions.some((item) => item.resourceId === pendingDocumentVersionId)).toBe(false)
    expect((await pool.query('SELECT count(*)::int AS n FROM email_drafts')).rows).toEqual(before.rows)
    expect((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action LIKE 'email_draft.%'")).rows).toEqual([{ n: 0 }])
  })

  it('401, tenant 404, salt-okunur rol ve kapalı case sınırlarını uygular', async () => {
    expect((await app.inject({ method: 'GET', url: draftsUrl() })).statusCode).toBe(401)
    expect((await app.inject({
      method: 'GET',
      url: draftsUrl(foreignCaseId),
      headers: { cookie: managerCookie },
    })).statusCode).toBe(404)
    const readOnly = await app.inject({
      method: 'GET',
      url: draftsUrl(),
      headers: { cookie: readOnlyCookie },
    })
    expect(readOnly.statusCode).toBe(200)
    expect(emailDraftWorkspaceResponseSchema.parse(readOnly.json()).permissions.canWrite).toBe(false)
    expect((await app.inject({
      method: 'POST',
      url: previewUrl(),
      headers: { cookie: readOnlyCookie },
      payload: { draftType: 'case_status_update' },
    })).statusCode).toBe(200)
    expect((await app.inject({
      method: 'POST',
      url: draftsUrl(),
      headers: { cookie: readOnlyCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        expectedCaseVersion: 3,
        draftType: 'case_status_update',
        previewHash: 'a'.repeat(64),
        to: ['hasar@example.test'],
        subject: 'Durum',
        body: 'Merhaba.',
        confirmed: true,
      },
    })).statusCode).toBe(403)
    const closedPreview = emailDraftPreviewResponseSchema.parse((await app.inject({
      method: 'POST',
      url: previewUrl(closedCaseId),
      headers: { cookie: managerCookie },
      payload: { draftType: 'case_status_update' },
    })).json())
    expect((await app.inject({
      method: 'POST',
      url: draftsUrl(closedCaseId),
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        expectedCaseVersion: 1,
        draftType: 'case_status_update',
        previewHash: closedPreview.previewHash,
        to: ['hasar@example.test'],
        subject: closedPreview.subject,
        body: closedPreview.body,
        confirmed: true,
      },
    })).statusCode).toBe(409)
  })

  it('taslağı idempotent oluşturur, doğrulanmamış eki ve stale previewı reddeder', async () => {
    const preview = emailDraftPreviewResponseSchema.parse((await app.inject({
      method: 'POST',
      url: previewUrl(),
      headers: { cookie: managerCookie },
      payload: { draftType: 'preliminary_report_notice' },
    })).json())
    const payload = {
      expectedCaseVersion: 3,
      draftType: 'preliminary_report_notice',
      previewHash: preview.previewHash,
      to: [' Hasar@Example.Test '],
      cc: ['Eksper@example.test'],
      subject: `${preview.subject} · Kullanıcı kontrolü`,
      body: preview.body,
      attachments: [{ resourceType: 'document_version', resourceId: readyDocumentVersionId }],
      confirmed: true,
    }
    const key = uuidv7()
    const first = await app.inject({
      method: 'POST',
      url: draftsUrl(),
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: key },
      payload,
    })
    const replay = await app.inject({
      method: 'POST',
      url: draftsUrl(),
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: key },
      payload,
    })
    expect(first.statusCode, first.body).toBe(201)
    expect(replay.statusCode).toBe(201)
    expect(replay.json()).toEqual(first.json())
    const draft = emailDraftResponseSchema.parse(first.json()).draft
    expect(draft.currentVersion.to).toEqual(['hasar@example.test'])
    expect(draft.currentVersion.cc).toEqual(['eksper@example.test'])
    expect(draft.currentVersion.attachments[0]?.resourceId).toBe(readyDocumentVersionId)
    expect((await pool.query('SELECT count(*)::int AS n FROM email_drafts WHERE case_id=$1', [caseId])).rows).toEqual([{ n: 1 }])

    const unverified = await app.inject({
      method: 'POST',
      url: draftsUrl(),
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        ...payload,
        attachments: [{ resourceType: 'document_version', resourceId: pendingDocumentVersionId }],
      },
    })
    expect(unverified.statusCode).toBe(400)
    const stale = await app.inject({
      method: 'POST',
      url: draftsUrl(),
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { ...payload, previewHash: 'f'.repeat(64) },
    })
    expect(stale.statusCode).toBe(409)
  })

  it('düzeltmeyi yeni immutable sürüm yapar ve stale expectedVersionı reddeder', async () => {
    const workspace = emailDraftWorkspaceResponseSchema.parse((await app.inject({
      method: 'GET',
      url: draftsUrl(),
      headers: { cookie: managerCookie },
    })).json())
    const draft = workspace.drafts[0]!
    const reviseUrl = `${draftsUrl()}/${draft.id}/versions`
    const payload = {
      expectedVersion: draft.version,
      to: ['hasar@example.test'],
      cc: [],
      subject: 'Düzeltilmiş sentetik konu',
      body: 'Merhaba.\n\nKullanıcı tarafından kontrollü biçimde düzenlendi.',
      attachments: [{ resourceType: 'photo', resourceId: readyPhotoId }],
      reason: 'Alıcı ve metin kullanıcı kontrolüyle güncellendi.',
      confirmed: true,
    }
    const revised = await app.inject({
      method: 'POST',
      url: reviseUrl,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload,
    })
    expect(revised.statusCode).toBe(200)
    const result = emailDraftResponseSchema.parse(revised.json()).draft
    expect(result.version).toBe(2)
    expect(result.versions).toHaveLength(2)
    expect(result.currentVersion.sourceType).toBe('manual_revision')
    expect(result.currentVersion.previousVersionId).toBe(draft.currentVersion.id)
    expect(result.versions.some((version) => version.id === draft.currentVersion.id)).toBe(true)
    expect((await app.inject({
      method: 'POST',
      url: reviseUrl,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload,
    })).statusCode).toBe(409)
    await expect(pool.query(
      'UPDATE email_draft_versions SET subject=$1 WHERE id=$2',
      ['Sessiz değişiklik', draft.currentVersion.id],
    )).rejects.toMatchObject({ code: '23001' })
  })

  it('Gmail handoff hazırlığını açık onayla kaydeder fakat gönderilmiş saymaz', async () => {
    const draft = emailDraftWorkspaceResponseSchema.parse((await app.inject({
      method: 'GET',
      url: draftsUrl(),
      headers: { cookie: managerCookie },
    })).json()).drafts[0]!
    const handoffUrl = `${draftsUrl()}/${draft.id}/handoffs`
    const key = uuidv7()
    const payload = { expectedVersion: draft.version, confirmed: true }
    const first = await app.inject({
      method: 'POST',
      url: handoffUrl,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: key },
      payload,
    })
    const replay = await app.inject({
      method: 'POST',
      url: handoffUrl,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: key },
      payload,
    })
    expect(first.statusCode).toBe(200)
    expect(replay.json()).toEqual(first.json())
    const response = emailDraftHandoffResponseSchema.parse(first.json())
    expect(response.deliveryStatus).toBe('not_sent')
    expect(response.handoff.provider).toBe('gmail_web')
    expect(response.compose.attachments[0]?.resourceId).toBe(readyPhotoId)
    expect((await pool.query('SELECT count(*)::int AS n FROM email_handoffs WHERE draft_id=$1', [draft.id])).rows).toEqual([{ n: 1 }])
  })

  it('audit yalnız güvenli özet taşır; gövde, alıcı, yol ve secret sızmaz', async () => {
    const audits = await pool.query(
      `SELECT action,details::text AS details
         FROM audit_events
        WHERE action LIKE 'email_draft.%'
        ORDER BY occurred_at,id`,
    )
    expect(audits.rows.map((row: { action: string }) => row.action)).toEqual([
      'email_draft.created',
      'email_draft.revised',
      'email_draft.handoff_prepared',
    ])
    const serialized = JSON.stringify(audits.rows)
    expect(serialized).not.toContain('hasar@example.test')
    expect(serialized).not.toContain('Kullanıcı tarafından kontrollü')
    expect(serialized).not.toContain('Sentetik Ön Rapor.pdf')
    expect(serialized).not.toMatch(/[A-Za-z]:[\\/]|\\\\|password|secret/i)
  })
})
