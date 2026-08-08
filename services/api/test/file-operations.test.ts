import { access, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
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
  fileOperationResponseSchema,
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
  createAgentApiClient,
  executeFileOperation,
  runOnce,
  type AgentConfig,
} from '@hasarbotu/file-agent'
import { buildApp, hashPassword } from '../src/index.js'

// HB-2026-175: bkz. case-lifecycle.test.ts'deki aynı sabitin açıklaması.
const ALWAYS_READY_FRESHNESS_GATE_PATH = fileURLToPath(new URL('./fixtures/always-ready-freshness-gate.mjs', import.meta.url))

const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'p20-sentetik-guclu-parola-42'

describeDb('case file operations (gerçek PostgreSQL + sentetik geçici filesystem)', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let orgA: string
  let orgB: string
  let cookieA: string
  let cookieB: string
  let sourceRoot: string
  let archiveRoot: string
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
    expect(response.statusCode).toBe(200)
    return String(response.headers['set-cookie']).split(';')[0] as string
  }

  async function seedLocatedCase(
    plate: string,
    sourceRelativePath: string,
    options: { readonly cookie?: string; readonly organizationId?: string; readonly rootKey?: string } = {},
  ): Promise<{ caseId: string; locationId: string }> {
    const cookie = options.cookie ?? cookieA
    const organizationId = options.organizationId ?? orgA
    const response = await app.inject({
      method: 'POST',
      url: CASES_ROUTE,
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { caseType: 'traffic', plate, lossDate: '2026-07-13', notificationDate: '2026-07-14' },
    })
    expect(response.statusCode).toBe(201)
    const caseId = (response.json() as { case: { id: string } }).case.id
    const locationId = uuidv7()
    await pool.query(
      `INSERT INTO case_locations
       (id,organization_id,case_id,storage_root_key,relative_path,verification_status,source)
       VALUES ($1,$2,$3,$4,$5,'verified','system')`,
      [locationId, organizationId, caseId, options.rootKey ?? 'source-root', sourceRelativePath],
    )
    return { caseId, locationId }
  }

  async function createWorkspace(root: string, relativePath: string, content = 'sentetik-p20'): Promise<void> {
    const absolute = join(root, ...relativePath.split('/'))
    await mkdir(join(absolute, 'EVRAK'), { recursive: true })
    await mkdir(join(absolute, 'HASAR'))
    await writeFile(join(absolute, 'EVRAK', 'belge.txt'), content, 'utf8')
    await writeFile(join(absolute, 'HASAR', 'foto.bin'), Buffer.from([1, 2, 3, 4]))
  }

  async function plan(
    caseId: string,
    input: {
      operationType: 'rename_case_workspace' | 'move_case_workspace'
      destinationStorageRootKey: string
      destinationRelativePath: string
      expectedLocationVersion?: number
    },
    key = uuidv7(),
    cookie = cookieA,
  ) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/file-operations/plan`,
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: key },
      payload: { ...input, expectedLocationVersion: input.expectedLocationVersion ?? 1 },
    })
  }

  async function approve(caseId: string, operationId: string, key = uuidv7(), cookie = cookieA) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/file-operations/${operationId}/approve`,
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: key },
      payload: { approved: true },
    })
  }

  async function cancel(caseId: string, operationId: string, key = uuidv7()) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/file-operations/${operationId}/cancel`,
      headers: { cookie: cookieA, [IDEMPOTENCY_KEY_HEADER]: key },
      payload: { cancelled: true },
    })
  }

  async function readOperation(caseId: string, operationId: string, cookie = cookieA) {
    return app.inject({
      method: 'GET',
      url: `/api/v1/cases/${caseId}/file-operations/${operationId}`,
      headers: { cookie },
    })
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    orgA = uuidv7()
    orgB = uuidv7()
    await pool.query('INSERT INTO organizations (id,code,name) VALUES ($1,$2,$3),($4,$5,$6)', [
      orgA, 'file-operation-a', 'File Operation A', orgB, 'file-operation-b', 'File Operation B',
    ])
    await seedUser(orgA, 'file-operation-a@test.local')
    await seedUser(orgB, 'file-operation-b@test.local')
    await pool.query(
      `INSERT INTO storage_roots (id,organization_id,root_key,label) VALUES
       ($1,$3,'source-root','Sentetik Kaynak'),($2,$3,'archive-root','Sentetik Arşiv'),
       ($4,$3,'temporary-root','Geçici Hedef')`,
      [uuidv7(), uuidv7(), orgA, uuidv7()],
    )
    await pool.query(
      "INSERT INTO storage_roots (id,organization_id,root_key,label) VALUES ($1,$2,'source-root','Yabancı Kök')",
      [uuidv7(), orgB],
    )
    app = buildApp({
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 1000, windowMs: 60_000 } },
    })
    cookieA = await login('file-operation-a@test.local')
    cookieB = await login('file-operation-b@test.local')
    const registration = await app.inject({
      method: 'POST',
      url: AGENTS_ROUTE,
      headers: { cookie: cookieA },
      payload: { name: 'Paket 20 Sentetik Agent' },
    })
    expect(registration.statusCode).toBe(201)
    const registered = registration.json() as { agent: { id: string }; secret: string }
    sourceRoot = await mkdtemp(join(tmpdir(), 'hb-p20-source-'))
    archiveRoot = await mkdtemp(join(tmpdir(), 'hb-p20-archive-'))
    agentConfig = {
      apiBaseUrl: '',
      agentId: registered.agent.id,
      agentSecret: registered.secret,
      roots: { 'source-root': sourceRoot, 'archive-root': archiveRoot },
      leaseSeconds: 120,
      pollIntervalMs: 1000,
      freshnessGate: {
        toolPath: ALWAYS_READY_FRESHNESS_GATE_PATH,
        pcloudLocalDatabasePath: 'unused-in-always-ready-stub.db',
        topLevelFolderName: 'unused',
        attestationStoreDirectory: 'unused-store',
      },
    }
    agentClient = createAgentApiClient({
      baseUrl: '',
      agentId: registered.agent.id,
      secret: registered.secret,
      fetchImpl: injectFetch,
    })
  }, 60_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
    if (sourceRoot !== undefined) await rm(sourceRoot, { recursive: true, force: true })
    if (archiveRoot !== undefined) await rm(archiveRoot, { recursive: true, force: true })
  })

  it('plan yalnız preview üretir; filesystem/job değişmez, idempotent replay ve tenant sınırı korunur', async () => {
    const source = 'workspaces/PLAN-20'
    const destination = 'workspaces/PLAN-20-YENI'
    await createWorkspace(sourceRoot, source)
    const { caseId } = await seedLocatedCase('34 PLN 020', source)
    const key = uuidv7()
    const first = await plan(caseId, {
      operationType: 'rename_case_workspace',
      destinationStorageRootKey: 'source-root',
      destinationRelativePath: destination,
    }, key)
    expect(first.statusCode).toBe(201)
    const operation = fileOperationResponseSchema.parse(first.json()).operation
    expect(operation).toMatchObject({ caseId, status: 'planned', strategy: 'atomic_rename', source: { relativePath: source } })
    await expect(access(join(sourceRoot, ...destination.split('/')))).rejects.toMatchObject({ code: 'ENOENT' })
    const jobCount = await pool.query("SELECT count(*)::int AS n FROM jobs WHERE target_type='file_operation'")
    expect((jobCount.rows[0] as { n: number }).n).toBe(0)
    const replay = await plan(caseId, {
      operationType: 'rename_case_workspace',
      destinationStorageRootKey: 'source-root',
      destinationRelativePath: destination,
    }, key)
    expect(replay.statusCode).toBe(201)
    expect(replay.json()).toEqual(first.json())
    expect((await readOperation(caseId, operation.id, '')).statusCode).toBe(401)
    expect((await readOperation(caseId, operation.id, cookieB)).statusCode).toBe(404)

    const unsafe = await plan(caseId, {
      operationType: 'move_case_workspace',
      destinationStorageRootKey: 'source-root',
      destinationRelativePath: '../disari',
    })
    expect(unsafe.statusCode).toBe(400)
  })

  it('aynı vaka için ikinci aktif operasyon ve aynı hedef için ikinci rezervasyon reddedilir', async () => {
    const sourceOne = 'workspaces/RESERVE-ONE'
    const sourceTwo = 'workspaces/RESERVE-TWO'
    const destination = 'workspaces/RESERVED-TARGET'
    await createWorkspace(sourceRoot, sourceOne)
    await createWorkspace(sourceRoot, sourceTwo)
    const first = await seedLocatedCase('34 RSV 201', sourceOne)
    const second = await seedLocatedCase('34 RSV 202', sourceTwo)
    expect((await plan(first.caseId, {
      operationType: 'rename_case_workspace', destinationStorageRootKey: 'source-root', destinationRelativePath: destination,
    })).statusCode).toBe(201)
    expect((await plan(first.caseId, {
      operationType: 'rename_case_workspace', destinationStorageRootKey: 'source-root', destinationRelativePath: 'workspaces/BASKA',
    })).statusCode).toBe(409)
    expect((await plan(second.caseId, {
      operationType: 'rename_case_workspace', destinationStorageRootKey: 'source-root', destinationRelativePath: destination,
    })).statusCode).toBe(409)
  })

  it('eşzamanlı approve tek job üretir; same-volume atomik rename doğrulanır, location ve audit atomik sonuçlanır', async () => {
    const source = 'workspaces/ATOMIC-OLD'
    const destination = 'workspaces/ATOMIC-NEW'
    await createWorkspace(sourceRoot, source, 'atomik-icerik')
    const { caseId } = await seedLocatedCase('34 ATM 020', source)
    const planned = fileOperationResponseSchema.parse((await plan(caseId, {
      operationType: 'rename_case_workspace', destinationStorageRootKey: 'source-root', destinationRelativePath: destination,
    })).json()).operation
    const approveKey = uuidv7()
    const [first, replay] = await Promise.all([
      approve(caseId, planned.id, approveKey),
      approve(caseId, planned.id, approveKey),
    ])
    expect([first.statusCode, replay.statusCode]).toEqual([202, 202])
    expect(replay.json()).toEqual(first.json())
    const jobs = await pool.query("SELECT count(*)::int AS n FROM jobs WHERE target_type='file_operation' AND target_id=$1", [planned.id])
    expect((jobs.rows[0] as { n: number }).n).toBe(1)

    const applied = await runOnce(agentClient, agentConfig)
    expect(applied.kind).toBe('reported')
    if (applied.kind === 'reported') expect(applied.reported.status).toBe('succeeded')
    const ready = fileOperationResponseSchema.parse((await readOperation(caseId, planned.id)).json()).operation
    expect(ready).toMatchObject({ status: 'ready', strategy: 'atomic_rename', cleanupState: 'not_required' })
    await expect(access(join(sourceRoot, ...source.split('/')))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(sourceRoot, ...destination.split('/'), 'EVRAK', 'belge.txt'), 'utf8')).toBe('atomik-icerik')
    const location = await pool.query('SELECT storage_root_key,relative_path,verification_status,version FROM case_locations WHERE case_id=$1', [caseId])
    expect(location.rows[0]).toMatchObject({ storage_root_key: 'source-root', relative_path: destination, verification_status: 'verified', version: 2 })
    const history = await pool.query('SELECT previous_storage_root_key,previous_relative_path,relative_path FROM case_location_history WHERE case_id=$1', [caseId])
    expect(history.rows[0]).toMatchObject({ previous_storage_root_key: 'source-root', previous_relative_path: source, relative_path: destination })
    const actions = await pool.query("SELECT action FROM audit_events WHERE resource_id=$1 ORDER BY occurred_at", [planned.id])
    expect((actions.rows as { action: string }[]).map((row) => row.action)).toEqual(expect.arrayContaining([
      'file_operation.planned', 'file_operation.approved', 'file_operation.started',
      'file_operation.verified', 'file_operation.location_switched', 'file_operation.finalized',
    ]))
  })

  it('yalnız harf biçimi değişen Windows adı operation-temelli geçici ad üzerinden güvenle rename edilir', async () => {
    const source = 'workspaces/Case-Only-20'
    const destination = 'workspaces/case-only-20'
    await createWorkspace(sourceRoot, source, 'case-only')
    const { caseId } = await seedLocatedCase('34 CAS 020', source)
    const operation = fileOperationResponseSchema.parse((await plan(caseId, {
      operationType: 'rename_case_workspace', destinationStorageRootKey: 'source-root', destinationRelativePath: destination,
    })).json()).operation
    await approve(caseId, operation.id)
    const applied = await runOnce(agentClient, agentConfig)
    expect(applied.kind).toBe('reported')
    const ready = fileOperationResponseSchema.parse((await readOperation(caseId, operation.id)).json()).operation
    expect(ready.status).toBe('ready')
    expect(await readFile(join(sourceRoot, ...destination.split('/'), 'EVRAK', 'belge.txt'), 'utf8')).toBe('case-only')
    await expect(access(join(sourceRoot, 'workspaces', `.hasarbotu-rename-${operation.id}`))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('cross-root staged-copy manifesti doğrular; DB switch sonrası cleanup_pending ve retry edilebilir cleanup tamamlanır', async () => {
    const source = 'workspaces/CROSS-SOURCE'
    const destination = 'archive/CROSS-TARGET'
    await createWorkspace(sourceRoot, source, 'cross-volume')
    const { caseId } = await seedLocatedCase('34 CRS 020', source)
    const operation = fileOperationResponseSchema.parse((await plan(caseId, {
      operationType: 'move_case_workspace', destinationStorageRootKey: 'archive-root', destinationRelativePath: destination,
    })).json()).operation
    expect(operation.strategy).toBe('staged_copy')
    await approve(caseId, operation.id)

    const copied = await runOnce(agentClient, agentConfig)
    expect(copied.kind).toBe('reported')
    const pending = fileOperationResponseSchema.parse((await readOperation(caseId, operation.id)).json()).operation
    expect(pending).toMatchObject({ status: 'cleanup_pending', cleanupState: 'pending', strategy: 'staged_copy' })
    expect(pending.manifestHash).toMatch(/^[0-9a-f]{64}$/)
    await expect(access(join(sourceRoot, ...source.split('/')))).resolves.toBeUndefined()
    expect(await readFile(join(archiveRoot, ...destination.split('/'), 'EVRAK', 'belge.txt'), 'utf8')).toBe('cross-volume')
    const switched = await pool.query('SELECT storage_root_key,relative_path,version FROM case_locations WHERE case_id=$1', [caseId])
    expect(switched.rows[0]).toMatchObject({ storage_root_key: 'archive-root', relative_path: destination, version: 2 })

    const cleaned = await runOnce(agentClient, agentConfig)
    expect(cleaned.kind).toBe('reported')
    const ready = fileOperationResponseSchema.parse((await readOperation(caseId, operation.id)).json()).operation
    expect(ready).toMatchObject({ status: 'ready', cleanupState: 'completed' })
    await expect(access(join(sourceRoot, ...source.split('/')))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(join(archiveRoot, ...destination.split('/')))).resolves.toBeUndefined()
  })

  it('atomik rename sonrası sonuç bildirimi kesilirse Agent retry mevcut hedefi doğrulayıp DB finalize eder', async () => {
    const source = 'workspaces/RECOVERY-SOURCE'
    const destination = 'workspaces/RECOVERY-TARGET'
    await createWorkspace(sourceRoot, source, 'recovery')
    const { caseId } = await seedLocatedCase('34 RCV 020', source)
    const operation = fileOperationResponseSchema.parse((await plan(caseId, {
      operationType: 'rename_case_workspace', destinationStorageRootKey: 'source-root', destinationRelativePath: destination,
    })).json()).operation
    await approve(caseId, operation.id)
    const claimed = await agentClient.claim()
    expect(claimed).not.toBeNull()
    if (claimed === null || (claimed.payload.kind !== 'file_operation' && claimed.payload.kind !== 'file_operation_cleanup')) return
    const physical = await executeFileOperation(agentConfig.roots, claimed.payload)
    expect(physical.outcome).toBe('verified')
    await expect(access(join(sourceRoot, ...source.split('/')))).rejects.toMatchObject({ code: 'ENOENT' })
    await pool.query("UPDATE jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1", [claimed.id])

    const recovered = await runOnce(agentClient, agentConfig)
    expect(recovered.kind).toBe('reported')
    const ready = fileOperationResponseSchema.parse((await readOperation(caseId, operation.id)).json()).operation
    expect(ready.status).toBe('ready')
    expect(await readFile(join(sourceRoot, ...destination.split('/'), 'EVRAK', 'belge.txt'), 'utf8')).toBe('recovery')
  })

  it('stale location/version engellenir; cancel yalnız uygulanmamış güvenli aşamada çalışır', async () => {
    const source = 'workspaces/STALE-SOURCE'
    await createWorkspace(sourceRoot, source)
    const staleCase = await seedLocatedCase('34 STL 020', source)
    const versionConflict = await plan(staleCase.caseId, {
      operationType: 'rename_case_workspace', destinationStorageRootKey: 'source-root', destinationRelativePath: 'workspaces/STALE-TARGET', expectedLocationVersion: 2,
    })
    expect(versionConflict.statusCode).toBe(409)
    const planned = fileOperationResponseSchema.parse((await plan(staleCase.caseId, {
      operationType: 'rename_case_workspace', destinationStorageRootKey: 'source-root', destinationRelativePath: 'workspaces/STALE-TARGET',
    })).json()).operation
    await pool.query("UPDATE case_locations SET relative_path='workspaces/MANUAL-CHANGE',version=version+1 WHERE case_id=$1", [staleCase.caseId])
    expect((await approve(staleCase.caseId, planned.id)).statusCode).toBe(409)
    expect((await readOperation(staleCase.caseId, planned.id)).json()).toMatchObject({ operation: { status: 'stale' } })

    const inactiveSource = 'workspaces/INACTIVE-ROOT-SOURCE'
    await createWorkspace(sourceRoot, inactiveSource)
    const inactiveCase = await seedLocatedCase('34 INA 020', inactiveSource)
    const inactivePlan = fileOperationResponseSchema.parse((await plan(inactiveCase.caseId, {
      operationType: 'move_case_workspace', destinationStorageRootKey: 'temporary-root', destinationRelativePath: 'temporary/INACTIVE-TARGET',
    })).json()).operation
    await pool.query("UPDATE storage_roots SET is_active=false WHERE organization_id=$1 AND root_key='temporary-root'", [orgA])
    expect((await approve(inactiveCase.caseId, inactivePlan.id)).statusCode).toBe(409)
    expect(fileOperationResponseSchema.parse((await readOperation(inactiveCase.caseId, inactivePlan.id)).json()).operation)
      .toMatchObject({ status: 'stale', failureReasonCode: 'destination_root_inactive' })

    const cancelSource = 'workspaces/CANCEL-SOURCE'
    await createWorkspace(sourceRoot, cancelSource)
    const cancellableCase = await seedLocatedCase('34 CNL 020', cancelSource)
    const cancellable = fileOperationResponseSchema.parse((await plan(cancellableCase.caseId, {
      operationType: 'rename_case_workspace', destinationStorageRootKey: 'source-root', destinationRelativePath: 'workspaces/CANCEL-TARGET',
    })).json()).operation
    await approve(cancellableCase.caseId, cancellable.id)
    const cancelled = await cancel(cancellableCase.caseId, cancellable.id)
    expect(cancelled.statusCode).toBe(200)
    expect(fileOperationResponseSchema.parse(cancelled.json()).operation.status).toBe('cancelled')
    await expect(access(join(sourceRoot, ...cancelSource.split('/')))).resolves.toBeUndefined()
  })

  it('location switch sonrası kaynak değişirse cleanup silmez ve manual_recovery_required audit üretir', async () => {
    const source = 'workspaces/MANUAL-SOURCE'
    const destination = 'archive/MANUAL-TARGET'
    await createWorkspace(sourceRoot, source, 'manual-recovery')
    const { caseId } = await seedLocatedCase('34 MNL 020', source)
    const operation = fileOperationResponseSchema.parse((await plan(caseId, {
      operationType: 'move_case_workspace', destinationStorageRootKey: 'archive-root', destinationRelativePath: destination,
    })).json()).operation
    await approve(caseId, operation.id)
    expect((await runOnce(agentClient, agentConfig)).kind).toBe('reported')
    expect(fileOperationResponseSchema.parse((await readOperation(caseId, operation.id)).json()).operation.status).toBe('cleanup_pending')

    const added = join(sourceRoot, ...source.split('/'), 'sonradan.txt')
    await writeFile(added, 'cleanup-oncesi-degisim', 'utf8')
    const cleanup = await runOnce(agentClient, agentConfig)
    expect(cleanup.kind).toBe('reported')
    if (cleanup.kind === 'reported') expect(cleanup.reported.status).toBe('dead_letter')
    const manual = fileOperationResponseSchema.parse((await readOperation(caseId, operation.id)).json()).operation
    expect(manual).toMatchObject({ status: 'manual_recovery_required', cleanupState: 'blocked', failureReasonCode: 'source_changed_before_cleanup' })
    await expect(access(added)).resolves.toBeUndefined()
    await expect(access(join(archiveRoot, ...destination.split('/')))).resolves.toBeUndefined()
    const location = await pool.query('SELECT storage_root_key,relative_path FROM case_locations WHERE case_id=$1', [caseId])
    expect(location.rows[0]).toMatchObject({ storage_root_key: 'archive-root', relative_path: destination })
    const audit = await pool.query(
      "SELECT count(*)::int AS n FROM audit_events WHERE resource_id=$1 AND action='file_operation.manual_recovery_required'",
      [operation.id],
    )
    expect((audit.rows[0] as { n: number }).n).toBe(1)
  })

  it('kaynak plan sonrası değişirse switch/cleanup yapılmaz; response, audit ve logik kayıtlarda mutlak yol/secret sızmaz', async () => {
    const source = 'workspaces/CHANGED-SOURCE'
    const destination = 'archive/CHANGED-TARGET'
    await createWorkspace(sourceRoot, source, 'ilk')
    const { caseId } = await seedLocatedCase('34 CHG 020', source)
    const operation = fileOperationResponseSchema.parse((await plan(caseId, {
      operationType: 'move_case_workspace', destinationStorageRootKey: 'archive-root', destinationRelativePath: destination,
    })).json()).operation
    const changedFile = join(sourceRoot, ...source.split('/'), 'EVRAK', 'belge.txt')
    await writeFile(changedFile, 'plan-sonrasi-degisti', 'utf8')
    const future = new Date(Date.now() + 10_000)
    await utimes(changedFile, future, future)
    await approve(caseId, operation.id)
    const result = await runOnce(agentClient, agentConfig)
    expect(result.kind).toBe('reported')
    await expect(access(join(sourceRoot, ...source.split('/')))).resolves.toBeUndefined()
    await expect(access(join(archiveRoot, ...destination.split('/')))).rejects.toMatchObject({ code: 'ENOENT' })
    const location = await pool.query('SELECT storage_root_key,relative_path,version FROM case_locations WHERE case_id=$1', [caseId])
    expect(location.rows[0]).toMatchObject({ storage_root_key: 'source-root', relative_path: source, version: 1 })

    const responseText = JSON.stringify((await readOperation(caseId, operation.id)).json())
    expect(responseText).not.toContain(sourceRoot)
    expect(responseText).not.toContain(archiveRoot)
    expect(responseText).not.toContain(PASSWORD)
    const leak = await pool.query(
      `SELECT count(*)::int AS n FROM audit_events
       WHERE details::text ~ '[A-Za-z]:[/\\\\]' OR strpos(details::text, chr(92)) > 0
          OR details::text ILIKE $1 OR details::text ILIKE $2 OR details::text ILIKE $3`,
      [`%${sourceRoot}%`, `%${archiveRoot}%`, `%${PASSWORD}%`],
    )
    expect((leak.rows[0] as { n: number }).n).toBe(0)
    expect((await stat(changedFile)).isFile()).toBe(true)
  })
})
