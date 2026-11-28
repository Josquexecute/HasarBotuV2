import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, ClipboardPaste, Copy, File, FileImage, FilePlus, FileText, Folder, FolderOpen, RefreshCw, Search } from 'lucide-react'
import { CASE_FOLDER_COPY_LIMIT, type CaseFolderBrowseRequest, type CaseFolderBrowseResult, type CaseFolderEntry, type CaseFolderListing } from '@hasarbotu/contracts'
import { OpenCaseFolderButton } from '../../components/OpenCaseFolderButton'
import { CaseFilePreview, EmptyCaseFilePreview } from './CaseFilePreview'

type Browse = (request: CaseFolderBrowseRequest) => Promise<CaseFolderBrowseResult>
type ListingState = { status: 'loading' } | { status: 'ready'; listing: CaseFolderListing } | { status: 'error'; message: string; reset?: boolean }
type SortKey = 'name' | 'modifiedAt' | 'size'
type Selection = { names: ReadonlySet<string>; focus: string; anchor: string }
type Copied = { version: number; source: readonly string[]; names: readonly string[] }
type Menu = { x: number; y: number; entry?: CaseFolderEntry }
const pathKey = (path: readonly string[]) => JSON.stringify(path)
const ROOT = pathKey([])
const ROW_BATCH = 150
const collator = new Intl.Collator('tr-TR', { numeric: true, sensitivity: 'base' })
const dateFormat = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short', timeStyle: 'short' })
const numberFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 })
const directoryNames = (listing: CaseFolderListing) => listing.entries.flatMap(entry => entry.kind === 'directory' ? [entry.name] : [])
const photoTypes = new Set(['JPG', 'JPEG', 'PNG', 'WEBP', 'GIF', 'BMP', 'AVIF'])
const inlineTypes = new Set([...photoTypes, 'PDF', 'DOCX', 'XLSX', 'TXT', 'CSV', 'LOG', 'JSON', 'XML'])

function fileType(name: string) {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toUpperCase() : 'Dosya'
}

function displaySize(size: number | null) {
  if (size === null) return '—'
  if (size < 1024) return `${size} B`
  if (size < 1024 ** 2) return `${numberFormat.format(size / 1024)} KB`
  return `${numberFormat.format(size / 1024 ** 2)} MB`
}

function EntryIcon({ entry }: { entry: CaseFolderEntry }) {
  const type = fileType(entry.name)
  if (entry.kind === 'directory') return <Folder className="case-explorer__folder-icon" size={17} aria-hidden="true" />
  if (photoTypes.has(type)) return <FileImage size={16} aria-hidden="true" />
  if (['PDF', 'DOC', 'DOCX', 'TXT'].includes(type)) return <FileText size={16} aria-hidden="true" />
  return <File size={16} aria-hidden="true" />
}

export function CaseFileExplorer({ caseId, plate, canWrite = false }: { caseId: string; plate: string; canWrite?: boolean }) {
  const bridge = (window as Window & { hasarbotuCaseFolders?: { browse?: Browse } }).hasarbotuCaseFolders
  if (!bridge?.browse) return <section className="case-explorer">
    <header className="case-explorer__bar"><h2>Genel Evrak</h2><OpenCaseFolderButton caseId={caseId} /></header>
    <p className="case-explorer__message">Klasör ağacı ve önizleme güncel HasarBotu masaüstü uygulamasında kullanılabilir.</p>
  </section>
  return <FolderBrowser caseId={caseId} plate={plate} browse={bridge.browse} canWrite={canWrite} />
}

function FolderBrowser({ caseId, plate, browse, canWrite }: { caseId: string; plate: string; browse: Browse; canWrite: boolean }) {
  const [directory, setDirectory] = useState<{ readonly path: readonly string[]; readonly version?: number }>({ path: [] })
  const [root, setRoot] = useState<{ name: string; version: number } | null>(null)
  const [tree, setTree] = useState<Map<string, string[]>>(new Map())
  const [expanded, setExpanded] = useState<Set<string>>(new Set([ROOT]))
  const [treeOnNarrow, setTreeOnNarrow] = useState(false)
  const [treeLimits, setTreeLimits] = useState<Map<string, number>>(new Map())
  const [listing, setListing] = useState<ListingState>({ status: 'loading' })
  const [selection, setSelection] = useState<Selection | null>(null)
  const [full, setFull] = useState(false)
  const [copied, setCopied] = useState<Copied | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [feedback, setFeedback] = useState<{ message: string; error?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [sort, setSort] = useState<{ key: SortKey; direction: 1 | -1 }>({ key: 'name', direction: 1 })
  const [widths, setWidths] = useState({ tree: 19, preview: 28 })
  const panes = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const context = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const pendingFocus = useRef<string | null>(null)
  const currentDirectory = useRef(directory)
  const activeKey = pathKey(directory.path)

  const resetAccess = useCallback((message: string) => {
    setRoot(null)
    setTree(new Map())
    setTreeLimits(new Map())
    setSelection(null)
    setCopied(null)
    setMenu(null)
    setFull(false)
    setListing({ status: 'error', message, reset: true })
  }, [])

  useEffect(() => {
    let alive = true
    void browse({ caseId, action: 'list', path: directory.path, locationVersion: directory.version }).then(result => {
      if (!alive) return
      if (result.kind !== 'listed') {
        if (result.kind === 'error' && result.reset) resetAccess(result.message)
        else setListing({ status: 'error', message: result.kind === 'error' ? result.message : 'Klasör listesi alınamadı.' })
        return
      }
      setRoot({ name: result.rootName, version: result.locationVersion })
      setTree(previous => new Map(directory.version === undefined ? [] : previous).set(activeKey, directoryNames(result)))
      setListing({ status: 'ready', listing: result })
    }).catch(() => {
      if (alive) setListing({ status: 'error', message: 'Klasör listesi alınamadı. Yeniden deneyin.' })
    })
    return () => { alive = false }
  }, [activeKey, browse, caseId, directory, resetAccess])

  useEffect(() => {
    if (!menu) return
    context.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !context.current?.contains(event.target)) setMenu(null)
    }
    window.addEventListener('pointerdown', dismiss, true)
    return () => window.removeEventListener('pointerdown', dismiss, true)
  }, [menu])

  function selectFolder(path: readonly string[], refreshRoot = false, clearFeedback = true) {
    setListing({ status: 'loading' })
    setSelection(null)
    setFull(false)
    setMenu(null)
    if (clearFeedback) setFeedback(null)
    if (refreshRoot) { setCopied(null); setTreeLimits(new Map()) }
    setPage(0)
    setQuery('')
    setExpanded(previous => new Set([
      ...(refreshRoot ? [] : previous),
      ...Array.from({ length: path.length + 1 }, (_, index) => pathKey(path.slice(0, index))),
    ]))
    const next = { path, version: refreshRoot ? undefined : root?.version }
    currentDirectory.current = next
    setDirectory(next)
  }

  async function reveal(entry: CaseFolderEntry) {
    if (!root) return
    const result = await browse({ caseId, action: 'reveal', path: [...directory.path, entry.name], locationVersion: root.version })
      .catch(() => ({ kind: 'error' as const, message: 'Windows Gezgini açılamadı.' }))
    if (currentDirectory.current !== directory || result.kind !== 'error') return
    if ('reset' in result && result.reset) resetAccess(result.message)
    else setFeedback({ message: result.message, error: true })
  }

  function treeItem(name: string, path: readonly string[], depth: number) {
    const key = pathKey(path)
    const children = tree.get(key)
    const isExpanded = expanded.has(key)
    return <li key={key}>
      <div className="case-explorer__tree-row" data-current={key === activeKey} style={{ paddingInlineStart: `${Math.min(depth, 12) * 12}px` }}>
        {children?.length === 0 ? <span className="case-explorer__expander" /> : <button className="case-explorer__expander" type="button" aria-expanded={isExpanded} aria-label={`${name} alt klasörleri`} onClick={() => {
          if (!children) { selectFolder(path); return }
          setExpanded(current => {
            const next = new Set(current)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
          })
        }}>{isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button>}
        <button className="case-explorer__tree-label" type="button" aria-current={key === activeKey ? 'location' : undefined} onClick={() => selectFolder(path)} title={name}>
          {isExpanded ? <FolderOpen size={16} /> : <Folder size={16} />}<span>{name}</span>
        </button>
      </div>
      {isExpanded && children && <ul>{children.slice(0, treeLimits.get(key) ?? ROW_BATCH).map(child => treeItem(child, [...path, child], depth + 1))}
        {children.length > (treeLimits.get(key) ?? ROW_BATCH) && <li><button className="text-button case-explorer__more" type="button" onClick={() => setTreeLimits(current => new Map(current).set(key, (current.get(key) ?? ROW_BATCH) + ROW_BATCH))}>Diğer klasörler</button></li>}
      </ul>}
    </li>
  }

  const entries = listing.status === 'ready' ? listing.listing.entries : null
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('tr-TR')
    return entries?.filter(entry => !normalized || entry.name.toLocaleLowerCase('tr-TR').includes(normalized)).sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
      const byName = collator.compare(left.name, right.name)
      if (left.kind !== 'file' || right.kind !== 'file' || sort.key === 'name') return sort.direction * byName
      const value = sort.key === 'size' ? (left.size ?? -1) - (right.size ?? -1) : (left.modifiedAt ?? '').localeCompare(right.modifiedAt ?? '')
      return sort.direction * value || byName
    }) ?? []
  }, [entries, query, sort])
  const selected = visible.find((entry): entry is Extract<CaseFolderEntry, { kind: 'file' }> => entry.name === selection?.focus && entry.kind === 'file' && selection.names.has(entry.name))
  const selectionCount = selection?.names.size ?? 0
  const photos = useMemo(() => visible.filter(entry => entry.kind === 'file' && photoTypes.has(fileType(entry.name))), [visible])
  const photoIndex = photos.findIndex(entry => entry === selected)
  const pageCount = Math.max(1, Math.ceil(visible.length / ROW_BATCH))
  const currentPage = Math.min(page, pageCount - 1)
  const rows = visible.slice(currentPage * ROW_BATCH, (currentPage + 1) * ROW_BATCH)
  const tabStop = rows.some(row => row.name === selection?.focus) ? selection?.focus : rows[0]?.name
  const rootName = root?.name ?? plate
  const clipboard = copied?.version === root?.version ? copied : null

  useEffect(() => {
    const name = pendingFocus.current
    if (!name) return
    pendingFocus.current = null
    const button = Array.from(list.current?.querySelectorAll<HTMLButtonElement>('button[data-entry]') ?? []).find(row => row.dataset.entry === name)
    button?.focus()
  }, [selection, currentPage])

  function choose(entry: CaseFolderEntry, options: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {}) {
    const toggle = options.ctrlKey || options.metaKey
    const anchor = selection?.anchor ?? entry.name
    let names = new Set([entry.name])
    if (options.shiftKey) {
      const first = visible.findIndex(item => item.name === anchor)
      const last = visible.indexOf(entry)
      const start = first < 0 ? last : first
      names = new Set([...(toggle ? selection?.names ?? [] : []), ...visible.slice(Math.min(start, last), Math.max(start, last) + 1).map(item => item.name)])
    } else if (toggle) {
      names = new Set(selection?.names)
      if (names.has(entry.name)) names.delete(entry.name)
      else names.add(entry.name)
    }
    setSelection({ names, anchor: options.shiftKey ? anchor : entry.name, focus: entry.name })
  }

  function toggleFull(value: boolean) {
    setFull(value)
    if (!value) list.current?.focus()
  }

  function activate(entry: CaseFolderEntry) {
    if (entry.kind === 'directory') selectFolder([...directory.path, entry.name])
    else if (inlineTypes.has(fileType(entry.name))) { choose(entry); setFull(true) }
    else void reveal(entry)
  }

  function copy(names = selection?.names) {
    if (!root || !names?.size) return
    const files = visible.filter(entry => entry.kind === 'file' && names.has(entry.name)).map(entry => entry.name)
    if (!files.length) { setFeedback({ message: 'Kopyalamak için dosya seçin.', error: true }); return }
    if (files.length > CASE_FOLDER_COPY_LIMIT) {
      setFeedback({ message: `Bir işlemde en fazla ${CASE_FOLDER_COPY_LIMIT} dosya kopyalayabilirsiniz.`, error: true })
      return
    }
    setCopied({ version: root.version, source: directory.path, names: files })
    setFeedback({ message: `${files.length} dosya kopyalamaya hazır. Hedef klasörde Yapıştır’ı seçin.` })
  }

  async function write(action: 'add' | 'paste') {
    if (!root || !canWrite || busy || listing.status === 'error' || (action === 'add' && !entries)) return
    const destination = { caseId, path: directory.path, locationVersion: root.version }
    if (action === 'paste' && !clipboard) return
    setBusy(true)
    setFeedback(null)
    try {
      const result = await browse(action === 'add' ? { ...destination, action } : { ...destination, action, source: clipboard!.source, names: clipboard!.names })
      if (currentDirectory.current !== directory) return
      if (result.kind === 'error' && result.reset) resetAccess(result.message)
      else if (result.kind === 'error') setFeedback({ message: result.message, error: true })
      else if (result.kind === 'copied' && (result.count || result.skipped)) {
        setFeedback({ message: `${result.count} dosya eklendi.${result.skipped ? ` ${result.skipped} dosya kopyalanamadı. Windows erişimini ve dosya konumunu kontrol edin.` : ''}`, error: result.skipped > 0 })
        if (result.count) selectFolder(directory.path, false, false)
      }
    } catch {
      if (currentDirectory.current === directory) setFeedback({ message: 'Dosya işlemi tamamlanamadı.', error: true })
    } finally { setBusy(false) }
  }

  function openMenu(event: MouseEvent, entry?: CaseFolderEntry) {
    event.preventDefault()
    event.stopPropagation()
    if (entry && !selection?.names.has(entry.name)) choose(entry)
    setMenu({ x: event.clientX, y: event.clientY, entry })
  }

  function handleKeys(event: KeyboardEvent<HTMLElement>) {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || full) return
    const key = event.key.toLowerCase()
    const control = event.ctrlKey || event.metaKey
    const focusedRow = event.target instanceof HTMLElement ? event.target.dataset.entry : undefined
    const focused = visible.find(entry => entry.name === (focusedRow ?? selection?.focus))
    if (key === 'escape' && menu) { setMenu(null); list.current?.focus() }
    else if (menu) return
    else if (control && key === 'f') search.current?.focus()
    else if (event.altKey && key === 'arrowup' && directory.path.length) selectFolder(directory.path.slice(0, -1))
    else if (key === 'f5') refresh()
    else if (!(event.target instanceof Node) || !list.current?.contains(event.target)) return
    else if (control && key === 'a' && visible.length) setSelection({ names: new Set(visible.map(entry => entry.name)), focus: focused?.name ?? visible[0]!.name, anchor: focused?.name ?? visible[0]!.name })
    else if (control && key === 'c') copy()
    else if (control && key === 'v') void write('paste')
    else if (key === 'enter' && focused && (event.target === list.current || focusedRow)) activate(focused)
    else if ((key === 'contextmenu' || key === 'f10' && event.shiftKey) && focused) {
      const rect = (event.target as HTMLElement).getBoundingClientRect()
      if (!selection?.names.has(focused.name)) choose(focused)
      setMenu({ x: rect.left, y: rect.bottom, entry: focused })
    } else if (['arrowup', 'arrowdown', 'home', 'end'].includes(key) && visible.length) {
      const index = focused ? visible.indexOf(focused) : -1
      const next = key === 'home' ? 0 : key === 'end' ? visible.length - 1 : Math.min(visible.length - 1, Math.max(0, index + (key === 'arrowup' ? -1 : 1)))
      const entry = visible[next]!
      pendingFocus.current = entry.name
      setPage(Math.floor(next / ROW_BATCH))
      choose(entry, { shiftKey: event.shiftKey })
    } else return
    event.preventDefault()
  }

  function resize(which: keyof typeof widths, value: number) {
    const min = which === 'tree' ? 15 : 22
    const max = which === 'tree' ? 31 : 45
    setWidths(current => ({ ...current, [which]: Math.round(Math.min(max, Math.max(min, value))) }))
  }

  function splitter(which: keyof typeof widths, label: string) {
    return <div className="case-explorer__splitter" role="separator" tabIndex={0} aria-label={label} aria-orientation="vertical"
      aria-valuemin={which === 'tree' ? 15 : 22} aria-valuemax={which === 'tree' ? 31 : 45} aria-valuenow={widths[which]}
      onPointerDown={event => { if (event.button === 0) event.currentTarget.setPointerCapture(event.pointerId) }}
      onPointerMove={event => {
        const bounds = panes.current?.getBoundingClientRect()
        if (!bounds?.width || !event.currentTarget.hasPointerCapture(event.pointerId)) return
        resize(which, 100 * (which === 'tree' ? event.clientX - bounds.left : bounds.right - event.clientX) / bounds.width)
      }}
      onKeyDown={event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        resize(which, widths[which] + (event.key === 'ArrowLeft' ? -2 : 2) * (which === 'tree' ? 1 : -1))
      }} />
  }

  function refresh() { if (listing.status === 'error' && listing.reset) selectFolder([], true); else selectFolder(directory.path) }

  function sortColumn(key: SortKey, label: string) {
    const active = key === sort.key
    return <th scope="col" aria-sort={active ? sort.direction === 1 ? 'ascending' : 'descending' : 'none'}>
      <button type="button" onClick={() => { setPage(0); setSort({ key, direction: active && sort.direction === 1 ? -1 : 1 }) }}>
        {label}{active && (sort.direction === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </button>
    </th>
  }

  return <section className="case-explorer" aria-labelledby="case-explorer-title" onKeyDown={handleKeys}>
    <header className="case-explorer__bar">
      <h2 id="case-explorer-title"><FolderOpen size={18} /> Genel Evrak</h2>
      <div className="case-explorer__actions">
        {canWrite && <><button type="button" className="button button--secondary" disabled={!entries || busy} onClick={() => void write('add')}><FilePlus size={15} /> Dosya ekle</button>
          <button type="button" className="icon-button" aria-label="Dosyaları yapıştır" title="Dosyaları yapıştır (Ctrl+V)" disabled={!entries || !clipboard || busy} onClick={() => void write('paste')}><ClipboardPaste size={16} /></button></>}
        <button type="button" className="icon-button" aria-label="Klasör listesini yenile" title="Klasör listesini yenile (F5)" onClick={refresh}><RefreshCw size={16} /></button>
        <OpenCaseFolderButton caseId={caseId} onOpened={() => selectFolder([], true)} />
      </div>
    </header>
    <div className="case-explorer__navigation">
      <button type="button" className="icon-button" aria-label="Üst klasöre git" title="Üst klasöre git" disabled={!directory.path.length} onClick={() => selectFolder(directory.path.slice(0, -1))}><ArrowUp size={16} /></button>
      <nav className="case-explorer__crumbs" aria-label="Klasör yolu">
        {[rootName, ...directory.path].map((name, index) => <span key={index}>
          {index > 0 && <ChevronRight size={12} aria-hidden="true" />}
          <button type="button" aria-current={index === directory.path.length ? 'location' : undefined} onClick={() => selectFolder(directory.path.slice(0, index))}>{name}</button>
        </span>)}
      </nav>
      <label className="case-explorer__search"><Search size={15} /><input ref={search} aria-label="Bu klasörde ara" placeholder="Bu klasörde ara" value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} /></label>
    </div>
    <div className="case-explorer__panes" ref={panes} style={{ '--explorer-tree': `${widths.tree}%`, '--explorer-preview': `${widths.preview}%` } as CSSProperties}>
      <nav className="case-explorer__tree" aria-label="Klasör ağacı" data-mobile-open={treeOnNarrow}>
        <h3>Klasörler</h3>
        <button className="case-explorer__tree-toggle text-button" type="button" aria-expanded={treeOnNarrow} onClick={() => setTreeOnNarrow(value => !value)}>
          {treeOnNarrow ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Klasörler
        </button>
        {root && <ul>{treeItem(rootName, [], 0)}</ul>}
      </nav>
      {splitter('tree', 'Klasör panelini yeniden boyutlandır')}
      <div className="case-explorer__list" ref={list} tabIndex={0} role="region" aria-label="Dosya listesi" onContextMenu={event => openMenu(event)}>
        <table aria-label="Klasör içeriği">
          <thead><tr>{sortColumn('name', 'Ad')}{sortColumn('modifiedAt', 'Değiştirilme')}{sortColumn('size', 'Boyut')}</tr></thead>
          <tbody>{rows.map(entry => <tr key={entry.name} data-selected={selection?.names.has(entry.name)} onClick={event => choose(entry, event)} onDoubleClick={() => activate(entry)} onContextMenu={event => openMenu(event, entry)}>
            <td><button type="button" data-entry={entry.name} title={entry.name} aria-pressed={selection?.names.has(entry.name) ?? false} tabIndex={tabStop === entry.name ? 0 : -1}><EntryIcon entry={entry} /><span>{entry.name}</span></button></td>
            <td>{entry.kind === 'file' && entry.modifiedAt ? dateFormat.format(new Date(entry.modifiedAt)) : '—'}</td>
            <td>{entry.kind === 'file' ? displaySize(entry.size) : '—'}</td>
          </tr>)}</tbody>
        </table>
        {listing.status === 'loading' && <p className="case-explorer__message" role="status">Klasör yükleniyor…</p>}
        {listing.status === 'error' && <p className="case-explorer__message" role="alert">{listing.message}</p>}
        {entries && !visible.length && <p className="case-explorer__message">{query.trim() ? 'Eşleşen öğe yok.' : 'Bu klasör boş.'}</p>}
      </div>
      {splitter('preview', 'Önizleme panelini yeniden boyutlandır')}
      {selected && root ? <CaseFilePreview key={selected.name} name={selected.name} details={`${fileType(selected.name)} · ${displaySize(selected.size)}`} browse={browse} caseId={caseId} directoryPath={directory.path} version={root.version} onReset={resetAccess} onReveal={() => void reveal(selected)} full={full} onFull={toggleFull}
        photo={photoIndex < 0 ? null : { index: photoIndex, count: photos.length, move: offset => {
          const entry = photos[photoIndex + offset]
          if (entry) { choose(entry); setPage(Math.floor(visible.indexOf(entry) / ROW_BATCH)) }
        } }} /> : <EmptyCaseFilePreview />}
    </div>
    <footer className="case-explorer__footer">
      <span>{entries ? `${visible.length} öğe` : ''}{entries && selectionCount > 0 ? ` · ${selectionCount} öğe seçili` : ''}</span>
      {pageCount > 1 && <div className="case-explorer__tool-group" aria-label="Dosya listesi sayfaları">
        <button className="icon-button" type="button" aria-label="Önceki dosya grubu" disabled={currentPage === 0} onClick={() => { setPage(currentPage - 1); list.current?.scrollTo(0, 0) }}><ChevronLeft size={14} /></button>
        <span>{currentPage + 1} / {pageCount}</span>
        <button className="icon-button" type="button" aria-label="Sonraki dosya grubu" disabled={currentPage + 1 === pageCount} onClick={() => { setPage(currentPage + 1); list.current?.scrollTo(0, 0) }}><ChevronRight size={14} /></button>
      </div>}
      {feedback && <span className="case-explorer__feedback" role={feedback.error ? 'alert' : 'status'}>{feedback.message}</span>}
    </footer>
    {menu && <div ref={context} className="case-explorer__context" role="menu" aria-label="Dosya işlemleri" style={{ left: Math.min(menu.x, Math.max(4, window.innerWidth - 220)), top: Math.min(menu.y, Math.max(4, window.innerHeight - 200)) }}
      onKeyDown={event => {
        if (event.key === 'Tab') { setMenu(null); return }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
        const index = items.indexOf(document.activeElement as HTMLButtonElement)
        items[(index + items.length + (event.key === 'ArrowUp' ? -1 : 1)) % items.length]?.focus()
        event.preventDefault()
        event.stopPropagation()
      }}>
      {menu.entry && <><button type="button" role="menuitem" onClick={() => { setMenu(null); activate(menu.entry!) }}><FolderOpen size={15} /> {menu.entry.kind === 'directory' ? 'Klasörü aç' : inlineTypes.has(fileType(menu.entry.name)) ? 'Önizlemeyi aç' : 'Gezginde göster'}</button>
        {menu.entry.kind === 'file' && <button type="button" role="menuitem" onClick={() => { setMenu(null); copy() }}><Copy size={15} /> Kopyala <kbd>Ctrl+C</kbd></button>}
        {menu.entry.kind === 'file' && inlineTypes.has(fileType(menu.entry.name)) && <button type="button" role="menuitem" onClick={() => { setMenu(null); void reveal(menu.entry!) }}><Folder size={15} /> Gezginde göster</button>}</>}
      {canWrite && <><button type="button" role="menuitem" disabled={!entries || busy || !clipboard} onClick={() => { setMenu(null); void write('paste') }}><ClipboardPaste size={15} /> Yapıştır <kbd>Ctrl+V</kbd></button>
        <button type="button" role="menuitem" disabled={!entries || busy} onClick={() => { setMenu(null); void write('add') }}><FilePlus size={15} /> Dosya ekle</button></>}
      <button type="button" role="menuitem" onClick={refresh}><RefreshCw size={15} /> Yenile <kbd>F5</kbd></button>
    </div>}
  </section>
}
