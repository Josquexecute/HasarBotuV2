import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { assertTestDatabaseUrl, createDatabasePool, runMigrations, uuidv7 } from '@hasarbotu/database'
import { buildApp, hashPassword } from '@hasarbotu/api'

it.skipIf(!process.env.TEST_DATABASE_URL)('real Electron → API → PostgreSQL: SBM contact editing, both saves, revision, cancellation and service replacement', async () => {
  const config = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL!)
  const pool = createDatabasePool({ config })
  const output = await mkdtemp(join(tmpdir(), 'hb-sbm-service-'))
  const organization = uuidv7(), user = uuidv7(), email = `${user}@example.test`, password = 'synthetic-sbm-service-test-2026'
  const api = buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false } })
  try {
    await runMigrations({ databaseUrl: config.url, quiet: true })
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,$2,'SBM Electron Test')", [organization, organization])
    await pool.query("INSERT INTO users(id,organization_id,email,display_name,password_hash,status) VALUES($1,$2,$3,'SBM Test',$4,'active')", [user, organization, email, await hashPassword(password)])
    await pool.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code='admin'", [user])
    await pool.query("INSERT INTO storage_roots(id,organization_id,root_key,label) VALUES($1,$2,'sbm-test','Synthetic Root')", [uuidv7(), organization])
    for (const [name, phone] of [['Yeni Servis', '0216 555 20 20'], ['İletişimsiz Servis', null]]) {
      await pool.query("INSERT INTO service_centers(id,organization_id,name,center_type,service_type,phone) VALUES($1,$2,$3,'ozel','private',$4)", [uuidv7(), organization, name, phone])
    }
    const origin = await api.listen({ host: '127.0.0.1', port: 0 })
    const code = await new Promise<number | null>((done, reject) => {
      const child = spawn(createRequire(import.meta.url)('electron') as string, [fileURLToPath(new URL('./harness/sbm-service-main.mjs', import.meta.url)), `--user-data-dir=${join(output, 'profile')}`], {
        windowsHide: true, stdio: 'ignore', env: { ...process.env, HB_SBM_OUTPUT: output, HB_SBM_API: origin, HB_SBM_EMAIL: email, HB_SBM_PASSWORD: password, HB_SBM_ASSETS: fileURLToPath(new URL('../../../dist/', import.meta.url)) },
      })
      const timer = setTimeout(() => { child.kill(); reject(new Error('SBM Electron workflow timed out')) }, 100_000)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('exit', value => { clearTimeout(timer); done(value) })
    })
    const proof = JSON.parse(await readFile(join(output, 'sbm-proof.json'), 'utf8')) as { checks: { name: string; pass: boolean }[] }
    expect(proof.checks.filter(check => !check.pass)).toEqual([])
    expect(code).toBe(0)
    const contacts = await pool.query('SELECT name,phone,address FROM case_service_contacts WHERE organization_id=$1 ORDER BY name', [organization])
    expect(contacts.rows).toHaveLength(2)
    expect(contacts.rows).toEqual(expect.arrayContaining([
      { name: 'İletişimsiz Servis', phone: null, address: null },
      { name: 'Kaynak Servis Düzeltildi', phone: '0212 555 11 11', address: 'Kaynak Adres' },
    ]))
    expect((await pool.query('SELECT raw_text FROM eksist_sources WHERE organization_id=$1', [organization])).rows).toHaveLength(2)
  } finally {
    await api.close(); await pool.end()
    await rm(output, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}, 120_000)
