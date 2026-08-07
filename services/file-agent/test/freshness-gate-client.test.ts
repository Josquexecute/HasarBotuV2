import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkCaseFreshness } from '../src/freshness-gate-client.js'
import type { FreshnessGateConfig } from '../src/config.js'

// Real end-to-end test (HB-2026-171): actually spawns the REAL,
// unmodified deploy/windows-service/pcloud-session0-freshness-gate.mjs
// as a child process, exactly as agent.ts's dispatch does -- proves the
// spawn/JSON-parsing/exit-code contract genuinely works from TypeScript,
// not just that the .mjs tool works on its own (already proven in
// deploy/windows-service/pcloud-session0-freshness-gate.test.mjs and via
// real-case validation, HB-2026-167/170).

const toolPath = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '..', '..', '..', 'deploy', 'windows-service', 'pcloud-session0-freshness-gate.mjs',
)

function sha256Of(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

describe('checkCaseFreshness (real spawn of pcloud-session0-freshness-gate.mjs)', () => {
  let root: string
  let targetRoot: string
  let attestationStoreDirectory: string
  let databasePath: string
  const topLevelFolderName = 'KAYNAK'

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-freshness-client-'))
    targetRoot = join(root, 'HEDEF', topLevelFolderName)
    attestationStoreDirectory = join(root, 'attestations')
    await mkdir(attestationStoreDirectory, { recursive: true })
    databasePath = join(root, 'data.db')
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  async function buildCaseFixture(caseRelativePath: string, fileId: number, hash: number, bytes: string): Promise<void> {
    const caseDir = join(targetRoot, caseRelativePath)
    await mkdir(caseDir, { recursive: true })
    await writeFile(join(caseDir, 'a.pdf'), bytes)
    const database = new DatabaseSync(databasePath)
    database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS folder (id INTEGER PRIMARY KEY, parentfolderid INTEGER NOT NULL, name TEXT NOT NULL, flags INTEGER NOT NULL, ctime INTEGER NOT NULL, mtime INTEGER NOT NULL, subdircnt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS file (id INTEGER PRIMARY KEY, parentfolderid INTEGER NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL, hash INTEGER NOT NULL, flags INTEGER NOT NULL, ctime INTEGER NOT NULL, mtime INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS task (id INTEGER, itemid INTEGER, localitemid INTEGER, newitemid INTEGER);
      CREATE TABLE IF NOT EXISTS fstask (id INTEGER, fileid INTEGER);
    `)
    const topRow = database.prepare('SELECT id FROM folder WHERE parentfolderid = 0 AND name = ?').get(topLevelFolderName)
    if (topRow === undefined) {
      database.exec(`INSERT INTO folder VALUES (100, 0, '${topLevelFolderName}', 0, 1, 1, 1);`)
    }
    const caseFolderIdRow = database.prepare('SELECT id FROM folder WHERE parentfolderid = 100 AND name = ?').get(caseRelativePath)
    let caseFolderId = 200 + fileId
    if (caseFolderIdRow === undefined) {
      database.exec(`INSERT INTO folder VALUES (${caseFolderId}, 100, '${caseRelativePath}', 0, 1, 1, 0);`)
    } else {
      caseFolderId = Number((caseFolderIdRow as { id: bigint | number }).id)
    }
    database.exec(`INSERT INTO file VALUES (${fileId}, ${caseFolderId}, 'a.pdf', ${bytes.length}, ${hash}, 0, 1, 1);`)
    database.close()
  }

  async function writeAttestation(fileId: number, hash: number, caseRelativePath: string, bytes: string): Promise<void> {
    const record = {
      SchemaVersion: 'hasarbotu-pcloud-source-attestation-record/1.0.0',
      FileId: String(fileId),
      PCloudHash: String(hash),
      RelativePath: `${caseRelativePath}\\a.pdf`,
      SizeBytes: bytes.length,
      Sha256: sha256Of(bytes),
      AttestedAtUtc: new Date().toISOString(),
      AttestedBy: 'test',
    }
    const fileName = `attestation-${fileId}-${hash < 0 ? `neg${(-hash).toString(16)}` : `pos${hash.toString(16)}`}.json`
    const json = JSON.stringify(record, null, 2)
    await writeFile(join(attestationStoreDirectory, fileName), json, 'utf8')
    const hashHex = createHash('sha256').update(json, 'utf8').digest('hex')
    await writeFile(join(attestationStoreDirectory, `${fileName}.sha256`), `${hashHex}  ${fileName}\n`, 'utf8')
  }

  function gateConfig(): FreshnessGateConfig {
    return { toolPath, pcloudLocalDatabasePath: databasePath, topLevelFolderName, attestationStoreDirectory }
  }

  it('gercek attest edilmis, degismemis bir vaka icin ready=true doner', async () => {
    const bytes = 'gercek-uctan-uca-icerik'
    await buildCaseFixture('00AAA000', 8001, 111, bytes)
    await writeAttestation(8001, 111, '00AAA000', bytes)

    const result = await checkCaseFreshness(gateConfig(), targetRoot, '00AAA000')
    expect(result.ready).toBe(true)
    expect(result.caseStatus).toBe('ready')
  })

  it('attestation olmayan gercek bir vaka icin fail-closed ready=false doner (asla sessizce ready degil)', async () => {
    const bytes = 'attest-edilmemis-icerik'
    await buildCaseFixture('00BBB000', 8002, 222, bytes)
    // Kasitli olarak attestation UYETMEDI.

    const result = await checkCaseFreshness(gateConfig(), targetRoot, '00BBB000')
    expect(result.ready).toBe(false)
    expect(result.caseStatus).toBe('unknown')
  })

  it('freshnessGate yapilandirilmamissa (undefined) fail-closed reddedilir, spawn bile denenmez', async () => {
    const result = await checkCaseFreshness(undefined, targetRoot, '00CCC000')
    expect(result.ready).toBe(false)
    if (result.ready) throw new Error('unreachable -- asserted above')
    expect(result.reason).toBe('freshness_gate_not_configured')
  })

  it('arac dosyasi olmayan bir yola isaret ederse fail-closed hata olarak raporlanir, exception firlatmaz', async () => {
    const brokenConfig: FreshnessGateConfig = {
      toolPath: join(root, 'hic-boyle-bir-arac-yok.mjs'),
      pcloudLocalDatabasePath: databasePath,
      topLevelFolderName,
      attestationStoreDirectory,
    }
    const result = await checkCaseFreshness(brokenConfig, targetRoot, '00AAA000')
    expect(result.ready).toBe(false)
  })
})
