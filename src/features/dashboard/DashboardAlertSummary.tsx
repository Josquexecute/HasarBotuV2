import { useMemo } from 'react'
import { AlertTriangle, ArrowRight, BellRing, CheckCircle2, CircleAlert, FileWarning } from 'lucide-react'
import { useNavigate } from 'react-router'
import { LoadingState } from '../../components/StateViews'
import {
  DASHBOARD_ALERT_PREVIEW_LIMIT,
  countOperationalAlertsByType,
  useOperationalAlerts,
  type OperationalAlertDataPort,
  type OperationalAlertTypeRecord,
} from '../../data'

/**
 * Durum Panosu operasyonel uyarı özeti (Paket 50).
 *
 * Mevcut `GET /api/v1/operational-alerts` ucunu paylaşılan hook üzerinden
 * kullanır: yeni uç, tablo veya ikinci türetim mantığı yoktur. Toplam sayaç
 * yalnız API yanıtındaki `totalCount` alanından gelir; tür dağılımı aynı
 * yanıttaki uyarılar sayılarak bulunur.
 *
 * Pano ayrıntılı liste render etmez: yalnız özet ve en kritik ilk birkaç uyarı
 * gösterilir, tam liste Bildirimler ekranındadır. Hata halinde sıfır gösterilmez;
 * açık hata durumu render edilir ve mock'a düşülmez.
 */

const TYPE_ORDER: readonly OperationalAlertTypeRecord[] = [
  'overdue_task',
  'overdue_follow_up',
  'missing_required_document',
]

const TYPE_LABELS: Readonly<Record<OperationalAlertTypeRecord, string>> = {
  overdue_task: 'Geciken görev',
  overdue_follow_up: 'Geciken takip',
  missing_required_document: 'Eksik zorunlu evrak',
}

const TYPE_TONES: Readonly<Record<OperationalAlertTypeRecord, string>> = {
  overdue_task: 'danger',
  overdue_follow_up: 'warning',
  missing_required_document: 'danger',
}

const TYPE_ICONS: Readonly<Record<OperationalAlertTypeRecord, typeof FileWarning>> = {
  overdue_task: CircleAlert,
  overdue_follow_up: CircleAlert,
  missing_required_document: FileWarning,
}

export function DashboardAlertSummary({ port }: { port?: OperationalAlertDataPort } = {}) {
  const navigate = useNavigate()
  const { alerts, status } = useOperationalAlerts(port)

  const byType = useMemo(() => countOperationalAlertsByType(alerts?.alerts ?? []), [alerts])

  const openNotifications = () => navigate('/bildirimler')

  if (status === 'loading') {
    return (
      <section className="alert-summary" aria-label="Operasyonel uyarı özeti">
        <LoadingState label="Operasyonel uyarılar yükleniyor" />
      </section>
    )
  }

  if (status !== 'ok' || alerts === null) {
    return (
      <section className="alert-summary" aria-label="Operasyonel uyarı özeti">
        <div className="dashboard-state" role="alert">
          <AlertTriangle size={24} />
          <strong>Operasyonel uyarılar alınamadı</strong>
          <span>
            {status === 'unauthorized'
              ? 'Uyarılar için yeniden giriş yapın. Uyarı sayısı sıfır olarak gösterilmiyor.'
              : 'API veya ağ bağlantısını kontrol edin. Uyarı sayısı sıfır olarak gösterilmiyor ve sahte veriye geçilmedi.'}
          </span>
        </div>
      </section>
    )
  }

  if (alerts.totalCount === 0) {
    return (
      <section className="alert-summary" aria-label="Operasyonel uyarı özeti">
        <div className="alert-summary__empty" role="status">
          <CheckCircle2 size={18} aria-hidden="true" />
          <span>Açık operasyonel uyarı yok.</span>
          <button className="button button--secondary" type="button" onClick={openNotifications}>
            Bildirimleri aç <ArrowRight size={14} />
          </button>
        </div>
      </section>
    )
  }

  const preview = alerts.alerts.slice(0, DASHBOARD_ALERT_PREVIEW_LIMIT)

  return (
    <section className="alert-summary" aria-label="Operasyonel uyarı özeti">
      <div className="alert-summary__head">
        <button
          className="alert-summary__total"
          type="button"
          onClick={openNotifications}
          aria-label={`${alerts.totalCount} açık operasyonel uyarı. Bildirimler ekranını aç.`}
        >
          <BellRing size={16} aria-hidden="true" />
          <strong>{alerts.totalCount}</strong>
          <span>açık operasyonel uyarı</span>
          <ArrowRight size={14} aria-hidden="true" />
        </button>
        <div className="alert-summary__types">
          {TYPE_ORDER.map((type) => {
            const Icon = TYPE_ICONS[type]
            return (
              <button
                className={`alert-summary__type alert-summary__type--${TYPE_TONES[type]}`}
                type="button"
                key={type}
                onClick={openNotifications}
                aria-label={`${TYPE_LABELS[type]}: ${byType[type]}. Bildirimler ekranını aç.`}
              >
                <Icon size={14} aria-hidden="true" />
                <span>{TYPE_LABELS[type]}</span>
                <strong>{byType[type]}</strong>
              </button>
            )
          })}
        </div>
      </div>
      <ul className="alert-summary__preview" aria-label="Öne çıkan uyarılar">
        {preview.map((alert) => (
          <li key={alert.dedupeKey}>
            <button type="button" onClick={() => navigate(alert.caseDetailPath)}>
              <span className="plate plate--table">{alert.plate}</span>
              <span>{alert.summary}</span>
              <small>{alert.sourceDate}</small>
            </button>
          </li>
        ))}
      </ul>
      {alerts.totalCount > preview.length && (
        <button className="alert-summary__more" type="button" onClick={openNotifications}>
          Tüm uyarıları gör ({alerts.totalCount}) <ArrowRight size={14} aria-hidden="true" />
        </button>
      )}
    </section>
  )
}
