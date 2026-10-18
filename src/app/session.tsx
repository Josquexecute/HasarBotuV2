import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { getConfiguredDataSource, type DataSourceKind } from '../data/ports'
import { createHttpAuthAdapter, HttpAuthError, type AuthPort, type SessionUser } from '../data/authPort'
import { SessionContext, type SessionContextValue, type SessionStatus } from './sessionContext'
import { PROFILE_UPDATED_EVENT, USER_DIRECTORY_UPDATED_EVENT } from './userDirectory'

/**
 * Oturum sinir saglayicisi (Paket 10).
 *
 * - `mock` mod (development/test, HB-2026-014): acikca secilen demo veri kaynagidir;
 *   oturum kapisi YOKTUR ve kabul edilmis UI baseline'i aynen render edilir.
 * - `api` mod: uygulama acilisinda gercek oturum bootstrap edilir; oturum yoksa
 *   login ekrani, 401 sonrasi "oturum sona erdi" akisi calisir. Sahte oturum
 *   ASLA uydurulmaz; mock, api hatasini HICBIR ZAMAN maskelemez.
 * - Production build localStorage/env mock secimini kabul etmez ve API modudur.
 */
interface SessionProviderProps {
  readonly children: ReactNode
  /** Test enjeksiyonu; verilmezse ayni-origin HttpAuthAdapter kurulur. */
  readonly authPort?: AuthPort
}

export function SessionProvider({ children, authPort }: SessionProviderProps) {
  const [mode] = useState<DataSourceKind>(getConfiguredDataSource)
  const auth = useMemo(() => authPort ?? createHttpAuthAdapter(), [authPort])

  const [status, setStatus] = useState<SessionStatus>(mode === 'api' ? 'bootstrapping' : 'mock')
  const [user, setUser] = useState<SessionUser | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const requestVersion = useRef(0)
  const pendingMutation = useRef<number | null>(null)

  useEffect(() => {
    if (mode !== 'api') return
    let cancelled = false
    const version = ++requestVersion.current
    auth
      .bootstrap()
      .then((session) => {
        if (cancelled || requestVersion.current !== version) return
        if (session === null) {
          setStatus('anonymous')
          return
        }
        setUser(session)
        setStatus('authenticated')
      })
      .catch((error: unknown) => {
        if (cancelled || requestVersion.current !== version) return
        setStatus('anonymous')
        setNotice(
          error instanceof HttpAuthError && error.kind === 'unavailable'
            ? 'Sunucuya şu anda ulaşılamıyor. Bağlantıyı kontrol edip tekrar giriş yapın.'
            : null,
        )
      })
    return () => {
      cancelled = true
    }
  }, [mode, auth])

  const login = useCallback(
    async (email: string, password: string, rememberMe?: boolean) => {
      const version = ++requestVersion.current
      pendingMutation.current = version
      try {
        const session = await (rememberMe === undefined ? auth.login(email, password) : auth.login(email, password, rememberMe))
        if (requestVersion.current !== version) return
        setUser(session)
        setNotice(null)
        setStatus('authenticated')
      } finally {
        if (pendingMutation.current === version) pendingMutation.current = null
      }
    },
    [auth],
  )

  useEffect(() => {
    if (mode !== 'api') return
    let cancelled = false
    const refresh = () => {
      if (pendingMutation.current !== null) return
      const version = ++requestVersion.current
      void auth.bootstrap().then((current) => {
        if (cancelled || requestVersion.current !== version) return
        setUser(current)
        setStatus((previous) => current ? 'authenticated' : previous === 'anonymous' ? 'anonymous' : 'expired')
        if (current) setNotice(null)
      }).catch(() => { /* A focus refresh leaves the current session intact during a network outage; API checks remain authoritative. */ })
    }
    window.addEventListener('focus',refresh)
    window.addEventListener('permissions-updated',refresh)
    window.addEventListener(PROFILE_UPDATED_EVENT,refresh)
    window.addEventListener(USER_DIRECTORY_UPDATED_EVENT,refresh)
    return () => { cancelled = true;window.removeEventListener('focus',refresh);window.removeEventListener('permissions-updated',refresh);window.removeEventListener(PROFILE_UPDATED_EVENT,refresh);window.removeEventListener(USER_DIRECTORY_UPDATED_EVENT,refresh) }
  },[auth,mode,status])

  const logout = useCallback(async () => {
    const version = ++requestVersion.current
    pendingMutation.current = version
    try {
      await auth.logout()
      if (requestVersion.current !== version) return
      setUser(null)
      setNotice(null)
      setStatus('anonymous')
    } finally {
      if (pendingMutation.current === version) pendingMutation.current = null
    }
  }, [auth])

  const reportUnauthorized = useCallback(() => {
    if (status !== 'authenticated' || pendingMutation.current !== null) return
    requestVersion.current += 1
    setUser(null)
    setStatus('expired')
  }, [status])

  const value = useMemo<SessionContextValue>(
    () => ({ mode, status, user, notice, login, logout, reportUnauthorized }),
    [mode, status, user, notice, login, logout, reportUnauthorized],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
