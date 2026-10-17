import { useEffect, useState } from 'react'
import { toOfficeDate } from '@hasarbotu/domain'

/** Open workspaces also advance after midnight or after the device wakes. */
export function useOfficeDate(): string {
  const [date, setDate] = useState(() => toOfficeDate(new Date()))
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      setDate(toOfficeDate(new Date()))
      clearTimeout(timer)
      timer = setTimeout(refresh, 60_000 - Date.now() % 60_000)
    }
    timer = setTimeout(refresh, 60_000 - Date.now() % 60_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => { clearTimeout(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [])
  return date
}
