import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { assertTestDatabaseUrl, createDatabasePool, runMigrations, uuidv7 } from '@hasarbotu/database'
import { buildApp, hashPassword } from '../src/index.js'

const testUrl = process.env.TEST_DATABASE_URL
const describeDb = testUrl ? describe : describe.skip
describeDb('bulk notification read (real API and PostgreSQL)', () => {
  let pool: pg.Pool, app: FastifyInstance, org: string, otherOrg: string, viewer: string, otherUser: string, foreignUser: string
  let cookie: string, otherCookie: string, foreignCookie: string
  let sequence = 0
  beforeAll(async () => {
    const config = assertTestDatabaseUrl(testUrl!)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    org = uuidv7();otherOrg = uuidv7();viewer = uuidv7();otherUser = uuidv7();foreignUser = uuidv7()
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,'read-all-a','Synthetic A'),($2,'read-all-b','Synthetic B')",[org,otherOrg])
    const password = 'synthetic-notification-read-all-2026'
    const passwordHash = await hashPassword(password)
    for (const [id, tenant, role] of [[viewer,org,'read_only'],[otherUser,org,'admin'],[foreignUser,otherOrg,'admin']]) {
      await pool.query('INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,$3,$3,$4)',[id,tenant,`${id}@example.test`,passwordHash])
      await pool.query('INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code=$2',[id,role])
    }
    app = buildApp({ loggerEnabled: false,auth: { pool,cookieSecure: false } });await app.ready()
    const cookies = []
    for (const id of [viewer,otherUser,foreignUser]) {
      const response = await app.inject({ method: 'POST',url: '/api/v1/auth/login',payload: { email: `${id}@example.test`,password } })
      expect(response.statusCode).toBe(200);cookies.push(String(response.headers['set-cookie']).split(';')[0]!)
    }
    cookie = cookies[0]!;otherCookie = cookies[1]!;foreignCookie = cookies[2]!
  },60_000)
  afterAll(async () => { await app?.close();await pool?.end() })
  async function seedCase(owner = viewer, tenant = org, archived = false) {
    const id = uuidv7();sequence++
    await pool.query(`INSERT INTO cases(id,organization_id,office_year,office_sequence,office_number,case_type,workflow_stage,plate,plate_normalized,responsible_user_id,is_archived)
      VALUES($1,$2,2026,$3,$4,'traffic','new_notification','34 TEST 123','34TEST123',$5,$6)`,[id,tenant,sequence,`2026/${sequence}`,owner,archived])
    return id
  }
  async function seedNotice(caseId: string, tenant = org, createdAt = '2026-01-01T00:00:00Z', readAt: string | null = null) {
    const id = uuidv7()
    await pool.query(`INSERT INTO tracking_notifications(id,organization_id,case_id,recipient_user_id,event_key,kind,title,created_at,read_at)
      VALUES($1::uuid,$2,$3,$4,$1::text,'document','Synthetic notification',$5,$6)`,[id,tenant,caseId,otherUser,createdAt,readAt])
    return id
  }
  const readAll = (as = cookie, payload: object = {}) => app.inject({ method: 'POST',url: '/api/v1/tracking/notifications/read-all',headers: { cookie: as },payload })
  const state = async (id: string) => (await pool.query('SELECT read_at,presented_at FROM tracking_notifications WHERE id=$1',[id])).rows[0]
  it('marks all pages for the current owner, preserves other users/tenants/archived/future notices and read timestamps', async () => {
    const own = await seedCase(), other = await seedCase(otherUser), foreign = await seedCase(foreignUser,otherOrg), archived = await seedCase(viewer,org,true)
    const ids = await Promise.all(Array.from({ length: 61 },() => seedNotice(own)))
    const others = [await seedNotice(other),await seedNotice(foreign,otherOrg),await seedNotice(archived),await seedNotice(own,org,'2099-01-01T00:00:00Z')]
    const read = await seedNotice(own,org,'2026-01-01T00:00:00Z','2026-01-02T00:00:00Z'), beforeRead = await state(read)
    expect((await readAll()).statusCode).toBe(204)
    const rows = (await pool.query('SELECT read_at,presented_at FROM tracking_notifications WHERE id=ANY($1::uuid[])',[ids])).rows
    expect(rows).toHaveLength(61);expect(rows.every(r => r.read_at instanceof Date && r.presented_at === null)).toBe(true)
    for (const id of others) expect((await state(id)).read_at).toBeNull()
    expect(await state(read)).toEqual(beforeRead)
    const audit = (await pool.query("SELECT details FROM audit_events WHERE action='tracking.notifications_read_all' AND actor_user_id=$1",[viewer])).rows
    expect(audit).toEqual([{ details: { count: 61 } }])
    expect((await readAll()).statusCode).toBe(204)
    expect((await pool.query("SELECT count(*)::int n FROM audit_events WHERE action='tracking.notifications_read_all' AND actor_user_id=$1",[viewer])).rows[0].n).toBe(1)
    const arrival = await seedNotice(own,org,new Date().toISOString())
    expect((await app.inject({ method: 'GET',url: '/api/v1/tracking/notifications/pending',headers: { cookie } })).json().notifications.map((n: { id: string }) => n.id)).toContain(arrival)
    expect((await readAll(otherCookie)).statusCode).toBe(204)
    expect((await readAll(foreignCookie)).statusCode).toBe(204)
    expect((await state(arrival)).read_at).toBeNull()
  })
  it('requires an authenticated session and rejects target-user fields without writes', async () => {
    const id = await seedNotice(await seedCase())
    expect((await app.inject({ method: 'POST',url: '/api/v1/tracking/notifications/read-all',payload: {} })).statusCode).toBe(401)
    expect((await readAll(cookie,{ userId: otherUser })).statusCode).toBe(400)
    expect((await state(id)).read_at).toBeNull()
    expect((await app.inject({ method: 'POST',url: '/api/v1/cases',headers: { cookie },payload: {} })).statusCode).toBe(403)
  })
  it('rolls back read timestamps when the audit write fails', async () => {
    const id = await seedNotice(await seedCase())
    await pool.query("CREATE FUNCTION reject_read_all_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='tracking.notifications_read_all' THEN RAISE EXCEPTION 'synthetic_audit_failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_read_all_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_read_all_audit()")
    try { expect((await readAll()).statusCode).toBe(500) }
    finally { await pool.query('DROP TRIGGER reject_read_all_audit ON audit_events; DROP FUNCTION reject_read_all_audit()') }
    expect((await state(id)).read_at).toBeNull()
  })
  it('serializes concurrent reads so each unread notification is counted once', async () => {
    const id = await seedNotice(await seedCase())
    const before = (await pool.query("SELECT coalesce(sum((details->>'count')::int),0)::int n FROM audit_events WHERE action='tracking.notifications_read_all' AND actor_user_id=$1",[viewer])).rows[0].n
    const unread = (await pool.query("SELECT count(*)::int n FROM tracking_notifications n JOIN cases c ON c.id=n.case_id WHERE n.organization_id=$1 AND c.responsible_user_id=$2 AND NOT c.is_archived AND n.read_at IS NULL AND n.created_at<=now()",[org,viewer])).rows[0].n
    const responses = await Promise.all([readAll(),readAll()])
    expect(responses.map(r => r.statusCode)).toEqual([204,204]);expect((await state(id)).read_at).not.toBeNull()
    const after = (await pool.query("SELECT sum((details->>'count')::int)::int n FROM audit_events WHERE action='tracking.notifications_read_all' AND actor_user_id=$1",[viewer])).rows[0].n
    expect(after-before).toBe(unread)
  })
})
