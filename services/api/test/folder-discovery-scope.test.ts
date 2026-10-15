import { mkdtemp,mkdir,rm,symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach,describe,expect,it } from 'vitest'
import { discoverPlateFolders } from '../src/cases/folder-discovery.js'

let root: string
afterEach(async () => { if (root) await rm(root,{ recursive: true,force: true }) })
describe('office year discovery scope',() => {
  it('scans only the office year and preserves paths relative to the registered storage root',async () => {
    root = await mkdtemp(join(tmpdir(),'hb-office-scope-'))
    await mkdir(join(root,'2026 OFİS/Ekim 2026/27AUE21'),{ recursive: true })
    await mkdir(join(root,'2025/Aralık 2025/34ABC123'),{ recursive: true })
    const scoped = await discoverPlateFolders(root,{ yearFolder: '2026 OFİS' })
    expect(scoped.map(item => ({ path: item.relativePath,month: item.monthFolder }))).toEqual([{ path: '2026 OFİS/Ekim 2026/27AUE21',month: 'Ekim 2026' }])
    expect(await discoverPlateFolders(root)).toHaveLength(2)
  })
  it('rejects unsafe or missing scopes instead of searching another year',async () => {
    root = await mkdtemp(join(tmpdir(),'hb-office-scope-'))
    await expect(discoverPlateFolders(root,{ yearFolder: '../2026 OFİS' })).rejects.toThrow('invalid_year_scope')
    await expect(discoverPlateFolders(root,{ yearFolder: '2026 OFİS' })).rejects.toMatchObject({ code: 'ENOENT' })
    const other = join(root,'other')
    await mkdir(other)
    await symlink(other,join(root,'2026 OFİS'),process.platform === 'win32' ? 'junction' : 'dir')
    await expect(discoverPlateFolders(root,{ yearFolder: '2026 OFİS' })).rejects.toThrow('unsafe_year_scope')
  })
})
