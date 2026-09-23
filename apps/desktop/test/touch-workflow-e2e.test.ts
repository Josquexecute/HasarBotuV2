import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { assertTestDatabaseUrl, createDatabasePool, runMigrations, uuidv7 } from '@hasarbotu/database'
import { buildApp, hashPassword } from '@hasarbotu/api'

const require = createRequire(import.meta.url)
const testUrl = process.env.TEST_DATABASE_URL
const run = testUrl ? it : it.skip

run('production Electron UI: category layouts, native quick note, target selection and restart persistence', async () => {
  const config = assertTestDatabaseUrl(testUrl!)
  const pool = createDatabasePool({ config })
  const output = fileURLToPath(new URL('../../../.local/ui-cleanup-evidence/', import.meta.url))
  await mkdir(output, { recursive: true })
  const password = 'touch-synthetic-password-2026'
  const email = 'touch-test@example.test'
  const organizationId = uuidv7(), userId = uuidv7(), caseId = uuidv7(), otherCaseId = uuidv7()
  const api = buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false } })
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,'touch-test','Dokunmatik Test')", [organizationId])
    await pool.query("INSERT INTO users(id,organization_id,email,display_name,password_hash,status) VALUES($1,$2,$3,'Test Kullanıcısı',$4,'active')", [userId, organizationId, email, await hashPassword(password)])
    await pool.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code='admin'", [userId])
    await pool.query(`INSERT INTO cases(id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,workflow_stage,plate,plate_normalized,responsible_user_id)
      VALUES($1,$3,2026,9101,'2026/9101','traffic','open','inspection_pending','34 TEST 01','34TEST01',$4),
      ($2,$3,2026,9102,'2026/9102','casco','open','new_notification','34 TEST 02','34TEST02',$4)`, [caseId, otherCaseId, organizationId, userId])
    const origin = await api.listen({ host: '127.0.0.1', port: 0 })
    const child = spawn(require('electron') as string, [fileURLToPath(new URL('./harness/touch-workflow-main.mjs', import.meta.url)), `--user-data-dir=${join(output, `profile-${Date.now()}`)}`], {
      windowsHide: true, stdio: 'ignore', env: { ...process.env, HB_TOUCH_API: origin, HB_TOUCH_OUTPUT: output, HB_TOUCH_EMAIL: email, HB_TOUCH_PASSWORD: password, HB_TOUCH_CASE: caseId, HB_TOUCH_OTHER_CASE: otherCaseId, HB_TOUCH_ASSETS: fileURLToPath(new URL('../../../dist/', import.meta.url)) },
    })
    const code = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error('Touch workflow timed out')) }, 180_000)
      child.once('error', (error) => { clearTimeout(timer); reject(error) })
      child.once('exit', (value) => { clearTimeout(timer); resolve(value) })
    })
    const results = JSON.parse(await readFile(join(output, 'results.json'), 'utf8')) as { checks: { name: string; pass: boolean }[] }
    expect(results.checks.filter((check) => !check.pass)).toEqual([])
    expect(code).toBe(0)
    const notes = await pool.query('SELECT case_id,body FROM case_notes ORDER BY created_at')
    expect(notes.rows).toEqual([{ case_id: caseId, body: 'Dokunmatik kalıcı not.' }, { case_id: otherCaseId, body: 'Seçili dosyaya not.' }])
  } finally {
    await api.close()
    await pool.end()
  }
}, 210_000)
