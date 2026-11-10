import { useEffect, useMemo, useState } from 'react'
import { VALUE_LOSS_SAVED_EVENT, VALUE_LOSS_SAVED_STORAGE_KEY } from '../../app/valueLossSaved'
import { useSession } from '../../app/sessionContext'
import { createHttpValueLossCalculatorAdapter, type ValueLossCalculatorPort } from '../../data/valueLossCalculatorPort'
import { TrafficValueLossError } from '../../data/trafficValueLossPort'
import type { ValueLossCalculatorSaved } from '@hasarbotu/contracts'

export function AssistantValueLoss({ caseId, port }: { caseId: string; port?: ValueLossCalculatorPort }) {
  const adapter = useMemo(() => port ?? createHttpValueLossCalculatorAdapter(), [port])
  const { reportUnauthorized } = useSession()
  const [state, setState] = useState<{ data: ValueLossCalculatorSaved | null; status: 'loading' | 'ok' | 'error' }>({ data: null, status: 'loading' })
  useEffect(() => {
    let active = true
    let generation = 0
    const refresh = () => {
      const request = ++generation
      void (adapter.loadCalculation?.(caseId) ?? Promise.resolve(null)).then(data => {
        if (active && generation === request) setState({ data, status: 'ok' })
      }).catch((error: unknown) => {
        if (!active || generation !== request) return
        setState({ data: null, status: 'error' })
        if (error instanceof TrafficValueLossError && error.kind === 'unauthorized') reportUnauthorized()
      })
    }
    const saved = (event: Event) => { if ((event as CustomEvent<{ caseId: string }>).detail?.caseId === caseId) refresh() }
    const storage = (event: StorageEvent) => {
      if (event.key !== VALUE_LOSS_SAVED_STORAGE_KEY || !event.newValue) return
      try { if (JSON.parse(event.newValue).caseId === caseId) refresh() }
      catch { /* Ignore malformed cross-window notifications; the server remains authoritative. */ }
    }
    refresh()
    window.addEventListener('focus', refresh)
    window.addEventListener(VALUE_LOSS_SAVED_EVENT, saved)
    window.addEventListener('storage', storage)
    return () => { active = false; window.removeEventListener('focus', refresh); window.removeEventListener(VALUE_LOSS_SAVED_EVENT, saved); window.removeEventListener('storage', storage) }
  }, [adapter, caseId, reportUnauthorized])
  return <div className="assistant-value-loss" aria-label="Dosyanın değer kaybı">
    <span>Değer kaybı <small>Son kaydedilen hesap</small></span>
    <div aria-live="polite">{state.status === 'error' ? <span>Tutar alınamadı</span> : state.status === 'loading' ? <span>Yükleniyor…</span> : state.data?.result.amountMinor != null ? <><strong>{new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(state.data.result.amountMinor / 100)}</strong><small>{new Date(state.data.savedAt).toLocaleString('tr-TR')} tarihinde kaydedildi</small></> : <span>Henüz hesaplanmadı</span>}</div>
  </div>
}
