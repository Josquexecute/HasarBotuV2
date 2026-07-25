import { useMemo, useState } from 'react'
import { BellRing, CheckCheck, ChevronDown, CircleAlert, ExternalLink, FileWarning, ShieldAlert } from 'lucide-react'
import { useNavigate } from 'react-router'
import { initialNotifications, type NotificationType } from '../../mocks/workspaces'
import { BackendUnavailableState, LoadingState } from '../../components/StateViews'
import {
  getConfiguredDataSource,
  useOperationalAlerts,
  type DataSourceKind,
  type OperationalAlertDataPort,
  type OperationalAlertSeverityRecord,
  type OperationalAlertTypeRecord,
} from '../../data'

const notificationIcons: Record<NotificationType, typeof FileWarning> = {
  'Eksik Evrak': FileWarning,
  'Geciken Takip': CircleAlert,
  'Onay Bekliyor': ShieldAlert,
  'Değer Kaybı': BellRing,
  'Ağır Hasar': ShieldAlert,
}

/**
 * Prototip bildirim listesi. Yalnız açıkça seçilmiş mock veri modunda render
 * edilir; API modunda bu bileşen hiç çağrılmaz, dolayısıyla örnek kayıtlar
 * DOM'a hiç girmez.
 */
function NotificationsMockContent() {
  const navigate = useNavigate()
  const [items, setItems] = useState(initialNotifications)
  const [type, setType] = useState('Tümü')
  const [read, setRead] = useState('Tümü')

  const visible = useMemo(() => items.filter((item) => (type === 'Tümü' || item.type === type) && (read === 'Tümü' || (read === 'Okunmamış' ? !item.read : item.read))), [items, read, type])
  const unreadCount = items.filter((item) => !item.read).length

  return (
    <>
      <section className="page-heading page-heading--compact"><div><h1>Bildirimler <span className="heading-count">{unreadCount} okunmamış</span></h1><p>Operasyon, evrak ve kontrol bildirimleri</p></div><button className="button button--secondary" type="button" onClick={() => setItems((current) => current.map((item) => ({ ...item, read: true })))}><CheckCheck size={15} /> Tümünü Okundu İşaretle</button></section>
      <section className="filterbar" aria-label="Bildirim filtreleri">
        <label className="select-field"><span className="select-field__label">Tür</span><select aria-label="Bildirim türü" value={type} onChange={(event) => setType(event.target.value)}><option>Tümü</option><option>Eksik Evrak</option><option>Geciken Takip</option><option>Onay Bekliyor</option><option>Değer Kaybı</option><option>Ağır Hasar</option></select><ChevronDown size={14} /></label>
        <label className="select-field"><span className="select-field__label">Durum</span><select aria-label="Bildirim okuma durumu" value={read} onChange={(event) => setRead(event.target.value)}><option>Tümü</option><option>Okunmamış</option><option>Okunmuş</option></select><ChevronDown size={14} /></label>
        <span className="filterbar__context">{visible.length} bildirim gösteriliyor</span>
      </section>
      <div className="notification-list" role="list">
        {visible.map((item) => {
          const Icon = notificationIcons[item.type]
          return <article className={`notification-item notification-item--${item.tone}${item.read ? ' is-read' : ''}`} key={item.id} role="listitem">
            <button className="notification-item__main" type="button" onClick={() => setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, read: true } : candidate))}>
              <span className="notification-item__icon"><Icon size={18} /></span><span><span className="eyebrow">{item.type} · {item.time}</span><strong>{item.title}</strong><small>{item.detail}</small></span>{!item.read && <i className="unread-dot" aria-label="Okunmamış" />}
            </button>
            <div className="notification-item__case"><span className="plate plate--table">{item.plate}</span><small>{item.officeNumber}</small></div>
            <button className="button button--secondary" type="button" onClick={() => navigate(`/dosyalar/${item.caseId}`)} aria-label={`${item.plate} dosyasına git`}><ExternalLink size={14} /> Dosyaya Git</button>
          </article>
        })}
      </div>
    </>
  )
}

const alertIcons: Record<OperationalAlertTypeRecord, typeof FileWarning> = {
  overdue_task: CircleAlert,
  overdue_follow_up: CircleAlert,
  missing_required_document: FileWarning,
}

const ALERT_TYPE_LABELS: Record<OperationalAlertTypeRecord, string> = {
  overdue_task: 'Geciken Görev',
  overdue_follow_up: 'Geciken Takip',
  missing_required_document: 'Eksik Evrak',
}

const ALERT_SEVERITY_LABELS: Record<OperationalAlertSeverityRecord, string> = {
  high: 'Yüksek',
  medium: 'Orta',
  low: 'Düşük',
}

const ALERT_SEVERITY_TONES: Record<OperationalAlertSeverityRecord, string> = {
  high: 'critical',
  medium: 'warning',
  low: 'info',
}

/**
 * API modunda gerçek operasyonel uyarılar. Liste salt okunurdur: okundu,
 * ertelendi veya silindi durumu bu dilimde yoktur. Sayaç yalnız API sonucundan
 * hesaplanır; hata durumunda mock'a düşülmez.
 */
function OperationalAlertContent({ port }: { port?: OperationalAlertDataPort }) {
  const navigate = useNavigate()
  const { alerts, status } = useOperationalAlerts(port)
  const [type, setType] = useState<'Tümü' | OperationalAlertTypeRecord>('Tümü')

  const items = useMemo(() => alerts?.alerts ?? [], [alerts])
  const visible = useMemo(
    () => items.filter((item) => type === 'Tümü' || item.type === type),
    [items, type],
  )

  return (
    <>
      <section className="page-heading page-heading--compact">
        <div>
          <h1>
            Bildirimler
            {status === 'ok' && alerts !== null && (
              <span className="heading-count">{alerts.totalCount} açık uyarı</span>
            )}
          </h1>
          <p>Mevcut görev, takip ve evrak verisinden türetilen operasyonel uyarılar</p>
        </div>
      </section>
      {status === 'loading' && <LoadingState label="Uyarılar yükleniyor" />}
      {(status === 'unavailable' || status === 'unauthorized' || status === 'forbidden') && (
        <BackendUnavailableState
          title="Operasyonel uyarılar şu anda alınamıyor."
          detail="Uyarılar yalnız gerçek veriden türetilir; bağlantı kurulana kadar örnek bildirim gösterilmez."
        />
      )}
      {status === 'ok' && items.length === 0 && (
        <div className="state-view" role="status">
          <CheckCheck aria-hidden="true" />
          <strong>Açık operasyonel uyarı yok.</strong>
          <span>Süresi geçmiş görev/takip ve eksik zorunlu evrak bulunmuyor.</span>
        </div>
      )}
      {status === 'ok' && items.length > 0 && (
        <>
          <section className="filterbar" aria-label="Uyarı filtreleri">
            <label className="select-field">
              <span className="select-field__label">Tür</span>
              <select
                aria-label="Uyarı türü"
                value={type}
                onChange={(event) => setType(event.target.value as 'Tümü' | OperationalAlertTypeRecord)}
              >
                <option value="Tümü">Tümü</option>
                <option value="overdue_task">Geciken Görev</option>
                <option value="overdue_follow_up">Geciken Takip</option>
                <option value="missing_required_document">Eksik Evrak</option>
              </select>
              <ChevronDown size={14} />
            </label>
            <span className="filterbar__context">{visible.length} uyarı gösteriliyor</span>
          </section>
          <div className="notification-list" role="list">
            {visible.map((item) => {
              const Icon = alertIcons[item.type]
              return (
                <article
                  className={`notification-item notification-item--${ALERT_SEVERITY_TONES[item.severity]}`}
                  key={item.dedupeKey}
                  role="listitem"
                >
                  <div className="notification-item__main">
                    <span className="notification-item__icon"><Icon size={18} /></span>
                    <span>
                      <span className="eyebrow">
                        {ALERT_TYPE_LABELS[item.type]} · {ALERT_SEVERITY_LABELS[item.severity]} önem · {item.sourceDate}
                      </span>
                      <strong>{item.summary}</strong>
                    </span>
                  </div>
                  <div className="notification-item__case">
                    <span className="plate plate--table">{item.plate}</span>
                    <small>{item.officeNumber}</small>
                  </div>
                  <button
                    className="button button--secondary"
                    type="button"
                    onClick={() => navigate(item.caseDetailPath)}
                    aria-label={`${item.plate} dosyasına git`}
                  >
                    <ExternalLink size={14} /> Dosyaya Git
                  </button>
                </article>
              )
            })}
          </div>
        </>
      )}
    </>
  )
}

/** `port` yalnız testler için enjekte edilir; uygulama gerçek HTTP adaptörünü kullanır. */
export function NotificationsPage({ port }: { port?: OperationalAlertDataPort } = {}) {
  const [source] = useState<DataSourceKind>(getConfiguredDataSource)

  return (
    <main className="page office-page notifications-page">
      {source === 'mock' ? <NotificationsMockContent /> : <OperationalAlertContent port={port} />}
    </main>
  )
}
