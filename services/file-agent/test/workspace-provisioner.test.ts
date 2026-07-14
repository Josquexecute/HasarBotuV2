import { access, lstat, mkdtemp, mkdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { provisionCaseWorkspace } from '../src/index.js'

const subdirectories: ['EVRAK', 'HASAR', 'OLAY YERİ', 'ONARIM', 'DEĞER KAYBI'] = [
  'EVRAK', 'HASAR', 'OLAY YERİ', 'ONARIM', 'DEĞER KAYBI',
]
const payload = {
  storageRootKey: 'test-root',
  relativePath: '2026/Temmuz 2026/34ABC123',
  kind: 'workspace' as const,
  requiredSubdirectories: subdirectories,
}

describe('provisionCaseWorkspace (sentetik geçici filesystem)', () => {
  let base: string
  let root: string
  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'hb-workspace-'))
    root = join(base, 'root')
    await mkdir(root)
  })
  afterEach(async () => {
    await rm(base, { recursive: true, force: true })
  })

  it('normal klasörü ve beş alt klasörü oluşturup doğrular', async () => {
    expect(await provisionCaseWorkspace(root, payload)).toEqual({ outcome: 'verified' })
    for (const name of subdirectories) {
      expect((await lstat(join(root, '2026', 'Temmuz 2026', '34ABC123', name))).isDirectory()).toBe(true)
    }
  })

  it('tekrar çağrıda mükerrer üretmez ve kısmi yapıyı tamamlar', async () => {
    await mkdir(join(root, '2026', 'Temmuz 2026', '34ABC123', 'EVRAK'), { recursive: true })
    expect(await provisionCaseWorkspace(root, payload)).toEqual({ outcome: 'verified' })
    expect(await provisionCaseWorkspace(root, payload)).toEqual({ outcome: 'verified' })
    for (const name of subdirectories) await expect(access(join(root, '2026', 'Temmuz 2026', '34ABC123', name))).resolves.toBeUndefined()
  })

  it('kısmi başarısızlıkta oluşan klasörleri silmez; retry eksikleri tamamlar', async () => {
    const failed = await provisionCaseWorkspace(root, payload, {
      beforeCreate(relativePath) {
        if (relativePath.endsWith('/HASAR')) throw new Error('synthetic failure')
      },
    })
    expect(failed).toEqual({ outcome: 'failed', errorCode: 'workspace_apply_failed' })
    await expect(access(join(root, '2026', 'Temmuz 2026', '34ABC123', 'EVRAK'))).resolves.toBeUndefined()
    expect(await provisionCaseWorkspace(root, payload)).toEqual({ outcome: 'verified' })
  })

  it.each(['../kaçış', 'C:/Windows', '//sunucu/paylaşım'])('%s güvenli biçimde reddedilir', async (relativePath) => {
    const result = await provisionCaseWorkspace(root, { ...payload, relativePath })
    expect(result).toEqual({ outcome: 'failed', errorCode: 'unsafe_relative_path' })
  })

  it('symlink/junction yol bileşenini kök içinde kalsa dahi reddeder', async () => {
    await mkdir(join(root, 'gerçek'))
    await symlink(join(root, 'gerçek'), join(root, '2026'), 'junction')
    const result = await provisionCaseWorkspace(root, payload)
    expect(result).toEqual({ outcome: 'failed', errorCode: 'reparse_point_rejected' })
  })
})
