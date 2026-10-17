import { useEffect } from 'react'
import { useSession } from './sessionContext'
import { PROFILE_UPDATED_EVENT, USER_DIRECTORY_UPDATED_EVENT } from './userDirectory'

export const USER_DIRECTORY_REFRESH_MS = 15_000

/** One small directory read per client keeps shared names current without reloading forms every cycle. */
export function UserDirectorySync() {
  const { mode, status, user, reportUnauthorized } = useSession()
  const organizationId = user?.organizationId
  const userId = user?.id
  useEffect(() => {
    if (mode !== 'api' || status !== 'authenticated' || !organizationId) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>, active = false, previous: string | undefined
    const poll = async () => {
      if (active || controller.signal.aborted) return
      clearTimeout(timer)
      if (document.visibilityState === 'hidden') { timer = setTimeout(() => { void poll() }, USER_DIRECTORY_REFRESH_MS); return }
      active = true
      try {
        const response = await fetch('/api/v1/references/users?includeRoles=true', { credentials: 'include', cache: 'no-store', signal: controller.signal, headers: { accept: 'application/json' } })
        if (response.status === 401) { reportUnauthorized(); return }
        if (!response.ok) throw new Error('User directory unavailable')
        const body = await response.json() as { items?: { id: string; displayName: string; roles?: string[] }[] }
        if (!Array.isArray(body.items) || body.items.some(item => typeof item.id !== 'string' || typeof item.displayName !== 'string' || item.roles !== undefined && (!Array.isArray(item.roles) || item.roles.some(role => typeof role !== 'string')))) throw new Error('Invalid user directory')
        const next = JSON.stringify(body.items.map(item => [item.id, item.displayName, ...(item.roles ?? []).slice().sort()]).sort((a, b) => a[0]!.localeCompare(b[0]!)))
        if (!controller.signal.aborted && previous !== undefined && previous !== next) window.dispatchEvent(new Event(USER_DIRECTORY_UPDATED_EVENT))
        previous = next
      } catch {
        // A failed read is not a directory change; keep loaded names until a valid observation.
      } finally {
        active = false
        if (!controller.signal.aborted) timer = setTimeout(() => { void poll() }, USER_DIRECTORY_REFRESH_MS)
      }
    }
    const refresh = () => { void poll() }
    void poll()
    window.addEventListener('focus', refresh)
    window.addEventListener(PROFILE_UPDATED_EVENT, refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => { controller.abort(); clearTimeout(timer); window.removeEventListener('focus', refresh); window.removeEventListener(PROFILE_UPDATED_EVENT, refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [mode, organizationId, userId, reportUnauthorized, status])
  return null
}
