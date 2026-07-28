import { lstat, mkdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import type { JobPayload } from '@hasarbotu/contracts'
import { isUnderRoot, PathSafetyError, resolveUnderRoot } from './path-resolver.js'
import { probeRootHealth, STORAGE_UNAVAILABLE_ERROR_CODE } from './root-health.js'

export interface WorkspaceProvisionResult {
  readonly outcome: 'verified' | 'failed'
  readonly errorCode?: string
  readonly observedHash?: undefined
  readonly observedSize?: undefined
}

type WorkspacePayload = Extract<JobPayload, { readonly kind: 'workspace' }>

export interface WorkspaceProvisionHooks {
  /** Test ve ilerleme bildirimi için; üretimde dosya yolu dışarı taşınmaz. */
  readonly beforeCreate?: (relativePath: string) => Promise<void> | void
  readonly onVerifying?: () => Promise<void> | void
}

function errno(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code
}

async function assertOrdinaryDirectory(rootReal: string, candidate: string): Promise<void> {
  const metadata = await lstat(candidate)
  // Node, Windows junction ve symbolic link reparse point'lerini symbolic link
  // olarak bildirir. Beklenmeyen yönlendirmeler kök dışına çıkmasa dahi reddedilir.
  if (metadata.isSymbolicLink()) throw new PathSafetyError('reparse_point_rejected', 'reparse point is not allowed')
  if (!metadata.isDirectory()) throw new PathSafetyError('not_a_directory', 'path component is not a directory')
  const resolved = await realpath(candidate)
  if (!isUnderRoot(rootReal, resolved)) throw new PathSafetyError('root_escape', 'real path escapes storage root')
}

async function ensureDirectoryChain(
  rootAbsolute: string,
  rootReal: string,
  relativePath: string,
  hooks: WorkspaceProvisionHooks,
): Promise<void> {
  const segments = relativePath.split('/')
  let current = rootAbsolute
  let relative = ''
  for (const segment of segments) {
    relative = relative.length === 0 ? segment : `${relative}/${segment}`
    current = join(current, segment)
    try {
      await assertOrdinaryDirectory(rootReal, current)
    } catch (error) {
      if (errno(error) !== 'ENOENT') throw error
      // Parent her adımda yeniden gerçek-yol kontrolünden geçer; mkdir recursive
      // değildir. Böylece kısmi yapıda yalnız eksik parça oluşturulur.
      const parent = join(current, '..')
      const parentReal = await realpath(parent)
      if (!isUnderRoot(rootReal, parentReal)) throw new PathSafetyError('root_escape', 'parent escapes storage root')
      await hooks.beforeCreate?.(relative)
      try {
        await mkdir(current)
      } catch (mkdirError) {
        if (errno(mkdirError) !== 'EEXIST') throw mkdirError
      }
      await assertOrdinaryDirectory(rootReal, current)
    }
  }
}

/**
 * Güvenli, eklemeli ve idempotent klasör provisioning işlemi. Silme, taşıma veya
 * yeniden adlandırma yapmaz. Hata hâlinde oluşturulmuş dizinleri geriye almaz.
 *
 * D4 fail-closed: kök GERÇEKTEN yazılabilir olduğu (D4 root health probu ile)
 * doğrulanmadan HİÇBİR dizin oluşturma denemesi yapılmaz — kısmi/tutarsız
 * klasör yapısı ve yarım kalmış iş bütçesi (attempt) tüketimi riski baştan
 * kesilir. Hata kodu her zaman `storage_unavailable`dır.
 */
export async function provisionCaseWorkspace(
  rootAbsolute: string,
  payload: WorkspacePayload,
  hooks: WorkspaceProvisionHooks = {},
): Promise<WorkspaceProvisionResult> {
  const health = await probeRootHealth(rootAbsolute)
  if (!health.ok) return { outcome: 'failed', errorCode: STORAGE_UNAVAILABLE_ERROR_CODE }
  try {
    const rootReal = await realpath(rootAbsolute)
    resolveUnderRoot(rootAbsolute, payload.relativePath)

    await ensureDirectoryChain(rootAbsolute, rootReal, payload.relativePath, hooks)
    for (const subdirectory of payload.requiredSubdirectories) {
      await ensureDirectoryChain(rootAbsolute, rootReal, `${payload.relativePath}/${subdirectory}`, hooks)
    }

    await hooks.onVerifying?.()
    await assertOrdinaryDirectory(rootReal, resolveUnderRoot(rootAbsolute, payload.relativePath))
    for (const subdirectory of payload.requiredSubdirectories) {
      await assertOrdinaryDirectory(rootReal, resolveUnderRoot(rootAbsolute, `${payload.relativePath}/${subdirectory}`))
    }
    return { outcome: 'verified' }
  } catch (error) {
    if (error instanceof PathSafetyError) return { outcome: 'failed', errorCode: error.code }
    const code = errno(error)
    if (code === 'EACCES' || code === 'EPERM') return { outcome: 'failed', errorCode: 'access_denied' }
    if (code === 'ENOENT') return { outcome: 'failed', errorCode: 'root_or_parent_missing' }
    return { outcome: 'failed', errorCode: 'workspace_apply_failed' }
  }
}
