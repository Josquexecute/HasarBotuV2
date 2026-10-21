import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AUTH_LOGIN_ROUTE,
  CASES_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  documentRegisterResponseSchema,
  documentsListResponseSchema,
  photoRegisterResponseSchema,
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

const PASSWORD = 'cok-guclu-parola-42'
const hex = (seed: string): string => createHash('sha256').update(seed).digest('hex')

describeDb('Belge/fotoğraf metadata (gerçek veritabanı)', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let orgA: string
  let cookieA: string
  let cookieB: string
  let caseAId: string
  let caseA2Id: string
  let caseBId: string

  async function seedUser(orgId: string, email: string): Promise<string> {
    const id = uuidv7()
    await pool.query(
      'INSERT INTO users (id, organization_id, email, display_name, password_hash) VALUES ($1,$2,$3,$4,$5)',
      [id, orgId, email, email.split('@')[0], await hashPassword(PASSWORD)],
    )
    await pool.query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, (SELECT id FROM roles WHERE code='case_manager'))", [id])
    return id
  }
  async function loginCookie(email: string): Promise<string> {
    const res = await app.inject({ method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email, password: PASSWORD } })
    const c = res.headers['set-cookie']
    return String(Array.isArray(c) ? c[0] : c).split(';')[0] as string
  }
  async function createCase(cookie: string, plate: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: CASES_ROUTE,
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { caseType: 'traffic', plate },
    })
    return (res.json() as { case: { id: string } }).case.id
  }
  function docBody(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      documentType: 'ruhsat',
      sourceType: 'upload',
      originalFileName: 'ruhsat.pdf',
      mimeType: 'application/pdf',
      byteSize: 2048,
      contentHash: hex('doc-default'),
      storageRootKey: 'office-primary',
      relativePath: '2026/EVRAK/ruhsat.pdf',
      ...over,
    }
  }
  function registerDoc(cookie: string, caseId: string, body: Record<string, unknown>, key?: string) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/documents`,
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: key ?? uuidv7() },
      payload: body,
    })
  }
  function registerPhoto(cookie: string, caseId: string, body: Record<string, unknown>, key?: string) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/photos`,
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: key ?? uuidv7() },
      payload: body,
    })
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    orgA = uuidv7()
    const orgB = uuidv7()
    await pool.query('INSERT INTO organizations (id, code, name) VALUES ($1,$2,$3)', [orgA, 'org-a', 'A'])
    await pool.query('INSERT INTO organizations (id, code, name) VALUES ($1,$2,$3)', [orgB, 'org-b', 'B'])
    await seedUser(orgA, 'a@a.example')
    await seedUser(orgB, 'b@b.example')
    await pool.query('INSERT INTO storage_roots (id, organization_id, root_key, label, is_active) VALUES ($1,$2,$3,$4,true)', [uuidv7(), orgA, 'office-primary', 'A Primary'])
    await pool.query('INSERT INTO storage_roots (id, organization_id, root_key, label, is_active) VALUES ($1,$2,$3,$4,true)', [uuidv7(), orgB, 'other-primary', 'B Primary'])
    app = buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false, loginRateLimit: { limit: 1000, windowMs: 60_000 } } })
    cookieA = await loginCookie('a@a.example')
    cookieB = await loginCookie('b@b.example')
    caseAId = await createCase(cookieA, '34 ABC 123')
    caseA2Id = await createCase(cookieA, '34 ABC 456')
    caseBId = await createCase(cookieB, '06 XYZ 789')
  }, 60_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  it('rejects new document and photo metadata after case closure without an audit or idempotency write', async () => {
    const caseId = await createCase(cookieA, '34 END 123')
    await pool.query("UPDATE cases SET lifecycle_status='closed',workflow_stage='closed',closed_at=now() WHERE id=$1", [caseId])
    const documentKey = uuidv7(), photoKey = uuidv7()
    const [document, photo] = await Promise.all([
      registerDoc(cookieA, caseId, docBody(), documentKey),
      registerPhoto(cookieA, caseId, { sourceType: 'upload', originalFileName: 'closed.jpg', mimeType: 'image/jpeg', byteSize: 4096, contentHash: hex('closed-photo'), storageRootKey: 'office-primary', relativePath: '2026/HASAR/closed.jpg' }, photoKey),
    ])
    expect(document.statusCode).toBe(409)
    expect(photo.statusCode).toBe(409)
    expect((await pool.query('SELECT 1 FROM documents WHERE case_id=$1', [caseId])).rowCount).toBe(0)
    expect((await pool.query('SELECT 1 FROM photos WHERE case_id=$1', [caseId])).rowCount).toBe(0)
    expect((await pool.query("SELECT 1 FROM audit_events WHERE resource_id=$1 AND action IN ('document.registered','document.version_registered','photo.registered')", [caseId])).rowCount).toBe(0)
    expect((await pool.query('SELECT 1 FROM idempotency_keys WHERE idem_key=ANY($1::text[])', [[documentKey, photoKey]])).rowCount).toBe(0)
  })

  it.each(['document', 'photo'])('waits for an in-flight closure before registering %s metadata', async kind => {
    const caseId = await createCase(cookieA, kind === 'document' ? '34 LCK 123' : '34 LCK 124')
    const closer = await pool.connect()
    let pending: ReturnType<typeof registerDoc> | undefined
    try {
      await closer.query('BEGIN')
      const pid = (await closer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
      await closer.query("UPDATE cases SET lifecycle_status='closed',workflow_stage='closed',closed_at=now() WHERE id=$1", [caseId])
      pending = kind === 'document'
        ? registerDoc(cookieA, caseId, docBody())
        : registerPhoto(cookieA, caseId, { sourceType: 'upload', originalFileName: 'locked.jpg', mimeType: 'image/jpeg', byteSize: 4096, contentHash: hex('locked-photo'), storageRootKey: 'office-primary', relativePath: '2026/HASAR/locked.jpg' })
      await vi.waitFor(async () => {
        const blocked = await pool.query("SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) AND query LIKE 'SELECT lifecycle_status FROM cases%FOR UPDATE'", [pid])
        expect(blocked.rowCount).toBe(1)
      }, { timeout: 3000, interval: 10 })
      await closer.query('COMMIT')
      expect((await pending).statusCode).toBe(409)
      expect((await pool.query('SELECT 1 FROM documents WHERE case_id=$1 UNION ALL SELECT 1 FROM photos WHERE case_id=$1', [caseId])).rowCount).toBe(0)
    } finally {
      await closer.query('ROLLBACK')
      closer.release()
      if (pending) await pending
    }
  })

  it('allows one of ten simultaneous document revisions and preserves the winning version', async () => {
    const caseId = await createCase(cookieA, '34 VER 123')
    const first = (await registerDoc(cookieA, caseId, docBody())).json()
    const revisions = await Promise.all(Array.from({ length: 10 }, (_, index) => registerDoc(cookieA, caseId, docBody({ documentId: first.document.id, expectedVersion: first.document.version, relativePath: `2026/EVRAK/revision-${index}.pdf`, contentHash: hex(`revision-${index}`) }))))
    expect(revisions.filter(response => response.statusCode === 201)).toHaveLength(1)
    expect(revisions.filter(response => response.statusCode === 409)).toHaveLength(9)
    const winner = revisions.find(response => response.statusCode === 201)!.json()
    expect((await pool.query('SELECT current_version_id,current_version_number FROM documents WHERE id=$1', [first.document.id])).rows[0]).toEqual({ current_version_id: winner.version.id, current_version_number: 2 })
    expect((await pool.query('SELECT 1 FROM document_versions WHERE document_id=$1', [first.document.id])).rowCount).toBe(2)
  })

  it.each(['document', 'photo'])('replays ten duplicate %s requests and reports a reused path as a conflict', async kind => {
    const caseId = await createCase(cookieA, kind === 'document' ? '34 DUP 123' : '34 DUP 124')
    const key = uuidv7()
    const body = kind === 'document' ? docBody({ relativePath: '2026/EVRAK/concurrent.pdf' })
      : { sourceType: 'upload', originalFileName: 'concurrent.jpg', mimeType: 'image/jpeg', byteSize: 4096, contentHash: hex('duplicate-photo'), storageRootKey: 'office-primary', relativePath: '2026/HASAR/concurrent.jpg' }
    const register = kind === 'document' ? registerDoc : registerPhoto
    const repeated = await Promise.all(Array.from({ length: 10 }, () => register(cookieA, caseId, body, key)))
    expect(repeated.every(response => response.statusCode === 201)).toBe(true)
    for (const response of repeated) expect(response.json()).toEqual(repeated[0]!.json())
    expect((await register(cookieA, caseId, body)).statusCode).toBe(409)
    expect((await pool.query('SELECT 1 FROM idempotency_keys WHERE idem_key=$1', [key])).rowCount).toBe(1)
  })

  it('belge kaydı: 201, version 1, status pending, hashVerified false; audit üretir', async () => {
    const res = await registerDoc(cookieA, caseAId, docBody({ relativePath: '2026/EVRAK/r1.pdf', contentHash: hex('r1') }))
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(documentRegisterResponseSchema.safeParse(body).success).toBe(true)
    const parsed = body as { document: { version: number; currentVersionNumber: number; status: string }; version: { versionNumber: number; status: string; hashVerified: boolean; verifiedAt: string | null } }
    expect(parsed.document).toMatchObject({ currentVersionNumber: 1, status: 'pending' })
    expect(parsed.version).toMatchObject({ versionNumber: 1, status: 'pending', hashVerified: false, verifiedAt: null })

    const audit = await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action = 'document.registered'")
    expect((audit.rows[0] as { n: number }).n).toBeGreaterThanOrEqual(1)
  })

  it('yeni sürüm: documentId + expectedVersion ile version artar, previousVersionId bağlanır', async () => {
    const first = await registerDoc(cookieA, caseAId, docBody({ relativePath: '2026/EVRAK/v1.pdf', contentHash: hex('v1') }))
    const doc = (first.json() as { document: { id: string; version: number }; version: { id: string } })
    const second = await registerDoc(cookieA, caseAId, docBody({
      documentId: doc.document.id,
      expectedVersion: doc.document.version,
      relativePath: '2026/EVRAK/v2.pdf',
      contentHash: hex('v2'),
    }))
    expect(second.statusCode).toBe(201)
    const body = second.json() as { document: { currentVersionNumber: number }; version: { versionNumber: number; previousVersionId: string | null } }
    expect(body.document.currentVersionNumber).toBe(2)
    expect(body.version.versionNumber).toBe(2)
    expect(body.version.previousVersionId).toBe(doc.version.id)

    const stale = await registerDoc(cookieA, caseAId, docBody({
      documentId: doc.document.id,
      expectedVersion: doc.document.version, // bayat (artık 2)
      relativePath: '2026/EVRAK/v3.pdf',
      contentHash: hex('v3'),
    }))
    expect(stale.statusCode).toBe(409)
    expect((stale.json() as { error: { code: string } }).error.code).toBe('version_conflict')
  })

  it('idempotent tekrar: aynı anahtar+gövde aynı yanıtı döner, kopya üretmez', async () => {
    const key = uuidv7()
    const body = docBody({ relativePath: '2026/EVRAK/idem.pdf', contentHash: hex('idem') })
    const first = await registerDoc(cookieA, caseAId, body, key)
    const second = await registerDoc(cookieA, caseAId, body, key)
    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(201)
    expect(second.json()).toEqual(first.json())

    const diff = await registerDoc(cookieA, caseAId, docBody({ relativePath: '2026/EVRAK/other.pdf', contentHash: hex('other') }), key)
    expect(diff.statusCode).toBe(409)
    expect((diff.json() as { error: { code: string } }).error.code).toBe('idempotency_conflict')
  })

  it('Idempotency-Key zorunlu, MIME/uzantı uyuşmazlığı ve tehlikeli ad reddedilir', async () => {
    const noKey = await app.inject({ method: 'POST', url: `/api/v1/cases/${caseAId}/documents`, headers: { cookie: cookieA }, payload: docBody() })
    expect(noKey.statusCode).toBe(400)

    const mismatch = await registerDoc(cookieA, caseAId, docBody({ originalFileName: 'foto.png', mimeType: 'application/pdf' }))
    expect(mismatch.statusCode).toBe(400)

    const notDoc = await registerDoc(cookieA, caseAId, docBody({ originalFileName: 'foto.jpg', mimeType: 'image/jpeg' }))
    expect(notDoc.statusCode).toBe(400) // jpg document kategorisinde değil

    const traversal = await registerDoc(cookieA, caseAId, docBody({ relativePath: '../escape.pdf' }))
    expect(traversal.statusCode).toBe(400)

    const dangerousName = await registerDoc(cookieA, caseAId, docBody({ originalFileName: '../evil.pdf' }))
    expect(dangerousName.statusCode).toBe(400)
  })

  it('bilinmeyen kök 400 unknown_reference', async () => {
    const res = await registerDoc(cookieA, caseAId, docBody({ storageRootKey: 'yok-root', relativePath: '2026/EVRAK/u.pdf', contentHash: hex('u') }))
    expect(res.statusCode).toBe(400)
    expect((res.json() as { error: { fieldErrors: { code: string }[] } }).error.fieldErrors[0]?.code).toBe('unknown_reference')
  })

  it('aynı hash tespiti: vaka içi sameCaseVersionId; vakalar arası sayılır ama birleştirilmez', async () => {
    const h = hex('shared-content')
    const a = await registerDoc(cookieA, caseAId, docBody({ relativePath: '2026/EVRAK/dupA.pdf', contentHash: h }))
    const aBody = a.json() as { document: { id: string }; version: { id: string }; duplicate: { sameCaseVersionId: string | null } }
    expect(aBody.duplicate.sameCaseVersionId).toBeNull()

    const aAgain = await registerDoc(cookieA, caseAId, docBody({ relativePath: '2026/EVRAK/dupA2.pdf', contentHash: h }))
    const aAgainBody = aAgain.json() as { document: { id: string }; duplicate: { sameCaseVersionId: string | null } }
    expect(aAgainBody.duplicate.sameCaseVersionId).toBe(aBody.version.id)

    const other = await registerDoc(cookieA, caseA2Id, docBody({ relativePath: '2026/EVRAK/dupC.pdf', contentHash: h }))
    const otherBody = other.json() as { document: { id: string }; duplicate: { otherCaseCount: number } }
    expect(otherBody.duplicate.otherCaseCount).toBeGreaterThanOrEqual(1)
    // Birleştirme YOK: farklı vaka -> farklı document.
    expect(otherBody.document.id).not.toBe(aBody.document.id)
  })

  it('fotoğraf kaydı: 201 pending; kategori dışı (.pdf) reddedilir; okuma çalışır', async () => {
    const ok = await registerPhoto(cookieA, caseAId, {
      sourceType: 'upload',
      originalFileName: 'hasar.jpg',
      mimeType: 'image/jpeg',
      byteSize: 4096,
      contentHash: hex('photo1'),
      storageRootKey: 'office-primary',
      relativePath: '2026/HASAR/hasar_001.jpg',
    })
    expect(ok.statusCode).toBe(201)
    expect(photoRegisterResponseSchema.safeParse(ok.json()).success).toBe(true)
    expect((ok.json() as { photo: { status: string } }).photo.status).toBe('pending')

    const notPhoto = await registerPhoto(cookieA, caseAId, {
      sourceType: 'upload',
      originalFileName: 'belge.pdf',
      mimeType: 'application/pdf',
      byteSize: 100,
      contentHash: hex('p2'),
      storageRootKey: 'office-primary',
      relativePath: '2026/HASAR/belge.pdf',
    })
    expect(notPhoto.statusCode).toBe(400)

    const list = await app.inject({ method: 'GET', url: `/api/v1/cases/${caseAId}/photos`, headers: { cookie: cookieA } })
    expect(list.statusCode).toBe(200)
    expect((list.json() as { items: unknown[] }).items.length).toBeGreaterThanOrEqual(1)
  })

  it('okuma: belge listesi + detay (sürümlerle); kiracı izolasyonu 404', async () => {
    const reg = await registerDoc(cookieA, caseAId, docBody({ documentType: 'police', relativePath: '2026/EVRAK/police.pdf', contentHash: hex('police') }))
    const documentId = (reg.json() as { document: { id: string } }).document.id

    const list = await app.inject({ method: 'GET', url: `/api/v1/cases/${caseAId}/documents`, headers: { cookie: cookieA } })
    expect(list.statusCode).toBe(200)
    expect(documentsListResponseSchema.safeParse(list.json()).success).toBe(true)

    const detail = await app.inject({ method: 'GET', url: `/api/v1/documents/${documentId}`, headers: { cookie: cookieA } })
    expect(detail.statusCode).toBe(200)
    expect((detail.json() as { document: { versions: unknown[] } }).document.versions.length).toBeGreaterThanOrEqual(1)

    // Kiracı izolasyonu: B kullanıcısı A belgesini göremez.
    const cross = await app.inject({ method: 'GET', url: `/api/v1/documents/${documentId}`, headers: { cookie: cookieB } })
    expect(cross.statusCode).toBe(404)
    // A, B'nin dosyasına kayıt yapamaz.
    const crossWrite = await registerDoc(cookieA, caseBId, docBody({ storageRootKey: 'office-primary', relativePath: '2026/EVRAK/x.pdf', contentHash: hex('x') }))
    expect(crossWrite.statusCode).toBe(404)
  })

  it('oturumsuz erişim 401', async () => {
    expect((await app.inject({ method: 'GET', url: `/api/v1/cases/${caseAId}/documents` })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: `/api/v1/cases/${caseAId}/documents`, payload: docBody() })).statusCode).toBe(401)
  })

  it('güvenlik: hiçbir audit details mutlak yol içermez', async () => {
    const leak = await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE details::text ~ '[A-Za-z]:' OR strpos(details::text, chr(92)) > 0")
    expect((leak.rows[0] as { n: number }).n).toBe(0)
  })

  it('DB savunması: ready doğrulama olmadan reddedilir; kayıtlı gerçek immutable; DELETE yasak', async () => {
    const reg = await registerDoc(cookieA, caseAId, docBody({ relativePath: '2026/EVRAK/guard.pdf', contentHash: hex('guard') }))
    const versionId = (reg.json() as { version: { id: string } }).version.id

    // ready CHECK: doğrulama alanları olmadan status=ready reddedilir.
    await expect(
      pool.query("UPDATE document_versions SET status = 'ready' WHERE id = $1", [versionId]),
    ).rejects.toThrow()

    // Kayıtlı gerçek immutable: original_file_name değiştirilemez.
    await expect(
      pool.query("UPDATE document_versions SET original_file_name = 'hacked.pdf' WHERE id = $1", [versionId]),
    ).rejects.toThrow(/immutable/)

    // DELETE yasak.
    await expect(pool.query('DELETE FROM document_versions WHERE id = $1', [versionId])).rejects.toThrow(/append-only/)

    // File Agent yolu: yalnız doğrulama alanları güncellenebilir ve ready olur.
    await pool.query(
      "UPDATE document_versions SET hash_verified = true, size_verified = true, verified_at = now(), status = 'ready' WHERE id = $1",
      [versionId],
    )
    const after = await pool.query('SELECT status FROM document_versions WHERE id = $1', [versionId])
    expect((after.rows[0] as { status: string }).status).toBe('ready')
  })

  it('DB savunması: document_versions traversal relative_path doğrudan INSERT ile reddedilir', async () => {
    const docRow = await pool.query('SELECT id FROM documents LIMIT 1')
    const documentId = (docRow.rows[0] as { id: string }).id
    await expect(
      pool.query(
        `INSERT INTO document_versions (id, organization_id, document_id, case_id, version_number,
           original_file_name, display_name, mime_type, byte_size, content_hash, storage_root_key,
           relative_path, source_type)
         VALUES ($1,$2,$3,$4,99,'x.pdf','x.pdf','application/pdf',1,$5,'office-primary','../escape.pdf','upload')`,
        [uuidv7(), orgA, documentId, caseAId, hex('bad')],
      ),
    ).rejects.toThrow()
  })
})
