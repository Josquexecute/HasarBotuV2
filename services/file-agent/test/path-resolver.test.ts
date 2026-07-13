import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assertRealPathUnderRoot, isUnderRoot, PathSafetyError, resolveUnderRoot } from '../src/index.js'

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
    expect(isUnderRoot(root, real)).toBe(true)
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
