import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, cp, symlink, readFile, rename, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import pg from 'pg'
import { assertTestDatabaseUrl, runMigrations, uuidv7 } from '@hasarbotu/database'
import { startAutomaticFolderDiscovery } from './automatic-folder-discovery.mjs'
import { attestationFileNameFor, writeAttestationRecord } from './pcloud-source-attestation.mjs'
import { writeFile } from 'node:fs/promises'

test('real background scans discover folders, follow stable identity moves and reconcile the office-only inventory', { skip: !process.env.TEST_DATABASE_URL, timeout: 180_000 }, async () => {
  const database = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL)
  const pool = new pg.Pool({ connectionString: database.url })
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await runMigrations({ databaseUrl: database.url, quiet: true })
  const directory = await mkdtemp(join(tmpdir(), 'hasarbotu-auto-folder-test-'))
  const runtime = join(directory, 'runtime'), source = join(directory, 'source'), repo = resolve('.')
  await mkdir(join(runtime, 'services/api'), { recursive: true })
  await cp(join(repo, 'services/api/dist'), join(runtime, 'services/api/dist'), { recursive: true })
  await cp(join(repo, 'services/api/package.json'), join(runtime, 'services/api/package.json'))
  await symlink(join(repo, 'node_modules'), join(runtime, 'services/api/node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  await cp(join(repo, 'deploy/windows-service'), join(runtime, 'tools'), { recursive: true, filter: path => !path.endsWith('.test.mjs') && !path.endsWith('.tests.ps1') })
  const unstableMarker = join(runtime, 'tools', 'unstable-snapshot.fixture')
  const changedSourceMarker = join(runtime, 'tools', 'changed-source.fixture')
  await rename(join(runtime, 'tools/pcloud-maintenance-window-gate.mjs'), join(runtime, 'tools/real-pcloud-maintenance-window-gate.mjs'))
  await writeFile(join(runtime, 'tools/pcloud-maintenance-window-gate.mjs'), `
    import { existsSync, unlinkSync } from 'node:fs'
    import { withConsistentPcloudDatabase as realSnapshot } from './real-pcloud-maintenance-window-gate.mjs'
    export * from './real-pcloud-maintenance-window-gate.mjs'
    export async function withConsistentPcloudDatabase(...args) {
      const changed = new URL('./changed-source.fixture', import.meta.url)
      if (existsSync(changed)) {
        unlinkSync(changed)
        throw new Error('source_changed')
      }
      const marker = new URL('./unstable-snapshot.fixture', import.meta.url)
      if (existsSync(marker)) {
        unlinkSync(marker)
        const error = new Error('Synthetic concurrent pCloud write')
        error.safeCode = 'PCLOUD_DATABASE_SNAPSHOT_UNSTABLE'
        throw error
      }
      return realSnapshot(...args)
    }
  `)
  await mkdir(join(source, '2026/EKİM 2026'), { recursive: true })
  const sqlitePath = join(directory, 'pcloud-test.db'), sqlite = new DatabaseSync(sqlitePath)
  sqlite.exec("CREATE TABLE folder(id INTEGER PRIMARY KEY,parentfolderid INTEGER,name TEXT); CREATE TABLE file(id INTEGER PRIMARY KEY,parentfolderid INTEGER,name TEXT,hash INTEGER); INSERT INTO folder VALUES(100,0,'SyntheticCompany'),(101,100,'2026'),(102,101,'EKİM 2026')")
  const org = uuidv7(), admin = uuidv7(), owner = uuidv7(), expert = uuidv7()
  await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,'auto-folder-test','Synthetic')", [org])
  for (const [id, role] of [[admin, 'admin'], [owner, 'case_manager'], [expert, 'expert']]) {
    await pool.query('INSERT INTO users(id,organization_id,email,display_name) VALUES($1,$2,$3,$4)', [id, org, `${id}@example.test`, role])
    await pool.query('INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code=$2', [id, role])
  }
  await pool.query("INSERT INTO storage_roots(id,organization_id,root_key,label) VALUES($1,$2,'test-root','Synthetic')", [uuidv7(), org])
  const statusFile = join(directory, 'status.json'), configFile = join(directory, 'config.json')
  await writeFile(configFile, JSON.stringify({ intervalMs: 15_000, runtimeDirectory: runtime, sourceRoot: source, yearFolder: '2026', pcloudDatabasePath: sqlitePath,
    statusFile, topLevelFolderName: 'SyntheticCompany', policy: { schemaVersion: 'hasarbotu-automatic-folders/1', organizationId: org,
      storageRootKey: 'test-root', actorUserId: admin, responsibleUserId: owner, expertUserId: expert, baselineSourceFolderIds: [],
      decision: 'Explicitly authorized automatic registration of new source IDs, with unknown types pending.' } }))
  const originalUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = database.url
  const abort = new AbortController()
  const deadline = setTimeout(() => abort.abort(), 45_000)
  let first = true, setup, created = false
  const discoveryStarted = Date.now()
  try {
    await startAutomaticFolderDiscovery(configFile, { signal: abort.signal, onStatus: text => {
      const status = JSON.parse(text)
      if (first) {
        first = false
        setup = mkdir(join(source, '2026/EKİM 2026/34AUT123')).then(() => sqlite.exec("INSERT INTO folder VALUES(103,102,'34AUT123')"))
      }
      if (status.created === 1) { created = true; abort.abort() }
    } })
    await setup
    assert.equal(created, true)
    assert.ok(Date.now() - discoveryStarted < 10_000, 'Folder events and the confirming scan must not wait for two polling intervals')
    const status = JSON.parse(await readFile(statusFile, 'utf8'))
    assert.equal(status.status, 'PASS'); assert.equal(status.created, 1)
    const rows = (await pool.query('SELECT c.*,r.source_folder_id,l.relative_path FROM cases c JOIN case_folder_registrations r ON r.case_id=c.id JOIN case_locations l ON l.case_id=c.id')).rows
    assert.equal(rows.length, 1)
    assert.equal(rows[0].case_type, null); assert.equal(rows[0].responsible_user_id, owner)
    assert.equal(rows[0].source_folder_id, '103'); assert.equal(rows[0].relative_path, '2026/EKİM 2026/34AUT123')
    assert.equal((await pool.query("SELECT count(*)::int n FROM jobs WHERE type='verify_case_location'")).rows[0].n, 1)
    await pool.query("UPDATE cases SET case_type='traffic',version=version+1 WHERE id=$1", [rows[0].id])
    const preserved = (await pool.query('SELECT to_jsonb(c) snapshot FROM cases c')).rows
    await startAutomaticFolderDiscovery(configFile, { once: true })
    assert.deepEqual((await pool.query('SELECT to_jsonb(c) snapshot FROM cases c')).rows, preserved)
    assert.equal(sqlite.prepare('SELECT count(*) n FROM folder').get().n, 4)
    const enabled = JSON.parse(await readFile(configFile, 'utf8'))
    enabled.trackRegisteredMoves = true
    enabled.policy.baselineSourceFolderIds = ['103']
    await writeFile(configFile, JSON.stringify(enabled))
    const old = join(source, '2026/EKİM 2026/34AUT123')
    const moved = join(source, '2026 UZAKTAN/_EKSİK DOSYALAR/34AUT123')
    await mkdir(join(source, '2026 UZAKTAN/_EKSİK DOSYALAR'), { recursive: true })
    await rename(old, moved)
    sqlite.exec("INSERT INTO folder VALUES(108,100,'2026 UZAKTAN'),(104,108,'_EKSİK DOSYALAR'); UPDATE folder SET parentfolderid=104 WHERE id=103")
    // A remaining old directory makes identity ambiguous; never silently switch it.
    await mkdir(old)
    await startAutomaticFolderDiscovery(configFile, { once: true })
    assert.equal(JSON.parse(await readFile(statusFile, 'utf8')).relocationDeferred, 1)
    assert.equal((await pool.query('SELECT relative_path FROM case_locations')).rows[0].relative_path, '2026/EKİM 2026/34AUT123')
    await rmdir(old)
    const moves = new AbortController()
    const moveDeadline = setTimeout(() => moves.abort(), 25_000)
    let relocated = false
    try {
      await startAutomaticFolderDiscovery(configFile, { signal: moves.signal, onStatus: text => {
        if (JSON.parse(text).relocated === 1) { relocated = true; moves.abort() }
      } })
    } finally { clearTimeout(moveDeadline); moves.abort() }
    assert.equal(relocated, true)
    assert.deepEqual((await pool.query('SELECT to_jsonb(c) snapshot FROM cases c')).rows, preserved)
    assert.deepEqual((await pool.query('SELECT relative_path,version FROM case_locations')).rows, [{ relative_path: '2026 UZAKTAN/_EKSİK DOSYALAR/34AUT123', version: 2 }])
    assert.equal((await pool.query('SELECT source_folder_id FROM case_folder_registrations')).rows[0].source_folder_id, '103')
    assert.equal((await pool.query("SELECT count(*)::int n FROM jobs WHERE type='verify_case_location'")).rows[0].n, 2)
    assert.equal((await pool.query('SELECT previous_relative_path FROM case_location_history ORDER BY occurred_at DESC,id DESC LIMIT 1')).rows[0].previous_relative_path, '2026/EKİM 2026/34AUT123')
    await mkdir(join(source, '2025/EKİM 2025/34OLD125'), { recursive: true })
    sqlite.exec("INSERT INTO folder VALUES(105,100,'2025'),(106,105,'EKİM 2025'),(107,106,'34OLD125')")
    await mkdir(join(source, '2026 UZAKTAN/_EKSİK DOSYALAR/06OUT123'))
    sqlite.exec("INSERT INTO folder VALUES(109,104,'06OUT123')")
    await startAutomaticFolderDiscovery(configFile, { once: true })
    await startAutomaticFolderDiscovery(configFile, { once: true })
    assert.equal((await pool.query('SELECT count(*)::int n FROM cases')).rows[0].n, 1)
    const unavailableConfig = JSON.parse(await readFile(configFile, 'utf8'))
    unavailableConfig.sourceRoot = join(directory, 'unavailable-source')
    await writeFile(configFile, JSON.stringify(unavailableConfig))
    await assert.rejects(startAutomaticFolderDiscovery(configFile, { once: true }), error => error.cause?.code === 'ENOENT')
    const offline = JSON.parse(await readFile(statusFile, 'utf8'))
    assert.equal(offline.status, 'BLOCKED'); assert.equal(offline.code, 'ENOENT')
    assert.deepEqual((await pool.query('SELECT to_jsonb(c) snapshot FROM cases c')).rows, preserved)
    await mkdir(join(source, '2026 OFİS/EKİM 2026/KAPALI DOSYALAR'), { recursive: true })
    await rename(moved, join(source, '2026 OFİS/EKİM 2026/KAPALI DOSYALAR/34AUT123'))
    await mkdir(join(source, '2027 OFİS/OCAK 2027/06NEW123'), { recursive: true })
    sqlite.exec("INSERT INTO folder VALUES(110,100,'2026 OFİS'),(111,110,'EKİM 2026'),(112,111,'KAPALI DOSYALAR'),(113,100,'2027 OFİS'),(114,113,'OCAK 2027'),(115,114,'06NEW123'); UPDATE folder SET parentfolderid=112 WHERE id=103")
    const officeConfig = { ...enabled, officeInventoryOnly: true }
    delete officeConfig.yearFolder
    await writeFile(configFile, JSON.stringify(officeConfig))
    await pool.query(`INSERT INTO cases(id,organization_id,office_year,office_sequence,office_number,plate,plate_normalized,workflow_stage)
      VALUES($1,$2,2026,900,'2026/900','34 AUT 123','34AUT123','reporting')`, [uuidv7(), org])
    async function officeCycle(expectedStatus = 'PASS') {
      const stop = new AbortController(), timer = setTimeout(() => stop.abort(), 25_000)
      try {
        await startAutomaticFolderDiscovery(configFile, { signal: stop.signal, onStatus: text => {
          if (JSON.parse(text).archived !== undefined) stop.abort()
        } })
      } finally { clearTimeout(timer); stop.abort() }
      const status = JSON.parse(await readFile(statusFile, 'utf8'))
      assert.equal(status.status, expectedStatus)
      assert.notEqual(status.archived, undefined, 'Two consistent live inventories must be reconciled')
      return status
    }
    const officeStatus = await officeCycle()
    assert.equal(officeStatus.archived, 1)
    assert.equal(officeStatus.statusUpdated, 1)
    assert.deepEqual((await pool.query('SELECT plate_normalized,lifecycle_status FROM cases WHERE NOT is_archived ORDER BY plate_normalized')).rows,
      [{ plate_normalized: '06NEW123', lifecycle_status: 'open' }, { plate_normalized: '34AUT123', lifecycle_status: 'closed' }])
    assert.equal((await pool.query('SELECT relative_path FROM case_locations WHERE case_id=$1', [rows[0].id])).rows[0].relative_path,
      '2026 OFİS/EKİM 2026/KAPALI DOSYALAR/34AUT123')
    // Windows preserves this directory's identity after an ASCII case-only rename.
    await rename(join(source, '2026 OFİS/EKİM 2026'), join(source, '2026 OFİS/Ekim 2026'))
    await pool.query("UPDATE case_locations SET relative_path=replace(relative_path,'EKİM 2026','Ekim 2026') WHERE case_id=$1", [rows[0].id])
    await rename(join(source, '2026 OFİS/Ekim 2026'), join(source, '2026 OFİS/EKIM 2026'))
    sqlite.prepare('UPDATE folder SET name=? WHERE id=111').run('EKIM 2026')
    const caseOnly = await officeCycle()
    assert.equal(caseOnly.archived, 0)
    assert.equal(caseOnly.relocationDeferred, 0)
    assert.equal(caseOnly.relocated, 0)
    assert.equal((await pool.query('SELECT is_archived FROM cases WHERE id=$1', [rows[0].id])).rows[0].is_archived, false)
    await rename(join(source, '2026 OFİS/EKIM 2026'), join(source, '2026 OFİS/EKİM 2026'))
    sqlite.prepare('UPDATE folder SET name=? WHERE id=111').run('EKİM 2026')
    await pool.query("UPDATE case_locations SET relative_path=replace(relative_path,'Ekim 2026','EKİM 2026') WHERE case_id=$1", [rows[0].id])
    await rmdir(join(source, '2026 OFİS/EKİM 2026/KAPALI DOSYALAR/34AUT123'))
    sqlite.exec('DELETE FROM folder WHERE id=103')
    assert.equal((await officeCycle()).archived, 1)
    assert.deepEqual((await pool.query('SELECT plate_normalized FROM cases WHERE NOT is_archived')).rows, [{ plate_normalized: '06NEW123' }])
    // A stable source may return under a new path after an inventory-managed archive.
    // Its location must be reconciled before the inventory can restore its case.
    await mkdir(join(source, '2026 OFİS/_EKSİK DOSYALAR/34AUT123'), { recursive: true })
    sqlite.exec("INSERT INTO folder VALUES(116,110,'_EKSİK DOSYALAR'),(103,116,'34AUT123')")
    await pool.query("UPDATE cases SET is_archived=true WHERE plate_normalized='06NEW123'")
    const restored = await officeCycle()
    assert.equal(restored.relocated, 1)
    assert.equal(restored.restored, 1)
    assert.deepEqual((await pool.query('SELECT plate_normalized FROM cases WHERE NOT is_archived')).rows, [{ plate_normalized: '34AUT123' }])
    assert.equal((await pool.query('SELECT relative_path FROM case_locations WHERE case_id=$1', [rows[0].id])).rows[0].relative_path,
      '2026 OFİS/_EKSİK DOSYALAR/34AUT123')
    const beforeUnstableSnapshot = (await pool.query('SELECT to_jsonb(c) snapshot FROM cases c ORDER BY id')).rows
    await writeFile(unstableMarker, 'one transient snapshot failure')
    const recovery = new AbortController(), recoveryDeadline = setTimeout(() => recovery.abort(), 25_000)
    let unstableBlocked = false, recovered = false
    try {
      await startAutomaticFolderDiscovery(configFile, { signal: recovery.signal, onStatus: text => {
        const status = JSON.parse(text)
        if (status.status === 'BLOCKED') unstableBlocked = true
        if (unstableBlocked && status.status === 'PASS') { recovered = true; recovery.abort() }
      } })
    } finally { clearTimeout(recoveryDeadline); recovery.abort() }
    assert.equal(unstableBlocked, true, 'An unstable snapshot must fail closed')
    assert.equal(recovered, true, 'A transient pCloud write must not terminate background discovery')
    assert.deepEqual((await pool.query('SELECT to_jsonb(c) snapshot FROM cases c ORDER BY id')).rows, beforeUnstableSnapshot)
    await writeFile(changedSourceMarker, 'one concurrent source change')
    const changedRecovery = new AbortController(), changedDeadline = setTimeout(() => changedRecovery.abort(), 25_000)
    let changedBlockedAt, changedRecoveredAt
    try {
      await startAutomaticFolderDiscovery(configFile, { signal: changedRecovery.signal, onStatus: text => {
        const status = JSON.parse(text)
        if (status.status === 'BLOCKED') { assert.equal(status.code, 'source_changed'); changedBlockedAt = Date.now() }
        if (changedBlockedAt !== undefined && status.status === 'PASS') { changedRecoveredAt = Date.now(); changedRecovery.abort() }
      } })
    } finally { clearTimeout(changedDeadline); changedRecovery.abort() }
    assert.notEqual(changedBlockedAt, undefined, 'A concurrent source change must fail closed')
    assert.notEqual(changedRecoveredAt, undefined, 'The same background discovery loop must resume after a source change')
    assert.ok(changedRecoveredAt - changedBlockedAt >= 14_000, 'Recovery must retain the configured polling interval')
    assert.deepEqual((await pool.query('SELECT to_jsonb(c) snapshot FROM cases c ORDER BY id')).rows, beforeUnstableSnapshot)
    // A manually provisioned folder becomes visible in pCloud after creation.
    // The actual scanner must read its marker and bind the original case, without forking a second case.
    const manualCaseId = uuidv7(), workspaceId = uuidv7(), manualPath = '2026 OFİS/_EKSİK DOSYALAR/34OWN123'
    await pool.query(`INSERT INTO cases(id,organization_id,office_year,office_sequence,office_number,plate,plate_normalized,workflow_stage)
      VALUES($1,$2,2026,9000,'2026/9000','34 OWN 123','34OWN123','new_notification')`, [manualCaseId, org])
    await pool.query(`INSERT INTO case_workspace_provisionings(id,organization_id,case_id,storage_root_key,relative_path,status)
      VALUES($1,$2,$3,'test-root',$4,'ready')`, [workspaceId, org, manualCaseId, manualPath])
    await pool.query(`INSERT INTO case_locations(id,organization_id,case_id,storage_root_key,relative_path,verification_status,source)
      VALUES($1,$2,$3,'test-root',$4,'verified','system')`, [uuidv7(), org, manualCaseId, manualPath])
    await mkdir(join(source, manualPath))
    await writeFile(join(source, manualPath, '.hasarbotu-workspace.json'), JSON.stringify({ schemaVersion: 'hasarbotu-workspace/1', workspaceId }))
    sqlite.exec("INSERT INTO folder VALUES(200,116,'34OWN123')")
    const caseCount = (await pool.query('SELECT count(*)::int n FROM cases')).rows[0].n
    assert.equal((await officeCycle()).created, 0)
    assert.equal((await pool.query("SELECT case_id FROM case_folder_registrations WHERE source_folder_id='200'")).rows[0].case_id, manualCaseId)
    assert.equal((await pool.query('SELECT count(*)::int n FROM cases')).rows[0].n, caseCount)
    const renamedManualPath = manualPath + ' - 2'
    await rename(join(source, manualPath), join(source, renamedManualPath))
    sqlite.exec("UPDATE folder SET name='34OWN123 - 2' WHERE id=200")
    assert.equal((await officeCycle()).relocated, 1)
    assert.equal((await pool.query('SELECT relative_path FROM case_locations WHERE case_id=$1', [manualCaseId])).rows[0].relative_path, renamedManualPath)
    assert.equal((await pool.query('SELECT count(*)::int n FROM cases')).rows[0].n, caseCount)
    // Legacy workspaces had no UUID marker or cloud registration before being moved.
    // Restore the original case only after every recorded file agrees at the new location.
    async function legacyWorkspace(sequence, plate, cloudId, mismatch = false, attested = false) {
      const caseId = uuidv7(), previousPath = `2026 OFİS/_EKSİK DOSYALAR/${plate}`, currentPath = `2026 OFİS/EKİM 2026/${plate}`
      await pool.query(`INSERT INTO cases(id,organization_id,office_year,office_sequence,office_number,plate,plate_normalized,workflow_stage,is_archived)
        VALUES($1,$2,2026,$3,$4,$5,$5,'reporting',true)`, [caseId, org, sequence, `2026/${sequence}`, plate])
      await pool.query(`INSERT INTO case_workspace_provisionings(id,organization_id,case_id,storage_root_key,relative_path,status)
        VALUES($1,$2,$3,'test-root',$4,'ready')`, [uuidv7(), org, caseId, previousPath])
      await pool.query(`INSERT INTO case_locations(id,organization_id,case_id,storage_root_key,relative_path,verification_status,source)
        VALUES($1,$2,$3,'test-root',$4,'verified','system')`, [uuidv7(), org, caseId, previousPath])
      const { createAuditService } = await import('../../services/api/dist/audit/service.js')
      await createAuditService().record(pool, { organizationId: org, actorUserId: admin, requestId: 'legacy-test',
        action: 'case.office_inventory_reconciled', entityType: 'case', entityId: caseId, details: { managedArchive: true } })
      await mkdir(join(source, currentPath, 'EVRAK'), { recursive: true })
      const attestations = join(directory, 'attestations')
      if (attested) {
        await mkdir(attestations, { recursive: true })
        const config = JSON.parse(await readFile(configFile, 'utf8'))
        await writeFile(configFile, JSON.stringify({ ...config, attestationStoreDirectory: attestations }))
        sqlite.prepare('INSERT INTO folder VALUES(?,?,?)').run(cloudId + 1000, cloudId, 'EVRAK')
      }
      let fileId = cloudId * 10
      for (const name of ['claim.txt', 'damage.txt']) {
        const bytes = `${plate}: retained ${name}`, hash = createHash('sha256').update(bytes).digest('hex')
        await writeFile(join(source, currentPath, 'EVRAK', name), mismatch && name === 'damage.txt' ? 'different claim' : bytes)
        await pool.query(`INSERT INTO tracked_files(id,organization_id,case_id,storage_root_key,relative_path,current_hash,revision)
          VALUES($1,$2,$3,'test-root',$4,$5,1)`, [uuidv7(), org, caseId, previousPath + '/EVRAK/' + name, hash])
        if (attested) {
          fileId++
          sqlite.prepare('INSERT INTO file VALUES(?,?,?,7)').run(fileId, cloudId + 1000, name)
          await writeAttestationRecord(attestations, {
            SchemaVersion: 'hasarbotu-pcloud-source-attestation-record/1.0.0', FileId: String(fileId), PCloudHash: '7',
            RelativePath: previousPath + '/EVRAK/' + name, Sha256: hash,
          })
        }
      }
      if (attested) await pool.query(`INSERT INTO tracked_files(id,organization_id,case_id,storage_root_key,relative_path,current_hash,revision)
        VALUES($1,$2,$3,'test-root',$4,$5,1)`, [uuidv7(), org, caseId, previousPath + '/EVRAK/missing-old.txt', 'a'.repeat(64)])
      sqlite.prepare('INSERT INTO folder VALUES(?,111,?)').run(cloudId, plate)
      return { caseId, previousPath, currentPath }
    }
    const legacy = await legacyWorkspace(9001, '06LEG123', 201)
    const legacyCount = (await pool.query('SELECT count(*)::int n FROM cases')).rows[0].n
    const legacyStatus = await officeCycle()
    assert.equal(legacyStatus.relocated, 1); assert.equal(legacyStatus.restored, 1)
    assert.equal((await pool.query('SELECT relative_path FROM case_locations WHERE case_id=$1', [legacy.caseId])).rows[0].relative_path, legacy.currentPath)
    assert.equal((await pool.query('SELECT source_folder_id FROM case_folder_registrations WHERE case_id=$1', [legacy.caseId])).rows[0].source_folder_id, '201')
    assert.equal((await pool.query('SELECT count(*)::int n FROM cases')).rows[0].n, legacyCount)
    const attested = await legacyWorkspace(9003, '06ATT123', 203, false, true)
    const attestedStatus = await officeCycle()
    assert.equal(attestedStatus.relocated, 1); assert.equal(attestedStatus.restored, 1)
    assert.equal((await pool.query('SELECT relative_path FROM case_locations WHERE case_id=$1', [attested.caseId])).rows[0].relative_path, attested.currentPath)
    assert.equal((await pool.query('SELECT count(*)::int n FROM tracked_files WHERE case_id=$1', [attested.caseId])).rows[0].n, 3, 'Missing historical file evidence must be retained')
    const copied = await legacyWorkspace(9004, '06CPY123', 204, false, true)
    sqlite.exec('UPDATE file SET id=id+100000 WHERE id=2041')
    await officeCycle('ATTENTION')
    assert.equal((await pool.query('SELECT relative_path FROM case_locations WHERE case_id=$1', [copied.caseId])).rows[0].relative_path, copied.previousPath)
    assert.equal((await pool.query('SELECT 1 FROM case_folder_registrations WHERE case_id=$1', [copied.caseId])).rowCount, 0, 'Copied file contents must not inherit an old pCloud file identity')
    const tampered = await legacyWorkspace(9005, '06SIG123', 205, false, true)
    await writeFile(join(directory, 'attestations', attestationFileNameFor('2051', '7') + '.sha256'), '0'.repeat(64))
    const tamperedStatus = await officeCycle('ATTENTION')
    assert.ok(tamperedStatus.relocationIssues.some(i => i.sourceFolderId === '205' && i.code === 'folder_relocation_content_changed'))
    assert.equal((await pool.query('SELECT relative_path FROM case_locations WHERE case_id=$1', [tampered.caseId])).rows[0].relative_path, tampered.previousPath)
    const mismatch = await legacyWorkspace(9002, '06BAD123', 202, true)
    const failedStatus = await officeCycle('ATTENTION')
    assert.ok(failedStatus.relocationIssues.some(i => i.sourceFolderId === '202' && i.code === 'folder_relocation_content_changed'))
    assert.equal((await pool.query('SELECT relative_path FROM case_locations WHERE case_id=$1', [mismatch.caseId])).rows[0].relative_path, mismatch.previousPath)
    assert.equal((await pool.query('SELECT 1 FROM case_folder_registrations WHERE case_id=$1', [mismatch.caseId])).rowCount, 0)
  } finally {
    clearTimeout(deadline); abort.abort(); sqlite.close(); await pool.end()
    if (originalUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalUrl
  }
})
