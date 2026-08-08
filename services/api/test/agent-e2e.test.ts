import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { AGENTS_ROUTE, AUTH_LOGIN_ROUTE, CASES_ROUTE, IDEMPOTENCY_KEY_HEADER } from '@hasarbotu/contracts'
import {
  assertTestDatabaseUrl,
  closeDatabasePool,
  createDatabasePool,
  runMigrations,
  uuidv7,
  type DatabaseConfig,
} from '@hasarbotu/database'
import { buildApp, hashPassword } from '../src/index.js'
import { createAgentApiClient, runOnce, type AgentConfig } from '@hasarbotu/file-agent'

/**
 * Gerçek uçtan uca (Paket 14): GERÇEK File Agent (verifier + api-client) GERÇEK
 * API'ye karşı, GERÇEK geçici dosyayla. Yalnız sentetik geçici dosyalar; içerik
 * loglanmaz. Agent yalnız API üzerinden çalışır (app.inject'e yönlendirilen fetch).
 */
const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'cok-guclu-parola-42'
const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex')

describeDb('File Agent uçtan uca doğrulama (gerçek DB + geçici dosya)', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let cookie: string
  let caseId: string
  let root: string
  let agentConfig: AgentConfig
  let client: ReturnType<typeof createAgentApiClient>

  /** createAgentApiClient'ın fetch'ini app.inject'e yönlendirir (gerçek API). */
  const injectFetch = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const path = String(url)
    const res = await app.inject({
      method: (init?.method ?? 'GET') as 'GET' | 'POST',
      url: path,
      headers: (init?.headers ?? {}) as Record<string, string>,
      ...(init?.body !== undefined && init.body !== null ? { payload: String(init.body) } : {}),
    })
    return {
      ok: res.statusCode >= 200 && res.statusCode < 300,
      status: res.statusCode,
      json: async () => res.json(),
      headers: { get: () => null },
    } as unknown as Response
  }) as unknown as typeof fetch

  async function registerDoc(relativePath: string, declaredHash: string, declaredSize: number): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/documents`,
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { documentType: 'ruhsat', sourceType: 'upload', originalFileName: 'r.pdf', mimeType: 'application/pdf', byteSize: declaredSize, contentHash: declaredHash, storageRootKey: 'baran-primary', relativePath },
    })
    return (res.json() as { version: { id: string } }).version.id
  }
  async function docStatus(versionId: string): Promise<string> {
    const row = await pool.query('SELECT status FROM document_versions WHERE id = $1', [versionId])
    return (row.rows[0] as { status: string }).status
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    const orgId = uuidv7()
    const userId = uuidv7()
    await pool.query('INSERT INTO organizations (id, code, name) VALUES ($1,$2,$3)', [orgId, 'org', 'Org'])
    await pool.query('INSERT INTO users (id, organization_id, email, display_name, password_hash) VALUES ($1,$2,$3,$4,$5)', [userId, orgId, 'u@a.example', 'U', await hashPassword(PASSWORD)])
    await pool.query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, (SELECT id FROM roles WHERE code='admin'))", [userId])
    await pool.query('INSERT INTO storage_roots (id, organization_id, root_key, label, is_active) VALUES ($1,$2,$3,$4,true)', [uuidv7(), orgId, 'baran-primary', 'Primary'])

    app = buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false, loginRateLimit: { limit: 1000, windowMs: 60_000 } } })
    const loginRes = await app.inject({ method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email: 'u@a.example', password: PASSWORD } })
    cookie = String(loginRes.headers['set-cookie']).split(';')[0]
    const caseRes = await app.inject({ method: 'POST', url: CASES_ROUTE, headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() }, payload: { caseType: 'traffic', plate: '34 ABC 123' } })
    caseId = (caseRes.json() as { case: { id: string } }).case.id
    const reg = await app.inject({ method: 'POST', url: AGENTS_ROUTE, headers: { cookie, 'content-type': 'application/json' }, payload: { name: 'E2E Agent' } })
    const regBody = reg.json() as { agent: { id: string }; secret: string }

    root = await mkdtemp(join(tmpdir(), 'hb-e2e-root-'))
    agentConfig = { apiBaseUrl: '', agentId: regBody.agent.id, agentSecret: regBody.secret, roots: { 'baran-primary': root }, leaseSeconds: 120, pollIntervalMs: 1000, freshnessGate: undefined }
    client = createAgentApiClient({ baseUrl: '', agentId: regBody.agent.id, secret: regBody.secret, fetchImpl: injectFetch })
  }, 60_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
    if (root !== undefined) await rm(root, { recursive: true, force: true })
  })

  it('gerçek dosya eşleşince pending -> ready (agent gerçek hash hesaplar)', async () => {
    const content = Buffer.from('sentetik ruhsat içeriği '.repeat(1000))
    await mkdir(join(root, 'EVRAK'), { recursive: true })
    await writeFile(join(root, 'EVRAK', 'ok.pdf'), content)
    const versionId = await registerDoc('EVRAK/ok.pdf', sha256(content), content.length)

    const result = await runOnce(client, agentConfig)
    expect(result.kind).toBe('reported')
    if (result.kind === 'reported') {
      expect(result.outcome).toBe('verified')
      expect(result.reported.status).toBe('succeeded')
    }
    expect(await docStatus(versionId)).toBe('ready')
  })

  it('beyan edilen hash gerçek dosyaya uymazsa ready OLMAZ (failed)', async () => {
    const content = Buffer.from('gerçek içerik')
    await writeFile(join(root, 'EVRAK', 'bad.pdf'), content)
    // Beyan edilen hash YANLIŞ (istemci beyanına güvenilmez; agent gerçeği hesaplar).
    const versionId = await registerDoc('EVRAK/bad.pdf', sha256(Buffer.from('BAŞKA içerik')), content.length)

    const result = await runOnce(client, agentConfig)
    expect(result.kind).toBe('reported')
    if (result.kind === 'reported') expect(result.reported.status).toBe('failed')
    expect(await docStatus(versionId)).toBe('failed')
  })

  it('dosya diskte yoksa missing', async () => {
    const versionId = await registerDoc('EVRAK/hayalet.pdf', sha256(Buffer.from('x')), 1)
    const result = await runOnce(client, agentConfig)
    expect(result.kind).toBe('reported')
    expect(await docStatus(versionId)).toBe('missing')
  })
})
