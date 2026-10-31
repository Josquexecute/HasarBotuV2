import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, constants, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const json = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''))
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const sha256 = async path => {
  const hash = createHash('sha256')
  for await (const bytes of createReadStream(path)) hash.update(bytes)
  return hash.digest('hex')
}
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })

function under(root, relative) {
  assert.ok(typeof relative === 'string' && relative && !isAbsolute(relative) && !/[\\:<>"|?*\x00-\x1f]/.test(relative)
    && relative.split('/').every(p => p && p !== '.' && p !== '..'), 'Unsafe relative path')
  const absolute = resolve(root, relative)
  assert.ok(absolute.startsWith(resolve(root) + (process.platform === 'win32' ? '\\' : '/')), 'Path escaped root')
  return absolute
}
async function noLinks(path) {
  let current = resolve(path)
  while (true) {
    assert.equal((await lstat(current)).isSymbolicLink(), false, 'Reparse point rejected')
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
}
async function inventory(root) {
  await noLinks(root)
  const files = [], directories = []
  async function walk(relative = '') {
    for (const name of (await readdir(join(root, relative))).sort()) {
      const path = relative ? relative + '/' + name : name, absolute = under(root, path), metadata = await lstat(absolute)
      assert.equal(metadata.isSymbolicLink(), false, 'Reparse point rejected')
      if (metadata.isDirectory()) { directories.push(path); await walk(path) }
      else { assert.ok(metadata.isFile(), 'Ordinary files required'); files.push({ path, size: metadata.size, sha256: await sha256(absolute) }) }
    }
  }
  await walk()
  return { directories: directories.sort(), files: files.sort((a, b) => a.path.localeCompare(b.path)) }
}
function pgEnvironment(url) {
  return { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGAPPNAME: 'hasarbotu-approved-identity-repair' }
}
function pgTool(executable, args, url) {
  assert.ok(isAbsolute(executable), 'Absolute PostgreSQL binary required')
  const result = spawnSync(executable, args, { env: pgEnvironment(url), windowsHide: true, encoding: 'utf8', timeout: 180_000 })
  // PostgreSQL stderr can contain connection details. Keep it out of logs.
  if (result.error) throw new Error('Database tool could not run: ' + result.error.code)
  assert.equal(result.status, 0, 'Database backup/restore process failed')
}

export async function runIdentityMaintenance(configFile, mode, inputFile, approvalFile, outputFile) {
  assert.ok(['plan', 'apply', 'rollback'].includes(mode), 'Expected plan, apply or rollback')
  const config = await json(configFile)
  for (const field of ['runtimeDirectory', 'sourceRoot', 'pcloudDatabasePath', 'evidenceFile', 'backupDirectory']) assert.ok(isAbsolute(config[field]), 'Absolute paths required')
  await noLinks(config.sourceRoot)
  await noLinks(config.backupDirectory)
  const load = file => import(pathToFileURL(join(config.runtimeDirectory, file)))
  const { planIdentityRepair, applyIdentityRepair, rollbackIdentityRepair } = await load('services/api/dist/cases/folder-identity-repair.js')
  const { withConsistentPcloudDatabase } = await load('tools/pcloud-maintenance-window-gate.mjs')
  const { resolveTopLevelFolderId } = await load('tools/pcloud-source-attestation.mjs')
  const { resolveFolderIdByRelativeDirParts } = await load('tools/pcloud-post-sync-diff-forensics.mjs')
  const { Pool } = createRequire(join(config.runtimeDirectory, 'services/api/package.json'))('pg')
  const dbUrl = new URL(process.env.DATABASE_URL)
  assert.ok(['127.0.0.1', 'localhost'].includes(dbUrl.hostname), 'Run on the database host')
  const pool = new Pool({ connectionString: dbUrl.href, max: 2, connectionTimeoutMillis: 5000 })
  const actor = { organizationId: config.organizationId, actorUserId: config.actorUserId, requestId: 'approved-identity-maintenance-' + randomUUID() }
  let backupDirectory
  async function verifySource(plan) {
    assert.equal(await sha256(config.evidenceFile), plan.decision.evidenceSha256, 'Evidence digest changed')
    const evidence = await json(config.evidenceFile)
    assert.equal(evidence.schemaVersion, 'folder-identity-evidence/1')
    const targets = plan.decision.cases.flatMap(c => c.target ? [c.target] : [])
    assert.equal(new Set(evidence.folders.map(f => f.sourceFolderId)).size, evidence.folders.length)
    assert.equal(evidence.folders.length, targets.length)
    for (const target of targets) {
      const source = evidence.folders.find(f => f.sourceFolderId === target.sourceFolderId && f.relativePath === target.relativePath)
      assert.ok(source, 'Target identity missing from evidence')
      assert.deepEqual(await inventory(under(config.sourceRoot, target.relativePath)), { directories: source.directories, files: source.files }, 'Folder contents changed')
    }
    await withConsistentPcloudDatabase(config.pcloudDatabasePath, snapshot => {
      const root = resolveTopLevelFolderId(snapshot, config.topLevelFolderName)
      for (const target of targets) assert.equal(resolveFolderIdByRelativeDirParts(snapshot, root, target.relativePath.split('/')), target.sourceFolderId, 'Cloud identity changed')
      for (const item of plan.decision.cases.filter(c => !c.target)) {
        const old = plan.before.rows.find(r => r.id === item.caseId).location.relative_path
        assert.ok(evidence.absentPaths.includes(old), 'Retired path absence not approved')
        assert.equal(resolveFolderIdByRelativeDirParts(snapshot, root, old.split('/')), null, 'Retired cloud path exists')
      }
    })
    for (const path of evidence.absentPaths) {
      try { await lstat(under(config.sourceRoot, path)); assert.fail('Retired physical path exists') }
      catch (error) { if (error.code !== 'ENOENT') throw error }
    }
  }
  async function backup(plan) {
    assert.equal(config.maintenanceWindowConfirmed, true, 'Affected workers and operators must be quiescent')
    const testUrl = new URL(process.env.RESTORE_TEST_DATABASE_URL)
    assert.ok(decodeURIComponent(testUrl.pathname).endsWith('_test') && testUrl.href !== dbUrl.href, 'Disposable restore database required')
    assert.ok(['127.0.0.1', 'localhost'].includes(testUrl.hostname), 'Local restore database required')
    const restored = new Pool({ connectionString: testUrl.href, max: 1 })
    const directory = under(config.backupDirectory, plan.planHash + '-' + randomUUID())
    await mkdir(directory)
    try {
      const count = (await restored.query("SELECT count(*)::int count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S')")).rows[0].count
      assert.equal(count, 0, 'Restore database must be empty; it will never be cleaned automatically')
      const dump = join(directory, 'database.dump')
      pgTool(config.pgDumpPath, ['--format=custom', '--no-owner', '--no-privileges', '--file', dump], dbUrl)
      const databaseSha256 = await sha256(dump)
      pgTool(config.pgRestorePath, ['--exit-on-error', '--no-owner', '--no-privileges', '--dbname', decodeURIComponent(testUrl.pathname.slice(1)), dump], testUrl)
      const restoredPlan = await planIdentityRepair(restored, actor.organizationId, plan.decision)
      assert.equal(restoredPlan.planHash, plan.planHash, 'Restored bindings and histories differ')
      const evidence = await json(config.evidenceFile)
      for (const folder of evidence.folders) {
        const destination = under(directory, folder.sourceFolderId)
        await mkdir(destination)
        for (const path of folder.directories) await mkdir(under(destination, path), { recursive: true })
        for (const file of folder.files) {
          const target = under(destination, file.path)
          await mkdir(dirname(target), { recursive: true })
          await copyFile(under(config.sourceRoot, folder.relativePath + '/' + file.path), target, constants.COPYFILE_EXCL)
        }
        assert.deepEqual(await inventory(destination), { directories: folder.directories, files: folder.files }, 'Backup copy failed integrity verification')
      }
      await save(join(directory, 'folder-manifest.json'), evidence)
      const folderManifestSha256 = await sha256(join(directory, 'folder-manifest.json'))
      await save(join(directory, 'restore-proof.json'), { restoredPlanDigest: restoredPlan.planHash, databaseSha256, folderManifestSha256, restoredAt: new Date().toISOString() })
      const restoreProofSha256 = await sha256(join(directory, 'restore-proof.json'))
      await save(join(directory, 'before.json'), plan)
      backupDirectory = directory
      return { databaseSha256, folderManifestSha256, restoreProofSha256 }
    } finally { await restored.end() }
  }
  try {
    if (mode === 'plan') {
      const client = await pool.connect()
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
        const plan = await planIdentityRepair(client, config.organizationId, await json(inputFile))
        await verifySource(plan)
        await client.query('ROLLBACK')
        await save(approvalFile, plan)
        return { status: 'AWAITING_OPERATOR_APPROVAL', planHash: plan.planHash, productionMutations: 0 }
      } finally { client.release() }
    }
    assert.equal(config.maintenanceWindowConfirmed, true, 'Explicit maintenance window required')
    const approval = await json(approvalFile)
    assert.equal(approval.operatorId, actor.actorUserId, 'Named operator approval required')
    assert.ok(Number.isFinite(Date.parse(approval.approvedAt)), 'Approval time required')
    if (mode === 'apply') {
      const plan = await json(inputFile)
      assert.ok(outputFile, 'Receipt output path required')
      const { open } = await import('node:fs/promises')
      const receiptFile = await open(outputFile, 'wx')
      try {
        const result = await applyIdentityRepair(pool, actor, plan, approval, { verifySource, backup, persistReceipt: async receipt => {
          assert.ok(backupDirectory)
          const text = JSON.stringify(receipt, null, 2)
          const backupReceipt = await open(join(backupDirectory, 'receipt.json'), 'wx')
          try { await backupReceipt.writeFile(text); await backupReceipt.sync() } finally { await backupReceipt.close() }
          await receiptFile.writeFile(text)
          await receiptFile.sync()
        } })
        if (result.alreadyApplied) { await receiptFile.writeFile(JSON.stringify({ alreadyApplied: true, planHash: plan.planHash })); await receiptFile.sync() }
        return { status: result.alreadyApplied ? 'ALREADY_APPLIED' : 'APPLIED', receiptDigest: result.receipt ? digest(result.receipt) : null }
      } finally { await receiptFile.close() }
    }
    const receipt = await json(inputFile)
    const result = await rollbackIdentityRepair(pool, actor, receipt, approval.approvedReceiptHash, async () => {
      const matches = []
      for (const name of await readdir(config.backupDirectory)) {
        if (!name.startsWith(receipt.plan.planHash + '-')) continue
        const directory = under(config.backupDirectory, name)
        await noLinks(directory)
        try {
          if (await sha256(join(directory, 'database.dump')) !== receipt.backup.databaseSha256
            || await sha256(join(directory, 'folder-manifest.json')) !== receipt.backup.folderManifestSha256
            || await sha256(join(directory, 'restore-proof.json')) !== receipt.backup.restoreProofSha256) continue
          const evidence = await json(join(directory, 'folder-manifest.json'))
          for (const folder of evidence.folders) assert.deepEqual(await inventory(under(directory, folder.sourceFolderId)), { directories: folder.directories, files: folder.files })
          matches.push(directory)
        } catch (error) { if (error.code !== 'ENOENT') throw error }
      }
      assert.ok(matches.length, 'Verified rollback backup not found')
    })
    return { status: result.alreadyRolledBack ? 'ALREADY_ROLLED_BACK' : 'ROLLED_BACK' }
  } finally { await pool.end() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [config, mode, input, approval, output, ...extra] = process.argv.slice(2)
    assert.ok(config && mode && input && approval && !extra.length, 'Usage: repair-folder-identity.mjs <config> plan <decision> <plan-output> | <config> apply <plan> <approval> <receipt-output> | <config> rollback <receipt> <approval>')
    console.log(JSON.stringify(await runIdentityMaintenance(config, mode, input, approval, output)))
  } catch (error) { console.error(JSON.stringify({ status: 'BLOCKED', reason: error.code ?? error.message })); process.exitCode = 1 }
}
