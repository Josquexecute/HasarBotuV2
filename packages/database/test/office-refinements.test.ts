import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import type pg from 'pg'
import { assertTestDatabaseUrl, closeDatabasePool, createDatabasePool, MIGRATIONS_DIR, runMigrations, uuidv7 } from '../src/index.js'

const testUrl = process.env.TEST_DATABASE_URL
const describeDb = testUrl ? describe : describe.skip

describeDb('Google pending accounts and tenant policies migration', () => {
  let pool: pg.Pool
  let databaseUrl: string
  let historicalDirectory: string
  const migrate = (options: Parameters<typeof runMigrations>[0]) => runMigrations({ ...options, dir: historicalDirectory })
  beforeAll(async () => {
    // These assertions target the 0052/0053 transitions, independently of later schema additions.
    historicalDirectory = mkdtempSync(join(tmpdir(), 'hasarbotu-office-migrations-test-'))
    for (const file of readdirSync(MIGRATIONS_DIR).filter(name => /^\d{4}_.*\.js$/.test(name) && name.slice(0, 4) <= '0053')) {
      copyFileSync(join(MIGRATIONS_DIR, file), join(historicalDirectory, file))
    }
    databaseUrl = assertTestDatabaseUrl(testUrl as string).url
    pool = createDatabasePool({ config: assertTestDatabaseUrl(databaseUrl) })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    await migrate({ databaseUrl, count: 51, quiet: true })
  })
  afterAll(async () => {
    if (pool) await closeDatabasePool(pool)
    if (historicalDirectory) {
      if (dirname(resolve(historicalDirectory)) !== resolve(tmpdir()) || !basename(historicalDirectory).startsWith('hasarbotu-office-migrations-test-')) throw new Error('Unexpected historical test directory.')
      rmSync(historicalDirectory, { recursive: true, force: true })
    }
  })

  it('preserves existing password accounts and fails closed when a pending account cannot be downgraded', async () => {
    const organizationId = uuidv7()
    const existingId = uuidv7()
    await pool.query('INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)', [organizationId, 'migration-office', 'Migration office'])
    await pool.query("INSERT INTO users(id,organization_id,email,display_name,password_hash,status) VALUES($1,$2,'existing@example.test','Existing','preserved-password-hash','active')", [existingId, organizationId])
    const before = (await pool.query('SELECT * FROM users WHERE id=$1', [existingId])).rows[0]
    expect((await migrate({ databaseUrl, count: 1, quiet: true })).map(m => m.name)).toEqual(['0052_google_pending_accounts'])
    expect((await pool.query('SELECT * FROM users WHERE id=$1', [existingId])).rows[0]).toEqual(before)
    const pendingId = uuidv7()
    await pool.query("INSERT INTO users(id,organization_id,email,display_name,status) VALUES($1,$2,'pending@example.test','Pending','pending')", [pendingId, organizationId])
    await expect(migrate({ databaseUrl, direction: 'down', count: 1, quiet: true })).rejects.toThrow()
    expect((await pool.query('SELECT status,password_hash FROM users WHERE id=$1', [pendingId])).rows[0]).toEqual({ status: 'pending', password_hash: null })
    expect((await pool.query('SELECT * FROM users WHERE id=$1', [existingId])).rows[0]).toEqual(before)
  })

  it('preserves global document rules and installs empty tenant policy storage', async () => {
    const before = (await pool.query('SELECT * FROM document_rule_sets ORDER BY id')).rows
    expect((await migrate({ databaseUrl, quiet: true })).map(m => m.name)).toEqual(['0053_office_rules_permissions'])
    const after = (await pool.query('SELECT * FROM document_rule_sets ORDER BY id')).rows
    expect(after.map(({ organization_id, ...row }) => { expect(organization_id).toBeNull(); return row })).toEqual(before)
    expect((await pool.query('SELECT count(*)::int n FROM organization_role_policies')).rows[0].n).toBe(0)
    expect(await migrate({ databaseUrl, quiet: true })).toEqual([])
  })
})
