import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useSession } from '../../app/sessionContext'
import { rememberAssistantCase, useAssistantCaseSelection } from '../../app/assistantCaseSelection'
import { QuickNote } from '../../components/TouchAssistant'
import { OpenCaseFolderButton } from '../../components/OpenCaseFolderButton'
import { createHttpCasesAdapter, HttpCasesError } from '../../data/httpAdapter'
import { useCaseOperations } from '../../data/useCaseOperations'
import type { CasesDataPort, CasePageResult } from '../../data/ports'
import type { CaseOperationsPort } from '../../data/caseOperationsPort'
import type { CaseRecord } from '../../types/case'
import type { TrackingSnapshot } from '@hasarbotu/contracts'
import { loadTracking } from '../tracking/trackingApi'
import './desktop-assistant-panel.css'
import { useAssistantAppearance } from './assistantAppearanceContext'
import { appearanceStyle } from './appearance'

type MenuAction = 'open' | 'notifications' | 'settings' | 'hide' | 'reset' | 'close'
type AssistantWindow = Window & { hasarbotuAssistantMenu?: { choose(action: MenuAction): void } }
const choose = (action: MenuAction) => (window as AssistantWindow).hasarbotuAssistantMenu?.choose(action)
const dateTime = (value: string | null) => value ? new Date(value).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }) : '—'

function CaseWorkspace({ item, cases, operations }: { item: CaseRecord; cases: CasesDataPort; operations?: CaseOperationsPort }) {
  const { reportUnauthorized } = useSession()
  const workspace = useCaseOperations(item.caseId, 'api', true, operations)
  const [detail, setDetail] = useState<CaseRecord | null>(null)
  const [detailError, setDetailError] = useState(false)
  const [tab, setTab] = useState<'note' | 'history' | 'process'>('note')
  const [noteVersion, setNoteVersion] = useState(0)
  const [noteSearch, setNoteSearch] = useState('')
  const [tracking, setTracking] = useState<TrackingSnapshot | null>(null)
  const [trackingError, setTrackingError] = useState(false)
  const [trackingVersion, setTrackingVersion] = useState(0)
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
        if (active && request === generation) { setDetail(result); setDetailError(false) }
      }).catch((error: unknown) => {
        if (!active || request !== generation) return
        setDetail(null)
        setDetailError(true)
        if (error instanceof HttpCasesError && error.kind === 'unauthorized') reportUnauthorized()
      })
    }
    refresh()
    window.addEventListener('focus', refresh)
    return () => { active = false; window.removeEventListener('focus', refresh) }
  }, [cases, item.caseId, reportUnauthorized])
  const notes = workspace.data?.notes.filter((note) => `${note.subject ?? ''} ${note.body} ${note.legacySource?.authorName ?? note.createdByDisplayName}`.toLocaleLowerCase('tr-TR').includes(noteSearch.toLocaleLowerCase('tr-TR'))) ?? []
  return <section className="assistant-case" aria-label="Seçili dosya">
    <OpenCaseFolderButton caseId={item.caseId} />
    <nav className="assistant-tabs" aria-label="Dosya görünümü">
      <button aria-pressed={tab === 'note'} onClick={() => setTab('note')}>Hızlı not</button>
      <button aria-pressed={tab === 'history'} onClick={() => setTab('history')}>Geçmiş notlar</button>
      <button aria-pressed={tab === 'process'} onClick={() => setTab('process')}>Süreçler</button>
    </nav>
    {/* Keep the draft mounted while viewing history or process information. */}
    <div hidden={tab !== 'note'}><QuickNote key={noteVersion} standalone target={{ caseId: item.caseId, plate: item.plate, officeNumber: item.officeNumber, source: 'api' }} port={operations} onClose={() => setNoteVersion((value) => value + 1)} /></div>
    {tab !== 'note' && <p className="assistant-selected"><strong>{item.plate}</strong> · {item.officeNumber}</p>}
    {tab !== 'note' && workspace.status === 'loading' && <p role="status">Dosya yükleniyor…</p>}
    {tab !== 'note' && !['ok', 'loading'].includes(workspace.status) && <p role="alert">Dosya yüklenemedi. <button onClick={workspace.reload}>Tekrar dene</button></p>}
    {tab === 'history' && workspace.data && <>
      <label className="field"><span>Notlarda ara</span><input value={noteSearch} onChange={(event) => setNoteSearch(event.target.value)} maxLength={120} /></label>
      {notes.length === 0 && <p>{noteSearch ? 'Aramayla eşleşen not yok.' : 'Henüz not yok.'}</p>}
      {notes.map((note) => <article className="assistant-entry" key={note.id}>
        {note.subject && <strong>{note.subject}</strong>}<p>{note.body}</p>
        <small>{note.legacySource?.authorName ?? note.createdByDisplayName} · {dateTime(note.legacySource?.occurredAt ?? note.createdAt)}{note.legacySource && ' · V1 tarihsel not'}</small>
      </article>)}
    </>}
    {tab === 'process' && <>
      {detailError ? <p role="alert">Güncel süreç bilgisi alınamadı. <button onClick={() => window.dispatchEvent(new Event('focus'))}>Tekrar dene</button></p> : !detail ? <p role="status">Güncel süreç kontrol ediliyor…</p> : <dl className="assistant-process">
        <dt>Durum / aşama</dt><dd>{detail.status} · {detail.stage}</dd>
        <dt>Sorumlu</dt><dd>{detail.responsibleUserId ? tracking?.users.find((user) => user.id === detail.responsibleUserId)?.displayName ?? 'Atanmış (ad bilgisi bekleniyor)' : 'Atanmamış'}</dd>
        <dt>Servis</dt><dd>{detail.service || '—'}</dd>
        <dt>Takip</dt><dd>{detail.followUp}</dd>
        <dt>Son işlem</dt><dd>{detail.lastAction === '—' ? '—' : dateTime(detail.lastAction)}</dd>
      </dl>}
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
  </section>
}

export function AssistantCaseSearch({ cases: suppliedCases, operations }: { cases?: CasesDataPort; operations?: CaseOperationsPort }) {
  const session = useSession()
  const { reportUnauthorized } = session
  const cases = useMemo(() => suppliedCases ?? createHttpCasesAdapter(), [suppliedCases])
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState<{ text: string; page: number; version: number } | null>(null)
  const [result, setResult] = useState<{ key: typeof search; data: CasePageResult | null; error: boolean } | null>(null)
  const userId = session.user?.id ?? 'anonymous'
  const selectedCaseId = useAssistantCaseSelection(userId)
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
      }}><strong>{item.plate}</strong><span>{item.officeNumber} · {item.status} · {item.stage}</span></button>)}
      {current.data.totalPages > 1 && <nav className="assistant-pagination" aria-label="Arama sayfaları"><button disabled={search!.page <= 1} onClick={() => setSearch({ ...search!, page: search!.page - 1 })}>Önceki</button><span>{search!.page} / {current.data.totalPages}</span><button disabled={search!.page >= current.data.totalPages} onClick={() => setSearch({ ...search!, page: search!.page + 1 })}>Sonraki</button></nav>}
    </section>}
    {selectionError && <p role="alert">Dosya seçimi alınamadı veya bu cihazda saklanamadı. <button onClick={() => { setSelectionWriteError(false); setSelectionReload(value => value + 1) }}>Tekrar dene</button></p>}
    {selected ? <CaseWorkspace key={selected.caseId} item={selected} cases={cases} operations={operations} /> : selectedCaseId && !selectionError ? <p role="status">Seçili dosya yükleniyor…</p> : <p>Programdan bir dosya seçin veya burada arayın.</p>}
  </>
}

export function DesktopAssistantPanel() {
  const session = useSession()
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
    <nav className="assistant-native-actions" aria-label="Kısayollar"><button disabled={!native} onClick={() => choose('open')}>{session.status === 'authenticated' ? 'Uygulamayı aç' : 'Giriş yap'}</button><button disabled={!native} onClick={() => choose('notifications')}>Bildirimler</button><button disabled={!native} onClick={() => choose('settings')}>Ayarlar</button></nav>
    <footer><button disabled={!native} onClick={() => choose('hide')}>Gizle</button><button disabled={!native} onClick={() => choose('reset')}>Konumu sıfırla</button></footer>
  </main>
}
