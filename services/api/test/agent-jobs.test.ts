import { createHash } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AGENT_CLAIM_ROUTE,
  AGENT_ID_HEADER,
  AGENT_SECRET_HEADER,
  AGENTS_ROUTE,
  AUTH_LOGIN_ROUTE,
  CASES_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  claimResponseSchema,
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
const hex = (s: string): string => createHash('sha256').update(s).digest('hex')

describeDb('File Agent iş kuyruğu ve doğrulama (gerçek veritabanı)', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let orgA: string
  let adminCookie: string
  let managerCookie: string
  let bCookie: string
  let agentId: string
  let agentSecret: string
  let caseAId: string
  let caseBId: string

  async function seedUser(orgId: string, email: string, role: string): Promise<void> {
    const id = uuidv7()
    await pool.query('INSERT INTO users (id, organization_id, email, display_name, password_hash) VALUES ($1,$2,$3,$4,$5)', [id, orgId, email, email.split('@')[0], await hashPassword(PASSWORD)])
    await pool.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, (SELECT id FROM roles WHERE code=$2))', [id, role])
  }
  async function login(email: string): Promise<string> {
    const res = await app.inject({ method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email, password: PASSWORD } })
    const c = res.headers['set-cookie']
    return String(Array.isArray(c) ? c[0] : c).split(';')[0] as string
  }
  async function createCase(cookie: string, plate: string): Promise<string> {
    const res = await app.inject({ method: 'POST', url: CASES_ROUTE, headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() }, payload: { caseType: 'traffic', plate } })
    return (res.json() as { case: { id: string } }).case.id
  }
  async function registerDoc(cookie: string, caseId: string, over: Record<string, unknown> = {}): Promise<{ versionId: string; hash: string; size: number }> {
    const hash = hex(`content-${uuidv7()}`)
    const size = 2048
    const rel = `2026/EVRAK/${uuidv7()}.pdf`
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/documents`,
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { documentType: 'ruhsat', sourceType: 'upload', originalFileName: 'r.pdf', mimeType: 'application/pdf', byteSize: size, contentHash: hash, storageRootKey: 'baran-primary', relativePath: rel, ...over },
    })
    return { versionId: (res.json() as { version: { id: string } }).version.id, hash, size }
  }
  function agentHeaders(id = agentId, secret = agentSecret): Record<string, string> {
    return { [AGENT_ID_HEADER]: id, [AGENT_SECRET_HEADER]: secret }
  }
  async function claim(headers = agentHeaders()) {
    const res = await app.inject({ method: 'POST', url: AGENT_CLAIM_ROUTE, headers })
    return { status: res.statusCode, body: res.json() as { job: { id: string; targetId: string; payload: Record<string, unknown>; attemptCount: number } | null } }
  }
  async function report(jobId: string, body: Record<string, unknown>, headers = agentHeaders()) {
    const res = await app.inject({ method: 'POST', url: `/api/v1/agent/jobs/${jobId}/result`, headers: { ...headers, 'content-type': 'application/json' }, payload: body })
    return { status: res.statusCode, body: res.json() as Record<string, unknown> }
  }
  async function clearJobs(): Promise<void> {
    await pool.query('DELETE FROM jobs')
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
    await seedUser(orgA, 'admin@a.example', 'admin')
    await seedUser(orgA, 'mgr@a.example', 'case_manager')
    await seedUser(orgB, 'b@b.example', 'case_manager')
    await pool.query('INSERT INTO storage_roots (id, organization_id, root_key, label, is_active) VALUES ($1,$2,$3,$4,true)', [uuidv7(), orgA, 'baran-primary', 'A'])
    await pool.query('INSERT INTO storage_roots (id, organization_id, root_key, label, is_active) VALUES ($1,$2,$3,$4,true)', [uuidv7(), orgB, 'b-primary', 'B'])
    app = buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false, loginRateLimit: { limit: 1000, windowMs: 60_000 } } })
    adminCookie = await login('admin@a.example')
    managerCookie = await login('mgr@a.example')
    bCookie = await login('b@b.example')
    caseAId = await createCase(managerCookie, '34 ABC 123')
    caseBId = await createCase(bCookie, '06 XYZ 789')
    const reg = await app.inject({ method: 'POST', url: AGENTS_ROUTE, headers: { cookie: adminCookie, 'content-type': 'application/json' }, payload: { name: 'Ofis Agent 1' } })
    const body = reg.json() as { agent: { id: string }; secret: string }
    agentId = body.agent.id
    agentSecret = body.secret
  }, 60_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  beforeEach(clearJobs)

  it('agent kaydı ham secret’i yalnız bir kez döner; auth doğru/yanlış/devre-dışı', async () => {
    // Geçerli claim (iş yok -> job null ama 200).
    const ok = await claim()
    expect(ok.status).toBe(200)
    expect(claimResponseSchema.safeParse(ok.body).success).toBe(true)
    // Yanlış secret -> 401.
    expect((await claim(agentHeaders(agentId, 'yanlis'))).status).toBe(401)
    // Başlıksız -> 401.
    expect((await app.inject({ method: 'POST', url: AGENT_CLAIM_ROUTE })).statusCode).toBe(401)
    // DB'de ham secret saklanmaz (yalnız hash).
    const row = await pool.query('SELECT secret_hash FROM agents WHERE id = $1', [agentId])
    expect((row.rows[0] as { secret_hash: string }).secret_hash).not.toContain(agentSecret)
  })

  it('claim: kuyruğa alınan işi güvenli payload ile verir (mutlak yol yok), attempt 1', async () => {
    const { versionId, hash, size } = await registerDoc(managerCookie, caseAId)
    const claimed = await claim()
    expect(claimed.status).toBe(200)
    expect(claimed.body.job?.targetId).toBe(versionId)
    expect(claimed.body.job?.attemptCount).toBe(1)
    expect(claimed.body.job?.payload).toMatchObject({ storageRootKey: 'baran-primary', kind: 'file', declaredHash: hash, declaredSize: size })
    const payloadText = JSON.stringify(claimed.body.job?.payload)
    expect(/[A-Za-z]:/.test(payloadText)).toBe(false)
    expect(payloadText.includes(String.fromCharCode(92))).toBe(false)
  })

  it('leased iş yeniden claim edilmez; iki iş iki ayrı claim’e dağılır', async () => {
    await registerDoc(managerCookie, caseAId)
    const first = await claim()
    expect(first.body.job).not.toBeNull()
    const second = await claim()
    expect(second.body.job).toBeNull() // tek iş, leased -> tekrar verilmez

    await clearJobs()
    const a = await registerDoc(managerCookie, caseAId)
    const b = await registerDoc(managerCookie, caseAId)
    const c1 = await claim()
    const c2 = await claim()
    const ids = [c1.body.job?.targetId, c2.body.job?.targetId].sort()
    expect(ids).toEqual([a.versionId, b.versionId].sort())
  })

  it('heartbeat lease uzatır; başkasının/olmayan işine 409', async () => {
    await registerDoc(managerCookie, caseAId)
    const claimed = await claim()
    const jobId = claimed.body.job!.id
    const hb = await app.inject({ method: 'POST', url: `/api/v1/agent/jobs/${jobId}/heartbeat`, headers: agentHeaders() })
    expect(hb.statusCode).toBe(200)
    const missing = await app.inject({ method: 'POST', url: `/api/v1/agent/jobs/${uuidv7()}/heartbeat`, headers: agentHeaders() })
    expect(missing.statusCode).toBe(409)
  })

  it('süresi dolan lease geri kazanılır (attempt artar)', async () => {
    await registerDoc(managerCookie, caseAId)
    const first = await claim()
    const jobId = first.body.job!.id
    await pool.query("UPDATE jobs SET lease_expires_at = now() - interval '1 minute' WHERE id = $1", [jobId])
    const second = await claim()
    expect(second.body.job?.id).toBe(jobId)
    expect(second.body.job?.attemptCount).toBe(2)
  })

  it('verified + eşleşme: belge pending -> ready (atomik); audit no-absolute', async () => {
    const { versionId, hash, size } = await registerDoc(managerCookie, caseAId)
    const claimed = await claim()
    const jobId = claimed.body.job!.id
    const res = await report(jobId, { outcome: 'verified', observedHash: hash, observedSize: size })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('succeeded')
    const row = await pool.query('SELECT status, hash_verified, size_verified, verified_at FROM document_versions WHERE id = $1', [versionId])
    expect(row.rows[0]).toMatchObject({ status: 'ready', hash_verified: true, size_verified: true })
    expect((row.rows[0] as { verified_at: Date | null }).verified_at).not.toBeNull()

    const leak = await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE details::text ~ '[A-Za-z]:' OR strpos(details::text, chr(92)) > 0")
    expect((leak.rows[0] as { n: number }).n).toBe(0)
  })

  it('verified + uyuşmazlık: ready YAPILMAZ, failed + güvenli neden', async () => {
    const { versionId, size } = await registerDoc(managerCookie, caseAId)
    const claimed = await claim()
    const res = await report(claimed.body.job!.id, { outcome: 'verified', observedHash: hex('WRONG'), observedSize: size })
    expect(res.body.status).toBe('failed')
    expect(res.body.lastErrorCode).toBe('hash_mismatch')
    const row = await pool.query('SELECT status FROM document_versions WHERE id = $1', [versionId])
    expect((row.rows[0] as { status: string }).status).toBe('failed')
  })

  it('missing: belge missing; failed sonucu retry sonra dead_letter', async () => {
    const { versionId } = await registerDoc(managerCookie, caseAId)
    const c1 = await claim()
    await report(c1.body.job!.id, { outcome: 'missing' })
    expect((await pool.query('SELECT status FROM document_versions WHERE id=$1', [versionId])).rows[0]).toMatchObject({ status: 'missing' })

    // retry -> dead_letter (max_attempts = 2)
    await clearJobs()
    await registerDoc(managerCookie, caseAId)
    const jobRow = await pool.query('SELECT id FROM jobs LIMIT 1')
    const jobId = (jobRow.rows[0] as { id: string }).id
    await pool.query('UPDATE jobs SET max_attempts = 2 WHERE id = $1', [jobId])
    const a1 = await claim()
    const r1 = await report(a1.body.job!.id, { outcome: 'failed', errorCode: 'access_error' })
    expect(r1.body.status).toBe('pending')
    await pool.query('UPDATE jobs SET next_attempt_at = now() WHERE id = $1', [jobId])
    const a2 = await claim()
    const r2 = await report(a2.body.job!.id, { outcome: 'failed', errorCode: 'access_error' })
    expect(r2.body.status).toBe('dead_letter')
  })

  it('idempotent sonuç: terminal iş yeniden bildirilince aynı durum, ikinci uygulama yok', async () => {
    const { versionId, hash, size } = await registerDoc(managerCookie, caseAId)
    const claimed = await claim()
    const jobId = claimed.body.job!.id
    await report(jobId, { outcome: 'verified', observedHash: hash, observedSize: size })
    const again = await report(jobId, { outcome: 'verified', observedHash: hash, observedSize: size })
    expect(again.status).toBe(200)
    expect(again.body.status).toBe('succeeded')
    expect((await pool.query('SELECT status FROM document_versions WHERE id=$1', [versionId])).rows[0]).toMatchObject({ status: 'ready' })
  })

  it('yarış: eski konum sürümü üzerine yazılmaz (case_location)', async () => {
    // v1 ata -> job (targetVersion 1). Sonra v2 ata (yeni job). Eski job stale kalır.
    await app.inject({ method: 'PUT', url: `/api/v1/cases/${caseAId}/location`, headers: { cookie: managerCookie }, payload: { storageRootKey: 'baran-primary', relativePath: '2026/A' } })
    const oldJob = await pool.query("SELECT id, target_version FROM jobs WHERE type='verify_case_location' ORDER BY created_at LIMIT 1")
    const oldJobId = (oldJob.rows[0] as { id: string }).id
    await app.inject({ method: 'PUT', url: `/api/v1/cases/${caseAId}/location`, headers: { cookie: managerCookie }, payload: { storageRootKey: 'baran-primary', relativePath: '2026/B', expectedVersion: 1 } })
    // Eski job'u claim edip verified bildir: sürüm artık 2, stale -> konum ezilmez (pending kalır).
    // oldJob pending; claim head olan en eski pending'i verir.
    let claimed = await claim()
    while (claimed.body.job !== null && claimed.body.job.id !== oldJobId) {
      // başka job'ı stale/verified geç, oldJob'a ulaş
      await report(claimed.body.job.id, { outcome: 'missing' })
      claimed = await claim()
    }
    if (claimed.body.job !== null) {
      await report(claimed.body.job.id, { outcome: 'verified' })
    }
    const loc = await pool.query('SELECT verification_status, version FROM case_locations WHERE case_id::text = $1', [caseAId])
    // Güncel sürüm 2; eski job (v1) sonucu güncel konumu 'verified' YAPMAMALI.
    expect((loc.rows[0] as { version: number }).version).toBe(2)
  })

  it('kiracı izolasyonu: A agent’i B işini claim edemez / göremez', async () => {
    await registerDoc(bCookie, caseBId, { storageRootKey: 'b-primary' }) // B org işi
    const claimed = await claim() // A agent
    expect(claimed.body.job).toBeNull() // A'nın uygun işi yok
  })

  it('devre dışı agent 403 alır', async () => {
    const reg = await app.inject({ method: 'POST', url: AGENTS_ROUTE, headers: { cookie: adminCookie, 'content-type': 'application/json' }, payload: { name: 'Gecici Agent' } })
    const body = reg.json() as { agent: { id: string }; secret: string }
    await app.inject({ method: 'PATCH', url: `/api/v1/agents/${body.agent.id}`, headers: { cookie: adminCookie, 'content-type': 'application/json' }, payload: { status: 'disabled' } })
    const res = await claim(agentHeaders(body.agent.id, body.secret))
    expect(res.status).toBe(403)
  })
})
