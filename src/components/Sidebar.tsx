import {
  Bell,
  ChartNoAxesCombined,
  ChevronsLeft,
  ChevronsRight,
  Files,
  FolderArchive,
  LayoutDashboard,
  Scale,
  Settings,
  ShieldCheck,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { NavLink } from 'react-router'
import { useSession } from '../app/sessionContext'
import type { OperationalAlertDataPort } from '../data/operationalAlertPort'
import { useOperationalAlerts } from '../data/useOperationalAlerts'

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
  onNavigate?: () => void
  toggleLabel?: string
  /** Test enjeksiyonu için; verilmezse gerçek HTTP adaptörü kullanılır. */
  operationalAlertPort?: OperationalAlertDataPort
}

/** Ad-soyaddan en çok iki harfli baş harf; boş adda güvenli sabit döner. */
function initialsOf(displayName: string): string {
  const parts = displayName.trim().split(/\s+/u).filter((part) => part.length > 0)
  if (parts.length === 0) return 'HB'
  return parts.slice(0, 2).map((part) => part[0]?.toLocaleUpperCase('tr-TR') ?? '').join('')
}

const navigation: readonly {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  badge?: string
}[] = [
  { to: '/', label: 'Durum Panosu', icon: LayoutDashboard, end: true },
  { to: '/dosyalar', label: 'Dosyalar', icon: Files },
  { to: '/kapanan-dosyalar', label: 'Kapanan Dosyalar', icon: FolderArchive },
  { to: '/raporlar-ve-ucretler', label: 'Raporlar ve Ücretler', icon: ChartNoAxesCombined },
  { to: '/mevzuat-ve-ai', label: 'Mevzuat ve AI Yardımcısı', icon: Scale },
  { to: '/bildirimler', label: 'Bildirimler', icon: Bell },
  { to: '/yonetim', label: 'Yönetim', icon: ShieldCheck },
  { to: '/ayarlar', label: 'Ayarlar', icon: Settings },
]

export function Sidebar({ collapsed, onToggle, onNavigate, operationalAlertPort, toggleLabel }: SidebarProps) {
  // Kimlik yalnız gerçek oturumdan gelir; mock modda prototip kimliği korunur.
  const { mode, user } = useSession()
  const displayName = user?.displayName ?? (mode === 'mock' ? 'Ömer Faruk Kaya' : 'Oturum bekleniyor')

  // Bildirimler rozeti: gerçek API sayısı dışında hiçbir şey göstermez --
  // yükleniyor/mock/hata durumunda rozet YOK (sahte veya bayat sayı yok).
  const { alerts } = useOperationalAlerts(operationalAlertPort)
  const bildirimBadge = alerts !== null && alerts.totalCount > 0 ? String(alerts.totalCount) : undefined

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
      <div className="brand">
        <span className="brand__mark" aria-hidden="true">
          <img className="brand__logo" src="/brand/logo-mark.svg" alt="" />
        </span>
        {!collapsed && (
          <span className="brand__copy">
            <strong>HasarBotu V2</strong>
            <small>Eksper Operasyon</small>
          </span>
        )}
      </div>

      <nav className="sidebar__nav" aria-label="Ana navigasyon">
        {navigation.filter(item => item.to !== '/yonetim' || mode === 'mock' || user?.roles.includes('admin')).map(({ to, label, icon: Icon, badge, end }) => {
          const resolvedBadge = to === '/bildirimler' ? bildirimBadge : badge
          return (
            <NavLink
              key={to}
              to={to}
              onClick={onNavigate}
              end={end}
              className={({ isActive }) => `nav-item${isActive ? ' nav-item--active' : ''}`}
              title={collapsed ? label : undefined}
              aria-label={collapsed ? label : undefined}
            >
              <Icon size={18} aria-hidden="true" />
              {!collapsed && <span className="nav-item__label">{label}</span>}
              {resolvedBadge && <span className="nav-item__badge">{resolvedBadge}</span>}
            </NavLink>
          )
        })}
      </nav>

      <div className="sidebar__footer">
        <div className="user-card" title={displayName}>
          <span className="avatar" aria-hidden="true">{initialsOf(displayName)}</span>
          {!collapsed && (
            <span className="user-card__copy">
              <strong>{displayName}</strong>
            </span>
          )}
        </div>
        <button
          className="sidebar__toggle"
          type="button"
          onClick={onToggle}
          aria-label={toggleLabel ?? (collapsed ? 'Menüyü genişlet' : 'Menüyü daralt')}
          title={toggleLabel ?? (collapsed ? 'Menüyü genişlet' : 'Menüyü daralt')}
        >
          {collapsed ? <ChevronsRight size={17} /> : <ChevronsLeft size={17} />}
        </button>
      </div>
    </aside>
  )
}
