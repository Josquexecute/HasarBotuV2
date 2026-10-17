import { lstat, readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { parseSourcePlateFolderName } from '@hasarbotu/domain'
import type { V1DiscoveredFolder } from '../v1-import/store.js'

/** Read-only inventory across month, insurer and work-group containers; never follow links. */
export async function discoverPlateFolders(root: string, options: { readonly yearFolder?: string; readonly officeOnly?: boolean } = {}): Promise<V1DiscoveredFolder[]> {
  if (options.yearFolder !== undefined) {
    if (!/^\d{4}(?: (?:OFİS|UZAKTAN))?$/u.test(options.yearFolder.toLocaleUpperCase('tr'))) throw new Error('folder_discovery_invalid_year_scope')
    const scoped = await lstat(join(root, options.yearFolder))
    if (!scoped.isDirectory() || scoped.isSymbolicLink()) throw new Error('folder_discovery_unsafe_year_scope')
  }
  const result: V1DiscoveredFolder[] = []
  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > 16) throw new Error('folder_discovery_depth_exceeded')
    const children = await readdir(directory, { withFileTypes: true })
    children.sort((a, b) => a.name.localeCompare(b.name, 'tr'))
    for (const child of children) {
      if (!child.isDirectory() || child.name.startsWith('_HASARBOTU')) continue
      if (depth === 0 && !/^\d{4}(?: (?:OFİS|UZAKTAN))?$/u.test(child.name.toLocaleUpperCase('tr'))) continue
      if (depth === 0 && options.officeOnly && !/^\d{4} OFİS$/u.test(child.name.toLocaleUpperCase('tr'))) continue
      if (depth === 0 && options.yearFolder !== undefined && child.name.toLocaleUpperCase('tr') !== options.yearFolder.toLocaleUpperCase('tr')) continue
      const absolutePath = join(directory, child.name)
      const parsedName = parseSourcePlateFolderName(child.name)
      if (depth === 0 || parsedName === null) { await walk(absolutePath, depth + 1); continue }
      const relativePath = relative(root, absolutePath).split('\\').join('/')
      const parts = relativePath.split('/')
      const inner = await readdir(absolutePath, { withFileTypes: true })
      const sidecar = inner.find(e => e.name === '_HASARBOTU' && e.isDirectory())
      const files = sidecar ? await readdir(join(absolutePath, sidecar.name), { withFileTypes: true }) : []
      const metadata = await stat(absolutePath)
      result.push({ absolutePath, relativePath, folderName: child.name, parsedName,
        monthFolder: parts.slice(1, -1).find(p => /^(OCAK|ŞUBAT|MART|NİSAN|MAYIS|HAZİRAN|TEMMUZ|AĞUSTOS|EYLÜL|EKİM|KASIM|ARALIK) \d{4}$/u.test(p.toLocaleUpperCase('tr'))) ?? '',
        physicallyUnderKapali: parts.slice(0, -1).some(p => p.toLocaleUpperCase('tr').startsWith('KAPALI')),
        hasJson: files.some(f => f.name === 'takip.json' && f.isFile()), hasTxt: files.some(f => f.name === 'HASARBOTU_TAKIP_OZETI.txt' && f.isFile()),
        directoryCreatedAt: Number.isFinite(metadata.birthtimeMs) ? metadata.birthtime.toISOString() : null })
      // Vehicle/photo subfolders within a case are not independent cases.
    }
  }
  await walk(root, 0)
  return result
}
