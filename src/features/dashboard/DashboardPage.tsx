import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  CircleAlert,
  FileWarning,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  UserRoundCheck,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { EmptyState, LoadingState } from '../../components/StateViews'
import { caseStages } from '../../mocks/cases'
import {
  useDashboard,
  type DashboardAttentionCodeRecord,
  type DashboardCaseRecord,
  type DashboardPriorityRecord,
  type OperationalAlertDataPort,
} from '../../data'
import { DashboardAlertSummary } from './DashboardAlertSummary'
import { matchesSearchQuery } from '../../utils/search'

type AttentionFilter =
  | 'all'
  | 'action'
  | 'overdue'
  | 'today'
  | 'upcoming'
  | 'missing'
  | 'control'
  | 'approval'

const priorityLabels: Readonly<Record<DashboardPriorityRecord, string>> = {
  critical: 'Kritik',
  high: 'Yüksek',
  medium: 'Orta',
  normal: 'Normal',
}

const attentionLabels: Readonly<Record<DashboardAttentionCodeRecord, string>> = {
  manual_recovery: 'Manuel kurtarma',
  operation_failed: 'İşlem hatası',
  operation_blocked: 'İşlem blokajı',
  overdue_task: 'Geciken görev',
  overdue_follow_up: 'Geciken takip',
  human_approval: 'İnsan onayı',
  missing_documents: 'Eksik evrak',
  document_control_required: 'Evrak kontrolü',
  task_due_today: 'Bugün görev',
  follow_up_today: 'Bugün takip',
  unassigned: 'Sorumlu atanmamış',
  upcoming_task: 'Yaklaşan görev',
  upcoming_follow_up: 'Yaklaşan takip',
}

const attentionFilterLabels: Readonly<Record<AttentionFilter, string>> = {
  all: 'Tüm dosyalar',
  action: 'İşlem gereken',
  overdue: 'Geciken takip',
  today: 'Bugün takip',
  upcoming: 'Yaklaşan takip',
  missing: 'Eksik evrak',
  control: 'Kontrol gereken evrak',
  approval: 'Bekleyen insan onayı',
}

function formatDashboardDate(value: string): string {
  return new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    weekday: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`))
}

function formatRefreshTime(value: string): string {
  return new Intl.DateTimeFormat('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Istanbul',
  }).format(new Date(value))
}

function matchesAttention(item: DashboardCaseRecord, filter: AttentionFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'action') return item.requiresAction
  if (filter === 'overdue') return item.attentionCodes.includes('overdue_follow_up') || item.attentionCodes.includes('overdue_task')
  if (filter === 'today') return item.attentionCodes.includes('follow_up_today') || item.attentionCodes.includes('task_due_today')
  if (filter === 'upcoming') return item.attentionCodes.includes('upcoming_follow_up') || item.attentionCodes.includes('upcoming_task')
  if (filter === 'missing') return item.missingDocumentCount > 0
  if (filter === 'control') return item.controlRequiredDocumentCount > 0
  return item.pendingHumanApprovalCount > 0
}

function WorkflowCard({ item }: { readonly item: DashboardCaseRecord }) {
  const navigate = useNavigate()
  const visibleSignals = item.attentionCodes.slice(0, 2)

  return (
    <article
      className={`workflow-card workflow-card--${item.priority}`}
      tabIndex={0}
      onClick={() => navigate(`/dosyalar/${item.caseId}`)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') navigate(`/dosyalar/${item.caseId}`)
      }}
      aria-label={`${item.plate}, ${item.stage}, ${priorityLabels[item.priority]} öncelik. Dosyayı aç.`}
    >
      <div className="workflow-card__head">
        <span className="plate">{item.plate}</span>
        <span className={`dashboard-priority dashboard-priority--${item.priority}`}>
          {priorityLabels[item.priority]}
        </span>
      </div>
      <div className="workflow-card__numbers">
        <span>Ofis {item.officeNumber}</span>
        <span>{item.type}</span>
      </div>
      <div className="workflow-card__meta">
        <span>{item.insurerName}</span>
        <span>{item.serviceName}</span>
        <span>{item.responsibleUserName}</span>
      </div>
      {visibleSignals.length > 0 && (
        <div className="workflow-card__signals" aria-label="İşlem gerekçeleri">
          {visibleSignals.map((signal) => <span key={signal}>{attentionLabels[signal]}</span>)}
          {item.attentionCodes.length > visibleSignals.length && (
            <span>+{item.attentionCodes.length - visibleSignals.length}</span>
          )}
        </div>
      )}
      <div className="workflow-card__footer">
        <span className="workflow-card__counts">
          {item.missingDocumentCount > 0 && <span title="Eksik evrak"><FileWarning size={12} />{item.missingDocumentCount}</span>}
          {item.controlRequiredDocumentCount > 0 && <span title="Kontrol gereken evrak"><ShieldAlert size={12} />{item.controlRequiredDocumentCount}</span>}
          {item.pendingHumanApprovalCount > 0 && <span title="Bekleyen insan onayı"><UserRoundCheck size={12} />{item.pendingHumanApprovalCount}</span>}
          {item.openTaskCount > 0 && <span title="Açık görev"><ClipboardList size={12} />{item.openTaskCount}</span>}
          {item.missingDocumentCount + item.controlRequiredDocumentCount + item.pendingHumanApprovalCount + item.openTaskCount === 0 && (
            <span className="text-success"><CheckCircle2 size={12} />Kontrol yok</span>
          )}
        </span>
        <span className={`follow-up follow-up--${item.followUpTone}`}>{item.followUpLabel}</span>
      </div>
    </article>
  )
}

/** `alertPort` yalnız testler için enjekte edilir; uygulama gerçek HTTP adaptörünü kullanır. */
export function DashboardPage({ alertPort }: { alertPort?: OperationalAlertDataPort } = {}) {
  const navigate = useNavigate()
  const { dashboard, source, status, reload } = useDashboard()
  const [query, setQuery] = useState('')
  const [assignee, setAssignee] = useState('all')
  const [attentionFilter, setAttentionFilter] = useState<AttentionFilter>('all')
  const [priorityFilter, setPriorityFilter] = useState<'all' | DashboardPriorityRecord>('all')
  const [mockRefreshLabel, setMockRefreshLabel] = useState<string | null>(null)

  const assignees = useMemo(() => {
    if (dashboard === null) return []
    return [...new Map(
      dashboard.items
        .filter((item) => item.responsibleUserId !== null)
        .map((item) => [item.responsibleUserId as string, item.responsibleUserName]),
    ).entries()].sort((left, right) => left[1].localeCompare(right[1], 'tr'))
  }, [dashboard])

  const visibleCases = useMemo(() => {
    if (dashboard === null) return []
    return dashboard.items.filter((item) => {
      const matchesQuery = matchesSearchQuery(query, [
        item.plate,
        item.officeNumber,
        item.insurerName,
        item.serviceName,
        item.responsibleUserName,
        item.stage,
        ...item.attentionCodes.map((code) => attentionLabels[code]),
      ])
      const matchesAssignee = assignee === 'all' || item.responsibleUserId === assignee
      const matchesPriority = priorityFilter === 'all' || item.priority === priorityFilter
      return matchesQuery && matchesAssignee && matchesPriority && matchesAttention(item, attentionFilter)
    })
  }, [assignee, attentionFilter, dashboard, priorityFilter, query])

  const resetFilters = () => {
    setQuery('')
    setAssignee('all')
    setAttentionFilter('all')
    setPriorityFilter('all')
  }

  const handleReload = () => {
    if (source === 'mock') setMockRefreshLabel('şimdi')
    else reload()
  }

  const summaryItems = dashboard === null ? [] : [
    {
      label: 'Açık Dosya',
      value: dashboard.summary.openCaseCount,
      detail: `${dashboard.summary.criticalCaseCount} kritik`,
      tone: 'neutral',
      filter: 'all' as const,
    },
    {
      label: 'Bugün Takip',
      value: dashboard.summary.dueTodayCount + dashboard.summary.taskDueTodayCaseCount,
      detail: `${dashboard.summary.upcomingFollowUpCount + dashboard.summary.upcomingTaskCaseCount} yaklaşan takip/görev`,
      tone: 'info',
      filter: 'today' as const,
    },
    {
      label: 'Geciken',
      value: dashboard.summary.overdueFollowUpCount + dashboard.summary.overdueTaskCaseCount,
      detail: `${dashboard.summary.openTaskCount} açık görev`,
      tone: 'danger',
      filter: 'overdue' as const,
    },
    {
      label: 'Eksik Evraklı',
      value: dashboard.summary.missingDocumentCaseCount,
      detail: `${dashboard.summary.controlRequiredDocumentCaseCount} kontrol`,
      tone: 'warning',
      filter: 'missing' as const,
    },
    {
      label: 'Bekleyen Onay',
      value: dashboard.summary.pendingHumanApprovalCaseCount,
      detail: 'İnsan kararı',
      tone: 'neutral',
      filter: 'approval' as const,
    },
    {
      label: 'İşlem Gereken',
      value: dashboard.summary.actionRequiredCaseCount,
      detail: dashboard.priorityVersion,
      tone: 'success',
      filter: 'action' as const,
    },
  ]

  const refreshLabel = mockRefreshLabel
    ?? (dashboard === null ? '—' : formatRefreshTime(dashboard.evaluatedAt))

  return (
    <main className="page dashboard-page">
      <section className="page-heading">
        <div>
          <h1>Operasyon Durumu</h1>
          <p>
            {dashboard === null
              ? 'Açık dosyaların güncel iş akışı'
              : `${formatDashboardDate(dashboard.asOfDate)} · Açık dosyaların güncel iş akışı`}
          </p>
        </div>
        <div className="heading-actions">
          <span className="refresh-label">Son güncelleme {refreshLabel}</span>
          <button className="button button--secondary" type="button" onClick={handleReload} disabled={status === 'loading'}>
            <RefreshCw size={15} /> {status === 'loading' ? 'Yükleniyor' : 'Yenile'}
          </button>
          <button className="button button--primary" type="button" onClick={() => navigate('/dosyalar?yeni=true')}>
            <Plus size={16} /> Yeni İhbar
          </button>
        </div>
      </section>

      {dashboard !== null && (
        <section className="summary-strip" aria-label="Operasyon özeti">
          {summaryItems.map((item) => (
            <button
              type="button"
              key={item.label}
              className={`summary-item summary-item--${item.tone}${attentionFilter === item.filter ? ' is-active' : ''}`}
              onClick={() => setAttentionFilter(item.filter)}
            >
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <small>{item.detail}</small>
            </button>
          ))}
        </section>
      )}

      {/* Uyarı özeti yalnız API modunda gerçek uçtan gelir; mock modda gösterilmez. */}
      {source === 'api' && <DashboardAlertSummary port={alertPort} />}

      <section className="board-toolbar" aria-label="Durum panosu araçları">
        <div className="segmented-control">
          <button className="segmented-control__item segmented-control__item--active" type="button">İş Akışı</button>
          <button className="segmented-control__item" type="button" onClick={() => navigate('/dosyalar')}>Liste Görünümü</button>
        </div>
        <label className="field field--search">
          <Search size={15} />
          <span className="sr-only">Pano içinde ara</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Panoda ara..." />
        </label>
        <label className="select-field">
          <span className="sr-only">Sorumlu filtresi</span>
          <select aria-label="Pano sorumlusu" value={assignee} onChange={(event) => setAssignee(event.target.value)}>
            <option value="all">Tüm sorumlular</option>
            {assignees.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <ChevronDown size={14} />
        </label>
        <label className="select-field">
          <span className="sr-only">İşlem filtresi</span>
          <select aria-label="İşlem gereksinimi" value={attentionFilter} onChange={(event) => setAttentionFilter(event.target.value as AttentionFilter)}>
            {Object.entries(attentionFilterLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <ChevronDown size={14} />
        </label>
        <label className="select-field">
          <span className="sr-only">Öncelik filtresi</span>
          <select aria-label="Pano önceliği" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as 'all' | DashboardPriorityRecord)}>
            <option value="all">Tüm öncelikler</option>
            {Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <ChevronDown size={14} />
        </label>
        <div className="board-toolbar__legend" aria-label="Takip durumu göstergeleri">
          <span><i className="dot dot--danger" />Kritik</span>
          <span><i className="dot dot--warning" />Yüksek/Orta</span>
          <span><i className="dot dot--neutral" />Normal</span>
        </div>
      </section>

      {status === 'loading' && dashboard === null && <LoadingState label="Gerçek durum panosu yükleniyor" />}
      {status === 'unauthorized' && dashboard === null && (
        <div className="dashboard-state" role="alert">
          <CircleAlert size={24} />
          <strong>Oturum gerekli</strong>
          <span>Gerçek durum panosu için yeniden giriş yapın. Sahte veri gösterilmiyor.</span>
        </div>
      )}
      {status === 'unavailable' && dashboard === null && (
        <div className="dashboard-state" role="alert">
          <AlertTriangle size={24} />
          <strong>Durum panosu alınamadı</strong>
          <span>API veya ağ bağlantısını kontrol edin. Sahte veriye geçiş yapılmadı.</span>
          <button className="button button--secondary" type="button" onClick={reload}>Tekrar dene</button>
        </div>
      )}

      {dashboard !== null && visibleCases.length > 0 && (
        <section className="workflow-board" aria-label="Dosya iş akışı panosu">
          {caseStages.map((stage) => {
            const stageCases = visibleCases.filter((item) => item.stage === stage)
            return (
              <section className="workflow-column" key={stage}>
                <header className="workflow-column__head">
                  <span>{stage}</span>
                  <strong>{stageCases.length}</strong>
                </header>
                <div className="workflow-column__body">
                  {stageCases.map((item) => <WorkflowCard key={item.caseId} item={item} />)}
                  {stageCases.length === 0 && (
                    <div className="workflow-empty">
                      <span>Bu aşamada eşleşen dosya yok</span>
                    </div>
                  )}
                </div>
              </section>
            )
          })}
        </section>
      )}

      {dashboard !== null && visibleCases.length === 0 && (
        <EmptyState onReset={resetFilters} />
      )}

      {dashboard !== null && (
        <footer className="statusbar">
          <span><CheckCircle2 size={14} />{visibleCases.length} / {dashboard.summary.openCaseCount} dosya gösteriliyor</span>
          <span><CalendarClock size={14} />{dashboard.summary.dueTodayCount + dashboard.summary.taskDueTodayCaseCount} bugün · {dashboard.summary.upcomingFollowUpCount + dashboard.summary.upcomingTaskCaseCount} yaklaşan takip/görev</span>
          <span className="statusbar__warning"><CircleAlert size={14} />{dashboard.summary.actionRequiredCaseCount} işlem gerekiyor</span>
          <button type="button" onClick={() => navigate('/dosyalar')}>Tüm dosyaları aç <ArrowRight size={14} /></button>
        </footer>
      )}
    </main>
  )
}
