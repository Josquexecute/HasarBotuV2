import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import pg from 'pg'

// Only disposable local resources. Never consult DATABASE_URL or office config.
const root = resolve('.local','tm-'+Date.now())
await mkdir(root)
const pgBin = resolve(process.env.HB_TRANSITION_TEST_PG_BIN ?? '.local/tools/postgresql-17.11/pgsql/bin')
const runtime = resolve('.local/office-api-0191-ready/api-runtime')
const office = join(root,'ProgramData/HasarBotu/runtime-20261011')
const candidate = join(office,'services/api')
const data = join(root,'pg')
// Detached PostgreSQL children must not inherit capture pipes from pg_ctl.
const run = (exe,args) => execFileSync(exe,args,{ windowsHide:true,stdio:'ignore',timeout:180000 })
const powershell = (name,args) => execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',resolve('deploy/windows-service',name),...args],{windowsHide:true,encoding:'utf8',timeout:180000,maxBuffer:16*1024*1024})
const resultJson = output => JSON.parse(output.slice(output.lastIndexOf('\n{')+1))
let started = false
let stage = 'fixture_deploy'
try {
  await mkdir(dirname(candidate),{recursive:true})
  powershell('provision-extra-data-references.ps1',['-RepoRoot',runtime,'-DataLabel','managertest','-DependencyClosureManifestPath',join(runtime,'dependency-closure.json'),'-ServiceTargetDir',candidate,'-Apply'])
  powershell('deploy-service-artifacts.ps1',['-SourceDir',join(runtime,'services/api'),'-TargetDir',candidate,'-ServiceLabel','managertest','-DependencyClosureManifestPath',join(runtime,'dependency-closure.json'),'-RepoRoot',runtime,'-Apply'])
  // Real deployment/reference tools against the office's split wrapper/API tree.
  // All files and credentials here belong to the disposable fixture only.
  stage = 'office_layout_preview'
  const wrapper = join(office,'wrappers/api/hasarbotu-api.exe')
  const xml = wrapper.replace(/\.exe$/,'.xml')
  const entrypoint = join(candidate,'dist/index.js')
  const claim = join(candidate,'claim-file.keep')
  const reference = join(office,'reference-data/value-loss/real-market-analysis/2026-07-01/1.0.0/snapshot.json')
  await mkdir(dirname(wrapper),{recursive:true})
  await writeFile(wrapper,'synthetic wrapper; never executed')
  await writeFile(xml,(await readFile('deploy/windows-service/hasarbotu-api.winsw.xml','utf8')).replace('__NODE_EXE__',process.execPath).replace('__APP_DIR__',candidate))
  await writeFile(claim,'synthetic claim must remain unchanged')
  const originalEntrypoint = await readFile(entrypoint)
  await writeFile(entrypoint,Buffer.concat([originalEntrypoint,Buffer.from('\n// disposable old-runtime fixture\n')]))
  const monitored = [wrapper,xml,entrypoint,claim,reference]
  const hashes = async () => Promise.all(monitored.map(async path=>createHash('sha256').update(await readFile(path)).digest('hex')))
  stage = 'office_layout_hashes'
  const before = await hashes()
  stage = 'office_layout_references'
  const refs = resultJson(powershell('provision-extra-data-references.ps1',['-RepoRoot',runtime,'-DataLabel','officepreview','-DependencyClosureManifestPath',join(runtime,'dependency-closure.json'),'-ServiceTargetDir',candidate]))
  assert.ok(['already_up_to_date','nothing_to_provision'].includes(refs.Status))
  stage = 'office_layout_deploy_preview'
  const preview = resultJson(powershell('deploy-service-artifacts.ps1',['-SourceDir',join(runtime,'services/api'),'-TargetDir',candidate,'-ServiceLabel','officepreview','-DependencyClosureManifestPath',join(runtime,'dependency-closure.json'),'-RepoRoot',runtime]))
  assert.equal(preview.Status,'would_apply')
  assert.deepEqual(await hashes(),before)
  await writeFile(entrypoint,originalEntrypoint)
  console.log('OFFICE_LAYOUT_REAL_DEPLOY_AND_REFERENCE_PREVIEWS_PASS_UNCHANGED')
  stage = 'disposable_database'
  assert.match(execFileSync(join(pgBin,'postgres.exe'),['--version'],{encoding:'utf8',windowsHide:true}),/PostgreSQL\) 17\./)
  assert.match(execFileSync(join(pgBin,'pg_dump.exe'),['--version'],{encoding:'utf8',windowsHide:true}),/PostgreSQL\) 17\./)
  run(join(pgBin,'initdb.exe'),['-D',data,'-U','hboperator','--auth=trust','--encoding=UTF8','--locale=C'])
  const server = createServer()
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  run(join(pgBin,'pg_ctl.exe'),['-D',data,'-l',join(root,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start'])
  started = true
  const pool = new pg.Pool({connectionString:`postgres://hboperator@127.0.0.1:${port}/postgres`})
  const apiPassword='synthetic-api-şifre%25'
  const restoreAdmin={username:'hb_restore',password:'synthetic-restore-şifre%40'}
  try {
    await pool.query("ALTER ROLE hboperator PASSWORD 'synthetic-operator-password'")
    await pool.query("CREATE ROLE hb_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '"+apiPassword+"'")
    await pool.query("CREATE ROLE hb_restore LOGIN NOSUPERUSER CREATEDB NOCREATEROLE PASSWORD '"+restoreAdmin.password+"'")
    await pool.query("CREATE ROLE hb_no_create LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD 'synthetic-no-create'")
    await pool.query('CREATE DATABASE hb_operator_test')
    const setup = new pg.Pool({connectionString:`postgres://hboperator@127.0.0.1:${port}/hb_operator_test`})
    try { await setup.query('GRANT USAGE,CREATE ON SCHEMA public TO hb_api') } finally { await setup.end() }
    await writeFile(join(data,'pg_hba.conf'),'host all all 127.0.0.1/32 scram-sha-256\n')
    await pool.query('SELECT pg_reload_conf()')
  } finally { await pool.end() }
  const testEnvironment={...process.env,TEST_DATABASE_URL:`postgres://hb_api:${encodeURIComponent(apiPassword)}@127.0.0.1:${port}/hb_operator_test`,HB_TRANSITION_TEST_CANDIDATE:candidate,
    HB_TRANSITION_TEST_CLUSTER_URL:`postgres://hboperator:synthetic-operator-password@127.0.0.1:${port}/postgres`,
    HB_TRANSITION_TEST_RESTORE_ADMIN:JSON.stringify(restoreAdmin),HB_TRANSITION_TEST_DUMP:join(pgBin,'pg_dump.exe'),HB_TRANSITION_TEST_BACKUP:join(root,'backup'),
    HB_TRANSITION_TEST_RUNTIME:runtime,HB_TRANSITION_TEST_PG_BIN:pgBin,HB_TRANSITION_TEST_PGDATA:data,HB_TRANSITION_TEST_ROOT:root}
  const result = spawnSync(process.execPath,['--test','deploy/windows-service/api-transition-database.test.mjs'],{windowsHide:true,encoding:'utf8',timeout:180000,
    env:testEnvironment})
  process.stdout.write(result.stdout ?? '')
  if (result.status !== 0) { process.stderr.write(result.stderr ?? ''); process.exitCode = 1 }
  const evidence=spawnSync(process.execPath,['--test','deploy/windows-service/api-transition-restore-evidence.test.mjs'],{windowsHide:true,encoding:'utf8',timeout:180000,env:testEnvironment})
  process.stdout.write(evidence.stdout ?? '')
  if(evidence.status !== 0){process.stderr.write(evidence.stderr ?? '');process.exitCode=1}
  const native=spawnSync(process.execPath,['--test','deploy/windows-service/inspect-local-postgres.test.mjs'],{windowsHide:true,encoding:'utf8',timeout:180000,env:testEnvironment})
  process.stdout.write(native.stdout ?? '')
  if(native.status !== 0){process.stderr.write(native.stderr ?? '');process.exitCode=1}
} catch (error) {
  console.log('ISOLATED_OPERATOR_TEST_HARNESS_FAILED stage='+stage+' code='+(['ENOENT','ERR_ASSERTION','ETIMEDOUT'].includes(error.code) ? error.code : 'OPERATION_FAILED'))
  process.exitCode = 1
} finally {
  if (started) run(join(pgBin,'pg_ctl.exe'),['-D',data,'-m','fast','-w','stop'])
  if (!root.startsWith(resolve('.local')+'\\tm-')) throw Error('UNSAFE_TEST_CLEANUP')
  await rm(root,{recursive:true,force:true})
}
