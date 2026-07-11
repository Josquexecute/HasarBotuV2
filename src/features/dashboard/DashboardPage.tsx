import { useMemo, useState } from 'react'
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  FileWarning,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { caseStages, mockCases } from '../../mocks/cases'
import type { CaseRecord } from '../../types/case'

const summaryItems = [
  { label: 'Açık Dosya', value: 142, detail: 'Bu ay +18', tone: 'neutral' },
  { label: 'Bugün Takip', value: 12, detail: '4 görüşme', tone: 'info' },
  { label: 'Geciken', value: 5, detail: '2 kritik', tone: 'danger' },
  { label: 'Eksik Evraklı', value: 24, detail: '7 yeni', tone: 'warning' },
  { label: 'Onarım Onayı', value: 8, detail: 'Kontrol bekliyor', tone: 'neutral' },
  { label: 'Kapanmaya Hazır', value: 15, detail: 'Bugün 3 dosya', tone: 'success' },
] as const

const boardStages = caseStages.filter((stage) =>
  ['Yeni İhbar', 'Araç / Servis Bekleniyor', 'Ekspertiz Bekliyor', 'Hasar Tespiti', 'Parça ve İşçilik', 'Onarım Onayı Bekleniyor', 'Onarımda', 'Raporlama', 'Kapanış Evrakları', 'Kapanmaya Hazır'].includes(stage),
)

function WorkflowCard({ item }: { item: CaseRecord }) {
  const navigate = useNavigate()

  return (
    <article
      className="workflow-card"
      tabIndex={0}
      onClick={() => navigate(`/dosyalar?q=${encodeURIComponent(item.plate)}`)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') navigate(`/dosyalar/${item.caseId}`)
      }}
      aria-label={`${item.plate}, ${item.stage}. Tek tıkla dosyalarda göster, Enter ile tam dosyayı aç.`}
    >
      <div className="workflow-card__head">
        <span className="plate">{item.plate}</span>
        <span className={`type-badge type-badge--${item.type.toLocaleLowerCase('tr-TR')}`}>{item.type}</span>
      </div>
      <div className="workflow-card__numbers">
        <span>Ofis {item.officeNumber}</span>
        <span>{item.noticeNumber}</span>
      </div>
      <div className="workflow-card__meta">
        <span>{item.service}</span>
        <span>{item.assignee}</span>
      </div>
      <div className="workflow-card__footer">
        {item.missingDocuments > 0 ? (
          <span className="inline-status inline-status--warning"><FileWarning size={13} />{item.missingDocuments} eksik evrak</span>
        ) : (
          <span className="inline-status inline-status--success"><CheckCircle2 size={13} />Evrak tam</span>
        )}
        <span className={`follow-up follow-up--${item.followUpTone}`}>{item.followUp}</span>
      </div>
    </article>
  )
}

export function DashboardPage() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [assignee, setAssignee] = useState('Tüm sorumlular')
  const [refreshedAt, setRefreshedAt] = useState('10:42')

  const visibleCases = useMemo(() => {
    const normalizedQuery = query.toLocaleLowerCase('tr-TR')
    return mockCases.filter((item) => {
      const matchesQuery = !normalizedQuery || [item.plate, item.officeNumber, item.company, item.service]
        .some((field) => field.toLocaleLowerCase('tr-TR').includes(normalizedQuery))
      const matchesAssignee = assignee === 'Tüm sorumlular' || item.assignee === assignee
      return matchesQuery && matchesAssignee
    })
  }, [assignee, query])

  return (
    <main className="page dashboard-page">
      <section className="page-heading">
        <div>
          <h1>Operasyon Durumu</h1>
          <p>10 Temmuz 2026 Cuma · Açık dosyaların güncel iş akışı</p>
        </div>
        <div className="heading-actions">
          <span className="refresh-label">Son güncelleme {refreshedAt}</span>
          <button className="button button--secondary" type="button" onClick={() => setRefreshedAt('şimdi')}>
            <RefreshCw size={15} /> Yenile
          </button>
          <button className="button button--primary" type="button" onClick={() => navigate('/dosyalar?yeni=true')}>
            <Plus size={16} /> Yeni İhbar
          </button>
        </div>
      </section>

      <section className="summary-strip" aria-label="Operasyon özeti">
        {summaryItems.map((item) => (
          <button
            type="button"
            key={item.label}
            className={`summary-item summary-item--${item.tone}`}
            onClick={() => navigate(`/dosyalar?ozet=${encodeURIComponent(item.label)}`)}
          >
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.detail}</small>
          </button>
        ))}
      </section>

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
          <select value={assignee} onChange={(event) => setAssignee(event.target.value)}>
            <option>Tüm sorumlular</option>
            <option>Ahmet Yılmaz</option>
            <option>Selin Aras</option>
            <option>Zeynep Demir</option>
          </select>
          <ChevronDown size={14} />
        </label>
        <div className="board-toolbar__legend" aria-label="Takip durumu göstergeleri">
          <span><i className="dot dot--danger" />Geciken</span>
          <span><i className="dot dot--warning" />Bugün</span>
          <span><i className="dot dot--neutral" />Planlı</span>
        </div>
      </section>

      <section className="workflow-board" aria-label="Dosya iş akışı panosu">
        {boardStages.map((stage) => {
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

      <footer className="statusbar">
        <span><CheckCircle2 size={14} />{visibleCases.length} mock dosya gösteriliyor</span>
        <span><CalendarClock size={14} />12 dosya bugün takip edilecek</span>
        <span className="statusbar__warning"><CircleAlert size={14} />5 geciken görev</span>
        <button type="button" onClick={() => navigate('/dosyalar')}>Tüm dosyaları aç <ArrowRight size={14} /></button>
      </footer>
    </main>
  )
}
