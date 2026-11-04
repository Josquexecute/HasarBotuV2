import { createHash, randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, lstat, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'

export const MAX_RESTORE_EVIDENCE_AGE_MS = 6 * 60 * 60 * 1000
const digest = value => createHash('sha256').update(value).digest('hex')
const requireValue = (condition, code) => { if (!condition) throw Error(code) }
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
export async function restoreFileHash(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
async function treeHash(root) {
  const entries = []
  async function visit(path, prefix = '') {
    for (const file of (await readdir(path, { withFileTypes: true })).sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      requireValue(!file.isSymbolicLink(), 'RESTORE_EVIDENCE_PATH_INVALID')
      const relative = prefix + file.name
      if (file.isDirectory()) await visit(join(path,file.name), relative + '/')
      else { requireValue(file.isFile(), 'RESTORE_EVIDENCE_PATH_INVALID'); entries.push([relative,await restoreFileHash(join(path,file.name))]) }
    }
  }
  await visit(root)
  return digest(JSON.stringify(entries))
}
export async function restoreProvenance(candidate, migrationsDirectory, dumpTool, source) {
  const toolNames = ['pg_dump.exe','pg_restore.exe','postgres.exe','initdb.exe','pg_ctl.exe']
  return {
    candidateSha256: await treeHash(candidate), migrationsSha256: await treeHash(migrationsDirectory),
    validatorSha256: digest(JSON.stringify(await Promise.all(['api-transition-database.mjs','api-transition-restore-evidence.mjs'].map(name => restoreFileHash(join(dirname(fileURLToPath(import.meta.url)),name)))))),
    toolsSha256: digest(JSON.stringify(await Promise.all(toolNames.map(name => restoreFileHash(join(dirname(dumpTool),name)))))),
    sourceIdentitySha256: digest(JSON.stringify(source)), serverVersion: source.serverVersion,
  }
}
function fresh(at, now) {
  const time = typeof at === 'string' ? Date.parse(at) : NaN
  requireValue(Number.isFinite(time) && time <= now + 30_000 && now - time <= MAX_RESTORE_EVIDENCE_AGE_MS, 'RESTORE_EVIDENCE_EXPIRED')
}
export function validateRestoreReceipt(receipt, expected, now = Date.now()) {
  requireValue(receipt?.schemaVersion === 'hasarbotu-independent-restore/1' && receipt.status === 'PASS' && receipt.strategy === 'isolated-cluster', 'RESTORE_EVIDENCE_INVALID')
  fresh(receipt.completedAt,now)
  for (const key of ['candidateSha256','migrationsSha256','validatorSha256','toolsSha256','sourceIdentitySha256']) {
    requireValue(isHash(receipt[key]) && receipt[key] === expected[key], 'RESTORE_EVIDENCE_BINDING_MISMATCH')
  }
  requireValue(receipt.serverVersion === expected.serverVersion && /^17\.[0-9]+$/.test(receipt.serverVersion), 'RESTORE_EVIDENCE_VERSION_MISMATCH')
  requireValue(isHash(receipt.backup?.sha256) && isHash(receipt.backup?.contentSha256) && Number.isSafeInteger(receipt.backup.bytes) && receipt.backup.bytes > 0 && isHash(receipt.schemaSha256), 'RESTORE_EVIDENCE_INVALID')
  requireValue(Number.isSafeInteger(receipt.tableCount) && receipt.tableCount > 0 && typeof receipt.rowCount === 'string' && /^[0-9]+$/.test(receipt.rowCount), 'RESTORE_EVIDENCE_INVALID')
  requireValue(receipt.checks?.restoredContent === true && receipt.checks?.migrationSchema === true && receipt.checks?.rollbackReapply === true && receipt.checks?.temporaryDatabaseRemoved === true && receipt.checks?.clusterStopped === true && receipt.checks?.clusterDirectoryRemoved === true && receipt.checks?.restoreRoleUnprivileged === true, 'RESTORE_EVIDENCE_INCOMPLETE')
  if (expected.backup) requireValue(['sha256','bytes','contentSha256'].every(key => receipt.backup[key] === expected.backup[key]), 'RESTORE_EVIDENCE_BACKUP_MISMATCH')
  return receipt
}
async function pinnedJson(path, sha256) {
  requireValue(isAbsolute(path) && isHash(sha256), 'RESTORE_EVIDENCE_PIN_REQUIRED')
  try {
    requireValue(!(await lstat(path)).isSymbolicLink() && (await stat(path)).size <= 1024 * 1024, 'RESTORE_EVIDENCE_PATH_INVALID')
    const bytes = await readFile(path)
    requireValue(digest(bytes) === sha256, 'RESTORE_EVIDENCE_HASH_MISMATCH')
    return JSON.parse(bytes)
  } catch (error) {
    if (error.code === 'ENOENT') throw Error('RESTORE_EVIDENCE_MISSING')
    if (error instanceof SyntaxError) throw Error('RESTORE_EVIDENCE_INVALID')
    throw error
  }
}
export async function verifyRestoreEvidence(evidence, provenance, backup) {
  const receipt = validateRestoreReceipt(await pinnedJson(evidence.path,evidence.sha256), { ...provenance, ...(backup ? { backup } : {}) })
  // An externally pinned receipt is evidence about these exact bytes. A PASS
  // label or a user-supplied hash stored alongside an arbitrary report is not enough.
  const file = join(dirname(evidence.path),'database.dump')
  requireValue((await stat(file)).size === receipt.backup.bytes && await restoreFileHash(file) === receipt.backup.sha256, 'RESTORE_EVIDENCE_BACKUP_MISMATCH')
  return receipt
}
export async function importLegacyRestoreBackup(legacy, outputDirectory, expectedVersion) {
  const manifest = await pinnedJson(legacy.manifestPath,legacy.sha256)
  requireValue(legacy.report === 'fresh-restore/isolated-restore-result.json', 'RESTORE_EVIDENCE_PATH_INVALID')
  const entries = manifest.entries
  requireValue(Array.isArray(entries) && entries.every(x => typeof x.path === 'string' && !isAbsolute(x.path) && !x.path.split(/[\\/]/).includes('..')) && new Set(entries.map(x => x.path.replaceAll('\\','/').toLowerCase())).size === entries.length, 'RESTORE_EVIDENCE_INVALID')
  const entry = entries.find(x => x.path.replaceAll('\\','/') === legacy.report)
  requireValue(entry && isHash(entry.sha256), 'RESTORE_EVIDENCE_INCOMPLETE')
  const reportPath = join(dirname(legacy.manifestPath),...legacy.report.split('/'))
  requireValue((await stat(reportPath)).size === entry.bytes, 'RESTORE_EVIDENCE_HASH_MISMATCH')
  const report = await pinnedJson(reportPath,entry.sha256)
  fresh(report.at,Date.now())
  const requiredChecks = ['Verified existing real production backup hash, size and full decode','Independent PostgreSQL 17.11 cluster, loopback-only port, SCRAM and separate data','All 134 restored table row counts and SHA-256 match the original production backup snapshot','Actual production dump restored; tables, row counts, constraints and 74 migrations verified','Real 0075 applied once; valid/invalid constraint cases and data fingerprint preserved','Actual 0.1.91 entrypoint with migrated real-data clone: DB health and real Desktop/Web config','Actual 0.1.90 production API entrypoint remains compatible with 0075','Isolated 0075 down/reapply rehearsal preserves all original row fingerprints; production down not executed']
  requireValue(report.status === 'PASS' && report.realOfficeHost === true && report.productionModified === false && report.clusterStopped === true && report.checks?.length === requiredChecks.length && requiredChecks.every((name,i) => report.checks[i].name === name && report.checks[i].status === 'PASS'), 'RESTORE_EVIDENCE_INCOMPLETE')
  requireValue(report.checks[1].version === expectedVersion && report.checks[1].listen === '127.0.0.1', 'RESTORE_EVIDENCE_VERSION_MISMATCH')
  requireValue(report.baseline?.migrations === 74 && Number.isSafeInteger(report.baseline.tableCount) && report.baseline.tableCount > 0 && /^[1-9][0-9]*$/.test(report.baseline.rowCount) && report.checks[2].matchedTables === report.baseline.tableCount && report.checks[3].tableCount === report.baseline.tableCount && report.checks[3].rowCount === report.baseline.rowCount && isHash(report.baseline.fingerprint) && report.finalFingerprint === report.baseline.fingerprint, 'RESTORE_EVIDENCE_INVALID')
  requireValue(isHash(report.backup?.sha256) && Number.isSafeInteger(report.backup.bytes) && report.backup.bytes > 0 && isAbsolute(report.backup.path), 'RESTORE_EVIDENCE_INVALID')
  requireValue((await stat(report.backup.path)).size === report.backup.bytes && await restoreFileHash(report.backup.path) === report.backup.sha256, 'RESTORE_EVIDENCE_BACKUP_MISMATCH')
  // Legacy evidence does not bind executable provenance or the canonical 0075
  // schema hash. Reuse its verified dump, then RUN the current validator; never
  // upgrade its PASS label into a current migration authorization.
  await copyFile(report.backup.path,join(outputDirectory,'database.dump'))
  const record = { sha256:report.backup.sha256, bytes:report.backup.bytes, contentSha256:report.baseline.fingerprint, restoreAcceptance:'PENDING', legacyManifestSha256:legacy.sha256, legacyTableCount:report.baseline.tableCount, legacyRowCount:report.baseline.rowCount }
  await writeFile(join(outputDirectory,'database-backup.json'),JSON.stringify(record),{flag:'wx'})
  return record
}
const normalized = value => resolve(value).toLowerCase()
const within = (path,parent) => normalized(path).startsWith(normalized(parent)+sep)
export async function withIndependentRestoreCluster({ parent, dumpTool, expectedVersion, databaseUrl, productionDataDirectory }, operation) {
  requireValue(isAbsolute(parent) && isAbsolute(productionDataDirectory) && !within(parent,productionDataDirectory) && !within(productionDataDirectory,parent) && normalized(parent) !== normalized(productionDataDirectory), 'ISOLATED_RESTORE_PATH_INVALID')
  requireValue(normalized(await realpath(parent)) === normalized(parent) && normalized(await realpath(productionDataDirectory)) === normalized(productionDataDirectory), 'ISOLATED_RESTORE_PATH_INVALID')
  // initdb's restricted Windows token must traverse all ancestors. Keep archive
  // and evidence ACLs admin-only; put only the short-lived cluster in the
  // initiating operator's temp directory, with its own restrictive ACL below.
  const workspace = await realpath(tmpdir())
  requireValue(!within(workspace,productionDataDirectory) && !within(productionDataDirectory,workspace) && normalized(workspace) !== normalized(productionDataDirectory),'ISOLATED_RESTORE_PATH_INVALID')
  const root = await mkdtemp(join(workspace,'.hb-independent-restore-')), data = join(root,'data'), bin = dirname(dumpTool)
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG|^DATABASE_URL$/i.test(key)))
  function native(name,args,allowFailure=false) {
    const r = spawnSync(join(bin,name+'.exe'),args,{env,windowsHide:true,timeout:180000,...(name === 'pg_ctl' ? {stdio:'ignore'} : {encoding:'utf8',stdio:'pipe'})})
    if (!allowFailure) requireValue(r.status === 0,'ISOLATED_RESTORE_PROCESS_FAILED')
    return r
  }
  const password = randomBytes(32).toString('hex'), username = 'hb_isolated_'+randomBytes(8).toString('hex')
  let mayBeRunning = false, result
  try {
    if (process.platform === 'win32') {
      // Windows initdb/postgres drop Administrators privileges. The initiating
      // operator's restricted token must still own this disposable cluster;
      // grant that SID only, then remove the entire cluster before issuing PASS.
      const owner = spawnSync(join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-Command','[Security.Principal.WindowsIdentity]::GetCurrent().User.Value'],{windowsHide:true,encoding:'utf8',stdio:'pipe',timeout:10000})
      const sid = owner.stdout?.trim()
      requireValue(owner.status === 0 && /^S-\d-(?:\d+-)+\d+$/.test(sid),'PG_CREDENTIAL_PROTECTION_FAILED')
      const protection = spawnSync(join(process.env.SystemRoot,'System32','icacls.exe'),[root,'/inheritance:r','/grant:r','*S-1-5-18:(OI)(CI)F','*S-1-5-32-544:(OI)(CI)F',`*${sid}:(OI)(CI)F`],{windowsHide:true,stdio:'pipe',timeout:10000})
      requireValue(protection.status === 0,'PG_CREDENTIAL_PROTECTION_FAILED')
    }
    requireValue(native('postgres',['--version']).stdout.trim() === `postgres (PostgreSQL) ${expectedVersion}`,'RESTORE_EVIDENCE_VERSION_MISMATCH')
    const socket = createServer()
    await new Promise((done,fail) => { socket.once('error',fail); socket.listen(0,'127.0.0.1',done) })
    const port = socket.address().port
    await new Promise(done => socket.close(done))
    requireValue(port !== Number(new URL(databaseUrl).port || 5432),'ISOLATED_RESTORE_ENDPOINT_INVALID')
    const pwfile = join(root,'init-password')
    await writeFile(pwfile,password,{flag:'wx',mode:0o600})
    try { native('initdb',['-D',data,'-U',username,'--auth-host=scram-sha-256','--auth-local=scram-sha-256','--encoding=UTF8','--locale=C','--pwfile='+pwfile]) }
    finally { await rm(pwfile,{force:true}) }
    mayBeRunning = true
    native('pg_ctl',['-D',data,'-l',join(root,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port} -c max_connections=12 -c shared_buffers=64MB`,'-w','start'])
    const url = new URL(`postgresql://${username}:${password}@127.0.0.1:${port}/postgres`)
    result = await operation({ url:url.href, data, port })
  } finally {
    if (mayBeRunning) {
      const status=native('pg_ctl',['-D',data,'status'],true).status
      requireValue(status === 0 || status === 3,'ISOLATED_RESTORE_CLEANUP_FAILED')
      if (status === 0) requireValue(native('pg_ctl',['-D',data,'-m','fast','-w','stop'],true).status === 0,'ISOLATED_RESTORE_CLEANUP_FAILED')
      requireValue(native('pg_ctl',['-D',data,'status'],true).status === 3,'ISOLATED_RESTORE_CLEANUP_FAILED')
    }
    requireValue(within(root,workspace) && normalized(await realpath(root)) === normalized(root),'ISOLATED_RESTORE_PATH_INVALID')
    try { await rm(root,{recursive:true}) } catch { throw Error('ISOLATED_RESTORE_CLEANUP_FAILED') }
  }
  return result
}
