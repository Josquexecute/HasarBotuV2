import { lstat, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  probeRootHealth,
  ROOT_HEALTH_PROBE_FILENAME,
  type RootHealthFileSystem,
} from '../src/index.js'

describe('probeRootHealth (gerçek geçici filesystem)', () => {
  let base: string
  let root: string

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'hb-root-health-'))
    root = join(base, 'root')
    await mkdir(root)
  })
  afterEach(async () => {
    await rm(base, { recursive: true, force: true })
  })

  it('sağlıklı, yazılabilir kökü kabul eder ve işaretçi dosyasını GERİYE bırakmaz', async () => {
    expect(await probeRootHealth(root)).toEqual({ ok: true })
    await expect(mkdir(join(root, ROOT_HEALTH_PROBE_FILENAME))).resolves.toBeUndefined()
  })

  it('var olmayan kökü root_missing olarak reddeder', async () => {
    expect(await probeRootHealth(join(base, 'yok-boyle-bir-klasor'))).toEqual({
      ok: false,
      code: 'root_missing',
    })
  })

  it('kök bir dosyaysa root_not_a_directory döner', async () => {
    const filePath = join(base, 'dosya.txt')
    await writeFile(filePath, 'içerik')
    expect(await probeRootHealth(filePath)).toEqual({ ok: false, code: 'root_not_a_directory' })
  })

  it('kök symlink/junction ise root_reparse_point_rejected döner', async () => {
    const real = join(base, 'gerçek-kök')
    await mkdir(real)
    const link = join(base, 'bağlantı-kök')
    await symlink(real, link, 'junction')
    expect(await probeRootHealth(link)).toEqual({ ok: false, code: 'root_reparse_point_rejected' })
  })

  it('verifyWritable:false ile yalnız varlığı/türü doğrular; yazma denemez', async () => {
    let writeCalled = false
    const fs: RootHealthFileSystem = {
      lstat,
      writeFile: async () => { writeCalled = true },
      unlink: async () => undefined,
    }
    expect(await probeRootHealth(root, fs, { verifyWritable: false })).toEqual({ ok: true })
    expect(writeCalled).toBe(false)
  })

  it('yazma başarısız olursa root_not_writable döner (enjekte edilmiş G/Ç hatası)', async () => {
    const fs: RootHealthFileSystem = {
      lstat,
      writeFile: async () => { throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }) },
      unlink: async () => undefined,
    }
    expect(await probeRootHealth(root, fs)).toEqual({ ok: false, code: 'root_not_writable' })
  })

  it('silme başarısız olsa bile yazma başarılıysa kökü SAĞLIKLI sayar', async () => {
    // Silme başarısızlığı (ör. anlık paylaşım kilidi) sağlık durumunu
    // DEĞİŞTİRMEZ; bir sonraki prob aynı adın üzerine yeniden yazar.
    const fs: RootHealthFileSystem = {
      lstat,
      writeFile: async () => undefined,
      unlink: async () => { throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }) },
    }
    expect(await probeRootHealth(root, fs)).toEqual({ ok: true })
  })

  it('lstat beklenmeyen bir hatayla başarısız olursa root_probe_failed döner', async () => {
    const fs: RootHealthFileSystem = {
      lstat: async () => { throw Object.assign(new Error('EIO'), { code: 'EIO' }) },
      writeFile: async () => undefined,
      unlink: async () => undefined,
    }
    expect(await probeRootHealth(root, fs)).toEqual({ ok: false, code: 'root_probe_failed' })
  })
})
