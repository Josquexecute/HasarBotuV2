import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { trackingPendingNotificationsSchema } from '@hasarbotu/contracts'
import { trackingRequest } from './trackingApi'
import './tracking.css'

interface Notice { id: string;caseId: string;plate: string;title: string }
export function TrackingPopup() {
  const [items,setItems] = useState<Notice[]>([])
  const [error,setError] = useState('')
  const [dismissing,setDismissing] = useState(false)
  const dismissInProgress = useRef(false)
  const generation = useRef(0)
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    let active = false
    const poll = async () => {
      if (active || dismissInProgress.current || controller.signal.aborted) return
      active = true
      const requestGeneration = generation.current
      try {
        const data = trackingPendingNotificationsSchema.parse(await trackingRequest('tracking/notifications/pending',undefined,controller.signal))
        if (!controller.signal.aborted && requestGeneration === generation.current) { setItems(data.notifications);setError('') }
      } catch {
        if (!controller.signal.aborted) setError('Yeni bildirimler alınamıyor.')
      } finally {
        active = false
        if (!controller.signal.aborted) { clearTimeout(timer);timer = setTimeout(() => { void poll() },15_000) }
      }
    }
    const refresh = () => { void poll() }
    window.addEventListener('tracking-updated',refresh)
    void poll()
    return () => { controller.abort();clearTimeout(timer);window.removeEventListener('tracking-updated',refresh) }
  },[])
  const first = items[0]
  if (!first) return error ? <aside className="tracking-popup" role="status">{error}</aside> : null
  async function dismiss() {
    if (dismissInProgress.current) return
    dismissInProgress.current = true
    generation.current += 1
    setDismissing(true)
    try {
      await trackingRequest('tracking/notifications/dismiss',{})
      setItems([])
    } catch { setError('Uyarı kapatılamadı; tekrar deneyin.') }
    finally { dismissInProgress.current = false;setDismissing(false) }
  }
  return <aside className="tracking-popup" aria-label="Yeni bildirim" role="status">
    <strong>{items.length === 20 ? '20 veya daha fazla' : items.length} yeni bildirim</strong><span>{first.plate}: {first.title}</span>
    <Link to={`/dosyalar/${first.caseId}`}>Dosyayı aç</Link><Link to="/bildirimler">Tüm bildirimler</Link>
    <button type="button" className="button button--secondary" disabled={dismissing} onClick={() => { void dismiss() }}>{dismissing ? 'Kapatılıyor…' : 'Uyarıyı kapat'}</button>{error && <span>{error}</span>}
  </aside>
}
