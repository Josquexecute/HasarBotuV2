import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AUTH_LOGIN_ROUTE,
  documentRequirementsResponseSchema,
  type DocumentRequirementsResponse,
} from '@hasarbotu/contracts'
import {
  assertTestDatabaseUrl,
  closeDatabasePool,
  createDatabasePool,
  runMigrations,
  uuidv7,
  type DatabaseConfig,
} from '@hasarbotu/database'
import type { CanonicalDocumentType, DocumentMetadataStatus } from '@hasarbotu/domain'
import { buildApp, hashPassword } from '../src/index.js'

const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'paket-15-sentetik-parola'
const TRAFFIC_BASE: readonly CanonicalDocumentType[] = [
  'victim_traffic_policy', 'insured_traffic_policy', 'sbm_heavy_damage_result',
  'victim_registration', 'insured_registration', 'victim_driver_license', 'insured_driver_license',
]
const CASCO_BASE: readonly CanonicalDocumentType[] = [
  'casco_policy', 'sbm_heavy_damage_result', 'casco_vehicle_registration', 'casco_driver_license',
]
const RECOURSE_EXTRA: readonly CanonicalDocumentType[] = [
  'opposing_vehicle_registration', 'opposing_driver_license', 'opposing_traffic_policy',
  'tramer_result', 'fault_ratio',
]

describeDb('Paket 15 belge gereksinimleri (gerçek PostgreSQL)', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let orgA: string
  let orgB: string
  let cookieA: string
  let cookieB: string
  let sequence = 0

  async function seedUser(organizationId: string, email: string): Promise<void> {
    const userId = uuidv7()
    await pool.query(
      'INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4,$5)',
      [userId, organizationId, email, email, await hashPassword(PASSWORD)],
    )
    await pool.query(
      "INSERT INTO user_roles (user_id,role_id) SELECT $1,id FROM roles WHERE code='case_manager'",
      [userId],
    )
  }

  async function login(email: string): Promise<string> {
    const response = await app.inject({ method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email, password: PASSWORD } })
    expect(response.statusCode).toBe(200)
    const raw = response.headers['set-cookie']
    return String(Array.isArray(raw) ? raw[0] : raw).split(';')[0] as string
  }

  async function seedCase(
    organizationId: string,
    caseType: 'traffic' | 'casco',
    recourseStatus: 'confirmed' | 'not_confirmed' | 'unknown' = 'unknown',
  ): Promise<string> {
    sequence += 1
    const id = uuidv7()
    await pool.query(
      `INSERT INTO cases
       (id,organization_id,office_year,office_sequence,office_number,case_type,workflow_stage,plate,plate_normalized,recourse_status)
       VALUES ($1,$2,2026,$3,$4,$5,'new_notification',$6,$7,$8)`,
      [id, organizationId, sequence, `2026/${sequence}`, caseType, `34 TST ${sequence}`, `34TST${sequence}`, recourseStatus],
    )
    return id
  }

  async function seedDocument(
    organizationId: string,
    caseId: string,
    documentType: CanonicalDocumentType,
    status: DocumentMetadataStatus = 'ready',
  ): Promise<string> {
    const documentId = uuidv7()
    const versionId = uuidv7()
    const verified = status === 'ready'
    const relativePath = `2026/EVRAK/${caseId}/${documentType}-${versionId}.pdf`
    const hash = createHash('sha256').update(versionId).digest('hex')
    await pool.query(
      `INSERT INTO documents
       (id,organization_id,case_id,document_type,current_version_number,status)
       VALUES ($1,$2,$3,$4,1,$5)`,
      [documentId, organizationId, caseId, documentType, status],
    )
    await pool.query(
      `INSERT INTO document_versions
       (id,organization_id,document_id,case_id,version_number,original_file_name,display_name,extension,mime_type,byte_size,content_hash,storage_root_key,relative_path,source_type,status,hash_verified,size_verified,verified_at)
       VALUES ($1,$2,$3,$4,1,$5,$5,'pdf','application/pdf',128,$6,'test-root',$7,'manual',$8,$9,$9,$10)`,
      [versionId, organizationId, documentId, caseId, `${documentType}.pdf`, hash, relativePath, status, verified, verified ? new Date('2026-07-14T07:00:00.000Z') : null],
    )
    await pool.query('UPDATE documents SET current_version_id=$1 WHERE id=$2', [versionId, documentId])
    return versionId
  }

  async function seedReadySet(organizationId: string, caseId: string, types: readonly CanonicalDocumentType[]): Promise<void> {
    for (const type of types) await seedDocument(organizationId, caseId, type)
  }

  async function evaluate(cookie: string, caseId: string): Promise<{ statusCode: number; body: DocumentRequirementsResponse }> {
    const response = await app.inject({ method: 'GET', url: `/api/v1/cases/${caseId}/document-requirements`, headers: { cookie } })
    return { statusCode: response.statusCode, body: response.json() as DocumentRequirementsResponse }
  }

  function requirement(body: DocumentRequirementsResponse, code: string) {
    const item = body.requirements.find((candidate) => candidate.requirementCode === code)
    expect(item).toBeDefined()
    return item!
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    orgA = uuidv7(); orgB = uuidv7()
    await pool.query('INSERT INTO organizations (id,code,name) VALUES ($1,$2,$3),($4,$5,$6)', [orgA, 'p15-a', 'P15 A', orgB, 'p15-b', 'P15 B'])
    await seedUser(orgA, 'p15-a@example.test'); await seedUser(orgB, 'p15-b@example.test')
    app = buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false, loginRateLimit: { limit: 100, windowMs: 60_000 } } })
    cookieA = await login('p15-a@example.test'); cookieB = await login('p15-b@example.test')
  }, 60_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  it('login, Trafik ready/KTT/Tramer ve salt-okunur snapshot-audit davranışı', async () => {
    const caseId = await seedCase(orgA, 'traffic', 'not_confirmed')
    await seedReadySet(orgA, caseId, [...TRAFFIC_BASE, 'ktt', 'tramer_result'])
    const beforeAudit = await pool.query('SELECT count(*)::int AS n FROM audit_events')
    const beforeSnapshots = await pool.query('SELECT count(*)::int AS n FROM document_rule_evaluations')
    const response = await evaluate(cookieA, caseId)
    expect(response.statusCode).toBe(200)
    expect(documentRequirementsResponseSchema.safeParse(response.body).success).toBe(true)
    expect(response.body.overallStatus).toBe('present')
    expect(requirement(response.body, 'traffic_victim_policy').status).toBe('present')
    expect(requirement(response.body, 'accident_report').status).toBe('not_applicable')
    expect(requirement(response.body, 'statement').status).toBe('not_applicable')
    expect(response.body.alternativeGroups.find((group) => group.groupCode === 'incident_document')?.status).toBe('present')
    expect(response.body.ruleSetVersion).toBe('2026.07.14.1')
    const afterAudit = await pool.query('SELECT count(*)::int AS n FROM audit_events')
    const afterSnapshots = await pool.query('SELECT count(*)::int AS n FROM document_rule_evaluations')
    expect(afterAudit.rows[0]).toEqual(beforeAudit.rows[0])
    expect(afterSnapshots.rows[0]).toEqual(beforeSnapshots.rows[0])
  })

  it('Zabıt ready iken KTT/Beyan/Tramer uygulanamaz', async () => {
    const caseId = await seedCase(orgA, 'traffic', 'not_confirmed')
    await seedReadySet(orgA, caseId, [...TRAFFIC_BASE, 'accident_report'])
    const { body } = await evaluate(cookieA, caseId)
    expect(body.overallStatus).toBe('present')
    expect(requirement(body, 'ktt').status).toBe('not_applicable')
    expect(requirement(body, 'statement').status).toBe('not_applicable')
    expect(requirement(body, 'tramer_result').status).toBe('not_applicable')
  })

  it('pending ve failed mevcut sayılmaz; control_required döner', async () => {
    const caseId = await seedCase(orgA, 'traffic', 'not_confirmed')
    await seedReadySet(orgA, caseId, TRAFFIC_BASE.slice(2))
    await seedDocument(orgA, caseId, 'victim_traffic_policy', 'pending')
    await seedDocument(orgA, caseId, 'insured_traffic_policy', 'failed')
    await seedReadySet(orgA, caseId, ['statement', 'tramer_result'])
    const { body } = await evaluate(cookieA, caseId)
    expect(requirement(body, 'traffic_victim_policy').status).toBe('control_required')
    expect(requirement(body, 'traffic_insured_policy').status).toBe('control_required')
    expect(body.controlRequiredCount).toBeGreaterThanOrEqual(2)
  })

  it('Kasko temel evrakları ve Beyan alternatifi present olur; Trafik Tramer kuralı eklenmez', async () => {
    const caseId = await seedCase(orgA, 'casco', 'not_confirmed')
    await seedReadySet(orgA, caseId, [...CASCO_BASE, 'statement'])
    const { body } = await evaluate(cookieA, caseId)
    expect(body.overallStatus).toBe('present')
    expect(requirement(body, 'casco_policy').status).toBe('present')
    expect(body.requirements.some((item) => item.requirementCode === 'tramer_result')).toBe(false)
  })

  it('kesinleşmiş rücuda ek evraklar ve KTT/Zabıt grubu zorunludur', async () => {
    const caseId = await seedCase(orgA, 'casco', 'confirmed')
    await seedReadySet(orgA, caseId, [...CASCO_BASE, ...RECOURSE_EXTRA, 'ktt'])
    const { body } = await evaluate(cookieA, caseId)
    expect(body.overallStatus).toBe('present')
    expect(requirement(body, 'recourse_opposing_registration').status).toBe('present')
    expect(requirement(body, 'recourse_tramer_result').status).toBe('present')
    expect(body.alternativeGroups.find((group) => group.groupCode === 'recourse_incident_document')?.status).toBe('present')
  })

  it('rücu belirsizliğinde ek evraklar missing değil control_required olur', async () => {
    const caseId = await seedCase(orgA, 'casco', 'unknown')
    await seedReadySet(orgA, caseId, [...CASCO_BASE, 'ktt'])
    const { body } = await evaluate(cookieA, caseId)
    expect(body.overallStatus).toBe('control_required')
    expect(requirement(body, 'recourse_opposing_registration').status).toBe('control_required')
    expect(requirement(body, 'recourse_fault_ratio').status).toBe('control_required')
  })

  it('tenant izolasyonu 404, oturumsuz istek 401 ve response/audit güvenli', async () => {
    const foreignCaseId = await seedCase(orgB, 'traffic', 'not_confirmed')
    const foreign = await app.inject({ method: 'GET', url: `/api/v1/cases/${foreignCaseId}/document-requirements`, headers: { cookie: cookieA } })
    const unauthorized = await app.inject({ method: 'GET', url: `/api/v1/cases/${foreignCaseId}/document-requirements` })
    expect(foreign.statusCode).toBe(404)
    expect(unauthorized.statusCode).toBe(401)
    const own = await seedCase(orgA, 'traffic', 'not_confirmed')
    await seedReadySet(orgA, own, [...TRAFFIC_BASE, 'ktt', 'tramer_result'])
    const safe = await app.inject({ method: 'GET', url: `/api/v1/cases/${own}/document-requirements`, headers: { cookie: cookieA } })
    const payload = safe.payload
    expect(payload).not.toMatch(/[A-Za-z]:[\\/]/)
    expect(payload).not.toContain('relativePath')
    expect(payload).not.toContain('contentHash')
    expect(payload).not.toContain(PASSWORD)
    const audit = await pool.query("SELECT details::text FROM audit_events WHERE organization_id=$1", [orgA])
    const auditText = JSON.stringify(audit.rows)
    expect(auditText).not.toMatch(/[A-Za-z]:[\\/]/)
    expect(auditText).not.toContain(PASSWORD)
    expect(cookieB).not.toContain(PASSWORD)
  })

  it('canlı HTTP smoke: login, Trafik, Kasko, rücu, belirsizlik, kontrol, tenant ve 401', async () => {
    const traffic = await seedCase(orgA, 'traffic', 'not_confirmed')
    const casco = await seedCase(orgA, 'casco', 'not_confirmed')
    const recourse = await seedCase(orgA, 'casco', 'confirmed')
    const unknown = await seedCase(orgA, 'casco', 'unknown')
    const control = await seedCase(orgA, 'traffic', 'not_confirmed')
    const report = await seedCase(orgA, 'traffic', 'not_confirmed')
    const foreign = await seedCase(orgB, 'traffic', 'not_confirmed')
    await seedReadySet(orgA, traffic, [...TRAFFIC_BASE, 'ktt', 'tramer_result'])
    await seedReadySet(orgA, casco, [...CASCO_BASE, 'statement'])
    await seedReadySet(orgA, recourse, [...CASCO_BASE, ...RECOURSE_EXTRA, 'ktt'])
    await seedReadySet(orgA, unknown, [...CASCO_BASE, 'ktt'])
    await seedReadySet(orgA, control, [...TRAFFIC_BASE.slice(2), 'statement', 'tramer_result'])
    await seedDocument(orgA, control, 'victim_traffic_policy', 'pending')
    await seedDocument(orgA, control, 'insured_traffic_policy', 'failed')
    await seedReadySet(orgA, report, [...TRAFFIC_BASE, 'accident_report'])

    const address = await app.listen({ host: '127.0.0.1', port: 0 })
    const loginResponse = await fetch(`${address}${AUTH_LOGIN_ROUTE}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'p15-a@example.test', password: PASSWORD }),
    })
    expect(loginResponse.status).toBe(200)
    const cookie = (loginResponse.headers.get('set-cookie') ?? '').split(';')[0]
    expect(cookie.length).toBeGreaterThan(0)
    const beforeAudit = await pool.query('SELECT count(*)::int AS n FROM audit_events')
    const beforeSnapshots = await pool.query('SELECT count(*)::int AS n FROM document_rule_evaluations')
    const get = (caseId: string, authenticated = true) => fetch(
      `${address}/api/v1/cases/${caseId}/document-requirements`,
      authenticated ? { headers: { cookie } } : undefined,
    )
    const trafficResponse = await get(traffic)
    const cascoResponse = await get(casco)
    const recourseResponse = await get(recourse)
    const unknownResponse = await get(unknown)
    const controlResponse = await get(control)
    const reportResponse = await get(report)
    const foreignResponse = await get(foreign)
    const unauthorizedResponse = await get(traffic, false)
    expect([trafficResponse.status, cascoResponse.status, recourseResponse.status, unknownResponse.status, controlResponse.status, reportResponse.status]).toEqual([200, 200, 200, 200, 200, 200])
    expect(foreignResponse.status).toBe(404)
    expect(unauthorizedResponse.status).toBe(401)
    const trafficBody = documentRequirementsResponseSchema.parse(await trafficResponse.json())
    const cascoBody = documentRequirementsResponseSchema.parse(await cascoResponse.json())
    const recourseBody = documentRequirementsResponseSchema.parse(await recourseResponse.json())
    const unknownBody = documentRequirementsResponseSchema.parse(await unknownResponse.json())
    const controlBody = documentRequirementsResponseSchema.parse(await controlResponse.json())
    const reportBody = documentRequirementsResponseSchema.parse(await reportResponse.json())
    expect(trafficBody.overallStatus).toBe('present')
    expect(cascoBody.overallStatus).toBe('present')
    expect(recourseBody.overallStatus).toBe('present')
    expect(unknownBody.overallStatus).toBe('control_required')
    expect(controlBody.controlRequiredCount).toBeGreaterThanOrEqual(2)
    expect(requirement(reportBody, 'tramer_result').status).toBe('not_applicable')
    const serialized = JSON.stringify([trafficBody, cascoBody, recourseBody, unknownBody, controlBody, reportBody])
    expect(serialized).not.toMatch(/[A-Za-z]:[\\/]/)
    expect(serialized).not.toContain('relativePath')
    expect(serialized).not.toContain('contentHash')
    expect(serialized).not.toContain(PASSWORD)
    const afterAudit = await pool.query('SELECT count(*)::int AS n FROM audit_events')
    const afterSnapshots = await pool.query('SELECT count(*)::int AS n FROM document_rule_evaluations')
    expect(afterAudit.rows[0]).toEqual(beforeAudit.rows[0])
    expect(afterSnapshots.rows[0]).toEqual(beforeSnapshots.rows[0])
  })
})
