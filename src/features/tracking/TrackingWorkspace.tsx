import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { canonicalDocumentTypeSchema, type TrackingSnapshot } from '@hasarbotu/contracts'
import { commandTramer, loadTracking, trackingRequest } from './trackingApi'
import { GoogleConnectButton } from './GoogleConnectButton'
import './tracking.css'

const statuses = { entry_pending: 'Giriş bekleniyor',result_pending: 'Sonuç bekleniyor',completed: 'Tamamlandı',cancelled: 'İptal edildi' }
const connectionStatuses = { connected: 'Bağlı',disconnected: 'Bağlantı kesildi',permission_required: 'Yeniden izin gerekiyor',error: 'Bağlantı hatası' }
const reasons: Record<string,string> = { untrusted_sender: 'Gönderen doğrulanamadı',ambiguous_number: 'Başvuru numarası belirsiz',ambiguous_result: 'Sonuç belirsiz',unmatched_number: 'Numara eşleşmedi',parser_not_validated: 'Gerçek e-posta doğrulaması bekleniyor',conflicting_or_terminal_result: 'Sonuç mevcut durumla çelişiyor' }
const historyLabels: Record<string,string> = { tramer_assigned: 'Tramer sorumlusu atandı',tramer_number_saved: 'Başvuru numarası kaydedildi',tramer_cancelled: 'Tramer iptal edildi',document_observed: 'Evrak değişikliği algılandı',document_reviewed: 'Evrak kontrol edildi',document_missing: 'Evrak klasörde bulunamadı',sbm_result: 'SBM sonucu işlendi',sbm_duplicate: 'Mükerrer SBM sonucu alındı' }
const detailLabels: Record<string,string> = { applicationNumber: 'Başvuru numarası',sourceAccount: 'Sonucun geldiği hesap',previousStatus: 'Önceki durum',status: 'Yeni durum',resultText: 'Sonuç',fileName: 'Evrak',note: 'Kontrol notu',reason: 'Gerekçe' }
const valueLabels: Record<string,string> = { ...statuses,pending: 'Kontrol bekliyor',approved: 'Onaylandı',rejected: 'Reddedildi' }
const displayValue = (value: unknown) => valueLabels[String(value)] ?? String(value ?? '—')
const documentLabels: Record<string,string> = { victim_traffic_policy: 'Mağdur trafik poliçesi',insured_traffic_policy: 'Sigortalı trafik poliçesi',sbm_heavy_damage_result: 'SBM ağır hasar sonucu',victim_registration: 'Mağdur ruhsat',insured_registration: 'Sigortalı ruhsat',victim_driver_license: 'Mağdur ehliyet',insured_driver_license: 'Sigortalı ehliyet',casco_policy: 'Kasko poliçesi',casco_vehicle_registration: 'Kasko ruhsat',casco_driver_license: 'Kasko ehliyet',accident_report: 'Zabıt',ktt: 'Kaza tespit tutanağı',statement: 'Beyan',tramer_result: 'Tramer sonucu',opposing_vehicle_registration: 'Karşı araç ruhsat',opposing_driver_license: 'Karşı sürücü ehliyet',opposing_traffic_policy: 'Karşı araç trafik poliçesi',fault_ratio: 'Kusur oranı' }
type Run = (work: () => Promise<unknown>) => Promise<void>
function CaseLink({ row }: { row: { caseId: string;plate: string;officeNumber: string } }) {
  return <Link to={`/dosyalar/${row.caseId}`}>{row.plate} · {row.officeNumber}</Link>
}

function TramerRow({ item,run,busy }: { item: TrackingSnapshot['tramer'][number];run: Run;busy: boolean }) {
  const [number,setNumber] = useState('')
  const [reason,setReason] = useState('')
  return <article className="tracking-row">
    <CaseLink row={item} /><strong>{statuses[item.status]}</strong><span>Tramer sorumlusu: {item.assignedName}</span>
    {item.applicationNumber && <code>{item.applicationNumber}</code>}{item.resultText && <p>{item.resultText}</p>}
    {item.canEdit && item.status === 'entry_pending' && <form onSubmit={(e) => { e.preventDefault();void run(() => commandTramer(item.caseId,{ action: 'number',applicationNumber: number,expectedVersion: item.version })) }}>
      <label>SBM başvuru numarası<input type="text" inputMode="numeric" pattern="[0-9]{1,128}" maxLength={128} value={number} onChange={(e) => setNumber(e.target.value)} required /></label>
      <button className="button button--primary" disabled={busy}>Numarayı kaydet</button>
    </form>}
    {item.canEdit && (item.status === 'entry_pending' || item.status === 'result_pending') && <form onSubmit={(e) => { e.preventDefault();void run(() => commandTramer(item.caseId,{ action: 'cancel',reason,expectedVersion: item.version })) }}>
      <label>İptal gerekçesi<input value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={2000} /></label><button className="button button--secondary" disabled={busy}>Tramer işlemini iptal et</button>
    </form>}
  </article>
}

function DocumentRow({ item,run,busy }: { item: TrackingSnapshot['documents'][number];run: Run;busy: boolean }) {
  const [type,setType] = useState(item.documentType ?? '')
  const [note,setNote] = useState('')
  return <article className="tracking-row"><CaseLink row={item} /><strong>{item.fileName}</strong><small>{item.relativePath}</small>
    <span>{item.status === 'pending' ? 'Sorumlu kontrolü bekleniyor' : item.status === 'approved' ? 'Sorumlu onayladı' : 'Reddedildi'}</span>
    {item.canReview && <><label>Evrak türü<select value={type} onChange={(e) => setType(e.target.value)}><option value="">Evrak türünü seçin</option>{canonicalDocumentTypeSchema.options.map((t) => <option key={t} value={t}>{documentLabels[t] ?? t}</option>)}</select></label>
      <label>Kontrol notu<input value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} /></label>
      <div className="tracking-actions">{(['approved','rejected'] as const).map((status) => <button key={status} className="button button--secondary" disabled={busy || !type} onClick={() => { void run(() => trackingRequest(`tracking/documents/${item.id}/review`,{ status,documentType: type,note })) }}>{status === 'approved' ? 'Kontrol ettim, uygun' : 'Uygun değil'}</button>)}</div>
    </>}
  </article>
}

function ReviewRow({ item,run,busy }: { item: TrackingSnapshot['reviews'][number];run: Run;busy: boolean }) {
  const [number,setNumber] = useState(item.applicationNumber ?? '')
  const [resultStatus,setStatus] = useState<'completed' | 'cancelled'>('completed')
  const [note,setNote] = useState('')
  return <article className="tracking-row"><strong>{reasons[item.reason] ?? item.reason}</strong><span>Sonucun geldiği hesap: {item.email}</span><p>{item.resultText}</p>
    <label>Kontrol edilen başvuru numarası<input type="text" inputMode="numeric" value={number} maxLength={128} onChange={(e) => setNumber(e.target.value)} /></label>
    <label>Doğrulanan sonuç<select value={resultStatus} onChange={(e) => setStatus(e.target.value as 'completed' | 'cancelled')}><option value="completed">Tamamlandı</option><option value="cancelled">İptal edildi</option></select></label>
    <label>Sonuç ve kontrol gerekçesi<textarea value={note} maxLength={4000} onChange={(e) => setNote(e.target.value)} /></label>
    <div className="tracking-actions">{(['apply','dismiss'] as const).map((action) => <button key={action} className="button button--secondary" disabled={busy || (action === 'apply' && !/^[0-9]{1,128}$/.test(number)) || !note.trim()} onClick={() => { void run(() => trackingRequest(`tracking/sbm/${item.id}/review`,action === 'dismiss' ? { action,note } : { action,applicationNumber: number,resultStatus,note })) }}>{action === 'apply' ? 'Doğruladığım sonucu uygula' : 'İşlemeden kapat'}</button>)}</div>
  </article>
}

export function TrackingWorkspace({ caseId }: { caseId?: string }) {
  const [data,setData] = useState<TrackingSnapshot | null>(null)
  const [error,setError] = useState('')
  const [busy,setBusy] = useState(false)
  const [assignee,setAssignee] = useState('')
  const [unreadOnly,setUnreadOnly] = useState(true)
  const reload = useCallback(async () => { setData(await loadTracking(caseId)) },[caseId])
  useEffect(() => {
    const controller = new AbortController()
    void loadTracking(caseId,controller.signal).then(setData).catch((e: unknown) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Takip yüklenemedi.') })
    return () => controller.abort()
  },[caseId])
  const run: Run = async (work) => {
    if (busy) return
    setBusy(true);setError('')
    try { await work();await reload();window.dispatchEvent(new Event('tracking-updated')) }
    catch (e) { setError(e instanceof Error ? e.message : 'İşlem tamamlanamadı.') }
    finally { setBusy(false) }
  }
  const onConnected = useCallback(() => { void reload().catch(() => setError('Bağlantı listesi yenilenemedi.')) },[reload])
  return <section className="tracking-workspace" aria-label="Evrak ve Tramer takibi">
    <div className="tracking-actions"><h2>Evrak ve Tramer takibi</h2><button className="button button--secondary" disabled={busy} onClick={() => { void run(reload) }}>Yenile</button></div>
    {error && <p role="alert">{error}</p>}{!data && !error && <p role="status">Takip yükleniyor…</p>}
    {data && <>
      <details open><summary>{caseId ? 'Tramer işlemleri' : 'Bana atanan bekleyen Tramer işleri'} ({data.tramer.length})</summary>
        {caseId && data.canManage && <form onSubmit={(e) => { e.preventDefault();void run(() => commandTramer(caseId,{ action: 'assign',assignedUserId: assignee })) }}>
          <label>Tramer sorumlusu<select required value={assignee} onChange={(e) => setAssignee(e.target.value)}><option value="">Çalışan seçin</option>{data.users.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}</select></label>
          <button className="button button--primary" disabled={busy}>Tramer sorumlusunu ata</button>
        </form>}
        {data.tramer.map((item) => <TramerRow key={`${item.id}:${item.version}`} item={item} run={run} busy={busy} />)}
        {!data.tramer.length && <p>Tramer işi bulunmuyor.</p>}
      </details>
      <details open><summary>{caseId ? 'Klasörde algılanan evraklar' : 'Kontrolümü bekleyen evraklar'} ({data.documents.length})</summary><p>Evrakın eklenmesi eksikliği kapatmaz. Dosya sorumlusu içeriği kontrol edip onaylamalıdır.</p>
        {data.documents.map((item) => <DocumentRow key={`${item.id}:${item.status}`} item={item} run={run} busy={busy} />)}{!data.documents.length && <p>Kontrol kaydı bulunmuyor.</p>}
      </details>
      <details open><summary>Kalıcı bildirimler ({data.notifications.filter((n) => !n.readAt).length} okunmamış)</summary>
        <label><input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Yalnız okunmamış</label>
        {data.notifications.filter((n) => !unreadOnly || !n.readAt).map((n) => <article className="tracking-row" key={n.id}><CaseLink row={n} /><strong>{n.title}</strong><time>{new Date(n.createdAt).toLocaleString('tr-TR')}</time>{!n.readAt && <button className="button button--secondary" disabled={busy} onClick={() => { void run(() => trackingRequest(`tracking/notifications/${n.id}/read`,{})) }}>Okundu işaretle</button>}</article>)}
      </details>
      {!caseId && <details><summary>SBM e-posta bağlantıları ve sonuç kontrolü</summary>
        <p>Merkezi takip: {data.services.length === 0 ? 'Henüz servis taraması kaydedilmemiş.' : ''}</p>
        {data.services.map((s,index) => <p key={`${s.kind}:${index}`}>{s.kind === 'folder' ? 'Klasör takibi' : 'E-posta takibi'}: {s.status === 'running' ? 'Çalışıyor' : s.status === 'stale' ? 'Servisten güncel yanıt alınamıyor' : 'Son tarama tamamlanamadı'} · Son başarılı tarama: {s.lastSuccessAt ? new Date(s.lastSuccessAt).toLocaleString('tr-TR') : 'Henüz yok'}</p>)}
        {!data.automaticSbmEnabled && <p>Otomatik sonuç işleme henüz etkin değil. Gelen sonuçlar insan kontrolüne alınır.</p>}
        {data.canManage && <GoogleConnectButton purpose="mail" onComplete={onConnected} />}
        {data.mailConnections.map((c) => <article key={c.id} className="tracking-row"><strong>{c.email}</strong><span>{connectionStatuses[c.status]}</span><small>Son başarılı tarama: {c.lastSuccessAt ? new Date(c.lastSuccessAt).toLocaleString('tr-TR') : 'Henüz yok'}</small>{c.lastError && <p>{c.lastError}</p>}{data.canManage && c.status !== 'disconnected' && <button className="button button--secondary" disabled={busy} onClick={() => { void run(() => trackingRequest(`tracking/mail/${c.id}/disconnect`,{})) }}>Takip bağlantısını kes</button>}</article>)}
        {data.reviews.map((item) => <ReviewRow key={item.id} item={item} run={run} busy={busy} />)}
      </details>}
      {caseId && <details><summary>Takip işlem geçmişi ({data.history.length})</summary>{data.history.map((h) => <article className="tracking-row" key={h.id}><strong>{historyLabels[h.action.replace('tracking.','')] ?? 'Takip işlemi'}</strong><span>{h.actor ?? 'Merkezi servis'} · {new Date(h.occurredAt).toLocaleString('tr-TR')}</span><dl>{Object.entries(h.details).filter(([key]) => key in detailLabels).map(([key,value]) => <div key={key}><dt>{detailLabels[key]}</dt><dd>{displayValue(value)}</dd></div>)}</dl></article>)}</details>}
    </>}
  </section>
}
