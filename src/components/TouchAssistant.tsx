import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { NotebookPen, X } from 'lucide-react'
import { NOTE_SAVED_EVENT, QUICK_NOTE_EVENT, type ActiveCase } from '../app/activeCase'
import { useSession } from '../app/sessionContext'
import { CaseOperationsError, type CaseOperationsPort } from '../data/caseOperationsPort'
import { useCaseOperations } from '../data/useCaseOperations'

interface Draft { body: string; key: string; attempted: boolean }

function QuickNote({ target, port, onClose }: { target: ActiveCase; port?: CaseOperationsPort; onClose(): void }) {
  const session = useSession()
  const workspace = useCaseOperations(target.caseId, target.source, true, port)
  const storageKey = `hasarbotu-quick-note:${session.user?.id ?? 'mock'}:${target.caseId}`
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
      if (saved && typeof saved === 'object' && 'body' in saved && typeof saved.body === 'string'
        && 'key' in saved && typeof saved.key === 'string' && 'attempted' in saved && typeof saved.attempted === 'boolean') {
        return { body: saved.body, key: saved.key, attempted: saved.attempted }
      }
    } catch { /* An unreadable local draft must never be submitted automatically. */ }
    return { body: '', key: crypto.randomUUID(), attempted: false }
  })
  const lock = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (lock.current || !draft.body.trim() || !workspace.data?.permissions.canWrite) return
    lock.current = true
    setBusy(true)
    setError('')
    const attempt = { ...draft, body: draft.body.trim(), attempted: true }
    try {
      // Persist before sending: retry after a lost response uses the same request identity.
      localStorage.setItem(storageKey, JSON.stringify(attempt))
    } catch {
      setError('Tarayıcı depolaması kullanılamıyor. Not gönderilmedi; metni kopyalayıp tekrar deneyin.')
      lock.current = false
      setBusy(false)
      return
    }
    setDraft(attempt)
    try {
      await workspace.port.createNote(target.caseId, { noteType: 'internal', subject: null, body: attempt.body }, attempt.key)
      setSaved(true)
      // Retaining an old key if storage is unavailable remains safe: the API deduplicates it.
      try { localStorage.removeItem(storageKey) } catch { /* Saved on the server; do not report a failed write. */ }
      window.dispatchEvent(new CustomEvent(NOTE_SAVED_EVENT, { detail: { caseId: target.caseId } }))
    } catch (caught) {
      if (caught instanceof CaseOperationsError && caught.kind === 'unauthorized') session.reportUnauthorized()
      const definitive = caught instanceof CaseOperationsError && ['validation', 'forbidden', 'not_found'].includes(caught.kind)
      if (definitive) {
        const editable = { ...attempt, attempted: false, key: crypto.randomUUID() }
        setDraft(editable)
        try { localStorage.setItem(storageKey, JSON.stringify(editable)) } catch { /* Keep the editable text in memory. */ }
      }
      setError(definitive ? 'Not kaydedilemedi. Dosyayı ve yazma yetkinizi kontrol edin.' : 'Kayıt yanıtı alınamadı. Tekrar deneyin; aynı not ikinci kez eklenmez.')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  return <>
    <p className="touch-assistant__target"><strong>{target.plate}</strong><span>{target.officeNumber}</span></p>
    {saved ? <div role="status"><p>Not dosyaya kaydedildi.</p><Link className="button button--primary" to={`/dosyalar/${target.caseId}?tab=operations`} onClick={onClose}>Dosyada göster</Link></div> : <form onSubmit={(event) => void save(event)}>
      <label className="field"><span>Hızlı not</span><textarea autoFocus rows={5} maxLength={5000} value={draft.body} readOnly={busy || draft.attempted} onChange={(event) => {
        const next = { ...draft, body: event.target.value }
        setDraft(next)
        try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { setError('Not taslağı bu cihazda saklanamadı. Metni kapatmadan önce kopyalayın.') }
      }} /></label>
      {workspace.status === 'loading' && <p role="status">Dosya kontrol ediliyor…</p>}
      {workspace.status === 'ok' && !workspace.data?.permissions.canWrite && <p role="status">Bu dosyaya not ekleme yetkiniz yok.</p>}
      {!['ok', 'loading', 'idle'].includes(workspace.status) && <p role="alert">Dosya yüklenemedi. <button type="button" className="button button--secondary" onClick={workspace.reload}>Yeniden yükle</button></p>}
      {target.source !== 'api' && <p>Not eklemek için sunucu oturumu gerekir.</p>}
      {error && <p role="alert">{error}</p>}
      <button className="button button--primary" type="submit" disabled={busy || !draft.body.trim() || !workspace.data?.permissions.canWrite}>{busy ? 'Kaydediliyor…' : draft.attempted ? 'Kaydı tekrar dene' : 'Notu kaydet'}</button>
    </form>}
  </>
}

export function TouchAssistant({ target, port }: { target: ActiveCase | null; port?: CaseOperationsPort }) {
  const [open, setOpen] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const show = () => setOpen(true)
    window.addEventListener(QUICK_NOTE_EVENT, show)
    return () => window.removeEventListener(QUICK_NOTE_EVENT, show)
  }, [])
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const button = trigger.current
    panel.current?.querySelector<HTMLElement>('textarea, button')?.focus()
    return () => { if (previous?.isConnected) previous.focus(); else button?.focus() }
  }, [open])
  return <>
    <button ref={trigger} className="touch-assistant-trigger button button--primary" type="button" aria-label="Touch Assistant — hızlı not" aria-expanded={open} onClick={() => setOpen((value) => !value)}><NotebookPen size={20} /><span>Hızlı not</span></button>
    {open && <div className="touch-assistant-backdrop"><div ref={panel} className="touch-assistant" role="dialog" aria-modal="true" aria-label="Touch Assistant" onKeyDown={(event) => {
      if (event.key === 'Escape') { event.stopPropagation(); setOpen(false) }
      if (event.key === 'Tab') {
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), textarea, a[href]')]
        const first = controls[0], last = controls[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }}>
      <header><h2>Touch Assistant</h2><button className="icon-button" type="button" aria-label="Hızlı notu kapat" onClick={() => setOpen(false)}><X size={20} /></button></header>
      {target ? <QuickNote key={target.caseId} target={target} port={port} onClose={() => setOpen(false)} /> : <p>Not eklemek için bir dosya açın veya listeden seçin.</p>}
      <nav aria-label="Hızlı işlemler"><Link to="/dosyalar" onClick={() => setOpen(false)}>Dosyalar</Link><Link to="/bildirimler" onClick={() => setOpen(false)}>Bildirimler</Link></nav>
    </div></div>}
  </>
}
