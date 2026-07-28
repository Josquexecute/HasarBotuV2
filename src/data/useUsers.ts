import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from '../app/sessionContext'
import {
  UsersError,
  createHttpUsersAdapter,
  type RoleCodeRecord,
  type UserSummaryRecord,
  type UsersDataPort,
  type UsersErrorKind,
} from './usersPort'

export type UsersLoadStatus = 'idle' | 'loading' | 'ok' | UsersErrorKind

const NO_USERS: readonly UserSummaryRecord[] = []

function usePort(supplied?: UsersDataPort) {
  return useMemo(() => supplied ?? createHttpUsersAdapter(), [supplied])
}

export function useUsers(enabled: boolean, suppliedPort?: UsersDataPort) {
  const port = usePort(suppliedPort)
  const { reportUnauthorized } = useSession()
  const [revision, setRevision] = useState(0)
  const reload = useCallback(() => setRevision((value) => value + 1), [])
  const [items, setItems] = useState<readonly UserSummaryRecord[]>(NO_USERS)
  const [status, setStatus] = useState<UsersLoadStatus>('loading')
  const [savingUserId, setSavingUserId] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    port.list().then((value) => {
      if (cancelled) return
      setItems(value)
      setStatus('ok')
    }).catch((error: unknown) => {
      if (cancelled) return
      setItems(NO_USERS)
      const kind = error instanceof UsersError ? error.kind : 'unavailable'
      setStatus(kind)
      if (kind === 'unauthorized') reportUnauthorized()
    })
    return () => { cancelled = true }
  }, [enabled, port, reportUnauthorized, revision])

  const updateRoles = useCallback(async (
    userId: string,
    input: { roles: readonly RoleCodeRecord[]; expectedVersion: number },
  ): Promise<{ ok: true } | { ok: false; kind: UsersErrorKind }> => {
    setSavingUserId(userId)
    try {
      await port.updateRoles(userId, input)
      reload()
      return { ok: true }
    } catch (error) {
      const kind = error instanceof UsersError ? error.kind : 'unavailable'
      if (kind === 'unauthorized') reportUnauthorized()
      // Sürüm çakışmasında listeyi GERÇEKTEN yeniden yükleriz; aksi halde
      // kullanıcıya gösterilen "liste yenilendi" mesajı doğru olmaz ve bir
      // sonraki kaydetme yine bayat `expectedVersion` gönderirdi.
      if (kind === 'conflict') reload()
      return { ok: false, kind }
    } finally {
      setSavingUserId(null)
    }
  }, [port, reload, reportUnauthorized])

  if (!enabled) return { items: NO_USERS, status: 'idle' as UsersLoadStatus, reload, updateRoles, savingUserId: null }
  return { items, status, reload, updateRoles, savingUserId }
}
