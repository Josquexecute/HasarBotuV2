import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'
import { mkdir, readFile, writeFile, appendFile, readdir, copyFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { databaseMaintenance, safeDatabaseError } from './api-transition-database.mjs'
import { MAX_RESTORE_EVIDENCE_AGE_MS, restoreFileHash } from './api-transition-restore-evidence.mjs'

test('diagnostics emit allowlisted codes, never arbitrary driver/error payloads', () => {
  assert.equal(safeDatabaseError({ code:'28P01', message:'synthetic credential' }), '28P01')
  assert.equal(safeDatabaseError({ code:'synthetic credential', message:'synthetic credential' }), 'DATABASE_OPERATION_FAILED')
  assert.equal(safeDatabaseError(Error('MIGRATION_BASELINE_MISMATCH')), 'MIGRATION_BASELINE_MISMATCH')
})

const enabled = !!process.env.HB_TRANSITION_TEST_CANDIDATE && !!process.env.TEST_DATABASE_URL && !!process.env.HB_TRANSITION_TEST_DUMP
test('real backup, restore, migration rehearsal, data preservation and candidate probe', { skip:!enabled, timeout:180000 }, async t => {
  const databaseUrl = process.env.TEST_DATABASE_URL
  assert.ok(new URL(databaseUrl).pathname.endsWith('_test'), 'Disposable _test DB required')
  const candidate = resolve(process.env.HB_TRANSITION_TEST_CANDIDATE)
  const dumpTool = resolve(process.env.HB_TRANSITION_TEST_DUMP)
  const backupDirectory = resolve(process.env.HB_TRANSITION_TEST_BACKUP)
  const restoreAdmin = JSON.parse(process.env.HB_TRANSITION_TEST_RESTORE_ADMIN)
  const { Pool } = createRequire(join(candidate,'package.json'))('pg')
  const { runMigrations } = await import(pathToFileURL(join(candidate,'node_modules/@hasarbotu/database/dist/index.js')).href)
  const pool = new Pool({ connectionString:databaseUrl, max:1 })
  const adminPool = new Pool({connectionString:process.env.HB_TRANSITION_TEST_CLUSTER_URL})
  const run = (action,extra={}) => databaseMaintenance({ action,candidate,dumpTool,backupDirectory,databaseUrl,restoreAdmin,...extra })
  try {
    await runMigrations({ databaseUrl, count:74, quiet:true })
    await pool.query('CREATE TABLE operator_preservation (id integer PRIMARY KEY, encrypted_token text NOT NULL, payload jsonb NOT NULL)')
    await pool.query('INSERT INTO operator_preservation VALUES (1,$1,$2)', ['synthetic-encrypted-gmail-token',JSON.stringify({keep:'exact'})])
    const setupUrl=new URL(process.env.HB_TRANSITION_TEST_CLUSTER_URL); setupUrl.pathname='/hb_operator_test'
    const setupPool=new Pool({connectionString:setupUrl.href})
    try { await setupPool.query('REVOKE CREATE ON SCHEMA public FROM hb_api') } finally { await setupPool.end() }
    await t.test('read-only Check accepts 74 and preserves schema and records', async () => {
      const result = await run('Check')
      assert.equal(result.status,'PASS')
      assert.equal(result.appliedCount,74)
      assert.equal(result.serverMajor,17)
      assert.deepEqual(result.permissions,{databaseOwnerDirect:false,databaseOwnerEffective:false,apiCreatedb:false,apiSuperuser:false,migrationCapable:true,backupReadPrivileges:true})
      assert.deepEqual(result.restoreAdmin,{supplied:true,separateRole:true,canCreateDatabase:true,sameServerMajor:true})
      assert.equal(result.restoreAcceptance,'PENDING')
      assert.deepEqual(result.pending,['0075_google_desktop_loopback'])
      assert.equal((await pool.query("SELECT 1 FROM information_schema.columns WHERE table_name='google_oauth_states' AND column_name='desktop_redirect_uri'")).rowCount,0)
    })
    await t.test('owner and CREATEDB are independent; catalog checks leave source data, roles and DB set unchanged', async () => {
      const catalog = async () => (await adminPool.query("SELECT datname,datdba FROM pg_database ORDER BY datname")).rows
      const roles = async () => (await adminPool.query("SELECT rolname,rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname IN ('hb_api','hb_restore') ORDER BY rolname")).rows
      const beforeDatabases=await catalog(),beforeRoles=await roles()
      const noAdmin=await run('Check',{restoreAdmin:undefined})
      assert.equal(noAdmin.status,'PASS')
      assert.equal(noAdmin.restoreAdmin.supplied,false)
      assert.deepEqual(await catalog(),beforeDatabases)
      assert.deepEqual(await roles(),beforeRoles)
      assert.equal((await pool.query('SELECT payload FROM operator_preservation')).rows[0].payload.keep,'exact')
      await adminPool.query('ALTER DATABASE hb_operator_test OWNER TO hb_api')
      try { const owner=await run('Check'); assert.equal(owner.permissions.databaseOwnerDirect,true); assert.equal(owner.permissions.apiCreatedb,false) }
      finally { await adminPool.query('ALTER DATABASE hb_operator_test OWNER TO hboperator') }
      await adminPool.query('ALTER ROLE hb_api CREATEDB')
      try { const createdb=await run('Check'); assert.equal(createdb.permissions.databaseOwnerDirect,false); assert.equal(createdb.permissions.apiCreatedb,true) }
      finally { await adminPool.query('ALTER ROLE hb_api NOCREATEDB') }
    })
    await t.test('object ownership and unreadable backup tables are diagnosed separately', async () => {
      const sourceAdminUrl=new URL(process.env.HB_TRANSITION_TEST_CLUSTER_URL); sourceAdminUrl.pathname='/hb_operator_test'
      const sourceAdmin=new Pool({connectionString:sourceAdminUrl.href})
      try {
        await sourceAdmin.query('ALTER TABLE google_oauth_states OWNER TO hboperator')
        await sourceAdmin.query('GRANT SELECT ON google_oauth_states TO hb_api')
        assert.equal((await run('Check')).permissions.migrationCapable,false)
        await sourceAdmin.query('ALTER TABLE google_oauth_states OWNER TO hb_api')
        await sourceAdmin.query('CREATE TABLE backup_permission_fixture (id integer)')
        const result=await run('Check')
        assert.equal(result.permissions.migrationCapable,true)
        assert.equal(result.permissions.backupReadPrivileges,false)
        await sourceAdmin.query('DROP TABLE backup_permission_fixture')
      } finally { await sourceAdmin.end() }
    })
    await t.test('wrong admin password produces only safe SQLSTATE', async () => {
      const result=await run('Check',{restoreAdmin:{...restoreAdmin,password:'wrong-synthetic-password'}})
      assert.equal(result.code,'28P01')
      assert.ok(!JSON.stringify(result).includes('hb_restore') && !JSON.stringify(result).includes('password'))
    })
    await t.test('PowerShell wrapper accepts percent-encoded URL without exposing it', () => {
      const url = new URL(databaseUrl)
      const xml = join(resolve(process.env.HB_TRANSITION_TEST_BACKUP),'..','wrapper.xml')
      // Fixture credentials only, on the disposable localhost test cluster.
      execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
        '[IO.File]::WriteAllText($env:HB_TEST_XML,\'<service><env name="DATABASE_URL" value="\'+$env:HB_TEST_URL+\'"/></service>\')'],
      {windowsHide:true,stdio:'pipe',env:{...process.env,HB_TEST_XML:xml,HB_TEST_URL:url.href}})
      const stdout = execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',resolve('deploy/windows-service/invoke-api-database-maintenance.ps1'),
        '-Action','Check','-WinSwXml',xml,'-CandidateDirectory',candidate,'-NodeExe',process.execPath],{windowsHide:true,encoding:'utf8',timeout:15000})
      assert.equal(JSON.parse(stdout).status,'PASS')
      assert.ok(!stdout.includes('synthetic-api') && !stdout.includes('hb_api'))
      // Invoke the real manager boundary with separate credentials over its
      // UTF-8 stdin pipe. Environment variables here contain fixture data only.
      const command = `Import-Module $env:HB_TEST_MANAGER -Force -DisableNameChecking
$value=$env:HB_TEST_RESTORE_ADMIN | ConvertFrom-Json
$password=ConvertTo-SecureString $value.password -AsPlainText -Force
try {
  $credential=[Management.Automation.PSCredential]::new($value.username,$password)
  $context=@{Xml=$env:HB_TEST_XML;Candidate=$env:HB_TEST_CANDIDATE;Node=$env:HB_TEST_NODE;Dump=$env:HB_TEST_DUMP;RestoreAdminCredential=$credential}
  Invoke-TransitionDatabase $context Check | ConvertTo-Json -Depth 5 -Compress
} finally { $password.Dispose() }`
      const checked=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{
        windowsHide:true,encoding:'utf8',timeout:15000,env:{...process.env,HB_TEST_MANAGER:resolve('deploy/windows-service/api-transition-manager.psm1'),
          HB_TEST_XML:xml,HB_TEST_CANDIDATE:candidate,HB_TEST_NODE:process.execPath,HB_TEST_DUMP:dumpTool,HB_TEST_RESTORE_ADMIN:JSON.stringify(restoreAdmin)}})
      const result=JSON.parse(checked)
      assert.equal(result.permissions.apiCreatedb,false)
      assert.equal(result.restoreAdmin.separateRole,true)
      assert.equal(result.restoreAdmin.canCreateDatabase,true)
      assert.ok(!checked.includes('synthetic-') && !checked.includes('hb_restore'))
    })
    await t.test('unknown migration history fails closed', async () => {
      await pool.query("INSERT INTO pgmigrations (name,run_on) VALUES ('unexpected',now())")
      assert.equal((await run('Check')).code,'MIGRATION_BASELINE_MISMATCH')
      await pool.query("DELETE FROM pgmigrations WHERE name='unexpected'")
    })
    await t.test('existing DB clients block destructive phase', async () => {
      const result = await run('Backup')
      assert.equal(result.code,'DATABASE_WRITERS_PRESENT')
    })
    await pool.end()
    await mkdir(backupDirectory)
    await t.test('custom dump is decoded; catalogue alone is not acceptance', async () => {
      const result = await run('Backup')
      assert.equal(result.status,'PASS',JSON.stringify(result))
      assert.equal(result.dumpDecoded,true)
      assert.equal(result.restoreAcceptance,'PENDING')
      assert.ok(!(await readdir(backupDirectory)).some(name=>name.startsWith('.pg-credential-')))
    })
    await t.test('migration refuses a backup without successful real restore', async () => {
      const result = await run('Migrate')
      assert.equal(result.status,'FAIL')
      assert.equal(result.code,'DATA_CHANGED')
    })
    await t.test('missing, identical or unprivileged restore identities cannot create a test DB', async () => {
      const before=(await adminPool.query('SELECT datname FROM pg_database ORDER BY datname')).rows
      for (const [credentials,code] of [[undefined,'RESTORE_ADMIN_CREDENTIAL_REQUIRED'],
        [{username:'hb_api',password:decodeURIComponent(new URL(databaseUrl).password)},'RESTORE_ADMIN_SEPARATE_ROLE_REQUIRED'],
        [{username:'hb_no_create',password:'synthetic-no-create'},'RESTORE_ADMIN_CREATEDB_REQUIRED']]) {
        assert.equal((await run('ValidateBackup',{restoreAdmin:credentials})).code,code)
        assert.deepEqual((await adminPool.query('SELECT datname FROM pg_database ORDER BY datname')).rows,before)
      }
    })
    await t.test('restore validates all public tables and rehearses real 0075', async () => {
      const result = await run('ValidateBackup')
      assert.equal(result.status,'PASS',JSON.stringify(result))
      assert.equal(result.migrationRehearsal,'PASS')
      assert.equal(result.temporaryDatabaseRemoved,true)
      assert.ok(!(await readdir(backupDirectory)).some(name=>name.startsWith('.pg-credential-')))
      const apiRole=(await adminPool.query("SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname='hb_api'")).rows[0]
      assert.deepEqual(apiRole,{rolsuper:false,rolcreatedb:false,rolcreaterole:false})
      assert.equal((await run('Check')).appliedCount,74)
    })
    await t.test('changed dump fails before restore', async () => {
      const file = join(backupDirectory,'database.dump')
      const bytes = await readFile(file)
      await appendFile(file,'tamper')
      assert.equal((await run('ValidateBackup')).code,'BACKUP_HASH_MISMATCH')
      assert.equal((await run('Migrate')).code,'BACKUP_HASH_MISMATCH')
      await writeFile(file,bytes)
      assert.equal((await run('ValidateBackup')).status,'PASS')
    })
    await t.test('restore failure cleans temporary database and does not authorize migration', async () => {
      const file = join(backupDirectory,'database.dump')
      const metadata = join(backupDirectory,'database-backup.json')
      const bytes = await readFile(file), originalRecord = await readFile(metadata)
      const corrupt = Buffer.from('not a pg archive')
      const record = JSON.parse(originalRecord)
      record.sha256=createHash('sha256').update(corrupt).digest('hex'); record.bytes=corrupt.length
      await writeFile(file,corrupt); await writeFile(metadata,JSON.stringify(record))
      assert.equal((await run('ValidateBackup')).code,'RESTORE_FAILED')
      assert.ok(!(await readdir(backupDirectory)).some(name=>name.startsWith('.pg-credential-')))
      assert.equal((await run('Migrate')).status,'FAIL')
      const inspect = new Pool({connectionString:databaseUrl})
      try { assert.equal((await inspect.query("SELECT 1 FROM pg_database WHERE datname LIKE 'hb0191_restore_%_test'")).rowCount,0) } finally { await inspect.end() }
      await writeFile(file,bytes); await writeFile(metadata,originalRecord)
    })
    let independentEvidence
    await t.test('pinned legacy proof is upgraded only by a real independent restore; source roles and data do not change', async () => {
      const record=JSON.parse(await readFile(join(backupDirectory,'database-backup.json'),'utf8'))
      const source=new Pool({connectionString:databaseUrl})
      let tables, rows=0n
      try {
        tables=(await source.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows
        for(const {tablename} of tables) rows+=BigInt((await source.query('SELECT count(*)::text AS n FROM public."'+tablename.replaceAll('"','""')+'"')).rows[0].n)
      } finally {await source.end()}
      const baseline={migrations:74,tableCount:tables.length,rowCount:rows.toString(),fingerprint:record.contentSha256}
      const report={at:new Date().toISOString(),status:'PASS',realOfficeHost:true,productionModified:false,clusterStopped:true,baseline,finalFingerprint:baseline.fingerprint,
        backup:{path:join(backupDirectory,'database.dump'),sha256:record.sha256,bytes:record.bytes},checks:[
          {name:'Verified existing real production backup hash, size and full decode',status:'PASS'},
          {name:'Independent PostgreSQL 17.11 cluster, loopback-only port, SCRAM and separate data',status:'PASS',version:'17.11',listen:'127.0.0.1'},
          {name:'All 134 restored table row counts and SHA-256 match the original production backup snapshot',status:'PASS',matchedTables:tables.length},
          {name:'Actual production dump restored; tables, row counts, constraints and 74 migrations verified',status:'PASS',...baseline},
          ...['Real 0075 applied once; valid/invalid constraint cases and data fingerprint preserved','Actual 0.1.91 entrypoint with migrated real-data clone: DB health and real Desktop/Web config','Actual 0.1.90 production API entrypoint remains compatible with 0075','Isolated 0075 down/reapply rehearsal preserves all original row fingerprints; production down not executed'].map(name=>({name,status:'PASS'}))]}
      const legacyRoot=join(backupDirectory,'legacy-input'),reportPath=join(legacyRoot,'fresh-restore','isolated-restore-result.json')
      await mkdir(join(legacyRoot,'fresh-restore'),{recursive:true})
      await writeFile(reportPath,JSON.stringify(report))
      const manifestPath=join(legacyRoot,'manifest.json')
      await writeFile(manifestPath,JSON.stringify({entries:[{path:'fresh-restore/isolated-restore-result.json',sha256:await restoreFileHash(reportPath),bytes:(await readFile(reportPath)).length}]}))
      const legacyEvidence={manifestPath,sha256:await restoreFileHash(manifestPath),report:'fresh-restore/isolated-restore-result.json'}
      const output=join(backupDirectory,'independent-upgrade');await mkdir(output)
      const beforeDatabases=(await adminPool.query('SELECT datname FROM pg_database ORDER BY datname')).rows
      const beforeRoles=(await adminPool.query("SELECT rolname,rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname IN ('hb_api','hb_restore') ORDER BY rolname")).rows
      const result=await run('RehearseBackup',{restoreAdmin:undefined,legacyEvidence,backupDirectory:output,productionDataDirectory:process.env.HB_TRANSITION_TEST_PGDATA})
      assert.equal(result.status,'PASS',JSON.stringify(result))
      assert.equal(result.clusterStopped,true)
      assert.equal(result.rollbackReapply,'PASS')
      assert.equal(JSON.parse(await readFile(result.evidencePath,'utf8')).checks.restoreRoleUnprivileged,true)
      independentEvidence={path:result.evidencePath,sha256:result.evidenceSha256}
      assert.ok(!(await readdir(output)).some(name=>name.startsWith('.independent-restore-') || name.startsWith('.pg-credential-')))
      assert.deepEqual((await adminPool.query('SELECT datname FROM pg_database ORDER BY datname')).rows,beforeDatabases)
      assert.deepEqual((await adminPool.query("SELECT rolname,rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname IN ('hb_api','hb_restore') ORDER BY rolname")).rows,beforeRoles)
      assert.equal((await run('Check')).appliedCount,74)
      assert.equal((await run('RehearseBackup',{restoreAdmin:undefined,legacyEvidence,backupDirectory:output,productionDataDirectory:process.env.HB_TRANSITION_TEST_PGDATA})).code,'RESTORE_EVIDENCE_PATH_INVALID')
      for(const [name,change,code] of [
        ['expired',r=>r.at=new Date(Date.now()-MAX_RESTORE_EVIDENCE_AGE_MS-60_000).toISOString(),'RESTORE_EVIDENCE_EXPIRED'],
        ['missing-check',r=>r.checks.pop(),'RESTORE_EVIDENCE_INCOMPLETE'],
        ['wrong-version',r=>r.checks[1].version='17.12','RESTORE_EVIDENCE_VERSION_MISMATCH'],
        ['wrong-count',r=>r.baseline.rowCount='1','RESTORE_EVIDENCE_INVALID'],
      ]) {
        const altered=structuredClone(report);change(altered)
        await writeFile(reportPath,JSON.stringify(altered))
        await writeFile(manifestPath,JSON.stringify({entries:[{path:'fresh-restore/isolated-restore-result.json',sha256:await restoreFileHash(reportPath),bytes:(await readFile(reportPath)).length}]}))
        const rejectedOutput=join(backupDirectory,'rejected-'+name);await mkdir(rejectedOutput)
        const rejected=await run('RehearseBackup',{restoreAdmin:undefined,legacyEvidence:{...legacyEvidence,sha256:await restoreFileHash(manifestPath)},backupDirectory:rejectedOutput,productionDataDirectory:process.env.HB_TRANSITION_TEST_PGDATA})
        assert.equal(rejected.code,code,JSON.stringify(rejected))
        assert.deepEqual(await readdir(rejectedOutput),[])
      }
    })
    await t.test('readiness can be refreshed from a new consistent online snapshot without any previous PASS or CREATEDB', async () => {
      const output=join(backupDirectory,'online-refresh');await mkdir(output)
      const source=new Pool({connectionString:databaseUrl})
      try {
        const result=await run('RehearseBackup',{restoreAdmin:undefined,backupDirectory:output,productionDataDirectory:process.env.HB_TRANSITION_TEST_PGDATA})
        assert.equal(result.status,'PASS',JSON.stringify(result))
        assert.equal(result.restoreStrategy,'isolated-cluster')
        assert.equal(JSON.parse(await readFile(join(output,'database-backup.json'),'utf8')).onlineSourceSnapshotReadOnly,true)
        assert.equal((await source.query('SELECT count(*)::int AS n FROM pgmigrations')).rows[0].n,74)
        assert.ok(!(await readdir(output)).some(name=>name.startsWith('.independent-restore-')))
      } finally {await source.end()}
    })
    await t.test('independent preflight cannot claim to have validated a future backup; tampered and expired evidence fail', async () => {
      const result=await run('Check',{restoreAdmin:undefined,restoreEvidence:independentEvidence})
      assert.equal(result.status,'PASS',JSON.stringify(result))
      assert.equal(result.restoreAdmin.supplied,false)
      assert.equal(result.restoreAcceptance,'PENDING')
      assert.equal(result.independentRestore.freshBackupRehearsalRequired,true)
      assert.equal((await run('Check',{restoreAdmin:undefined,restoreEvidence:{...independentEvidence,sha256:'0'.repeat(64)}})).code,'RESTORE_EVIDENCE_HASH_MISMATCH')
      const stale=JSON.parse(await readFile(independentEvidence.path,'utf8'));stale.completedAt=new Date(Date.now()-MAX_RESTORE_EVIDENCE_AGE_MS-60_000).toISOString()
      const staleDir=join(backupDirectory,'expired-evidence');await mkdir(staleDir)
      const path=join(staleDir,'restore-evidence.json');await writeFile(path,JSON.stringify(stale));await copyFile(join(independentEvidence.path,'..','database.dump'),join(staleDir,'database.dump'))
      assert.equal((await run('Check',{restoreAdmin:undefined,restoreEvidence:{path,sha256:await restoreFileHash(path)}})).code,'RESTORE_EVIDENCE_EXPIRED')
      const file=join(candidate,'dist','index.js'),before=await readFile(file)
      try {
        await appendFile(file,'\n// independent evidence binding regression\n')
        assert.equal((await run('Check',{restoreAdmin:undefined,restoreEvidence:independentEvidence})).code,'RESTORE_EVIDENCE_BINDING_MISMATCH')
      } finally {await writeFile(file,before)}
    })
    await t.test('independent mode restores this exact new backup again and requires its new receipt at migration', async () => {
      const result=await run('ValidateBackup',{restoreAdmin:undefined,restoreEvidence:independentEvidence,productionDataDirectory:process.env.HB_TRANSITION_TEST_PGDATA})
      assert.equal(result.status,'PASS',JSON.stringify(result))
      assert.equal(result.restoreStrategy,'isolated-cluster')
      assert.notEqual(result.evidenceSha256,independentEvidence.sha256)
      const proof=join(backupDirectory,'restore-evidence.json'),before=await readFile(proof)
      try {
        await appendFile(proof,' ')
        assert.equal((await run('Migrate',{restoreAdmin:undefined,restoreEvidence:independentEvidence})).code,'RESTORE_EVIDENCE_HASH_MISMATCH')
      } finally {await writeFile(proof,before)}
    })
    await t.test('approved migration changes only 0075 and preserves content', async () => {
      const result = await run('Migrate')
      assert.equal(result.status,'PASS',JSON.stringify(result))
      assert.deepEqual(result.applied,['0075_google_desktop_loopback'])
      const verified = await run('Verify')
      assert.equal(verified.status,'PASS',JSON.stringify(verified))
      assert.equal(verified.dataPreserved,true)
      assert.deepEqual((await run('Migrate')).applied,[])
    })
    await t.test('same-name but weakened OAuth constraint is rejected', async () => {
      const inspect = new Pool({connectionString:databaseUrl})
      try {
        const definition = (await inspect.query("SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid='google_oauth_states'::regclass AND conname='google_desktop_login_only'")).rows[0].d
        await inspect.query('ALTER TABLE google_oauth_states DROP CONSTRAINT google_desktop_login_only')
        await inspect.query('ALTER TABLE google_oauth_states ADD CONSTRAINT google_desktop_login_only CHECK (true)')
        assert.equal((await run('Verify')).code,'MIGRATION_SCHEMA_INVALID')
        await inspect.query('ALTER TABLE google_oauth_states DROP CONSTRAINT google_desktop_login_only')
        await inspect.query('ALTER TABLE google_oauth_states ADD CONSTRAINT google_desktop_login_only '+definition)
      } finally { await inspect.end() }
    })
    await t.test('missing database emits safe SQLSTATE', async () => {
      const absent = new URL(databaseUrl); absent.pathname='/hb_missing_operator_test'
      const result = await run('Check',{databaseUrl:absent.href})
      assert.equal(result.code,'3D000')
      assert.ok(!JSON.stringify(result).includes('hb_missing_operator_test'))
    })
    await t.test('real candidate config + read-only health + Google status; no mail worker', () => {
      const stdout = execFileSync(process.execPath,[resolve('deploy/windows-service/api-transition-probe.mjs'),candidate],{
        windowsHide:true, encoding:'utf8', timeout:30000,
        env:{SystemRoot:process.env.SystemRoot,PATH:process.env.PATH,NODE_ENV:'production',DATABASE_URL:databaseUrl,
          GOOGLE_CLIENT_ID:'web.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'synthetic-web-secret',
          GOOGLE_REDIRECT_URI:'https://office.example.test/api/v1/google/callback',GOOGLE_TOKEN_ENCRYPTION_KEY:'1'.repeat(64),GOOGLE_LOGIN_DOMAIN:'example.test',
          GOOGLE_DESKTOP_CLIENT_ID:'desktop.apps.googleusercontent.com',TRUST_LOOPBACK_PROXY:'true'} })
      const result = JSON.parse(stdout)
      assert.equal(result.status,'PASS')
      assert.equal(result.readOnlyDatabaseHealth,'PASS')
      assert.equal(result.desktopOAuthConfigured,true)
      assert.equal(result.interactiveGoogleAndGmail,'PENDING')
    })
  } finally { if (!pool.ended) await pool.end(); await adminPool.end() }
})
