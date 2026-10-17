import path from 'node:path'

export function parseDistributionFolders(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid private folder configuration.')
  const entries = Object.entries(value)
  for (const [key,root] of entries) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key) || key.length > 64
      || typeof root !== 'string' || !path.win32.isAbsolute(root) || /[\x00-\x1f]/.test(root)) throw new Error('Invalid private folder configuration.')
  }
  return Object.fromEntries(entries)
}
