import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from '../app/sessionContext'
import {
  createHttpKascoMandatoryCheckAdapter,
  KascoMandatoryCheckError,
  type KascoMandatoryCheckDataPort,
  type KascoMandatoryCheckGateRecord,
} from './kascoMandatoryCheckPort'
import type { DataSourceKind } from './ports'

export type KascoMandatoryCheckGateStatus =
  | 'idle'
  | 'loading'
  | 'ok'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'unavailable'

export function useKascoMandatoryCheckGate(
  caseId: string,
  source: DataSourceKind,
  enabled: boolean,
  suppliedPort?: KascoMandatoryCheckDataPort,
): {
  readonly data: KascoMandatoryCheckGateRecord | null
  readonly status: KascoMandatoryCheckGateStatus
  readonly port: KascoMandatoryCheckDataPort
  reload(): void
} {
  const { reportUnauthorized } = useSession()
  const port = useMemo(() => suppliedPort ?? createHttpKascoMandatoryCheckAdapter(), [suppliedPort])
  const [token, setToken] = useState(0)
  const reload = useCallback(() => setToken((value) => value + 1), [])
  const active = source === 'api' && enabled
  // Yükleme durumu efektte senkron sıfırlanmaz; istek anahtarı değişince RENDER
  // sırasında türetilir. Anahtarı tutmayan geç yanıt yok sayılır.
  const requestKey = `${caseId}#${token}`
  const [loaded, setLoaded] = useState<{ key: string; data: KascoMandatoryCheckGateRecord | null; status: KascoMandatoryCheckGateStatus }>(
    () => ({ key: requestKey, data: null, status: 'loading' }),
  )
  const current = loaded.key === requestKey ? loaded : { key: requestKey, data: null, status: 'loading' as const }

  useEffect(() => {
    if (!active) return undefined
    let cancelled = false
    port.loadGate(caseId).then((result) => {
      if (cancelled) return
      setLoaded({ key: requestKey, data: result, status: 'ok' })
    }).catch((error: unknown) => {
      if (cancelled) return
      const next = error instanceof KascoMandatoryCheckError ? error.kind : 'unavailable'
      setLoaded({ key: requestKey, data: null, status: next === 'validation' || next === 'conflict' ? 'unavailable' : next })
      if (next === 'unauthorized') reportUnauthorized()
    })
    return () => { cancelled = true }
  }, [active, caseId, port, reportUnauthorized, requestKey])

  if (!active) return { data: null, status: 'idle', port, reload }
  return { data: current.data, status: current.status, port, reload }
}
