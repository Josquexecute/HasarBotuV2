import { Bell, LogOut, Menu, Moon, Search, Sun } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { getSearchTokens } from '../utils/search'
import { useSession } from '../app/sessionContext'

interface TopbarProps {
  theme: 'light' | 'dark'
  onThemeToggle: () => void
  onMenuToggle: () => void
  menuExpanded?: boolean
}

const routeTitles: Record<string, string> = {
  '/': 'Durum Panosu',
  '/dosyalar': 'Dosyalar',
  '/kapanan-dosyalar': 'Kapanan Dosyalar',
  '/raporlar-ve-ucretler': 'Raporlar ve Ücretler',
  '/mevzuat-ve-ai': 'Mevzuat ve AI Yardımcısı',
  '/bildirimler': 'Bildirimler',
  '/yonetim': 'Yönetim',
  '/ayarlar': 'Ayarlar',
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const letters = parts.length === 1 ? parts[0]!.slice(0, 2) : `${parts[0]![0]}${parts[parts.length - 1]![0]}`
  return letters.toLocaleUpperCase('tr')
}

export function Topbar({ theme, onThemeToggle, onMenuToggle, menuExpanded }: TopbarProps) {
  const search = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !document.querySelector('[role="dialog"]')) {
        event.preventDefault()
        search.current?.focus()
        search.current?.select()
      }
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])
  const location = useLocation()
  const navigate = useNavigate()
  const session = useSession()
  const authenticated = session.status === 'authenticated' && session.user !== null
  const isCaseDetail = location.pathname.startsWith('/dosyalar/')
  const title = isCaseDetail ? 'Dosya Çalışma Alanı' : routeTitles[location.pathname] ?? 'HasarBotu V2'

  const handleSearch = (value: string) => {
    const query = value.trim()
    if (getSearchTokens(query).length === 0) return
    navigate(`/dosyalar?q=${encodeURIComponent(query)}`)
  }

  return (
    <header className="topbar">
      <button className="icon-button topbar__menu" type="button" onClick={onMenuToggle} aria-label="Sol menüyü aç veya kapat" aria-expanded={menuExpanded}>
        <Menu size={19} />
      </button>
      <div className="topbar__title">
        <strong>{title}</strong>
        <span>Baran Global Ekspertiz</span>
      </div>

      <label className="global-search">
        <Search size={16} aria-hidden="true" />
        <span className="sr-only">Genel arama</span>
        <input
          ref={search}
          aria-keyshortcuts="Control+k Meta+k"
          type="search"
          placeholder="Plaka, dosya no veya isim ara"
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleSearch(event.currentTarget.value)
          }}
        />
        <kbd title="Aramaya odaklan: Ctrl+K · Ara: Enter">Ctrl K</kbd>
      </label>

      <div className="topbar__actions">
        {authenticated ? (
          <span className="connection-status" title={session.user!.email}><i aria-hidden="true" />Oturum aktif</span>
        ) : (
          <>
            <span className="prototype-badge" title="Bu uygulama anonim mock veri kullanan bir UI prototipidir">UI Prototip · Mock Veri</span>
            <span className="connection-status"><i aria-hidden="true" />Bağlantı aktif</span>
          </>
        )}
        <button className="icon-button" type="button" onClick={onThemeToggle} aria-label={theme === 'light' ? 'Koyu temaya geç' : 'Açık temaya geç'}>
          {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
        </button>
        <button className="icon-button icon-button--notification" type="button" onClick={() => navigate('/bildirimler')} aria-label="Bildirimleri aç">
          <Bell size={18} />
        </button>
        <button className="avatar avatar--button" type="button" onClick={() => navigate('/ayarlar')} title={authenticated ? session.user!.displayName : 'Kullanıcı ayarları'}>
          {authenticated ? initialsOf(session.user!.displayName) : 'ÖF'}
        </button>
        {authenticated && (
          <button className="icon-button" type="button" onClick={() => { void session.logout() }} aria-label="Oturumu kapat" title="Oturumu kapat">
            <LogOut size={18} />
          </button>
        )}
      </div>
    </header>
  )
}
