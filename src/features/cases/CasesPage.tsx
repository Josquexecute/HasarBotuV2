import { canUsePermission } from '../../app/permissions'
import { useOfficeDate } from '../../app/useOfficeDate'
import { useCaseReferences } from '../../data/useCaseReferences'
import { resolveCaseReferenceNames } from '../../data/caseReferenceNames'
import { deriveFollowUp, deriveStatus } from '../../data/httpAdapter'
import { useActiveCase, QUICK_NOTE_EVENT } from '../../app/activeCase'
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  CircleAlert,
  Columns3,
  ExternalLink,
  FilePlus2,
  Filter,
  History,
  ListFilter,
  NotebookPen,
  PanelRightOpen,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { useLocation, useNavigate, useNavigationType, useSearchParams } from 'react-router'
import { EmptyState } from '../../components/StateViews'
import { ModalFrame } from '../../components/ModalFrame'
import { formatCurrency } from '../../mocks/cases'
import { type OperationalAlertDataPort } from '../../data/operationalAlertPort'
import { getConfiguredDataSource, type CaseReferenceDataPort, type CasesDataPort } from '../../data/ports'
import { useInfiniteCasePages } from '../../data/useInfiniteCasePages'
import { CaseListCacheContext, createCaseListCache } from '../../data/caseListCache'
import { useCases } from '../../data/useCases'
import { useOperationalAlerts } from '../../data/useOperationalAlerts'
import { CaseReferenceFilters } from './CaseReferenceFilters'
import { CaseRowAlertBadge } from './CaseRowAlertBadge'
import {
  buildCasesPageQuery,
  isServerSortKey,
  type CasesFilterState,
} from './casesQuery'
import { useSession } from '../../app/sessionContext'
import type { CaseRecord, CaseType, SortKey } from '../../types/case'
import { matchesSearchQuery } from '../../utils/search'
import { CaseCreateModal } from './CaseCreateModal'
import { OpenCaseFolderButton } from '../../components/OpenCaseFolderButton'
import { NoticeSheetButton } from './NoticeSheetButton'
import { CASE_STAGE_OPTIONS } from './caseForm'
import { WindowedCaseRows } from './WindowedCaseRows'

type SortDirection = 'asc' | 'desc'

const statusClass: Record<CaseRecord['status'], string> = {
  Açık: 'status-pill--open',
  Kapalı: 'status-pill--waiting',
  Beklemede: 'status-pill--waiting',
  Gecikmiş: 'status-pill--late',
  'Kontrol Bekliyor': 'status-pill--review',
}

function SortIcon({ column, sortKey, direction }: { column: SortKey; sortKey: SortKey; direction: SortDirection }) {
  if (column !== sortKey) return <ArrowUpDown size={13} aria-hidden="true" />
  return direction === 'asc' ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" />
}

function QuickDetail({ item, source, onClose, onMockAction }: {
  item: CaseRecord
  source: 'mock' | 'api'
  onClose: () => void
  onMockAction: (message: string) => void
}) {
  const navigate = useNavigate()

  return (
    <aside className="quick-detail" aria-label="Hızlı dosya detayı">
      <header className="quick-detail__header">
        <div>
          <span className="eyebrow">Hızlı Bakış</span>
          <h2>{item.plate}</h2>
        </div>
        <div className="quick-detail__header-actions">
          <button className="icon-button" type="button" onClick={() => navigate(`/dosyalar/${item.caseId}`)} aria-label="Tam dosyayı aç">
            <ExternalLink size={17} />
          </button>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Hızlı detayı kapat">
            <X size={18} />
          </button>
        </div>
      </header>

      <div className="quick-detail__scroll">
        <section className="case-identity">
          <div className="case-identity__top">
            <span className="plate plate--large">{item.plate}</span>
            <span className={`status-pill ${statusClass[item.status]}`}>{item.status}</span>
          </div>
          <dl className="detail-grid">
            <div><dt>Dosya No</dt><dd>{item.officeNumber}</dd></div>
            <div><dt>Sigorta</dt><dd>{item.company}</dd></div>
            <div><dt>Dosya Türü</dt><dd>{item.type}</dd></div>
            <div><dt>Sorumlu</dt><dd>{item.assignee}</dd></div>
            <div className="detail-grid__wide"><dt>Araç</dt><dd>{item.vehicle}</dd></div>
          </dl>
        </section>

        {source !== 'api' && (item.missingDocuments > 0 ? (
          <section className="alert-panel alert-panel--warning">
            <strong>{item.missingDocuments} eksik evrak bulunuyor</strong>
            <span>{item.type === 'Seçiniz' ? 'Dosya türünü Trafik veya Kasko olarak seçin.' : item.type === 'Trafik' ? 'KTT / Beyan ve ruhsat kontrolü gerekiyor.' : 'Poliçe eki ve ruhsat kontrolü gerekiyor.'}</span>
          </section>
        ) : (
          <section className="alert-panel alert-panel--success">
            <Check size={17} />
            <div><strong>Zorunlu evraklar tam</strong><span>Kural setine göre açık eksik görünmüyor.</span></div>
          </section>
        ))}

        <section className="quick-section">
          <h3>Operasyon</h3>
          <dl className="detail-list">
            <div><dt>Aşama</dt><dd>{item.stage}</dd></div>
            <div><dt>Takip</dt><dd className={`text-${item.followUpTone}`}>{item.followUp}</dd></div>
            <div><dt>Servis</dt><dd>{item.service}</dd></div>
            {source !== 'api' && <div><dt>Tahmini Hasar</dt><dd>{formatCurrency(item.estimatedDamage)}</dd></div>}
          </dl>
        </section>

        <section className="quick-section">
          {source === 'api' ? (
            <><h3>Kısayollar</h3><div className="quick-detail__shortcuts"><button className="button button--secondary" type="button" onClick={() => navigate(`/dosyalar/${item.caseId}?tab=documents`)}>Evrakları aç</button><button className="button button--secondary" type="button" onClick={() => navigate(`/dosyalar/${item.caseId}?tab=operations`)}>Notları aç</button></div></>
          ) : <><h3><History size={14} /> Son Gelişmeler</h3><div className="timeline">
            {item.notes.map((note, index) => (
              <div className="timeline__item" key={note}>
                <i aria-hidden="true" />
                <span>{index === 0 ? 'Bugün, 11:45' : 'Dün, 16:20'}</span>
                <p>{note}</p>
              </div>
            ))}
          </div></>}
        </section>
      </div>

      <footer className="quick-detail__footer">
        <OpenCaseFolderButton caseId={item.caseId} />
        <NoticeSheetButton caseId={item.caseId} plate={item.plate} source={source} />
        <button className="button button--primary button--block" type="button" onClick={() => navigate(`/dosyalar/${item.caseId}`)}>
          <ExternalLink size={16} /> Tam Dosyayı Aç
        </button>
        {source === 'api' && <button className="button button--secondary" type="button" onClick={() => window.dispatchEvent(new Event(QUICK_NOTE_EVENT))}><NotebookPen size={15} /> Hızlı Not</button>}
        {source === 'mock' && <div>
          <button className="button button--secondary" type="button" onClick={() => onMockAction(`${item.plate} için mock not alanı hazırlandı.`)}><NotebookPen size={15} /> Not Ekle</button>
          <button className="button button--secondary" type="button" onClick={() => onMockAction(`${item.plate} için takip planlama önizlemesi açıldı.`)}><SlidersHorizontal size={15} /> Takip Ayarla</button>
        </div>}
      </footer>
    </aside>
  )
}

function MockNewNoticeModal({ onClose }: { onClose: () => void }) {
  const [documentSelected, setDocumentSelected] = useState(false)
  const [analysisReady, setAnalysisReady] = useState(false)

  return (
    <ModalFrame labelledBy="new-notice-title" onClose={onClose}>
        <header className="modal__header">
          <div><span className="eyebrow">Mock akış</span><h2 id="new-notice-title">Yeni İhbar Oluştur</h2></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Pencereyi kapat"><X size={18} /></button>
        </header>
        <div className="modal__body">
          <div className="stepper" aria-label="İhbar adımları">
            <span className="stepper__item stepper__item--active"><i>1</i>Belge Seçimi</span>
            <span className="stepper__item"><i>2</i>Alan Kontrolü</span>
            <span className="stepper__item"><i>3</i>Önizleme</span>
          </div>
          <div className="upload-placeholder">
            <FilePlus2 size={30} aria-hidden="true" />
            <strong>{documentSelected ? 'Mock belgeler seçildi' : 'İhbar Föyü ve Poliçe'}</strong>
            <span>{analysisReady ? 'Alan kontrolü için örnek belge önizlemesi hazır.' : 'Bu prototip gerçek dosya yüklemez veya diske yazmaz.'}</span>
            <button className="button button--secondary" type="button" onClick={() => setDocumentSelected(true)}>{documentSelected ? <><Check size={15} /> Belge seçildi</> : 'Mock belge seç'}</button>
          </div>
        </div>
        <footer className="modal__footer">
          <button className="button button--secondary" type="button" onClick={onClose}>İptal</button>
          <button className="button button--primary" type="button" disabled={!documentSelected || analysisReady} onClick={() => setAnalysisReady(true)}>{analysisReady ? 'Mock analiz hazır' : 'Analize Geç'}</button>
        </footer>
    </ModalFrame>
  )
}

/** `alertPort` ve `casesPort` yalnız testler için enjekte edilir. */
export function CasesPage({ alertPort, casesPort, referencePort }: {
  alertPort?: OperationalAlertDataPort
  casesPort?: CasesDataPort
  referencePort?: CaseReferenceDataPort
} = {}) {
  // API modunda bütün liste ÇEKİLMEZ; yalnız mock prototipi bu hook'u kullanır.
  const { cases, source } = useCases({ enabled: getConfiguredDataSource() !== 'api' })
  const referenceData = useCaseReferences(referencePort, {}, source === 'api')
  const session = useSession()
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigationType = useNavigationType()
  const queryParam = searchParams.get('q') ?? ''
  const queryKey = `${location.key}#${queryParam}`
  const [localCache] = useState(createCaseListCache)
  const sharedCache = useContext(CaseListCacheContext)
  const cache = sharedCache ?? localCache
  const scope = `${source}:${session.user?.organizationId ?? ''}:${session.user?.id ?? ''}`
  const [saved] = useState(() => {
    const prior = cache.read()
    // The detail back button returns to /dosyalar without q. A fresh global search
    // must instead take its query from the URL, even when it repeats an earlier q.
    const returning = queryParam === '' || navigationType === 'POP' && prior?.view?.queryParam === queryParam
    return prior?.scope === scope && prior.port === casesPort && returning ? prior : undefined
  })
  // Arama kutusu URL'deki `q` ile senkronizedir. Senkronizasyon efektte
  // yazilmaz: girdi, ait oldugu navigasyon kimligiyle birlikte tutulur ve
  // anahtar degisince RENDER sirasinda URL degerine doner. Boylece global
  // aramadan gelen sorgu ayni render'da kutuda gorunur; onceden bir frame
  // boyunca onceki sorgu kaliyordu.
  const [queryInput, setQueryInput] = useState<{ key: string; value: string }>({ key: queryKey, value: saved?.view?.query ?? queryParam })
  const [typeFilter, setTypeFilter] = useState<'Tümü' | CaseType>(saved?.view?.typeFilter ?? 'Tümü')
  const [stageFilter, setStageFilter] = useState(saved?.view?.stageFilter ?? 'Tümü')
  const [statusFilter, setStatusFilter] = useState(saved?.view?.statusFilter ?? 'Açık')
  const [assigneeFilter, setAssigneeFilter] = useState(saved?.view?.assigneeFilter ?? 'Tümü')
  const [serviceFilter, setServiceFilter] = useState(saved?.view?.serviceFilter ?? 'Tümü')
  const followUpFilter = 'Tümü'
  const [sortKey, setSortKey] = useState<SortKey>(saved?.view?.sortKey ?? 'lastAction')
  const [direction, setDirection] = useState<SortDirection>(saved?.view?.direction ?? 'asc')
  const [filtersOpen, setFiltersOpen] = useState(saved?.view?.filtersOpen ?? true)
  const [detailOpen, setDetailOpen] = useState(() => saved?.view?.detailOpen ?? window.innerWidth >= 1024)
  const [selectedId, setSelectedId] = useState(saved?.view?.selectedId ?? cases[0]?.caseId ?? '')
  const [activePage, setActivePage] = useState(1)
  const [prototypeNotice, setPrototypeNotice] = useState('')
  const showNewModal = searchParams.get('yeni') === 'true'
  const query = queryInput.key === queryKey ? queryInput.value : queryParam
  const setQuery = useCallback((value: string) => setQueryInput({ key: queryKey, value }), [queryKey])


  // Filtering and ordering remain on the server; scrolling requests only the next batch.
  const today = useOfficeDate()
  const filterState: CasesFilterState = useMemo(() => ({
    query,
    typeFilter,
    stageFilter: stageFilter as CasesFilterState['stageFilter'],
    statusFilter: statusFilter as CasesFilterState['statusFilter'],
    responsibleUserId: assigneeFilter,
    serviceId: serviceFilter,
    followUpFilter: followUpFilter as CasesFilterState['followUpFilter'],
    // Sunucuda sıralanamayan sütunlar API modunda tıklanabilir değildir;
    // yine de güvenli varsayılana düşülür.
    sortKey: isServerSortKey(sortKey) ? sortKey : 'lastAction',
    direction,
    page: 1,
  }), [assigneeFilter, direction, followUpFilter, query, serviceFilter, sortKey, stageFilter, statusFilter, typeFilter])
  const serverQuery = useMemo(
    () => buildCasesPageQuery(filterState, today),
    [filterState, today],
  )
  const list = useInfiniteCasePages(serverQuery, casesPort, saved)
  const { status: pageStatus, hasMore, moreStatus, loadMore, reload } = list
  const scrollArea = useRef<HTMLDivElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const restoration = useRef({ key: list.queryKey, top: saved?.view?.scrollTop ?? 0, left: saved?.view?.scrollLeft ?? 0, done: false })
  useLayoutEffect(() => {
    const element = scrollArea.current
    if (!element) return
    if (restoration.current.key !== list.queryKey) {
      restoration.current = { key: list.queryKey, top: 0, left: 0, done: false }
      element.scrollTop = 0
      element.dispatchEvent(new Event('scroll'))
    }
    if (pageStatus === 'ok' && !restoration.current.done) {
      element.scrollTop = restoration.current.top
      element.scrollLeft = restoration.current.left
      restoration.current.done = true
      element.dispatchEvent(new Event('scroll'))
    }
  }, [list.queryKey, pageStatus])
  useEffect(() => {
    if (source !== 'api' || pageStatus !== 'ok' || moreStatus !== 'ok' || !hasMore || !sentinel.current || !scrollArea.current || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void loadMore()
    }, { root: scrollArea.current, rootMargin: '0px 0px 320px 0px' })
    observer.observe(sentinel.current)
    return () => observer.disconnect()
  }, [hasMore, loadMore, moreStatus, pageStatus, source])
  useEffect(() => {
    cache.write({ scope, port: casesPort, queryKey: list.queryKey, pages: list.pages, view: {
      queryParam, query, typeFilter, stageFilter, statusFilter, assigneeFilter, serviceFilter, sortKey, direction,
      filtersOpen, detailOpen, selectedId, scrollTop: scrollArea.current?.scrollTop ?? 0, scrollLeft: scrollArea.current?.scrollLeft ?? 0,
    } })
  }, [assigneeFilter, cache, casesPort, detailOpen, direction, filtersOpen, list.pages, list.queryKey, query, queryParam, scope, selectedId, serviceFilter, sortKey, stageFilter, statusFilter, typeFilter])

  const mockFilteredCases = useMemo(() => {
    const result = cases.filter((item) => {
      const matchesQuery = matchesSearchQuery(query, [
        item.plate,
        item.officeNumber,
        item.noticeNumber,
        item.claimNumber,
        item.company,
        item.type,
        item.status,
        item.stage,
        item.assignee,
        item.expert,
        item.service,
        item.vehicle,
        item.insured,
        item.followUp,
      ])
      const matchesType = typeFilter === 'Tümü' || item.type === typeFilter
      const matchesStage = stageFilter === 'Tümü' || item.stage === stageFilter
      const matchesStatus = statusFilter === 'Kapalı' ? item.status === 'Kapalı' : item.status !== 'Kapalı'
      const matchesAssignee = assigneeFilter === 'Tümü' || item.assignee === assigneeFilter
      const matchesService = serviceFilter === 'Tümü' || item.service === serviceFilter
      const matchesFollowUp = followUpFilter === 'Tümü' || item.followUpTone === followUpFilter
      return matchesQuery && matchesType && matchesStage && matchesStatus && matchesAssignee && matchesService && matchesFollowUp
    })

    return [...result].sort((a, b) => {
      const aValue = a[sortKey]
      const bValue = b[sortKey]
      const comparison = typeof aValue === 'number' && typeof bValue === 'number'
        ? aValue - bValue
        : String(aValue).localeCompare(String(bValue), 'tr')
      return direction === 'asc' ? comparison : -comparison
    })
  }, [assigneeFilter, cases, direction, followUpFilter, query, serviceFilter, sortKey, stageFilter, statusFilter, typeFilter])

  /** Loaded batches stay visible while the next one is being fetched. */
  const visibleCases = useMemo(
    () => (source === 'api' ? list.items.map(item => resolveCaseReferenceNames(item.lifecycleStatus ? {
      ...item,
      ...deriveFollowUp(item.followUpDate ?? null, today),
      status: deriveStatus({ status: item.lifecycleStatus, followUpDate: item.followUpDate ?? null }, today),
    } : item, referenceData.references)) : mockFilteredCases),
    [list.items, mockFilteredCases, source, referenceData.references, today],
  )
  const totalCount = source === 'api' ? list.totalCount : mockFilteredCases.length

  const selectedCase = visibleCases.find((item) => item.caseId === selectedId) ?? visibleCases[0]
  const activateCase = useActiveCase(selectedCase, source)
  const hasFilters = query !== '' || typeFilter !== 'Tümü' || stageFilter !== 'Tümü' || statusFilter !== 'Açık' || assigneeFilter !== 'Tümü' || serviceFilter !== 'Tümü'

  // The alert hook splits the loaded IDs into API-sized groups.
  const alertCaseIds = useMemo(
    () => (source === 'api'
      ? visibleCases.map((item) => item.caseId)
      : undefined),
    [source, visibleCases],
  )
  const { alerts: rowAlerts, status: alertStatus, reload: reloadAlerts } = useOperationalAlerts(alertPort, alertCaseIds)
  const alertSummaryByCase = useMemo(
    () => new Map((rowAlerts?.caseSummaries ?? []).map((summary) => [summary.caseId, summary])),
    [rowAlerts],
  )

  const resetFilters = () => {
    setQuery('')
    setTypeFilter('Tümü')
    setStageFilter('Tümü')
    setStatusFilter('Açık')
    setAssigneeFilter('Tümü')
    setServiceFilter('Tümü')
    setSearchParams({})
  }

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setDirection((current) => current === 'asc' ? 'desc' : 'asc')
    else {
      setSortKey(key)
      setDirection('asc')
    }
  }

  const closeNewModal = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('yeni')
    setSearchParams(next)
  }

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (showNewModal) closeNewModal()
      else if (detailOpen) setDetailOpen(false)
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  })

  return (
    <main className="page cases-page">
      <section className="page-heading page-heading--compact">
        <div>
          <h1>Tüm Dosyalar <span className="heading-count">{totalCount}</span></h1>
          {source === 'api' && pageStatus === 'unauthorized' && <p role="alert" className="page-subtitle">Oturumunuz sona erdi. Yeniden giriş yapın.</p>}
          {source === 'api' && pageStatus === 'unavailable' && <p role="alert" className="page-subtitle">Dosyalar yüklenemedi. Bağlantınızı kontrol edin.</p>}
          {source === 'api' && pageStatus === 'loading' && <p role="status" className="page-subtitle">Dosyalar yükleniyor…</p>}
        </div>
        <div className="heading-actions">
          {source === 'api' && <button className="button button--secondary" type="button" onClick={() => { reload(); reloadAlerts() }} disabled={pageStatus === 'loading'}><RefreshCw size={15} />Listeyi Yenile</button>}
          <button className={`button button--secondary${filtersOpen ? ' button--active' : ''}`} type="button" onClick={() => setFiltersOpen((value) => !value)}>
            <Filter size={15} /> Filtreler {hasFilters && <i className="button__indicator" />}
          </button>
          {source === 'mock' && <button className="button button--secondary" type="button" onClick={() => setPrototypeNotice('Sütun görünümü kompakt varsayılanlara sıfırlandı.')}><Columns3 size={15} /> Sütunlar</button>}
          {!detailOpen && (
            <button className="button button--secondary" type="button" onClick={() => setDetailOpen(true)}><PanelRightOpen size={15} /> Hızlı Bakış</button>
          )}
          <button className="button button--primary" type="button" disabled={source === 'api' && !canUsePermission(session.user,'case_write',['admin','expert','case_manager','secretary','accounting'])} onClick={() => setSearchParams({ yeni: 'true' })}>
            <FilePlus2 size={16} /> Yeni Dosya
          </button>
        </div>
      </section>

      {filtersOpen && (
        <section className="filterbar" aria-label="Dosya filtreleri">
          <label className="field field--search filterbar__search">
            <Search size={15} />
            <span className="sr-only">Dosyalarda ara</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Plaka, dosya no, şirket, kişi veya servis ara..." />
            {query && <button type="button" onClick={() => setQuery('')} aria-label="Aramayı temizle"><X size={14} /></button>}
          </label>
          <label className="select-field"><span className="select-field__label">Tür</span><select aria-label="Dosya türü" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as 'Tümü' | CaseType)}><option>Tümü</option><option>Trafik</option><option>Kasko</option><option>Seçiniz</option></select><ChevronDown size={14} /></label>
          <label className="select-field"><span className="select-field__label">Aşama</span><select aria-label="Dosya aşaması" value={stageFilter} onChange={(event) => setStageFilter(event.target.value)}><option>Tümü</option>{CASE_STAGE_OPTIONS.map(option => <option key={option.value}>{option.label}</option>)}<option>Kapalı</option></select><ChevronDown size={14} /></label>
          <label className="select-field"><span className="select-field__label">Durum</span><select aria-label="Dosya durumu" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>Açık</option><option>Kapalı</option></select><ChevronDown size={14} /></label>
          {source === 'api' ? (
            <CaseReferenceFilters
              responsibleUserId={assigneeFilter}
              serviceId={serviceFilter}
              onResponsibleChange={setAssigneeFilter}
              onServiceChange={setServiceFilter}
              port={referencePort}
              referenceData={referenceData}
            />
          ) : (
            <>
              <label className="select-field"><span className="select-field__label">Sorumlu</span><select aria-label="Dosya sorumlusu" value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)}><option>Tümü</option>{Array.from(new Set(cases.map((item) => item.assignee))).map((assignee) => <option key={assignee}>{assignee}</option>)}</select><ChevronDown size={14} /></label>
              <label className="select-field"><span className="select-field__label">Servis</span><select aria-label="Dosya servisi" value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value)}><option>Tümü</option>{Array.from(new Set(cases.map((item) => item.service))).map((service) => <option key={service}>{service}</option>)}</select><ChevronDown size={14} /></label>
            </>
          )}
          <label className="select-field"><span className="select-field__label">Sırala</span><select aria-label="Dosya sıralaması" value={sortKey} onChange={(event) => { setSortKey(event.target.value as SortKey); setDirection(event.target.value === 'lastAction' ? 'desc' : 'asc') }}><option value="lastAction">Son güncelleme</option><option value="followUp">Takip tarihi</option><option value="officeNumber">Dosya numarası</option><option value="plate">Plaka</option></select><ChevronDown size={14} /></label>
          <label className="select-field"><span className="select-field__label">Yön</span><select aria-label="Sıralama yönü" value={direction} onChange={(event) => setDirection(event.target.value as SortDirection)}><option value="asc">Artan / eski önce</option><option value="desc">Azalan / yeni önce</option></select><ChevronDown size={14} /></label>
          {hasFilters && <button className="filterbar__clear" type="button" onClick={resetFilters}>Temizle</button>}
        </section>
      )}

      <div className={`cases-workarea${detailOpen ? ' cases-workarea--detail' : ''}`}>
        <section className="case-list-panel">
          <div className="table-scroll" ref={scrollArea} aria-label="Dosya listesi" onScroll={event => {
            const element = event.currentTarget
            cache.saveScroll(scope, element.scrollTop, element.scrollLeft)
            if (typeof IntersectionObserver === 'undefined' && element.clientHeight > 0 && moreStatus === 'ok' && element.scrollHeight - element.scrollTop - element.clientHeight < 320) void loadMore()
          }}>
            {visibleCases.length === 0 ? (source !== 'api' || pageStatus === 'ok' ? <EmptyState onReset={resetFilters} /> : null) : (
              <table className="case-table case-table--windowed" aria-rowcount={visibleCases.length + 1}>
                <thead>
                  <tr>
                    <th><button type="button" onClick={() => handleSort('plate')}>Plaka / Dosya No <SortIcon column="plate" sortKey={sortKey} direction={direction} /></button></th>
                    <th>İhbar Föyü No</th>
                    <th>Hasar Dosya No</th>
                    {/* Sunucuda sıralanamayan sütunlar API modunda tıklanabilir sunulmaz. */}
                    <th>{source === 'api' ? 'Şirket / Tür' : <button type="button" onClick={() => handleSort('company')}>Şirket / Tür <SortIcon column="company" sortKey={sortKey} direction={direction} /></button>}</th>
                    <th>Durum</th>
                    <th>{source === 'api' ? 'Aşama' : <button type="button" onClick={() => handleSort('stage')}>Aşama <SortIcon column="stage" sortKey={sortKey} direction={direction} /></button>}</th>
                    <th>{source === 'api' ? 'Eksik' : <button type="button" onClick={() => handleSort('missingDocuments')}>Eksik <SortIcon column="missingDocuments" sortKey={sortKey} direction={direction} /></button>}</th>
                    {source === 'api' && <th>Uyarı</th>}
                    <th>{source === 'api' ? 'Sorumlu' : <button type="button" onClick={() => handleSort('assignee')}>Sorumlu <SortIcon column="assignee" sortKey={sortKey} direction={direction} /></button>}</th>
                    <th>Servis</th>
                    <th>Klasör / Föy</th>
                    <th><button type="button" onClick={() => handleSort('followUp')}>Takip <SortIcon column="followUp" sortKey={sortKey} direction={direction} /></button></th>
                    <th><button type="button" onClick={() => handleSort('lastAction')}>Son İşlem <SortIcon column="lastAction" sortKey={sortKey} direction={direction} /></button></th>
                  </tr>
                </thead>
                <WindowedCaseRows key={`${scope}:${list.queryKey}`} items={visibleCases} columns={source === 'api' ? 13 : 12} initialScrollTop={saved?.queryKey === list.queryKey ? saved.view?.scrollTop : 0} initialRowHeights={saved?.queryKey === list.queryKey ? saved.rowHeights : undefined} onHeightsChange={heights => cache.saveRowHeights(scope, list.queryKey, heights)}>
                  {(item, index, { onDialogChange, ...rowProps }) => (
                    <tr
                      {...rowProps}
                      key={item.caseId}
                      className={`${selectedCase?.caseId === item.caseId ? 'is-selected ' : ''}${index % 2 === 1 ? 'is-even' : ''}`}
                      tabIndex={0}
                      onClick={() => { setSelectedId(item.caseId); setDetailOpen(true); activateCase(item) }}
                      onDoubleClick={() => navigate(`/dosyalar/${item.caseId}`)}
                      onKeyDown={(event) => {
                        if (event.key === ' ') { event.preventDefault(); setSelectedId(item.caseId); setDetailOpen(true); activateCase(item) }
                        if (event.key === 'Enter') navigate(`/dosyalar/${item.caseId}`)
                      }}
                    >
                      <td><span className="plate plate--table">{item.plate}</span><small>{item.officeNumber}</small></td>
                      <td className="mono">{item.noticeNumber}</td>
                      <td className="mono">{item.claimNumber}</td>
                      <td><strong>{item.company}</strong><small>{item.type}</small></td>
                      <td><span className={`status-pill ${statusClass[item.status]}`}>{item.status}</span></td>
                      <td><span className="stage-text">{item.stage}</span></td>
                      <td>{source === 'api'
                        ? <span title="Gerçek evrak özeti detay sekmesinde yüklenir">—</span>
                        : item.missingDocuments > 0
                          ? <span className="missing-count">{item.missingDocuments}</span>
                          : <span className="complete-mark"><Check size={14} /></span>}</td>
                      {source === 'api' && (
                        <td>
                          <CaseRowAlertBadge
                            summary={alertStatus === 'ok' ? alertSummaryByCase.get(item.caseId) : undefined}
                            plate={item.plate}
                            onOpen={() => navigate(`/dosyalar/${item.caseId}`)}
                          />
                        </td>
                      )}
                      <td>{item.assignee}</td>
                      <td className="truncate-cell" title={item.service}>{item.service}</td>
                      <td><div className="case-table-actions"><OpenCaseFolderButton compact caseId={item.caseId} /><NoticeSheetButton compact caseId={item.caseId} plate={item.plate} source={source} onOpenChange={onDialogChange} /></div></td>
                      <td><span className={`follow-up follow-up--${item.followUpTone}`}>{item.followUp}</span></td>
                      <td>{item.lastAction}</td>
                    </tr>
                  )}
                </WindowedCaseRows>
              </table>
            )}
            {source === 'api' && <div ref={sentinel} className="case-list-sentinel" aria-hidden="true" />}
          </div>
          <footer className="table-footer">
            <span>{visibleCases.length} / {source === 'api' ? totalCount : '1.284'} dosya gösteriliyor</span>
            <span className="table-footer__hint"><ListFilter size={13} />Sıralama: {{ lastAction: 'Son güncelleme',followUp: 'Takip tarihi',officeNumber: 'Dosya numarası',plate: 'Plaka' }[sortKey as 'lastAction' | 'followUp' | 'officeNumber' | 'plate'] ?? 'Seçili sütun'} · {direction === 'asc' ? 'artan' : 'azalan'}</span>
            {source === 'api' && alertStatus === 'loading' && (
              <span className="table-footer__hint">Uyarı göstergesi yükleniyor…</span>
            )}
            {source === 'api' && alertStatus !== 'ok' && alertStatus !== 'loading' && (
              <span className="table-footer__warning" role="status">
                <CircleAlert size={13} />Uyarı göstergesi yüklenemedi; satırlar uyarısız sayılmıyor.
              </span>
            )}
            {source === 'api' ? (
              <div className="case-list-loading" aria-live="polite">
                {moreStatus === 'unavailable' && <span>Diğer dosyalar yüklenemedi. Yüklenen kayıtlar korunuyor.</span>}
                {pageStatus === 'unavailable' ? <button className="button button--secondary" type="button" onClick={reload}>Yeniden dene</button>
                  : hasMore ? <button className="button button--secondary" type="button" disabled={pageStatus !== 'ok' || moreStatus === 'loading'} onClick={() => void loadMore()}>{moreStatus === 'loading' ? 'Dosyalar yükleniyor…' : moreStatus === 'unavailable' ? 'Diğer dosyaları yeniden yükle' : 'Daha fazla dosya yükle'}</button>
                  : pageStatus === 'ok' && visibleCases.length > 0 ? <span>Tüm dosyalar yüklendi.</span> : null}
              </div>
            ) : <div className="pagination">
              <button type="button" disabled={activePage === 1} onClick={() => setActivePage((page) => Math.max(1, page - 1))}>‹</button>
              {[1, 2, 3].map((page) => <button className={activePage === page ? 'is-active' : ''} type="button" key={page} onClick={() => setActivePage(page)}>{page}</button>)}
              <span>…</span>
              <button type="button" onClick={() => setActivePage((page) => Math.min(3, page + 1))}>›</button>
            </div>}
          </footer>
        </section>

        {detailOpen && selectedCase && <QuickDetail item={selectedCase} source={source} onClose={() => setDetailOpen(false)} onMockAction={setPrototypeNotice} />}
      </div>

      {showNewModal && source === 'mock' && <MockNewNoticeModal onClose={closeNewModal} />}
      {showNewModal && source === 'api' && session.user !== null && canUsePermission(session.user,'case_write',['admin','expert','case_manager','secretary','accounting']) && (
        <CaseCreateModal
          currentUser={session.user}
          onClose={closeNewModal}
          onUnauthorized={session.reportUnauthorized}
        />
      )}
      {prototypeNotice && <button className="prototype-toast" type="button" onClick={() => setPrototypeNotice('')} aria-live="polite"><Check size={15} />{prototypeNotice}<X size={14} /></button>}
    </main>
  )
}
