import {
  Bell,
  Bot,
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
import { NavLink } from 'react-router-dom'

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
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
  { to: '/bildirimler', label: 'Bildirimler', icon: Bell, badge: '7' },
  { to: '/yonetim', label: 'Yönetim', icon: ShieldCheck },
  { to: '/ayarlar', label: 'Ayarlar', icon: Settings },
]

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
      <div className="brand">
        <span className="brand__mark" aria-hidden="true">
          <Bot size={21} />
        </span>
        {!collapsed && (
          <span className="brand__copy">
            <strong>HasarBotu V2</strong>
            <small>Eksper Operasyon</small>
          </span>
        )}
      </div>

      <nav className="sidebar__nav" aria-label="Ana navigasyon">
        {navigation.map(({ to, label, icon: Icon, badge, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `nav-item${isActive ? ' nav-item--active' : ''}`}
            title={collapsed ? label : undefined}
          >
            <Icon size={18} aria-hidden="true" />
            {!collapsed && <span className="nav-item__label">{label}</span>}
            {badge && <span className="nav-item__badge">{badge}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar__footer">
        <div className="user-card" title={collapsed ? 'Ömer Faruk Kaya · Eksper' : undefined}>
          <span className="avatar" aria-hidden="true">ÖF</span>
          {!collapsed && (
            <span className="user-card__copy">
              <strong>Ömer Faruk Kaya</strong>
              <small>Eksper</small>
            </span>
          )}
        </div>
        <button
          className="sidebar__toggle"
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? 'Menüyü genişlet' : 'Menüyü daralt'}
          title={collapsed ? 'Menüyü genişlet' : 'Menüyü daralt'}
        >
          {collapsed ? <ChevronsRight size={17} /> : <ChevronsLeft size={17} />}
        </button>
      </div>
    </aside>
  )
}
