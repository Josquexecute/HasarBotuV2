import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { trackingPendingNotificationsSchema } from '@hasarbotu/contracts'
import { trackingRequest } from './trackingApi'
import './tracking.css'

interface Notice { id: string;caseId: string;plate: string;title: string }
export function TrackingPopup() {
  const [items,setItems] = useState<Notice[]>([])
  const [error,setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    let active = false
    const poll = async () => {
      if (active || controller.signal.aborted) return
      active = true
      try {
        const data = trackingPendingNotificationsSchema.parse(await trackingRequest('tracking/notifications/pending',undefined,controller.signal))
        if (!controller.signal.aborted) { setItems(data.notifications);setError('') }
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
    try {
      await Promise.all(items.map((n) => trackingRequest(`tracking/notifications/${n.id}/presented`,{})))
      setItems([])
    } catch { setError('Uyarı kapatılamadı; tekrar deneyin.') }
  }
  return <aside className="tracking-popup" aria-label="Yeni bildirim" role="status">
    <strong>{items.length === 20 ? '20 veya daha fazla' : items.length} yeni bildirim</strong><span>{first.plate}: {first.title}</span>
    <Link to={`/dosyalar/${first.caseId}`}>İlgili dosyayı aç</Link><Link to="/bildirimler">Bildirimleri ve bekleyen işleri aç</Link>
    <button type="button" className="button button--secondary" onClick={() => { void dismiss() }}>Uyarıyı kapat (okunmamış kalır)</button>{error && <span>{error}</span>}
  </aside>
}
