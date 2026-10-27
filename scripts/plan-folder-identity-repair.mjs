import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Offline review only. This module deliberately has no database or cloud client.
export function planFolderIdentityRepair(evidence, evidenceSha256) {
  assert.match(evidenceSha256, /^[a-f0-9]{64}$/)
  assert.equal(evidence.readOnlyTransactionVerified, true)
  assert.equal(evidence.cloudMetadataReadOnlySnapshot, true)
  assert.equal(evidence.productionDatabaseMutations, 0)
  assert.ok(Number.isFinite(Date.parse(evidence.checkedAt)), 'Missing snapshot time')
  assert.ok(Array.isArray(evidence.issues) && evidence.issues.length > 0)
  const identities = new Set(), cases = new Set()
  const repairs = evidence.issues.map(issue => {
    assert.match(issue.sourceFolderId, /^\d+$/)
    assert.ok(!identities.has(issue.sourceFolderId), 'Duplicate folder identity')
    identities.add(issue.sourceFolderId)
    assert.equal(issue.repairExecuted, false)
    assert.equal(issue.sourceFolderIdStillExists, true)
    assert.equal(issue.originalPathFolderIdPresent, false)
    assert.equal(issue.sourceIdNowAtOccupiedPath, true)
    assert.deepEqual(issue.cases, [issue.registered.officeNumber, issue.occupant.officeNumber])
    const records = [issue.registered, issue.occupant].map(record => {
      assert.match(record.officeNumber, /^\d{4}\/\d+$/)
      assert.ok(!cases.has(record.officeNumber), 'Overlapping case pairs require joint review')
      cases.add(record.officeNumber)
      for (const field of ['version', 'locationVersion']) assert.ok(Number.isSafeInteger(record[field]) && record[field] > 0)
      for (const field of ['documentCount', 'noteCount', 'fileOperationCount']) assert.ok(Number.isSafeInteger(record[field]) && record[field] >= 0)
      return { officeNumber: record.officeNumber, expectedCaseVersion: record.version,
        expectedLocationVersion: record.locationVersion, archived: record.archived,
        lifecycleStatus: record.lifecycleStatus, documents: record.documentCount,
        notes: record.noteCount, fileOperations: record.fileOperationCount }
    })
    return {
      sourceFolderId: issue.sourceFolderId, records,
      existingRelocationBlockedBy: 'folder_relocation_location_in_use',
      operatorDecision: { operatorId: null, approvedAt: null, officialClaimEvidenceReference: null,
        relationship: null, authoritativeCase: null, approvedPlanSha256: null },
      alternatives: [
        { relationship: 'distinct_claims', action: 'Keep both cases and histories. Operator attests a separate physical folder and identity for each claim before any mapping.' },
        { relationship: 'duplicate_claim', action: 'Keep both case IDs, notes, document versions and audit history. Operator selects the canonical folder owner; prepare a separately reviewed transactional binding repair. No automatic record merge or deletion.' },
        { relationship: 'unresolved', action: 'Keep current quarantine and mapping unchanged.' },
      ],
      executionPrerequisites: [
        'Verify official claim number, insurer and incident date for BOTH cases; plate equality is insufficient.',
        'Refresh repeatable-read read-only DB evidence and consistent cloud metadata; reject any version, path, identity or history-count drift.',
        'Verify all pending/running file, document, OCR, tracking and folder-scan jobs; quiesce only the affected flow in an approved maintenance window.',
        'Take a restorable DB backup and cloud folder metadata/content backup with hashes; verify restore in a disposable database.',
        'Record named operator approval against the refreshed plan digest and official evidence references.',
        'A separate reviewed implementation must lock both cases/locations and the folder identity, enforce versions/unique constraints and append before/after audit evidence atomically.',
        'Revalidate physical folder identity immediately before applying; abort/rollback on any mismatch. Existing relocation cannot resolve an occupied target.',
        'Verify both case details, notes, document hashes, folder verification and two read-only inventory passes; rollback binding changes from captured before-images if verification fails, preserving new history.',
      ],
    }
  })
  const plan = { schemaVersion: 'folder-identity-repair-review/1', mode: 'dry-run',
    status: 'AWAITING_OPERATOR_IDENTITY_APPROVAL', evidenceSha256, evidenceCheckedAt: evidence.checkedAt,
    productionMutations: 0, executable: false, approvalAuthenticityVerified: false,
    preserves: ['case IDs', 'notes and review history', 'document versions and hashes', 'audit events', 'physical folder contents'], repairs }
  return { ...plan, planSha256: createHash('sha256').update(JSON.stringify(plan)).digest('hex') }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [source, destination, ...extra] = process.argv.slice(2)
  assert.ok(source && destination && !extra.length, 'Usage: node scripts/plan-folder-identity-repair.mjs <read-only-evidence.json> <plan.json>')
  assert.notEqual(resolve(source), resolve(destination), 'Evidence must be preserved')
  const bytes = await readFile(source)
  const plan = planFolderIdentityRepair(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')), createHash('sha256').update(bytes).digest('hex'))
  await writeFile(destination, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ status: plan.status, pairs: plan.repairs.length, planSha256: plan.planSha256, productionMutations: 0 }))
}
