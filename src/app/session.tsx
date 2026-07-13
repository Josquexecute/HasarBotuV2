import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getConfiguredDataSource, type DataSourceKind } from '../data/ports'
import { createHttpAuthAdapter, HttpAuthError, type AuthPort, type SessionUser } from '../data/authPort'
import { SessionContext, type SessionContextValue, type SessionStatus } from './sessionContext'

/**
 * Oturum sinir saglayicisi (Paket 10).
 *
 * - `mock` mod (varsayilan, HB-2026-014): acikca secilen demo veri kaynagidir;
 *   oturum kapisi YOKTUR ve kabul edilmis UI baseline'i aynen render edilir.
 * - `api` mod: uygulama acilisinda gercek oturum bootstrap edilir; oturum yoksa
 *   login ekrani, 401 sonrasi "oturum sona erdi" akisi calisir. Sahte oturum
 *   ASLA uydurulmaz; mock, api hatasini HICBIR ZAMAN maskelemez.
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

  useEffect(() => {
    if (mode !== 'api') return
    let cancelled = false
    auth
      .bootstrap()
      .then((session) => {
        if (cancelled) return
        if (session === null) {
          setStatus('anonymous')
          return
        }
        setUser(session)
        setStatus('authenticated')
      })
      .catch((error: unknown) => {
        if (cancelled) return
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
    async (email: string, password: string) => {
      const session = await auth.login(email, password)
      setUser(session)
      setNotice(null)
      setStatus('authenticated')
    },
    [auth],
  )

  const logout = useCallback(async () => {
    await auth.logout()
    setUser(null)
    setNotice(null)
    setStatus('anonymous')
  }, [auth])

  const reportUnauthorized = useCallback(() => {
    setStatus((current) => {
      if (current !== 'authenticated') return current
      setUser(null)
      return 'expired'
    })
  }, [])

  const value = useMemo<SessionContextValue>(
    () => ({ mode, status, user, notice, login, logout, reportUnauthorized }),
    [mode, status, user, notice, login, logout, reportUnauthorized],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
