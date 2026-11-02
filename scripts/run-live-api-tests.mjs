import { spawn } from 'node:child_process'
import { assertTestDatabaseUrl, createDatabasePool, closeDatabasePool, runMigrations, uuidv7 } from '../packages/database/dist/index.js'
import { buildApp, hashPassword } from '../services/api/dist/index.js'

// All data belongs to the explicitly disposable database, never to an office endpoint.
const config = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL)
const pool = createDatabasePool({ config })
let app
try {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
  await runMigrations({ databaseUrl: config.url, quiet: true })
  const org = uuidv7(), manager = uuidv7(), expert = uuidv7(), insurer = uuidv7(), service = uuidv7(), caseId = uuidv7()
  const email = 'release-test@office.example', password = 'synthetic-release-test-only-2026'
  await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,'release-test','Sentetik kabul ofisi')", [org])
  await pool.query("INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$3,$4,'Test Yönetici',$5),($2,$3,'test-expert@office.example','Test Eksper',$5)", [manager, expert, org, email, await hashPassword(password)])
  await pool.query("INSERT INTO user_roles(user_id,role_id) SELECT $1::uuid,id FROM roles WHERE code='admin' UNION ALL SELECT $2::uuid,id FROM roles WHERE code='expert'", [manager, expert])
  await pool.query("INSERT INTO insurers(id,organization_id,name,is_active) VALUES($1,$2,'Test Sigorta',true)", [insurer, org])
  await pool.query("INSERT INTO service_centers(id,organization_id,name,center_type,service_type,is_active) VALUES($1,$2,'Test Servis','ozel','private',true)", [service, org])
  await pool.query("INSERT INTO cases(id,organization_id,office_year,office_sequence,office_number,case_type,workflow_stage,plate,plate_normalized,responsible_user_id) VALUES($1,$2,2026,184,'2026/184','casco','under_repair','34 MPA 764','34MPA764',$3)", [caseId, org, manager])
  await pool.query('INSERT INTO office_counters(organization_id,office_year,last_sequence) VALUES($1,2026,184)', [org])
  app = buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false } })
  const origin = await app.listen({ host: '127.0.0.1', port: 0 })
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } })
  if (login.statusCode !== 200) throw Error('ISOLATED_FIXTURE_LOGIN_FAILED')
  const cookie = String(login.headers['set-cookie']).split(';')[0]
  const child = spawn(process.execPath, ['node_modules/vitest/vitest.mjs', 'run',
    'src/data/auth.live.test.ts', 'src/data/httpAdapter.live.test.ts', 'src/data/reference.live.test.ts', 'src/data/documentHttpAdapter.live.test.ts'], {
    windowsHide: true, stdio: 'inherit', env: { ...process.env, LIVE_API_BASE_URL: origin, LIVE_API_EMAIL: email,
      LIVE_API_PASSWORD: password, LIVE_API_COOKIE: cookie, LIVE_API_CASE_ID: caseId },
  })
  const code = await new Promise((done, reject) => { child.once('error', reject); child.once('exit', done) })
  if (code !== 0) throw Error('LIVE_API_TESTS_FAILED')
} finally { await app?.close(); await closeDatabasePool(pool) }
