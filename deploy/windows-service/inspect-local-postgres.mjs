import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'
import { readFile, readdir, lstat } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { fingerprint } from './api-transition-database.mjs'

const fail = code => { throw Error(code) }
const assert = (condition, code) => { if (!condition) fail(code) }
const quote = value => '"'+value.replaceAll('"','""')+'"'
const literal = value => "'"+value.replaceAll("'","''")+"'"
const connValue = value => "'"+String(value).replaceAll('\\','\\\\').replaceAll("'","\\'")+"'"
const methods = new Set(['trust','reject','scram-sha-256','md5','password','sspi','gss','cert','ident','peer','ldap','radius','pam'])
const safeCodes = new Set(['LOCAL_DATABASE_REQUIRED','POSTGRESQL17_REQUIRED','LOCAL_ADMIN_AUTH_UNAVAILABLE','LOCAL_ADMIN_SOURCE_READ_REQUIRED',
  'NATIVE_QUERY_FAILED','NATIVE_RESULT_INVALID','SOURCE_BASELINE_INVALID','RESTORE_STREAM_FAILED','RESTORE_CONTENT_MISMATCH',
  'RESTORE_SCHEMA_INVALID','TEST_DATABASE_CLEANUP_FAILED','KNOWN_ROLE_LIMIT_EXCEEDED','LOCAL_CONFIG_INVALID'])

async function localFile(path) {
  assert(typeof path === 'string' && /^[A-Za-z]:[\\/]/.test(path),'LOCAL_CONFIG_INVALID')
  const full=resolve(path)
  // Do not follow an alternate profile's junctions into credential stores.
  let ancestor=full
  while (ancestor !== resolve(ancestor,'..')) {
    assert(!(await lstat(ancestor)).isSymbolicLink(),'LOCAL_CONFIG_INVALID')
    ancestor=resolve(ancestor,'..')
  }
  assert((await lstat(full)).isFile(),'LOCAL_CONFIG_INVALID')
  assert((await lstat(full)).size <= 1024*1024,'LOCAL_CONFIG_INVALID')
  return full
}

export function passfileUsers(text, host, port, database) {
  const users=[]
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue
    const fields=['']; let escaped=false
    for (const char of line) {
      if (escaped) { fields[fields.length-1]+=char; escaped=false }
      else if (char === '\\') escaped=true
      else if (char === ':') fields.push('')
      else fields[fields.length-1]+=char
    }
    if (fields.length !== 5 || escaped) continue
    const match=(value,actual) => value === '*' || value === actual
    if (match(fields[0],host) && match(fields[1],port) && match(fields[2],database)) users.push(fields[3])
  }
  return [...new Set(users)]
}

export function serviceProfiles(text) {
  const profiles=[]; let profile
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue
    const section=line.match(/^\s*\[([^\]\r\n]+)\]\s*$/)
    if (section) { profile={name:section[1],values:{}}; profiles.push(profile); continue }
    const setting=line.match(/^\s*([a-z_]+)\s*=\s*(.*?)\s*$/)
    if (profile && setting) profile.values[setting[1]]=setting[2]
  }
  return profiles
}

function nativeEnvironment() {
  // Never inherit operator PG* credentials, RC files or API secrets.
  return Object.fromEntries(['SystemRoot','PATH','TEMP','TMP','APPDATA','USERPROFILE','COMSPEC'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]))
}
function nativeClient(pgBin, endpoint, auth, database, readOnly=true) {
  const env=nativeEnvironment()
  env.PGCLIENTENCODING='UTF8'
  // Reuse the already-configured API credential only if that role ALREADY has
  // CREATEDB. ASCII avoids libpq's Windows ANSI password conversion. This is a
  // private child environment, never a persistent environment or password file.
  if (auth.password !== undefined) env.PGPASSWORD=auth.password
  if (auth.passfile) env.PGPASSFILE=auth.passfile
  else env.PGPASSFILE=join(pgBin,'hasarbotu-no-password-file-'+randomBytes(12).toString('hex')) // Nonexistent; never created.
  if (auth.serviceFile) { env.PGSERVICEFILE=auth.serviceFile; env.PGSERVICE=auth.service }
  const conn={host:auth.host ?? endpoint.hostname,hostaddr:endpoint.actualAddress,port:endpoint.port || '5432',dbname:database,user:auth.user,connect_timeout:'3',
    sslmode:endpoint.searchParams.get('sslmode') ?? 'prefer',options:readOnly ? '-c default_transaction_read_only=on -c statement_timeout=60000' : '-c statement_timeout=60000'}
  const connection=Object.entries(conn).map(([key,value])=>key+'='+connValue(value)).join(' ')
  const call=sql => {
    const child=spawnSync(join(pgBin,'psql.exe'),['-X','--no-password','-qAt','-v','ON_ERROR_STOP=1','--dbname='+connection],
      {env,windowsHide:true,input:sql,encoding:'utf8',timeout:75000,maxBuffer:8*1024*1024})
    assert(child.status === 0,'NATIVE_QUERY_FAILED')
    return child.stdout.trim()
  }
  return {env,connection,exec:call,async query(sql) {
    const output=call("SELECT coalesce(json_agg(row_to_json(hb_result)), '[]'::json) FROM ("+sql+") hb_result;")
    let rows
    try { rows=JSON.parse(output) } catch { fail('NATIVE_RESULT_INVALID') }
    assert(Array.isArray(rows),'NATIVE_RESULT_INVALID')
    return {rows,rowCount:rows.length}
  }}
}

async function restoreStream(pgBin, source, target, snapshot) {
  const dump=spawn(join(pgBin,'pg_dump.exe'),['--no-password','--format=custom','--snapshot='+snapshot,'--dbname='+source.connection],{env:source.env,windowsHide:true,stdio:['ignore','pipe','pipe']})
  const restore=spawn(join(pgBin,'pg_restore.exe'),['--no-password','--exit-on-error','--no-owner','--no-privileges','--dbname='+target.connection],{env:target.env,windowsHide:true,stdio:['pipe','ignore','pipe']})
  const hash=createHash('sha256'); let bytes=0,failed=false
  // Native stderr can contain SQL/row/credential context. Drain and discard it.
  dump.stderr.resume(); restore.stderr.resume()
  dump.stdout.on('data',chunk=>{hash.update(chunk);bytes+=chunk.length})
  restore.stdin.on('error',()=>{failed=true;dump.kill()})
  const complete=(child,other)=>new Promise(resolve=>{
    child.on('error',()=>{failed=true;other.kill();resolve(-1)})
    child.on('close',code=>{if(code !== 0){failed=true;other.kill()};resolve(code)})
  })
  const done=Promise.all([complete(dump,restore),complete(restore,dump)])
  const timer=setTimeout(()=>{failed=true;dump.kill();restore.kill()},600000)
  dump.stdout.pipe(restore.stdin)
  try { const codes=await done; assert(!failed && codes.every(code=>code === 0),'RESTORE_STREAM_FAILED'); return {bytes,sha256:hash.digest('hex')} }
  finally { clearTimeout(timer); if (dump.exitCode === null) dump.kill(); if (restore.exitCode === null) restore.kill() }
}

export async function inspectLocalPostgres(request) {
  let pool,source,created=false,testName,maintenance,stage='source_read_only'
  const report={status:'BLOCKED',productionChanged:false,passwordsWritten:false,restoreAcceptance:'PENDING',migrationRehearsal:'PENDING'}
  try {
    const endpoint=new URL(request.databaseUrl)
    assert(['postgres:','postgresql:'].includes(endpoint.protocol) && ['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname),'LOCAL_DATABASE_REQUIRED')
    assert([...endpoint.searchParams.keys()].every(key=>key === 'sslmode'),'LOCAL_DATABASE_REQUIRED')
    const sourceName=decodeURIComponent(endpoint.pathname.slice(1))
    assert(sourceName && sourceName !== 'postgres','LOCAL_DATABASE_REQUIRED')
    const require=createRequire(join(resolve(request.runtime),'services/api/package.json'))
    const {Pool}=require('pg')
    pool=new Pool({connectionString:request.databaseUrl,max:1,connectionTimeoutMillis:5000,statement_timeout:60000,options:'-c default_transaction_read_only=on'})
    source=await pool.connect()
    await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const info=(await source.query("SELECT current_user AS identity, host(inet_server_addr()) AS address, current_setting('server_version_num')::int/10000 AS major, current_setting('transaction_read_only')='on' AS readonly")).rows[0]
    assert(info.major === 17 && info.readonly,'POSTGRESQL17_REQUIRED')
    assert(['127.0.0.1','::1'].includes(info.address),'LOCAL_DATABASE_REQUIRED')
    endpoint.actualAddress=info.address
    report.sourceReadOnly=true
    const roles=(await source.query("SELECT r.rolname,r.rolcanlogin,r.rolsuper,r.rolcreatedb,r.rolcreaterole,d.datdba=r.oid AS owner_direct,pg_has_role(r.oid,d.datdba,'USAGE') AS owner_effective FROM pg_roles r JOIN pg_database d ON d.datname=current_database() ORDER BY r.rolname")).rows
    report.installerRoleMatchesCatalog=!!request.installerRole && roles.some(role=>role.rolname === request.installerRole)
    report.roles=roles.filter(role=>role.rolcanlogin).map(role=>({role:role.rolname,apiRole:role.rolname === info.identity,superuser:role.rolsuper,createdb:role.rolcreatedb,createrole:role.rolcreaterole,databaseOwnerDirect:role.owner_direct,databaseOwnerEffective:role.owner_effective}))
    const eligible=roles.filter(role=>role.rolcanlogin && (role.rolsuper || role.rolcreatedb))
    assert(eligible.length <= 16,'KNOWN_ROLE_LIMIT_EXCEEDED')
    stage='local_authentication'
    const hbaPaths=[...(request.hbaPaths ?? [])]
    const settings=(await source.query("SELECT name,setting FROM pg_settings WHERE name IN ('hba_file','data_directory')")).rows
    const hbaSetting=settings.find(row=>row.name === 'hba_file')?.setting
    if (hbaSetting) hbaPaths.unshift(hbaSetting)
    const foundMethods=new Set(); let configReadable=false
    for (const path of [...new Set(hbaPaths)]) {
      try {
        const text=await readFile(await localFile(path),'utf8'); configReadable=true
        for (const line of text.split(/\r?\n/)) {
          if (/^\s*#/.test(line)) continue
          const tokens=line.match(/(?:"(?:[^"]|"")*"|[^\s#]+)/g) ?? []
          const index=tokens[0] === 'local' ? 3 : 4
          if (methods.has(tokens[index])) foundMethods.add(tokens[index])
        }
      } catch { /* Optional metadata only; native authentication remains authoritative. */ }
    }
    report.authentication={configReadable,configuredMethods:[...foundMethods].sort(),existingPassfiles:0,existingServiceFiles:0,attempts:0,available:false}
    const candidates=[]
    const apiPassword=decodeURIComponent(endpoint.password)
    if (eligible.some(role=>role.rolname === info.identity) && /^[\x20-\x7e]*$/.test(apiPassword)) candidates.push({user:info.identity,password:apiPassword,kind:'existing_api_connection'})
    for (const path of [...new Set(request.passFiles ?? [])]) {
      try {
        const file=await localFile(path); const text=await readFile(file,'utf8'); report.authentication.existingPassfiles++
        for (const host of [...new Set([endpoint.hostname,'localhost',info.address])]) {
          for (const user of passfileUsers(text,host,endpoint.port || '5432','postgres')) {
            for (const role of eligible.filter(role=>user === '*' || role.rolname === user)) candidates.push({user:role.rolname,host,passfile:file,kind:'existing_passfile'})
          }
        }
      } catch { /* Missing/inaccessible existing credentials are never recreated. */ }
    }
    for (const path of [...new Set(request.serviceFiles ?? [])]) {
      try {
        const file=await localFile(path); report.authentication.existingServiceFiles++
        for (const profile of serviceProfiles(await readFile(file,'utf8'))) {
          const values=profile.values
          // A profile must already refer to this local endpoint. No discovery
          // may contact a remote host or use a database/role name as a URI.
          if (values.host && values.host !== endpoint.hostname && !(endpoint.hostname === '127.0.0.1' && values.host === 'localhost')) continue
          if (values.port && values.port !== (endpoint.port || '5432')) continue
          if (!eligible.some(role=>role.rolname === values.user)) continue
          if (Object.keys(values).some(key=>!['host','hostaddr','port','dbname','user','password','passfile','sslmode','options'].includes(key))) continue
          if (values.hostaddr && !['127.0.0.1','::1'].includes(values.hostaddr)) continue
          if (values.passfile) await localFile(values.passfile)
          candidates.push({user:values.user,serviceFile:file,service:profile.name,passfile:values.passfile,kind:'existing_service'})
        }
      } catch { /* Never decrypt generic vaults or guess a missing profile. */ }
    }
    // HBA includes/maps may not be readable. The server's actual auth result,
    // not this metadata parser, decides whether an existing token works.
    for (const role of eligible) candidates.push({user:role.rolname,kind:'existing_windows_or_passwordless_auth'})
    let selected
    for (const auth of candidates.slice(0,32)) {
      report.authentication.attempts++
      try {
        const native=nativeClient(request.pgBin,endpoint,auth,'postgres')
        const row=(await native.query("SELECT current_user AS identity, rolsuper OR rolcreatedb AS capable, current_setting('server_version_num')::int/10000 AS major, current_setting('transaction_read_only')='on' AS readonly FROM pg_roles WHERE rolname=current_user")).rows[0]
        if (row.identity !== auth.user || !row.capable || row.major !== info.major || !row.readonly) continue
        selected=auth
        report.authentication.available=true; report.authentication.selectedMethod=auth.kind;report.authentication.selectedRole=auth.user;report.authentication.existingApiRole=auth.user === info.identity
        break
      } catch { /* Fixed, catalog-derived identities; no password guesses or prompts. */ }
    }
    assert(selected,'LOCAL_ADMIN_AUTH_UNAVAILABLE')
    report.status='DISCOVERY_PASS'
    if (!request.rehearse) return report
    stage='restore_source_permissions'
    const nativeSource=nativeClient(request.pgBin,endpoint,selected,sourceName)
    const readable=(await nativeSource.query("SELECT NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','m') AND NOT has_table_privilege(c.oid,'SELECT')) AS allowed")).rows[0]
    assert(readable.allowed,'LOCAL_ADMIN_SOURCE_READ_REQUIRED')
    const {MIGRATIONS_DIR}=await import(pathToFileURL(join(request.runtime,'packages/database/dist/index.js')).href)
    const expected=(await readdir(MIGRATIONS_DIR)).filter(name=>/^\d{4}_.+\.js$/.test(name)).sort().map(name=>name.slice(0,-3))
    const applied=(await source.query('SELECT name FROM public.pgmigrations ORDER BY name')).rows.map(row=>row.name)
    assert(expected.length === 75 && expected.at(-1) === '0075_google_desktop_loopback' && [74,75].includes(applied.length) && applied.every((name,index)=>name === expected[index]),'SOURCE_BASELINE_INVALID')
    const before=await fingerprint(source)
    const snapshot=(await source.query('SELECT pg_export_snapshot() AS id')).rows[0].id
    testName='hb0191_local_'+randomBytes(10).toString('hex')+'_test'
    assert(/^hb0191_local_[a-f0-9]{20}_test$/.test(testName) && testName !== sourceName,'SOURCE_BASELINE_INVALID')
    report.temporaryDatabase=testName
    maintenance=nativeClient(request.pgBin,endpoint,selected,'postgres',false)
    stage='restore_create'
    maintenance.exec('CREATE DATABASE '+quote(testName)+' TEMPLATE template0;')
    created=true
    maintenance.exec('REVOKE CONNECT,TEMPORARY ON DATABASE '+quote(testName)+' FROM PUBLIC;')
    const target=nativeClient(request.pgBin,endpoint,selected,testName,false)
    stage='restore_stream'
    report.dump=await restoreStream(request.pgBin,nativeSource,target,snapshot)
    assert(await fingerprint(target) === before,'RESTORE_CONTENT_MISMATCH')
    const names=(await target.query('SELECT name FROM public.pgmigrations ORDER BY name')).rows.map(row=>row.name)
    assert(JSON.stringify(names) === JSON.stringify(applied),'RESTORE_CONTENT_MISMATCH')
    stage='test_migration_0075'
    const migration=await import(pathToFileURL(join(MIGRATIONS_DIR,'0075_google_desktop_loopback.js')).href)
    const {MigrationBuilder}=await import(pathToFileURL(require.resolve('node-pg-migrate')).href)
    const builder=new MigrationBuilder(target,undefined,false,{info(){},warn(){},error(){}})
    migration.up(builder)
    if (names.length === 74) target.exec('BEGIN;'+builder.getSql()+"INSERT INTO public.pgmigrations (name,run_on) VALUES ("+literal(expected.at(-1))+',now());COMMIT;')
    let expression
    migration.up({addColumn(){},addConstraint(_table,_name,options){expression=options.check}})
    target.exec('CREATE SCHEMA hb0191_schema_validation;CREATE TABLE hb0191_schema_validation.google_oauth_states (client text,purpose text,desktop_redirect_uri text);ALTER TABLE hb0191_schema_validation.google_oauth_states ADD CONSTRAINT google_desktop_login_only CHECK ('+expression+');')
    const constraints=(await target.query("SELECT pg_get_constraintdef(oid) AS definition,convalidated FROM pg_constraint WHERE conname='google_desktop_login_only' AND conrelid IN ('public.google_oauth_states'::regclass,'hb0191_schema_validation.google_oauth_states'::regclass)")).rows
    assert(constraints.length === 2 && constraints.every(row=>row.convalidated && row.definition === constraints[0].definition),'RESTORE_SCHEMA_INVALID')
    const column=(await target.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='google_oauth_states' AND column_name='desktop_redirect_uri' AND data_type='text' AND is_nullable='YES'")).rows
    const finalNames=(await target.query('SELECT name FROM public.pgmigrations ORDER BY name')).rows.map(row=>row.name)
    assert(column.length === 1 && JSON.stringify(finalNames) === JSON.stringify(expected) && await fingerprint(target) === before,'RESTORE_SCHEMA_INVALID')
    report.restoreAcceptance='PASS'; report.migrationRehearsal='PASS';report.status='RESTORE_REHEARSAL_PASS'
    return report
  } catch (error) {
    report.status='BLOCKED';report.stage=stage;report.code=safeCodes.has(error?.message) ? error.message : 'LOCAL_POSTGRES_INSPECTION_FAILED'
    return report
  } finally {
    if (created) {
      try { maintenance.exec('DROP DATABASE '+quote(testName)+';'); report.temporaryDatabaseRemoved=true }
      catch { report.status='BLOCKED';report.code='TEST_DATABASE_CLEANUP_FAILED';report.restoreAcceptance='PENDING';report.migrationRehearsal='PENDING';report.temporaryDatabaseRemoved=false }
    }
    if (source) source.release()
    if (pool) await pool.end()
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    let input='';process.stdin.setEncoding('utf8')
    for await (const chunk of process.stdin) { input+=chunk;assert(input.length <= 65536,'LOCAL_CONFIG_INVALID') }
    console.log(JSON.stringify(await inspectLocalPostgres(JSON.parse(input))))
  } catch { console.log(JSON.stringify({status:'BLOCKED',code:'LOCAL_POSTGRES_INSPECTION_FAILED',productionChanged:false,passwordsWritten:false})) }
}
