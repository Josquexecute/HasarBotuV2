import { useCallback, useSyncExternalStore } from 'react'

const SELECTION_CHANGED = 'hasarbotu:assistant-case-changed'
export const assistantCaseSelectionKey = (userId: string) => `hasarbotu-assistant-case:${userId}`

/** Store only identity; each window loads the case through its authenticated API. */
export function rememberAssistantCase(userId: string, caseId: string): boolean {
  const key = assistantCaseSelectionKey(userId)
  try { localStorage.setItem(key, caseId) }
  catch { return false }
  // Storage events reach the other Electron window; this event covers same-document consumers.
  window.dispatchEvent(new CustomEvent(SELECTION_CHANGED, { detail: key }))
  return true
}

export function useAssistantCaseSelection(userId: string): string | null | undefined {
  const key = assistantCaseSelectionKey(userId)
  const subscribe = useCallback((changed: () => void) => {
    const storage = (event: StorageEvent) => { if (event.key === key || event.key === null) changed() }
    const local = (event: Event) => { if ((event as CustomEvent<string>).detail === key) changed() }
    window.addEventListener('storage', storage)
    window.addEventListener(SELECTION_CHANGED, local)
    window.addEventListener('focus', changed)
    return () => {
      window.removeEventListener('storage', storage)
      window.removeEventListener(SELECTION_CHANGED, local)
      window.removeEventListener('focus', changed)
    }
  }, [key])
  const snapshot = useCallback(() => {
    try { return localStorage.getItem(key) }
    catch { return undefined }
  }, [key])
  return useSyncExternalStore(subscribe, snapshot)
}
