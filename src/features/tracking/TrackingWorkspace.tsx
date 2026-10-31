import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { trackedDocumentTypeSchema, TRACKED_DOCUMENT_LABELS, type TrackingSnapshot } from '@hasarbotu/contracts'
import { commandTramer, loadTracking, trackingRequest } from './trackingApi'
import { GoogleConnectButton } from './GoogleConnectButton'
import { TrackingOperations } from './TrackingOperations'
import { sbmReasons as reasons,trackingTime,tramerStatuses as statuses } from './tracking-labels'
import './tracking.css'

const connectionStatuses = { connected: 'Bağlı',disconnected: 'Bağlantı kesildi',permission_required: 'Yeniden izin gerekiyor',error: 'Bağlantı hatası' }
const historyLabels: Record<string,string> = { tramer_assigned: 'Tramer sorumlusu atandı',tramer_number_saved: 'Başvuru numarası kaydedildi',tramer_cancelled: 'Tramer iptal edildi',document_observed: 'Evrak değişikliği algılandı',document_reviewed: 'Evrak kontrol edildi',document_missing: 'Evrak klasörde bulunamadı',sbm_result: 'SBM sonucu işlendi',sbm_duplicate: 'Mükerrer SBM sonucu alındı' }
const detailLabels: Record<string,string> = { applicationNumber: 'Başvuru numarası',sourceAccount: 'Sonucun geldiği hesap',previousStatus: 'Önceki durum',status: 'Yeni durum',resultText: 'Sonuç',fileName: 'Evrak',note: 'Kontrol notu',reason: 'Gerekçe' }
const valueLabels: Record<string,string> = { ...statuses,pending: 'Kontrol bekliyor',approved: 'Onaylandı',rejected: 'Reddedildi' }
const displayValue = (value: unknown) => valueLabels[String(value)] ?? String(value ?? '—')
type Run = (work?: () => Promise<unknown>) => Promise<void>
type DocumentDraft = { documentType: string;note: string }
type TramerDraft = { number: string;reason: string }
type ReviewDraft = { number: string;resultStatus: 'completed' | 'cancelled' | '';note: string }
function CaseLink({ row }: { row: { caseId: string;plate: string;officeNumber: string } }) {
  return <Link to={`/dosyalar/${row.caseId}`}>{row.plate} · {row.officeNumber}</Link>
}

function TramerRow({ item,run,busy,drafts }: { item: TrackingSnapshot['tramer'][number];run: Run;busy: boolean;drafts: Map<string,TramerDraft> }) {
  const [number,setNumber] = useState(() => drafts.get(item.id)?.number ?? '')
  const [reason,setReason] = useState(() => drafts.get(item.id)?.reason ?? '')
  return <article className="tracking-row">
    <CaseLink row={item} /><span>Tramer sorumlusu: {item.assignedName}</span><small>Son güncelleme: {trackingTime(item.updatedAt)}</small>
    {item.applicationNumber && <code>{item.applicationNumber}</code>}{item.resultText && <p>{item.resultText}</p>}
    {item.canEdit && item.status === 'entry_pending' && <form onSubmit={(e) => { e.preventDefault();void run(async () => { await commandTramer(item.caseId,{ action: 'number',applicationNumber: number,expectedVersion: item.version });drafts.delete(item.id) }) }}>
      <label>SBM başvuru numarası<input type="text" inputMode="numeric" pattern="[0-9]{1,128}" maxLength={128} value={number} disabled={busy} onChange={(e) => { setNumber(e.target.value);drafts.set(item.id,{ number: e.target.value,reason }) }} required /></label>
      <button className="button button--primary" disabled={busy}>Numarayı kaydet</button>
    </form>}
    {item.canEdit && (item.status === 'entry_pending' || item.status === 'result_pending') && <details className="tracking-cancel"><summary>İşlemi iptal et</summary><p>HasarBotu takip kaydını kapatır. SBM sistemine iptal gönderilmez.</p><form onSubmit={(e) => { e.preventDefault();void run(async () => { await commandTramer(item.caseId,{ action: 'cancel',reason,expectedVersion: item.version });drafts.delete(item.id) }) }}>
      <label>İptal gerekçesi<input value={reason} disabled={busy} onChange={(e) => { setReason(e.target.value);drafts.set(item.id,{ number,reason: e.target.value }) }} required maxLength={2000} /></label><button className="button button--secondary" disabled={busy}>Tramer işlemini iptal et</button>
    </form></details>}
  </article>
}

function DocumentRow({ item,run,busy,showCaseLink,getDraft,onDraftChange }: { item: TrackingSnapshot['documents'][number];run: Run;busy: boolean;showCaseLink: boolean;getDraft: (id: string) => DocumentDraft | undefined;onDraftChange: (id: string,draft: DocumentDraft) => void }) {
  const [type,setType] = useState(() => getDraft(item.id)?.documentType ?? item.documentType ?? 'other_document')
  const [editing,setEditing] = useState(false)
  const [note,setNote] = useState(() => getDraft(item.id)?.note ?? '')
  return <article className="tracking-row tracking-document-row">
    <div className="tracking-document-row__identity">{showCaseLink && <CaseLink row={item} />}<strong title={item.relativePath}>{item.fileName}</strong><span>{TRACKED_DOCUMENT_LABELS[type as keyof typeof TRACKED_DOCUMENT_LABELS] ?? type}</span></div>
    <span className="tracking-document-row__status">{item.status === 'pending' ? 'Kontrol bekliyor' : item.status === 'approved' ? 'Onaylandı' : 'Reddedildi'}</span>
    {item.canReview && <><div className="tracking-actions">{(['approved','rejected'] as const).map((status) => <button key={status} className="button button--secondary" disabled={busy || !type} onClick={() => { void run(() => trackingRequest(`tracking/documents/${item.id}/review`,{ status,documentType: type,note })) }}>{status === 'approved' ? 'Kontrol ettim, uygun' : 'Uygun değil'}</button>)}<button className="text-button" type="button" disabled={busy} onClick={() => setEditing(value => !value)} aria-expanded={editing}>Türü düzelt / not ekle</button></div>
      {editing && <div className="tracking-document-row__edit"><small>{item.relativePath}</small><label>Evrak türü<select value={type} disabled={busy} onChange={(e) => { setType(e.target.value);onDraftChange(item.id,{ documentType: e.target.value,note }) }}>{trackedDocumentTypeSchema.options.map((t) => <option key={t} value={t}>{TRACKED_DOCUMENT_LABELS[t]}</option>)}</select></label>
      <label>Kontrol notu<input value={note} maxLength={2000} disabled={busy} onChange={(e) => { setNote(e.target.value);onDraftChange(item.id,{ documentType: type,note: e.target.value }) }} /></label></div>}
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
  const documentDrafts = useRef(new Map<string,DocumentDraft>())
  const tramerDrafts = useRef(new Map<string,TramerDraft>())
  const reviewDrafts = useRef(new Map<string,ReviewDraft>())
  const [bulkProgress,setBulkProgress] = useState<{ completed: number;total: number } | null>(null)
  const [notice,setNotice] = useState('')
  const [assignee,setAssignee] = useState('')
  const [unreadOnly,setUnreadOnly] = useState(true)
  const [documentLimit,setDocumentLimit] = useState(ROW_BATCH_SIZE)
  const [notificationLimit,setNotificationLimit] = useState(ROW_BATCH_SIZE)
  const visibleNotifications = data?.notifications.filter((n) => !unreadOnly || !n.readAt) ?? []
  const pendingDocuments = data?.documents.filter((item) => item.status === 'pending' && item.canReview) ?? []
  const reload = useCallback(async () => { setData(await loadTracking(caseId,undefined,view === 'center')) },[caseId,view])
  useEffect(() => {
    const pendingIds = new Set(data?.documents.filter((item) => item.status === 'pending' && item.canReview).map((item) => item.id))
    for (const id of documentDrafts.current.keys()) if (!pendingIds.has(id)) documentDrafts.current.delete(id)
  },[data])
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
    setBusy(true);setError('');setNotice('')
    try { if (work) await work() }
    catch (e) { setError(e instanceof Error ? e.message : 'İşlem tamamlanamadı.') }
    // A bulk operation can stop after some reviews have already been saved.
    try { await reload();window.dispatchEvent(new Event('tracking-updated')) }
    catch (e) { setError((previous) => `${previous ? `${previous} ` : ''}Liste yenilenemedi: ${e instanceof Error ? e.message : 'Takip servisine ulaşılamadı.'}`) }
    finally { busyRef.current = false;setBusy(false) }
  }
  const approveAll = () => {
    if (!pendingDocuments.length) return
    const reviews = pendingDocuments.map((item) => ({ id: item.id,...(documentDrafts.current.get(item.id) ?? { documentType: item.documentType ?? 'other_document',note: '' }) }))
    void run(async () => {
      let completed = 0
      setBulkProgress({ completed,total: reviews.length })
      try {
        // Each request retains the server's ownership, revision and audit checks.
        for (const { id,...draft } of reviews) {
          await trackingRequest(`tracking/documents/${id}/review`,{ status: 'approved',...draft })
          completed++
          setBulkProgress({ completed,total: reviews.length })
        }
        setNotice(`${completed} evrak uygun işaretlendi.`)
      } catch (e) {
        throw new Error(`Toplu işlem durdu. ${completed}/${reviews.length} evrak uygun işaretlendi. ${e instanceof Error ? e.message : 'İşlem tamamlanamadı.'}`,{ cause: e })
      } finally { setBulkProgress(null) }
    })
  }
  const onConnected = useCallback(() => { void reload().catch(() => setError('Bağlantı listesi yenilenemedi.')) },[reload])
  return <section className="tracking-workspace" aria-label="Evrak ve Tramer takibi">
    <div className="tracking-workspace__heading"><h2>{view === 'documents' ? 'Klasör evrakları ve fotoğraflar' : view === 'operations' ? 'Tramer işlemleri' : 'Tramer ve e-posta takibi'}</h2><button className="button button--secondary" disabled={busy} onClick={() => { void run() }}>{busy ? 'Güncelleniyor…' : 'Yenile'}</button></div>
    {error && <p role="alert">{error}</p>}{!data && !error && <p role="status">Takip yükleniyor…</p>}
    {(bulkProgress || notice) && <p role="status">{bulkProgress ? `Evraklar uygun işaretleniyor… (${bulkProgress.completed}/${bulkProgress.total})` : notice}</p>}
    {data && <>
      {view !== 'documents' && <>
        {caseId && data.canManage && <form onSubmit={(e) => { e.preventDefault();void run(() => commandTramer(caseId,{ action: 'assign',assignedUserId: assignee })) }}>
          <label>Tramer sorumlusu<select required value={assignee} onChange={(e) => setAssignee(e.target.value)}><option value="">Çalışan seçin</option>{data.users.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}</select></label>
          <button className="button button--primary" disabled={busy}>Tramer sorumlusunu ata</button>
        </form>}
        <TrackingOperations data={data} renderTramer={item => <TramerRow key={`${item.id}:${item.version}`} item={item} run={run} busy={busy} drafts={tramerDrafts.current} />} renderReview={item => <ReviewRow key={item.id} item={item} run={run} busy={busy} drafts={reviewDrafts.current} />} />
      </>}
      {view !== 'operations' && <details open={view !== 'center'}><summary>{caseId ? 'Klasörde algılanan evraklar' : 'Kontrolümü bekleyen evraklar'} ({data.documents.length})</summary><p>Tür, dosya ve alt klasör adından belirlenir; gerekirse düzeltebilirsiniz. İçerik kontrolünden sonra onaylayın.</p>
        {!caseId && pendingDocuments.length > 0 && <div className="tracking-actions"><button type="button" className="button button--primary" disabled={busy} onClick={approveAll}>Hepsini uygun işaretle ({pendingDocuments.length})</button></div>}
        {data.documents.slice(0,documentLimit).map((item) => <DocumentRow key={`${item.id}:${item.status}`} item={item} run={run} busy={busy} showCaseLink={!caseId} getDraft={(id) => documentDrafts.current.get(id)} onDraftChange={(id,draft) => { documentDrafts.current.set(id,draft) }} />)}{!data.documents.length && <p>Kontrol kaydı bulunmuyor.</p>}
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
      {caseId && view !== 'documents' && <details><summary>Takip işlem geçmişi ({data.history.length})</summary>{data.history.map((h) => <article className="tracking-row" key={h.id}><strong>{historyLabels[h.action.replace('tracking.','')] ?? 'Takip işlemi'}</strong><span>{h.actor ?? 'Merkezi servis'} · {new Date(h.occurredAt).toLocaleString('tr-TR')}</span><dl>{Object.entries(h.details).filter(([key]) => key in detailLabels).map(([key,value]) => <div key={key}><dt>{detailLabels[key]}</dt><dd>{displayValue(value)}</dd></div>)}</dl></article>)}</details>}
    </>}
  </section>
}
