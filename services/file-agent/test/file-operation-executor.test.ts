import { access, appendFile, lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { JobPayload } from '@hasarbotu/contracts'
import {
  buildWorkspaceManifest,
  executeFileOperation,
  nodeFileSystemAdapter,
  type FileSystemAdapter,
} from '../src/index.js'

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

describe('File Agent case workspace move/rename (sentetik filesystem)', () => {
  let base: string
  let sourceRoot: string
  let destinationRoot: string
  let sourceRelative: string

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'hb-file-operation-'))
    sourceRoot = join(base, 'source-root')
    destinationRoot = join(base, 'destination-root')
    sourceRelative = '2026/Temmuz 2026/34ABC123'
    await mkdir(join(sourceRoot, ...sourceRelative.split('/'), 'EVRAK'), { recursive: true })
    await mkdir(destinationRoot)
    await writeFile(join(sourceRoot, ...sourceRelative.split('/'), 'EVRAK', 'ruhsat.txt'), 'sentetik-ruhsat')
    await writeFile(join(sourceRoot, ...sourceRelative.split('/'), 'not.txt'), 'sentetik-not')
  })

  afterEach(async () => {
    await rm(base, { recursive: true, force: true })
  })

  function applyPayload(overrides: Record<string, unknown> = {}): Extract<JobPayload, { kind: 'file_operation' }> {
    return {
      kind: 'file_operation' as const,
      operationId: '01900000-0000-7000-8000-000000000020',
      operationVersion: 2,
      operationType: 'move_case_workspace' as const,
      source: { storageRootKey: 'source-root', relativePath: sourceRelative },
      destination: { storageRootKey: 'source-root', relativePath: '2026/Temmuz 2026/34ABC123-YENI' },
      strategy: 'atomic_rename' as const,
      plannedAt: new Date(Date.now() + 5_000).toISOString(),
      stagingRelativePath: '.hasarbotu-staging/01900000-0000-7000-8000-000000000020',
      temporaryRelativePath: '2026/Temmuz 2026/.hasarbotu-rename-01900000-0000-7000-8000-000000000020',
      ...overrides,
    } as unknown as Extract<JobPayload, { kind: 'file_operation' }>
  }

  const roots = () => ({ 'source-root': sourceRoot, 'destination-root': destinationRoot })

  it('D4 fail-closed: kaynak kök erişilemezken HİÇBİR fiziksel adım denemez', async () => {
    await rm(sourceRoot, { recursive: true, force: true })
    const result = await executeFileOperation(roots(), applyPayload())
    expect(result).toEqual({ outcome: 'failed', errorCode: 'storage_unavailable' })
  })

  it('D4 fail-closed: hedef kök erişilemezken HİÇBİR fiziksel adım denemez', async () => {
    const payload = applyPayload({ destination: { storageRootKey: 'destination-root', relativePath: '34ABC123-YENI' } })
    await rm(destinationRoot, { recursive: true, force: true })
    const result = await executeFileOperation(roots(), payload)
    expect(result).toEqual({ outcome: 'failed', errorCode: 'storage_unavailable' })
    // Kaynak DOKUNULMADAN kalır: kısmi taşıma denemesi hiç başlamadı.
    await expect(access(join(sourceRoot, ...sourceRelative.split('/')))).resolves.toBeUndefined()
  })

  it('D4 fail-closed: cleanup işi de kaynak kök erişilemezken denemez', async () => {
    const cleanupPayload = {
      kind: 'file_operation_cleanup' as const,
      operationId: '01900000-0000-7000-8000-000000000020',
      source: { storageRootKey: 'source-root', relativePath: sourceRelative },
      destination: { storageRootKey: 'source-root', relativePath: '2026/Temmuz 2026/34ABC123-YENI' },
      manifestHash: 'irrelevant',
      fileCount: 2,
      directoryCount: 2,
      totalBytes: 10,
    }
    await rm(sourceRoot, { recursive: true, force: true })
    const result = await executeFileOperation(roots(), cleanupPayload as never)
    expect(result).toEqual({ outcome: 'failed', errorCode: 'storage_unavailable' })
  })

  it('same-volume atomik rename uygular, manifesti doğrular ve kaynağı bırakmaz', async () => {
    const payload = applyPayload()
    const result = await executeFileOperation(roots(), payload)
    expect(result).toMatchObject({ outcome: 'verified', fileOperation: { phase: 'destination_verified', strategy: 'atomic_rename', fileCount: 2 } })
    await expect(access(join(sourceRoot, ...sourceRelative.split('/')))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(sourceRoot, '2026', 'Temmuz 2026', '34ABC123-YENI', 'EVRAK', 'ruhsat.txt'), 'utf8')).toBe('sentetik-ruhsat')
  })

  it('case-only Windows rename için operation-specific güvenli geçici ad kullanır', async () => {
    const payload = applyPayload({
      operationType: 'rename_case_workspace',
      destination: { storageRootKey: 'source-root', relativePath: '2026/Temmuz 2026/34abc123' },
    })
    const result = await executeFileOperation(roots(), payload)
    expect(result).toMatchObject({ outcome: 'verified', fileOperation: { strategy: 'atomic_rename' } })
    expect((await lstat(join(sourceRoot, '2026', 'Temmuz 2026', '34abc123'))).isDirectory()).toBe(true)
    await expect(access(join(sourceRoot, '2026', 'Temmuz 2026', '.hasarbotu-rename-01900000-0000-7000-8000-000000000020'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('mevcut hedefin üzerine yazmaz veya merge yapmaz; D4 manuel drift olarak işaretler', async () => {
    await mkdir(join(sourceRoot, '2026', 'Temmuz 2026', '34ABC123-YENI'), { recursive: true })
    await writeFile(join(sourceRoot, '2026', 'Temmuz 2026', '34ABC123-YENI', 'koru.txt'), 'koru')
    expect(await executeFileOperation(roots(), applyPayload())).toEqual({
      outcome: 'failed',
      errorCode: 'manual_drift_detected',
      fileOperation: { phase: 'manual_recovery_required', strategy: 'atomic_rename', safeOutcomeCode: 'manual_drift_detected' },
    })
    expect(await readFile(join(sourceRoot, '2026', 'Temmuz 2026', '34ABC123-YENI', 'koru.txt'), 'utf8')).toBe('koru')
    // Kaynak da BIRAKILIR: ne hedef ne kaynak silinir/taşınır; kullanıcı kararına bırakılır.
    await expect(access(join(sourceRoot, ...sourceRelative.split('/')))).resolves.toBeUndefined()
  })

  it('mevcut hedefin içeriği kaynakla EŞLEŞİYORSA (atomic_rename) idempotent olarak kabul eder', async () => {
    // Bu, agent'ın önceki başarılı ama ack'lenmemiş denemesini VEYA kullanıcının
    // Explorer ile aynı sonucu üreten bir taşımasını temsil eder (D4).
    await mkdir(join(sourceRoot, '2026', 'Temmuz 2026', '34ABC123-YENI', 'EVRAK'), { recursive: true })
    await writeFile(join(sourceRoot, '2026', 'Temmuz 2026', '34ABC123-YENI', 'EVRAK', 'ruhsat.txt'), 'sentetik-ruhsat')
    await writeFile(join(sourceRoot, '2026', 'Temmuz 2026', '34ABC123-YENI', 'not.txt'), 'sentetik-not')
    const result = await executeFileOperation(roots(), applyPayload())
    expect(result).toMatchObject({
      outcome: 'verified',
      fileOperation: { phase: 'destination_verified', strategy: 'atomic_rename', safeOutcomeCode: 'recovered_existing_destination' },
    })
    // Kaynak, hedef doğrulanmadan silinmez; ancak burada zaten hedefte durur —
    // fonksiyon kaynağı silmez (yalnız rename dener), bu yüzden kaynak kalır.
    await expect(access(join(sourceRoot, ...sourceRelative.split('/')))).resolves.toBeUndefined()
  })

  it.each(['../kaçış', 'C:/Windows', '//sunucu/paylaşım'])('%s hedefini reddeder', async (relativePath) => {
    const result = await executeFileOperation(roots(), applyPayload({
      destination: { storageRootKey: 'source-root', relativePath },
    }) as never)
    expect(result).toMatchObject({ outcome: 'failed', errorCode: 'unsafe_relative_path' })
  })

  it('symlink/junction kaynak bileşenini reddeder', async () => {
    const outside = join(base, 'outside')
    await mkdir(outside)
    const evrak = join(sourceRoot, ...sourceRelative.split('/'), 'EVRAK')
    await rm(evrak, { recursive: true })
    await symlink(outside, evrak, 'junction')
    const result = await executeFileOperation(roots(), applyPayload())
    expect(result).toMatchObject({ outcome: 'failed', errorCode: 'reparse_point_rejected' })
  })

  it('EXDEV enjeksiyonunda staged-copy kullanır ve kaynak doğrulanmadan silinmez', async () => {
    let firstRename = true
    const exdevAdapter: FileSystemAdapter = {
      ...nodeFileSystemAdapter,
      async rename(source, destination) {
        if (firstRename) {
          firstRename = false
          throw errno('EXDEV')
        }
        await nodeFileSystemAdapter.rename(source, destination)
      },
    }
    const result = await executeFileOperation(roots(), applyPayload(), exdevAdapter)
    expect(result).toMatchObject({ outcome: 'verified', fileOperation: { strategy: 'staged_copy', phase: 'destination_verified' } })
    await expect(access(join(sourceRoot, ...sourceRelative.split('/')))).resolves.toBeUndefined()
    await expect(access(join(sourceRoot, '2026', 'Temmuz 2026', '34ABC123-YENI'))).resolves.toBeUndefined()
  })

  it('cross-root staged-copy dosyaları streaming hash ile birebir doğrular', async () => {
    const payload = applyPayload({
      destination: { storageRootKey: 'destination-root', relativePath: '2026/KAPALI TEMMUZ 2026/34ABC123' },
      strategy: 'staged_copy',
    })
    const sourceManifest = await buildWorkspaceManifest(nodeFileSystemAdapter, sourceRoot, sourceRelative)
    const result = await executeFileOperation(roots(), payload)
    expect(result).toMatchObject({
      outcome: 'verified',
      fileOperation: { strategy: 'staged_copy', manifestHash: sourceManifest.manifestHash, totalBytes: sourceManifest.totalBytes },
    })
    const destinationManifest = await buildWorkspaceManifest(nodeFileSystemAdapter, destinationRoot, '2026/KAPALI TEMMUZ 2026/34ABC123')
    expect(destinationManifest.manifestHash).toBe(sourceManifest.manifestHash)
    await expect(access(join(sourceRoot, ...sourceRelative.split('/')))).resolves.toBeUndefined()
  })

  it('disk-full/kopya hatasında kaynak korunur ve başarı üretilmez', async () => {
    const adapter: FileSystemAdapter = {
      ...nodeFileSystemAdapter,
      copyFileStreaming: async () => { throw errno('ENOSPC') },
    }
    const result = await executeFileOperation(roots(), applyPayload({
      destination: { storageRootKey: 'destination-root', relativePath: '2026/KAPALI TEMMUZ 2026/34ABC123' },
      strategy: 'staged_copy',
    }), adapter)
    expect(result).toEqual({ outcome: 'failed', errorCode: 'disk_full' })
    await expect(access(join(sourceRoot, ...sourceRelative.split('/')))).resolves.toBeUndefined()
  })

  it('streaming kopya hash/size uyuşmazlığında publish veya kaynak silme yapmaz', async () => {
    const adapter: FileSystemAdapter = {
      ...nodeFileSystemAdapter,
      async copyFileStreaming(source, destination) {
        await nodeFileSystemAdapter.copyFileStreaming(source, destination)
        await appendFile(destination, 'bozuk-kopya')
      },
    }
    const destination = '2026/KAPALI TEMMUZ 2026/34ABC123'
    const result = await executeFileOperation(roots(), applyPayload({
      destination: { storageRootKey: 'destination-root', relativePath: destination },
      strategy: 'staged_copy',
    }), adapter)
    expect(result).toMatchObject({
      outcome: 'failed',
      errorCode: 'staging_manifest_mismatch',
      fileOperation: { phase: 'manual_recovery_required' },
    })
    await expect(access(join(sourceRoot, ...sourceRelative.split('/')))).resolves.toBeUndefined()
    await expect(access(join(destinationRoot, ...destination.split('/')))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('kilitli rename güvenli retry hatası üretir ve kaynağı korur', async () => {
    const adapter: FileSystemAdapter = {
      ...nodeFileSystemAdapter,
      rename: async () => { throw errno('EBUSY') },
    }
    expect(await executeFileOperation(roots(), applyPayload(), adapter)).toEqual({ outcome: 'failed', errorCode: 'file_locked' })
    await expect(access(join(sourceRoot, ...sourceRelative.split('/')))).resolves.toBeUndefined()
  })

  it('publish edilmiş doğru hedefi restart/retry sırasında idempotent recovery ile kabul eder', async () => {
    const payload = applyPayload({
      destination: { storageRootKey: 'destination-root', relativePath: '2026/KAPALI TEMMUZ 2026/34ABC123' },
      strategy: 'staged_copy',
    })
    const first = await executeFileOperation(roots(), payload)
    expect(first.outcome).toBe('verified')
    const replay = await executeFileOperation(roots(), payload)
    expect(replay).toMatchObject({ outcome: 'verified', fileOperation: { safeOutcomeCode: 'recovered_existing_destination' } })
  })

  it('DB switch sonrası cleanup yalnız hedef ve kaynak manifestleri eşleşince kaynağı siler', async () => {
    const payload = applyPayload({
      destination: { storageRootKey: 'destination-root', relativePath: '2026/KAPALI TEMMUZ 2026/34ABC123' },
      strategy: 'staged_copy',
    })
    const applied = await executeFileOperation(roots(), payload)
    if (applied.fileOperation?.manifestHash === undefined) throw new Error('manifest missing')
    const cleanupPayload = {
      kind: 'file_operation_cleanup' as const,
      operationId: payload.operationId,
      operationVersion: 3,
      source: payload.source,
      destination: payload.destination,
      manifestHash: applied.fileOperation.manifestHash,
      fileCount: applied.fileOperation.fileCount ?? 0,
      directoryCount: applied.fileOperation.directoryCount ?? 0,
      totalBytes: applied.fileOperation.totalBytes ?? 0,
    }
    const cleaned = await executeFileOperation(roots(), cleanupPayload)
    expect(cleaned).toMatchObject({ outcome: 'verified', fileOperation: { phase: 'cleanup_completed' } })
    await expect(access(join(sourceRoot, ...sourceRelative.split('/')))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('cleanup kilidi kaynakta silme başlamadan oluşursa cleanup_pending retry güvenle tamamlanabilir', async () => {
    const payload = applyPayload({
      destination: { storageRootKey: 'destination-root', relativePath: '2026/KAPALI TEMMUZ 2026/34ABC123' },
      strategy: 'staged_copy',
    })
    const applied = await executeFileOperation(roots(), payload)
    const summary = applied.fileOperation
    if (summary?.manifestHash === undefined) throw new Error('manifest missing')
    const cleanupPayload = {
      kind: 'file_operation_cleanup' as const,
      operationId: payload.operationId,
      operationVersion: 3,
      source: payload.source,
      destination: payload.destination,
      manifestHash: summary.manifestHash,
      fileCount: summary.fileCount ?? 0,
      directoryCount: summary.directoryCount ?? 0,
      totalBytes: summary.totalBytes ?? 0,
    }
    let blocked = true
    const adapter: FileSystemAdapter = {
      ...nodeFileSystemAdapter,
      async unlink(path) {
        if (blocked) {
          blocked = false
          throw errno('EBUSY')
        }
        await nodeFileSystemAdapter.unlink(path)
      },
    }
    expect(await executeFileOperation(roots(), cleanupPayload, adapter)).toEqual({ outcome: 'failed', errorCode: 'file_locked' })
    await expect(access(join(sourceRoot, ...sourceRelative.split('/')))).resolves.toBeUndefined()
    expect((await executeFileOperation(roots(), cleanupPayload)).outcome).toBe('verified')
  })

  it('cleanup kısmen başladıktan sonra hata olursa kör retry yerine manual recovery ister', async () => {
    const payload = applyPayload({
      destination: { storageRootKey: 'destination-root', relativePath: '2026/KAPALI TEMMUZ 2026/34ABC123' },
      strategy: 'staged_copy',
    })
    const applied = await executeFileOperation(roots(), payload)
    const summary = applied.fileOperation
    if (summary?.manifestHash === undefined) throw new Error('manifest missing')
    const cleanupPayload = {
      kind: 'file_operation_cleanup' as const,
      operationId: payload.operationId,
      operationVersion: 3,
      source: payload.source,
      destination: payload.destination,
      manifestHash: summary.manifestHash,
      fileCount: summary.fileCount ?? 0,
      directoryCount: summary.directoryCount ?? 0,
      totalBytes: summary.totalBytes ?? 0,
    }
    let removedFiles = 0
    const adapter: FileSystemAdapter = {
      ...nodeFileSystemAdapter,
      async unlink(path) {
        removedFiles += 1
        if (removedFiles === 2) throw errno('EACCES')
        await nodeFileSystemAdapter.unlink(path)
      },
    }
    const result = await executeFileOperation(roots(), cleanupPayload, adapter)
    expect(result).toMatchObject({
      outcome: 'failed',
      errorCode: 'partial_cleanup_detected',
      fileOperation: { phase: 'manual_recovery_required' },
    })
    await expect(access(join(destinationRoot, ...payload.destination.relativePath.split('/')))).resolves.toBeUndefined()
    await expect(access(join(sourceRoot, ...sourceRelative.split('/')))).resolves.toBeUndefined()
  })

  it('kaynak apply sonrası değişmişse cleanup yapmaz ve insan incelemesi ister', async () => {
    const payload = applyPayload({
      destination: { storageRootKey: 'destination-root', relativePath: '2026/KAPALI TEMMUZ 2026/34ABC123' },
      strategy: 'staged_copy',
    })
    const applied = await executeFileOperation(roots(), payload)
    const summary = applied.fileOperation
    if (summary?.manifestHash === undefined) throw new Error('manifest missing')
    await writeFile(join(sourceRoot, ...sourceRelative.split('/'), 'sonradan.txt'), 'değişti')
    const cleanup = await executeFileOperation(roots(), {
      kind: 'file_operation_cleanup',
      operationId: payload.operationId,
      operationVersion: 3,
      source: payload.source,
      destination: payload.destination,
      manifestHash: summary.manifestHash,
      fileCount: summary.fileCount ?? 0,
      directoryCount: summary.directoryCount ?? 0,
      totalBytes: summary.totalBytes ?? 0,
    })
    expect(cleanup).toMatchObject({
      outcome: 'failed',
      errorCode: 'source_changed_before_cleanup',
      fileOperation: { phase: 'manual_recovery_required' },
    })
    await expect(access(join(sourceRoot, ...sourceRelative.split('/'), 'sonradan.txt'))).resolves.toBeUndefined()
  })
})
