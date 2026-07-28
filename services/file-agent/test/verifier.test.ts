import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { streamSha256, verifyTarget } from '../src/index.js'

const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex')

function filePayload(relativePath: string, declaredHash: string | null, declaredSize: number | null) {
  return { storageRootKey: 'r', relativePath, kind: 'file' as const, declaredHash, declaredSize }
}

describe('verifyTarget (yalnız sentetik geçici dosyalar)', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-verify-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('dosya: gerçek dosyadan gözlenen hash+size döner (streaming)', async () => {
    const content = Buffer.from('HasarBotu sentetik içerik '.repeat(5000)) // ~135 KB
    await mkdir(join(root, 'EVRAK'), { recursive: true })
    await writeFile(join(root, 'EVRAK', 'r.pdf'), content)

    const result = await verifyTarget(root, filePayload('EVRAK/r.pdf', sha256(content), content.length))
    expect(result.outcome).toBe('verified')
    expect(result.observedHash).toBe(sha256(content))
    expect(result.observedSize).toBe(content.length)
  })

  it('streamSha256 gerçek boyutu ve hash’i verir', async () => {
    const content = Buffer.from('abc')
    await writeFile(join(root, 'x.bin'), content)
    expect(await streamSha256(join(root, 'x.bin'))).toEqual({ hash: sha256('abc'), size: 3 })
  })

  it('dosya yok: missing', async () => {
    const result = await verifyTarget(root, filePayload('EVRAK/yok.pdf', sha256('x'), 1))
    expect(result.outcome).toBe('missing')
  })

  it('dizin: verified / missing', async () => {
    await mkdir(join(root, 'HASAR'), { recursive: true })
    const ok = await verifyTarget(root, { storageRootKey: 'r', relativePath: 'HASAR', kind: 'directory', declaredHash: null, declaredSize: null })
    expect(ok.outcome).toBe('verified')
    const missing = await verifyTarget(root, { storageRootKey: 'r', relativePath: 'YOK', kind: 'directory', declaredHash: null, declaredSize: null })
    expect(missing.outcome).toBe('missing')
  })

  it('traversal payload: failed (güvenli neden kodu)', async () => {
    const result = await verifyTarget(root, filePayload('../escape.pdf', sha256('x'), 1))
    expect(result.outcome).toBe('failed')
    expect(result.errorCode).toBe('unsafe_relative_path')
  })

  it('symlink/junction ile root dışına kaçış: failed root_escape', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'hb-out-'))
    try {
      await writeFile(join(outside, 'secret.txt'), 'gizli')
      await symlink(outside, join(root, 'link'), 'junction')
      const result = await verifyTarget(root, filePayload('link/secret.txt', sha256('gizli'), 5))
      expect(result.outcome).toBe('failed')
      expect(result.errorCode).toBe('root_escape')
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('D4: kök TAMAMEN erişilemezken hedefi YANLIŞ biçimde "missing" saymaz', async () => {
    // Gerçek kusur: kök (P:\) geçici koparsa hedefin ENOENT'i önceden "missing"
    // sayılıyordu — oysa dosya YERİNDE olabilir, yalnız kök o an görünmüyordur.
    // `verification_status`u KALICI OLARAK bozmamak için RETRYABLE bir kod
    // (`storage_unavailable`) döner, "missing" DEĞİL.
    await rm(root, { recursive: true, force: true })
    const result = await verifyTarget(root, filePayload('EVRAK/r.pdf', sha256('x'), 1))
    expect(result).toEqual({ outcome: 'failed', errorCode: 'storage_unavailable' })
  })

  it('D4: kök geçerliyken (yalnız hedef eksikken) missing davranışı DEĞİŞMEDİ', async () => {
    // Regresyon: kök sağlıklıyken gerçek "dosya silinmiş" durumu hâlâ missing.
    const result = await verifyTarget(root, filePayload('EVRAK/yok.pdf', sha256('x'), 1))
    expect(result.outcome).toBe('missing')
  })
})
