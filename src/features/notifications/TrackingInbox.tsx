import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { trackingInboxSchema } from '@hasarbotu/contracts'
import { trackingRequest } from '../tracking/trackingApi'

type Inbox = ReturnType<typeof trackingInboxSchema.parse>
const date = new Intl.DateTimeFormat('tr-TR',{ timeZone: 'Europe/Istanbul',dateStyle: 'short',timeStyle: 'short' })
export function TrackingInbox() {
  const [data,setData] = useState<Inbox | null>(null)
  const [page,setPage] = useState(1)
  const [read,setRead] = useState('unread')
  const [loading,setLoading] = useState(true)
  const [error,setError] = useState('')
  const [version,setVersion] = useState(0)
  const [saving,setSaving] = useState<string | null>(null)
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
  async function markRead(id: string) {
    if (saving) return
    setSaving(id)
    try {
      await trackingRequest(`tracking/notifications/${id}/read`,{})
      setVersion((value) => value+1)
      window.dispatchEvent(new Event('tracking-updated'))
    } catch (e) { setError(e instanceof Error ? e.message : 'Bildirim güncellenemedi.') }
    finally { setSaving(null) }
  }
  return <section aria-label="Dosya bildirimleri">
    <div className="filterbar"><label className="select-field"><span>Durum</span><select aria-label="Bildirim okuma durumu" value={read} onChange={(event) => { setRead(event.target.value);setPage(1);setLoading(true) }}><option value="unread">Okunmamış</option><option value="all">Tümü</option><option value="read">Okunmuş</option></select></label>
      <span>{data?.unread ?? 0} okunmamış</span><button className="button button--secondary" onClick={() => { setLoading(true);setVersion((value) => value+1) }}>Yenile</button></div>
    {error && <p role="alert">{error}</p>}
    {loading ? <p role="status">Bildirimler yükleniyor…</p> : !error && <>
      <div className="notification-list" role="list">{data?.notifications.map((item) => <article className={`notification-item${item.readAt ? ' is-read' : ''}`} key={item.id} role="listitem">
        <div className="notification-item__main"><span><strong>{item.title}</strong><small>{item.kind === 'document' ? 'Evrak' : 'Tramer'} · <time dateTime={item.createdAt}>{date.format(new Date(item.createdAt))}</time></small></span></div>
        <Link className="notification-item__case" to={`/dosyalar/${item.caseId}`}><strong>{item.plate}</strong><small>{item.officeNumber}</small></Link>
        {!item.readAt && <button className="button button--secondary" disabled={saving !== null} onClick={() => { void markRead(item.id) }}>{saving === item.id ? 'Kaydediliyor…' : 'Okundu'}</button>}
      </article>)}</div>
      {data?.notifications.length === 0 && <p role="status">Bildirim yok.</p>}
      <div className="table-footer"><span>{data?.total ?? 0} bildirim · Sayfa {page}</span><button className="button button--secondary" disabled={page <= 1} onClick={() => { setLoading(true);setPage(page-1) }}>Önceki</button><button className="button button--secondary" disabled={page*50 >= (data?.total ?? 0)} onClick={() => { setLoading(true);setPage(page+1) }}>Sonraki</button></div>
    </>}
  </section>
}
