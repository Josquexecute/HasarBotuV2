import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  assembleFreshnessObservation,
  assembleIsolationCheck,
  assembleJobObservation,
  buildObservationBundle,
  computeHashFenceVerdict,
} from './generate-file-operation-observation-bundle.mjs'
import { writeAttestationRecord } from './pcloud-source-attestation.mjs'

// generate-file-operation-observation-bundle.mjs testleri (HB-2026-178).
//
// Postgres'e bagimli asamalar (assembleJobObservation/assembleIsolationCheck/
// buildObservationBundle) GERCEK bir veritabani yerine SCRIPTLENMIS bir sahte
// pool (createScriptedPool) ile test edilir -- bu makinede TEST_DATABASE_URL
// icin yerel kimlik dosyasi olmadigindan gercek Postgres'e karsi bu oturumda
// calistirilamiyor (durustce boyle belgeleniyor). Sahte pool, fonksiyonlarin
// GERCEK sorgu sirasini/parametrelerini VE sonuc-birlestirme mantigini
// deterministik olarak dogrular -- yalniz SQL'in gercek Postgres'e karsi
// sozdizimsel olarak calistigini KANITLAMAZ (SQL, store.ts/agent-jobs.test.ts
// gibi bu oturumda zaten okunmus, gercek kod orneklerine yakin tutuldu).
//
// Session-0 freshness gate sarmalayicisi (assembleFreshnessObservation) ise
// GERCEK, DB-bagimsiz (SQLite+dosya sistemi) bir sentetik fixture ile tam
// olarak calistirilip dogrulanir -- pcloud-session0-freshness-gate.test.mjs
// ile ayni desen.

function createScriptedPool(responses) {
  const calls = []
  let index = 0
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params })
      if (index >= responses.length) throw new Error(`SCRIPTED_POOL_EXHAUSTED at call ${index}: ${sql}`)
      const response = responses[index]
      index += 1
      return response
    },
  }
}

const NOW = new Date('2026-08-10T09:00:00.000Z')
const JOB_ID = '00000000-0000-7000-8000-000000000001'
const ORG_ID = '00000000-0000-7000-8000-000000000002'
const OPERATION_ID = '00000000-0000-7000-8000-000000000003'
const CASE_ID = '00000000-0000-7000-8000-000000000004'
const AGENT_ID = '00000000-0000-7000-8000-000000000005'

function baseJobRow(overrides = {}) {
  return {
    id: JOB_ID, organization_id: ORG_ID, type: 'apply_labor_workbook', status: 'succeeded',
    target_type: 'labor_workbook_apply', target_id: OPERATION_ID, target_version: 2,
    attempt_count: 1, max_attempts: 5, leased_by_agent_id: AGENT_ID, lease_expires_at: null,
    heartbeat_at: null, next_attempt_at: NOW, last_error_code: null, created_at: NOW, updated_at: NOW,
    ...overrides,
  }
}

function baseOperationRow(overrides = {}) {
  return {
    id: OPERATION_ID, case_id: CASE_ID, application_id: 'app-1', revision_id: 'rev-1', revision_version: 1,
    profile_id: 'profile-1', profile_version_id: 'profilever-1', profile_version: 1,
    storage_root_key: 'baran-global-primary', relative_workbook_path: '2026/00AAA000/İŞÇİLİK/isci.xlsx',
    sheet_name: 'İşçilik', rule_version: 'labor-workbook-apply/1.0.0',
    approved_revision_snapshot_hash: 'a'.repeat(64), status: 'completed', version: 3,
    source_workbook_hash: 'b'.repeat(64), preview_plan_hash: 'c'.repeat(64), previous_total_minor: 1000,
    new_total_minor: 1500, changed_row_count: 2, unchanged_row_count: 1, control_required_row_count: 0,
    preview_job_id: 'preview-job-1', apply_job_id: JOB_ID, approved_by_user_id: 'user-1', approved_at: NOW,
    result_workbook_hash: 'd'.repeat(64), backup_file_name: 'isci.xlsx.bak-2026', safe_error_code: null,
    created_at: NOW, updated_at: NOW, completed_at: NOW,
    ...overrides,
  }
}

test('assembleJobObservation: mutlu yol -- job+operation+agent+audit dogru birlestirilir, sorgular dogru parametrelerle cagrilir', async () => {
  const pool = createScriptedPool([
    { rows: [baseJobRow()] },
    { rows: [baseOperationRow()] },
    { rows: [{ id: AGENT_ID, name: 'svc-hb-fileagent', status: 'active', last_seen_at: NOW, created_at: NOW }] },
    { rows: [{ id: 'ae-1', actor_user_id: null, action: 'labor_workbook.apply_completed', resource_type: 'labor_workbook_apply', resource_id: OPERATION_ID, request_id: 'req-1', occurred_at: NOW, details: { caseId: CASE_ID } }] },
  ])

  const result = await assembleJobObservation(pool, { jobId: JOB_ID })

  assert.equal(result.job.id, JOB_ID)
  assert.equal(result.operation.case_id, CASE_ID)
  assert.equal(result.agent.name, 'svc-hb-fileagent')
  assert.equal(result.auditEvents.length, 1)

  assert.equal(pool.calls.length, 4)
  assert.match(pool.calls[0].sql, /FROM jobs WHERE id = \$1/)
  assert.deepEqual(pool.calls[0].params, [JOB_ID])
  assert.match(pool.calls[1].sql, /FROM labor_workbook_apply_operations/)
  assert.deepEqual(pool.calls[1].params, [JOB_ID])
  assert.match(pool.calls[2].sql, /FROM agents WHERE id = \$1/)
  assert.deepEqual(pool.calls[2].params, [AGENT_ID])
  assert.match(pool.calls[3].sql, /FROM audit_events/)
  assert.equal(pool.calls[3].params[0], ORG_ID)
})

test('assembleJobObservation: job bulunamazsa JOB_NOT_FOUND ile reddedilir, baska sorgu yapilmaz', async () => {
  const pool = createScriptedPool([{ rows: [] }])
  await assert.rejects(() => assembleJobObservation(pool, { jobId: JOB_ID }), /JOB_NOT_FOUND/)
  assert.equal(pool.calls.length, 1)
})

test('assembleJobObservation: desteklenmeyen target_type fail-closed reddedilir', async () => {
  const pool = createScriptedPool([{ rows: [baseJobRow({ target_type: 'file_operation' })] }])
  await assert.rejects(() => assembleJobObservation(pool, { jobId: JOB_ID }), /UNSUPPORTED_TARGET_TYPE:file_operation/)
})

test('assembleJobObservation: operation satiri bulunamazsa OPERATION_NOT_FOUND', async () => {
  const pool = createScriptedPool([{ rows: [baseJobRow()] }, { rows: [] }])
  await assert.rejects(() => assembleJobObservation(pool, { jobId: JOB_ID }), /OPERATION_NOT_FOUND/)
})

test('assembleJobObservation: leased_by_agent_id null ise agent sorgusu HIC yapilmaz, Agent null doner', async () => {
  const pool = createScriptedPool([
    { rows: [baseJobRow({ leased_by_agent_id: null })] },
    { rows: [baseOperationRow()] },
    { rows: [] }, // audit_events (agent sorgusu atlandigi icin bu 3. cagri)
  ])
  const result = await assembleJobObservation(pool, { jobId: JOB_ID })
  assert.equal(result.agent, null)
  assert.equal(pool.calls.length, 3)
  assert.match(pool.calls[2].sql, /FROM audit_events/)
})

test('assembleIsolationCheck: farkli case/target_id -- izolasyon dogrulanir, cross-case leak YOK', async () => {
  const pool = createScriptedPool([
    { rows: [{ id: 'other-job-1', target_id: 'different-operation-id', status: 'failed', last_error_code: 'case_not_fresh', updated_at: NOW }] },
    { rows: [{ c: 4 }] },
  ])
  const isolation = await assembleIsolationCheck(pool, { organizationId: ORG_ID, jobId: JOB_ID, targetId: OPERATION_ID, updatedAt: NOW })
  assert.equal(isolation.otherActiveJobsCount, 4)
  assert.equal(isolation.crossCaseLeakDetected, false)
  assert.equal(isolation.verdict, 'isolated')
})

test('assembleIsolationCheck: AYNI target_id ile baska bir basarisiz job bulunursa needs_review', async () => {
  const pool = createScriptedPool([
    { rows: [{ id: 'other-job-2', target_id: OPERATION_ID, status: 'dead_letter', last_error_code: 'case_not_fresh', updated_at: NOW }] },
    { rows: [{ c: 1 }] },
  ])
  const isolation = await assembleIsolationCheck(pool, { organizationId: ORG_ID, jobId: JOB_ID, targetId: OPERATION_ID, updatedAt: NOW })
  assert.equal(isolation.crossCaseLeakDetected, true)
  assert.equal(isolation.verdict, 'needs_review')
})

test('computeHashFenceVerdict: tamamlanmis + result hash mevcut -> verified_end_to_end', () => {
  assert.equal(computeHashFenceVerdict(baseOperationRow()), 'verified_end_to_end')
})

test('computeHashFenceVerdict: RESULT_HASH_MISMATCH -> mismatch_detected_server_side_rejected', () => {
  assert.equal(
    computeHashFenceVerdict(baseOperationRow({ safe_error_code: 'RESULT_HASH_MISMATCH', status: 'failed', result_workbook_hash: null })),
    'mismatch_detected_server_side_rejected',
  )
})

test('computeHashFenceVerdict: henuz tamamlanmamis -> incomplete', () => {
  assert.equal(
    computeHashFenceVerdict(baseOperationRow({ status: 'applying', result_workbook_hash: null, safe_error_code: null })),
    'incomplete',
  )
})

test('buildObservationBundle: uctan uca birlestirme -- HashFence/IsolationCheck/FreshnessObservation(skipped) dogru sekillenir', async () => {
  const pool = createScriptedPool([
    { rows: [baseJobRow()] },
    { rows: [baseOperationRow()] },
    { rows: [{ id: AGENT_ID, name: 'svc-hb-fileagent', status: 'active', last_seen_at: NOW, created_at: NOW }] },
    { rows: [] },
    { rows: [] }, // isolation: sibling
    { rows: [{ c: 0 }] }, // isolation: active count
  ])

  const bundle = await buildObservationBundle({ pool, jobId: JOB_ID, freshnessInputs: null })

  assert.equal(bundle.SchemaVersion, 'hasarbotu-file-operation-observation-bundle/1.0.0')
  assert.equal(bundle.JobId, JOB_ID)
  assert.equal(bundle.HashFence.PreWriteHash, 'b'.repeat(64))
  assert.equal(bundle.HashFence.PostWriteHash, 'd'.repeat(64))
  assert.equal(bundle.HashFence.Verdict, 'verified_end_to_end')
  assert.equal(bundle.IsolationCheck.Verdict, 'isolated')
  assert.equal(bundle.FreshnessObservation.skipped, true)
  assert.ok(!JSON.stringify(bundle).toLowerCase().includes('secret'), 'bundle hicbir secret alani icermez')
})

test('assembleFreshnessObservation: freshnessInputs null ise atlanir, hicbir yan etki olusmaz', async () => {
  const result = await assembleFreshnessObservation(null)
  assert.deepEqual(result, { skipped: true, reason: 'FRESHNESS_INPUTS_NOT_PROVIDED' })
})

test('assembleFreshnessObservation: GERCEK sentetik fixture ile CaseStatus=ready doner ve not alani eklenir', async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'hasarbotu-observation-freshness-test-'))
  context.after(async () => rm(temporaryRoot, { recursive: true, force: true }))

  const topLevelFolderName = 'KAYNAK'
  const caseRelativePath = '00AAA000'
  const targetCaseRoot = path.join(temporaryRoot, 'HEDEF', topLevelFolderName, caseRelativePath)
  const attestationStoreDirectory = path.join(temporaryRoot, 'attestations')
  await mkdir(targetCaseRoot, { recursive: true })
  await mkdir(attestationStoreDirectory, { recursive: true })

  const readyBytes = 'gozlem-paketi-hazir-dosya'
  await writeFile(path.join(targetCaseRoot, 'ready.pdf'), readyBytes)

  const databasePath = path.join(temporaryRoot, 'data.db')
  const database = new DatabaseSync(databasePath)
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE folder (id INTEGER PRIMARY KEY, parentfolderid INTEGER NOT NULL, name TEXT NOT NULL, flags INTEGER NOT NULL, ctime INTEGER NOT NULL, mtime INTEGER NOT NULL, subdircnt INTEGER NOT NULL);
    CREATE TABLE file (id INTEGER PRIMARY KEY, parentfolderid INTEGER NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL, hash INTEGER NOT NULL, flags INTEGER NOT NULL, ctime INTEGER NOT NULL, mtime INTEGER NOT NULL);
    CREATE TABLE task (id INTEGER, itemid INTEGER, localitemid INTEGER, newitemid INTEGER);
    CREATE TABLE fstask (id INTEGER, fileid INTEGER);
    INSERT INTO folder VALUES (100, 0, 'KAYNAK', 0, 1, 1, 1);
    INSERT INTO folder VALUES (200, 100, '00AAA000', 0, 1, 1, 0);
    INSERT INTO file VALUES (7001, 200, 'ready.pdf', ${readyBytes.length}, 999, 0, 1, 1);
  `)
  database.close()

  await writeAttestationRecord(attestationStoreDirectory, {
    SchemaVersion: 'hasarbotu-pcloud-source-attestation-record/1.0.0',
    FileId: '7001',
    PCloudHash: '999',
    RelativePath: '00AAA000\\ready.pdf',
    SizeBytes: readyBytes.length,
    Sha256: createHash('sha256').update(readyBytes).digest('hex'),
    AttestedAtUtc: new Date().toISOString(),
    AttestedBy: 'test',
  })

  const result = await assembleFreshnessObservation({
    targetCaseRoot, databasePath, topLevelFolderName, caseRelativePath, attestationStoreDirectory,
  })

  assert.equal(result.skipped, false)
  assert.equal(result.CaseStatus, 'ready')
  assert.equal(result.Summary.ReadyCount, 1)
  assert.match(result.note, /tarihsel bir karar tekrari DEGIL/)
})

const scriptPath = fileURLToPath(new URL('./generate-file-operation-observation-bundle.mjs', import.meta.url))

test('CLI: --job-id eksikse ARGUMENT_MISSING ile fail-closed reddedilir (DB gerekmez)', () => {
  const result = spawnSync('node', [scriptPath], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  const parsed = JSON.parse(result.stdout)
  assert.equal(parsed.ErrorCode, 'ARGUMENT_MISSING:--job-id')
})

test('CLI: bilinmeyen argüman ARGUMENT_UNKNOWN ile reddedilir', () => {
  const result = spawnSync('node', [scriptPath, '--job-id', JOB_ID, '--not-a-real-flag', 'x'], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  const parsed = JSON.parse(result.stdout)
  assert.match(parsed.ErrorCode, /^ARGUMENT_UNKNOWN:/)
})

test('CLI: freshness-observation gruplarindan yalniz biri verilirse (case-relative-path eksik) fail-closed reddedilir', () => {
  const result = spawnSync('node', [scriptPath, '--job-id', JOB_ID, '--top-level-folder-name', 'X'], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  const parsed = JSON.parse(result.stdout)
  assert.equal(parsed.ErrorCode, 'ARGUMENT_MISSING:--case-relative-path')
})

test('CLI: gecerli argumanlar ama DATABASE_URL yoksa DATABASE_URL_REQUIRED ile reddedilir', () => {
  const env = { ...process.env }
  delete env.DATABASE_URL
  const result = spawnSync('node', [scriptPath, '--job-id', JOB_ID], { encoding: 'utf8', env })
  assert.equal(result.status, 1)
  const parsed = JSON.parse(result.stdout)
  assert.equal(parsed.ErrorCode, 'DATABASE_URL_REQUIRED')
})
