import { createHash } from 'node:crypto'
import { readFile, writeFile, rename, lstat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export async function startAutomaticFolderDiscovery(configFile, { once = false, signal, onStatus } = {}) {
  if (!isAbsolute(configFile)) throw new Error('automatic_folder_absolute_config_required')
  const config = JSON.parse(await readFile(configFile, 'utf8'))
  const fields = ['intervalMs', 'pcloudDatabasePath', 'policy', 'runtimeDirectory', 'sourceRoot', 'statusFile', 'topLevelFolderName']
  if (Object.keys(config).filter(key => !['trackRegisteredMoves','yearFolder','officeInventoryOnly'].includes(key)).sort().join(',') !== fields.sort().join(',')
    || (config.trackRegisteredMoves !== undefined && typeof config.trackRegisteredMoves !== 'boolean')
    || (config.officeInventoryOnly !== undefined && typeof config.officeInventoryOnly !== 'boolean')
    || (config.officeInventoryOnly && (config.yearFolder !== undefined || !config.trackRegisteredMoves))
    || (config.yearFolder !== undefined && (typeof config.yearFolder !== 'string' || !/^\d{4}(?: (?:OFİS|UZAKTAN))?$/u.test(config.yearFolder.toLocaleUpperCase('tr'))))
    || ![config.runtimeDirectory, config.sourceRoot, config.pcloudDatabasePath, config.statusFile].every(value => typeof value === 'string' && isAbsolute(value))
    || typeof config.topLevelFolderName !== 'string' || !config.topLevelFolderName
    || !Number.isInteger(config.intervalMs) || config.intervalMs < 15_000 || config.intervalMs > 900_000
    || resolve(dirname(configFile)) !== resolve(dirname(config.statusFile))) throw new Error('automatic_folder_invalid_config')
  const runtime = config.runtimeDirectory
  const load = file => import(pathToFileURL(join(runtime, file)))
  const { automaticFolderPolicySchema, registerAutomaticFolders } = await load('services/api/dist/cases/automatic-folder-registration.js')
  const { discoverPlateFolders } = await load('services/api/dist/cases/folder-discovery.js')
  const reconcileOfficeFolderInventory = config.officeInventoryOnly
    ? (await load('services/api/dist/cases/office-folder-inventory.js')).reconcileOfficeFolderInventory : undefined
  const { planSourceFolderRelocation, applySourceFolderRelocation } = await load('services/api/dist/cases/source-folder-relocation.js')
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
  const previousMoves = new Map()
  let lastLogStatus
  let previousInventoryHash
  const discoveryOptions = { ...(config.officeInventoryOnly ? { officeOnly: true } : {}), yearFolder: config.yearFolder }
  const inventoryHash = (folders, ids) => createHash('sha256').update(JSON.stringify(folders.map(folder =>
    [folder.relativePath, String(ids.get(folder.relativePath))]).sort((a, b) => a[0].localeCompare(b[0])))).digest('hex')
  async function saveStatus(status) {
    const temporary = config.statusFile + '.' + process.pid + '.tmp'
    await writeFile(temporary, JSON.stringify({ ...status, checkedAt: new Date().toISOString() }, null, 2), { flag: 'wx' })
    await rename(temporary, config.statusFile)
    // Paths, names and credentials stay in the administrator-owned configuration.
    const log = JSON.stringify({ status: status.status, created: status.created ?? 0, deferred: status.deferred ?? 0, relocated: status.relocated ?? 0, relocationDeferred: status.relocationDeferred ?? 0,
      ...(status.archived === undefined ? {} : { archived: status.archived, restored: status.restored, statusUpdated: status.statusUpdated, inventoryDeferred: status.inventoryDeferred }) })
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
  async function oldPathAbsent(relativePath) {
    try { await safeDirectory(relativePath); return false }
    catch (error) { if (error.code === 'ENOENT') return true; throw error }
  }
  async function reconcileMoves(discovered, ids, registered) {
    const result = { relocated: 0, relocationDeferred: 0, relocationSettling: 0, relocationIssues: [] }
    if (!config.trackRegisteredMoves) return result
    const seen = new Set()
    const expected = new Set(['source_changed', 'source_unavailable', 'source_previous_path_exists', 'folder_relocation_operation_active',
      'folder_relocation_case_changed', 'folder_relocation_location_changed', 'folder_relocation_plan_stale',
      'folder_relocation_location_in_use', 'folder_relocation_registered_identity_required', 'folder_relocation_plate_mismatch',
      'folder_admin_required', 'folder_active_root_required'])
    for (const folder of discovered) {
      if (signal?.aborted) break
      const id = ids.get(folder.relativePath)
      const row = id === undefined || id === null ? undefined : registered.get(String(id))
      if (!row || row.relative_path.toLocaleUpperCase('tr-TR') === folder.relativePath.toLocaleUpperCase('tr-TR')) continue
      try {
        if (row.operation_active) throw new Error('folder_relocation_operation_active')
        if (!await oldPathAbsent(row.relative_path)) throw new Error('source_previous_path_exists')
        const sourceFolderId = String(id)
        seen.add(sourceFolderId)
        const observation = createHash('sha256').update(JSON.stringify([sourceFolderId, folder.relativePath, row.relative_path, row.location_version])).digest('hex')
        if (previousMoves.get(sourceFolderId) !== observation) { previousMoves.set(sourceFolderId, observation); result.relocationSettling++; continue }
        const plan = await planSourceFolderRelocation(pool, policy.organizationId, {
          storageRootKey: policy.storageRootKey, decision: `${policy.decision} Track externally moved registered source by its unchanged pCloud folder ID; preserve all business records.`,
          bindings: [{ caseId: row.case_id, sourceFolderId, relativePath: folder.relativePath,
            expectedCaseVersion: row.case_version, expectedLifecycleStatus: row.lifecycle_status, physicallyClosed: folder.physicallyUnderKapali,
            previousLocation: { id: row.location_id, storageRootKey: policy.storageRootKey, relativePath: row.relative_path, version: row.location_version },
            identity: { kind: 'registered' } }],
        })
        const applied = await applySourceFolderRelocation(pool, { organizationId: policy.organizationId, actorUserId: policy.actorUserId,
          requestId: 'automatic-relocation-' + observation.slice(0, 24) }, plan, plan.planHash, async () => {
          await safeDirectory(folder.relativePath)
          if (!await oldPathAbsent(row.relative_path)) throw new Error('source_previous_path_exists')
          const currentIds = await resolveIds([folder])
          if (String(currentIds.get(folder.relativePath)) !== sourceFolderId) throw new Error('source_changed')
          const active = await pool.query("SELECT 1 FROM case_file_operations WHERE organization_id=$1 AND case_id=$2 AND status NOT IN ('ready','failed','stale','cancelled') LIMIT 1", [policy.organizationId, row.case_id])
          if (active.rowCount) throw new Error('folder_relocation_operation_active')
        })
        result.relocated += applied.relocated
        previousMoves.delete(sourceFolderId)
      } catch (error) {
        if (!expected.has(error.message)) throw error
        result.relocationDeferred++
        result.relocationIssues.push({ sourceFolderId: String(id), code: error.message })
      }
    }
    for (const id of previousMoves.keys()) if (!seen.has(id)) previousMoves.delete(id)
    return result
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
        const scanStartedAt = new Date().toISOString()
        await safeDirectory('')
        // The scope limits new cases; a registered folder can move into another year/work group.
        if (config.trackRegisteredMoves && config.yearFolder !== undefined) await safeDirectory(config.yearFolder)
        const moveInventory = await discoverPlateFolders(config.sourceRoot, { ...discoveryOptions, yearFolder: config.trackRegisteredMoves ? undefined : config.yearFolder })
        const discovered = config.yearFolder === undefined ? moveInventory : moveInventory.filter(folder =>
          folder.relativePath.split('/')[0].toLocaleUpperCase('tr') === config.yearFolder.toLocaleUpperCase('tr'))
        const ids = await resolveIds(moveInventory)
        const cloudIds = [...ids.values()].filter(id => id !== null && id !== undefined).map(String)
        if (new Set(cloudIds).size !== cloudIds.length) throw new Error('automatic_folder_duplicate_inventory')
        const baseline = new Set(policy.baselineSourceFolderIds)
        const registered = new Map((await pool.query(`SELECT r.source_folder_id,c.id AS case_id,c.version AS case_version,c.lifecycle_status,
          l.id AS location_id,l.relative_path,l.version AS location_version,
          EXISTS(SELECT 1 FROM case_file_operations o WHERE o.organization_id=c.organization_id AND o.case_id=c.id AND o.status NOT IN ('ready','failed','stale','cancelled')) AS operation_active
          FROM case_folder_registrations r JOIN cases c ON c.organization_id=r.organization_id AND c.id=r.case_id
          JOIN case_locations l ON l.organization_id=c.organization_id AND l.case_id=c.id AND l.storage_root_key=r.storage_root_key
          WHERE r.organization_id=$1 AND r.storage_root_key=$2 AND (NOT c.is_archived OR ($3 AND EXISTS(
            SELECT 1 FROM audit_events a WHERE a.organization_id=c.organization_id AND a.resource_id=c.id::text
              AND a.action='case.office_inventory_reconciled' AND a.details->>'managedArchive'='true')))`,
          [policy.organizationId, policy.storageRootKey, !!config.officeInventoryOnly])).rows.map(row => [row.source_folder_id, row]))
        const moves = await reconcileMoves(moveInventory, ids, registered)
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
          const current = (await discoverPlateFolders(config.sourceRoot, discoveryOptions)).find(item => item.relativePath === folder.relativePath)
          if (!current) throw new Error('source_changed')
          const currentIds = await resolveIds([current])
          if (String(currentIds.get(current.relativePath)) !== folder.sourceFolderId
            || (await observe(current, folder.sourceFolderId)).observationHash !== folder.observationHash) throw new Error('source_changed')
        }, signal)
        let inventory = {}
        if (reconcileOfficeFolderInventory) {
          const complete = moveInventory.length > 0 && cloudIds.length === moveInventory.length
          const currentHash = complete ? inventoryHash(moveInventory, ids) : undefined
          if (complete && currentHash === previousInventoryHash && !signal?.aborted) {
            inventory = await reconcileOfficeFolderInventory(pool, policy, moveInventory.map(folder => ({
              relativePath: folder.relativePath, sourceFolderId: String(ids.get(folder.relativePath)),
            })), scanStartedAt, async () => {
              if (signal?.aborted) throw new Error('source_unavailable')
              await safeDirectory('')
              const current = await discoverPlateFolders(config.sourceRoot, discoveryOptions)
              const currentIds = await resolveIds(current)
              if (inventoryHash(current, currentIds) !== currentHash) throw new Error('source_changed')
            })
          } else inventory = { inventorySettling: true }
          previousInventoryHash = currentHash
        }
        await saveStatus({ status: summary.deferred || moves.relocationDeferred || waitingForCloudIdentity || inventory.inventoryDeferred ? 'ATTENTION' : 'PASS', ...summary, ...moves, ...inventory,
          discovered: discovered.length, registeredMoveScanFolders: config.trackRegisteredMoves ? moveInventory.length : 0,
          waitingForCloudIdentity, settling, sourceReadOnly: true, defaultCaseType: null })
      } catch (error) {
        previousInventoryHash = undefined
        const diagnosticCode = error?.safeCode ?? error?.code ?? 'automatic_folder_cycle_failed'
        await saveStatus({ status: 'BLOCKED', code: /^[a-z0-9_]+$/i.test(diagnosticCode) ? diagnosticCode : 'automatic_folder_cycle_failed',
          errorType: error?.name ?? 'Error', sourceReadOnly: true })
        // Preserve local diagnostics without logging arbitrary exception messages that may contain secrets.
        const recoverable = ['ENOENT', 'EACCES', 'EPERM', 'EBUSY', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', '57P01', '53300',
          'PCLOUD_LOCAL_DATABASE_NOT_FOUND', 'PCLOUD_TOP_LEVEL_FOLDER_NOT_FOUND', 'source_unavailable', 'source_changed'].includes(diagnosticCode)
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
