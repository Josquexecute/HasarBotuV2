import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  assertRealPathUnderRoot,
  DEFAULT_MAX_ABSOLUTE_PATH_LENGTH,
  isUnderRoot,
  PathSafetyError,
  resolveUnderRoot,
} from '../src/index.js'

describe('isUnderRoot', () => {
  it('root altını kabul, dışını ve traversal sonucu reddeder', () => {
    expect(isUnderRoot('/srv/root', '/srv/root/a/b')).toBe(true)
    expect(isUnderRoot('/srv/root', '/srv/root')).toBe(true)
    expect(isUnderRoot('/srv/root', '/srv/other')).toBe(false)
    expect(isUnderRoot('/srv/root', '/srv/rootother')).toBe(false)
  })
})

describe('resolveUnderRoot (leksik güvenlik)', () => {
  const root = resolve(tmpdir(), 'hb-lexical-root')
  it('güvenli göreli yolu root altında çözer', () => {
    const result = resolveUnderRoot(root, 'a/b/c.pdf')
    expect(result).toBe(join(root, 'a', 'b', 'c.pdf'))
    expect(isUnderRoot(root, result)).toBe(true)
  })
  it('traversal / absolute / sürücü / backslash reddeder', () => {
    for (const bad of ['../escape', 'a/../../x', '/etc/passwd', 'C:/Windows', `a${String.fromCharCode(92)}b`]) {
      expect(() => resolveUnderRoot(root, bad), bad).toThrow(PathSafetyError)
    }
  })
})

describe('resolveUnderRoot (D4 Windows toplam yol uzunluğu sınırı)', () => {
  const root = resolve(tmpdir(), 'hb-length-root')

  it('sınırın TAM ALTINDAKİ yolu kabul eder', () => {
    // `root` + '/' + segment == tam olarak sınır uzunluğu.
    const segment = 'a'.repeat(DEFAULT_MAX_ABSOLUTE_PATH_LENGTH - root.length - 1)
    const result = resolveUnderRoot(root, segment)
    expect(result.length).toBe(DEFAULT_MAX_ABSOLUTE_PATH_LENGTH)
  })

  it('sınırı BİR karakter aşan yolu windows_path_too_long ile reddeder', () => {
    const segment = 'a'.repeat(DEFAULT_MAX_ABSOLUTE_PATH_LENGTH - root.length)
    expect(() => resolveUnderRoot(root, segment)).toThrow(PathSafetyError)
    try {
      resolveUnderRoot(root, segment)
      expect.unreachable()
    } catch (error) {
      expect((error as PathSafetyError).code).toBe('windows_path_too_long')
    }
  })

  it('sınır fonksiyon parametresiyle GEÇERSİZ KILINABİLİR (uzun yol desteği açılırsa)', () => {
    const segment = 'a'.repeat(DEFAULT_MAX_ABSOLUTE_PATH_LENGTH - root.length)
    // Varsayılanla reddedilen aynı yol, açıkça verilen daha yüksek bir
    // sınırla kabul edilir.
    expect(() => resolveUnderRoot(root, segment, DEFAULT_MAX_ABSOLUTE_PATH_LENGTH + 100)).not.toThrow()
  })

  it('staging/rename gibi türetilmiş göreli yollar da AYNI sınırdan geçer', () => {
    // `.hasarbotu-staging/{jobId}` gibi yollar da resolveUnderRoot'tan
    // geçtiği için otomatik kapsanır; ayrı bir kontrol noktası gerekmez.
    const staging = `.hasarbotu-staging/${'a'.repeat(DEFAULT_MAX_ABSOLUTE_PATH_LENGTH)}`
    expect(() => resolveUnderRoot(root, staging)).toThrow(PathSafetyError)
  })
})

describe('assertRealPathUnderRoot (symlink/junction kaçışı)', () => {
  let base: string
  let root: string
  let outside: string
  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'hb-agent-'))
    root = join(base, 'root')
    outside = join(base, 'outside')
    await mkdir(root, { recursive: true })
    await mkdir(outside, { recursive: true })
    await writeFile(join(outside, 'secret.txt'), 'gizli')
    await writeFile(join(root, 'inside.txt'), 'ok')
  })
  afterEach(async () => {
    await rm(base, { recursive: true, force: true })
  })

  it('gerçek yolu root altındaki dosya için kabul eder', async () => {
    const real = await assertRealPathUnderRoot(root, join(root, 'inside.txt'))
    // Windows TEMP may contain an 8.3 alias; the result is a canonical realpath.
    expect(real).toBe(await realpath(join(root, 'inside.txt')))
    expect(isUnderRoot(await realpath(root), real)).toBe(true)
  })

  it('root bir junction/alias olduğunda kanonik kökün içindeki yolu kabul eder', async () => {
    const rootAlias = join(base, 'root-alias')
    await symlink(root, rootAlias, 'junction')
    await expect(assertRealPathUnderRoot(rootAlias, join(rootAlias, 'inside.txt')))
      .resolves.toBe(await realpath(join(root, 'inside.txt')))
  })

  it('junction/symlink ile root dışına kaçışı reddeder', async () => {
    const link = join(root, 'link')
    // Windows'ta junction admin gerektirmez; POSIX'te dizin symlink'i.
    await symlink(outside, link, 'junction')
    await expect(assertRealPathUnderRoot(root, join(link, 'secret.txt'))).rejects.toMatchObject({
      name: 'PathSafetyError',
      code: 'root_escape',
    })
  })

  it('var olmayan yolda ENOENT verir (missing olarak ele alınır)', async () => {
    await expect(assertRealPathUnderRoot(root, join(root, 'yok.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
