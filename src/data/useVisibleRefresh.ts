import { useEffect } from 'react'

const OFFICE_INVENTORY_REFRESH_MS = 30_000

/** Office folders can move outside the app; refresh visible read models after discovery. */
export function useVisibleRefresh(refresh: () => void, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    const refreshVisible = () => { if (document.visibilityState === 'visible') refresh() }
    const timer = window.setInterval(refreshVisible, OFFICE_INVENTORY_REFRESH_MS)
    window.addEventListener('focus', refreshVisible)
    document.addEventListener('visibilitychange', refreshVisible)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshVisible)
      document.removeEventListener('visibilitychange', refreshVisible)
    }
  }, [enabled, refresh])
}
