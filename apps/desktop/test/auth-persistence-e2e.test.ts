import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { assertTestDatabaseUrl, closeDatabasePool, createDatabasePool, runMigrations, uuidv7 } from '@hasarbotu/database'
import { buildApp, hashPassword } from '@hasarbotu/api'

const require = createRequire(import.meta.url)
it.skipIf(!process.env.TEST_DATABASE_URL)('keeps real Chromium authentication across application and API restarts until logout', async () => {
  const pool = createDatabasePool({ config: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL!) })
  const workspace = await mkdtemp(join(tmpdir(), 'hb-auth-persistence-'))
  let api = buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false } })
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: process.env.TEST_DATABASE_URL!, quiet: true })
    const org = uuidv7(), user = uuidv7()
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,'persistent','Persistent')", [org])
    await pool.query('INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,$3,$4,$5)', [user, org, 'persistent@example.test', 'Persistent', await hashPassword('persistent-password-42')])
    await writeFile(join(workspace, 'index.html'), '<!doctype html><title>Session persistence</title>')
    await api.listen({ host: '127.0.0.1', port: 0 })
    const port = (api.server.address() as { port: number }).port
    async function run(mode: string) {
      const resultPath = join(workspace, 'result.json')
      const code = await new Promise<number | null>((resolve, reject) => {
        const child = spawn(require('electron') as string, [fileURLToPath(new URL('./harness/auth-persistence-main.mjs', import.meta.url)), `--user-data-dir=${join(workspace, 'profile')}`], {
          windowsHide: true, stdio: 'ignore', env: { ...process.env, HB_AUTH_ASSETS: workspace, HB_AUTH_API: `http://127.0.0.1:${port}`, HB_AUTH_RESULT: resultPath, HB_AUTH_MODE: mode },
        })
        const timer = setTimeout(() => { child.kill(); reject(new Error('Authentication persistence timed out')) }, 25_000)
        child.once('error', error => { clearTimeout(timer); reject(error) })
        child.once('exit', code => { clearTimeout(timer); resolve(code) })
      })
      const result = JSON.parse(await readFile(resultPath, 'utf8'))
      expect(result.error).toBeUndefined()
      expect(code).toBe(0)
      return result
    }
    const first = await run('login')
    expect(first.status).toBe(200)
    expect(first.body.expiresAt).toBeNull()
    expect(first.cookiePersistent).toBe(true)
    expect(first.cookieRemainingSeconds).toBeGreaterThan(399 * 24 * 60 * 60)
    await pool.query("UPDATE sessions SET created_at=now()-interval '10 years'")
    await api.close()
    api = buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false } })
    await api.listen({ host: '127.0.0.1', port })
    const restored = await run('session')
    expect(restored.origin).toBe(first.origin)
    expect(restored.status).toBe(200)
    expect(restored.body.user.id).toBe(user)
    expect(restored.body.expiresAt).toBeNull()
    expect((await run('logout')).status).toBe(204)
    expect((await run('session')).status).toBe(401)
    expect((await pool.query('SELECT revoked_at FROM sessions')).rows[0].revoked_at).not.toBeNull()
  } finally {
    await api.close()
    await closeDatabasePool(pool)
    await rm(workspace, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}, 120_000)
