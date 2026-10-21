import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { mkdtemp,mkdir,writeFile,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDocumentTracker,createTrackingClient } from '@hasarbotu/file-agent'
import { assertTestDatabaseUrl,createDatabasePool,runMigrations,uuidv7 } from '@hasarbotu/database'
import { trackingSnapshotSchema } from '@hasarbotu/contracts'
import { defaultRolePolicy } from '../src/auth/permissions.js'
import { buildApp,hashPassword } from '../src/index.js'
import { ingestSbmResult,observeFile,reconcileFiles } from '../src/tracking/store.js'
import { encryptToken,GMAIL_SCOPE,GoogleProviderError,validateGoogleClaims,type GoogleConfig,type GoogleProvider } from '../src/tracking/google.js'
import { syncMailboxes } from '../src/tracking/mail-worker.js'
import { sbmFixture,sbmNumber } from '../test-support/sbm-fixtures.js'

const url = process.env.TEST_DATABASE_URL
const describeDb = url ? describe : describe.skip
const password = 'tracking-isolated-password-2026'
const google: GoogleConfig = { clientId: 'test-client',clientSecret: 'test-secret',redirectUri: 'https://test.example/api/v1/google/callback',encryptionKey: 'ab'.repeat(32),sbmSenders: ['results@sbm.example'],automaticSbmEnabled: false,loginDomain: 'office.example' }

describeDb('tracking actual API/database effects (isolated PostgreSQL)',() => {
  let pool: pg.Pool,app: FastifyInstance,org: string,otherOrg: string,owner: string,operator: string,manager: string,ownerCookie: string,operatorCookie: string,managerCookie: string,otherCookie: string
  let loginIdentity = { email: 'manager@office.example',sub: 'manager-google' }
  const provider: GoogleProvider = {
    authorizeUrl: (purpose,state) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}&purpose=${purpose}`,
    exchange: async () => ({ access_token: 'access',id_token: 'signed',refresh_token: 'refresh',scope: `openid email ${GMAIL_SCOPE}` }),
    identity: async (_jwt,nonce,corporate) => validateGoogleClaims({ iss: 'https://accounts.google.com',...loginIdentity,aud: google.clientId,exp: Date.now()/1000+600,iat: Date.now()/1000,nonce,email_verified: true,hd: 'office.example' },google.clientId,nonce,corporate ? google.loginDomain : undefined),
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
    owner = await user(org,'owner@office.example','case_manager')
    operator = await user(org,'operator@office.example','secretary')
    manager = await user(org,'manager@office.example','admin')
    await user(otherOrg,'other@office.example','admin')
    app = buildApp({ loggerEnabled: false,auth: { pool,cookieSecure: false,loginRateLimit: { limit: 100,windowMs: 60_000 } },google: { ...google,signupOrganizationId: org },googleProvider: provider })
    await app.ready()
    ownerCookie = await login('owner@office.example');operatorCookie = await login('operator@office.example');managerCookie = await login('manager@office.example');otherCookie = await login('other@office.example')
  },60_000)
  afterAll(async () => { await app?.close();await pool?.end() })

  it('dismisses more than twenty owned alerts without marking them read or affecting other owners',async () => {
    const ownedCase = await createCase(),otherCase = await createCase()
    await pool.query('UPDATE cases SET responsible_user_id=$2 WHERE id=$1',[otherCase,operator])
    const ids = Array.from({ length: 45 },() => uuidv7())
    for (const id of ids) await pool.query(`INSERT INTO tracking_notifications(id,organization_id,case_id,recipient_user_id,event_key,kind,title)
      VALUES($1::uuid,$2,$3,$4,$1::text,'document','Backlog')`,[id,org,ownedCase,manager])
    const otherId = uuidv7()
    await pool.query(`INSERT INTO tracking_notifications(id,organization_id,case_id,recipient_user_id,event_key,kind,title)
      VALUES($1::uuid,$2,$3,$4,$1::text,'document','Other')`,[otherId,org,otherCase,owner])
    const pending = (as: string) => app.inject({ method: 'GET',url: '/api/v1/tracking/notifications/pending',headers: { cookie: as } })
    expect((await pending(ownerCookie)).json().notifications).toHaveLength(20)
    expect((await pending(managerCookie)).json().notifications).toHaveLength(0)
    const inbox = await app.inject({ method: 'GET',url: '/api/v1/tracking/notifications/inbox',headers: { cookie: ownerCookie } })
    expect(inbox.statusCode,inbox.payload).toBe(200)
    expect(inbox.json()).toMatchObject({ total: 45,unread: 45,page: 1 })
    expect(inbox.json().notifications).toHaveLength(45)
    expect((await app.inject({ method: 'GET',url: '/api/v1/tracking/notifications/inbox',headers: { cookie: managerCookie } })).json().total).toBe(0)
    const dismissed = await app.inject({ method: 'POST',url: '/api/v1/tracking/notifications/dismiss',headers: { cookie: ownerCookie },payload: {} })
    expect(dismissed.statusCode,dismissed.payload).toBe(204)
    expect((await pending(ownerCookie)).json().notifications).toHaveLength(0)
    expect((await snapshot(ownerCookie,ownedCase)).notifications).toHaveLength(45)
    const rows = (await pool.query('SELECT read_at,presented_at FROM tracking_notifications WHERE id=ANY($1::uuid[])',[ids])).rows
    expect(rows.every((r) => r.read_at === null && r.presented_at !== null)).toBe(true)
    expect((await pending(operatorCookie)).json().notifications.map((r: { id: string }) => r.id)).toContain(otherId)
    expect((await app.inject({ method: 'POST',url: `/api/v1/tracking/notifications/${otherId}/read`,headers: { cookie: ownerCookie },payload: {} })).statusCode).toBe(404)
    const futureId = uuidv7()
    await pool.query(`INSERT INTO tracking_notifications(id,organization_id,case_id,event_key,kind,title) VALUES($1::uuid,$2,$3,$1::text,'document','Future')`,[futureId,org,ownedCase])
    expect((await pending(ownerCookie)).json().notifications.map((r: { id: string }) => r.id)).toContain(futureId)
    expect((await pending(otherCookie)).json().notifications).toHaveLength(0)
    expect((await pool.query("SELECT details FROM audit_events WHERE action='tracking.notifications_dismissed' AND actor_user_id=$1",[owner])).rows[0].details.count).toBe(45)
  })

  it('processes the supplied KTT templates through mailbox sync, matching by text number and notifying only the owner once',async () => {
    const id = await createCase();await submit(id,sbmNumber)
    const connections = [await connection('template-one@office.example'),await connection('template-two@office.example')]
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
    const c1 = await connection('mail-one@office.example'),c2 = await connection('mail-two@office.example')
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
    const c = await connection('review-mail@office.example')
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

  it('alerts the owner when automatic processing is disabled without claiming completion or duplicating accounts',async () => {
    const id = await createCase();await submit(id,'000310')
    const recipient = await user(org,'review-popup-owner@office.example','case_manager')
    const recipientCookie = await login('review-popup-owner@office.example')
    await pool.query('UPDATE cases SET responsible_user_id=$2 WHERE id=$1',[id,recipient])
    const accounts = [await connection('review-alert-one@office.example'),await connection('review-alert-two@office.example')]
    const result = { applicationNumber: '000310',status: 'completed' as const,text: 'Sonuç: Tamamlandı',evidenceHash: 'c'.repeat(64),reason: null }
    for (const connectionId of accounts) await ingestSbmResult(pool,{ connectionId,messageId: 'review-alert',receivedAt: new Date(),result,automatic: false })
    const data = await snapshot(recipientCookie,id)
    expect(data.tramer[0]?.status).toBe('result_pending')
    expect(data.notifications).toHaveLength(1)
    expect(data.notifications[0]?.title).toContain('000310')
    expect(data.notifications[0]?.title).toContain('kontrol bekliyor')
    expect((await snapshot(operatorCookie,id)).notifications).toHaveLength(0)
    const pending = await app.inject({ method: 'GET',url: '/api/v1/tracking/notifications/pending',headers: { cookie: recipientCookie } })
    expect(pending.statusCode).toBe(200)
    expect(pending.json().notifications).toEqual([expect.objectContaining({ caseId: id,title: data.notifications[0]!.title })])
    const inbox = await app.inject({ method: 'GET',url: '/api/v1/tracking/notifications/inbox?read=all',headers: { cookie: recipientCookie } })
    expect(inbox.json().notifications).toContainEqual(expect.objectContaining({ caseId: id,title: data.notifications[0]!.title,readAt: null }))
  })

  it('links an already received result when its number is saved and requires explicit review',async () => {
    const id = await createCase(),c = await connection('early-result@office.example')
    const result = { applicationNumber: '000311',status: 'completed' as const,text: 'Sonuç: Tamamlandı',evidenceHash: 'd'.repeat(64),reason: null }
    await ingestSbmResult(pool,{ connectionId: c,messageId: 'before-number',receivedAt: new Date(),result,automatic: true })
    await submit(id,'000311')
    const data = await snapshot(ownerCookie,id)
    expect(data.tramer[0]).toMatchObject({ applicationNumber: '000311',status: 'result_pending' })
    expect(data.notifications).toHaveLength(1)
    expect(data.notifications[0]?.title).toContain('kontrol bekliyor')
    const message = (await pool.query('SELECT id,tramer_id,reason,status FROM sbm_messages WHERE connection_id=$1',[c])).rows[0]
    expect(message).toMatchObject({ tramer_id: data.tramer[0]!.id,reason: 'number_registered_after_message',status: 'review' })
    const applied = await app.inject({ method: 'POST',url: `/api/v1/tracking/sbm/${message.id}/review`,headers: { cookie: managerCookie },payload: { action: 'apply',applicationNumber: '000311',resultStatus: 'completed',note: 'Erken gelen sonuç doğrulandı.' } })
    expect(applied.statusCode,applied.payload).toBe(204)
    expect((await snapshot(ownerCookie,id)).tramer[0]?.status).toBe('completed')
  })

  it('never turns an entry notice or an untrusted message into an owner result alert',async () => {
    const id = await createCase();await submit(id,'000312')
    const c = await connection('non-result-alert@office.example')
    for (const reason of ['non_result_notification','untrusted_sender']) await ingestSbmResult(pool,{ connectionId: c,messageId: reason,receivedAt: new Date(),automatic: true,result: { applicationNumber: '000312',status: null,text: reason,evidenceHash: 'e'.repeat(64),reason } })
    const data = await snapshot(ownerCookie,id)
    expect(data.tramer[0]?.status).toBe('result_pending')
    expect(data.notifications).toHaveLength(0)
  })

  it('does not lose an alert when number registration and result ingestion happen concurrently',async () => {
    const id = await createCase(),c = await connection('simultaneous-result@office.example')
    expect((await command(id,{ action: 'assign',assignedUserId: operator })).statusCode).toBe(204)
    const result = { applicationNumber: '000313',status: 'completed' as const,text: 'Sonuç: Tamamlandı',evidenceHash: 'f'.repeat(64),reason: null }
    const [saved] = await Promise.all([
      command(id,{ action: 'number',applicationNumber: '000313',expectedVersion: 1 },operatorCookie),
      ingestSbmResult(pool,{ connectionId: c,messageId: 'simultaneous-result',receivedAt: new Date(),result,automatic: true }),
    ])
    expect(saved.statusCode,saved.payload).toBe(204)
    const data = await snapshot(ownerCookie,id)
    expect(data.notifications).toHaveLength(1)
    expect(['completed','result_pending']).toContain(data.tramer[0]?.status)
    expect((await pool.query('SELECT tramer_id FROM sbm_messages WHERE connection_id=$1',[c])).rows[0].tramer_id).toBe(data.tramer[0]!.id)
  })

  it('infers new and existing photo types while preserving owner approval and document requirements',async () => {
    const caseId = await createCase()
    await pool.query("INSERT INTO storage_roots(id,organization_id,root_key,label) VALUES($1,$2,'photo-root','Photos')", [uuidv7(),org])
    await pool.query("INSERT INTO case_locations(id,organization_id,case_id,storage_root_key,relative_path) VALUES($1,$2,$3,'photo-root','case-photos')", [uuidv7(),org,caseId])
    const names = ['OLAY YERİ/IMG001.jpg', 'VİTES.jpg', 'KM.jpg', 'HASAR/IMG001.jpg']
    for (const [index,name] of names.entries()) await observeFile(pool,org,'test-agent',{ caseId,locationVersion: 1,storageRootKey: 'photo-root',relativePath: `case-photos/${name}`,contentHash: String(index+1).repeat(64),byteSize: 200 })
    const stored = (await pool.query('SELECT o.id,o.document_type FROM document_observations o JOIN tracked_files f ON f.id=o.file_id WHERE f.case_id=$1 ORDER BY f.relative_path', [caseId])).rows
    expect(new Set(stored.map(row => row.document_type))).toEqual(new Set(['accident_scene_photo','gear_photo','odometer_photo','damage_photo']))
    await pool.query('UPDATE document_observations SET document_type=NULL WHERE id=ANY($1::uuid[])', [stored.map(row => row.id)])
    const data = await snapshot(ownerCookie,caseId)
    expect(new Set(data.documents.map(row => row.documentType))).toEqual(new Set(stored.map(row => row.document_type)))
    expect(data.documents.every(row => row.status === 'pending')).toBe(true)
    const photo = data.documents.find(row => row.documentType === 'odometer_photo')!
    const payload = { status: 'approved',documentType: photo.documentType,note: '' }
    expect((await app.inject({ method: 'POST',url: `/api/v1/tracking/documents/${photo.id}/review`,headers: { cookie: operatorCookie },payload })).statusCode).toBe(403)
    expect((await app.inject({ method: 'POST',url: `/api/v1/tracking/documents/${photo.id}/review`,headers: { cookie: ownerCookie },payload })).statusCode).toBe(204)
    expect((await snapshot(ownerCookie,caseId)).documents.find(row => row.id === photo.id)).toMatchObject({ documentType: 'odometer_photo',status: 'approved' })
    const requirements = await app.inject({ method: 'GET',url: `/api/v1/cases/${caseId}/document-requirements`,headers: { cookie: ownerCookie } })
    expect(requirements.statusCode).toBe(200)
    expect(requirements.json().requirements.find((row: { canonicalDocumentType: string }) => row.canonicalDocumentType === 'victim_traffic_policy').status).toBe('missing')
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

  it('preserves document identity and approval across workspace relocation and retires unseen old paths',async () => {
    const caseId = await createCase()
    await pool.query("INSERT INTO storage_roots(id,organization_id,root_key,label) VALUES($1,$2,'relocation-root','Relocation root')", [uuidv7(),org])
    const bind = (relativePath: string,expectedVersion?: number) => app.inject({ method: 'PUT',url: `/api/v1/cases/${caseId}/location`,headers: { cookie: managerCookie },payload: { storageRootKey: 'relocation-root',relativePath,source: 'manual',...(expectedVersion ? { expectedVersion } : {}) } })
    expect((await bind('old-folder')).statusCode).toBe(200)
    const input = { caseId,locationVersion: 1,storageRootKey: 'relocation-root',relativePath: 'old-folder/policy.pdf',contentHash: 'a'.repeat(64),byteSize: 200 }
    await observeFile(pool,org,'test-agent',input)
    await observeFile(pool,org,'test-agent',{ ...input,relativePath: 'old-folder/removed.pdf',contentHash: 'b'.repeat(64) })
    const before = await snapshot(ownerCookie,caseId)
    const original = before.documents.find(d=>d.fileName==='policy.pdf')!
    expect((await app.inject({ method: 'POST',url: `/api/v1/tracking/documents/${original.id}/review`,headers: { cookie: ownerCookie },payload: { status: 'approved',documentType: 'victim_traffic_policy',note: 'Reviewed before move' } })).statusCode).toBe(204)
    expect((await bind('new-folder',1)).statusCode).toBe(200)
    expect((await bind('new-folder',2)).statusCode).toBe(200)
    const moved = { ...input,locationVersion: 3,relativePath: 'new-folder/policy.pdf' }
    expect(await observeFile(pool,org,'test-agent',moved)).toEqual({ changed: false })
    const after = await snapshot(ownerCookie,caseId)
    expect(after.documents.find(d=>d.fileName==='policy.pdf')).toMatchObject({ id: original.id,status: 'approved' })
    expect((await pool.query('SELECT revision FROM tracked_files WHERE case_id=$1 AND relative_path=$2',[caseId,moved.relativePath])).rows[0].revision).toBe(1)
    expect(after.notifications).toHaveLength(before.notifications.length)
    await reconcileFiles(pool,org,{ caseId,locationVersion: 3,scanStartedAt: new Date().toISOString(),paths: [moved.relativePath] })
    const remaining = await snapshot(ownerCookie,caseId)
    expect(remaining.documents).toHaveLength(1)
    expect(remaining.documents[0]?.id).toBe(original.id)
    expect((await pool.query('SELECT count(*)::int n FROM document_observations o JOIN tracked_files f ON f.id=o.file_id WHERE f.case_id=$1',[caseId])).rows[0].n).toBe(2)
    await observeFile(pool,org,'test-agent',{ ...moved,contentHash: 'c'.repeat(64) })
    expect((await snapshot(ownerCookie,caseId)).documents[0]).toMatchObject({ status: 'pending' })
    expect((await pool.query('SELECT revision FROM tracked_files WHERE case_id=$1 AND relative_path=$2',[caseId,moved.relativePath])).rows[0].revision).toBe(2)
  })

  it('retires the previous storage root even when its relative filename matches the new root',async () => {
    const caseId = await createCase()
    for (const rootKey of ['previous-source','current-source']) await pool.query('INSERT INTO storage_roots(id,organization_id,root_key,label) VALUES($1,$2,$3,$3)',[uuidv7(),org,rootKey])
    const bind = (storageRootKey: string,expectedVersion?: number) => app.inject({ method: 'PUT',url: `/api/v1/cases/${caseId}/location`,headers: { cookie: managerCookie },payload: { storageRootKey,relativePath: 'same-folder',source: 'manual',...(expectedVersion ? { expectedVersion } : {}) } })
    expect((await bind('previous-source')).statusCode).toBe(200)
    const input = { caseId,locationVersion: 1,storageRootKey: 'previous-source',relativePath: 'same-folder/policy.pdf',contentHash: 'a'.repeat(64),byteSize: 200 }
    await observeFile(pool,org,'test-agent',input)
    expect((await bind('current-source',1)).statusCode).toBe(200)
    await observeFile(pool,org,'test-agent',{ ...input,locationVersion: 2,storageRootKey: 'current-source' })
    await reconcileFiles(pool,org,{ caseId,locationVersion: 2,scanStartedAt: new Date().toISOString(),paths: [input.relativePath] })
    expect((await snapshot(ownerCookie,caseId)).documents).toHaveLength(1)
    expect((await pool.query('SELECT storage_root_key FROM tracked_files WHERE case_id=$1 AND available',[caseId])).rows).toEqual([{ storage_root_key: 'current-source' }])
  })

  it('retains notifications with the desktop closed and across API restarts; read/presented states are private',async () => {
    // Pending delivers the oldest 20; the full snapshot sorts newest first.
    const before = await app.inject({ method: 'GET',url: '/api/v1/tracking/notifications/pending',headers: { cookie: ownerCookie } })
    expect(before.statusCode).toBe(200)
    const notice = before.json().notifications[0]
    expect(notice).toBeDefined()
    await app.close()
    app = buildApp({ loggerEnabled: false,auth: { pool,cookieSecure: false },google: { ...google,signupOrganizationId: org },googleProvider: provider });await app.ready()
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
    const callback = await app.inject({ method: 'GET',url: `/api/v1/google/callback?state=${flowId}&code=fake` })
    expect(callback.statusCode).toBe(303)
    expect(callback.headers.location).toBe('/api/v1/google/result/web/login/success')
    expect((await app.inject({ method: 'GET',url: `/api/v1/google/callback?state=${flowId}&code=fake` })).headers.location).toBe('/api/v1/google/result/web/login/expired')
    expect((await app.inject({ method: 'POST',url: '/api/v1/google/complete',payload: { flowId } })).statusCode).toBe(400)
    const done = await app.inject({ method: 'POST',url: '/api/v1/google/complete',headers: { cookie: cookie(start) },payload: { flowId } })
    expect(done.json().status).toBe('complete')
    const session = await app.inject({ method: 'GET',url: '/api/v1/auth/session',headers: { cookie: cookie(done) } })
    expect(session.json().user).toMatchObject({ id: manager,roles: ['admin'] })
    expect((await pool.query('SELECT user_id FROM google_identities WHERE subject=$1', ['manager-google'])).rows[0].user_id).toBe(manager)
  })

  it('rejects external/disabled employees and revoked consent without creating identities',async () => {
    for (const email of ['unknown@outside.example','disabled@office.example']) {
      if (email.startsWith('disabled')) { const id = await user(org,email,'secretary');await pool.query("UPDATE users SET status='disabled' WHERE id=$1", [id]) }
      loginIdentity = { email,sub: email }
      const start = await app.inject({ method: 'POST',url: '/api/v1/google/start',payload: { purpose: 'login' } })
      const flowId = start.json().flowId as string
      const callback = await app.inject({ method: 'GET',url: `/api/v1/google/callback?state=${flowId}&code=fake` })
      expect(callback.statusCode).toBe(303)
      expect(callback.headers.location).toBe(`/api/v1/google/result/web/login/${email.startsWith('disabled') ? 'denied' : 'failed'}`)
    }
    const start = await app.inject({ method: 'POST',url: '/api/v1/google/start',payload: { purpose: 'login' } })
    expect((await app.inject({ method: 'GET',url: `/api/v1/google/callback?state=${start.json().flowId}&error=access_denied` })).headers.location).toBe('/api/v1/google/result/web/login/denied')
    expect((await pool.query('SELECT count(*)::int AS n FROM google_identities')).rows[0].n).toBe(1)
    loginIdentity = { email: 'manager@office.example',sub: 'manager-google' }
  })

  it('registers verified corporate accounts pending approval and issues a session only after admin role assignment',async () => {
    loginIdentity = { email: 'new.employee@office.example',sub: 'new-employee-google' }
    async function googleLogin(outcome = 'approval') {
      const start = await app.inject({ method: 'POST',url: '/api/v1/google/start',payload: { purpose: 'login' } })
      expect(start.statusCode,start.payload).toBe(200)
      const callback = await app.inject({ method: 'GET',url: `/api/v1/google/callback?state=${start.json().flowId}&code=fake` })
      expect(callback.statusCode).toBe(303)
      expect(callback.headers.location).toBe(`/api/v1/google/result/web/login/${outcome}`)
      return app.inject({ method: 'POST',url: '/api/v1/google/complete',headers: { cookie: cookie(start) },payload: { flowId: start.json().flowId } })
    }
    const pending = await googleLogin()
    expect(pending.json()).toEqual({ status: 'approval_required' })
    expect(pending.headers['set-cookie']).toBeUndefined()
    const newUser = (await pool.query('SELECT * FROM users WHERE email=$1',[loginIdentity.email])).rows[0]
    expect(newUser).toMatchObject({ organization_id: org,status: 'pending',password_hash: null })
    const listed = await app.inject({ method: 'GET',url: '/api/v1/users?includePending=true',headers: { cookie: managerCookie } })
    expect(listed.statusCode,listed.payload).toBe(200)
    expect(listed.json().items.find((u: { id: string }) => u.id === newUser.id)).toMatchObject({ status: 'pending',roles: [] })
    const approval = await app.inject({ method: 'PATCH',url: `/api/v1/users/${newUser.id}/roles`,headers: { cookie: managerCookie },payload: { roles: ['case_manager'],expectedVersion: 1 } })
    expect(approval.statusCode,approval.payload).toBe(200)
    expect(approval.json().user).toMatchObject({ status: 'active',roles: ['case_manager'] })
    const approved = await googleLogin('success')
    expect(approved.json().status).toBe('complete')
    expect((await app.inject({ method: 'GET',url: '/api/v1/auth/session',headers: { cookie: cookie(approved) } })).json().user.roles).toEqual(['case_manager'])
    expect((await app.inject({ method: 'POST',url: '/api/v1/auth/login',payload: { email: loginIdentity.email,password } })).statusCode).toBe(401)
    loginIdentity = { email: 'manager@office.example',sub: 'manager-google' }
  })

  it('connects mail separately, encrypts refresh permission and records source account without changing file ownership',async () => {
    const denied = await app.inject({ method: 'POST',url: '/api/v1/google/start',headers: { cookie: operatorCookie },payload: { purpose: 'mail' } })
    expect(denied.statusCode).toBe(403)
    loginIdentity = { email: 'sbm-inbox@office.example',sub: 'sbm-inbox-google' }
    const start = await app.inject({ method: 'POST',url: '/api/v1/google/start',headers: { cookie: managerCookie },payload: { purpose: 'mail' } })
    expect(start.statusCode,start.payload).toBe(200)
    const callback = await app.inject({ method: 'GET',url: `/api/v1/google/callback?state=${start.json().flowId}&code=fake` })
    expect(callback.statusCode).toBe(303)
    expect(callback.headers.location).toBe('/api/v1/google/result/web/mail/success')
    const row = (await pool.query("SELECT * FROM mail_connections WHERE subject='sbm-inbox-google'")).rows[0]
    expect(row.status).toBe('connected');expect(row.encrypted_refresh_token).not.toContain('refresh')
    const done = await app.inject({ method: 'POST',url: '/api/v1/google/complete',headers: { cookie: `${managerCookie}; ${cookie(start)}` },payload: { flowId: start.json().flowId } })
    expect(done.json().status).toBe('complete');expect(done.headers['set-cookie']).toBeUndefined()
    loginIdentity = { email: 'manager@office.example',sub: 'manager-google' }
  })

  it('refuses a mailbox callback when its initiating user lost permission during consent',async () => {
    loginIdentity = { email: 'revoked-flow@office.example',sub: 'revoked-flow' }
    const start = await app.inject({ method: 'POST',url: '/api/v1/google/start',headers: { cookie: ownerCookie },payload: { purpose: 'mail' } })
    expect(start.statusCode,start.payload).toBe(200)
    const policy = defaultRolePolicy()
    await pool.query('INSERT INTO organization_role_policies(organization_id,version,permissions) VALUES($1,1,$2)',[org,JSON.stringify({ ...policy.permissions,tracking_write: ['admin'] })])
    try {
      const callback = await app.inject({ method: 'GET',url: `/api/v1/google/callback?state=${start.json().flowId}&code=fake` })
      expect(callback.statusCode,callback.payload).toBe(303)
      expect(callback.headers.location).toBe('/api/v1/google/result/web/mail/denied')
      expect((await pool.query("SELECT count(*)::int AS n FROM mail_connections WHERE subject='revoked-flow'")).rows[0].n).toBe(0)
    } finally {
      await pool.query('DELETE FROM organization_role_policies WHERE organization_id=$1',[org])
      loginIdentity = { email: 'manager@office.example',sub: 'manager-google' }
    }
  })

  it('records permission loss; catches up after recovery; processes messages only once',async () => {
    await pool.query("UPDATE mail_connections SET status='disconnected'")
    const c = await connection('recovery@office.example')
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
