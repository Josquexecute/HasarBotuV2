import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'
import { readFile, writeFile, readdir, mkdir, stat } from 'node:fs/promises'
import { inspectLocalPostgres, passfileUsers, serviceProfiles } from './inspect-local-postgres.mjs'

test('existing credential metadata handles escaping, wildcards and INI without disclosing passwords',()=>{
  assert.deepEqual(passfileUsers('# ignored\n127.0.0.1:5432:*:native\\:owner:synthetic\\:password\n*:*:*:*:fixture\n','127.0.0.1','5432','postgres'),['native:owner','*'])
  assert.deepEqual(passfileUsers('elsewhere:5432:*:other:fixture','127.0.0.1','5432','postgres'),[])
  assert.equal(serviceProfiles('[local]\nhost=127.0.0.1\nuser=actual_role\npassword=synthetic-secret')[0].values.user,'actual_role')
})

const enabled=!!process.env.HB_TRANSITION_TEST_PGDATA && !!process.env.HB_TRANSITION_TEST_CLUSTER_URL
test('PostgreSQL 17 local discovery and streaming restore never change source/config/credentials',{skip:!enabled,timeout:180000},async t=>{
  const runtime=resolve(process.env.HB_TRANSITION_TEST_RUNTIME)
  const pgBin=resolve(process.env.HB_TRANSITION_TEST_PG_BIN)
  const data=resolve(process.env.HB_TRANSITION_TEST_PGDATA)
  const directory=join(resolve(process.env.HB_TRANSITION_TEST_ROOT),'native-auth')
  await mkdir(directory)
  const {Pool}=createRequire(join(runtime,'services/api/package.json'))('pg')
  const clusterUrl=new URL(process.env.HB_TRANSITION_TEST_CLUSTER_URL)
  const originalApi=new URL(process.env.TEST_DATABASE_URL)
  assert.ok(originalApi.pathname.endsWith('_test') && ['127.0.0.1','localhost'].includes(clusterUrl.hostname) && clusterUrl.host === originalApi.host)
  const admin=new Pool({connectionString:clusterUrl.href})
  const apiUrl=new URL(originalApi);apiUrl.pathname='/hb_auth_discovery_test'
  const sourceAdminUrl=new URL(clusterUrl);sourceAdminUrl.pathname=apiUrl.pathname
  let sourceAdmin,api,created=false
  const hbaPath=join(data,'pg_hba.conf'),identPath=join(data,'pg_ident.conf')
  const originalHba=await readFile(hbaPath),originalIdent=await readFile(identPath)
  const password='native-fixture-şifre%40'
  const request={databaseUrl:apiUrl.href,runtime,pgBin,hbaPaths:[hbaPath],passFiles:[],serviceFiles:[],rehearse:false}
  const invoke=extra=>inspectLocalPostgres({...request,...extra})
  try {
    await admin.query('CREATE DATABASE hb_auth_discovery_test')
    created=true
    await admin.query("CREATE ROLE hb_native LOGIN NOSUPERUSER CREATEDB NOCREATEROLE PASSWORD '"+password+"'")
    sourceAdmin=new Pool({connectionString:sourceAdminUrl.href})
    await sourceAdmin.query('GRANT USAGE,CREATE ON SCHEMA public TO hb_api')
    const {runMigrations}=await import(pathToFileURL(join(runtime,'packages/database/dist/index.js')).href)
    await runMigrations({databaseUrl:apiUrl.href,count:74,quiet:true})
    api=new Pool({connectionString:apiUrl.href})
    await api.query('CREATE TABLE native_preservation (id integer PRIMARY KEY,payload text)')
    await api.query("INSERT INTO native_preservation VALUES (1,'synthetic-private-row')")
    await sourceAdmin.query('GRANT USAGE ON SCHEMA public TO hb_native')
    await sourceAdmin.query('GRANT SELECT ON ALL TABLES IN SCHEMA public TO hb_native')
    await sourceAdmin.query('GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO hb_native')
    const roleState=async()=>(await admin.query("SELECT rolname,rolsuper,rolcreatedb,rolcreaterole FROM pg_roles ORDER BY rolname")).rows
    const dbState=async()=>(await admin.query('SELECT datname,datdba FROM pg_database ORDER BY datname')).rows
    await t.test('SCRAM without stored credentials is blocked; no username or password guesses',async()=>{
      const beforeRoles=await roleState(),beforeDb=await dbState()
      const result=await invoke({rehearse:true})
      assert.equal(result.code,'LOCAL_ADMIN_AUTH_UNAVAILABLE')
      assert.equal(result.passwordsWritten,false)
      assert.equal(result.authentication.available,false)
      assert.deepEqual(await roleState(),beforeRoles)
      assert.deepEqual(await dbState(),beforeDb)
      assert.deepEqual(await readdir(directory),[])
      assert.ok(!JSON.stringify(result).includes('synthetic-private-row') && !JSON.stringify(result).includes('native-fixture'))
    })
    const passfile=join(directory,'existing-pgpass.conf')
    await writeFile(passfile,`localhost:${apiUrl.port}:*:hb_native:${password}\n`)
    const passBytes=await readFile(passfile),passModified=(await stat(passfile)).mtimeMs
    await t.test('existing passfile is reused read-only, including localhost alias and Unicode password',async()=>{
      const before=await dbState()
      const result=await invoke({passFiles:[passfile]})
      assert.equal(result.status,'DISCOVERY_PASS',JSON.stringify(result))
      assert.equal(result.authentication.selectedMethod,'existing_passfile')
      assert.equal(result.restoreAcceptance,'PENDING')
      assert.deepEqual(await dbState(),before)
      assert.deepEqual(await readFile(passfile),passBytes)
      assert.equal((await stat(passfile)).mtimeMs,passModified)
    })
    await t.test('streaming restore and trusted 0075 run only inside the generated test DB',async()=>{
      const beforeRoles=await roleState(),beforeDb=await dbState()
      const result=await invoke({passFiles:[passfile],rehearse:true})
      assert.equal(result.status,'RESTORE_REHEARSAL_PASS',JSON.stringify(result))
      assert.equal(result.restoreAcceptance,'PASS')
      assert.equal(result.migrationRehearsal,'PASS')
      assert.equal(result.temporaryDatabaseRemoved,true)
      assert.match(result.dump.sha256,/^[a-f0-9]{64}$/)
      assert.ok(result.dump.bytes > 0)
      assert.deepEqual(await roleState(),beforeRoles)
      assert.deepEqual(await dbState(),beforeDb)
      assert.deepEqual(await readFile(passfile),passBytes)
      assert.deepEqual(await readdir(directory),['existing-pgpass.conf'])
      assert.equal((await api.query('SELECT count(*)::int AS n FROM pgmigrations')).rows[0].n,74)
      assert.equal((await api.query("SELECT 1 FROM information_schema.columns WHERE table_name='google_oauth_states' AND column_name='desktop_redirect_uri'")).rowCount,0)
      assert.equal((await api.query('SELECT payload FROM native_preservation')).rows[0].payload,'synthetic-private-row')
    })
    await t.test('existing service definition authenticates without extracting or copying its password',async()=>{
      const profile=join(directory,'existing-service.conf')
      const content=`[office]\nhost=127.0.0.1\nport=${apiUrl.port}\nuser=hb_native\npassword=${password}\noptions=-c default_transaction_read_only=off\n`
      await writeFile(profile,content)
      const before=await dbState()
      const result=await invoke({serviceFiles:[profile]})
      assert.equal(result.status,'DISCOVERY_PASS',JSON.stringify(result))
      assert.equal(result.authentication.selectedMethod,'existing_service')
      assert.equal(await readFile(profile,'utf8'),content)
      assert.deepEqual(await dbState(),before)
      assert.ok(!JSON.stringify(result).includes(password))
    })
    await t.test('insufficient source privileges are refused before any test DB is created',async()=>{
      await sourceAdmin.query('REVOKE SELECT ON google_oauth_states FROM hb_native')
      const before=await dbState()
      const result=await invoke({passFiles:[passfile],rehearse:true})
      assert.equal(result.code,'LOCAL_ADMIN_SOURCE_READ_REQUIRED')
      assert.equal(result.restoreAcceptance,'PENDING')
      assert.deepEqual(await dbState(),before)
      await sourceAdmin.query('GRANT SELECT ON google_oauth_states TO hb_native')
    })
    await t.test('a real pg_dump failure after CREATE DATABASE cleans only its own test DB',async()=>{
      await sourceAdmin.query('CREATE SCHEMA native_unreadable;CREATE TABLE native_unreadable.blocked (id integer)')
      const before=await dbState()
      try {
        const result=await invoke({passFiles:[passfile],rehearse:true})
        assert.equal(result.code,'RESTORE_STREAM_FAILED',JSON.stringify(result))
        assert.equal(result.temporaryDatabaseRemoved,true)
        assert.equal(result.restoreAcceptance,'PENDING')
        assert.deepEqual(await dbState(),before)
      } finally { await sourceAdmin.query('DROP TABLE native_unreadable.blocked;DROP SCHEMA native_unreadable') }
    })
    await t.test('an existing weakened 0075 fails verification without repairing the source',async()=>{
      await runMigrations({databaseUrl:apiUrl.href,quiet:true})
      const original=(await api.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='google_oauth_states'::regclass AND conname='google_desktop_login_only'")).rows[0].definition
      await api.query('ALTER TABLE google_oauth_states DROP CONSTRAINT google_desktop_login_only;ALTER TABLE google_oauth_states ADD CONSTRAINT google_desktop_login_only CHECK (true)')
      const before=await dbState()
      try {
        const result=await invoke({passFiles:[passfile],rehearse:true})
        assert.equal(result.code,'RESTORE_SCHEMA_INVALID',JSON.stringify(result))
        assert.equal(result.temporaryDatabaseRemoved,true)
        assert.equal(result.restoreAcceptance,'PENDING')
        assert.deepEqual(await dbState(),before)
        const current=(await api.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='google_oauth_states'::regclass AND conname='google_desktop_login_only'")).rows[0].definition
        assert.ok(current.includes('true'))
      } finally { await api.query('ALTER TABLE google_oauth_states DROP CONSTRAINT google_desktop_login_only;ALTER TABLE google_oauth_states ADD CONSTRAINT google_desktop_login_only '+original) }
    })
    await t.test('Windows SSPI uses the current OS token and the existing role map, with no passwords',async()=>{
      await admin.query('CREATE ROLE hb_native_sspi LOGIN CREATEDB NOSUPERUSER NOCREATEROLE')
      await sourceAdmin.query('GRANT USAGE ON SCHEMA public TO hb_native_sspi')
      await sourceAdmin.query('GRANT SELECT ON ALL TABLES IN SCHEMA public TO hb_native_sspi')
      await sourceAdmin.query('GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO hb_native_sspi')
      const username=process.env.USERNAME
      assert.match(username,/^[a-zA-Z0-9._-]+$/)
      await writeFile(identPath,`hb_native_map ${username} hb_native_sspi\n`)
      await writeFile(hbaPath,'host all hb_native_sspi 127.0.0.1/32 sspi include_realm=0 map=hb_native_map\n'+originalHba.toString('utf8'))
      await admin.query('SELECT pg_reload_conf()')
      const before=await dbState(),hba=await readFile(hbaPath),ident=await readFile(identPath)
      const result=await invoke({rehearse:true})
      assert.equal(result.status,'RESTORE_REHEARSAL_PASS',JSON.stringify(result))
      assert.equal(result.authentication.selectedMethod,'existing_windows_or_passwordless_auth')
      assert.ok(result.authentication.configuredMethods.includes('sspi'))
      assert.equal(result.temporaryDatabaseRemoved,true)
      assert.deepEqual(await dbState(),before)
      assert.deepEqual(await readFile(hbaPath),hba)
      assert.deepEqual(await readFile(identPath),ident)
    })
    await t.test('an already-capable API role is reused without granting it any new rights or writing its password',async()=>{
      const url=new URL(apiUrl);url.password='synthetic-existing-api'
      await admin.query("ALTER ROLE hb_api CREATEDB PASSWORD 'synthetic-existing-api'")
      const beforeRoles=await roleState(),beforeDb=await dbState(),beforeFiles=await readdir(directory)
      try {
        const result=await invoke({databaseUrl:url.href,rehearse:true})
        assert.equal(result.status,'RESTORE_REHEARSAL_PASS',JSON.stringify(result))
        assert.equal(result.authentication.selectedMethod,'existing_api_connection')
        assert.equal(result.authentication.existingApiRole,true)
        assert.equal(result.passwordsWritten,false)
        assert.equal(result.temporaryDatabaseRemoved,true)
        assert.deepEqual(await roleState(),beforeRoles)
        assert.deepEqual(await dbState(),beforeDb)
        assert.deepEqual(await readdir(directory),beforeFiles)
        assert.ok(!JSON.stringify(result).includes('synthetic-existing-api'))
      } finally { await admin.query("ALTER ROLE hb_api NOCREATEDB PASSWORD '"+decodeURIComponent(originalApi.password)+"'") }
    })
  } finally {
    await writeFile(hbaPath,originalHba);await writeFile(identPath,originalIdent)
    await admin.query('SELECT pg_reload_conf()')
    if(api) await api.end()
    if(sourceAdmin) await sourceAdmin.end()
    if(created) await admin.query('DROP DATABASE hb_auth_discovery_test')
    await admin.end()
  }
})
