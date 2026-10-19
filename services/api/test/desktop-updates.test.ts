import { afterAll, beforeAll, expect, it, describe } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type pg from 'pg'
import type { FastifyInstance } from 'fastify'
import { assertTestDatabaseUrl, createDatabasePool, closeDatabasePool, runMigrations, uuidv7 } from '@hasarbotu/database'
import { buildApp, hashPassword } from '../src/index.js'

describe.skipIf(!process.env.TEST_DATABASE_URL)('authenticated desktop release distribution', () => {
  let pool: pg.Pool, app: FastifyInstance, directory: string, cookie: string
  let inFlight = 0, drained: (() => void) | undefined
  const bytes = Buffer.from('MZsynthetic-install-artifact'), hash = createHash('sha256').update(bytes).digest('hex')
  const release = { version: '0.1.8', platform: 'win32', arch: 'x64', sha256: hash, size: bytes.length, publishedAt: '2026-10-14T00:00:00Z', notes: 'Dosya aşamaları, kapanış ve gerçek taşıma: ÇĞİÖŞÜ çğıöşü.' }
  beforeAll(async () => {
    const config = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL!)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    directory = await mkdtemp(join(tmpdir(), 'hb-releases-test-'))
    app = buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false }, desktopReleasesDirectory: directory })
    app.addHook('onRequest', async () => { inFlight++ })
    app.addHook('onResponse', async () => { inFlight--; if (inFlight === 0) drained?.() })
    const org = uuidv7(), user = uuidv7(), password = 'Update-Fixture-Only-42!'
    await pool.query('INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)', [org, 'update-fixture', 'Synthetic'])
    await pool.query('INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,$3,$4,$5)', [user, org, 'update@example.test', 'Synthetic', await hashPassword(password)])
    await pool.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code='read_only'", [user])
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'update@example.test', password } })
    expect(login.statusCode).toBe(200)
    cookie = String(login.headers['set-cookie']).split(';')[0]!
    await writeFile(join(directory, 'latest.json'), JSON.stringify(release))
    await writeFile(join(directory, hash + '.exe'), bytes)
  }, 60_000)
  afterAll(async () => {
    if (app) { if (inFlight > 0) await new Promise<void>(resolve => { drained = resolve }); await app.close() }
    if (pool) await closeDatabasePool(pool)
    if (directory) await rm(directory, { recursive: true, force: true })
  })
  it('requires login before exposing release metadata or executable', async () => {
    expect((await app.inject('/api/v1/desktop-updates/latest')).statusCode).toBe(401)
    expect((await app.inject('/api/v1/desktop-updates/artifacts/' + hash)).statusCode).toBe(401)
  })
  it('serves the shared release and exactly verified bytes to read-only accounts', async () => {
    expect((await app.inject({ url: '/api/v1/desktop-updates/latest', headers: { cookie } })).json()).toEqual({ release })
    const result = await app.inject({ url: '/api/v1/desktop-updates/artifacts/' + hash, headers: { cookie } })
    expect(result.statusCode).toBe(200)
    expect(result.rawPayload).toEqual(bytes)
    expect(result.headers['content-length']).toBe(String(bytes.length))
  })
  it('does not allow arbitrary paths or unknown artifacts', async () => {
    for (const id of ['not-a-hash', 'a'.repeat(64)]) expect((await app.inject({ url: '/api/v1/desktop-updates/artifacts/' + id, headers: { cookie } })).statusCode).toBe(404)
  })
  it('fails closed when the published file changes, even at the same byte length', async () => {
    const altered = Buffer.from(bytes); altered[2] = 0
    await writeFile(join(directory, hash + '.exe'), altered)
    expect((await app.inject({ url: '/api/v1/desktop-updates/artifacts/' + hash, headers: { cookie } })).statusCode).toBe(503)
    await writeFile(join(directory, hash + '.exe'), bytes)
  })
  it('rejects malformed or path-bearing release metadata', async () => {
    await writeFile(join(directory, 'latest.json'), JSON.stringify({ ...release, file: '../../other.exe' }))
    expect((await app.inject({ url: '/api/v1/desktop-updates/latest', headers: { cookie } })).statusCode).toBe(503)
    await writeFile(join(directory, 'latest.json'), JSON.stringify({ ...release, size: 251 * 1024 * 1024 }))
    expect((await app.inject({ url: '/api/v1/desktop-updates/latest', headers: { cookie } })).statusCode).toBe(503)
  })
})
