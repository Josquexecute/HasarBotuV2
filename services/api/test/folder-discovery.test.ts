import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { discoverPlateFolders } from '../src/cases/folder-discovery.js'

it('finds annotated and nested case folders while excluding group folders and nested vehicle evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hb-folders-'))
  try {
    const paths = ['2026/EKİM 2026/34ABC123/06DEF456', '2026/INSURER/EKİM 2026/KAPALI EKİM 2026/35ABC123(AVUKATLI)',
      '2026 UZAKTAN/EKİM 2026/--- ACİL DOSYALAR/36ABC123 ZURICH', 'unrelated/37ABC123', '2026/EKİM 2026/_HASARBOTU/38ABC123']
    for (const path of paths) await mkdir(join(root, path), { recursive: true })
    await mkdir(join(root, '2026/EKİM 2026/34ABC123/_HASARBOTU'))
    await writeFile(join(root, '2026/EKİM 2026/34ABC123/_HASARBOTU/takip.json'), '{}')
    const folders = await discoverPlateFolders(root)
    expect(folders).toHaveLength(3)
    expect(folders.find(f => f.parsedName?.plate === '34 ABC 123')).toMatchObject({ hasJson: true, physicallyUnderKapali: false })
    expect(folders.find(f => f.parsedName?.plate === '35 ABC 123')).toMatchObject({ hasJson: false, physicallyUnderKapali: true })
    expect(folders.every(f => f.monthFolder === 'EKİM 2026')).toBe(true)
  } finally { await rm(root, { recursive: true, force: true }) }
})
