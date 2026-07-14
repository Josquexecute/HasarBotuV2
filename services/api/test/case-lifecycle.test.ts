import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AGENTS_ROUTE,
  AUTH_LOGIN_ROUTE,
  CASES_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  caseLifecycleOperationResponseSchema,
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

const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'p21-sentetik-guclu-parola-42'
const ROOT_KEY = 'lifecycle-root'
const BASE_TYPES = [
  'victim_traffic_policy', 'insured_traffic_policy', 'sbm_heavy_damage_result',
  'victim_registration', 'insured_registration', 'victim_driver_license', 'insured_driver_license',
  'accident_report', 'expert_report', 'preliminary_report',
] as const

describeDb('case close/reopen lifecycle (gercek PostgreSQL + sentetik filesystem)', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let organizationId: string
  let otherOrganizationId: string
  let adminCookie: string
  let secretaryCookie: string
  let otherCookie: string
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
    return { ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode,
      json: async () => response.json(), headers: { get: () => null } } as unknown as Response
  }) as unknown as typeof fetch

  async function seedUser(orgId: string, email: string, role: 'admin' | 'secretary'): Promise<void> {
    const id = uuidv7()
    await pool.query(
      'INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4,$5)',
      [id, orgId, email, email, await hashPassword(PASSWORD)],
    )
    await pool.query('INSERT INTO user_roles (user_id,role_id) VALUES ($1,(SELECT id FROM roles WHERE code=$2))', [id, role])
  }

  async function login(email: string): Promise<string> {
    const response = await app.inject({ method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email, password: PASSWORD } })
    expect(response.statusCode).toBe(200)
    return String(response.headers['set-cookie']).split(';')[0] as string
  }

  async function seedCase(plate: string, withReadyRequirements: boolean): Promise<{
    caseId: string; officeNumber: string; openPath: string; locationId: string
  }> {
    const response = await app.inject({
      method: 'POST', url: CASES_ROUTE,
      headers: { cookie: adminCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { caseType: 'traffic', plate, workflowStage: 'ready_to_close', lossDate: '2026-07-13', notificationDate: '2026-07-14' },
    })
    expect(response.statusCode).toBe(201)
    const body = response.json() as { case: { id: string; officeCaseNumber: string } }
    const normalized = plate.replaceAll(' ', '')
    const openPath = `2026/Temmuz 2026/${normalized}`
    const locationId = uuidv7()
    await pool.query(
      `INSERT INTO case_locations
       (id,organization_id,case_id,storage_root_key,relative_path,verification_status,source)
       VALUES ($1,$2,$3,$4,$5,'verified','system')`,
      [locationId, organizationId, body.case.id, ROOT_KEY, openPath],
    )
    const absolute = join(root, ...openPath.split('/'))
    for (const directory of ['EVRAK', 'HASAR', 'OLAY YERİ', 'ONARIM', 'DEĞER KAYBI']) {
      await mkdir(join(absolute, directory), { recursive: true })
    }
    await writeFile(join(absolute, 'EVRAK', 'sentetik.txt'), 'sentetik-p21', 'utf8')
    if (withReadyRequirements) {
      for (const type of BASE_TYPES) await seedDocument(body.case.id, type, 'ready')
      await seedPhoto(body.case.id, 'ready')
    }
    return { caseId: body.case.id, officeNumber: body.case.officeCaseNumber, openPath, locationId }
  }

  async function seedDocument(caseId: string, documentType: string, status: 'ready' | 'pending' | 'failed'): Promise<void> {
    const documentId = uuidv7()
    const versionId = uuidv7()
    await pool.query(
      `INSERT INTO documents (id,organization_id,case_id,document_type,status) VALUES ($1,$2,$3,$4,$5)`,
      [documentId, organizationId, caseId, documentType, status],
    )
    const ready = status === 'ready'
    await pool.query(
      `INSERT INTO document_versions
       (id,organization_id,document_id,case_id,version_number,original_file_name,display_name,mime_type,byte_size,
        content_hash,storage_root_key,relative_path,source_type,status,hash_verified,size_verified,verified_at)
       VALUES ($1,$2,$3,$4,1,$5,$5,'application/pdf',10,$6,$7,$8,'imported',$9,$10,$10,$11)`,
      [versionId, organizationId, documentId, caseId, `${documentType}.pdf`, 'a'.repeat(64), ROOT_KEY,
        `2026/Temmuz 2026/METADATA/EVRAK/${caseId}-${documentType}.pdf`, status, ready, ready ? new Date('2026-07-14T10:00:00.000Z') : null],
    )
    await pool.query(
      'UPDATE documents SET current_version_id=$2,current_version_number=1,status=$3 WHERE id=$1',
      [documentId, versionId, status],
    )
  }

  async function seedPhoto(caseId: string, status: 'ready' | 'pending'): Promise<void> {
    const ready = status === 'ready'
    await pool.query(
      `INSERT INTO photos
       (id,organization_id,case_id,original_file_name,display_name,mime_type,byte_size,content_hash,storage_root_key,
        relative_path,source_type,status,hash_verified,size_verified,verified_at)
       VALUES ($1,$2,$3,'onarim.jpg','Onarim','image/jpeg',10,$4,$5,$6,'imported',$7,$8,$8,$9)`,
      [uuidv7(), organizationId, caseId, 'b'.repeat(64), ROOT_KEY,
        `2026/Temmuz 2026/METADATA/ONARIM/${caseId}-onarim.jpg`, status, ready,
        ready ? new Date('2026-07-14T10:00:00.000Z') : null],
    )
  }

  async function planClose(caseId: string, body: Record<string, unknown>, cookie = adminCookie, key = uuidv7()) {
    return app.inject({ method: 'POST', url: `/api/v1/cases/${caseId}/lifecycle/close/plan`,
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: key }, payload: body })
  }
  async function planReopen(caseId: string, body: Record<string, unknown>, key = uuidv7()) {
    return app.inject({ method: 'POST', url: `/api/v1/cases/${caseId}/lifecycle/reopen/plan`,
      headers: { cookie: adminCookie, [IDEMPOTENCY_KEY_HEADER]: key }, payload: body })
  }
  async function approve(caseId: string, operation: { id: string; operationType: 'close' | 'reopen'; version: number }, key = uuidv7()) {
    return app.inject({ method: 'POST',
      url: `/api/v1/cases/${caseId}/lifecycle/${operation.operationType}/${operation.id}/approve`,
      headers: { cookie: adminCookie, [IDEMPOTENCY_KEY_HEADER]: key }, payload: { approved: true, expectedVersion: operation.version } })
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    organizationId = uuidv7()
    otherOrganizationId = uuidv7()
    await pool.query('INSERT INTO organizations (id,code,name) VALUES ($1,$2,$3),($4,$5,$6)', [
      organizationId, 'p21-main', 'P21 Main', otherOrganizationId, 'p21-other', 'P21 Other',
    ])
    await seedUser(organizationId, 'p21-admin@test.local', 'admin')
    await seedUser(organizationId, 'p21-secretary@test.local', 'secretary')
    await seedUser(otherOrganizationId, 'p21-other@test.local', 'admin')
    await pool.query('INSERT INTO storage_roots (id,organization_id,root_key,label) VALUES ($1,$2,$3,$4)',
      [uuidv7(), organizationId, ROOT_KEY, 'Sentetik Lifecycle'])
    app = buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false, loginRateLimit: { limit: 1000, windowMs: 60_000 } } })
    adminCookie = await login('p21-admin@test.local')
    secretaryCookie = await login('p21-secretary@test.local')
    otherCookie = await login('p21-other@test.local')
    const registered = await app.inject({ method: 'POST', url: AGENTS_ROUTE, headers: { cookie: adminCookie }, payload: { name: 'Paket 21 Sentetik Agent' } })
    expect(registered.statusCode).toBe(201)
    const agent = registered.json() as { agent: { id: string }; secret: string }
    root = await mkdtemp(join(tmpdir(), 'hb-p21-lifecycle-'))
    agentConfig = { apiBaseUrl: '', agentId: agent.agent.id, agentSecret: agent.secret, roots: { [ROOT_KEY]: root }, leaseSeconds: 120, pollIntervalMs: 1000 }
    agentClient = createAgentApiClient({ baseUrl: '', agentId: agent.agent.id, secret: agent.secret, fetchImpl: injectFetch })
  }, 60_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
    if (root !== undefined) await rm(root, { recursive: true, force: true })
  })

  it('normal close ve reopen ayni case/ofis numarasini koruyarak gercek Agent move ile tamamlanir', async () => {
    const seeded = await seedCase('34 PAK 021', true)
    const closeKey = uuidv7()
    const plannedResponse = await planClose(seeded.caseId, { expectedCaseVersion: 1, expectedLocationVersion: 1, closeMode: 'normal' }, adminCookie, closeKey)
    expect(plannedResponse.statusCode).toBe(201)
    const planned = caseLifecycleOperationResponseSchema.parse(plannedResponse.json()).operation
    expect(planned).toMatchObject({ operationType: 'close', status: 'approval_required', blockers: [],
      destination: { relativePath: `2026/Temmuz 2026/KAPALI TEMMUZ 2026/${seeded.openPath.split('/').at(-1)}` } })
    expect(planned.requirementSummary.missingCount).toBe(0)
    await expect(access(join(root, ...planned.destination.relativePath.split('/')))).rejects.toMatchObject({ code: 'ENOENT' })
    const replay = await planClose(seeded.caseId, { expectedCaseVersion: 1, expectedLocationVersion: 1, closeMode: 'normal' }, adminCookie, closeKey)
    expect(replay.json()).toEqual(plannedResponse.json())

    const approveKey = uuidv7()
    const approvedResponse = await approve(seeded.caseId, planned, approveKey)
    expect(approvedResponse.statusCode).toBe(202)
    const approved = caseLifecycleOperationResponseSchema.parse(approvedResponse.json()).operation
    expect(approved).toMatchObject({ status: 'queued', linkedFileOperation: { status: 'queued' } })
    expect((await approve(seeded.caseId, planned, approveKey)).json()).toEqual(approvedResponse.json())
    expect((await runOnce(agentClient, agentConfig)).kind).toBe('reported')
    const closed = await pool.query('SELECT lifecycle_status,workflow_stage,version,office_number FROM cases WHERE id=$1', [seeded.caseId])
    expect(closed.rows[0]).toMatchObject({ lifecycle_status: 'closed', workflow_stage: 'closed', version: 2, office_number: seeded.officeNumber })
    const closedLocation = await pool.query('SELECT relative_path,version FROM case_locations WHERE case_id=$1', [seeded.caseId])
    expect(closedLocation.rows[0]).toMatchObject({ relative_path: planned.destination.relativePath, version: 2 })
    await expect(access(join(root, ...seeded.openPath.split('/')))).rejects.toMatchObject({ code: 'ENOENT' })

    const reopenResponse = await planReopen(seeded.caseId, {
      expectedCaseVersion: 2, expectedLocationVersion: 2, reason: 'Ek inceleme gerekli', targetWorkflowStage: 'reporting',
    })
    expect(reopenResponse.statusCode).toBe(201)
    const reopenPlan = caseLifecycleOperationResponseSchema.parse(reopenResponse.json()).operation
    expect(reopenPlan.destination.relativePath).toBe(seeded.openPath)
    expect((await approve(seeded.caseId, reopenPlan)).statusCode).toBe(202)
    expect((await runOnce(agentClient, agentConfig)).kind).toBe('reported')
    const reopened = await pool.query('SELECT lifecycle_status,workflow_stage,version,office_number FROM cases WHERE id=$1', [seeded.caseId])
    expect(reopened.rows[0]).toMatchObject({ lifecycle_status: 'open', workflow_stage: 'reporting', version: 3, office_number: seeded.officeNumber })
    expect((await pool.query('SELECT count(*)::int AS n FROM case_lifecycle_history WHERE case_id=$1', [seeded.caseId])).rows[0]).toEqual({ n: 2 })
    const actions = await pool.query("SELECT action FROM audit_events WHERE resource_id IN (SELECT id::text FROM case_lifecycle_operations WHERE case_id=$1)", [seeded.caseId])
    expect((actions.rows as { action: string }[]).map((row) => row.action)).toEqual(expect.arrayContaining([
      'case_lifecycle.close_planned', 'case_lifecycle.close_approved', 'case_lifecycle.closed',
      'case_lifecycle.reopen_planned', 'case_lifecycle.reopen_approved', 'case_lifecycle.reopened',
    ]))
  }, 60_000)

  it('normal close eksikleri blocker yapar; eksiklerle close gerekce ve pending/failed snapshot ister', async () => {
    const seeded = await seedCase('34 EKS 021', false)
    await seedDocument(seeded.caseId, 'expert_report', 'pending')
    await seedDocument(seeded.caseId, 'preliminary_report', 'failed')
    await seedPhoto(seeded.caseId, 'pending')
    const normal = await planClose(seeded.caseId, { expectedCaseVersion: 1, expectedLocationVersion: 1, closeMode: 'normal' })
    expect(normal.statusCode).toBe(201)
    const blocked = caseLifecycleOperationResponseSchema.parse(normal.json()).operation
    expect(blocked.status).toBe('blocked')
    expect(blocked.requirementSummary.controlRequiredCount).toBeGreaterThanOrEqual(3)
    expect(blocked.requirementSummary.requirements.filter((item) => ['pending', 'failed'].includes(item.relatedMetadataStatuses[0]?.status ?? '')).every((item) => item.status === 'control_required')).toBe(true)
    expect((await approve(seeded.caseId, blocked)).statusCode).toBe(409)
    expect((await planClose(seeded.caseId, { expectedCaseVersion: 1, expectedLocationVersion: 1, closeMode: 'with_missing_requirements' })).statusCode).toBe(400)
    const withMissing = await planClose(seeded.caseId, {
      expectedCaseVersion: 1, expectedLocationVersion: 1, closeMode: 'with_missing_requirements', reason: 'Belgeler daha sonra kontrol edilecek',
    })
    expect(withMissing.statusCode).toBe(201)
    const plan = caseLifecycleOperationResponseSchema.parse(withMissing.json()).operation
    expect(plan).toMatchObject({ status: 'approval_required', warnings: ['closing_with_missing_requirements'] })
    expect((await approve(seeded.caseId, plan)).statusCode).toBe(202)
    expect((await runOnce(agentClient, agentConfig)).kind).toBe('reported')
    expect((await pool.query('SELECT lifecycle_status FROM cases WHERE id=$1', [seeded.caseId])).rows[0]).toEqual({ lifecycle_status: 'closed' })
    const audit = await pool.query("SELECT details FROM audit_events WHERE action='case_lifecycle.close_with_missing_requirements' AND resource_id=$1", [plan.id])
    expect(audit.rowCount).toBe(1)
  }, 60_000)

  it('401, rol 403, tenant 404 ve stale version guvenli reddedilir; mutlak yol/secret sizmaz', async () => {
    const seeded = await seedCase('34 GUV 021', true)
    const payload = { expectedCaseVersion: 1, expectedLocationVersion: 1, closeMode: 'normal' }
    expect((await planClose(seeded.caseId, payload, '')).statusCode).toBe(401)
    expect((await planClose(seeded.caseId, payload, secretaryCookie)).statusCode).toBe(403)
    expect((await planClose(seeded.caseId, payload, otherCookie)).statusCode).toBe(404)
    expect((await planClose(seeded.caseId, { ...payload, expectedCaseVersion: 2 })).statusCode).toBe(409)
    const response = await planClose(seeded.caseId, payload)
    const serialized = JSON.stringify(response.json())
    expect(serialized).not.toContain(root)
    expect(serialized).not.toContain(PASSWORD)
    expect(serialized).not.toMatch(/[A-Za-z]:[/\\]/)
    const leak = await pool.query(
      `SELECT count(*)::int AS n FROM audit_events
       WHERE details::text ~ '[A-Za-z]:[/\\\\]' OR strpos(details::text,chr(92))>0
          OR details::text ILIKE $1 OR details::text ILIKE $2`, [`%${root}%`, `%${PASSWORD}%`],
    )
    expect(leak.rows[0]).toEqual({ n: 0 })
  })

  it('fiziksel move sonrasi case snapshot degisirse lifecycle kapanmaz ve manual recovery gorunur olur', async () => {
    const seeded = await seedCase('34 MAN 021', true)
    const planned = caseLifecycleOperationResponseSchema.parse((await planClose(seeded.caseId, {
      expectedCaseVersion: 1, expectedLocationVersion: 1, closeMode: 'normal',
    })).json()).operation
    expect((await approve(seeded.caseId, planned)).statusCode).toBe(202)
    await pool.query('UPDATE cases SET version=version+1,updated_at=now() WHERE id=$1', [seeded.caseId])
    expect((await runOnce(agentClient, agentConfig)).kind).toBe('reported')
    const operationResponse = await app.inject({ method: 'GET',
      url: `/api/v1/cases/${seeded.caseId}/lifecycle-operations/${planned.id}`, headers: { cookie: adminCookie } })
    expect(caseLifecycleOperationResponseSchema.parse(operationResponse.json()).operation).toMatchObject({
      status: 'manual_recovery_required', failureReasonCode: 'case_changed_after_move',
    })
    expect((await pool.query('SELECT lifecycle_status,workflow_stage FROM cases WHERE id=$1', [seeded.caseId])).rows[0])
      .toEqual({ lifecycle_status: 'open', workflow_stage: 'ready_to_close' })
    expect((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action='case_lifecycle.manual_recovery_required' AND resource_id=$1", [planned.id])).rows[0]).toEqual({ n: 1 })
  }, 60_000)
})
