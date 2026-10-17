import { useEffect } from 'react'

export const PROFILE_UPDATED_EVENT = 'profile-updated'
export const USER_DIRECTORY_UPDATED_EVENT = 'user-directory-updated'

export function useUserDirectoryRefresh(refresh: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return
    window.addEventListener(USER_DIRECTORY_UPDATED_EVENT, refresh)
    return () => window.removeEventListener(USER_DIRECTORY_UPDATED_EVENT, refresh)
  }, [enabled, refresh])
}
