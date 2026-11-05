import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { MAX_RESTORE_EVIDENCE_AGE_MS, validateRestoreReceipt, verifyRestoreEvidence, restoreFileHash, withIndependentRestoreCluster, importLegacyRestoreBackup } from './api-transition-restore-evidence.mjs'

const h = value => createHash('sha256').update(value).digest('hex')
const identity = {candidateSha256:h('candidate'),migrationsSha256:h('migrations'),validatorSha256:h('validator'),toolsSha256:h('tools'),sourceIdentitySha256:h('office database'),serverVersion:'17.11'}
const makeReceipt = () => ({schemaVersion:'hasarbotu-independent-restore/1',status:'PASS',strategy:'isolated-cluster',completedAt:new Date().toISOString(),...identity,
  backup:{sha256:h('verified dump'),bytes:13,contentSha256:h('all rows')},schemaSha256:h('canonical constraint'),tableCount:1,rowCount:'2',
  checks:{restoredContent:true,migrationSchema:true,rollbackReapply:true,temporaryDatabaseRemoved:true,clusterStopped:true,clusterDirectoryRemoved:true,restoreRoleUnprivileged:true}})

test('strict current receipt is bound to all executable identities and the exact backup', () => {
  const receipt = makeReceipt()
  assert.equal(validateRestoreReceipt(receipt,{...identity,backup:receipt.backup}),receipt)
})
for (const key of ['candidateSha256','migrationsSha256','validatorSha256','toolsSha256','sourceIdentitySha256']) {
  test(`rejects a changed ${key}`, () => {
    const receipt = makeReceipt(); receipt[key] = h('other')
    assert.throws(() => validateRestoreReceipt(receipt,identity),/RESTORE_EVIDENCE_BINDING_MISMATCH/)
  })
}
for (const key of ['restoredContent','migrationSchema','rollbackReapply','temporaryDatabaseRemoved','clusterStopped','clusterDirectoryRemoved','restoreRoleUnprivileged']) {
  test(`rejects missing or failed ${key}`, () => {
    for (const value of [undefined,false,'true']) {
      const receipt=makeReceipt();receipt.checks[key]=value
      assert.throws(() => validateRestoreReceipt(receipt,identity),/RESTORE_EVIDENCE_INCOMPLETE/)
    }
  })
}
test('rejects expired, future or invalid timestamps; timestamps cannot be omitted', () => {
  const now=Date.now()
  for(const at of [new Date(now-MAX_RESTORE_EVIDENCE_AGE_MS-1).toISOString(),new Date(now+31_000).toISOString(),'invalid',undefined]) {
    const receipt=makeReceipt();receipt.completedAt=at
    assert.throws(() => validateRestoreReceipt(receipt,identity,now),/RESTORE_EVIDENCE_EXPIRED/)
  }
})
test('exact server version and mandatory schema/backup metadata fail closed', () => {
  for(const change of [r=>r.serverVersion='17.12',r=>delete r.schemaSha256,r=>r.backup.bytes=0,r=>r.backup.bytes='13',r=>r.status='PENDING',r=>r.schemaVersion='old',r=>r.strategy='same-cluster']) {
    const receipt=makeReceipt();change(receipt)
    assert.throws(() => validateRestoreReceipt(receipt,identity),/RESTORE_EVIDENCE_/)
  }
  for(const key of ['sha256','bytes','contentSha256']) {
    const receipt=makeReceipt(),backup={...receipt.backup,[key]:key==='bytes'?14:h('new')}
    assert.throws(() => validateRestoreReceipt(receipt,{...identity,backup}),/RESTORE_EVIDENCE_BACKUP_MISMATCH/)
  }
})
test('checks an external pin and actual archive bytes, rather than trusting the PASS label', async () => {
  const root=await mkdtemp(join(tmpdir(),'hb-proof-'))
  try {
    const path=join(root,'restore-evidence.json'),dump=join(root,'database.dump')
    const receipt=makeReceipt()
    await writeFile(path,JSON.stringify(receipt));await writeFile(dump,'verified dump')
    const evidence={path,sha256:await restoreFileHash(path)}
    assert.equal((await verifyRestoreEvidence(evidence,identity)).status,'PASS')
    await assert.rejects(verifyRestoreEvidence({path},identity),/RESTORE_EVIDENCE_PIN_REQUIRED/)
    await assert.rejects(verifyRestoreEvidence({path:join(root,'missing.json'),sha256:evidence.sha256},identity),/RESTORE_EVIDENCE_MISSING/)
    await writeFile(path,JSON.stringify({...receipt,status:'PENDING'}))
    await assert.rejects(verifyRestoreEvidence(evidence,identity),/RESTORE_EVIDENCE_HASH_MISMATCH/)
    await writeFile(path,JSON.stringify(receipt));await writeFile(dump,'tampered dump')
    await assert.rejects(verifyRestoreEvidence(evidence,identity),/RESTORE_EVIDENCE_BACKUP_MISMATCH/)
  } finally { await rm(root,{recursive:true,force:true}) }
})

const pgEnabled=!!process.env.HB_TRANSITION_TEST_DUMP && !!process.env.HB_TRANSITION_TEST_PGDATA
test('real isolated server: callback failure cleans its cluster; production paths are rejected before initdb', {skip:!pgEnabled,timeout:60000}, async () => {
  const parent=await realpath(await mkdtemp(join(tmpdir(),'hb-proof-cluster-')))
  const productionDataDirectory=resolve(process.env.HB_TRANSITION_TEST_PGDATA)
  const options={parent,dumpTool:process.env.HB_TRANSITION_TEST_DUMP,expectedVersion:'17.11',productionDataDirectory,databaseUrl:process.env.TEST_DATABASE_URL}
  try {
    if(process.platform==='win32') execFileSync(join(process.env.SystemRoot,'System32','icacls.exe'),[parent,'/inheritance:r','/grant:r','*S-1-5-18:(OI)(CI)F','*S-1-5-32-544:(OI)(CI)F'],{windowsHide:true,stdio:'pipe'})
    const sourceBefore=await readFile(join(productionDataDirectory,'postmaster.pid'),'utf8')
    let clusterData
    await assert.rejects(withIndependentRestoreCluster(options,async target=>{clusterData=target.data;throw Error('EXPECTED_CALLBACK_FAILURE')}),/EXPECTED_CALLBACK_FAILURE/)
    assert.ok(clusterData)
    await assert.rejects(readFile(join(clusterData,'PG_VERSION')),error=>error.code==='ENOENT')
    assert.deepEqual(await (await import('node:fs/promises')).readdir(parent),[])
    assert.equal(await readFile(join(productionDataDirectory,'postmaster.pid'),'utf8'),sourceBefore)
    await assert.rejects(withIndependentRestoreCluster({...options,parent:productionDataDirectory},async()=>{}),/ISOLATED_RESTORE_PATH_INVALID/)
  } finally { await rm(parent,{recursive:true,force:true}) }
})

test('legacy evidence cannot be used as a current receipt, even when its PASS is correctly pinned', async () => {
  const root=await mkdtemp(join(tmpdir(),'hb-legacy-proof-'))
  try {
    await mkdir(join(root,'fresh-restore'))
    const manifestPath=join(root,'manifest.json')
    await writeFile(manifestPath,JSON.stringify({entries:[]}))
    const legacy={manifestPath,sha256:await restoreFileHash(manifestPath),report:'fresh-restore/isolated-restore-result.json'}
    await assert.rejects(importLegacyRestoreBackup(legacy,root,'17.11'),/RESTORE_EVIDENCE_INCOMPLETE/)
    await assert.rejects(importLegacyRestoreBackup({...legacy,report:'../outside.json'},root,'17.11'),/RESTORE_EVIDENCE_PATH_INVALID/)
    assert.throws(() => validateRestoreReceipt({status:'PASS',clusterStopped:true},identity),/RESTORE_EVIDENCE_INVALID/)
  } finally { await rm(root,{recursive:true,force:true}) }
})
