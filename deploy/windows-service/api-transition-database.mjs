import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { join, resolve, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { writeFile, readFile, rename, stat, readdir, mkdtemp, rm, rmdir } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { restoreProvenance, verifyRestoreEvidence, importLegacyRestoreBackup, withIndependentRestoreCluster, restoreFileHash } from './api-transition-restore-evidence.mjs'

const safeCodes = new Set(['28P01','28000','3D000','42P01','42501','ECONNREFUSED','ENOTFOUND','ETIMEDOUT','MODULE_NOT_FOUND','ERR_MODULE_NOT_FOUND',
  'ACTION_INVALID','MIGRATION_SET_INVALID','MIGRATION_BASELINE_MISMATCH','MIGRATION_SCHEMA_INVALID','DATABASE_URL_INVALID',
  'DATABASE_WRITERS_PRESENT','BACKUP_ARGUMENTS_REQUIRED','BACKUP_URL_OPTIONS_UNSUPPORTED','PG_DUMP_FAILED','DUMP_INVALID',
  'BACKUP_HASH_MISMATCH','RESTORE_FAILED','RESTORE_CONTENT_MISMATCH','UNEXPECTED_MIGRATION','DATA_CHANGED','PRIVILEGES_REQUIRED',
  'BACKUP_READ_PRIVILEGES_REQUIRED','MIGRATION_OBJECT_PRIVILEGES_REQUIRED','RESTORE_ADMIN_CREDENTIAL_REQUIRED','RESTORE_ADMIN_SEPARATE_ROLE_REQUIRED',
  'RESTORE_ADMIN_CREATEDB_REQUIRED','RESTORE_ADMIN_VERSION_MISMATCH','RESTORE_MAINTENANCE_DATABASE_REQUIRED','RESTORE_CLEANUP_FAILED',
  'PG_CREDENTIAL_PROTECTION_FAILED','PG_CREDENTIAL_INVALID','PG_CREDENTIAL_CLEANUP_FAILED',
  'RESTORE_MODE_CONFLICT','RESTORE_EVIDENCE_REQUIRED','RESTORE_EVIDENCE_INVALID','RESTORE_EVIDENCE_PIN_REQUIRED',
  'RESTORE_EVIDENCE_EXPIRED','RESTORE_EVIDENCE_BINDING_MISMATCH','RESTORE_EVIDENCE_VERSION_MISMATCH',
  'RESTORE_EVIDENCE_INCOMPLETE','RESTORE_EVIDENCE_BACKUP_MISMATCH','RESTORE_EVIDENCE_HASH_MISMATCH',
  'RESTORE_EVIDENCE_MISSING','RESTORE_EVIDENCE_PATH_INVALID','ISOLATED_RESTORE_PATH_INVALID',
  'ISOLATED_RESTORE_ENDPOINT_INVALID','ISOLATED_RESTORE_PROCESS_FAILED','ISOLATED_RESTORE_CLEANUP_FAILED'])
export function safeDatabaseError(error) {
  return safeCodes.has(error?.code) ? error.code : safeCodes.has(error?.message) ? error.message : 'DATABASE_OPERATION_FAILED'
}
function requireCondition(condition, code) { if (!condition) throw Error(code) }
async function hashFile(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
function pgEnvironment(value) {
  const url = new URL(value)
  requireCondition([...url.searchParams.keys()].every(key => key === 'sslmode'), 'BACKUP_URL_OPTIONS_UNSUPPORTED')
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (/^PG/i.test(key) || key === 'DATABASE_URL') delete env[key]
  return Object.assign(env, { PGHOST: url.hostname.replace(/^\[|\]$/g, ''), PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGSSLMODE: url.searchParams.get('sslmode') ?? 'prefer', PGCONNECT_TIMEOUT:'5' })
}
const quoted = name => '"' + name.replaceAll('"','""') + '"'
const hashText = value => createHash('sha256').update(value).digest('hex')
async function withPgCredentials(databaseUrl, backupDirectory, operation) {
  const env = pgEnvironment(databaseUrl)
  // Windows libpq reads PGPASSWORD through the ANSI environment. UTF-8 pgpass
  // avoids corrupting non-ASCII credentials. Restrict the directory BEFORE
  // writing any credential bytes; never put passwords in argv or tool output.
  const directory = await mkdtemp(join(resolve(backupDirectory),'.pg-credential-'))
  const path = join(directory,'pgpass.conf')
  try {
    if (process.platform === 'win32') {
      const protection = spawnSync(join(process.env.SystemRoot,'System32','icacls.exe'),[directory,'/inheritance:r','/grant:r','*S-1-5-18:(OI)(CI)F','*S-1-5-32-544:(OI)(CI)F'],{windowsHide:true,stdio:'pipe',timeout:10000})
      requireCondition(protection.status === 0,'PG_CREDENTIAL_PROTECTION_FAILED')
    }
    const url=new URL(databaseUrl)
    const parts=[env.PGHOST,env.PGPORT,env.PGDATABASE,env.PGUSER,decodeURIComponent(url.password)]
    requireCondition(parts.every(value=>!/[\r\n\0]/.test(value)),'PG_CREDENTIAL_INVALID')
    const line=parts.map(value=>value.replaceAll('\\','\\\\').replaceAll(':','\\:')).join(':')+'\n'
    await writeFile(path,line,{flag:'wx',mode:0o600})
    return await operation({...env,PGPASSFILE:path})
  } finally {
    try { await rm(path,{force:true}); await rmdir(directory) }
    catch { throw Error('PG_CREDENTIAL_CLEANUP_FAILED') }
  }
}
// Persist only a digest, never row values. Ignore the additive 0075 column when
// comparing restored/pre-migration data to post-migration production data.
export async function fingerprint(client) {
  const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'pgmigrations' ORDER BY tablename")).rows
  const result = []
  for (const { tablename } of tables) {
    const expression = tablename === 'google_oauth_states' ? "to_jsonb(t) - 'desktop_redirect_uri'" : 'to_jsonb(t)'
    const { rows } = await client.query(`SELECT count(*)::text AS n, md5(coalesce(string_agg(h, '' ORDER BY h),'')) AS h FROM (SELECT md5((${expression})::text) AS h FROM public.${quoted(tablename)} t) r`)
    result.push([tablename, rows[0].n, rows[0].h])
  }
  return createHash('sha256').update(JSON.stringify(result)).digest('hex')
}
async function quiescent(client) {
  const sessions = await client.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'")
  requireCondition(sessions.rows[0].n === 0, 'DATABASE_WRITERS_PRESENT')
}
async function permissions(client) {
  return (await client.query(`SELECT current_setting('server_version_num')::int / 10000 AS major,
    current_setting('server_version') AS version, d.oid::text AS database_oid,
    current_user AS identity, r.rolsuper AS superuser, r.rolcreatedb AS createdb,
    d.datdba=r.oid AS "databaseOwnerDirect", pg_has_role(current_user,d.datdba,'USAGE') AS "databaseOwnerEffective",
    pg_has_role(current_user,c.relowner,'USAGE') AND has_schema_privilege('public','USAGE')
      AND has_table_privilege('public.pgmigrations','SELECT') AND has_table_privilege('public.pgmigrations','INSERT')
      AND NOT EXISTS (SELECT 1 FROM pg_depend dep JOIN pg_class seq ON seq.oid=dep.objid
        WHERE dep.refobjid='public.pgmigrations'::regclass AND seq.relkind='S'
          AND NOT has_sequence_privilege(seq.oid,'USAGE')) AS "migrationCapable",
    NOT EXISTS (SELECT 1 FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast|^pg_temp'
        AND ((t.relkind IN ('r','p','m') AND (NOT has_table_privilege(t.oid,'SELECT')
          OR (t.relrowsecurity AND NOT (r.rolsuper OR r.rolbypassrls OR (pg_has_role(current_user,t.relowner,'USAGE') AND NOT t.relforcerowsecurity)))))
          OR (t.relkind='S' AND NOT has_sequence_privilege(t.oid,'SELECT')))) AS "backupReadPrivileges"
    FROM pg_roles r JOIN pg_database d ON d.datname=current_database()
    JOIN pg_class c ON c.oid='public.google_oauth_states'::regclass WHERE r.rolname=current_user`)).rows[0]
}
function restoreUrl(databaseUrl, restoreAdmin) {
  requireCondition(restoreAdmin && typeof restoreAdmin.username === 'string' && restoreAdmin.username && typeof restoreAdmin.password === 'string', 'RESTORE_ADMIN_CREDENTIAL_REQUIRED')
  const url = new URL(databaseUrl)
  requireCondition(decodeURIComponent(url.pathname.slice(1)) !== 'postgres', 'RESTORE_MAINTENANCE_DATABASE_REQUIRED')
  url.username = encodeURIComponent(restoreAdmin.username)
  url.password = encodeURIComponent(restoreAdmin.password)
  url.pathname = '/postgres'
  return url
}
async function inspectRestoreAdmin(Pool, databaseUrl, restoreAdmin, sourceInfo) {
  if (!restoreAdmin) return { supplied:false, separateRole:false, canCreateDatabase:false, sameServerMajor:false }
  const url = restoreUrl(databaseUrl,restoreAdmin)
  const pool = new Pool({connectionString:url.href,max:1,connectionTimeoutMillis:5000,options:'-c default_transaction_read_only=on',statement_timeout:10000})
  try {
    const row = (await pool.query("SELECT current_user AS identity, rolsuper OR rolcreatedb AS capable, current_setting('server_version_num')::int / 10000 AS major FROM pg_roles WHERE rolname=current_user")).rows[0]
    return {supplied:true,separateRole:row.identity !== sourceInfo.identity,canCreateDatabase:row.capable,sameServerMajor:row.major === sourceInfo.major}
  } finally { await pool.end() }
}
export async function databaseMaintenance({ action, candidate, dumpTool, backupDirectory, databaseUrl, restoreAdmin, restoreEvidence, legacyEvidence, productionDataDirectory }) {
  let pool, client, stage = 'runtime_load'
  try {
    requireCondition(['Check','Backup','ValidateBackup','RehearseBackup','Migrate','Verify','Quiescent'].includes(action), 'ACTION_INVALID')
    requireCondition(!(restoreAdmin && (restoreEvidence || legacyEvidence)), 'RESTORE_MODE_CONFLICT')
    requireCondition(!(restoreEvidence && legacyEvidence), 'RESTORE_MODE_CONFLICT')
    if (action === 'RehearseBackup') requireCondition(!restoreEvidence && !restoreAdmin && productionDataDirectory && dumpTool && backupDirectory, 'RESTORE_EVIDENCE_REQUIRED')
    else requireCondition(!legacyEvidence, 'RESTORE_MODE_CONFLICT')
    const root = resolve(candidate), require = createRequire(join(root, 'package.json'))
    const { Pool } = require('pg')
    const { runMigrations, MIGRATIONS_DIR } = await import(pathToFileURL(join(root, 'node_modules/@hasarbotu/database/dist/index.js')).href)
    const expected = (await readdir(MIGRATIONS_DIR)).filter(name => /^\d{4}_.+\.js$/.test(name)).sort().map(name => name.slice(0,-3))
    requireCondition(expected.length === 75 && expected.at(-1) === '0075_google_desktop_loopback', 'MIGRATION_SET_INVALID')
    stage = 'database_url'
    let url
    try { url = new URL(databaseUrl); decodeURIComponent(url.password); decodeURIComponent(url.username); decodeURIComponent(url.pathname) } catch { throw Error('DATABASE_URL_INVALID') }
    requireCondition(['postgres:','postgresql:'].includes(url.protocol) && url.username && url.hostname && url.pathname.length > 1, 'DATABASE_URL_INVALID')
    pool = new Pool({ connectionString:databaseUrl, max:1, connectionTimeoutMillis:5000, statement_timeout:60000,
      ...(['Check','Verify','RehearseBackup'].includes(action) ? {options:'-c default_transaction_read_only=on'} : {}) })
    client = await pool.connect()
    // Read-only checks are enforced by PostgreSQL, even for privileged roles.
    await client.query('BEGIN READ ONLY')
    stage = 'migration_baseline'
    const applied = (await client.query('SELECT name FROM public.pgmigrations ORDER BY name')).rows.map(row => row.name)
    requireCondition([74,75].includes(applied.length) && applied.every((name,i) => name === expected[i]), 'MIGRATION_BASELINE_MISMATCH')
    const info = await permissions(client)
    const source = { serverVersion:info.version, host:url.hostname, port:url.port || '5432', database:decodeURIComponent(url.pathname.slice(1)), databaseOid:info.database_oid }
    const provenance = () => restoreProvenance(root,MIGRATIONS_DIR,dumpTool,source)
    if (action === 'Check') {
      pgEnvironment(databaseUrl)
      if (restoreEvidence) {
        stage = 'independent_restore_evidence'
        await verifyRestoreEvidence(restoreEvidence,await provenance())
      }
      stage = 'restore_admin_check'
      const admin = await inspectRestoreAdmin(Pool,databaseUrl,restoreAdmin,info)
      return { status:'PASS', action, appliedCount:applied.length, pending:expected.slice(applied.length), serverMajor:info.major,
        permissions:{databaseOwnerDirect:info.databaseOwnerDirect,databaseOwnerEffective:info.databaseOwnerEffective,
          apiCreatedb:info.createdb,apiSuperuser:info.superuser,migrationCapable:info.migrationCapable,backupReadPrivileges:info.backupReadPrivileges},
        restoreAdmin:admin,restoreAcceptance:'PENDING',
        restoreStrategy:restoreEvidence ? 'isolated-cluster' : 'same-cluster',
        ...(restoreEvidence ? { independentRestore:{evidenceValid:true,evidenceSha256:restoreEvidence.sha256,freshBackupRehearsalRequired:true} } : {}) }
    }
    if (action === 'Verify') {
      stage = 'verify_schema'
      const column = await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='google_oauth_states' AND column_name='desktop_redirect_uri' AND data_type='text' AND is_nullable='YES'")
      const constraint = await client.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public.google_oauth_states'::regclass AND conname='google_desktop_login_only' AND convalidated")
      requireCondition(applied.length === 75 && column.rowCount === 1 && constraint.rowCount === 1, 'MIGRATION_SCHEMA_INVALID')
      const schemaSha256 = hashText(constraint.rows[0].definition)
      if (backupDirectory) {
        const record = JSON.parse(await readFile(join(backupDirectory, 'database-backup.json'), 'utf8'))
        requireCondition(await fingerprint(client) === record.contentSha256, 'DATA_CHANGED')
        if (record.expectedSchemaSha256) requireCondition(schemaSha256 === record.expectedSchemaSha256, 'MIGRATION_SCHEMA_INVALID')
      }
      return { status:'PASS', action, appliedCount:applied.length, schemaSha256, dataPreserved:!!backupDirectory }
    }
    await client.query('ROLLBACK')
    if (action !== 'RehearseBackup') await quiescent(client)
    if (action === 'Quiescent') return { status:'PASS', action }
    if (action === 'Backup') {
      requireCondition(info.backupReadPrivileges, 'BACKUP_READ_PRIVILEGES_REQUIRED')
      requireCondition(dumpTool && backupDirectory, 'BACKUP_ARGUMENTS_REQUIRED')
      stage = 'pg_dump'
      const out = join(resolve(backupDirectory), 'database.dump')
      const before = await fingerprint(client)
      const result = await withPgCredentials(databaseUrl,backupDirectory,env=>spawnSync(dumpTool, ['--format=custom','--file=' + out + '.partial','--no-password'], { env, windowsHide:true, timeout:600000, stdio:'pipe' }))
      requireCondition(result.status === 0, 'PG_DUMP_FAILED')
      stage = 'dump_decode'
      // A catalogue listing alone does not verify compressed data sections.
      const decoded = spawnSync(join(dirname(resolve(dumpTool)), 'pg_restore.exe'), ['--file=NUL',out + '.partial'], { env:pgEnvironment(databaseUrl), windowsHide:true, timeout:600000, stdio:'pipe' })
      requireCondition(decoded.status === 0, 'DUMP_INVALID')
      await quiescent(client)
      requireCondition(await fingerprint(client) === before, 'DATA_CHANGED')
      await rename(out + '.partial',out)
      const record = { sha256:await hashFile(out), bytes:(await stat(out)).size, contentSha256:before, restoreAcceptance:'PENDING' }
      await writeFile(join(backupDirectory,'database-backup.json'),JSON.stringify(record),{ flag:'wx' })
      await writeFile(join(backupDirectory,'SHA256SUMS.txt'),record.sha256 + '  database.dump\n',{ flag:'wx' })
      return { status:'PASS', action, bytes:record.bytes, dumpDecoded:true, restoreAcceptance:'PENDING' }
    }
    if (action === 'RehearseBackup') {
      stage = 'legacy_evidence_import'
      requireCondition((await readdir(backupDirectory)).length === 0,'RESTORE_EVIDENCE_PATH_INVALID')
      if (legacyEvidence) await importLegacyRestoreBackup(legacyEvidence,backupDirectory,info.version)
      else {
        // Refreshing readiness must not require an old PASS receipt. Capture a
        // NEW online, read-only snapshot, then actually restore that exact dump.
        requireCondition(info.backupReadPrivileges,'BACKUP_READ_PRIVILEGES_REQUIRED')
        stage = 'pg_dump'
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
        let contentSha256
        const out=join(resolve(backupDirectory),'database.dump')
        try {
          requireCondition(JSON.stringify((await client.query('SELECT name FROM public.pgmigrations ORDER BY name')).rows.map(row=>row.name)) === JSON.stringify(applied),'MIGRATION_BASELINE_MISMATCH')
          const snapshot=(await client.query('SELECT pg_export_snapshot() AS id')).rows[0].id
          contentSha256=await fingerprint(client)
          const result=await withPgCredentials(databaseUrl,backupDirectory,env=>spawnSync(dumpTool,['--format=custom','--snapshot='+snapshot,'--file='+out+'.partial','--no-password'],{env,windowsHide:true,timeout:600000,stdio:'pipe'}))
          requireCondition(result.status === 0,'PG_DUMP_FAILED')
        } finally {await client.query('ROLLBACK')}
        await rename(out+'.partial',out)
        await writeFile(join(backupDirectory,'database-backup.json'),JSON.stringify({sha256:await hashFile(out),bytes:(await stat(out)).size,contentSha256,restoreAcceptance:'PENDING',onlineSourceSnapshotReadOnly:true}),{flag:'wx'})
      }
    }
    if (action === 'ValidateBackup' || action === 'RehearseBackup') {
      stage = 'backup_hash'
      const out = join(resolve(backupDirectory), 'database.dump')
      const record = JSON.parse(await readFile(join(backupDirectory,'database-backup.json'),'utf8'))
      if (record.independentEvidenceSha256) {
        const previous = join(backupDirectory,'restore-evidence.json')
        requireCondition(await hashFile(previous) === record.independentEvidenceSha256,'RESTORE_EVIDENCE_HASH_MISMATCH')
        await rename(previous,join(backupDirectory,'restore-evidence-previous-'+randomBytes(8).toString('hex')+'.json'))
      }
      record.restoreAcceptance = 'PENDING'
      delete record.expectedSchemaSha256
      delete record.independentEvidenceSha256
      await writeFile(join(backupDirectory,'database-backup.json'),JSON.stringify(record))
      requireCondition(await hashFile(out) === record.sha256 && (await stat(out)).size === record.bytes, 'BACKUP_HASH_MISMATCH')
      const isolated = action === 'RehearseBackup' || !!restoreEvidence
      let identity
      if (isolated) {
        stage = 'independent_restore_evidence'
        identity = await provenance()
        if (restoreEvidence) await verifyRestoreEvidence(restoreEvidence,identity)
      }
      const validate = async target => {
        const testName = 'hb0191_restore_' + randomBytes(10).toString('hex') + '_test'
        stage = 'restore_admin_check'
        if (!target) {
          const admin = await inspectRestoreAdmin(Pool,databaseUrl,restoreAdmin,info)
          requireCondition(admin.supplied, 'RESTORE_ADMIN_CREDENTIAL_REQUIRED')
          requireCondition(admin.separateRole, 'RESTORE_ADMIN_SEPARATE_ROLE_REQUIRED')
          requireCondition(admin.canCreateDatabase, 'RESTORE_ADMIN_CREATEDB_REQUIRED')
          requireCondition(admin.sameServerMajor, 'RESTORE_ADMIN_VERSION_MISMATCH')
        }
        const maintenanceUrl = target ? new URL(target.url) : restoreUrl(databaseUrl,restoreAdmin)
        let maintenance = new Pool({connectionString:maintenanceUrl.href,max:1,connectionTimeoutMillis:5000,statement_timeout:60000})
        record.temporaryDatabase = testName
        await writeFile(join(backupDirectory,'database-backup.json'),JSON.stringify(record))
        let restoredPool, created = false
        try {
          if (target) {
            const checked = (await maintenance.query("SELECT current_setting('data_directory') AS data,current_setting('port') AS port,current_setting('listen_addresses') AS listen,current_setting('server_version') AS version")).rows[0]
            requireCondition(resolve(checked.data).toLowerCase() === resolve(target.data).toLowerCase() && checked.port === String(target.port) && checked.listen === '127.0.0.1' && checked.version === info.version, 'ISOLATED_RESTORE_ENDPOINT_INVALID')
            // Bootstrap privilege is used only to provision this new cluster.
            // Actual restore uses the same minimum role as the original gate;
            // it must not succeed merely because initdb created a superuser.
            const role='hb_restore_'+randomBytes(10).toString('hex'),password=randomBytes(32).toString('hex')
            await maintenance.query(`CREATE ROLE ${quoted(role)} LOGIN CREATEDB NOSUPERUSER NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`)
            maintenanceUrl.username=role;maintenanceUrl.password=password
            await maintenance.end()
            maintenance=new Pool({connectionString:maintenanceUrl.href,max:1,connectionTimeoutMillis:5000,statement_timeout:60000})
            const privileges=(await maintenance.query('SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0]
            requireCondition(privileges.rolsuper === false && privileges.rolcreatedb === true && privileges.rolcreaterole === false && privileges.rolreplication === false && privileges.rolbypassrls === false,'RESTORE_ADMIN_CREATEDB_REQUIRED')
          }
          stage = 'restore_create'
          await maintenance.query(`CREATE DATABASE ${quoted(testName)} TEMPLATE template0`)
          created = true
          await maintenance.query(`REVOKE CONNECT,TEMPORARY ON DATABASE ${quoted(testName)} FROM PUBLIC`)
          stage = 'restore_content'
          const testUrl = new URL(maintenanceUrl)
          testUrl.pathname = '/' + testName
          const restored = await withPgCredentials(testUrl.href,backupDirectory,env=>spawnSync(join(dirname(resolve(dumpTool)), 'pg_restore.exe'), ['--exit-on-error','--no-owner','--no-privileges',...(target ? ['--no-tablespaces'] : []),'--no-password','--dbname='+testName,out], { env, windowsHide:true, timeout:600000, stdio:'pipe' }))
          requireCondition(restored.status === 0, 'RESTORE_FAILED')
          restoredPool = new Pool({ connectionString:testUrl.href, max:1, connectionTimeoutMillis:5000, statement_timeout:60000 })
          requireCondition(await fingerprint(restoredPool) === record.contentSha256, 'RESTORE_CONTENT_MISMATCH')
          if (target) {
            const tables = (await restoredPool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows
            let rows = 0n
            for (const { tablename } of tables) rows += BigInt((await restoredPool.query(`SELECT count(*)::text AS n FROM public.${quoted(tablename)}`)).rows[0].n)
            record.tableCount=tables.length;record.rowCount=rows.toString()
            if (record.legacyManifestSha256) requireCondition(tables.length === record.legacyTableCount && rows.toString() === record.legacyRowCount,'RESTORE_CONTENT_MISMATCH')
          }
          const names = (await restoredPool.query('SELECT name FROM public.pgmigrations ORDER BY name')).rows.map(row=>row.name)
          requireCondition(JSON.stringify(names) === JSON.stringify(applied), 'RESTORE_CONTENT_MISMATCH')
          if (names.length === 74) await runMigrations({ databaseUrl:testUrl.href, quiet:true })
          const verified = await databaseMaintenance({ action:'Verify', candidate, databaseUrl:testUrl.href, backupDirectory })
          requireCondition(verified.status === 'PASS', 'RESTORE_CONTENT_MISMATCH')
          // Canonicalize the trusted check expression on the SAME PostgreSQL
          // version, in the disposable restored DB. Do not accept a same-name
          // constraint with different semantics (including an existing 0075).
          let expression
          const migration = await import(pathToFileURL(join(MIGRATIONS_DIR,'0075_google_desktop_loopback.js')).href)
          migration.up({ addColumn() {}, addConstraint(_table,_name,options) { expression=options.check } })
          await restoredPool.query('CREATE SCHEMA hb0191_schema_validation')
          await restoredPool.query('CREATE TABLE hb0191_schema_validation.google_oauth_states (client text, purpose text, desktop_redirect_uri text)')
          await restoredPool.query(`ALTER TABLE hb0191_schema_validation.google_oauth_states ADD CONSTRAINT google_desktop_login_only CHECK (${expression})`)
          const expected = await restoredPool.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='hb0191_schema_validation.google_oauth_states'::regclass AND conname='google_desktop_login_only'")
          record.expectedSchemaSha256 = hashText(expected.rows[0].definition)
          requireCondition(verified.schemaSha256 === record.expectedSchemaSha256, 'MIGRATION_SCHEMA_INVALID')
          if (target) {
            await restoredPool.query("INSERT INTO hb0191_schema_validation.google_oauth_states VALUES ('web','login',NULL),('desktop','login','http://127.0.0.1:54321/api/v1/google/desktop/callback')")
            let rejected = false
            try { await restoredPool.query("INSERT INTO hb0191_schema_validation.google_oauth_states VALUES ('web','login','http://127.0.0.1:54321/api/v1/google/desktop/callback')") }
            catch (error) { if (error.code !== '23514') throw error; rejected = true }
            requireCondition(rejected,'MIGRATION_SCHEMA_INVALID')
            await restoredPool.query('DROP SCHEMA hb0191_schema_validation CASCADE')
            requireCondition((await runMigrations({databaseUrl:testUrl.href,direction:'down',quiet:true}))[0]?.name === expectedMigrationName,'UNEXPECTED_MIGRATION')
            requireCondition(await fingerprint(restoredPool) === record.contentSha256,'RESTORE_CONTENT_MISMATCH')
            requireCondition((await runMigrations({databaseUrl:testUrl.href,quiet:true}))[0]?.name === expectedMigrationName,'UNEXPECTED_MIGRATION')
            const reapplied = await databaseMaintenance({action:'Verify',candidate,databaseUrl:testUrl.href,backupDirectory})
            requireCondition(reapplied.status === 'PASS' && reapplied.schemaSha256 === record.expectedSchemaSha256,'MIGRATION_SCHEMA_INVALID')
          }
        } finally {
          try {
            if (restoredPool) await restoredPool.end()
          } finally {
            try {
              if (created) {
                try { await maintenance.query(`DROP DATABASE ${quoted(testName)}`) }
                catch { stage = 'restore_cleanup'; throw Error('RESTORE_CLEANUP_FAILED') }
              }
            } finally { await maintenance.end() }
          }
        }
      }
      const expectedMigrationName = expected.at(-1)
      if (isolated) {
        stage = 'isolated_restore'
        await withIndependentRestoreCluster({parent:resolve(backupDirectory),dumpTool,expectedVersion:info.version,databaseUrl,productionDataDirectory},validate)
        requireCondition(JSON.stringify(await provenance()) === JSON.stringify(identity),'RESTORE_EVIDENCE_BINDING_MISMATCH')
        requireCondition(await hashFile(out) === record.sha256 && (await stat(out)).size === record.bytes,'BACKUP_HASH_MISMATCH')
        const receipt = {schemaVersion:'hasarbotu-independent-restore/1',status:'PASS',strategy:'isolated-cluster',completedAt:new Date().toISOString(),...identity,
          backup:{sha256:record.sha256,bytes:record.bytes,contentSha256:record.contentSha256},schemaSha256:record.expectedSchemaSha256,tableCount:record.tableCount,rowCount:record.rowCount,
          checks:{restoredContent:true,migrationSchema:true,rollbackReapply:true,temporaryDatabaseRemoved:true,clusterStopped:true,clusterDirectoryRemoved:true,restoreRoleUnprivileged:true},
          ...(record.legacyManifestSha256 ? {legacyManifestSha256:record.legacyManifestSha256} : {})}
        await writeFile(join(backupDirectory,'restore-evidence.json'),JSON.stringify(receipt),{flag:'wx'})
        record.independentEvidenceSha256 = await restoreFileHash(join(backupDirectory,'restore-evidence.json'))
        record.restoreStrategy = 'isolated-cluster'
      } else { await validate(); record.restoreStrategy = 'same-cluster' }
      record.restoreAcceptance = 'PASS'
      await writeFile(join(backupDirectory,'database-backup.json'),JSON.stringify(record))
      return { status:'PASS', action, restoreAcceptance:'PASS', migrationRehearsal:'PASS', temporaryDatabaseRemoved:true,
        ...(isolated ? {restoreStrategy:'isolated-cluster',evidencePath:join(resolve(backupDirectory),'restore-evidence.json'),evidenceSha256:record.independentEvidenceSha256,clusterStopped:true,rollbackReapply:'PASS'} : {}) }
    }
    stage = 'migration_0075'
    requireCondition(info.migrationCapable, 'MIGRATION_OBJECT_PRIVILEGES_REQUIRED')
    const record = JSON.parse(await readFile(join(backupDirectory,'database-backup.json'),'utf8'))
    requireCondition(await hashFile(join(backupDirectory,'database.dump')) === record.sha256, 'BACKUP_HASH_MISMATCH')
    if (restoreEvidence || record.restoreStrategy === 'isolated-cluster') {
      stage = 'independent_restore_evidence'
      requireCondition(record.restoreStrategy === 'isolated-cluster','RESTORE_EVIDENCE_REQUIRED')
      const proof = await verifyRestoreEvidence({path:join(resolve(backupDirectory),'restore-evidence.json'),sha256:record.independentEvidenceSha256},await provenance(),record)
      requireCondition(proof.schemaSha256 === record.expectedSchemaSha256,'MIGRATION_SCHEMA_INVALID')
    }
    requireCondition(record.restoreAcceptance === 'PASS' && record.expectedSchemaSha256 && await fingerprint(client) === record.contentSha256, 'DATA_CHANGED')
    const result = await runMigrations({ databaseUrl, quiet:true })
    requireCondition(result.every(item=>item.name === expected.at(-1)), 'UNEXPECTED_MIGRATION')
    return { status:'PASS', action, applied:result.map(item=>item.name) }
  } catch (error) {
    return { status:'FAIL', action, stage, code:safeDatabaseError(error) }
  } finally {
    if (client) client.release()
    if (pool) await pool.end()
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [action,candidate,dumpTool,backupDirectory,inputMode] = process.argv.slice(2)
  let input = {}
  if (inputMode === '--stdin') {
    try {
      let json = ''
      process.stdin.setEncoding('utf8')
      for await (const chunk of process.stdin) { json += chunk; requireCondition(json.length <= 65536,'DATABASE_URL_INVALID') }
      input = JSON.parse(json)
    } catch {
      console.log(JSON.stringify({status:'FAIL',action,stage:'database_url',code:'DATABASE_URL_INVALID'}))
      process.exit(1)
    }
  }
  const result = await databaseMaintenance({ action,candidate,dumpTool,backupDirectory,databaseUrl:input.databaseUrl ?? process.env.DATABASE_URL,
    ...(['Check','ValidateBackup'].includes(action) ? {restoreAdmin:input.restoreAdmin} : {}),
    restoreEvidence:input.restoreEvidence,legacyEvidence:input.legacyEvidence,productionDataDirectory:input.productionDataDirectory })
  console.log(JSON.stringify(result))
  process.exitCode = result.status === 'PASS' ? 0 : 1
}
