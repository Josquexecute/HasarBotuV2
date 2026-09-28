import { useEffect, useState } from 'react'

export const PERSISTENCE_ERROR_EVENT = 'hasarbotu:persistence-error'

function validStoredValue(key: string, value: unknown, initialValue: unknown): boolean {
  if (key === 'hasarbotu-theme') return value === 'light' || value === 'dark'
  if (key === 'hasarbotu-density') return value === 'compact' || value === 'comfortable'
  if (key === 'hasarbotu-default-page') return value === 'Dosyalar' || value === 'Durum Panosu'
  return typeof value === typeof initialValue && value !== null
}

export function usePersistentState<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const storedValue = window.localStorage.getItem(key)
      const parsed: unknown = storedValue === null ? undefined : JSON.parse(storedValue)
      return validStoredValue(key, parsed, initialValue) ? parsed as T : initialValue
    } catch {
      return initialValue
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      window.dispatchEvent(new Event(PERSISTENCE_ERROR_EVENT))
    }
  }, [key, value])

  return [value, setValue] as const
}
