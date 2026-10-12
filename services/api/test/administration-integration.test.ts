import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { assertTestDatabaseUrl,createDatabasePool,runMigrations,uuidv7 } from '@hasarbotu/database'
import { managedServicesSchema,managedDocumentRulesSchema,rolePolicySchema,documentRequirementsResponseSchema } from '@hasarbotu/contracts'
import { buildApp,hashPassword } from '../src/index.js'

const url = process.env.TEST_DATABASE_URL
const describeDb = url ? describe : describe.skip
describeDb('office administration runtime effects (isolated PostgreSQL)',() => {
  let pool: pg.Pool,app: FastifyInstance,org: string,foreignOrg: string,manager: string,operator: string,adminCookie: string,operatorCookie: string,foreignCookie: string,caseId: string
  const password = 'administration-isolated-password'
  async function addUser(organizationId: string,role: string) {
    const id = uuidv7(),email = `${id}@test.example`
    await pool.query('INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,$3,$4,$5)',[id,organizationId,email,role,await hashPassword(password)])
    await pool.query('INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code=$2',[id,role])
    const response = await app.inject({ method: 'POST',url: '/api/v1/auth/login',payload: { email,password } })
    expect(response.statusCode,response.payload).toBe(200)
    return { id,cookie: String(response.headers['set-cookie']).split(';')[0]! }
  }
  const get = (path: string,as = adminCookie) => app.inject({ method: 'GET',url: `/api/v1/${path}`,headers: { cookie: as } })
  const post = (path: string,payload: object,as = adminCookie) => app.inject({ method: 'POST',url: `/api/v1/${path}`,headers: { cookie: as },payload })
  beforeAll(async () => {
    const config = assertTestDatabaseUrl(url!)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    await runMigrations({ databaseUrl: config.url,quiet: true })
    org = uuidv7();foreignOrg = uuidv7()
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,'administration-a','A'),($2,'administration-b','B')",[org,foreignOrg])
    app = buildApp({ loggerEnabled: false,auth: { pool,cookieSecure: false } });await app.ready()
    const admin = await addUser(org,'admin'),owner = await addUser(org,'case_manager'),foreign = await addUser(foreignOrg,'admin')
    manager = admin.id;adminCookie = admin.cookie;operator = owner.id;operatorCookie = owner.cookie;foreignCookie = foreign.cookie
    const created = await app.inject({ method: 'POST',url: '/api/v1/cases',headers: { cookie: adminCookie,'idempotency-key': uuidv7() },payload: { caseType: 'traffic',plate: '34 TEST 10',responsibleUserId: operator } })
    expect(created.statusCode,created.payload).toBe(201);caseId = created.json().case.id
  },60_000)
  afterAll(async () => { await app?.close();await pool?.end() })
  it('edits actual service references, preserves tenant scope and rejects stale versions',async () => {
    const payload = { name: 'Test Servis',serviceType: 'private',phone: '0312 000 00 00',isActive: true }
    expect((await post('administration/services',payload,operatorCookie)).statusCode).toBe(403)
    const created = await post('administration/services',payload)
    expect(created.statusCode,created.payload).toBe(201)
    const id = created.json().item.id
    expect(managedServicesSchema.parse((await get('administration/services')).json()).items[0]).toMatchObject({ id,version: 1 })
    const edited = await post(`administration/services/${id}`,{ ...payload,name: 'Cam Servisi',serviceType: 'glass',expectedVersion: 1 })
    expect(edited.statusCode,edited.payload).toBe(200)
    expect(edited.json().item).toMatchObject({ name: 'Cam Servisi',serviceType: 'glass',version: 2 })
    expect((await post(`administration/services/${id}`,{ ...payload,expectedVersion: 1 })).statusCode).toBe(409)
    expect((await post(`administration/services/${id}`,{ ...payload,expectedVersion: 2 },foreignCookie)).statusCode).toBe(404)
    expect((await get('references/services')).json().items[0]).toMatchObject({ id,name: 'Cam Servisi',serviceType: 'glass' })
    expect((await post(`administration/services/${id}`,{ ...payload,isActive: false,expectedVersion: 2 })).statusCode).toBe(200)
    expect((await get('references/services')).json().items).toHaveLength(0)
    expect((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action IN ('service.created','service.updated') AND organization_id=$1",[org])).rows[0].n).toBe(3)
  })
  it('versions tenant document rules and applies them to both case checks and owner alerts',async () => {
    const initial = managedDocumentRulesSchema.parse((await get('administration/document-rules')).json()).items.find((item) => item.caseType === 'traffic')!
    const configuration = { baseRequired: [],incidentEvidenceRequired: false,tramerWithoutReportRequired: false,recourseDocumentsRequired: false }
    const before = documentRequirementsResponseSchema.parse((await get(`cases/${caseId}/document-requirements`)).json())
    expect(before.missingCount).toBeGreaterThan(0)
    expect((await post('administration/document-rules/traffic',{ expectedVersionId: initial.versionId,configuration },operatorCookie)).statusCode).toBe(403)
    const changed = await post('administration/document-rules/traffic',{ expectedVersionId: initial.versionId,configuration })
    expect(changed.statusCode,changed.payload).toBe(204)
    expect((await post('administration/document-rules/traffic',{ expectedVersionId: initial.versionId,configuration })).statusCode).toBe(409)
    const after = documentRequirementsResponseSchema.parse((await get(`cases/${caseId}/document-requirements`)).json())
    expect(after.missingCount).toBe(0);expect(after.requirements).toHaveLength(0)
    expect((await get('operational-alerts',operatorCookie)).json().alerts).toHaveLength(0)
    const foreign = managedDocumentRulesSchema.parse((await get('administration/document-rules',foreignCookie)).json()).items.find((item) => item.caseType === 'traffic')!
    expect(foreign.versionId).toBe(initial.versionId)
    expect((await pool.query('SELECT count(*)::int AS n FROM document_rule_versions WHERE id=$1',[initial.versionId])).rows[0].n).toBe(1)
  })
  it('enforces updated permissions on an existing session and logs rejected actions without request secrets',async () => {
    const policy = rolePolicySchema.parse((await get('administration/permissions')).json())
    const permissions = { ...policy.permissions,operations_write: ['admin'] as const }
    const changed = await post('administration/permissions',{ expectedVersion: policy.version,permissions })
    expect(changed.statusCode,changed.payload).toBe(200)
    expect((await post('administration/permissions',{ expectedVersion: policy.version,permissions })).statusCode).toBe(409)
    const session = (await get('auth/session',operatorCookie)).json()
    expect(session.user.permissions).not.toContain('operations_write')
    const rejected = await app.inject({ method: 'POST',url: `/api/v1/cases/${caseId}/notes`,headers: { cookie: operatorCookie,'idempotency-key': uuidv7() },payload: { noteType: 'internal',subject: null,body: 'Must not be saved' } })
    expect(rejected.statusCode,rejected.payload).toBe(403)
    expect((await pool.query('SELECT count(*)::int AS n FROM case_notes WHERE case_id=$1',[caseId])).rows[0].n).toBe(0)
    await vi.waitFor(async () => expect((await pool.query("SELECT details FROM audit_events WHERE action='request.rejected' AND actor_user_id=$1",[operator])).rows.some((item) => item.details.statusCode === 403)).toBe(true))
    expect((await pool.query("SELECT details FROM audit_events WHERE action='request.rejected' AND actor_user_id=$1",[operator])).rows.map((item) => JSON.stringify(item.details)).join('')).not.toMatch(/Must not be saved|password|cookie|token/i)
    expect((await post('administration/permissions',{ expectedVersion: 1,permissions: { ...permissions,users_admin: ['expert'] } })).statusCode).toBe(400)
    expect((await post('administration/permissions',{ expectedVersion: 1,permissions },operatorCookie)).statusCode).toBe(403)
    expect((await get('administration/permissions',foreignCookie)).json().version).toBe(0)
    expect((await get('audit-events',operatorCookie)).statusCode).toBe(403)
    expect((await get('audit-events')).json().items.some((item: { action: string;actorUserId: string }) => item.action === 'permissions.updated' && item.actorUserId === manager)).toBe(true)
  })
})
