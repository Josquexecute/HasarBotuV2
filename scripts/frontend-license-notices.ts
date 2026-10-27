import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import type { Plugin } from 'vite'

const licenseName = /^(?:licen[sc]e|copying)(?:[.-].+)?$/iu
const noticeName = /^notice(?:[.-].+)?$/iu

function packageDirectory(moduleId: string): string | undefined {
  const id = moduleId.replace(/^\0/u, '').split('?')[0]!.replaceAll('\\', '/')
  const marker = '/node_modules/'
  const index = id.lastIndexOf(marker)
  if (index === -1) return undefined
  const segments = id.slice(index + marker.length).split('/')
  const name = segments[0]!.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]!
  return path.resolve(id.slice(0, index + marker.length), name)
}

export async function buildFrontendLicenseNotices(moduleIds: Iterable<string>): Promise<string> {
  const directories = [...new Set([...moduleIds].map(packageDirectory).filter(value => value !== undefined))].sort()
  const notices = new Map<string, string>()
  for (const directory of directories) {
    // Workspace links resolve to our own source, outside the npm dependency tree.
    if (!(await realpath(directory)).replaceAll('\\', '/').includes('/node_modules/')) continue
    const metadata = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')) as {
      name?: string; version?: string; license?: string; files?: string[]
    }
    const label = `${metadata.name ?? path.basename(directory)}@${metadata.version ?? 'unknown'}`
    if (!metadata.name || !metadata.version || typeof metadata.license !== 'string' || !metadata.license.trim()) {
      throw new Error(`Frontend license metadata missing: ${label}`)
    }
    const entries = await readdir(directory, { withFileTypes: true })
    const legalFiles = entries.filter(entry => licenseName.test(entry.name) || noticeName.test(entry.name))
    if (!legalFiles.some(entry => licenseName.test(entry.name))) throw new Error(`Frontend license text missing: ${label}`)
    const referenced = /^SEE LICEN[SC]E IN (.+)$/iu.exec(metadata.license)?.[1]
    const declared = [...(metadata.files ?? []).filter(name => noticeName.test(name)), ...(referenced ? [referenced] : [])]
    for (const name of declared) {
      if (!legalFiles.some(entry => entry.name === name)) throw new Error(`Frontend legal file missing: ${label}/${name}`)
    }
    const sections: string[] = []
    for (const entry of legalFiles.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
      if (!entry.isFile() || (await lstat(path.join(directory, entry.name))).isSymbolicLink()) {
        throw new Error(`Frontend legal file must be an ordinary file: ${label}/${entry.name}`)
      }
      const content = (await readFile(path.join(directory, entry.name), 'utf8')).replaceAll('\r\n', '\n')
      if (!content.trim()) throw new Error(`Frontend legal file empty: ${label}/${entry.name}`)
      sections.push(`--- ${entry.name} ---\n${content.trimEnd()}\n`)
    }
    const section = `===== ${label} (${metadata.license}) =====\n\n${sections.join('\n')}`
    const existing = notices.get(label)
    if (existing !== undefined && existing !== section) throw new Error(`Frontend legal files conflict: ${label}`)
    notices.set(label, section)
  }
  return 'HasarBotu frontend - third-party notices\nGenerated from modules included in this build.\n\n'
    + [...notices.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([, content]) => content).join('\n')
}

export function frontendLicenseNotices(): Plugin {
  return {
    name: 'hasarbotu-frontend-license-notices',
    apply: 'build',
    async generateBundle() {
      // Constant folding can remove a dependency's module from chunk.moduleIds.
      // The resolved build graph still identifies the code that supplied it.
      const moduleIds = this.getModuleIds()
      this.emitFile({ type: 'asset', fileName: 'THIRD-PARTY-NOTICES.txt', source: await buildFrontendLicenseNotices(moduleIds) })
    },
  }
}
