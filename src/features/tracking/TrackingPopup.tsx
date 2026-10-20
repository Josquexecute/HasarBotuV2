import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { BellRing, X } from 'lucide-react'
import { trackingPendingNotificationsSchema } from '@hasarbotu/contracts'
import { trackingRequest } from './trackingApi'
import { assistantFeedback } from '../../app/assistantFeedback'
import { ModalFrame } from '../../components/ModalFrame'
import { enableNotificationSound, playNotificationSound } from '../notifications/notification-sound'
import './tracking.css'

interface Notice { id: string;caseId: string;plate: string;title: string;isResult: boolean }
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
          const visible = data.notifications.filter(notice => notice.isResult || data.preferences.showPopups)
          const arrivals = visible.filter(notice => !knownIds.current.has(notice.id))
          const urgent = arrivals.some(notice => notice.isResult)
          knownIds.current = new Set(data.notifications.map((notice) => notice.id))
          setItems(visible);setError('')
          if (arrivals.length) {
            window.dispatchEvent(new Event('tracking-received'))
            if (urgent || data.preferences.assistantReaction) assistantFeedback()?.notificationReceived?.()
            if (urgent || data.preferences.playSound) void playNotificationSound(urgent)
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
    window.addEventListener('pointerdown',enableNotificationSound)
    window.addEventListener('keydown',enableNotificationSound)
    void poll()
    return () => { controller.abort();clearTimeout(timer);window.removeEventListener('tracking-updated',refresh);window.removeEventListener('pointerdown',enableNotificationSound);window.removeEventListener('keydown',enableNotificationSound) }
  },[])
  const first = items[0]
  if (!first) return error ? <aside className="tracking-popup" role="status">{error}</aside> : null
  async function dismiss() {
    if (dismissInProgress.current) return
    dismissInProgress.current = true
    generation.current += 1
    setDismissing(true)
    try {
      const results = items.filter(item => item.isResult)
      const ids = (results.length ? results : items).map(item => item.id)
      await trackingRequest('tracking/notifications/dismiss',results.length ? { ids } : { ordinary: true })
      setItems(current => results.length ? current.filter(item => !ids.includes(item.id)) : [])
    } catch { setError('Uyarı kapatılamadı; tekrar deneyin.') }
    finally { dismissInProgress.current = false;setDismissing(false) }
  }
  const results = items.filter(item => item.isResult)
  if (results.length) return <ModalFrame role="alertdialog" labelledBy="tramer-result-popup-title" className="tramer-result-popup" busy={dismissing} onClose={() => { void dismiss() }}>
    <header className="modal__header"><h2 id="tramer-result-popup-title"><BellRing size={30} /> Tramer sonucu geldi</h2><button className="icon-button" type="button" aria-label="Uyarıyı kapat" disabled={dismissing} onClick={() => { void dismiss() }}><X size={22} /></button></header>
    <div className="modal__body"><p className="tramer-result-popup__count">{results.length} dosyada yeni sonuç</p>{results.map(item => <article key={item.id}><strong>{item.plate}</strong><p>{item.title}</p><Link className="button button--primary" to={`/dosyalar/${item.caseId}`} onClick={() => { void dismiss() }}>Dosyayı aç</Link></article>)}{error && <p role="alert">{error}</p>}</div>
    <footer className="modal__footer"><Link to="/bildirimler">Tüm bildirimler</Link><button className="button button--primary" type="button" disabled={dismissing} onClick={() => { void dismiss() }}>{dismissing ? 'Kapatılıyor…' : 'Sonuçları gördüm'}</button></footer>
  </ModalFrame>
  return <aside className="tracking-popup" aria-label="Yeni bildirim" role="status">
    <header className="tracking-popup__header"><span><BellRing size={16} />{items.length === 20 ? '20 veya daha fazla' : items.length} yeni bildirim</span><button type="button" aria-label={dismissing ? 'Kapatılıyor…' : 'Uyarıyı kapat'} disabled={dismissing} onClick={() => { void dismiss() }}><X size={17} /></button></header>
    <strong>{first.plate}</strong><p>{first.title}</p>
    <footer><Link to={`/dosyalar/${first.caseId}`}>Dosyayı aç</Link><Link to="/bildirimler">Tüm bildirimler</Link></footer>{error && <span>{error}</span>}
  </aside>
}
