import { access, mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AGENTS_ROUTE,
  AUTH_LOGIN_ROUTE,
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
import { extractEksist } from '../src/eksist/extract.js'
import { parseEksist } from '@hasarbotu/domain'
import { createCanvas, loadImage, PDFDocument } from '@napi-rs/canvas'

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


  async function source(text: string, cookie = cookieA) {
    for (const [label, value] of Object.entries({ 'Sigorta Şirketi': 'Sentetik Sigorta A.Ş.', 'Eksper Ad-Soyad': 'Sentetik Eksper', 'Eksper Atama Tarihi': '18.09.2026 09:30:00', 'Tamirhane Ad / Ünvan': 'Sentetik Servis', 'Marka': 'VOLKSWAGEN', 'Araç Tipi': 'PASSAT', 'Model Yılı': '2014', 'Araç Tarife Grubu': 'OTOMOBİL', 'Motor No': 'CAYZ46629', 'Şasi No': 'WVWZZZ3CZEE144172' })) {
      if (!text.includes(`${label}:`)) text += `\n${label}: ${value}`
    }
    const response = await app.inject({ method: 'POST', url: '/api/v1/eksist/sources', headers: { cookie }, payload: { kind: 'text', text } })
    expect(response.statusCode).toBe(201)
    return response.json() as { id: string }
  }
  function quick(payload: Record<string, unknown>, key = uuidv7(), cookie = cookieA) {
    return app.inject({ method: 'POST', url: '/api/v1/cases/quick-create', headers: { cookie, 'idempotency-key': key }, payload })
  }
  const manual = { case: { caseType: 'traffic', plate: '34 TR 2491', notificationDate: '2026-09-19', lossDate: '2026-09-17' }, storageRootKey: 'test-primary' }

  it('commits case, source, vehicle and queued folder atomically; agent verifies real folders; retries do not duplicate', async () => {
    const src = await source('Talep İşlem Ref No: 162111\nÜrün: Trafik\nPlaka: 034 - TR2491')
    const input = { ...manual, source: { id: src.id, reference: '162111' }, vehicle: { brand: 'VOLKSWAGEN', model: 'PASSAT', modelYear: 2014, vehicleClass: 'passenger_car', evidenceSource: 'insurer_record', chassisPrefix: null, engineCode: null } }
    const key = uuidv7()
    const responses = await Promise.all([quick(input, key), quick(input, key)])
    expect(responses.map(response => response.statusCode)).toEqual([202, 202])
    const first = responses[0]!.json()
    expect(responses[1]!.json().case.id).toBe(first.case.id)
    expect(first.provisioning.status).toBe('queued')
    await expect(access(join(root, first.provisioning.relativePath))).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await pool.query('SELECT count(*)::int AS n FROM cases WHERE organization_id=$1', [orgA])).rows[0].n).toBe(1)
    expect((await pool.query('SELECT count(*)::int AS n FROM jobs WHERE target_id=$1', [first.provisioning.id])).rows[0].n).toBe(1)
    const profile = await pool.query('SELECT brand,chassis_prefix,engine_code FROM case_vehicle_profile_versions WHERE case_id=$1', [first.case.id])
    expect(profile.rows).toEqual([{ brand: 'VOLKSWAGEN', chassis_prefix: null, engine_code: null }])
    const run = await runOnce(agentClient, agentConfig)
    expect(run.kind).toBe('reported')
    if (run.kind === 'reported') expect(run.reported.status).toBe('succeeded')
    const ready = (await quick(input, key)).json()
    expect(ready.provisioning.status).toBe('ready')
    for (const directory of ready.provisioning.requiredSubdirectories) await access(join(root, ready.provisioning.relativePath, directory))
    const uploadedAgain = await source('Talep İşlem Ref No: 162111\nPlaka: 034 - TR2491')
    const duplicate = await quick({ ...input, source: { id: uploadedAgain.id, reference: '162111' } })
    expect(duplicate.json()).toMatchObject({ duplicate: true, case: { id: first.case.id } })
    expect((await pool.query('SELECT count(*)::int AS n FROM cases WHERE organization_id=$1', [orgA])).rows[0].n).toBe(1)
    expect((await pool.query("SELECT lifecycle_status FROM cases WHERE id=$1", [first.case.id])).rows[0].lifecycle_status).toBe('open')
    const sources = await app.inject({ url: `/api/v1/cases/${first.case.id}/eksist-sources`, headers: { cookie: cookieA } })
    expect(sources.json().items[0].id).toBe(src.id)
    const foreign = await app.inject({ url: `/api/v1/cases/${first.case.id}/eksist-sources/${src.id}/content`, headers: { cookie: cookieB } })
    expect(foreign.statusCode).toBe(404)
    const auditEvents = await pool.query('SELECT action FROM audit_events WHERE resource_id=$1', [first.provisioning.id])
    expect(auditEvents.rows.map(row => row.action)).toContain('case.workspace_ready')
    const revised = await app.inject({ method: 'PUT', url: `/api/v1/cases/${first.case.id}/vehicle-profile`, headers: { cookie: cookieA }, payload: { fields: { ...input.vehicle, model: 'PASSAT COMFORTLINE' }, expectedVersion: 1, reason: 'Eksist bilgisi kullanıcı tarafından düzeltildi', confirmed: true } })
    expect(revised.statusCode).toBe(200)
    expect(revised.json()).toMatchObject({ version: 2, current: { model: 'PASSAT COMFORTLINE', chassisPrefix: null, engineCode: null } })
    const patched = await app.inject({ method: 'PATCH', url: `/api/v1/cases/${first.case.id}`, headers: { cookie: cookieA }, payload: { expectedVersion: first.case.version, insurerClaimNumber: 'CORRECTED-CLAIM' } })
    expect(patched.statusCode).toBe(200)
    expect(patched.json().case.insurerClaimNumber).toBe('CORRECTED-CLAIM')
  }, 30_000)

  it('missing required workspace data and foreign sources roll back the case, counter and audit', async () => {
    const before = (await pool.query('SELECT count(*)::int AS n FROM cases')).rows[0].n
    expect((await quick({ ...manual, case: { caseType: 'traffic', plate: '34 AA 111' } })).statusCode).toBe(400)
    expect((await quick({ ...manual, storageRootKey: '../unsafe' })).statusCode).toBe(400)
    const foreign = await source('Talep İşlem Ref No: 999', cookieB)
    expect((await quick({ ...manual, source: { id: foreign.id, reference: '999' } })).statusCode).toBe(400)
    expect((await pool.query('SELECT count(*)::int AS n FROM cases')).rows[0].n).toBe(before)
    expect((await quick(manual, uuidv7(), '')).statusCode).toBe(401)
  })

  it('agent failure stays partial and explicit retry reuses the same case and path', async () => {
    const key = uuidv7(), first = (await quick({ ...manual, case: { ...manual.case, plate: '34 RT 101' } }, key)).json()
    const failed = await runOnce(agentClient, { ...agentConfig, roots: {} })
    expect(failed.kind).toBe('reported')
    // Exhaustion is simulated at the job boundary, while provisioning and the retry use real stores.
    await pool.query("UPDATE jobs SET status='failed' WHERE target_id=$1", [first.provisioning.id])
    await pool.query("UPDATE case_workspace_provisionings SET status='failed',last_error_code='root_unavailable' WHERE id=$1", [first.provisioning.id])
    const retried = (await quick({ ...manual, case: { ...manual.case, plate: '34 RT 101' } }, key)).json()
    expect(retried.case.id).toBe(first.case.id)
    expect(retried.provisioning).toMatchObject({ id: first.provisioning.id, relativePath: first.provisioning.relativePath, status: 'queued' })
    await runOnce(agentClient, agentConfig)
    const ready = (await quick({ ...manual, case: { ...manual.case, plate: '34 RT 101' } }, key)).json()
    expect(ready.provisioning.status).toBe('ready')
  })
  it('enforces existing provisioning roles without removing manual creation permissions', async () => {
    const user = uuidv7(), email = 'eksist-secretary@example.test'
    await pool.query('INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4,$5)', [user, orgA, email, 'Secretary', await hashPassword(PASSWORD)])
    await pool.query("INSERT INTO user_roles(user_id,role_id) VALUES ($1,(SELECT id FROM roles WHERE code='secretary'))", [user])
    const cookie = await login(email)
    expect((await quick(manual, uuidv7(), cookie)).statusCode).toBe(403)
    expect((await app.inject({ method: 'POST', url: '/api/v1/eksist/sources', headers: { cookie }, payload: { kind: 'text', text: 'source' } })).statusCode).toBe(403)
    const manualResponse = await app.inject({ method: 'POST', url: '/api/v1/cases', headers: { cookie, 'idempotency-key': uuidv7() }, payload: { caseType: 'traffic', plate: '34 SC 111' } })
    expect(manualResponse.statusCode).toBe(201)
  })
  it('preserves uploaded PDF bytes and rejects disguised uploads', async () => {
    const bytes = await readFile(new URL('../../../eksist/Hatmer Eksist Uygulaması.pdf', import.meta.url))
    const uploaded = await app.inject({ method: 'POST', url: '/api/v1/eksist/sources', headers: { cookie: cookieA }, payload: { kind: 'pdf', name: 'source.pdf', base64: bytes.toString('base64') } })
    expect(uploaded.statusCode).toBe(201)
    const created = (await quick({ ...manual, source: { id: uploaded.json().id, reference: 'pdf-evidence-1' } })).json()
    const content = await app.inject({ url: `/api/v1/cases/${created.case.id}/eksist-sources/${uploaded.json().id}/content`, headers: { cookie: cookieA } })
    expect(content.statusCode).toBe(200); expect(content.rawPayload.equals(bytes)).toBe(true)
    const bad = await app.inject({ method: 'POST', url: '/api/v1/eksist/sources', headers: { cookie: cookieA }, payload: { kind: 'pdf', name: 'source.pdf', base64: Buffer.from('<script>bad</script>').toString('base64') } })
    expect(bad.statusCode).toBe(400)
  }, 30_000)
  it('rejects incomplete source vehicle data and rolls back even when the client supplies a draft', async () => {
    const src = await source('Talep İşlem Ref No: partial-1\nMarka: VOLKSWAGEN')
    const vehicleDraft = { brand: 'VOLKSWAGEN', model: 'User correction', modelYear: '', vehicleClass: '' }
    const response = await quick({ ...manual, source: { id: src.id, reference: 'partial-1', vehicleDraft } })
    expect(response.statusCode).toBe(400)
    expect(response.json().error.fieldErrors).toContainEqual(expect.objectContaining({ code: 'eksist_vehicle_incomplete' }))
    const saved = await pool.query('SELECT case_id,reviewed_fields FROM eksist_sources WHERE id=$1', [src.id])
    expect(saved.rows[0].case_id).toBeNull()
    expect(saved.rows[0].reviewed_fields).not.toHaveProperty('automatic')
  })
  it('persists authoritative source fields and full identifiers; locks fields and saves only explicit service revisions', async () => {
    const src = await source('Talep İşlem Ref No: automatic-1\nPlaka: 034 - AB1234\nEksper Levha No: E12345\nRenk: MAVİ')
    const response = await quick({ ...manual, case: { ...manual.case, notificationFormNumber: 'tampered', insurerId: uuidv7(), expertUserId: uuidv7(), followUpDate: '2000-01-01' }, source: { id: src.id, reference: 'automatic-1' }, vehicle: { brand: 'FAKE', model: 'FAKE', modelYear: 2000, vehicleClass: 'passenger_car', evidenceSource: 'insurer_record' } })
    expect(response.statusCode).toBe(202)
    const item = response.json().case
    const today = (await pool.query("SELECT to_char(now() AT TIME ZONE 'Europe/Istanbul','YYYY-MM-DD') AS today")).rows[0].today
    expect(item.followUpDate).toBe(today)
    expect(item.notificationFormNumber).toBe('18.09.2026 09:30:00')
    expect(item.eksist).toMatchObject({ insurerName: 'Sentetik Sigorta A.Ş.', expertName: 'Sentetik Eksper', expertLicenseNumber: 'E12345', serviceName: 'Sentetik Servis', vehicleFields: { 'Şasi No': 'WVWZZZ3CZEE144172', 'Motor No': 'CAYZ46629', 'Renk': 'MAVİ' } })
    expect((await pool.query('SELECT brand FROM case_vehicle_profile_versions WHERE case_id=$1', [item.id])).rows[0].brand).toBe('VOLKSWAGEN')
    const patch = (fields: Record<string, unknown>, version = item.version) => app.inject({ method: 'PATCH', url: `/api/v1/cases/${item.id}`, headers: { cookie: cookieA }, payload: { expectedVersion: version, ...fields } })
    for (const fields of [{ followUpDate: null }, { insurerId: null }, { expertUserId: null }, { notificationFormNumber: 'changed' }, { serviceId: null }]) {
      expect((await patch(fields)).statusCode).toBe(400)
    }
    const revised = await patch({ serviceRevision: { name: 'Revize Servis' } })
    expect(revised.statusCode).toBe(200)
    expect(revised.json().case.eksist).toMatchObject({ serviceName: 'Revize Servis', serviceRevised: true })
    expect((await patch({ serviceRevision: { name: 'Stale revision' } })).statusCode).toBe(409)
    const read = await app.inject({ url: `/api/v1/cases/${item.id}?includeEksist=true`, headers: { cookie: cookieA } })
    expect(read.statusCode).toBe(200)
    expect(read.json().case.eksist).toMatchObject({ serviceName: 'Revize Servis', expertName: 'Sentetik Eksper' })
    const evidence = (await pool.query('SELECT raw_text,reviewed_fields FROM eksist_sources WHERE id=$1', [src.id])).rows[0]
    expect(evidence.raw_text).toContain('Tamirhane Ad / Ünvan: Sentetik Servis')
    expect(evidence.reviewed_fields.automatic).toEqual(read.json().case.eksist)
  })
  it('uses the server registration day for manual creation and refuses subsequent date changes', async () => {
    const response = await quick({ ...manual, case: { ...manual.case, followUpDate: '2000-01-01' } })
    expect(response.statusCode).toBe(202)
    const item = response.json().case
    expect(item.followUpDate).toBe((await pool.query("SELECT to_char(created_at AT TIME ZONE 'Europe/Istanbul','YYYY-MM-DD') AS today FROM cases WHERE id=$1", [item.id])).rows[0].today)
    const updated = await app.inject({ method: 'PATCH', url: `/api/v1/cases/${item.id}`, headers: { cookie: cookieA }, payload: { expectedVersion: item.version, followUpDate: '2000-01-02' } })
    expect(updated.statusCode).toBe(400)
  })
  it('rejects unreviewed OCR atomically and preserves original I/İ evidence with an audited correction', async () => {
    const src = await source('Talep İşlem Ref No: OCRREVIEW\nPlaka: 034 - TR2491\nEksper Ad-Soyad: SENTETİK EKSPER')
    // Isolate the trust boundary: the stored extraction method, never a browser flag.
    await pool.query("UPDATE eksist_sources SET extraction_method='ocr' WHERE id=$1", [src.id])
    const input = { ...manual, source: { id: src.id, reference: 'OCRREVIEW' } }
    const before = (await pool.query('SELECT count(*)::int AS n FROM cases')).rows[0].n
    const rejected = await quick(input)
    expect(rejected.statusCode).toBe(400)
    expect(rejected.json().error.fieldErrors).toContainEqual(expect.objectContaining({ path: 'expertUserId', code: 'eksist_expert_review_required' }))
    expect((await pool.query('SELECT count(*)::int AS n FROM cases')).rows[0].n).toBe(before)
    expect((await pool.query('SELECT case_id FROM eksist_sources WHERE id=$1', [src.id])).rows[0].case_id).toBeNull()
    expect((await quick({ ...input, source: { ...input.source, expertReview: { name: 'SENTETIK EKSPER', confirmed: false } } })).statusCode).toBe(400)
    const key = uuidv7(), reviewed = { ...input, source: { ...input.source, expertReview: { name: 'SENTETIK EKSPER', confirmed: true } } }
    const correctExpertId = uuidv7()
    for (const [id, name] of [[correctExpertId, 'SENTETIK EKSPER'], [uuidv7(), 'SENTETİK EKSPER']]) {
      await pool.query('INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,$3,$4,$5)', [id, orgA, `${id}@test.local`, name, await hashPassword(PASSWORD)])
      await pool.query("INSERT INTO user_roles(user_id,role_id) VALUES($1,(SELECT id FROM roles WHERE code='expert'))", [id])
    }
    const accepted = await quick(reviewed, key)
    expect(accepted.statusCode).toBe(202)
    expect(accepted.json().case.eksist.expertName).toBe('SENTETIK EKSPER')
    expect(accepted.json().case.expertUserId).toBe(correctExpertId)
    const row = (await pool.query('SELECT raw_text,reviewed_fields FROM eksist_sources WHERE id=$1', [src.id])).rows[0]
    expect(row.raw_text).toContain('SENTETİK EKSPER')
    expect(row.reviewed_fields.expertReview).toMatchObject({ name: 'SENTETIK EKSPER', confirmed: true, reviewedByUserId: expect.any(String) })
    expect((await quick(reviewed, key)).json().case.id).toBe(accepted.json().case.id)
  })


})

describe('real Eksist evidence extraction (offline)', () => {
  it('falls back to OCR for a scanned PDF without text', async () => {
    const canvas = createCanvas(1400, 600), context = canvas.getContext('2d')
    context.fillStyle = 'white'; context.fillRect(0, 0, 1400, 600)
    context.fillStyle = 'black'; context.font = '32px Arial'
    for (const [index, line] of ['Talep İşlem Ref No: 881234', 'Ürün: Trafik', 'Plaka: 034 - TR2491'].entries()) context.fillText(line, 60, 80 + index * 80)
    const image = await loadImage(canvas.toBuffer('image/png')), pdf = new PDFDocument({ rasterDPI: 144 })
    const page = pdf.beginPage(700, 300)
    ;(page as unknown as { drawImage: (source: typeof image, x: number, y: number, width: number, height: number) => void }).drawImage(image, 0, 0, 700, 300)
    pdf.endPage()
    const result = await extractEksist('pdf', Buffer.from(pdf.close()))
    expect(result.method).toBe('ocr')
    expect(parseEksist(result.text)).toMatchObject({ reference: '881234', plate: '34 TR 2491', caseType: 'traffic' })
  }, 90_000)
  it('reads sample PDF text and screenshot OCR through the shared mapping', async () => {
    for (const [name, kind] of [['Hatmer Eksist Uygulaması.pdf', 'pdf'], ['Screenshot_1.png', 'image']] as const) {
      const bytes = await readFile(new URL(`../../../eksist/${name}`, import.meta.url))
      const result = await extractEksist(kind, bytes)
      expect(result.method).toBe(kind === 'pdf' ? 'pdf_text' : 'ocr')
      expect(parseEksist(result.text)).toMatchObject({ reference: '162111', plate: '34 TR 2491', caseType: 'traffic', lossDate: '2026-09-17', brand: 'VOLKSWAGEN', modelYear: '2014', vehicleClass: 'passenger_car' })
    }
  }, 90_000)
})
