import { createHash } from 'node:crypto'
import { readFile, writeFile, rename, lstat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export async function startAutomaticFolderDiscovery(configFile, { once = false, signal, onStatus } = {}) {
  if (!isAbsolute(configFile)) throw new Error('automatic_folder_absolute_config_required')
  const config = JSON.parse(await readFile(configFile, 'utf8'))
  const fields = ['intervalMs', 'pcloudDatabasePath', 'policy', 'runtimeDirectory', 'sourceRoot', 'statusFile', 'topLevelFolderName']
  if (Object.keys(config).sort().join(',') !== fields.sort().join(',')
    || ![config.runtimeDirectory, config.sourceRoot, config.pcloudDatabasePath, config.statusFile].every(value => typeof value === 'string' && isAbsolute(value))
    || typeof config.topLevelFolderName !== 'string' || !config.topLevelFolderName
    || !Number.isInteger(config.intervalMs) || config.intervalMs < 15_000 || config.intervalMs > 900_000
    || resolve(dirname(configFile)) !== resolve(dirname(config.statusFile))) throw new Error('automatic_folder_invalid_config')
  const runtime = config.runtimeDirectory
  const load = file => import(pathToFileURL(join(runtime, file)))
  const { automaticFolderPolicySchema, registerAutomaticFolders } = await load('services/api/dist/cases/automatic-folder-registration.js')
  const { discoverPlateFolders } = await load('services/api/dist/cases/folder-discovery.js')
  const { readV1Sidecar } = await load('services/api/dist/v1-import/store.js')
  const { buildV1SourceIdentityMaterial } = await load('services/api/node_modules/@hasarbotu/domain/dist/index.js')
  const { withConsistentPcloudDatabase } = await load('tools/pcloud-maintenance-window-gate.mjs')
  const { resolveTopLevelFolderId } = await load('tools/pcloud-source-attestation.mjs')
  const { resolveFolderIdByRelativeDirParts } = await load('tools/pcloud-post-sync-diff-forensics.mjs')
  const policy = automaticFolderPolicySchema.parse(config.policy)
  const pg = createRequire(join(runtime, 'services/api/package.json'))('pg')
  if (!process.env.DATABASE_URL) throw new Error('automatic_folder_database_configuration_required')
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 })
  const previous = new Map()
  let lastLogStatus
  async function saveStatus(status) {
    const temporary = config.statusFile + '.' + process.pid + '.tmp'
    await writeFile(temporary, JSON.stringify({ ...status, checkedAt: new Date().toISOString() }, null, 2), { flag: 'wx' })
    await rename(temporary, config.statusFile)
    // Paths, names and credentials stay in the administrator-owned configuration.
    const log = JSON.stringify({ status: status.status, created: status.created ?? 0, deferred: status.deferred ?? 0 })
    if (log !== lastLogStatus || status.created) { onStatus?.(log); lastLogStatus = log }
  }
  async function safeDirectory(relativePath) {
    let absolute = config.sourceRoot
    for (const part of ['', ...relativePath.split('/')]) {
      if (part) absolute = join(absolute, part)
      const info = await lstat(absolute)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('source_unavailable')
    }
    return absolute
  }
  async function resolveIds(folders) {
    return withConsistentPcloudDatabase(config.pcloudDatabasePath, cloud => {
      const rootId = resolveTopLevelFolderId(cloud, config.topLevelFolderName)
      return new Map(folders.map(folder => [folder.relativePath, resolveFolderIdByRelativeDirParts(cloud, rootId, folder.relativePath.split('/'))]))
    })
  }
  async function observe(folder, sourceFolderId) {
    await safeDirectory(folder.relativePath)
    let stableV1Identity, historicalFileHash
    if (folder.hasJson) {
      const sidecar = await readV1Sidecar(folder)
      historicalFileHash = sidecar.jsonHash
      if (sidecar.jsonParse?.ok) {
        const data = sidecar.jsonParse.data
        const identity = buildV1SourceIdentityMaterial({ caseKey: data.caseIdentity?.caseKey, createdAt: data.metadata?.createdAt })
        if (identity.ok) stableV1Identity = createHash('sha256').update(identity.material).digest('hex')
      }
    }
    const historicalPayloadAvailable = folder.hasJson || folder.hasTxt
    // This evidence covers source identity and sidecar state, not document completeness or type.
    const observationHash = createHash('sha256').update(JSON.stringify({ sourceFolderId, relativePath: folder.relativePath, hasJson: folder.hasJson, hasTxt: folder.hasTxt, historicalFileHash })).digest('hex')
    return { sourceFolderId, relativePath: folder.relativePath, historicalPayloadAvailable, observationHash, ...(stableV1Identity ? { stableV1Identity } : {}) }
  }
  try {
    do {
      if (signal?.aborted) break
      try {
        await safeDirectory('')
        const discovered = await discoverPlateFolders(config.sourceRoot)
        const ids = await resolveIds(discovered)
        const baseline = new Set(policy.baselineSourceFolderIds)
        const registered = new Set((await pool.query('SELECT source_folder_id FROM case_folder_registrations WHERE organization_id=$1 AND storage_root_key=$2',
          [policy.organizationId, policy.storageRootKey])).rows.map(row => row.source_folder_id))
        const observations = [], seen = new Set()
        let waitingForCloudIdentity = 0, settling = 0
        for (const folder of discovered) {
          if (signal?.aborted) break
          const id = ids.get(folder.relativePath)
          if (id === null || id === undefined) { waitingForCloudIdentity++; continue }
          const sourceFolderId = String(id)
          if (baseline.has(sourceFolderId) || registered.has(sourceFolderId)) continue
          const observed = await observe(folder, sourceFolderId)
          seen.add(sourceFolderId)
          // Two consistent observations allow pCloud/Windows to finish creating or naming a folder.
          if (previous.get(sourceFolderId) !== observed.observationHash) { previous.set(sourceFolderId, observed.observationHash); settling++; continue }
          observations.push(observed)
        }
        for (const id of previous.keys()) if (!seen.has(id)) previous.delete(id)
        const summary = await registerAutomaticFolders(pool, policy, observations, async folder => {
          const current = (await discoverPlateFolders(config.sourceRoot)).find(item => item.relativePath === folder.relativePath)
          if (!current) throw new Error('source_changed')
          const currentIds = await resolveIds([current])
          if (String(currentIds.get(current.relativePath)) !== folder.sourceFolderId
            || (await observe(current, folder.sourceFolderId)).observationHash !== folder.observationHash) throw new Error('source_changed')
        }, signal)
        await saveStatus({ status: summary.deferred || waitingForCloudIdentity ? 'ATTENTION' : 'PASS', ...summary,
          discovered: discovered.length, waitingForCloudIdentity, settling, sourceReadOnly: true, defaultCaseType: null })
      } catch (error) {
        const diagnosticCode = error?.safeCode ?? error?.code ?? 'automatic_folder_cycle_failed'
        await saveStatus({ status: 'BLOCKED', code: /^[a-z0-9_]+$/i.test(diagnosticCode) ? diagnosticCode : 'automatic_folder_cycle_failed',
          errorType: error?.name ?? 'Error', sourceReadOnly: true })
        // Preserve local diagnostics without logging arbitrary exception messages that may contain secrets.
        const recoverable = ['ENOENT', 'EACCES', 'EPERM', 'EBUSY', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', '57P01', '53300',
          'PCLOUD_LOCAL_DATABASE_NOT_FOUND', 'PCLOUD_TOP_LEVEL_FOLDER_NOT_FOUND', 'source_unavailable'].includes(diagnosticCode)
        if (once || !recoverable) throw new Error('automatic_folder_cycle_failed', { cause: error })
      }
      if (once || signal?.aborted) break
      await new Promise(resolveWait => {
        const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolveWait() }
        const timer = setTimeout(finish, config.intervalMs)
        signal?.addEventListener('abort', finish, { once: true })
        if (signal?.aborted) finish()
      })
    } while (!signal?.aborted)
  } finally { await pool.end() }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const abort = new AbortController()
  process.once('SIGINT', () => abort.abort())
  process.once('SIGTERM', () => abort.abort())
  startAutomaticFolderDiscovery(process.argv[2], { once: process.argv.includes('--once'), signal: abort.signal, onStatus: text => console.log(text) })
    .catch(() => { console.error('automatic_folder_discovery_failed'); process.exitCode = 1 })
}
