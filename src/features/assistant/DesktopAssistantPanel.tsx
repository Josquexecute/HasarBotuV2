import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { Files, ListChecks, StickyNote } from 'lucide-react'
import { useSession } from '../../app/sessionContext'
import { rememberAssistantCase, useAssistantCaseSelection } from '../../app/assistantCaseSelection'
import { NOTE_SAVED_EVENT } from '../../app/activeCase'
import { QuickNoteEditor } from '../../components/TouchAssistant'
import { AssistantPlate } from '../../components/AssistantPlate'
import { OpenCaseFolderButton } from '../../components/OpenCaseFolderButton'
import { createHttpCasesAdapter, HttpCasesError } from '../../data/httpAdapter'
import { useCaseOperations } from '../../data/useCaseOperations'
import type { CasesDataPort, CasePageResult, CaseReferenceDataPort } from '../../data/ports'
import { useCaseReferences } from '../../data/useCaseReferences'
import type { CaseOperationsPort } from '../../data/caseOperationsPort'
import type { CaseRecord } from '../../types/case'
import type { TrackingSnapshot } from '@hasarbotu/contracts'
import { loadTracking } from '../tracking/trackingApi'
import './desktop-assistant-panel.css'
import { useAssistantAppearance } from './assistantAppearanceContext'
import { appearanceStyle } from './appearance'
import { TouchPlayControls } from './TouchPlayControls'
import { notificationDate, serviceMobile } from './caseSummary'
import { AssistantValueLoss } from './AssistantValueLoss'
import type { ValueLossCalculatorPort } from '../../data/valueLossCalculatorPort'
import { CaseFaultModule } from '../cases/CaseFaultModule'

type MenuAction = 'open' | 'notifications' | 'settings' | 'hide' | 'reset' | 'close'
type AssistantWindow = Window & { hasarbotuAssistantMenu?: { choose(action: MenuAction, caseId?: string): void } }
const choose = (action: MenuAction, caseId?: string) => (window as AssistantWindow).hasarbotuAssistantMenu?.choose(action, caseId)
const dateTime = (value: string | null) => value ? new Date(value).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }) : '—'

type AssistantTab = 'files' | 'note' | 'process'
const assistantTabs = [
  { id: 'files', label: 'Dosyalar', icon: Files },
  { id: 'note', label: 'Notlar', icon: StickyNote },
  { id: 'process', label: 'Süreçler', icon: ListChecks },
] as const

function CaseWorkspace({ item, cases, operations, references, calculator, tab, tabId }: { item: CaseRecord; cases: CasesDataPort; operations?: CaseOperationsPort; references?: CaseReferenceDataPort; calculator?: ValueLossCalculatorPort; tab: AssistantTab; tabId: string }) {
  const { reportUnauthorized } = useSession()
  const workspace = useCaseOperations(item.caseId, 'api', true, operations)
  const [detail, setDetail] = useState<CaseRecord | null>(null)
  const [detailError, setDetailError] = useState(false)
  const detailLoaded = useRef(false)
  const [noteVersion, setNoteVersion] = useState(0)
  const [noteSearch, setNoteSearch] = useState('')
  const [faultOpened, setFaultOpened] = useState(tab === 'process')
  // Mount once on first use, then retain the editor inside the hidden panel.
  // Reopening tabs must not discard drafts or fetch the same fault again.
  if (tab === 'process' && !faultOpened) setFaultOpened(true)
  const [tracking, setTracking] = useState<TrackingSnapshot | null>(null)
  const [trackingError, setTrackingError] = useState(false)
  const [trackingVersion, setTrackingVersion] = useState(0)
  const referenceData = useCaseReferences(references, {}, faultOpened)
  useEffect(() => {
    if (referenceData.status === 'unauthorized') reportUnauthorized()
  }, [referenceData.status, reportUnauthorized])
  useEffect(() => {
    if (tab !== 'process') return
    window.addEventListener('focus', referenceData.reload)
    return () => window.removeEventListener('focus', referenceData.reload)
  }, [tab, referenceData.reload])
  useEffect(() => {
    if (tab !== 'process') return
    const refresh = () => setTrackingVersion((value) => value + 1)
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [tab])
  useEffect(() => {
    if (tab !== 'process') return
    const controller = new AbortController()
    void loadTracking(item.caseId, controller.signal).then((data) => {
      if (!controller.signal.aborted) { setTracking(data); setTrackingError(false) }
    }).catch(() => { if (!controller.signal.aborted) { setTracking(null); setTrackingError(true) } })
    return () => controller.abort()
  }, [item.caseId, tab, trackingVersion])
  useEffect(() => {
    let active = true
    let generation = 0
    const refresh = () => {
      const request = ++generation
      void cases.getCase(item.caseId).then((result) => {
        if (active && request === generation) { detailLoaded.current = true; setDetail(result); setDetailError(false) }
      }).catch((error: unknown) => {
        if (!active || request !== generation) return
        setDetail(null)
        setDetailError(true)
        if (error instanceof HttpCasesError && error.kind === 'unauthorized') reportUnauthorized()
      })
    }
    // Entering Processes still checks current case state. Leaving it for a
    // note must not start another request alongside the first keystroke.
    if (tab === 'process' || !detailLoaded.current) refresh()
    window.addEventListener('focus', refresh)
    const noteSaved = (event: Event) => {
      if ((event as CustomEvent<{ caseId: string }>).detail?.caseId === item.caseId) refresh()
    }
    window.addEventListener(NOTE_SAVED_EVENT, noteSaved)
    return () => { active = false; window.removeEventListener('focus', refresh); window.removeEventListener(NOTE_SAVED_EVENT, noteSaved) }
  }, [cases, item.caseId, reportUnauthorized, tab])
  const currentItem = detail ?? item
  const noteWorkspace = useMemo(() => ({ data: workspace.data, status: workspace.status, port: workspace.port, reload: workspace.reload }), [workspace.data, workspace.status, workspace.port, workspace.reload])
  const noteTarget = useMemo(() => ({ caseId: item.caseId, plate: currentItem.plate, type: currentItem.type, officeNumber: currentItem.officeNumber, source: 'api' as const }), [item.caseId, currentItem.plate, currentItem.type, currentItem.officeNumber])
  const newNote = useCallback(() => setNoteVersion(value => value + 1), [])
  const notes = useMemo(() => {
    if (tab !== 'note') return []
    const search = noteSearch.toLocaleLowerCase('tr-TR')
    return workspace.data?.notes.filter(note => `${note.subject ?? ''} ${note.body} ${note.legacySource?.authorName ?? note.createdByDisplayName}`.toLocaleLowerCase('tr-TR').includes(search)) ?? []
  }, [workspace.data, noteSearch, tab])
  return <section className="assistant-case" aria-label="Seçili dosya" hidden={tab === 'files'}>
    <div className="assistant-case-heading"><div><AssistantPlate plate={currentItem.plate} type={currentItem.type} /><small>{currentItem.officeNumber}</small></div></div>
    {currentItem.type === 'Trafik' && <AssistantValueLoss key={item.caseId} caseId={item.caseId} port={calculator} />}
    {/* Keep the draft mounted while viewing history or process information. */}
    <div role="tabpanel" id={`${tabId}-note-panel`} aria-labelledby={`${tabId}-note`} hidden={tab !== 'note'}><QuickNoteEditor key={noteVersion} standalone target={noteTarget} workspace={noteWorkspace} onClose={newNote} />
    <section className="assistant-note-history" aria-label="Geçmiş notlar">
    <h3>Geçmiş notlar <small>{workspace.data?.notes.length ?? 0} not</small></h3>
    {workspace.status === 'loading' && <p role="status">Dosya yükleniyor…</p>}
    {!['ok', 'loading'].includes(workspace.status) && <p role="alert">Dosya yüklenemedi. <button onClick={workspace.reload}>Tekrar dene</button></p>}
    {tab === 'note' && workspace.data && <>
      <label className="field"><span>Notlarda ara</span><input value={noteSearch} onChange={(event) => setNoteSearch(event.target.value)} maxLength={120} /></label>
      {notes.length === 0 && <p>{noteSearch ? 'Aramayla eşleşen not yok.' : 'Henüz not yok.'}</p>}
      {notes.map((note) => <article className="assistant-entry" key={note.id}>
        {note.subject && <strong>{note.subject}</strong>}<p>{note.body}</p>
        <small>{note.legacySource?.authorName ?? note.createdByDisplayName} · {dateTime(note.legacySource?.occurredAt ?? note.createdAt)}{note.legacySource && ' · V1 tarihsel not'}</small>
      </article>)}
    </>}
    </section>
    </div>
    <div role="tabpanel" id={`${tabId}-process-panel`} aria-labelledby={`${tabId}-process`} hidden={tab !== 'process'}>
    {faultOpened && <CaseFaultModule caseId={item.caseId} />}
    {tab === 'process' && <>
      {workspace.status === 'loading' && <p role="status">Dosya yükleniyor…</p>}
      {!['ok', 'loading'].includes(workspace.status) && <p role="alert">Dosya yüklenemedi. <button onClick={workspace.reload}>Tekrar dene</button></p>}
      {detailError ? <p role="alert">Güncel süreç bilgisi alınamadı. <button onClick={() => window.dispatchEvent(new Event('focus'))}>Tekrar dene</button></p> : !detail ? <p role="status">Güncel süreç kontrol ediliyor…</p> : <dl className="assistant-process">
        <dt>Dosya sorumlusu</dt><dd>{detail.responsibleUserId ? referenceData.references?.users.find((user) => user.id === detail.responsibleUserId)?.displayName ?? tracking?.users.find((user) => user.id === detail.responsibleUserId)?.displayName ?? 'Atanmış (ad bilgisi alınamadı)' : 'Atanmamış'}</dd>
        <dt>Sigorta şirketi</dt><dd>{referenceData.references?.insurers.find((insurer) => insurer.id === detail.insurerId)?.name ?? (detail.company || '—')}</dd>
        <dt>Dosya türü</dt><dd>{detail.type === 'Trafik' || detail.type === 'Kasko' ? detail.type : '—'}</dd>
        <dt>Dosya numarası</dt><dd>{detail.claimNumber || '—'}</dd>
        <dt>İhbar tarihi</dt><dd>{notificationDate(detail.notificationDate)}</dd>
        <dt>Servis adı</dt><dd>{detail.service || '—'}</dd>
        <dt>Servis cep</dt><dd>{serviceMobile(detail) ?? '—'}</dd>
        <dt>Durum / aşama</dt><dd>{detail.status} · {detail.stage}</dd>
        <dt>Takip</dt><dd>{detail.followUp}</dd>
        <dt>Son işlem</dt><dd>{detail.lastAction === '—' ? '—' : dateTime(detail.lastAction)}</dd>
      </dl>}
      {referenceData.status === 'unavailable' && <p role="alert">Şirket ve personel bilgileri alınamadı. <button onClick={referenceData.reload}>Bilgileri yenile</button></p>}
      {trackingError ? <p role="alert">Tramer ve evrak takibi alınamadı. <button onClick={() => setTrackingVersion((value) => value + 1)}>Tekrar dene</button></p> : !tracking ? <p role="status">Tramer ve evrak takibi yükleniyor…</p> : <>
        <h3>Tramer / evrak</h3>
        {tracking.tramer.length === 0 && <p>Tramer talebi yok.</p>}
        {tracking.tramer.map((request) => <article className="assistant-entry" key={request.id}><strong>{request.applicationNumber ?? 'Başvuru numarası bekleniyor'}</strong><p>{({ entry_pending: 'Giriş bekliyor', result_pending: 'Sonuç bekliyor', completed: 'Tamamlandı', cancelled: 'İptal' } as const)[request.status]} · {request.assignedName}</p>{request.resultText && <p>{request.resultText}</p>}</article>)}
        <p>{tracking.documents.filter((document) => document.status === 'pending').length} evrak inceleme bekliyor · {tracking.documents.filter((document) => document.status === 'approved').length} onaylı · {tracking.documents.filter((document) => document.status === 'rejected').length} reddedildi</p>
      </>}
      {workspace.data && <>
        <h3>Görevler</h3>
        {workspace.data.tasks.length === 0 && <p>Görev yok.</p>}
        {workspace.data.tasks.map((task) => <article className="assistant-entry" key={task.id}><strong>{task.title}</strong><p>{({ open: 'Açık', completed: 'Tamamlandı', cancelled: 'İptal' } as const)[task.status]} · {task.dueDate} · {task.assignedUserDisplayName ?? task.legacySource?.assigneeName ?? 'Atanmamış'}</p>{task.resolutionNote && <p>{task.resolutionNote}</p>}</article>)}
        <h3>Takip geçmişi</h3>
        {workspace.data.followUpHistory.length === 0 && <p>Takip değişikliği yok.</p>}
        {workspace.data.followUpHistory.map((event) => <article className="assistant-entry" key={event.id}><p>{event.previousFollowUpDate ?? 'Takip yok'} → {event.newFollowUpDate ?? 'Takip temizlendi'}</p><small>{event.actorDisplayName} · {dateTime(event.changedAt)}</small></article>)}
      </>}
    </>}
    </div>
  </section>
}

export function AssistantCaseSearch({ cases: suppliedCases, operations, references, calculator }: { cases?: CasesDataPort; operations?: CaseOperationsPort; references?: CaseReferenceDataPort; calculator?: ValueLossCalculatorPort }) {
  const session = useSession()
  const { reportUnauthorized } = session
  const cases = useMemo(() => suppliedCases ?? createHttpCasesAdapter(), [suppliedCases])
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState<{ text: string; page: number; version: number } | null>(null)
  const [result, setResult] = useState<{ key: typeof search; data: CasePageResult | null; error: boolean } | null>(null)
  const userId = session.user?.id ?? 'anonymous'
  const selectedCaseId = useAssistantCaseSelection(userId)
  const [tab, setTab] = useState<AssistantTab>('note')
  const activeTab = selectedCaseId ? tab : 'files'
  const tabId = useId()
  const [selectionReload, setSelectionReload] = useState(0)
  const selectionKey = `${userId}:${selectedCaseId ?? ''}:${selectionReload}`
  const [selection, setSelection] = useState<{ key: string; item: CaseRecord | null; error: boolean } | null>(null)
  const [selectionWriteError, setSelectionWriteError] = useState(false)
  const selected = selection?.key === selectionKey ? selection.item : null
  const selectionError = selectedCaseId === undefined || selectionWriteError || (selection?.key === selectionKey && selection.error)
  useEffect(() => {
    if (!selectedCaseId) return
    let active = true
    void cases.getCase(selectedCaseId).then((item) => {
      if (active) setSelection({ key: selectionKey, item, error: false })
    }).catch((error: unknown) => {
      if (!active) return
      setSelection({ key: selectionKey, item: null, error: true })
      if (error instanceof HttpCasesError && error.kind === 'unauthorized') reportUnauthorized()
    })
    return () => { active = false }
  }, [cases, selectedCaseId, selectionKey, reportUnauthorized])
  useEffect(() => {
    if (!search) return
    let active = true
    void cases.listCasePage({ search: search.text, page: search.page, pageSize: 10 }).then((data) => {
      if (active) setResult({ key: search, data, error: false })
    }).catch((error: unknown) => {
      if (!active) return
      setResult({ key: search, data: null, error: true })
      if (error instanceof HttpCasesError && error.kind === 'unauthorized') reportUnauthorized()
    })
    return () => { active = false }
  }, [cases, search, reportUnauthorized])
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (query.trim()) setSearch({ text: query.trim(), page: 1, version: (search?.version ?? 0) + 1 })
  }
  const current = result?.key === search ? result : null
  return <>
    <div className="assistant-toolbar">
    <nav className="assistant-tabs" role="tablist" aria-label="Dosya görünümü">
      {assistantTabs.map(({ id, label, icon: Icon }, index) => <button type="button" role="tab" key={id} id={`${tabId}-${id}`} aria-controls={`${tabId}-${id}-panel`} aria-selected={activeTab === id} tabIndex={activeTab === id ? 0 : -1} disabled={id !== 'files' && !selectedCaseId} onClick={() => setTab(id)} onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? assistantTabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + assistantTabs.length) % assistantTabs.length
        const target = document.getElementById(`${tabId}-${assistantTabs[selectedCaseId ? next : 0].id}`)
        target?.focus()
        target?.click()
      }}><Icon size={16} aria-hidden="true" /><span>{label}</span></button>)}
    </nav>
    {selected && <OpenCaseFolderButton caseId={selected.caseId} />}
    </div>
    <div role="tabpanel" id={`${tabId}-files-panel`} aria-labelledby={`${tabId}-files`} hidden={activeTab !== 'files'}>
    <form className="assistant-search" onSubmit={submit}>
      <label className="field"><span>Plaka veya dosya numarası</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} maxLength={120} placeholder="Örn. 34 ABC 123" /></label>
      <button className="button button--primary" type="submit" disabled={!query.trim()}>Ara</button>
    </form>
    {search && !current && <p role="status">Aranıyor…</p>}
    {current?.error && <p role="alert">Arama yapılamadı. Bağlantıyı kontrol edip yeniden arayın.</p>}
    {current?.data && <section className="assistant-results" aria-label="Arama sonuçları">
      <p role="status">{current.data.totalCount} dosya · Açık ve kapalı dosyalar</p>
      {current.data.items.map((item) => <button className="assistant-result" key={item.caseId} aria-pressed={selected?.caseId === item.caseId} onClick={() => {
        const saved = rememberAssistantCase(userId, item.caseId)
        setSelectionWriteError(!saved)
        if (saved) setSelection({ key: `${userId}:${item.caseId}:${selectionReload}`, item, error: false })
        if (saved) setTab('note')
      }}><AssistantPlate plate={item.plate} type={item.type} /><span>{item.officeNumber} · {item.status} · {item.stage}</span></button>)}
      {current.data.totalPages > 1 && <nav className="assistant-pagination" aria-label="Arama sayfaları"><button disabled={search!.page <= 1} onClick={() => setSearch({ ...search!, page: search!.page - 1 })}>Önceki</button><span>{search!.page} / {current.data.totalPages}</span><button disabled={search!.page >= current.data.totalPages} onClick={() => setSearch({ ...search!, page: search!.page + 1 })}>Sonraki</button></nav>}
    </section>}
    </div>
    {selectionError && <p role="alert">Dosya seçimi alınamadı veya bu cihazda saklanamadı. <button onClick={() => { setSelectionWriteError(false); setSelectionReload(value => value + 1) }}>Tekrar dene</button></p>}
    {selected ? <CaseWorkspace key={selected.caseId} item={selected} cases={cases} operations={operations} references={references} calculator={calculator} tab={activeTab} tabId={tabId} /> : selectedCaseId && !selectionError ? <p role="status">Seçili dosya yükleniyor…</p> : <p>Programdan bir dosya seçin veya burada arayın.</p>}
  </>
}

export function DesktopAssistantPanel() {
  const session = useSession()
  const selectedCaseId = useAssistantCaseSelection(session.user?.id ?? 'anonymous')
  const appearance = useAssistantAppearance()
  const native = (window as AssistantWindow).hasarbotuAssistantMenu
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); choose('close') } }
    document.addEventListener('keydown', keydown)
    return () => document.removeEventListener('keydown', keydown)
  }, [])
  return <main className="desktop-assistant-panel" style={appearanceStyle(appearance.appearance, appearance.systemDark)} aria-label="HasarBotu hızlı işlemler">
    <header><div><strong>HasarBotu Touch</strong><small>{session.user?.displayName ?? 'Hızlı işlemler'}</small></div><button disabled={!native} onClick={() => choose('close')} aria-label="Menüyü kapat">×</button></header>
    <div className="assistant-content">
      {session.status === 'bootstrapping' ? <p role="status">Oturum doğrulanıyor…</p> : session.status !== 'authenticated' ? <p role="status">Dosyaları görmek için hesabınızla giriş yapın. {session.notice}</p> : <>
        <AssistantCaseSearch key={session.user!.id} />
      </>}
    </div>
    <TouchPlayControls />
    <nav className="assistant-native-actions" aria-label="Kısayollar"><button disabled={!native} onClick={() => choose('open', session.status === 'authenticated' ? selectedCaseId ?? undefined : undefined)}>{session.status === 'authenticated' ? 'Uygulamayı aç' : 'Giriş yap'}</button><button disabled={!native} onClick={() => choose('notifications', session.status === 'authenticated' ? selectedCaseId ?? undefined : undefined)}>Bildirimler</button><button disabled={!native} onClick={() => choose('settings')}>Ayarlar</button></nav>
    <footer><button disabled={!native} onClick={() => choose('hide')}>Gizle</button><button disabled={!native} onClick={() => choose('reset')}>Konumu sıfırla</button></footer>
  </main>
}
