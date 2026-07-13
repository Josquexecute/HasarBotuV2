import { createContext, useContext } from 'react'
import type { DataSourceKind } from '../data/ports'
import type { SessionUser } from '../data/authPort'

/**
 * Oturum context'i ve kancasi (Paket 10). Provider bilesenden ayri dosyadadir
 * (fast-refresh ve repo konvansiyonu: kanca/utility kendi modulunde).
 */
export type SessionStatus = 'mock' | 'bootstrapping' | 'authenticated' | 'anonymous' | 'expired'

export interface SessionContextValue {
  readonly mode: DataSourceKind
  readonly status: SessionStatus
  readonly user: SessionUser | null
  /** Bootstrap sirasinda servise ulasilamadiysa kullaniciya gosterilecek not. */
  readonly notice: string | null
  login(email: string, password: string): Promise<void>
  logout(): Promise<void>
  /** Veri katmani api modda 401 gordugunde cagirir: oturum sona erdi akisi. */
  reportUnauthorized(): void
}

const DEFAULT_VALUE: SessionContextValue = {
  mode: 'mock',
  status: 'mock',
  user: null,
  notice: null,
  login: async () => undefined,
  logout: async () => undefined,
  reportUnauthorized: () => undefined,
}

export const SessionContext = createContext<SessionContextValue>(DEFAULT_VALUE)

export function useSession(): SessionContextValue {
  return useContext(SessionContext)
}
