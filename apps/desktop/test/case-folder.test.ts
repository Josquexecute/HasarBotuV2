import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveCaseFolder, resolveSelectedCaseFolder } from '../src/main/case-folder-core.js'

let root: string
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }) })
describe('case folder opening boundary', () => {
  it('opens from the configured office year root without duplicating the year in stored paths',async () => {
    root = await mkdtemp(join(tmpdir(),'hb-case-folder-'))
    const office = join(root,'2026 OFİS'),target = join(office,'Ekim 2026/27AUE21')
    await mkdir(target,{ recursive: true })
    expect(await resolveCaseFolder(office,'2026 OFİS/Ekim 2026/27AUE21')).toBe(await realpath(target))
    expect(await resolveSelectedCaseFolder(office,'2026 OFİS/Ekim 2026/27AUE21')).toEqual({ target: await realpath(target),root: office })
    expect(await resolveCaseFolder(office,'Ekim 2026/27AUE21')).toBe(await realpath(target))
    await expect(resolveCaseFolder(office,'2026 OFİS')).rejects.toThrow('kökün dışında')
  })
  it('distinguishes the actual moved case folder from a storage root', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-case-folder-'))
    const moved = join(root, '2026 OFİS/Ekim 2026/34RHL127')
    await mkdir(moved, { recursive: true })
    expect(await resolveSelectedCaseFolder(moved, '2026 OFİS/_EKSİK DOSYALAR/34RHL127')).toEqual({ target: await realpath(moved) })
    expect(await resolveSelectedCaseFolder(root, '2026 OFİS/Ekim 2026/34RHL127')).toEqual({ target: await realpath(moved), root })
    await expect(resolveSelectedCaseFolder(moved, '../unsafe')).rejects.toThrow()
  })
  it('rejects directory junctions that escape the configured root', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-case-folder-'))
    const allowed = join(root, 'allowed'), outside = join(root, 'outside')
    await mkdir(allowed); await mkdir(outside)
    await symlink(outside, join(allowed, 'escape'), 'junction')
    await expect(resolveCaseFolder(allowed, 'escape')).rejects.toThrow('kökün dışında')
  })
  it('resolves the exact insurer-specific source folder, including Turkish names', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-case-folder-'))
    for (const insurer of ['AXA SİGORTA', 'ALLIANZ']) await mkdir(join(root, `2026/Ekim 2026/34ABC123-${insurer}`), { recursive: true })
    const target = await resolveCaseFolder(root, '2026/Ekim 2026/34ABC123-AXA SİGORTA')
    expect(target).toBe(await realpath(join(root, '2026/Ekim 2026/34ABC123-AXA SİGORTA')))
    await expect(resolveCaseFolder(root, '../elsewhere')).rejects.toThrow()
    await expect(resolveCaseFolder(root, '2026/missing')).rejects.toThrow()
    await writeFile(join(root, 'file.txt'), 'synthetic')
    await expect(resolveCaseFolder(root, 'file.txt')).rejects.toThrow('klasörü bulunamadı')
  })
})
