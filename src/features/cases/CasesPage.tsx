import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
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
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { EmptyState } from '../../components/StateViews'
import { formatCurrency } from '../../mocks/cases'
import { OPERATIONAL_ALERT_CASE_FILTER_LIMIT, type OperationalAlertDataPort } from '../../data/operationalAlertPort'
import { getConfiguredDataSource, type CaseReferenceDataPort, type CasesDataPort } from '../../data/ports'
import { useCasePage } from '../../data/useCasePage'
import { useCases } from '../../data/useCases'
import { useOperationalAlerts } from '../../data/useOperationalAlerts'
import { CaseReferenceFilters } from './CaseReferenceFilters'
import { CaseRowAlertBadge } from './CaseRowAlertBadge'
import {
  buildCasesPageQuery,
  clampPage,
  filterIdentity,
  isServerSortKey,
  type CasesFilterState,
} from './casesQuery'
import { useSession } from '../../app/sessionContext'
import type { CaseRecord, CaseType, SortKey } from '../../types/case'
import { matchesSearchQuery } from '../../utils/search'
import { CaseCreateModal } from './CaseCreateModal'

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

        {source === 'api' ? (
          <section className="alert-panel alert-panel--warning">
            <AlertTriangle size={17} />
            <div><strong>Evrak özeti bu listede hesaplanmıyor</strong><span>Gerçek kural sonucunu dosyanın Evrak ve Fotoğraf sekmesinde açın.</span></div>
          </section>
        ) : item.missingDocuments > 0 ? (
          <section className="alert-panel alert-panel--warning">
            <strong>{item.missingDocuments} eksik evrak bulunuyor</strong>
            <span>{item.type === 'Trafik' ? 'KTT / Beyan ve ruhsat kontrolü gerekiyor.' : 'Poliçe eki ve ruhsat kontrolü gerekiyor.'}</span>
          </section>
        ) : (
          <section className="alert-panel alert-panel--success">
            <Check size={17} />
            <div><strong>Zorunlu evraklar tam</strong><span>Kural setine göre açık eksik görünmüyor.</span></div>
          </section>
        )}

        <section className="quick-section">
          <h3>Operasyon</h3>
          <dl className="detail-list">
            <div><dt>Aşama</dt><dd>{item.stage}</dd></div>
            <div><dt>Takip</dt><dd className={`text-${item.followUpTone}`}>{item.followUp}</dd></div>
            <div><dt>Servis</dt><dd>{item.service}</dd></div>
            <div><dt>Tahmini Hasar</dt><dd>{source === 'api' ? 'Henüz bağlı değil' : formatCurrency(item.estimatedDamage)}</dd></div>
          </dl>
        </section>

        <section className="quick-section">
          <h3><History size={14} /> Son Gelişmeler</h3>
          {source === 'api' ? (
            <p>Gerçek not, görev ve takip geçmişi dosya detayındaki Operasyon sekmesinde gösterilir.</p>
          ) : <div className="timeline">
            {item.notes.map((note, index) => (
              <div className="timeline__item" key={note}>
                <i aria-hidden="true" />
                <span>{index === 0 ? 'Bugün, 11:45' : 'Dün, 16:20'}</span>
                <p>{note}</p>
              </div>
            ))}
          </div>}
        </section>
      </div>

      <footer className="quick-detail__footer">
        <button className="button button--primary button--block" type="button" onClick={() => navigate(`/dosyalar/${item.caseId}`)}>
          <ExternalLink size={16} /> Tam Dosyayı Aç
        </button>
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
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose()
    }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="new-notice-title">
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
      </section>
    </div>
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
  const session = useSession()
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryParam = searchParams.get('q') ?? ''
  const [query, setQuery] = useState(queryParam)
  const [typeFilter, setTypeFilter] = useState<'Tümü' | CaseType>('Tümü')
  const [stageFilter, setStageFilter] = useState('Tümü')
  const [statusFilter, setStatusFilter] = useState('Tümü')
  const [assigneeFilter, setAssigneeFilter] = useState('Tümü')
  const [serviceFilter, setServiceFilter] = useState('Tümü')
  const [followUpFilter, setFollowUpFilter] = useState('Tümü')
  const [sortKey, setSortKey] = useState<SortKey>('lastAction')
  const [direction, setDirection] = useState<SortDirection>('asc')
  const [filtersOpen, setFiltersOpen] = useState(true)
  const [detailOpen, setDetailOpen] = useState(true)
  const [selectedId, setSelectedId] = useState(cases[0]?.caseId ?? '')
  const [activePage, setActivePage] = useState(1)
  const [prototypeNotice, setPrototypeNotice] = useState('')
  const showNewModal = searchParams.get('yeni') === 'true'

  useEffect(() => {
    setQuery(queryParam)
  }, [location.key, queryParam])

  // API modunda filtre/sıralama/sayfalama SUNUCUDA uygulanır; istemci yalnız
  // aktif sayfayı okur. Mock modda prototip davranışı (istemci filtresi ve
  // sahte sayfalama) olduğu gibi korunur.
  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])
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
    page: activePage,
  }), [activePage, assigneeFilter, direction, followUpFilter, query, serviceFilter, sortKey, stageFilter, statusFilter, typeFilter])
  const serverQuery = useMemo(
    () => buildCasesPageQuery(filterState, today),
    [filterState, today],
  )
  const { page: casePage, status: pageStatus } = useCasePage(serverQuery, casesPort)

  // Filtre, arama veya sıralama değişince sayfa 1'e döner.
  const filterKey = filterIdentity(filterState)
  const previousFilterKey = useRef(filterKey)
  useEffect(() => {
    if (previousFilterKey.current === filterKey) return
    previousFilterKey.current = filterKey
    setActivePage(1)
  }, [filterKey])

  // Son sayfadaki kayıtlar silinir veya filtre dışı kalırsa geçerli son sayfaya dön.
  // Karşılaştırma İSTENEN sayfa ile yapılır: yüklenmiş (eski) sayfa ile
  // karşılaştırmak, uçuştaki sayfa değişimini geri alırdı.
  useEffect(() => {
    if (source !== 'api' || casePage === null || pageStatus !== 'ok') return
    const safePage = clampPage(activePage, casePage.totalPages)
    if (safePage !== activePage) setActivePage(safePage)
  }, [activePage, casePage, pageStatus, source])

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
      const matchesStatus = statusFilter === 'Tümü' || item.status === statusFilter
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

  /** Ekranda render edilen satırlar: API modunda yalnız aktif sayfa. */
  const visibleCases = useMemo(
    () => (source === 'api' ? (casePage?.items ?? []) : mockFilteredCases),
    [casePage, mockFilteredCases, source],
  )
  const totalCount = source === 'api' ? (casePage?.totalCount ?? 0) : mockFilteredCases.length
  const totalPages = source === 'api' ? (casePage?.totalPages ?? 0) : 3

  const selectedCase = visibleCases.find((item) => item.caseId === selectedId) ?? visibleCases[0]
  const hasFilters = query !== '' || typeFilter !== 'Tümü' || stageFilter !== 'Tümü' || statusFilter !== 'Tümü' || assigneeFilter !== 'Tümü' || serviceFilter !== 'Tümü' || followUpFilter !== 'Tümü'

  // Uyarı isteğinde yalnız AKTİF SAYFA kimlikleri gönderilir. Sayfa boyutu
  // sözleşmedeki `caseIds` sınırının altında olduğu için normal kullanımda
  // "bilinmiyor" uyarı durumu kalmaz. Mock modda hook API çağrısı yapmaz.
  const alertCaseIds = useMemo(
    () => (source === 'api'
      ? visibleCases.slice(0, OPERATIONAL_ALERT_CASE_FILTER_LIMIT).map((item) => item.caseId)
      : undefined),
    [source, visibleCases],
  )
  const { alerts: rowAlerts, status: alertStatus } = useOperationalAlerts(alertPort, alertCaseIds)
  const alertSummaryByCase = useMemo(
    () => new Map((rowAlerts?.caseSummaries ?? []).map((summary) => [summary.caseId, summary])),
    [rowAlerts],
  )

  const resetFilters = () => {
    setQuery('')
    setTypeFilter('Tümü')
    setStageFilter('Tümü')
    setStatusFilter('Tümü')
    setAssigneeFilter('Tümü')
    setServiceFilter('Tümü')
    setFollowUpFilter('Tümü')
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
          {source === 'api' && pageStatus === 'unauthorized' && <p role="alert" className="page-subtitle">Oturum gerekli: gerçek veriye erişmek için API oturumu açın. Sahte veri gösterilmiyor.</p>}
          {source === 'api' && pageStatus === 'unavailable' && <p role="alert" className="page-subtitle">Servis şu anda kullanılamıyor. Sahte veri gösterilmiyor; bağlantıyı kontrol edin.</p>}
          {source === 'api' && pageStatus === 'loading' && <p role="status" className="page-subtitle">Gerçek veriler yükleniyor…</p>}
          <p>Açık ekspertiz dosyaları · Tek tık hızlı bakış, çift tık tam dosya</p>
        </div>
        <div className="heading-actions">
          <button className={`button button--secondary${filtersOpen ? ' button--active' : ''}`} type="button" onClick={() => setFiltersOpen((value) => !value)}>
            <Filter size={15} /> Filtreler {hasFilters && <i className="button__indicator" />}
          </button>
          <button className="button button--secondary" type="button" onClick={() => setPrototypeNotice('Sütun görünümü kompakt varsayılanlara sıfırlandı.')}><Columns3 size={15} /> Sütunlar</button>
          {!detailOpen && (
            <button className="button button--secondary" type="button" onClick={() => setDetailOpen(true)}><PanelRightOpen size={15} /> Hızlı Bakış</button>
          )}
          <button className="button button--primary" type="button" onClick={() => setSearchParams({ yeni: 'true' })}>
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
          <label className="select-field"><span className="select-field__label">Tür</span><select aria-label="Dosya türü" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as 'Tümü' | CaseType)}><option>Tümü</option><option>Trafik</option><option>Kasko</option></select><ChevronDown size={14} /></label>
          <label className="select-field"><span className="select-field__label">Durum</span><select aria-label="Dosya durumu" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>{source === 'api'
            ? <><option>Tümü</option><option>Açık</option><option>Gecikmiş</option><option>Kapalı</option></>
            : <><option>Tümü</option>{Array.from(new Set(cases.map((item) => item.status))).map((status) => <option key={status}>{status}</option>)}</>}</select><ChevronDown size={14} /></label>
          {source === 'api' ? (
            <CaseReferenceFilters
              responsibleUserId={assigneeFilter}
              serviceId={serviceFilter}
              onResponsibleChange={setAssigneeFilter}
              onServiceChange={setServiceFilter}
              port={referencePort}
            />
          ) : (
            <>
              <label className="select-field"><span className="select-field__label">Sorumlu</span><select aria-label="Dosya sorumlusu" value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)}><option>Tümü</option>{Array.from(new Set(cases.map((item) => item.assignee))).map((assignee) => <option key={assignee}>{assignee}</option>)}</select><ChevronDown size={14} /></label>
              <label className="select-field"><span className="select-field__label">Servis</span><select aria-label="Dosya servisi" value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value)}><option>Tümü</option>{Array.from(new Set(cases.map((item) => item.service))).map((service) => <option key={service}>{service}</option>)}</select><ChevronDown size={14} /></label>
            </>
          )}
          <label className="select-field"><span className="select-field__label">Takip</span><select aria-label="Takip tarihi durumu" value={followUpFilter} onChange={(event) => setFollowUpFilter(event.target.value)}><option value="Tümü">Tümü</option><option value="late">Geciken</option><option value="today">Bugün</option><option value="normal">Planlı</option></select><ChevronDown size={14} /></label>
          <label className="select-field"><span className="select-field__label">Sırala</span><select aria-label="Dosya sıralaması" value={sortKey} onChange={(event) => { setSortKey(event.target.value as SortKey); setDirection(event.target.value === 'lastAction' ? 'desc' : 'asc') }}><option value="lastAction">Son güncelleme</option><option value="followUp">Takip tarihi</option><option value="officeNumber">Dosya numarası</option><option value="plate">Plaka A–Z</option></select><ChevronDown size={14} /></label>
          {hasFilters && <button className="filterbar__clear" type="button" onClick={resetFilters}>Temizle</button>}
        </section>
      )}

      <div className={`cases-workarea${detailOpen ? ' cases-workarea--detail' : ''}`}>
        <section className="case-list-panel">
          <div className="table-scroll">
            {visibleCases.length === 0 ? <EmptyState onReset={resetFilters} /> : (
              <table className="case-table">
                <thead>
                  <tr>
                    <th className="cell-check"><input type="checkbox" aria-label="Tüm dosyaları seç" /></th>
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
                    <th><button type="button" onClick={() => handleSort('followUp')}>Takip <SortIcon column="followUp" sortKey={sortKey} direction={direction} /></button></th>
                    <th><button type="button" onClick={() => handleSort('lastAction')}>Son İşlem <SortIcon column="lastAction" sortKey={sortKey} direction={direction} /></button></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleCases.map((item) => (
                    <tr
                      key={item.caseId}
                      className={selectedCase?.caseId === item.caseId && detailOpen ? 'is-selected' : ''}
                      tabIndex={0}
                      onClick={() => { setSelectedId(item.caseId); setDetailOpen(true) }}
                      onDoubleClick={() => navigate(`/dosyalar/${item.caseId}`)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') navigate(`/dosyalar/${item.caseId}`)
                      }}
                    >
                      <td className="cell-check"><input type="checkbox" aria-label={`${item.plate} dosyasını seç`} onClick={(event) => event.stopPropagation()} /></td>
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
                      <td><span className={`follow-up follow-up--${item.followUpTone}`}>{item.followUp}</span></td>
                      <td>{item.lastAction}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <footer className="table-footer">
            <span>{visibleCases.length} / {source === 'api' ? totalCount : '1.284'} dosya gösteriliyor</span>
            <span className="table-footer__hint"><ListFilter size={13} />Sıralama: {sortKey} · {direction === 'asc' ? 'artan' : 'azalan'}</span>
            {source === 'api' && alertStatus === 'loading' && (
              <span className="table-footer__hint">Uyarı göstergesi yükleniyor…</span>
            )}
            {source === 'api' && alertStatus !== 'ok' && alertStatus !== 'loading' && (
              <span className="table-footer__warning" role="status">
                <CircleAlert size={13} />Uyarı göstergesi yüklenemedi; satırlar uyarısız sayılmıyor.
              </span>
            )}
            {source === 'api' ? (
              <div className="pagination">
                <span className="table-footer__hint">
                  Sayfa {casePage?.page ?? activePage} / {Math.max(1, totalPages)}
                </span>
                <button
                  type="button"
                  aria-label="Önceki sayfa"
                  disabled={activePage <= 1 || pageStatus === 'loading'}
                  onClick={() => setActivePage((page) => Math.max(1, page - 1))}
                >‹</button>
                <button
                  type="button"
                  aria-label="Sonraki sayfa"
                  disabled={activePage >= totalPages || pageStatus === 'loading'}
                  onClick={() => setActivePage((page) => Math.min(Math.max(1, totalPages), page + 1))}
                >›</button>
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
      {showNewModal && source === 'api' && session.user !== null && (
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
