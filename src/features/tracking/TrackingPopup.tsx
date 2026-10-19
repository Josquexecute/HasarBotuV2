import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { BellRing, X } from 'lucide-react'
import { trackingPendingNotificationsSchema } from '@hasarbotu/contracts'
import { trackingRequest } from './trackingApi'
import { assistantFeedback } from '../../app/assistantFeedback'
import './tracking.css'

interface Notice { id: string;caseId: string;plate: string;title: string }
export function TrackingPopup() {
  const [items,setItems] = useState<Notice[]>([])
  const [error,setError] = useState('')
  const [dismissing,setDismissing] = useState(false)
  const dismissInProgress = useRef(false)
  const generation = useRef(0)
  const knownIds = useRef(new Set<string>())
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
        if (!controller.signal.aborted && requestGeneration === generation.current) {
          const received = data.notifications.some((notice) => !knownIds.current.has(notice.id))
          knownIds.current = new Set(data.notifications.map((notice) => notice.id))
          setItems(data.notifications);setError('')
          if (received) {
            window.dispatchEvent(new Event('tracking-received'))
            assistantFeedback()?.notificationReceived?.()
          }
        }
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
    <header className="tracking-popup__header"><span><BellRing size={16} />{items.length === 20 ? '20 veya daha fazla' : items.length} yeni bildirim</span><button type="button" aria-label={dismissing ? 'Kapatılıyor…' : 'Uyarıyı kapat'} disabled={dismissing} onClick={() => { void dismiss() }}><X size={17} /></button></header>
    <strong>{first.plate}</strong><p>{first.title}</p>
    <footer><Link to={`/dosyalar/${first.caseId}`}>Dosyayı aç</Link><Link to="/bildirimler">Tüm bildirimler</Link></footer>{error && <span>{error}</span>}
  </aside>
}
