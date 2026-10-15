import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Bell, Check, CheckCheck, FileText, RefreshCw } from 'lucide-react'
import { trackingInboxSchema } from '@hasarbotu/contracts'
import { trackingRequest } from '../tracking/trackingApi'
import { NotificationCard } from './NotificationCard'
import { groupNotifications } from './notification-time'

type Inbox = ReturnType<typeof trackingInboxSchema.parse>
type Notice = Inbox['notifications'][number]
export function TrackingInbox() {
  const navigate = useNavigate()
  const [data,setData] = useState<Inbox | null>(null)
  const [page,setPage] = useState(1)
  const [read,setRead] = useState('unread')
  const [loading,setLoading] = useState(true)
  const [error,setError] = useState('')
  const [version,setVersion] = useState(0)
  const [saving,setSaving] = useState<string | null>(null)
  const inFlight = useRef(false)
  useEffect(() => {
    const refresh = () => setVersion((value) => value+1)
    window.addEventListener('tracking-received',refresh)
    return () => window.removeEventListener('tracking-received',refresh)
  },[])
  useEffect(() => {
    const controller = new AbortController()
    void trackingRequest(`tracking/notifications/inbox?page=${page}&read=${read}`,undefined,controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return
        const result = trackingInboxSchema.parse(response)
        const last = Math.max(1,Math.ceil(result.total/50))
        if (page > last) { setPage(last);return }
        setData(result);setError('')
      }).catch((e: unknown) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Bildirimler alınamadı.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  },[page,read,version])
  async function markRead(id: string): Promise<boolean> {
    if (inFlight.current) return false
    inFlight.current = true
    setSaving(id)
    try {
      await trackingRequest(`tracking/notifications/${id}/read`,{})
      setVersion((value) => value+1)
      window.dispatchEvent(new Event('tracking-updated'))
      return true
    } catch (e) { setError(e instanceof Error ? e.message : 'Bildirim güncellenemedi.');return false }
    finally { inFlight.current = false;setSaving(null) }
  }
  async function open(item: Notice) {
    if (!item.readAt && !await markRead(item.id)) return
    navigate(`/dosyalar/${item.caseId}${item.kind === 'document' ? '?tab=documents' : ''}`)
  }
  async function markAllRead() {
    if (inFlight.current || loading || !data?.unread) return
    inFlight.current = true
    setSaving('all')
    try {
      await trackingRequest('tracking/notifications/read-all',{})
      setError('')
      setLoading(true)
      setPage(1)
      setVersion(value => value+1)
      window.dispatchEvent(new Event('tracking-updated'))
    } catch (e) { setError(e instanceof Error ? e.message : 'Bildirimler güncellenemedi.') }
    finally { inFlight.current = false;setSaving(null) }
  }
  const groups = groupNotifications(data?.notifications ?? [], item => item.createdAt)
  return <section className="notification-feed" aria-label="Dosya bildirimleri" aria-busy={loading || saving !== null}>
    <div className="notification-feed__toolbar">
      <div className="notification-segments" role="group" aria-label="Bildirim okuma durumu">{([['unread','Okunmamış'],['all','Tümü'],['read','Okunmuş']] as const).map(([value,label]) => <button type="button" key={value} aria-pressed={read === value} disabled={saving !== null} onClick={() => { if (read === value) return;setRead(value);setPage(1);setLoading(true) }}>{label}{value === 'unread' && data !== null && <span>{data.unread}</span>}</button>)}</div>
      <div className="notification-feed__actions">
        <button className="button button--secondary" type="button" disabled={loading || saving !== null || !data?.unread || !!error} onClick={() => { void markAllRead() }}><CheckCheck size={16} />{saving === 'all' ? 'Kaydediliyor…' : 'Tümünü okundu işaretle'}</button>
        <button className="notification-icon-button" type="button" aria-label="Bildirimleri yenile" disabled={loading || saving !== null} onClick={() => { setLoading(true);setVersion(value => value+1) }}><RefreshCw size={17} /></button>
      </div>
    </div>
    {error && <p className="notification-feedback" role="alert">{error}<button className="text-button" type="button" onClick={() => { setLoading(true);setVersion(value => value+1) }}>Tekrar dene</button></p>}
    {loading ? <p className="notification-feedback" role="status">Bildirimler yükleniyor…</p> : !error && <>
      <div className="notification-feed__groups">{groups.map(group => <section className="notification-day" key={group.title} aria-label={group.title}>
        <h2>{group.title}</h2><div className="notification-card-list" role="list">{group.items.map(item => <NotificationCard key={item.id} icon={item.kind === 'document' ? FileText : Bell} label={item.kind === 'document' ? 'Evrak' : 'Tramer'} plate={item.plate} officeNumber={item.officeNumber} title={item.title} timestamp={item.createdAt} read={!!item.readAt} onOpen={() => { void open(item) }} disabled={saving !== null}
          action={!item.readAt && <button className="notification-read-button" type="button" disabled={saving !== null} onClick={() => { void markRead(item.id) }} aria-label={`${item.plate} bildirimini okundu işaretle`}><Check size={15} />{saving === item.id ? 'Kaydediliyor…' : 'Okundu'}</button>} />)}</div>
      </section>)}</div>
      {data?.notifications.length === 0 && <div className="notification-empty" role="status"><Check size={25} /><strong>{read === 'unread' ? 'Hepsi güncel' : 'Bildirim yok'}</strong><span>{read === 'unread' ? 'Okunmamış bildiriminiz bulunmuyor.' : 'Bu görünümde bildirim bulunmuyor.'}</span></div>}
      {(data?.total ?? 0) > 0 && <div className="notification-pagination"><span>{data?.total} bildirim · {page} / {Math.max(1,Math.ceil((data?.total ?? 0)/50))}</span><div><button type="button" disabled={page <= 1 || saving !== null} onClick={() => { setLoading(true);setPage(page-1) }}>Önceki</button><button type="button" disabled={page*50 >= (data?.total ?? 0) || saving !== null} onClick={() => { setLoading(true);setPage(page+1) }}>Sonraki</button></div></div>}
    </>}
  </section>
}
