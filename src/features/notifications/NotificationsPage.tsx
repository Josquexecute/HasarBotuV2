import { useMemo, useState } from 'react'
import { BellRing, CheckCheck, ChevronDown, CircleAlert, ExternalLink, FileWarning, ShieldAlert } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { initialNotifications, type NotificationType } from '../../mocks/workspaces'
import { BackendUnavailableState } from '../../components/StateViews'
import { getConfiguredDataSource, type DataSourceKind } from '../../data'

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

export function NotificationsPage() {
  const [source] = useState<DataSourceKind>(getConfiguredDataSource)

  return (
    <main className="page office-page notifications-page">
      {source === 'mock' ? <NotificationsMockContent /> : (
        <>
          <section className="page-heading page-heading--compact">
            <div>
              <h1>Bildirimler</h1>
              <p>Operasyon, evrak ve kontrol bildirimleri</p>
            </div>
          </section>
          <BackendUnavailableState
            title="Bildirim altyapısı henüz etkin değil."
            detail="Gerçek bildirim kaynağı bağlanana kadar örnek bildirim gösterilmez; mock kayda düşülmez."
          />
        </>
      )}
    </main>
  )
}
