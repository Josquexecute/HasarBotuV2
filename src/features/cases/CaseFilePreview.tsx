import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { ChevronLeft, ChevronRight, FileText, FolderOpen, Maximize, Minus, PanelRight, Plus, X } from 'lucide-react'
import type { CaseFolderBrowseRequest, CaseFolderBrowseResult, CaseFolderPreview } from '@hasarbotu/contracts'

type PreviewState = CaseFolderPreview | { kind: 'error'; message: string } | { kind: 'loading' }

interface Props {
  name: string
  details: string
  browse: (request: CaseFolderBrowseRequest) => Promise<CaseFolderBrowseResult>
  caseId: string
  directoryPath: readonly string[]
  version: number
  onReset: (message: string) => void
  onReveal: () => void
  full: boolean
  onFull: (full: boolean) => void
  photo: { index: number; count: number; move: (offset: number) => void } | null
}

export function CaseFilePreview({ name, details, browse, caseId, directoryPath, version, onReset, onReveal, full, onFull, photo }: Props) {
  const [preview, setPreview] = useState<PreviewState>({ kind: 'loading' })
  const [requested, setRequested] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [pageInput, setPageInput] = useState('1')
  const [zoom, setZoom] = useState(100)
  const [sheet, setSheet] = useState(0)
  const modal = useRef<HTMLDialogElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const isVisual = preview.kind === 'image' || preview.kind === 'pdf'

  useEffect(() => {
    let alive = true
    const timer = window.setTimeout(() => {
      void browse({ caseId, action: 'preview', path: [...directoryPath, name], locationVersion: version, ...(requested > 1 ? { page: requested } : {}) }).then(result => {
        if (!alive) return
        if (result.kind === 'error' && result.reset) { onReset(result.message); return }
        if (result.kind === 'pdf') {
          setPageCount(result.pageCount)
          setPageInput(String(result.page))
        }
        if (result.kind === 'pdf' || result.kind === 'image' || result.kind === 'text' || result.kind === 'word' || result.kind === 'workbook' || result.kind === 'unsupported') {
          setPreview(result)
        } else setPreview({ kind: 'error', message: result.kind === 'error' ? result.message : 'Önizleme yüklenemedi.' })
      }).catch(() => { if (alive) setPreview({ kind: 'error', message: 'Önizleme yüklenemedi.' }) })
    }, 100)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [browse, caseId, directoryPath, name, onReset, requested, version])

  useEffect(() => {
    const dialog = modal.current
    if (!dialog || dialog.open) return
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
  }, [full])

  function goTo(page: number) {
    const next = Math.min(pageCount, Math.max(1, page))
    if (!Number.isSafeInteger(next) || !pageCount) return
    setPageInput(String(next))
    if (next === requested) return
    setPreview({ kind: 'loading' })
    setRequested(next)
    if (scroll.current) { scroll.current.scrollTop = 0; scroll.current.scrollLeft = 0 }
  }

  function move(offset: number) {
    if (pageCount) goTo(requested + offset)
    else photo?.move(offset)
  }

  function changeZoom(delta: number) { setZoom(current => Math.min(400, Math.max(50, current + delta))) }

  function handleKeys(event: KeyboardEvent) {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return
    if (event.key === 'ArrowLeft' && (pageCount || photo)) move(-1)
    else if (event.key === 'ArrowRight' && (pageCount || photo)) move(1)
    else if (event.key === '+' && isVisual) changeZoom(25)
    else if (event.key === '-' && isVisual) changeZoom(-25)
    else if (event.key === '0' && isVisual) setZoom(100)
    else if (event.key === 'Escape' && full) onFull(false)
    else return
    event.preventDefault()
    event.stopPropagation()
  }

  const controls = <div className="case-explorer__preview-tools" aria-label="Önizleme denetimleri">
    {(pageCount > 0 || photo) && <div className="case-explorer__tool-group">
      <button type="button" className="icon-button" aria-label={pageCount ? 'Önceki sayfa' : 'Önceki fotoğraf'} title={pageCount ? 'Önceki sayfa' : 'Önceki fotoğraf'} disabled={pageCount ? requested <= 1 : photo!.index <= 0} onClick={() => move(-1)}><ChevronLeft size={15} /></button>
      {pageCount > 0 ? <form className="case-explorer__page-number" onSubmit={event => { event.preventDefault(); goTo(Number(pageInput)) }}>
        <input aria-label="PDF sayfa numarası" inputMode="numeric" value={pageInput} onChange={event => setPageInput(event.target.value.replace(/\D/g, ''))} onBlur={() => pageInput ? goTo(Number(pageInput)) : setPageInput(String(requested))} /> <span>/ {pageCount}</span>
      </form> : <span className="case-explorer__page-number">{photo!.index + 1} / {photo!.count}</span>}
      <button type="button" className="icon-button" aria-label={pageCount ? 'Sonraki sayfa' : 'Sonraki fotoğraf'} title={pageCount ? 'Sonraki sayfa' : 'Sonraki fotoğraf'} disabled={pageCount ? requested >= pageCount : photo!.index >= photo!.count - 1} onClick={() => move(1)}><ChevronRight size={15} /></button>
    </div>}
    {(isVisual || pageCount > 0) && <div className="case-explorer__tool-group">
      <button type="button" className="icon-button" aria-label="Uzaklaştır" title="Uzaklaştır" disabled={zoom === 50} onClick={() => changeZoom(-25)}><Minus size={15} /></button>
      <button type="button" className="text-button case-explorer__zoom-value" title="Genişliğe sığdır" aria-label="Genişliğe sığdır" onClick={() => setZoom(100)}>{zoom}%</button>
      <button type="button" className="icon-button" aria-label="Yakınlaştır" title="Yakınlaştır" disabled={zoom === 400} onClick={() => changeZoom(25)}><Plus size={15} /></button>
    </div>}
    {!full && <button className="icon-button case-explorer__expand-preview" type="button" title="Tam ekran" aria-label="Tam ekran" onClick={() => onFull(true)}><Maximize size={15} /></button>}
  </div>

  const body = <div className="case-explorer__preview-body" data-visual={isVisual} aria-label="Önizleme içeriği" tabIndex={0} ref={scroll}>
    {isVisual && <div className="case-explorer__preview-stage" style={{ '--preview-zoom': zoom / 100 } as CSSProperties}>
      <img src={preview.src} alt={preview.kind === 'pdf' ? `${name}, sayfa ${preview.page}` : name} draggable={false} onError={() => setPreview({ kind: 'error', message: 'Görsel önizlenemedi.' })} />
    </div>}
    {preview.kind === 'text' && <><pre>{preview.text}</pre>{preview.truncated && <small>Metnin ilk 64 KB’ı gösteriliyor.</small>}</>}
    {preview.kind === 'word' && <div className="case-explorer__word">{preview.paragraphs.length ? preview.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>) : <p>Belgede önizlenebilir metin bulunamadı.</p>}{preview.truncated && <small>Metnin ilk bölümü gösteriliyor.</small>}</div>}
    {preview.kind === 'workbook' && <div className="case-explorer__workbook">
      {preview.sheets.length ? <>
        <label>Çalışma sayfası <select value={sheet} onChange={event => setSheet(Number(event.target.value))}>{preview.sheets.map((item, index) => <option key={index} value={index}>{item.name}</option>)}</select></label>
        {preview.sheets[sheet]?.rows.length ? <table aria-label={preview.sheets[sheet].name}><tbody>{preview.sheets[sheet].rows.map((row, index) => <tr key={index}><th scope="row">{index + 1}</th>{row.map((cell, column) => <td key={column}>{cell}</td>)}</tr>)}</tbody></table> : <p>Bu sayfada önizlenebilir hücre bulunamadı.</p>}
      </> : <p>Önizlenebilir çalışma sayfası bulunamadı.</p>}
      {preview.truncated && <small>Çalışma kitabının ilk bölümü gösteriliyor.</small>}
    </div>}
    {preview.kind === 'loading' && <p role="status">Önizleme yükleniyor…</p>}
    {preview.kind === 'error' && <p role="alert">{preview.message}</p>}
    {preview.kind === 'unsupported' && <p>Bu dosya için önizleme kullanılamıyor. Gezginden açabilirsiniz.</p>}
  </div>

  return <aside className="case-explorer__preview" aria-label="Önizleme" onKeyDown={handleKeys}>
    <h3><PanelRight size={15} /> Önizleme</h3>
    {full ? <dialog className="case-explorer__fullscreen" aria-label={name} ref={modal} onCancel={event => { event.preventDefault(); onFull(false) }}>
      <header><strong title={name}>{name}</strong><button type="button" className="icon-button" aria-label="Tam ekrandan çık" title="Tam ekrandan çık" onClick={() => onFull(false)}><X size={19} /></button></header>
      {controls}{body}
    </dialog> : <>{controls}{body}</>}
    <div className="case-explorer__file-details">
      <strong title={name}>{name}</strong><span>{details}</span>
      <button className="text-button" type="button" onClick={onReveal}><FolderOpen size={15} /> Gezginde göster</button>
    </div>
  </aside>
}

export function EmptyCaseFilePreview() {
  return <aside className="case-explorer__preview" aria-label="Önizleme">
    <h3><PanelRight size={15} /> Önizleme</h3>
    <div className="case-explorer__preview-body case-explorer__preview-empty"><FileText size={23} /><p>Önizlemek için bir dosya seçin.</p></div>
  </aside>
}
