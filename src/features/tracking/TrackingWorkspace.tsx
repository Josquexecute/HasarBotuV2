import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { trackedDocumentTypeSchema, TRACKED_DOCUMENT_LABELS, type TrackingSnapshot } from '@hasarbotu/contracts'
import { commandTramer, loadTracking, trackingRequest } from './trackingApi'
import { GoogleConnectButton } from './GoogleConnectButton'
import { TrackingOperations } from './TrackingOperations'
import { sbmReasons as reasons,trackingTime,tramerStatuses as statuses } from './tracking-labels'
import './tracking.css'

const connectionStatuses = { connected: 'Bağlı',disconnected: 'Bağlantı kesildi',permission_required: 'Yeniden izin gerekiyor',error: 'Bağlantı hatası' }
const documentTypeLabels: Readonly<Partial<Record<string, string>>> = TRACKED_DOCUMENT_LABELS
const historyLabels: Record<string,string> = { tramer_assigned: 'Tramer sorumlusu atandı',tramer_number_saved: 'Başvuru numarası kaydedildi',tramer_cancelled: 'Tramer iptal edildi',document_observed: 'Evrak değişikliği algılandı',document_classified: 'Evrak türü kaydedildi',document_reviewed: 'Evrak kontrol edildi',document_missing: 'Evrak klasörde bulunamadı',sbm_result: 'SBM sonucu işlendi',sbm_duplicate: 'Mükerrer SBM sonucu alındı' }
const detailLabels: Record<string,string> = { applicationNumber: 'Başvuru numarası',sourceAccount: 'Sonucun geldiği hesap',previousStatus: 'Önceki durum',status: 'Yeni durum',resultText: 'Sonuç',fileName: 'Evrak',documentType: 'Evrak türü',note: 'Kontrol notu',reason: 'Gerekçe' }
const valueLabels: Record<string,string> = { ...statuses,...TRACKED_DOCUMENT_LABELS,pending: 'Kontrol bekliyor',approved: 'Onaylandı',rejected: 'Reddedildi' }
const displayValue = (value: unknown) => valueLabels[String(value)] ?? String(value ?? '—')
type Run = (work?: () => Promise<unknown>) => Promise<void>
type TramerDraft = { number: string;reason: string }
type ReviewDraft = { number: string;resultStatus: 'completed' | 'cancelled' | '';note: string }
function CaseLink({ row }: { row: { caseId: string;plate: string;officeNumber: string } }) {
  return <Link to={`/dosyalar/${row.caseId}`}>{row.plate} · {row.officeNumber}</Link>
}

function TramerRow({ item,run,busy,drafts,showCaseLink }: { item: TrackingSnapshot['tramer'][number];run: Run;busy: boolean;drafts: Map<string,TramerDraft>;showCaseLink: boolean }) {
  const [number,setNumber] = useState(() => drafts.get(item.id)?.number ?? '')
  const [reason,setReason] = useState(() => drafts.get(item.id)?.reason ?? '')
  return <article className="tracking-row">
    {showCaseLink ? <>
      <CaseLink row={item} /><span>Tramer sorumlusu: {item.assignedName}</span><small>Son güncelleme: {trackingTime(item.updatedAt)}</small>
      {item.applicationNumber && <code>{item.applicationNumber}</code>}
    </> : <div className="tracking-tramer-meta">
      <span>Tramer sorumlusu: {item.assignedName}</span>{item.applicationNumber && <code>{item.applicationNumber}</code>}<time dateTime={item.updatedAt} title="Son güncelleme">{trackingTime(item.updatedAt)}</time>
    </div>}
    {item.resultText && <p>{item.resultText}</p>}
    {item.canEdit && item.status === 'entry_pending' && <form onSubmit={(e) => { e.preventDefault();void run(async () => { await commandTramer(item.caseId,{ action: 'number',applicationNumber: number,expectedVersion: item.version });drafts.delete(item.id) }) }}>
      <label>SBM başvuru numarası<input type="text" inputMode="numeric" pattern="[0-9]{1,128}" maxLength={128} value={number} disabled={busy} onChange={(e) => { setNumber(e.target.value);drafts.set(item.id,{ number: e.target.value,reason }) }} required /></label>
      <button className="button button--primary" disabled={busy}>Numarayı kaydet</button>
    </form>}
    {item.canEdit && (item.status === 'entry_pending' || item.status === 'result_pending') && <details className="tracking-cancel"><summary>İşlemi iptal et</summary><p>HasarBotu takip kaydını kapatır. SBM sistemine iptal gönderilmez.</p><form onSubmit={(e) => { e.preventDefault();void run(async () => { await commandTramer(item.caseId,{ action: 'cancel',reason,expectedVersion: item.version });drafts.delete(item.id) }) }}>
      <label>İptal gerekçesi<input value={reason} disabled={busy} onChange={(e) => { setReason(e.target.value);drafts.set(item.id,{ number,reason: e.target.value }) }} required maxLength={2000} /></label><button className="button button--secondary" disabled={busy}>Tramer işlemini iptal et</button>
    </form></details>}
  </article>
}

function DocumentRow({ item, run, busy, showCaseLink }: {
  item: TrackingSnapshot['documents'][number]
  run: Run
  busy: boolean
  showCaseLink: boolean
}) {
  const [draft, setDraft] = useState(item.documentType ?? 'other_document')
  const [editing, setEditing] = useState(false)
  return <article className="tracking-row tracking-document-row">
    <div className="tracking-document-row__identity">
      {showCaseLink && <CaseLink row={item} />}
      <strong title={item.relativePath}>{item.fileName}</strong>
      {item.documentType && <span>{documentTypeLabels[item.documentType] ?? item.documentType}</span>}
    </div>
    {item.canReview && <>
      <button className="text-button" type="button" disabled={busy} aria-expanded={editing} onClick={() => {
        setDraft(item.documentType ?? 'other_document')
        setEditing(value => !value)
      }}>Evrak türünü düzenle</button>
      {editing && <form className="tracking-document-row__edit" onSubmit={(event) => {
        event.preventDefault()
        void run(async () => {
          await trackingRequest(`tracking/documents/${encodeURIComponent(item.id)}/classify`, { documentType: draft })
          setEditing(false)
        })
      }}>
        <label>Evrak türü<select value={draft} disabled={busy} onChange={event => setDraft(trackedDocumentTypeSchema.parse(event.target.value))}>
          {trackedDocumentTypeSchema.options.map(type => <option key={type} value={type}>{TRACKED_DOCUMENT_LABELS[type]}</option>)}
        </select></label>
        <button className="button button--secondary" disabled={busy}>Türü kaydet</button>
      </form>}
    </>}
  </article>
}

function ReviewRow({ item,run,busy,drafts }: { item: TrackingSnapshot['reviews'][number];run: Run;busy: boolean;drafts: Map<string,ReviewDraft> }) {
  const [number,setNumber] = useState(() => drafts.get(item.id)?.number ?? item.applicationNumber ?? '')
  const [resultStatus,setStatus] = useState<ReviewDraft['resultStatus']>(() => drafts.get(item.id)?.resultStatus ?? item.resultStatus ?? '')
  const [note,setNote] = useState(() => drafts.get(item.id)?.note ?? '')
  return <article className="tracking-row"><strong>{reasons[item.reason] ?? 'Kontrol gerekiyor'}</strong><span>Sonucun geldiği hesap: {item.email}</span><small>Alınma: {trackingTime(item.receivedAt)}</small>
    {item.caseId && <Link to={`/dosyalar/${item.caseId}`}>{item.plate} · {item.officeNumber}</Link>}
    <details className="tracking-raw"><summary>E-posta içeriğini göster</summary><p>{item.resultText ?? 'Kaydedilmiş metin bulunmuyor.'}</p></details>
    <label>Kontrol edilen başvuru numarası<input type="text" inputMode="numeric" value={number} disabled={busy} maxLength={128} onChange={(e) => { setNumber(e.target.value);drafts.set(item.id,{ number: e.target.value,resultStatus,note }) }} /></label>
    <label>Doğrulanan sonuç<select value={resultStatus} disabled={busy} onChange={(e) => { const value = e.target.value as ReviewDraft['resultStatus'];setStatus(value);drafts.set(item.id,{ number,resultStatus: value,note }) }}><option value="">Sonucu seçin</option><option value="completed">Tamamlandı</option><option value="cancelled">İptal edildi</option></select></label>
    <label>Sonuç ve kontrol gerekçesi<textarea value={note} disabled={busy} maxLength={4000} onChange={(e) => { setNote(e.target.value);drafts.set(item.id,{ number,resultStatus,note: e.target.value }) }} /></label>
    <div className="tracking-actions">{(['apply','dismiss'] as const).map((action) => <button key={action} className="button button--secondary" disabled={busy || (action === 'apply' && (!/^[0-9]{1,128}$/.test(number) || !resultStatus)) || !note.trim()} onClick={() => { void run(async () => { await trackingRequest(`tracking/sbm/${item.id}/review`,action === 'dismiss' ? { action,note } : { action,applicationNumber: number,resultStatus,note });drafts.delete(item.id) }) }}>{action === 'apply' ? 'Doğruladığım sonucu uygula' : 'İşlemeden kapat'}</button>)}</div>
  </article>
}

const ROW_BATCH_SIZE = 100

export function TrackingWorkspace({ caseId, view = 'all' }: { caseId?: string; view?: 'all' | 'operations' | 'documents' | 'center' }) {
  const [data,setData] = useState<TrackingSnapshot | null>(null)
  const [error,setError] = useState('')
  const [busy,setBusy] = useState(false)
  const busyRef = useRef(false)
  const tramerDrafts = useRef(new Map<string,TramerDraft>())
  const reviewDrafts = useRef(new Map<string,ReviewDraft>())
  const [assignee,setAssignee] = useState('')
  const [unreadOnly,setUnreadOnly] = useState(true)
  const [documentLimit,setDocumentLimit] = useState(ROW_BATCH_SIZE)
  const [notificationLimit,setNotificationLimit] = useState(ROW_BATCH_SIZE)
  const visibleNotifications = data?.notifications.filter((n) => !unreadOnly || !n.readAt) ?? []
  const reload = useCallback(async () => { setData(await loadTracking(caseId,undefined,view === 'center')) },[caseId,view])
  useEffect(() => {
    let controller: AbortController | undefined
    const refresh = () => {
      if (busyRef.current) return
      controller?.abort()
      controller = new AbortController()
      const { signal } = controller
      void loadTracking(caseId,signal,view === 'center').then((next) => { if (!signal.aborted && !busyRef.current) { setData(next);setError('') } })
        .catch((e: unknown) => { if (!signal.aborted && !busyRef.current) setError(e instanceof Error ? e.message : 'Takip yüklenemedi.') })
    }
    window.addEventListener('tracking-received',refresh)
    refresh()
    return () => { controller?.abort();window.removeEventListener('tracking-received',refresh) }
  },[caseId,view])
  const run: Run = async (work) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true);setError('')
    try { if (work) await work() }
    catch (e) { setError(e instanceof Error ? e.message : 'İşlem tamamlanamadı.') }
    try { await reload();window.dispatchEvent(new Event('tracking-updated')) }
    catch (e) { setError((previous) => `${previous ? `${previous} ` : ''}Liste yenilenemedi: ${e instanceof Error ? e.message : 'Takip servisine ulaşılamadı.'}`) }
    finally { busyRef.current = false;setBusy(false) }
  }
  const onConnected = useCallback(() => { void reload().catch(() => setError('Bağlantı listesi yenilenemedi.')) },[reload])
  const caseHistory = view === 'operations' && data
    ? [...new Map(data.history.filter(item => item.action !== 'tracking.sbm_duplicate')
      .map(item => [JSON.stringify([item.action, item.actor, item.occurredAt, item.details]), item])).values()]
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    : data?.history ?? []
  return <section className={`tracking-workspace${view === 'operations' ? ' tracking-workspace--case' : ''}`} aria-label="Evrak ve Tramer takibi">
    <div className="tracking-workspace__heading"><h2>{view === 'documents' ? 'Klasör Evrakları' : view === 'operations' ? 'Tramer işlemleri' : 'Tramer ve e-posta takibi'}</h2><button className="button button--secondary" disabled={busy} onClick={() => { void run() }}>{busy ? 'Güncelleniyor…' : 'Yenile'}</button></div>
    {error && <p role="alert">{error}</p>}{!data && !error && <p role="status">Takip yükleniyor…</p>}
    {data && <>
      {view !== 'documents' && <>
        {caseId && data.canManage && <details className="tracking-assign"><summary>Sorumlu ata</summary><form onSubmit={(e) => { e.preventDefault();void run(() => commandTramer(caseId,{ action: 'assign',assignedUserId: assignee })) }}>
          <label>Tramer sorumlusu<select required value={assignee} onChange={(e) => setAssignee(e.target.value)}><option value="">Çalışan seçin</option>{data.users.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}</select></label>
          <button className="button button--primary" disabled={busy}>Tramer sorumlusunu ata</button>
        </form></details>}
        <TrackingOperations data={data} compact={view === 'operations'} renderTramer={item => <TramerRow key={`${item.id}:${item.version}`} item={item} run={run} busy={busy} drafts={tramerDrafts.current} showCaseLink={view !== 'operations'} />} renderReview={item => <ReviewRow key={item.id} item={item} run={run} busy={busy} drafts={reviewDrafts.current} />} />
      </>}
      {view !== 'operations' && <details open={view !== 'center'}><summary>Klasörde algılanan evraklar ({data.documents.length})</summary>
        {data.documents.slice(0,documentLimit).map((item) => <DocumentRow key={item.id} item={item} run={run} busy={busy} showCaseLink={!caseId} />)}
        {!data.documents.length && <p>Henüz evrak algılanmadı.</p>}
        {data.documents.length > documentLimit && <button className="button button--secondary" onClick={() => setDocumentLimit((limit) => limit+ROW_BATCH_SIZE)}>Daha fazla evrak göster ({data.documents.length-documentLimit} kalan)</button>}
      </details>}
      {view === 'all' && <details open={!caseId}><summary>Kalıcı bildirimler ({data.notifications.filter((n) => !n.readAt).length} okunmamış)</summary>
        <label><input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Yalnız okunmamış</label>
        {visibleNotifications.slice(0,notificationLimit).map((n) => <article className="tracking-row" key={n.id}><CaseLink row={n} /><strong>{n.title}</strong><time>{new Date(n.createdAt).toLocaleString('tr-TR')}</time>{!n.readAt && <button className="button button--secondary" disabled={busy} onClick={() => { void run(() => trackingRequest(`tracking/notifications/${n.id}/read`,{})) }}>Okundu işaretle</button>}</article>)}
        {visibleNotifications.length > notificationLimit && <button className="button button--secondary" onClick={() => setNotificationLimit((limit) => limit+ROW_BATCH_SIZE)}>Daha fazla bildirim göster ({visibleNotifications.length-notificationLimit} kalan)</button>}
      </details>}
      {!caseId && view !== 'documents' && <details className="tracking-connections"><summary>SBM e-posta bağlantıları · {data.mailConnections.filter(c => c.status === 'connected').length}/{data.mailConnections.length} bağlı hesap{data.mailConnections.some(c => c.status === 'error' || c.status === 'permission_required') ? ' · Bağlantı kontrolü gerekiyor' : ''}</summary>
        <p>Merkezi takip: {data.services.length === 0 ? 'Henüz servis taraması kaydedilmemiş.' : ''}</p>
        {data.services.map((s,index) => <p key={`${s.kind}:${index}`}>{s.kind === 'folder' ? 'Klasör takibi' : 'E-posta takibi'}: {s.status === 'running' ? 'Çalışıyor' : s.status === 'stale' ? 'Servisten güncel yanıt alınamıyor' : 'Son tarama tamamlanamadı'} · Son başarılı tarama: {s.lastSuccessAt ? new Date(s.lastSuccessAt).toLocaleString('tr-TR') : 'Henüz yok'}</p>)}
        {!data.automaticSbmEnabled && <p>Otomatik sonuç işleme henüz etkin değil. Gelen sonuçlar insan kontrolüne alınır.</p>}
        {data.canManage && <GoogleConnectButton purpose="mail" onComplete={onConnected} />}
        {data.mailConnections.map((c) => <article key={c.id} className="tracking-row"><strong>{c.email}</strong><span>{connectionStatuses[c.status]}</span><small>Son başarılı tarama: {c.lastSuccessAt ? new Date(c.lastSuccessAt).toLocaleString('tr-TR') : 'Henüz yok'}</small>{c.lastError && <p>{c.lastError}</p>}{data.canManage && c.status !== 'disconnected' && <button className="button button--secondary" disabled={busy} onClick={() => { void run(() => trackingRequest(`tracking/mail/${c.id}/disconnect`,{})) }}>Takip bağlantısını kes</button>}</article>)}
      </details>}
      {caseId && view !== 'documents' && <details><summary>Takip işlem geçmişi ({caseHistory.length})</summary>{caseHistory.map(h => {
        const fields = Object.entries(h.details).filter(([key, value]) => Object.hasOwn(detailLabels, key)
          && (view !== 'operations' || (value != null && value !== '' && !['previousStatus', 'status', 'sourceAccount'].includes(key))))
        return <article className="tracking-row tracking-history-row" key={h.id}>
          <strong>{historyLabels[h.action.replace('tracking.','')] ?? 'Takip işlemi'}</strong>
          <span>{h.actor ?? 'Merkezi servis'} · <time dateTime={h.occurredAt}>{view === 'operations' ? trackingTime(h.occurredAt) : new Date(h.occurredAt).toLocaleString('tr-TR')}</time></span>
          {fields.length > 0 && <dl>{fields.map(([key, value]) => <div key={key}><dt>{detailLabels[key]}</dt><dd>{displayValue(value)}</dd></div>)}</dl>}
        </article>
      })}</details>}
    </>}
  </section>
}
