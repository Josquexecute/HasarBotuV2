import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { mkdtemp,mkdir,writeFile,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDocumentTracker,createTrackingClient } from '@hasarbotu/file-agent'
import { assertTestDatabaseUrl,createDatabasePool,runMigrations,uuidv7 } from '@hasarbotu/database'
import { trackingSnapshotSchema } from '@hasarbotu/contracts'
import { buildApp,hashPassword } from '../src/index.js'
import { ingestSbmResult,observeFile,reconcileFiles } from '../src/tracking/store.js'
import { encryptToken,GMAIL_SCOPE,GoogleProviderError,validateGoogleClaims,type GoogleConfig,type GoogleProvider } from '../src/tracking/google.js'
import { syncMailboxes } from '../src/tracking/mail-worker.js'
import { sbmFixture,sbmNumber } from '../test-support/sbm-fixtures.js'

const url = process.env.TEST_DATABASE_URL
const describeDb = url ? describe : describe.skip
const password = 'tracking-isolated-password-2026'
const google: GoogleConfig = { clientId: 'test-client',clientSecret: 'test-secret',redirectUri: 'https://test.example/api/v1/google/callback',encryptionKey: 'ab'.repeat(32),sbmSenders: ['results@sbm.example'],automaticSbmEnabled: false }

describeDb('tracking actual API/database effects (isolated PostgreSQL)',() => {
  let pool: pg.Pool,app: FastifyInstance,org: string,otherOrg: string,owner: string,operator: string,manager: string,ownerCookie: string,operatorCookie: string,managerCookie: string,otherCookie: string
  let loginIdentity = { email: 'manager@baranekspertiz.com',sub: 'manager-google' }
  const provider: GoogleProvider = {
    authorizeUrl: (purpose,state) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}&purpose=${purpose}`,
    exchange: async () => ({ access_token: 'access',id_token: 'signed',refresh_token: 'refresh',scope: `openid email ${GMAIL_SCOPE}` }),
    identity: async (_jwt,nonce,corporate) => validateGoogleClaims({ iss: 'https://accounts.google.com',...loginIdentity,aud: google.clientId,exp: Date.now()/1000+600,iat: Date.now()/1000,nonce,email_verified: true,hd: 'baranekspertiz.com' },google.clientId,nonce,corporate),
    refresh: async () => ({ access_token: 'access' }),
    gmail: async () => ({ emailAddress: loginIdentity.email }),
  }
  function cookie(response: { headers: { 'set-cookie'?: string | string[] | undefined } }) { return String(response.headers['set-cookie']).split(';')[0]! }
  async function user(organizationId: string,email: string,role: string) {
    const id = uuidv7()
    await pool.query('INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,$3,$3,$4)', [id,organizationId,email,await hashPassword(password)])
    await pool.query('INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code=$2', [id,role])
    return id
  }
  async function login(email: string) {
    const r = await app.inject({ method: 'POST',url: '/api/v1/auth/login',payload: { email,password } })
    expect(r.statusCode,r.payload).toBe(200);return cookie(r)
  }
  async function createCase() {
    const r = await app.inject({ method: 'POST',url: '/api/v1/cases',headers: { cookie: managerCookie,'idempotency-key': uuidv7() },payload: { caseType: 'traffic',plate: '34 TEST 123',responsibleUserId: owner } })
    expect(r.statusCode,r.payload).toBe(201);return r.json().case.id as string
  }
  async function command(caseId: string,input: unknown,as = managerCookie) {
    return app.inject({ method: 'POST',url: `/api/v1/tracking/cases/${caseId}/tramer`,headers: { cookie: as },payload: input as object })
  }
  async function snapshot(as = ownerCookie,caseId?: string) {
    const r = await app.inject({ method: 'GET',url: `/api/v1/tracking${caseId ? `?caseId=${caseId}` : ''}`,headers: { cookie: as } })
    expect(r.statusCode,r.payload).toBe(200);return trackingSnapshotSchema.parse(r.json())
  }
  async function connection(email: string) {
    const id = uuidv7()
    await pool.query(`INSERT INTO mail_connections(id,organization_id,connected_by,subject,email,encrypted_refresh_token,status) VALUES($1::uuid,$2,$3,$1::text,$4,$5,'connected')`, [id,org,manager,email,encryptToken('refresh',google.encryptionKey,`${org}:${id}`)])
    return id
  }
  async function submit(caseId: string,number: string) {
    expect((await command(caseId,{ action: 'assign',assignedUserId: operator })).statusCode).toBe(204)
    const r = await command(caseId,{ action: 'number',applicationNumber: number,expectedVersion: 1 },operatorCookie)
    expect(r.statusCode,r.payload).toBe(204)
  }
  beforeAll(async () => {
    const config = assertTestDatabaseUrl(url!)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    await runMigrations({ databaseUrl: config.url,quiet: true })
    org = uuidv7();otherOrg = uuidv7()
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,'tracking-a','Tracking A'),($2,'tracking-b','Tracking B')", [org,otherOrg])
    owner = await user(org,'owner@baranekspertiz.com','case_manager')
    operator = await user(org,'operator@baranekspertiz.com','secretary')
    manager = await user(org,'manager@baranekspertiz.com','admin')
    await user(otherOrg,'other@baranekspertiz.com','admin')
    app = buildApp({ loggerEnabled: false,auth: { pool,cookieSecure: false,loginRateLimit: { limit: 100,windowMs: 60_000 } },google,googleProvider: provider })
    await app.ready()
    ownerCookie = await login('owner@baranekspertiz.com');operatorCookie = await login('operator@baranekspertiz.com');managerCookie = await login('manager@baranekspertiz.com');otherCookie = await login('other@baranekspertiz.com')
  },60_000)
  afterAll(async () => { await app?.close();await pool?.end() })

  it('processes the supplied KTT templates through mailbox sync, matching by text number and notifying only the owner once',async () => {
    const id = await createCase();await submit(id,sbmNumber)
    const connections = [await connection('template-one@baranekspertiz.com'),await connection('template-two@baranekspertiz.com')]
    let messages = [sbmFixture('entry')]
    const gmail = vi.fn<GoogleProvider['gmail']>().mockImplementation(async (_token,path) => {
      if (path.startsWith('messages?')) return { messages: messages.map(({ id }) => ({ id })) }
      const message = messages.find((m) => path === `messages/${m.id}?format=full`)
      if (!message) throw new Error('Unexpected fixture message request')
      return message
    })
    const config = { ...google,sbmSenders: ['sbm@sbm.org.tr'],automaticSbmEnabled: true }
    await syncMailboxes(pool,config,{ ...provider,gmail })
    const pending = await snapshot(ownerCookie,id)
    expect(pending.tramer[0]?.status).toBe('result_pending');expect(pending.notifications).toHaveLength(0)
    expect((await pool.query('SELECT reason FROM sbm_messages WHERE connection_id=ANY($1::uuid[])', [connections])).rows)
      .toEqual([{ reason: 'non_result_notification' },{ reason: 'non_result_notification' }])

    messages = [...messages,sbmFixture('agreement')]
    await syncMailboxes(pool,config,{ ...provider,gmail })
    await syncMailboxes(pool,config,{ ...provider,gmail })
    const done = await snapshot(ownerCookie,id)
    expect(done.tramer[0]).toMatchObject({ applicationNumber: sbmNumber,status: 'completed',resultText: 'Sonuç: MUTABAKAT - ŞİRKETLER ARASI MUTABAKAT (SON DURUM)' })
    expect(done.notifications).toHaveLength(1)
    expect((await snapshot(operatorCookie,id)).notifications).toHaveLength(0)
    expect(done.history.filter((h) => h.action === 'tracking.sbm_result')).toHaveLength(1)
    expect(done.history.find((h) => h.action === 'tracking.sbm_result')?.details.sourceAccount).toMatch(/^template-(one|two)@/)
    expect((await pool.query("SELECT status FROM sbm_messages WHERE connection_id=ANY($1::uuid[]) AND provider_message_id='agreement' ORDER BY status", [connections])).rows)
      .toEqual([{ status: 'applied' },{ status: 'duplicate' }])
    expect(gmail.mock.calls.filter(([,path]) => path === 'messages/agreement?format=full')).toHaveLength(2)
  })

  it('preserves long text numbers and independent assignment; concurrent duplicate numbers have one winner',async () => {
    const a = await createCase(),b = await createCase()
    expect((await command(a,{ action: 'assign',assignedUserId: operator })).statusCode).toBe(204)
    expect((await command(b,{ action: 'assign',assignedUserId: operator })).statusCode).toBe(204)
    const number = '000123456789012345678901234567890'
    const results = await Promise.all([a,b].map((id) => command(id,{ action: 'number',applicationNumber: number,expectedVersion: 1 },operatorCookie)))
    expect(results.map((r) => r.statusCode).sort()).toEqual([204,409])
    const work = await snapshot(operatorCookie)
    expect(work.tramer.filter((t) => t.applicationNumber === number)).toHaveLength(1)
    expect(work.tramer.find((t) => t.applicationNumber === number)?.status).toBe('result_pending')
    expect((await snapshot(ownerCookie)).tramer).toHaveLength(0)
    expect((await pool.query('SELECT responsible_user_id FROM cases WHERE id=$1', [a])).rows[0].responsible_user_id).toBe(owner)
    expect((await command(a,{ action: 'assign',assignedUserId: operator },otherCookie)).statusCode).toBe(404)
    expect((await command(a,{ action: 'assign',assignedUserId: operator },operatorCookie)).statusCode).toBe(403)
  })

  it('notifies the case owner, deduplicates accounts and retains cancelled state on late results',async () => {
    const id = await createCase();await submit(id,'000200')
    const c1 = await connection('mail-one@baranekspertiz.com'),c2 = await connection('mail-two@baranekspertiz.com')
    const result = { applicationNumber: '000200',status: 'completed' as const,text: 'Sonuç: Tamamlandı',evidenceHash: 'a'.repeat(64),reason: null }
    await Promise.all([c1,c2].map((connectionId) => ingestSbmResult(pool,{ connectionId,messageId: 'same-result',receivedAt: new Date(),result,automatic: true })))
    await ingestSbmResult(pool,{ connectionId: c1,messageId: 'same-result',receivedAt: new Date(),result,automatic: true })
    const data = await snapshot(ownerCookie,id)
    expect(data.tramer[0]?.status).toBe('completed');expect(data.notifications).toHaveLength(1)
    expect((await snapshot(operatorCookie,id)).notifications).toHaveLength(0)
    expect(data.history.filter((h) => h.action === 'tracking.sbm_result')[0]?.details.sourceAccount).toMatch(/mail-(one|two)@/)
    expect((await pool.query("SELECT status,count(*)::int AS n FROM sbm_messages WHERE application_number='000200' GROUP BY status ORDER BY status")).rows).toEqual([{ status: 'applied',n: 1 },{ status: 'duplicate',n: 1 }])
    const cancelled = await createCase();await submit(cancelled,'000201')
    expect((await command(cancelled,{ action: 'cancel',reason: 'Başvuru geri çekildi',expectedVersion: 2 })).statusCode).toBe(204)
    await ingestSbmResult(pool,{ connectionId: c1,messageId: 'late-result',receivedAt: new Date(),result: { ...result,applicationNumber: '000201' },automatic: true })
    expect((await snapshot(ownerCookie,cancelled)).tramer[0]?.status).toBe('cancelled')
    expect((await snapshot(managerCookie)).reviews.find((r) => r.applicationNumber === '000201')?.reason).toBe('conflicting_or_terminal_result')
  })

  it('queues unknown, ambiguous and unvalidated messages; permits explicit review only for managers',async () => {
    const id = await createCase();await submit(id,'000300')
    const c = await connection('review-mail@baranekspertiz.com')
    const result = { applicationNumber: '000300',status: 'completed' as const,text: 'candidate',evidenceHash: 'b'.repeat(64),reason: null }
    await ingestSbmResult(pool,{ connectionId: c,messageId: 'unvalidated',receivedAt: new Date(),result,automatic: false })
    await ingestSbmResult(pool,{ connectionId: c,messageId: 'unmatched',receivedAt: new Date(),result: { ...result,applicationNumber: '999999' },automatic: true })
    expect((await snapshot(ownerCookie,id)).tramer[0]?.status).toBe('result_pending')
    const review = (await snapshot(managerCookie)).reviews.find((r) => r.applicationNumber === '000300')!
    expect(review.reason).toBe('parser_not_validated')
    const payload = { action: 'apply',applicationNumber: '000300',resultStatus: 'completed',note: 'Kontrol edildi, sonuç tamamlandı.' }
    expect((await app.inject({ method: 'POST',url: `/api/v1/tracking/sbm/${review.id}/review`,headers: { cookie: operatorCookie },payload })).statusCode).toBe(403)
    expect((await app.inject({ method: 'POST',url: `/api/v1/tracking/sbm/${review.id}/review`,headers: { cookie: managerCookie },payload })).statusCode).toBe(204)
    expect((await snapshot(ownerCookie,id)).tramer[0]?.status).toBe('completed')
  })

  it('detects documents without fulfilling requirements; only owner approval fulfils them; changed content needs approval again',async () => {
    const caseId = await createCase()
    await pool.query("INSERT INTO storage_roots(id,organization_id,root_key,label) VALUES($1,$2,'tracking-root','Test root')", [uuidv7(),org])
    await pool.query("INSERT INTO case_locations(id,organization_id,case_id,storage_root_key,relative_path) VALUES($1,$2,$3,'tracking-root','case-folder')", [uuidv7(),org,caseId])
    const input = { caseId,locationVersion: 1,storageRootKey: 'tracking-root',relativePath: 'case-folder/policy.pdf',contentHash: 'a'.repeat(64),byteSize: 200 }
    await observeFile(pool,org,'test-agent',input);await observeFile(pool,org,'test-agent',input)
    let data = await snapshot(ownerCookie,caseId)
    expect(data.documents).toHaveLength(1);expect(data.notifications).toHaveLength(1)
    const requirements = async () => {
      const r = await app.inject({ method: 'GET',url: `/api/v1/cases/${caseId}/document-requirements`,headers: { cookie: ownerCookie } })
      expect(r.statusCode,r.payload).toBe(200);return r.json().requirements as { canonicalDocumentType: string;status: string }[]
    }
    expect((await requirements()).find((r) => r.canonicalDocumentType === 'victim_traffic_policy')?.status).toBe('missing')
    const body = { status: 'approved',documentType: 'victim_traffic_policy',note: 'İçerik ve plaka kontrol edildi.' }
    const endpoint = `/api/v1/tracking/documents/${data.documents[0]!.id}/review`
    expect((await app.inject({ method: 'POST',url: endpoint,headers: { cookie: operatorCookie },payload: body })).statusCode).toBe(403)
    expect((await app.inject({ method: 'POST',url: endpoint,headers: { cookie: ownerCookie },payload: body })).statusCode).toBe(204)
    expect((await requirements()).find((r) => r.canonicalDocumentType === 'victim_traffic_policy')?.status).toBe('present')
    await observeFile(pool,org,'test-agent',{ ...input,contentHash: 'b'.repeat(64) })
    data = await snapshot(ownerCookie,caseId)
    expect(data.documents[0]?.status).toBe('pending');expect(data.notifications).toHaveLength(2)
    expect((await requirements()).find((r) => r.canonicalDocumentType === 'victim_traffic_policy')?.status).toBe('control_required')
    expect((await app.inject({ method: 'POST',url: endpoint,headers: { cookie: ownerCookie },payload: body })).statusCode).toBe(409)
    await observeFile(pool,org,'test-agent',input)
    expect((await snapshot(ownerCookie,caseId)).notifications).toHaveLength(3)
    await reconcileFiles(pool,org,{ caseId,locationVersion: 1,scanStartedAt: '2000-01-01T00:00:00.000Z',paths: [] })
    expect((await snapshot(ownerCookie,caseId)).documents).toHaveLength(1)
    await reconcileFiles(pool,org,{ caseId,locationVersion: 1,scanStartedAt: new Date().toISOString(),paths: [] })
    expect((await snapshot(ownerCookie,caseId)).documents).toHaveLength(0)
    expect((await requirements()).find((r) => r.canonicalDocumentType === 'victim_traffic_policy')?.status).toBe('missing')
    await observeFile(pool,org,'test-agent',input)
    expect((await snapshot(ownerCookie,caseId)).documents[0]?.status).toBe('pending')
    await expect(observeFile(pool,org,'test-agent',{ ...input,locationVersion: 999 })).rejects.toMatchObject({ status: 409 })
    await expect(observeFile(pool,otherOrg,'test-agent',input)).rejects.toMatchObject({ status: 409 })
  })

  it('retains notifications with the desktop closed and across API restarts; read/presented states are private',async () => {
    const before = await snapshot(ownerCookie)
    const notice = before.notifications.find((n) => !n.readAt)!
    await app.close()
    app = buildApp({ loggerEnabled: false,auth: { pool,cookieSecure: false },google,googleProvider: provider });await app.ready()
    const pending = await app.inject({ method: 'GET',url: '/api/v1/tracking/notifications/pending',headers: { cookie: ownerCookie } })
    expect(pending.json().notifications.some((n: { id: string }) => n.id === notice.id)).toBe(true)
    const path = `/api/v1/tracking/notifications/${notice.id}`
    expect((await app.inject({ method: 'POST',url: `${path}/read`,headers: { cookie: operatorCookie },payload: {} })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST',url: `${path}/presented`,headers: { cookie: ownerCookie },payload: {} })).statusCode).toBe(204)
    expect((await snapshot(ownerCookie)).notifications.find((n) => n.id === notice.id)).toMatchObject({ readAt: null,presentedAt: expect.any(String) })
    expect((await app.inject({ method: 'POST',url: `${path}/read`,headers: { cookie: ownerCookie },payload: {} })).statusCode).toBe(204)
    expect((await snapshot(ownerCookie)).notifications.find((n) => n.id === notice.id)?.readAt).toEqual(expect.any(String))
    expect((await snapshot(otherCookie)).notifications).toHaveLength(0)
  })

  it('runs the central scanner over real HTTP and files with no desktop process; restart produces no duplicate',async () => {
    const caseId = await createCase()
    const root = await mkdtemp(join(tmpdir(),'hb-tracking-http-'))
    try {
      await mkdir(join(root,'http-case'));await writeFile(join(root,'http-case','report.txt'),'closed desktop evidence')
      await pool.query("INSERT INTO storage_roots(id,organization_id,root_key,label) VALUES($1,$2,'http-root','HTTP test root')", [uuidv7(),org])
      await pool.query("INSERT INTO case_locations(id,organization_id,case_id,storage_root_key,relative_path) VALUES($1,$2,$3,'http-root','http-case')", [uuidv7(),org,caseId])
      const registration = await app.inject({ method: 'POST',url: '/api/v1/agents',headers: { cookie: managerCookie },payload: { name: 'Tracking test agent' } })
      expect(registration.statusCode,registration.payload).toBe(201)
      const { agent,secret } = registration.json() as { agent: { id: string };secret: string }
      const address = await app.listen({ host: '127.0.0.1',port: 0 })
      const client = createTrackingClient({ apiBaseUrl: address,agentId: agent.id,agentSecret: secret,roots: { 'http-root': root },leaseSeconds: 120,pollIntervalMs: 1000,freshnessGate: undefined })
      let time = 0
      const scanner = () => createDocumentTracker(client,{ 'http-root': root },{ now: () => time,settleMs: 100 })
      const first = scanner();await first.scan();time = 200;await first.scan()
      expect((await snapshot(ownerCookie,caseId)).notifications).toHaveLength(1)
      const restarted = scanner();await restarted.scan();time = 400;await restarted.scan()
      expect((await snapshot(ownerCookie,caseId)).notifications).toHaveLength(1)
      await writeFile(join(root,'http-case','report.txt'),'changed during desktop absence');await restarted.scan();time = 600;await restarted.scan()
      expect((await snapshot(ownerCookie,caseId)).notifications).toHaveLength(2)
      const health = await fetch(`${address}/api/v1/tracking/agent/health`,{ method: 'POST',headers: { 'x-agent-id': agent.id,'x-agent-secret': secret,'content-type': 'application/json' },body: JSON.stringify({ ok: true }) })
      expect(health.status).toBe(204)
      expect((await snapshot(ownerCookie)).services).toContainEqual(expect.objectContaining({ kind: 'folder',status: 'running' }))
      const documentId = uuidv7(),versionId = uuidv7()
      await pool.query("INSERT INTO documents(id,organization_id,case_id,document_type,status) VALUES($1,$2,$3,'victim_traffic_policy','ready')", [documentId,org,caseId])
      await pool.query(`INSERT INTO document_versions(id,organization_id,document_id,case_id,version_number,original_file_name,display_name,mime_type,byte_size,content_hash,storage_root_key,relative_path,source_type,status,hash_verified,size_verified,verified_at)
        VALUES($1,$2,$3,$4,1,'legacy.pdf','legacy.pdf','application/pdf',20,$5,'http-root','http-case/legacy.pdf','manual','ready',true,true,now())`, [versionId,org,documentId,caseId,'c'.repeat(64)])
      await pool.query('UPDATE documents SET current_version_id=$2,current_version_number=1 WHERE id=$1', [documentId,versionId])
      expect((await pool.query('SELECT status FROM tracking_requirement_documents WHERE id=$1', [versionId])).rows[0].status).toBe('pending')
      await pool.query("UPDATE tracking_health SET last_attempt_at=now()-interval '10 minutes' WHERE kind='folder'")
      expect((await snapshot(ownerCookie)).services).toContainEqual(expect.objectContaining({ kind: 'folder',status: 'stale' }))
      expect((await pool.query('SELECT status FROM tracking_requirement_documents WHERE id=$1', [versionId])).rows[0].status).toBe('pending')
    } finally { await rm(root,{ recursive: true,force: true }) }
  },30_000)

  it('Google login uses existing employee roles and requires the initiating browser cookie; callback replay is rejected',async () => {
    const start = await app.inject({ method: 'POST',url: '/api/v1/google/start',payload: { purpose: 'login' } })
    expect(start.statusCode,start.payload).toBe(200)
    const flowId = start.json().flowId as string
    expect((await app.inject({ method: 'GET',url: `/api/v1/google/callback?state=${flowId}&code=fake` })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET',url: `/api/v1/google/callback?state=${flowId}&code=fake` })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST',url: '/api/v1/google/complete',payload: { flowId } })).statusCode).toBe(400)
    const done = await app.inject({ method: 'POST',url: '/api/v1/google/complete',headers: { cookie: cookie(start) },payload: { flowId } })
    expect(done.json().status).toBe('complete')
    const session = await app.inject({ method: 'GET',url: '/api/v1/auth/session',headers: { cookie: cookie(done) } })
    expect(session.json().user).toMatchObject({ id: manager,roles: ['admin'] })
    expect((await pool.query('SELECT user_id FROM google_identities WHERE subject=$1', ['manager-google'])).rows[0].user_id).toBe(manager)
  })

  it('rejects unregistered/disabled employees and revoked consent without creating identities',async () => {
    for (const email of ['unknown@baranekspertiz.com','disabled@baranekspertiz.com']) {
      if (email.startsWith('disabled')) { const id = await user(org,email,'secretary');await pool.query("UPDATE users SET status='disabled' WHERE id=$1", [id]) }
      loginIdentity = { email,sub: email }
      const start = await app.inject({ method: 'POST',url: '/api/v1/google/start',payload: { purpose: 'login' } })
      const flowId = start.json().flowId as string
      expect((await app.inject({ method: 'GET',url: `/api/v1/google/callback?state=${flowId}&code=fake` })).statusCode).toBe(400)
    }
    const start = await app.inject({ method: 'POST',url: '/api/v1/google/start',payload: { purpose: 'login' } })
    expect((await app.inject({ method: 'GET',url: `/api/v1/google/callback?state=${start.json().flowId}&error=access_denied` })).statusCode).toBe(400)
    expect((await pool.query('SELECT count(*)::int AS n FROM google_identities')).rows[0].n).toBe(1)
    loginIdentity = { email: 'manager@baranekspertiz.com',sub: 'manager-google' }
  })

  it('connects mail separately, encrypts refresh permission and records source account without changing file ownership',async () => {
    const denied = await app.inject({ method: 'POST',url: '/api/v1/google/start',headers: { cookie: operatorCookie },payload: { purpose: 'mail' } })
    expect(denied.statusCode).toBe(403)
    loginIdentity = { email: 'sbm-inbox@baranekspertiz.com',sub: 'sbm-inbox-google' }
    const start = await app.inject({ method: 'POST',url: '/api/v1/google/start',headers: { cookie: managerCookie },payload: { purpose: 'mail' } })
    expect(start.statusCode,start.payload).toBe(200)
    expect((await app.inject({ method: 'GET',url: `/api/v1/google/callback?state=${start.json().flowId}&code=fake` })).statusCode).toBe(200)
    const row = (await pool.query("SELECT * FROM mail_connections WHERE subject='sbm-inbox-google'")).rows[0]
    expect(row.status).toBe('connected');expect(row.encrypted_refresh_token).not.toContain('refresh')
    const done = await app.inject({ method: 'POST',url: '/api/v1/google/complete',headers: { cookie: `${managerCookie}; ${cookie(start)}` },payload: { flowId: start.json().flowId } })
    expect(done.json().status).toBe('complete');expect(done.headers['set-cookie']).toBeUndefined()
    loginIdentity = { email: 'manager@baranekspertiz.com',sub: 'manager-google' }
  })

  it('records permission loss; catches up after recovery; processes messages only once',async () => {
    await pool.query("UPDATE mail_connections SET status='disconnected'")
    const c = await connection('recovery@baranekspertiz.com')
    const refresh = vi.fn<GoogleProvider['refresh']>().mockRejectedValue(new GoogleProviderError('permission_required',400))
    await syncMailboxes(pool,google,{ ...provider,refresh })
    expect((await pool.query('SELECT status FROM mail_connections WHERE id=$1', [c])).rows[0].status).toBe('permission_required')
    await pool.query("UPDATE mail_connections SET status='connected' WHERE id=$1", [c])
    refresh.mockResolvedValue({ access_token: 'new-access' })
    const gmail = vi.fn<GoogleProvider['gmail']>().mockImplementation(async (_token,path) => path.startsWith('messages?') ? { messages: [{ id: 'missed-during-outage' }] } : { id: 'missed-during-outage',internalDate: String(Date.now()),payload: { mimeType: 'text/plain',headers: [{ name: 'From',value: 'results@sbm.example' },{ name: 'Authentication-Results',value: 'mx.google.com; dmarc=pass header.from=sbm.example' }],body: { data: Buffer.from('Başvuru no: 999999\nSonuç: Tamamlandı').toString('base64url') } } })
    await syncMailboxes(pool,google,{ ...provider,refresh,gmail });await syncMailboxes(pool,google,{ ...provider,refresh,gmail })
    expect((await pool.query('SELECT count(*)::int AS n FROM sbm_messages WHERE connection_id=$1', [c])).rows[0].n).toBe(1)
    expect(gmail.mock.calls.filter((args) => args[1].startsWith('messages/missed'))).toHaveLength(1)
    expect((await pool.query('SELECT status,last_success_at FROM mail_connections WHERE id=$1', [c])).rows[0]).toMatchObject({ status: 'connected',last_success_at: expect.any(Date) })
  })
})
