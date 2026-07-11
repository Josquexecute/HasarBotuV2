import { Bell, Grid2X2, Menu, Moon, Search, Sun } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { getSearchTokens } from '../utils/search'

interface TopbarProps {
  theme: 'light' | 'dark'
  density: 'compact' | 'comfortable'
  onThemeToggle: () => void
  onDensityToggle: () => void
  onMenuToggle: () => void
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

export function Topbar({ theme, density, onThemeToggle, onDensityToggle, onMenuToggle }: TopbarProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const isCaseDetail = location.pathname.startsWith('/dosyalar/')
  const title = isCaseDetail ? 'Dosya Çalışma Alanı' : routeTitles[location.pathname] ?? 'HasarBotu V2'

  const handleSearch = (value: string) => {
    const query = value.trim()
    if (getSearchTokens(query).length === 0) return
    navigate(`/dosyalar?q=${encodeURIComponent(query)}`)
  }

  return (
    <header className="topbar">
      <button className="icon-button topbar__menu" type="button" onClick={onMenuToggle} aria-label="Sol menüyü aç veya kapat">
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
          type="search"
          placeholder="Plaka, dosya no veya isim ara"
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleSearch(event.currentTarget.value)
          }}
        />
        <kbd>Enter</kbd>
      </label>

      <div className="topbar__actions">
        <span className="prototype-badge" title="Bu uygulama anonim mock veri kullanan bir UI prototipidir">UI Prototip · Mock Veri</span>
        <span className="connection-status"><i aria-hidden="true" />Bağlantı aktif</span>
        <button className="topbar-action" type="button" onClick={onDensityToggle} title="Görünüm yoğunluğunu değiştir">
          <Grid2X2 size={16} aria-hidden="true" />
          <span>{density === 'compact' ? 'Kompakt' : 'Rahat'}</span>
        </button>
        <button className="icon-button" type="button" onClick={onThemeToggle} aria-label={theme === 'light' ? 'Koyu temaya geç' : 'Açık temaya geç'}>
          {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
        </button>
        <button className="icon-button icon-button--notification" type="button" onClick={() => navigate('/bildirimler')} aria-label="Bildirimleri aç">
          <Bell size={18} />
          <i aria-hidden="true" />
        </button>
        <button className="avatar avatar--button" type="button" onClick={() => navigate('/ayarlar')} title="Kullanıcı ayarları">ÖF</button>
      </div>
    </header>
  )
}
