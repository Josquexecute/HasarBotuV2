import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverV1Folders } from '../src/v1-import/store.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture(paths: string[]) {
  const root = await mkdtemp(join(tmpdir(), 'hb-v1-discovery-'))
  roots.push(root)
  for (const path of paths) {
    await mkdir(join(root, path, '_HASARBOTU'), { recursive: true })
    await writeFile(join(root, path, '_HASARBOTU/takip.json'), '{}')
  }
  return root
}

describe('V1 folder discovery', () => {
  it('discovers real office year names and preserves original paths and sibling identities', async () => {
    const paths = [
      '2026 OFİS/Ekim 2026/34ABC123',
      '2026 OFİS/Ekim 2026/34ABC123 - 2',
      '2026 OFİS/Ekim 2026/34ABC123-AXA SİGORTA',
      '2026 OFİS/Ekim 2026/34ABC123 ALLIANZ',
      '2026 OFİS/Ekim 2026/KAPALI EKİM 2026/06ABC123',
      '2026 UZAKTAN/Ekim 2026/35ABC123',
      '2026/Ekim 2026/16ABC123',
    ]
    const folders = await discoverV1Folders(await fixture(paths))
    expect(folders.map((folder) => folder.relativePath).sort()).toEqual([...paths].sort())
    expect(folders.every((folder) => folder.hasJson && folder.parsedName !== null)).toBe(true)
    expect(folders.filter((folder) => folder.physicallyUnderKapali).map((folder) => folder.folderName)).toEqual(['06ABC123'])
  })

  it('excludes pilot trees, unrelated year suffixes and office sidecars', async () => {
    const root = await fixture([
      '_V2_EKSIST_PILOT_20260920/2026/Ekim 2026/34ABC123',
      '2026 YEDEK/Ekim 2026/34ABC123',
      '2026 OFİS/_HASARBOTU_OFFICE/34ABC123',
      '2026 OFİS/Ekim 2026/_HASARBOTU_OFFICE',
      '2026 ofis/Ekim 2026/34ABC123',
    ])
    expect((await discoverV1Folders(root)).map((folder) => folder.relativePath)).toEqual(['2026 ofis/Ekim 2026/34ABC123'])
  })
})
