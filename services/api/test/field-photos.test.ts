import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import pg from 'pg'
import { createHash, randomUUID } from 'node:crypto'
import { fork } from 'node:child_process'
import { createServer, request as httpRequest } from 'node:http'
import { fileURLToPath } from 'node:url'
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { assertTestDatabaseUrl, runMigrations, uuidv7 } from '@hasarbotu/database'
import { buildApp, hashPassword } from '../src/index.js'
import { hashAgentSecret } from '../src/agent/auth.js'
import { nextFieldPhotoName, runFieldPhotoOnce } from '../../file-agent/dist/field-photo-worker.js'
import { createFieldPhotoStore } from '../src/field-photos/store.js'
import { hasActiveFieldPhoto } from '../src/field-photos/active.js'
import { createGoogleProvider, validateGoogleClaims, type GoogleConfig } from '../src/tracking/google.js'

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
describe.skipIf(!process.env.TEST_DATABASE_URL)('real resumable field photos', () => {
  let pool: pg.Pool, app: FastifyInstance, work: string, originalDirectory: string, physicalRoot: string, caseId: string, org: string, origin: string
  const users: { id: string; cookie: string }[] = []
  const agentId = uuidv7(), agentSecret = 'synthetic-photo-agent-secret-only'
  const relativePath = '2026 OFİS/Ekim 2026/34ABC123'
  let jpeg: Buffer
  let foreignCookie: string
  const google: GoogleConfig = { clientId: 'field-synthetic-client', clientSecret: 'synthetic-only', redirectUri: 'https://field.example.test/api/v1/google/callback', encryptionKey: 'a'.repeat(64), loginDomain: 'example.test', sbmSenders: [], automaticSbmEnabled: false }
  const agent = () => ({ id: agentId, organizationId: org })
  const request = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object, cookie = users[0]!.cookie, extra = {}) => app.inject({ method, url, headers: { cookie, ...extra }, ...(payload === undefined ? {} : { payload }) })
  const init = async (bytes = jpeg, kind = 'damage', clientKey = randomUUID()) => (await request('POST', `/api/v1/field/cases/${caseId}/uploads`, { fileName: 'camera.jpg', kind, clientKey, byteSize: bytes.length, contentHash: digest(bytes) })).json()
  const receive = async (bytes = jpeg, kind = 'damage') => {
    const upload = await init(bytes, kind)
    expect((await request('PUT', `/api/v1/field/uploads/${upload.id}/chunk?offset=0`, bytes, undefined, { 'content-type': 'application/octet-stream' })).statusCode).toBe(200)
    expect((await request('POST', `/api/v1/field/uploads/${upload.id}/finish`)).json().status).toBe('queued')
    return upload
  }
  beforeAll(async () => {
    const config = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL!)
    pool = new pg.Pool({ connectionString: config.url })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    work = await mkdtemp(join(tmpdir(), 'hb-field-api-')); originalDirectory = join(work, 'private-originals'); physicalRoot = join(work, 'physical-root')
    await mkdir(join(physicalRoot, relativePath), { recursive: true })
    app = buildApp({ loggerEnabled: false, fieldPhotoDirectory: originalDirectory, auth: { pool, cookieSecure: false, loginRateLimit: { limit: 100, windowMs: 60000 } }, google,
      googleProvider: { ...createGoogleProvider(google), exchange: async () => ({ access_token: 'synthetic-only', id_token: 'synthetic-only' }),
        identity: async (_jwt, nonce, corporate) => validateGoogleClaims({ iss: 'https://accounts.google.com', aud: google.clientId, exp: Date.now()/1000+600, iat: Date.now()/1000, nonce, email_verified: true, email: 'field-1@example.test', sub: 'synthetic-field-google', hd: 'example.test' }, google.clientId, nonce, corporate ? google.loginDomain : undefined) } })
    org = uuidv7(); caseId = uuidv7()
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,'field-photos','Synthetic')", [org])
    const passwordHash = await hashPassword('Synthetic-Field-Password-42!')
    for (const [i, role] of ['expert','secretary','read_only'].entries()) {
      const id = uuidv7(), email = `field-${i}@example.test`
      await pool.query('INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,$3,$4,$5)', [id, org, email, `Synthetic User ${i}`, passwordHash])
      await pool.query('INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code=$2', [id, role])
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'Synthetic-Field-Password-42!' } })
      users.push({ id, cookie: String(login.headers['set-cookie']).split(';')[0]! })
    }
    const foreignOrg = uuidv7(), foreignUser = uuidv7()
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,'field-foreign','Synthetic foreign')", [foreignOrg])
    await pool.query("INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,'field-foreign@example.test','Synthetic foreign',$3)", [foreignUser, foreignOrg, passwordHash])
    await pool.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code='expert'", [foreignUser])
    const foreignLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'field-foreign@example.test', password: 'Synthetic-Field-Password-42!' } })
    foreignCookie = String(foreignLogin.headers['set-cookie']).split(';')[0]!
    await pool.query("INSERT INTO storage_roots(id,organization_id,root_key,label) VALUES($1,$2,'office','Synthetic')", [uuidv7(), org])
    await pool.query("INSERT INTO cases(id,organization_id,office_year,office_sequence,office_number,plate,plate_normalized,workflow_stage) VALUES($1,$2,2026,1,'2026/1','34 ABC 123','34ABC123','reporting')", [caseId, org])
    await pool.query("INSERT INTO case_locations(id,organization_id,case_id,storage_root_key,relative_path,verification_status) VALUES($1,$2,$3,'office',$4,'verified')", [uuidv7(), org, caseId, relativePath])
    await pool.query("INSERT INTO agents(id,organization_id,name,secret_hash) VALUES($1,$2,'Synthetic photo worker',$3)", [agentId, org, hashAgentSecret(agentSecret)])
    const canvas = createCanvas(640, 480); canvas.getContext('2d').fillRect(0, 0, 640, 480); jpeg = await canvas.encode('jpeg', 95)
    origin = await app.listen({ host: '127.0.0.1', port: 0 })
  }, 60000)
  afterAll(async () => { await app?.close(); await pool?.end(); if (work) await rm(work, { recursive: true, force: true }) })
  it('requires login, upload role and office scope without exposing other organizations', async () => {
    expect((await request('GET', '/api/v1/field/cases?q=34', undefined, '')).statusCode).toBe(401)
    expect((await request('GET', '/api/v1/field/cases?q=34', undefined, users[2]!.cookie)).statusCode).toBe(403)
    expect((await request('GET', '/api/v1/field/cases?q=34%20abc')).json().items).toEqual([expect.objectContaining({ id: caseId, plate: '34 ABC 123', canUpload: true })])
    expect((await request('GET', `/api/v1/field/cases/${uuidv7()}/photos`)).statusCode).toBe(404)
    expect((await request('POST', '/api/v1/field-agent/uploads/claim')).statusCode).toBe(401)
    expect((await request('GET', '/api/v1/field/cases?q=34', undefined, foreignCookie)).json().items).toEqual([])
    expect((await request('GET', `/api/v1/field/cases/${caseId}/photos`, undefined, foreignCookie)).statusCode).toBe(404)
  })
  it('asks explicitly before setting a persistent login cookie and keeps legacy clients compatible', async () => {
    for (const rememberMe of [false, true, undefined]) {
      const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'field-0@example.test', password: 'Synthetic-Field-Password-42!', ...(rememberMe === undefined ? {} : { rememberMe }) } })
      expect(response.statusCode).toBe(200)
      const cookie = String(response.headers['set-cookie'])
      expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Strict')
      expect(cookie.includes('Max-Age=')).toBe(rememberMe !== false)
    }
  })
  it('supports Google-only accounts with browser-bound flow, unchanged roles and explicit cookie consent', async () => {
    await pool.query('UPDATE users SET password_hash=NULL WHERE id=$1', [users[1]!.id])
    expect((await request('GET', '/api/v1/auth/session', undefined, users[1]!.cookie)).statusCode).toBe(401)
    for (const rememberMe of [false, true]) {
      const start = await request('POST', '/api/v1/google/start', { purpose: 'login' }, '')
      expect(start.statusCode).toBe(200)
      const flowId = start.json().flowId, browserCookie = String(start.headers['set-cookie']).split(';')[0]!
      expect(new URL(start.json().url).searchParams.get('redirect_uri')).toBe(google.redirectUri)
      expect((await request('POST', '/api/v1/google/complete', { flowId, rememberMe }, '')).statusCode).toBe(400)
      const callback = await request('GET', `/api/v1/google/callback?state=${flowId}&code=synthetic`)
      expect(callback.statusCode).toBe(303)
      expect(callback.headers.location).toBe('/api/v1/google/result/web/login/success')
      const complete = await request('POST', '/api/v1/google/complete', { flowId, rememberMe }, browserCookie)
      expect(complete.statusCode).toBe(200)
      const cookie = String(complete.headers['set-cookie'])
      expect(cookie.includes('Max-Age=')).toBe(rememberMe)
      const session = await request('GET', '/api/v1/auth/session', undefined, cookie.split(';')[0]!)
      expect(session.json().user).toMatchObject({ id: users[1]!.id, roles: ['secretary'] })
      expect(session.json().expiresAt).toBeNull()
      expect(String(session.headers['set-cookie']).includes('Max-Age=')).toBe(rememberMe)
      users[1]!.cookie = cookie.split(';')[0]!
      expect((await request('POST', '/api/v1/google/complete', { flowId, rememberMe }, browserCookie)).statusCode).toBe(400)
    }
  })
  it('resumes identical chunks, recovers uncommitted bytes and refuses altered or foreign writes', async () => {
    const key = randomUUID(), upload = await init(jpeg, 'damage', key)
    expect((await init(jpeg, 'damage', key)).id).toBe(upload.id)
    expect((await request('POST', `/api/v1/field/cases/${caseId}/uploads`, { fileName: 'other.jpg', clientKey: key, kind: 'damage', byteSize: 10, contentHash: '0'.repeat(64) })).statusCode).toBe(409)
    expect((await request('POST', `/api/v1/field/uploads/${upload.id}/finish`)).statusCode).toBe(409)
    const first = jpeg.subarray(0, 100)
    const chunk = (offset: number, bytes: Buffer, cookie?: string) => request('PUT', `/api/v1/field/uploads/${upload.id}/chunk?offset=${offset}`, bytes, cookie, { 'content-type': 'application/octet-stream' })
    expect((await chunk(10, first)).statusCode).toBe(409)
    expect((await chunk(0, first)).json().receivedBytes).toBe(100)
    expect((await chunk(0, first)).json().receivedBytes).toBe(100)
    expect((await chunk(0, Buffer.alloc(100))).statusCode).toBe(409)
    expect((await chunk(100, jpeg.subarray(100), users[1]!.cookie)).statusCode).toBe(404)
    expect((await chunk(100, jpeg.subarray(100), foreignCookie)).statusCode).toBe(404)
    await writeFile(join(originalDirectory, `${upload.id}.bin`), Buffer.concat([first, Buffer.from('uncommitted crash bytes')]))
    expect((await chunk(100, jpeg.subarray(100))).json().receivedBytes).toBe(jpeg.length)
    expect((await request('POST', `/api/v1/field/uploads/${upload.id}/finish`)).json().status).toBe('queued')
    expect(await readFile(join(originalDirectory, `${upload.id}.bin`))).toEqual(jpeg)
    await pool.query("UPDATE field_photo_uploads SET status='failed' WHERE id=$1", [upload.id])
  })
  it('allows only the uploader to cancel an incomplete transfer and can resume it explicitly', async () => {
    const key = randomUUID(), upload = await init(jpeg, 'damage', key)
    expect((await request('POST', `/api/v1/field/uploads/${upload.id}/cancel`, undefined, users[1]!.cookie)).statusCode).toBe(404)
    expect((await request('POST', `/api/v1/field/uploads/${upload.id}/cancel`)).statusCode).toBe(200)
    expect((await request('POST', `/api/v1/field/uploads/${upload.id}/cancel`)).statusCode).toBe(200)
    expect((await init(jpeg, 'damage', key))).toMatchObject({ id: upload.id, status: 'receiving', errorCode: null })
    await request('POST', `/api/v1/field/uploads/${upload.id}/cancel`)
  })
  it('serializes claims and blocks location mutation while a photo is being published', async () => {
    await receive(); await receive()
    const store = createFieldPhotoStore(pool, originalDirectory)
    const jobs = await Promise.all([store.claim(agent()), store.claim(agent())])
    expect(jobs.filter(Boolean)).toHaveLength(1)
    expect(await hasActiveFieldPhoto(pool, org, caseId)).toBe(true)
    const response = await app.inject({ method: 'PUT', url: `/api/v1/cases/${caseId}/location`, headers: { cookie: users[0]!.cookie }, payload: { storageRootKey: 'office', relativePath, expectedVersion: 1 } })
    expect([403,409]).toContain(response.statusCode)
    const job = jobs.find(Boolean)!
    await expect(store.prepare(agent(), job.id, { leaseToken: randomUUID(), fileName: 'HASAR 101.jpg', byteSize: 102400, contentHash: 'a'.repeat(64), width: 640, height: 480 })).rejects.toThrow('lease_lost')
    await pool.query("UPDATE field_photo_uploads SET status='failed',lease_expires_at=NULL WHERE status IN ('queued','processing')")
  })
  it('runs the real worker, preserves originals and existing files, and publishes verified JPEG metadata', async () => {
    const folder = join(physicalRoot, relativePath), existing = Buffer.from('pre-existing user file')
    await writeFile(join(folder, 'HASAR 101.jpg'), existing)
    await writeFile(join(folder, 'HASAR 103.JPG'), existing)
    const upload = await receive()
    const gate = join(work, 'fixture-freshness.mjs')
    await writeFile(gate, "import {readdirSync} from 'node:fs';import {dirname} from 'node:path';const args=process.argv.slice(2);const target=args[args.indexOf('--case-relative-path')+1];const folder=dirname(args[args.indexOf('--target-root')+1]);const ready=args[args.indexOf('--operation')+1]==='file_destination'&&target.endsWith('/HASAR 104.jpg')&&!readdirSync(folder).some(name=>name.startsWith('.hb-'));console.log(JSON.stringify({CaseStatus:ready?'ready':'unknown'}));process.exitCode=ready?0:1\n")
    const config = { apiBaseUrl: origin, agentId, agentSecret, roots: { office: physicalRoot }, leaseSeconds: 120, pollIntervalMs: 100,
      freshnessGate: { toolPath: gate, pcloudLocalDatabasePath: join(work, 'fixture.db'), topLevelFolderName: 'Synthetic', attestationStoreDirectory: work } }
    expect(await runFieldPhotoOnce(config)).toBe(true)
    const list = (await request('GET', `/api/v1/field/cases/${caseId}/photos`)).json().items
    expect(list.find((item: { id: string }) => item.id === upload.id)).toMatchObject({ status: 'ready', outputFileName: 'HASAR 104.jpg', outputBytes: 102400 })
    const saved = await readFile(join(folder, 'HASAR 104.jpg'))
    expect(saved.subarray(0, 2)).toEqual(Buffer.from([255,216]))
    expect(await readFile(join(folder, 'HASAR 101.jpg'))).toEqual(existing)
    expect(await readFile(join(originalDirectory, `${upload.id}.bin`))).toEqual(jpeg)
    const photo = (await pool.query('SELECT status,hash_verified,size_verified,byte_size,content_hash FROM photos WHERE case_id=$1', [caseId])).rows[0]
    expect(photo).toMatchObject({ status: 'ready', hash_verified: true, size_verified: true, content_hash: digest(saved) })
    expect((await request('GET', `/api/v1/field/uploads/${upload.id}/original`)).rawPayload).toEqual(jpeg)
    expect((await request('GET', `/api/v1/field/uploads/${upload.id}/jpeg`)).rawPayload).toEqual(saved)
    expect((await readdir(folder)).some(name => name.endsWith('.tmp'))).toBe(false)
    expect((await pool.query("SELECT count(*)::int n FROM audit_events WHERE action='photo.upload_published' AND actor_user_id=$1", [users[0]!.id])).rows[0].n).toBe(1)
    expect(await runFieldPhotoOnce(config)).toBe(false)
  }, 60000)
  it('retains a failed original and never marks invalid image bytes ready', async () => {
    const upload = await receive(Buffer.from('This is not an image'), 'chassis')
    const config = { apiBaseUrl: origin, agentId, agentSecret, roots: { office: physicalRoot }, leaseSeconds: 120, pollIntervalMs: 100, freshnessGate: undefined }
    expect(await runFieldPhotoOnce(config)).toBe(true)
    const row = (await pool.query('SELECT status,last_error_code,photo_id FROM field_photo_uploads WHERE id=$1', [upload.id])).rows[0]
    expect(row).toMatchObject({ status: 'failed', last_error_code: 'unsupported_image', photo_id: null })
    expect(await readFile(join(originalDirectory, `${upload.id}.bin`))).toEqual(Buffer.from('This is not an image'))
  }, 60000)
  it('lets the user explicitly resume a recoverable office transfer without reuploading the original', async () => {
    const upload = await receive()
    await pool.query("UPDATE field_photo_uploads SET status='failed',last_error_code='storage_unavailable',attempt_count=10 WHERE id=$1", [upload.id])
    expect((await request('POST', `/api/v1/field/uploads/${upload.id}/retry`)).statusCode).toBe(200)
    expect((await request('POST', `/api/v1/field/uploads/${upload.id}/retry`)).statusCode).toBe(200)
    expect((await pool.query('SELECT status,received_bytes,attempt_count FROM field_photo_uploads WHERE id=$1', [upload.id])).rows[0]).toEqual({ status: 'queued', received_bytes: jpeg.length, attempt_count: 0 })
    expect(await readFile(join(originalDirectory, `${upload.id}.bin`))).toEqual(jpeg)
  })
  it.each(['damage', 'chassis', 'odometer'] as const)('skips reserved %s names from interrupted uploads without changing the case location', async kind => {
    await pool.query("UPDATE field_photo_uploads SET status='failed',lease_expires_at=NULL WHERE status IN ('queued','processing')")
    const folder = join(physicalRoot, relativePath)
    const store = createFieldPhotoStore(pool, originalDirectory)
    const reserved: string[] = []
    for (let index = 0; index < 2; index++) {
      const upload = await receive(jpeg, kind)
      const job = (await store.claim(agent()))!
      expect(job.id).toBe(upload.id)
      const fileName = nextFieldPhotoName(kind, [...await readdir(folder), ...reserved])
      reserved.push(fileName)
      await store.prepare(agent(), upload.id, { leaseToken: job.leaseToken, fileName, byteSize: 102400, contentHash: 'a'.repeat(64), width: 1000, height: 1000 })
      await store.reportFailure(agent(), upload.id, job.leaseToken, 'photo_write_failed', false)
      await expect(readFile(join(folder, fileName))).rejects.toMatchObject({ code: 'ENOENT' })
    }
    const upload = await receive(jpeg, kind)
    const gate = join(work, 'reserved-name-freshness.mjs')
    await writeFile(gate, "import {existsSync} from 'node:fs';const args=process.argv.slice(2);const ready=args[args.indexOf('--operation')+1]==='file_destination'&&!existsSync(args[args.indexOf('--target-root')+1]);console.log(JSON.stringify({CaseStatus:ready?'ready':'unknown'}));process.exitCode=ready?0:1\n")
    const config = { apiBaseUrl: origin, agentId, agentSecret, roots: { office: physicalRoot }, leaseSeconds: 120, pollIntervalMs: 100,
      freshnessGate: { toolPath: gate, pcloudLocalDatabasePath: join(work, 'fixture.db'), topLevelFolderName: 'Synthetic', attestationStoreDirectory: work } }
    expect(await runFieldPhotoOnce(config)).toBe(true)
    const row = (await pool.query('SELECT status,output_file_name,last_error_code FROM field_photo_uploads WHERE id=$1', [upload.id])).rows[0]
    expect(row).toMatchObject({ status: 'ready', last_error_code: null })
    expect(reserved).not.toContain(row.output_file_name)
    expect((await readFile(join(folder, row.output_file_name))).subarray(0, 2)).toEqual(Buffer.from([255,216]))
    expect(await readFile(join(originalDirectory, `${upload.id}.bin`))).toEqual(jpeg)
  }, 60000)
  it('recovers a real worker process terminated after physical publication without duplicating the photo', async () => {
    await pool.query("UPDATE field_photo_uploads SET status='failed',lease_expires_at=NULL WHERE status IN ('queued','processing')")
    const upload = await receive()
    const folder = join(physicalRoot, relativePath)
    const gate = join(work, 'process-recovery-freshness.mjs')
    await writeFile(gate, 'console.log(JSON.stringify({CaseStatus:"ready"}))\n')
    const temporary = join(work, 'worker-temporary')
    await mkdir(temporary)
    const config = { apiBaseUrl: origin, agentId, agentSecret, roots: { office: physicalRoot }, leaseSeconds: 120, pollIntervalMs: 100,
      freshnessGate: { toolPath: gate, pcloudLocalDatabasePath: join(work, 'fixture.db'), topLevelFolderName: 'Synthetic', attestationStoreDirectory: work } }
    let publicationReached!: () => void
    const published = new Promise<void>(done => { publicationReached = done })
    const proxy = createServer((incoming, outgoing) => {
      if (incoming.url === `/api/v1/field-agent/uploads/${upload.id}/complete`) {
        publicationReached()
        incoming.socket.destroy()
        return
      }
      const upstream = httpRequest(origin + incoming.url, { method: incoming.method, headers: incoming.headers }, response => {
        outgoing.writeHead(response.statusCode!, response.headers)
        response.pipe(outgoing)
      })
      upstream.on('error', () => { outgoing.destroy() })
      incoming.pipe(upstream)
    })
    await new Promise<void>(done => proxy.listen(0, '127.0.0.1', done))
    const address = proxy.address() as { port: number }
    const worker = fork(fileURLToPath(new URL('../test-support/field-photo-process.mjs', import.meta.url)), [], {
      env: { ...process.env, TEMP: temporary, TMP: temporary }, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    const exited = new Promise<void>(done => worker.once('exit', () => done()))
    try {
      worker.send({ ...config, apiBaseUrl: `http://127.0.0.1:${address.port}` })
      await Promise.race([published, exited.then(() => { throw new Error('worker exited before publication') })])
      worker.kill()
      await exited
      const interrupted = (await pool.query('SELECT status,output_file_name,output_hash,photo_id FROM field_photo_uploads WHERE id=$1', [upload.id])).rows[0]
      expect(interrupted).toMatchObject({ status: 'processing', photo_id: null })
      const before = await readFile(join(folder, interrupted.output_file_name))
      expect(digest(before)).toBe(interrupted.output_hash)
      // Advance the persisted lease deadline instead of waiting three minutes.
      await pool.query("UPDATE field_photo_uploads SET lease_expires_at=now()-interval '1 second' WHERE id=$1", [upload.id])
      expect(await runFieldPhotoOnce(config)).toBe(true)
      const recovered = (await pool.query('SELECT status,output_file_name,output_hash,photo_id,attempt_count FROM field_photo_uploads WHERE id=$1', [upload.id])).rows[0]
      expect(recovered).toMatchObject({ status: 'ready', output_file_name: interrupted.output_file_name, output_hash: interrupted.output_hash, attempt_count: 2 })
      expect(recovered.photo_id).not.toBeNull()
      expect(await readFile(join(folder, recovered.output_file_name))).toEqual(before)
      expect(await readFile(join(originalDirectory, `${upload.id}.bin`))).toEqual(jpeg)
      expect((await pool.query('SELECT 1 FROM photos WHERE id=$1', [recovered.photo_id])).rowCount).toBe(1)
      expect((await pool.query("SELECT 1 FROM audit_events WHERE action='photo.upload_published' AND details->>'uploadId'=$1", [upload.id])).rowCount).toBe(1)
      expect((await readdir(folder)).some(name => name.startsWith('.hb-'))).toBe(false)
    } finally {
      if (worker.exitCode === null && worker.signalCode === null) { worker.kill(); await exited }
      proxy.closeAllConnections()
      await new Promise<void>(done => proxy.close(() => done()))
    }
  }, 60000)

  it('preserves queued original bytes across loss and restoration of the physical storage root', async () => {
    await pool.query("UPDATE field_photo_uploads SET status='failed',lease_expires_at=NULL WHERE status IN ('queued','processing')")
    const upload = await receive()
    const gate = join(work, 'storage-recovery-freshness.mjs')
    await writeFile(gate, 'console.log(JSON.stringify({CaseStatus:"ready"}))\n')
    const config = { apiBaseUrl: origin, agentId, agentSecret, roots: { office: physicalRoot }, leaseSeconds: 120, pollIntervalMs: 100,
      freshnessGate: { toolPath: gate, pcloudLocalDatabasePath: join(work, 'fixture.db'), topLevelFolderName: 'Synthetic', attestationStoreDirectory: work } }
    const offline = join(work, 'offline-root')
    await rename(physicalRoot, offline)
    try {
      expect(await runFieldPhotoOnce(config)).toBe(true)
      expect((await pool.query('SELECT status,last_error_code,photo_id FROM field_photo_uploads WHERE id=$1', [upload.id])).rows[0])
        .toEqual({ status: 'queued', last_error_code: 'photo_write_failed', photo_id: null })
      expect(await readFile(join(originalDirectory, `${upload.id}.bin`))).toEqual(jpeg)
    } finally { await rename(offline, physicalRoot) }
    await pool.query('UPDATE field_photo_uploads SET next_attempt_at=now() WHERE id=$1', [upload.id])
    expect(await runFieldPhotoOnce(config)).toBe(true)
    const row = (await pool.query('SELECT status,output_file_name,output_hash FROM field_photo_uploads WHERE id=$1', [upload.id])).rows[0]
    expect(row.status).toBe('ready')
    expect(digest(await readFile(join(physicalRoot, relativePath, row.output_file_name)))).toBe(row.output_hash)
    expect((await pool.query("SELECT 1 FROM audit_events WHERE action='photo.upload_published' AND details->>'uploadId'=$1", [upload.id])).rowCount).toBe(1)
  }, 60000)
})
