import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AGENTS_ROUTE,
  AUTH_LOGIN_ROUTE,
  CASES_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  workspaceProvisioningResponseSchema,
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

// HB-2026-175: bkz. case-lifecycle.test.ts'deki aynı sabitin açıklaması.
const ALWAYS_READY_FRESHNESS_GATE_PATH = fileURLToPath(new URL('./fixtures/always-ready-freshness-gate.mjs', import.meta.url))

const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'cok-guclu-parola-42'

describeDb('case workspace provisioning (gerçek PostgreSQL + sentetik geçici filesystem)', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let orgA: string
  let orgB: string
  let cookieA: string
  let cookieB: string
  let root: string
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

  async function seedUser(orgId: string, email: string): Promise<void> {
    const id = uuidv7()
    await pool.query(
      'INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4,$5)',
      [id, orgId, email, email, await hashPassword(PASSWORD)],
    )
    await pool.query("INSERT INTO user_roles (user_id,role_id) VALUES ($1,(SELECT id FROM roles WHERE code='admin'))", [id])
  }

  async function login(email: string): Promise<string> {
    const response = await app.inject({ method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email, password: PASSWORD } })
    return String(response.headers['set-cookie']).split(';')[0] as string
  }

  async function createCase(cookie: string, plate: string, notificationDate = '2026-07-14'): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: CASES_ROUTE,
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { caseType: 'traffic', plate, lossDate: '2026-07-13', notificationDate },
    })
    expect(response.statusCode).toBe(201)
    return (response.json() as { case: { id: string } }).case.id
  }

  async function plan(caseId: string, key = uuidv7(), cookie = cookieA) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/workspace-plans`,
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: key },
      payload: { storageRootKey: 'test-primary' },
    })
  }

  async function approve(caseId: string, planId: string, key = uuidv7(), cookie = cookieA) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/workspace-plans/${planId}/approve`,
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: key },
      payload: { approved: true },
    })
  }

  async function readPlan(caseId: string, planId: string, cookie = cookieA) {
    return app.inject({ method: 'GET', url: `/api/v1/cases/${caseId}/workspace-plans/${planId}`, headers: { cookie } })
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    orgA = uuidv7()
    orgB = uuidv7()
    await pool.query('INSERT INTO organizations (id,code,name) VALUES ($1,$2,$3),($4,$5,$6)', [
      orgA, 'workspace-a', 'Workspace A', orgB, 'workspace-b', 'Workspace B',
    ])
    await seedUser(orgA, 'workspace-a@test.local')
    await seedUser(orgB, 'workspace-b@test.local')
    await pool.query(
      "INSERT INTO storage_roots (id,organization_id,root_key,label) VALUES ($1,$2,'test-primary','Sentetik Test')",
      [uuidv7(), orgA],
    )
    await pool.query(
      "INSERT INTO storage_roots (id,organization_id,root_key,label) VALUES ($1,$2,'test-primary','Yabancı Test')",
      [uuidv7(), orgB],
    )
    app = buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false, loginRateLimit: { limit: 1000, windowMs: 60_000 } } })
    cookieA = await login('workspace-a@test.local')
    cookieB = await login('workspace-b@test.local')
    const registration = await app.inject({ method: 'POST', url: AGENTS_ROUTE, headers: { cookie: cookieA }, payload: { name: 'Workspace Agent' } })
    const registered = registration.json() as { agent: { id: string }; secret: string }
    root = await mkdtemp(join(tmpdir(), 'hb-p19-root-'))
    agentConfig = {
      apiBaseUrl: '',
      agentId: registered.agent.id,
      agentSecret: registered.secret,
      roots: { 'test-primary': root },
      leaseSeconds: 120,
      pollIntervalMs: 1000,
      freshnessGate: {
        toolPath: ALWAYS_READY_FRESHNESS_GATE_PATH,
        pcloudLocalDatabasePath: 'unused-in-always-ready-stub.db',
        topLevelFolderName: 'unused',
        attestationStoreDirectory: 'unused-store',
      },
    }
    agentClient = createAgentApiClient({ baseUrl: '', agentId: registered.agent.id, secret: registered.secret, fetchImpl: injectFetch })
  }, 60_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
    if (root !== undefined) await rm(root, { recursive: true, force: true })
  })

  it('plan yalnız preview üretir; filesystem ve job değişmez, replay aynı planı döner', async () => {
    const caseId = await createCase(cookieA, '34 ABC 123')
    const key = uuidv7()
    const first = await plan(caseId, key)
    expect(first.statusCode).toBe(201)
    const firstBody = workspaceProvisioningResponseSchema.parse(first.json())
    expect(firstBody.provisioning).toMatchObject({
      caseId,
      relativePath: '2026/Temmuz 2026/34ABC123',
      status: 'planned',
      canApprove: true,
    })
    await expect(access(join(root, '2026'))).rejects.toMatchObject({ code: 'ENOENT' })
    const jobs = await pool.query("SELECT count(*)::int AS n FROM jobs WHERE type='provision_case_workspace'")
    expect((jobs.rows[0] as { n: number }).n).toBe(0)
    const replay = await plan(caseId, key)
    expect(replay.statusCode).toBe(201)
    expect(replay.json()).toEqual(first.json())

    const unauthorized = await app.inject({ method: 'GET', url: `/api/v1/cases/${caseId}/workspace-plans/${firstBody.provisioning.id}` })
    expect(unauthorized.statusCode).toBe(401)
    const foreign = await readPlan(caseId, firstBody.provisioning.id, cookieB)
    expect(foreign.statusCode).toBe(404)
  })

  it('eşzamanlı iki onay tek aktif işe dönüşür; Agent beş klasörü doğrulayıp location ve audit atomik üretir', async () => {
    const caseId = await createCase(cookieA, '34 XYZ 019')
    const planned = workspaceProvisioningResponseSchema.parse((await plan(caseId)).json()).provisioning
    const [a, b] = await Promise.all([approve(caseId, planned.id), approve(caseId, planned.id)])
    expect([a.statusCode, b.statusCode]).toEqual([202, 202])
    const jobCount = await pool.query(
      "SELECT count(*)::int AS n FROM jobs WHERE target_type='workspace_provisioning' AND target_id=$1",
      [planned.id],
    )
    expect((jobCount.rows[0] as { n: number }).n).toBe(1)

    const applied = await runOnce(agentClient, agentConfig)
    expect(applied.kind).toBe('reported')
    if (applied.kind === 'reported') expect(applied.reported.status).toBe('succeeded')
    const status = workspaceProvisioningResponseSchema.parse((await readPlan(caseId, planned.id)).json()).provisioning
    expect(status.status).toBe('ready')
    const current = await app.inject({ method: 'GET', url: `/api/v1/cases/${caseId}/workspace-plans`, headers: { cookie: cookieA } })
    expect(workspaceProvisioningResponseSchema.parse(current.json()).provisioning).toEqual(status)
    for (const name of status.requiredSubdirectories) {
      await expect(access(join(root, ...status.relativePath.split('/'), name))).resolves.toBeUndefined()
    }
    const location = await pool.query(
      'SELECT storage_root_key,relative_path,verification_status,source,version FROM case_locations WHERE case_id=$1',
      [caseId],
    )
    expect(location.rows[0]).toMatchObject({
      storage_root_key: 'test-primary',
      relative_path: status.relativePath,
      verification_status: 'verified',
      source: 'system',
      version: 1,
    })
    const history = await pool.query('SELECT count(*)::int AS n FROM case_location_history WHERE case_id=$1', [caseId])
    expect((history.rows[0] as { n: number }).n).toBe(1)
    const actions = await pool.query(
      "SELECT action FROM audit_events WHERE resource_id=$1 ORDER BY occurred_at",
      [planned.id],
    )
    expect((actions.rows as { action: string }[]).map((row) => row.action)).toEqual(expect.arrayContaining([
      'case.workspace_planned', 'case.workspace_approved', 'case.workspace_queued', 'case.workspace_applying',
      'case.workspace_verifying', 'case.workspace_ready',
    ]))
  })

  it('aynı plaka/ay için -2 ve -3 rezervasyonları deterministik ayrılır', async () => {
    const caseTwo = await createCase(cookieA, '34 XYZ 019')
    const caseThree = await createCase(cookieA, '34 XYZ 019')
    const second = workspaceProvisioningResponseSchema.parse((await plan(caseTwo)).json()).provisioning
    const third = workspaceProvisioningResponseSchema.parse((await plan(caseThree)).json()).provisioning
    expect(second.relativePath).toBe('2026/Temmuz 2026/34XYZ019 - 2')
    expect(third.relativePath).toBe('2026/Temmuz 2026/34XYZ019 - 3')
  })

  it('location plan sonrası değişirse Agent sonucu stale olur ve yeni location yazmaz', async () => {
    const caseId = await createCase(cookieA, '06 STL 019')
    const provisioning = workspaceProvisioningResponseSchema.parse((await plan(caseId)).json()).provisioning
    await approve(caseId, provisioning.id)
    await pool.query(
      `INSERT INTO case_locations
       (id,organization_id,case_id,storage_root_key,relative_path,verification_status,source)
       VALUES ($1,$2,$3,'test-primary','manual/location','verified','manual')`,
      [uuidv7(), orgA, caseId],
    )
    const applied = await runOnce(agentClient, agentConfig)
    expect(applied.kind).toBe('reported')
    const after = workspaceProvisioningResponseSchema.parse((await readPlan(caseId, provisioning.id)).json()).provisioning
    expect(after.status).toBe('stale')
    const location = await pool.query('SELECT relative_path FROM case_locations WHERE case_id=$1', [caseId])
    expect((location.rows[0] as { relative_path: string }).relative_path).toBe('manual/location')
  })

  it('eksik notificationDate güvenli validation, bilinmeyen vaka 404 ve mutlak yol/secret sızıntısı yoktur', async () => {
    const caseId = await createCase(cookieA, '35 DAT 019', '2026-07-14')
    await pool.query('UPDATE cases SET notification_date=NULL WHERE id=$1', [caseId])
    const noDate = await plan(caseId)
    expect(noDate.statusCode).toBe(400)
    expect(JSON.stringify(noDate.json())).toContain('required_for_workspace')
    const missing = await plan(uuidv7())
    expect(missing.statusCode).toBe(404)

    const leak = await pool.query(
      `SELECT count(*)::int AS n FROM audit_events
       WHERE details::text ~ '[A-Za-z]:[/\\\\]' OR strpos(details::text, chr(92)) > 0
          OR details::text ILIKE '%x-agent-secret%' OR details::text ILIKE '%cok-guclu-parola%'`,
    )
    expect((leak.rows[0] as { n: number }).n).toBe(0)
  })
})
