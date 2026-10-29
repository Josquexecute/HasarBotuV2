import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { assertTestDatabaseUrl, closeDatabasePool, createDatabasePool, runMigrations, uuidv7 } from '@hasarbotu/database'
import { ACCOUNT_PROFILE_ROUTE, ROLE_CODES, type AccountProfile } from '@hasarbotu/contracts'
import { buildApp, hashPassword } from '../src/index.js'

describe.skipIf(!process.env.TEST_DATABASE_URL)('shared self-service account names', () => {
  let pool: pg.Pool, app: FastifyInstance, organizationId: string
  const users: { id: string; cookie: string }[] = []
  const profile = async (user = users[0]!) => (await app.inject({ method: 'GET', url: ACCOUNT_PROFILE_ROUTE, headers: { cookie: user.cookie } })).json() as AccountProfile
  const save = (user: { id: string; cookie: string }, current: AccountProfile, name: string, extra = {}) => app.inject({ method: 'PATCH', url: ACCOUNT_PROFILE_ROUTE,
    headers: { cookie: user.cookie }, payload: { expectedUserId: current.userId, expectedVersion: current.version, displayName: name, ...extra } })
  beforeAll(async () => {
    const config = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL!)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    app = buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false, loginRateLimit: { limit: 50, windowMs: 60_000 } } })
    organizationId = uuidv7()
    const foreign = uuidv7(), hash = await hashPassword('Profile-Synthetic-Only-42!')
    for (const [id, code] of [[organizationId, 'profile'], [foreign, 'foreign']]) await pool.query('INSERT INTO organizations(id,code,name) VALUES($1,$2,$2)', [id, code])
    for (const [index, role] of [...ROLE_CODES, 'read_only'].entries()) {
      const id = uuidv7(), email = `profile-${index}@example.test`, org = index === ROLE_CODES.length ? foreign : organizationId
      await pool.query('INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,$3,$4,$5)', [id, org, email, 'Eski Ad Soyad', hash])
      await pool.query('INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code=$2', [id, role])
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'Profile-Synthetic-Only-42!' } })
      expect(login.statusCode).toBe(200)
      users.push({ id, cookie: String(login.headers['set-cookie']).split(';')[0]! })
    }
  }, 60_000)
  afterAll(async () => { await app?.close(); if (pool) await closeDatabasePool(pool) })
  it('requires authentication for profile reads and writes', async () => {
    expect((await app.inject({ method: 'GET', url: ACCOUNT_PROFILE_ROUTE })).statusCode).toBe(401)
    expect((await app.inject({ method: 'PATCH', url: ACCOUNT_PROFILE_ROUTE, payload: {} })).statusCode).toBe(401)
  })
  it.each(ROLE_CODES)('lets %s update only their own name and publishes it to other sessions', async role => {
    const user = users[ROLE_CODES.indexOf(role)]!, current = await profile(user)
    const saved = await save(user, current, `  Ömer   Şahin ${role}  `)
    expect(saved.statusCode).toBe(200)
    expect(saved.json()).toEqual({ ...current, displayName: `Ömer Şahin ${role}`, version: current.version + 1 })
    const session = await app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie: user.cookie } })
    expect(session.json().user).toMatchObject({ id: user.id, displayName: `Ömer Şahin ${role}`, roles: [role] })
    const another = users[role === 'admin' ? 1 : 0]!
    const directory = await app.inject({ method: 'GET', url: '/api/v1/references/users', headers: { cookie: another.cookie } })
    expect(directory.json().items).toContainEqual({ id: user.id, displayName: `Ömer Şahin ${role}` })
    const foreign = await app.inject({ method: 'GET', url: '/api/v1/references/users', headers: { cookie: users.at(-1)!.cookie } })
    expect(foreign.json().items.some((entry: { id: string }) => entry.id === user.id)).toBe(false)
  })
  it('rejects another account, role injection, invalid names and stale versions without mutation', async () => {
    const current = await profile(), before = (await pool.query('SELECT to_jsonb(u) snapshot FROM users u ORDER BY id')).rows
    expect((await save(users[1]!, current, 'Başka Kullanıcı')).statusCode).toBe(409)
    expect((await save(users.at(-1)!, current, 'Başka Ofis')).statusCode).toBe(409)
    expect((await save(users[0]!, current, 'Yeni Ad', { roles: ['admin'] })).statusCode).toBe(400)
    for (const name of ['', '   ', 'A'.repeat(161), 'Ad\nSoyad', 'Ad\u0000Soyad']) expect((await save(users[0]!, current, name)).statusCode).toBe(400)
    expect((await save(users[0]!, { ...current, version: current.version - 1 }, 'Yeni Ad')).statusCode).toBe(409)
    expect((await pool.query('SELECT to_jsonb(u) snapshot FROM users u ORDER BY id')).rows).toEqual(before)
  })
  it('serializes competing edits and makes unchanged names a no-op', async () => {
    const current = await profile(), outcomes = await Promise.all(['Ad Bir', 'Ad İki'].map(name => save(users[0]!, current, name)))
    expect(outcomes.map(response => response.statusCode).sort()).toEqual([200, 409])
    const saved = await profile()
    expect(saved.version).toBe(current.version + 1)
    const auditBefore = (await pool.query("SELECT count(*)::int n FROM audit_events WHERE action='user.profile_updated'")).rows[0].n
    expect((await save(users[0]!, saved, saved.displayName)).json()).toEqual(saved)
    expect((await pool.query("SELECT count(*)::int n FROM audit_events WHERE action='user.profile_updated'")).rows[0].n).toBe(auditBefore)
  })
  it('allows only an administrator to rename coworkers, preserving roles, status and tenant boundaries', async () => {
    const target = users[1]!, current = await profile(target)
    const url = `/api/v1/users/${target.id}/profile`, payload = { expectedVersion: current.version, displayName: 'Yönetici Tarafından Düzenlenen' }
    for (const user of users.slice(1, ROLE_CODES.length)) expect((await app.inject({ method: 'PATCH', url, headers: { cookie: user.cookie }, payload })).statusCode).toBe(403)
    expect((await app.inject({ method: 'PATCH', url, payload })).statusCode).toBe(401)
    const result = await app.inject({ method: 'PATCH', url, headers: { cookie: users[0]!.cookie }, payload })
    expect(result.statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie: target.cookie } })).json().user)
      .toMatchObject({ id: target.id, displayName: payload.displayName, roles: ['expert'] })
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/users/${users.at(-1)!.id}/profile`, headers: { cookie: users[0]!.cookie }, payload })).statusCode).toBe(404)
    expect((await app.inject({ method: 'PATCH', url, headers: { cookie: users[0]!.cookie }, payload })).statusCode).toBe(409)
    const event = (await pool.query("SELECT actor_user_id,resource_id,occurred_at,details FROM audit_events WHERE action='user.profile_updated' AND resource_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT 1", [target.id])).rows[0]
    expect(event).toMatchObject({ actor_user_id: users[0]!.id, resource_id: target.id })
    expect(event.occurred_at).toBeInstanceOf(Date)
    expect(event.details).toMatchObject({ before: { displayName: current.displayName }, after: { displayName: payload.displayName } })
    await pool.query("UPDATE users SET status='disabled' WHERE id=$1", [target.id])
    const disabled = await app.inject({ method: 'PATCH', url, headers: { cookie: users[0]!.cookie }, payload: { ...payload, expectedVersion: result.json().version, displayName: 'Pasif Kullanıcının Adı' } })
    expect(disabled.statusCode).toBe(200)
    expect((await pool.query('SELECT status FROM users WHERE id=$1', [target.id])).rows[0].status).toBe('disabled')
  })
  it('rolls a name change back when its audit cannot be recorded', async () => {
    const current = await profile()
    await pool.query(`CREATE FUNCTION reject_profile_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='user.profile_updated' THEN RAISE EXCEPTION 'synthetic_audit_failure'; END IF; RETURN NEW; END$$;
      CREATE TRIGGER reject_profile_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_profile_audit()`)
    try { expect((await save(users[0]!, current, 'Kaydedilmemeli')).statusCode).toBe(500); expect(await profile()).toEqual(current) }
    finally { await pool.query('DROP TRIGGER reject_profile_audit ON audit_events; DROP FUNCTION reject_profile_audit()') }
  })
})
