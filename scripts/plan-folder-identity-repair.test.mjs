import assert from 'node:assert/strict'
import test from 'node:test'
import { planFolderIdentityRepair } from './plan-folder-identity-repair.mjs'

const record = officeNumber => ({ officeNumber, version: 2, locationVersion: 1, archived: false, lifecycleStatus: 'open', documentCount: 3, noteCount: 4, fileOperationCount: 0 })
const evidence = () => ({ checkedAt: '2026-10-27T12:22:44.176Z', readOnlyTransactionVerified: true, cloudMetadataReadOnlySnapshot: true, productionDatabaseMutations: 0,
  issues: [{ cases: ['2026/650', '2026/640'], sourceFolderId: '27180552212', repairExecuted: false, sourceFolderIdStillExists: true, originalPathFolderIdPresent: false,
    sourceIdNowAtOccupiedPath: true, registered: record('2026/650'), occupant: record('2026/640') }] })

test('occupied identity produces a deterministic non-executable plan preserving both histories', () => {
  const source = evidence(), original = structuredClone(source)
  const plan = planFolderIdentityRepair(source, 'a'.repeat(64))
  assert.deepEqual(source, original)
  assert.deepEqual(plan, planFolderIdentityRepair(source, 'a'.repeat(64)))
  assert.equal(plan.executable, false)
  assert.equal(plan.repairs[0].operatorDecision.authoritativeCase, null)
  assert.equal(plan.repairs[0].records[1].notes, 4)
  assert.notEqual(plan.planSha256, planFolderIdentityRepair(source, 'b'.repeat(64)).planSha256)
})

test('rejects unsafe snapshots, changed physical identity and overlapping pairs', () => {
  for (const change of [s => { s.productionDatabaseMutations = 1 }, s => { s.readOnlyTransactionVerified = false },
    s => { s.issues[0].originalPathFolderIdPresent = true }, s => { s.issues[0].registered.version = 0 },
    s => { s.issues.push(structuredClone(s.issues[0])) }]) {
    const source = evidence(); change(source)
    assert.throws(() => planFolderIdentityRepair(source, 'a'.repeat(64)))
  }
})
