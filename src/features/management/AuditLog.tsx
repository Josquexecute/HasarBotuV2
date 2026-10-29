import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ChevronDown, ChevronRight, FileText, History, RefreshCw, Search } from 'lucide-react'
import { AUDIT_CATEGORIES, AUDIT_RESULTS, auditCategory, auditEventsResponseSchema, auditResult, type AuditEvent, type AuditEventsResponse } from '@hasarbotu/contracts'
import { useSession } from '../../app/sessionContext'
import { useUsers } from '../../data/useUsers'
import { trackingRequest } from '../tracking/trackingApi'
import { auditChanges, auditFieldLabel, auditLabel, groupAuditEvents, safeTechnicalRecord } from './audit-display'
import './audit-log.css'

const time = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'short', timeStyle: 'medium' })
const entities: Record<string, string> = { case: 'Dosya', user: 'Kullanıcı', organization: 'Ofis', document: 'Belge', file_operation: 'Klasör işlemi', service: 'Servis', insurer: 'Sigorta şirketi' }

function AuditDetails({ item, canViewRaw }: { item: AuditEvent; canViewRaw: boolean }) {
  const changes = useMemo(() => auditChanges(item.details), [item.details])
  const [raw, setRaw] = useState(false)
  const changedFields = Array.isArray(item.details.changedFields) ? item.details.changedFields.filter((field): field is string => typeof field === 'string') : []
  return <div className="audit-detail">
    <h3>İşlem ayrıntıları</h3>
    {changes.length > 0 ? <table className="audit-changes"><thead><tr><th>Değiştirilen alan</th><th>Eski değer</th><th aria-label="Değişim" /><th>Yeni değer</th></tr></thead><tbody>{changes.map((change, index) => <tr key={index}><th scope="row">{change.field}</th><td>{change.before}</td><td aria-hidden="true">→</td><td>{change.after}</td></tr>)}</tbody></table> : <p>{changedFields.length > 0 ? `Değiştirilen alanlar: ${changedFields.map(auditFieldLabel).join(', ')}. Eski/yeni değerler bu kayıtta tutulmamış.` : 'Bu kayıtta eski/yeni değer bilgisi bulunmuyor.'}</p>}
    <dl className="audit-metadata"><div><dt>Kayıt kimliği</dt><dd>{item.id}</dd></div>{item.entityId && <div><dt>Hedef kimliği</dt><dd>{item.entityId}</dd></div>}{item.requestId && <div><dt>İstek kimliği</dt><dd>{item.requestId}</dd></div>}{typeof item.details.statusCode === 'number' && <div><dt>HTTP sonucu</dt><dd>{item.details.statusCode}</dd></div>}</dl>
    {canViewRaw && <><button type="button" className="button button--secondary" aria-expanded={raw} onClick={() => setRaw(!raw)}>Ham teknik kayıt</button>{raw && <pre className="audit-raw">{JSON.stringify(safeTechnicalRecord(item), null, 2)}</pre>}</>}
  </div>
}

export function AuditLog() {
  const { user } = useSession()
  const { items: users } = useUsers(true)
  const [actor, setActor] = useState(''), [action, setAction] = useState(''), [search, setSearch] = useState('')
  const [category, setCategory] = useState(''), [result, setResult] = useState(''), [sort, setSort] = useState('desc')
  const [from, setFrom] = useState(''), [to, setTo] = useState(''), [query, setQuery] = useState('')
  const [page, setPage] = useState(1), [data, setData] = useState<AuditEventsResponse | null>(null)
  const [error, setError] = useState(''), [loading, setLoading] = useState(true), [refresh, setRefresh] = useState(0)
  const [grouped, setGrouped] = useState(true), [expanded, setExpanded] = useState<string | null>(null)
  const canViewRaw = user?.roles.includes('admin') ?? false
  useEffect(() => {
    const controller = new AbortController()
    void trackingRequest(`audit-events?page=${page}&pageSize=50&presentation=readable${query}`, undefined, controller.signal)
      .then(response => { if (!controller.signal.aborted) setData(auditEventsResponseSchema.parse(response)) })
      .catch((e: unknown) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'İşlem kayıtları alınamadı.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [page, query, refresh])
  const names = useMemo(() => new Map(users.map(item => [item.id, item.displayName])), [users])
  const groups = useMemo(() => groupAuditEvents(data?.items ?? [], grouped), [data, grouped])
  function apply() {
    if (from && to && from > to) { setError('Bitiş tarihi başlangıçtan önce olamaz.'); return }
    const params = new URLSearchParams()
    if (actor) params.set('actorUserId', actor)
    if (action.trim()) params.set('action', action.trim())
    if (search.trim()) params.set('search', search.trim())
    if (category) params.set('category', category)
    if (result) params.set('result', result)
    if (sort !== 'desc') params.set('sort', sort)
    if (from) params.set('occurredFrom', new Date(`${from}T00:00:00+03:00`).toISOString())
    if (to) params.set('occurredTo', new Date(`${to}T23:59:59.999+03:00`).toISOString())
    setLoading(true); setError(''); setExpanded(null); setPage(1); setQuery(params.size ? `&${params}` : ''); setRefresh(value => value + 1)
  }
  function changePage(next: number) { setLoading(true); setError(''); setExpanded(null); setPage(next) }
  return <section className="office-table-panel audit-panel" aria-label="İşlem kayıtları">
    <header className="panel-heading audit-heading"><div className="audit-heading__title"><History size={21} /><div><h2>İşlem kayıtları</h2><span>Ofis işlem geçmişi · Türkiye saati</span></div></div><button type="button" className="button button--secondary" onClick={apply}><RefreshCw size={14} />Yenile</button></header>
    <form className="audit-filters" onSubmit={event => { event.preventDefault(); apply() }}>
      <label className="settings-field audit-search"><span><Search size={13} />Kayıtlarda ara</span><input value={search} maxLength={128} placeholder="İşlem, kullanıcı, plaka veya dosya numarası" onChange={event => setSearch(event.target.value)} /></label>
      <label className="settings-field"><span>Kullanıcı</span><select value={actor} onChange={event => setActor(event.target.value)}><option value="">Tüm kullanıcılar</option>{users.map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
      <label className="settings-field"><span>İşlem grubu</span><select value={category} onChange={event => setCategory(event.target.value)}><option value="">Tüm işlemler</option>{Object.entries(AUDIT_CATEGORIES).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>
      <label className="settings-field"><span>Sonuç</span><select value={result} onChange={event => setResult(event.target.value)}><option value="">Tüm sonuçlar</option>{Object.entries(AUDIT_RESULTS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>
      <label className="settings-field"><span>Başlangıç</span><input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label>
      <label className="settings-field"><span>Bitiş</span><input type="date" value={to} min={from} onChange={event => setTo(event.target.value)} /></label>
      <label className="settings-field"><span>Sıralama</span><select value={sort} onChange={event => setSort(event.target.value)}><option value="desc">En yeni önce</option><option value="asc">En eski önce</option></select></label>
      <button className="button button--primary" type="submit">Filtrele</button>
      {canViewRaw && <details className="audit-advanced"><summary>Teknik filtre</summary><label className="settings-field"><span>İşlem kodu</span><input value={action} maxLength={64} placeholder="Örn. case.updated" onChange={event => setAction(event.target.value)} /></label></details>}
    </form>
    <div className="audit-toolbar"><label><input type="checkbox" checked={grouped} onChange={event => { setGrouped(event.target.checked); setExpanded(null) }} />Tekrarlanan görüntülemeleri gruplandır</label><span>Yalnız bu sayfada · 1 dakika içinde · kayıtlar korunur</span></div>
    {error && <p className="audit-message" role="alert">{error}</p>}
    {loading ? <p className="audit-message" role="status">Kayıtlar yükleniyor…</p> : !error && <>
      <div className="table-scroll audit-scroll"><table className="data-table audit-table"><thead><tr><th scope="col">Tarih / saat</th><th scope="col">Kullanıcı</th><th scope="col">İşlem</th><th scope="col">İlgili kayıt</th><th scope="col">Sonuç</th><th scope="col"><span className="audit-visually-hidden">Ayrıntılar</span></th></tr></thead><tbody>{groups.map(group => {
        const item = group.item, isOpen = expanded === item.id, outcome = auditResult(item.action, item.details)
        const caseId = item.caseId ?? (item.entityType === 'case' ? item.entityId : null)
        const target = item.targetLabel ?? (item.entityId ? `${entities[item.entityType ?? ''] ?? 'Kayıt'} · ${item.entityId.slice(0, 8)}` : 'Genel işlem')
        return <Fragment key={item.id}><tr className={isOpen ? 'is-expanded' : ''}>
          <td><time dateTime={item.occurredAt}>{time.format(new Date(item.occurredAt))}</time></td>
          <td><span className="audit-actor">{item.actorName ?? (item.actorUserId ? names.get(item.actorUserId) ?? 'Eski / bilinmeyen kullanıcı' : 'Sistem')}</span></td>
          <td><strong>{auditLabel(item)}</strong><small>{AUDIT_CATEGORIES[auditCategory(item.action)]}{group.items.length > 1 && <span className="audit-count">{group.items.length} kayıt</span>}</small></td>
          <td>{caseId ? <Link className="audit-target" to={`/dosyalar/${encodeURIComponent(caseId)}`}><FileText size={13} />{target}</Link> : <span>{target}</span>}</td>
          <td><span className={`audit-result audit-result--${outcome}`}>{AUDIT_RESULTS[outcome]}</span></td>
          <td><button type="button" className="audit-expand" aria-label={`${auditLabel(item)} ayrıntıları`} aria-expanded={isOpen} aria-controls={`audit-${item.id}`} onClick={() => setExpanded(isOpen ? null : item.id)}>{isOpen ? <ChevronDown size={17} /> : <ChevronRight size={17} />}</button></td>
        </tr>{isOpen && <tr id={`audit-${item.id}`}><td colSpan={6}>{group.items.length > 1 && <p className="audit-group-note">Bu sayfada {group.items.length} aynı işlem gruplandı. Her kaydın özgün zamanı ve ayrıntısı aşağıdadır.</p>}{group.items.map(original => <div key={original.id}>{group.items.length > 1 && <time dateTime={original.occurredAt}>{time.format(new Date(original.occurredAt))}</time>}<AuditDetails item={original} canViewRaw={canViewRaw} /></div>)}</td></tr>}</Fragment>
      })}</tbody></table></div>
      {data?.items.length === 0 && <p className="audit-message">Kayıt bulunamadı.</p>}
      <footer className="table-footer"><span>{data?.pageInfo.totalItems ?? 0} kayıt · Sayfa {page} / {Math.max(1, data?.pageInfo.totalPages ?? 1)}</span><span>{data?.items.length ?? 0} kayıt · {groups.length} satır</span><button type="button" className="button button--secondary" disabled={page <= 1} onClick={() => changePage(page - 1)}>Önceki</button><button type="button" className="button button--secondary" disabled={page >= (data?.pageInfo.totalPages ?? 1)} onClick={() => changePage(page + 1)}>Sonraki</button></footer>
      <p className="audit-footnote">Kullanıcı ve dosya adları mevcut kayıtlardan gösterilir. Geçmiş değerler yalnız işlem sırasında kaydedildiyse sunulur.</p>
    </>}
  </section>
}
