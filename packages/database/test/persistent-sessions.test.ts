import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type pg from 'pg'
import { assertTestDatabaseUrl, closeDatabasePool, createDatabasePool, MIGRATIONS_DIR, runMigrations, uuidv7 } from '../src/index.js'

const url = process.env.TEST_DATABASE_URL
const describeDb = url ? describe : describe.skip

describeDb('persistent session migration (real PostgreSQL)', () => {
  let pool: pg.Pool
  let directory: string
  beforeAll(async () => {
    pool = createDatabasePool({ config: assertTestDatabaseUrl(url!) })
    directory = mkdtempSync(join(tmpdir(), 'hb-session-migrations-'))
    for (const file of readdirSync(MIGRATIONS_DIR).filter(name => /^\d{4}_.*\.js$/.test(name) && name.slice(0, 4) <= '0062')) {
      copyFileSync(join(MIGRATIONS_DIR, file), join(directory, file))
    }
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: url!, dir: directory, quiet: true })
  }, 60_000)
  afterAll(async () => {
    if (pool) await closeDatabasePool(pool)
    if (directory) rmSync(directory, { recursive: true, force: true })
  })

  it('converts valid sessions only, is repeatable and supports rollback', async () => {
    const org = uuidv7(), active = uuidv7(), disabled = uuidv7()
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,'sessions','Sessions')", [org])
    for (const [id, status] of [[active, 'active'], [disabled, 'disabled']]) {
      await pool.query('INSERT INTO users(id,organization_id,email,display_name,status) VALUES($1,$2,$3,$4,$5)', [id, org, `${id}@example.test`, 'Session test', status])
    }
    for (const [key, user, expired, revoked] of [['valid', active, false, false], ['expired', active, true, false], ['revoked', active, false, true], ['disabled', disabled, false, false]] as const) {
      await pool.query(`INSERT INTO sessions(id,token_hash,user_id,organization_id,expires_at,revoked_at)
        VALUES($1,$2,$3,$4,now()+make_interval(hours=>$5),CASE WHEN $6 THEN now() ELSE NULL END)`,
      [uuidv7(), key, user, org, expired ? -1 : 1, revoked])
    }
    expect((await runMigrations({ databaseUrl: url!, quiet: true })).map(m => m.name)).toEqual(['0063_persistent_sessions'])
    const rows = (await pool.query('SELECT token_hash,expires_at,persistent,revoked_at FROM sessions')).rows
    expect(rows.find(row => row.token_hash === 'valid')).toMatchObject({ expires_at: null, persistent: true })
    for (const key of ['expired', 'revoked', 'disabled']) expect(rows.find(row => row.token_hash === key).expires_at).not.toBeNull()
    expect(rows.find(row => row.token_hash === 'revoked').revoked_at).not.toBeNull()
    expect(await runMigrations({ databaseUrl: url!, quiet: true })).toEqual([])
    await runMigrations({ databaseUrl: url!, direction: 'down', count: 1, quiet: true })
    expect((await pool.query('SELECT count(*)::int n FROM sessions WHERE expires_at IS NULL')).rows[0].n).toBe(0)
    await runMigrations({ databaseUrl: url!, quiet: true })
    expect((await pool.query("SELECT expires_at FROM sessions WHERE token_hash='valid'")).rows[0].expires_at).toBeNull()
    await pool.query("UPDATE users SET display_name='Renamed' WHERE id=$1", [active])
    expect((await pool.query("SELECT revoked_at FROM sessions WHERE token_hash='valid'")).rows[0].revoked_at).toBeNull()
    await pool.query("UPDATE users SET password_hash='replacement-test-hash' WHERE id=$1", [active])
    expect((await pool.query("SELECT revoked_at FROM sessions WHERE token_hash='valid'")).rows[0].revoked_at).not.toBeNull()
    await pool.query('INSERT INTO sessions(id,token_hash,user_id,organization_id,expires_at) VALUES($1,$2,$3,$4,NULL)', [uuidv7(), 'after-password-change', active, org])
    await pool.query("UPDATE users SET status='disabled' WHERE id=$1", [active])
    await pool.query("UPDATE users SET status='active' WHERE id=$1", [active])
    expect((await pool.query("SELECT revoked_at FROM sessions WHERE token_hash='after-password-change'")).rows[0].revoked_at).not.toBeNull()
  })
})
