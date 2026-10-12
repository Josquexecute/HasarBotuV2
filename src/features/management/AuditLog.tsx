import { useEffect, useState } from 'react'
import { auditEventsResponseSchema, type AuditEventsResponse } from '@hasarbotu/contracts'
import { useUsers } from '../../data/useUsers'
import { trackingRequest } from '../tracking/trackingApi'

const time = new Intl.DateTimeFormat('tr-TR',{ timeZone: 'Europe/Istanbul',dateStyle: 'short',timeStyle: 'medium' })
export function AuditLog() {
  const { items: users } = useUsers(true)
  const [actor,setActor] = useState('')
  const [action,setAction] = useState('')
  const [from,setFrom] = useState('')
  const [to,setTo] = useState('')
  const [query,setQuery] = useState('')
  const [page,setPage] = useState(1)
  const [data,setData] = useState<AuditEventsResponse | null>(null)
  const [error,setError] = useState('')
  const [loading,setLoading] = useState(true)
  const [refresh,setRefresh] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    void trackingRequest(`audit-events?page=${page}&pageSize=50${query}`,undefined,controller.signal)
      .then((response) => { if (!controller.signal.aborted) setData(auditEventsResponseSchema.parse(response)) })
      .catch((e: unknown) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'İşlem kayıtları alınamadı.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  },[page,query,refresh])
  function apply() {
    const params = new URLSearchParams()
    if (actor) params.set('actorUserId',actor)
    if (action.trim()) params.set('action',action.trim())
    if (from) params.set('occurredFrom',new Date(`${from}T00:00:00+03:00`).toISOString())
    if (to) params.set('occurredTo',new Date(`${to}T23:59:59.999+03:00`).toISOString())
    setLoading(true);setError('');setPage(1);setQuery(params.size ? `&${params}` : '');setRefresh((value) => value+1)
  }
  const names = new Map(users.map((user) => [user.id,user.displayName]))
  return <section className="office-table-panel" aria-label="İşlem kayıtları">
    <header className="panel-heading"><div><h2>İşlem kayıtları</h2><span>Tarih ve saat: Türkiye</span></div><button className="button button--secondary" onClick={apply}>Yenile</button></header>
    <form className="filterbar" onSubmit={(event) => { event.preventDefault();apply() }}>
      <label className="settings-field"><span>Kullanıcı</span><select value={actor} onChange={(event) => setActor(event.target.value)}><option value="">Tümü</option>{users.map((user) => <option key={user.id} value={user.id}>{user.displayName}</option>)}</select></label>
      <label className="settings-field"><span>İşlem kodu</span><input value={action} placeholder="Örn. case.created" onChange={(event) => setAction(event.target.value)} /></label>
      <label className="settings-field"><span>Başlangıç</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label className="settings-field"><span>Bitiş</span><input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label>
      <button className="button button--primary" type="submit">Filtrele</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {loading ? <p role="status">Kayıtlar yükleniyor…</p> : !error && <>
      <div className="table-scroll"><table className="data-table"><thead><tr><th>Tarih / saat</th><th>Kullanıcı</th><th>İşlem</th><th>Kayıt / ayrıntı</th></tr></thead>
        <tbody>{data?.items.map((item) => <tr key={item.id}><td><time dateTime={item.occurredAt}>{time.format(new Date(item.occurredAt))}</time></td>
          <td>{item.actorUserId ? names.get(item.actorUserId) ?? item.actorUserId : 'Sistem'}</td><td>{item.action}</td>
          <td><details><summary>{item.entityType ?? 'İstek'}{item.entityId ? ` · ${item.entityId}` : ''}</summary><pre className="audit-details">{JSON.stringify(item.details,null,2)}</pre></details></td></tr>)}</tbody></table></div>
      {data?.items.length === 0 && <p>Kayıt bulunamadı.</p>}
      <footer className="table-footer"><span>{data?.pageInfo.totalItems ?? 0} kayıt · Sayfa {page} / {Math.max(1,data?.pageInfo.totalPages ?? 1)}</span>
        <button className="button button--secondary" disabled={page <= 1} onClick={() => { setLoading(true);setPage(page-1) }}>Önceki</button>
        <button className="button button--secondary" disabled={page >= (data?.pageInfo.totalPages ?? 1)} onClick={() => { setLoading(true);setPage(page+1) }}>Sonraki</button></footer>
    </>}
  </section>
}
