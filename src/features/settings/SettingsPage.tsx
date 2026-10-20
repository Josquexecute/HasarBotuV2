import { lazy, Suspense, useState } from 'react'
import { Link } from 'react-router'
import { CheckCircle2, FolderCog, LayoutPanelLeft, MonitorCog, RotateCcw, X } from 'lucide-react'
import { usePersistentState } from '../../app/usePersistentState'
import { useSession } from '../../app/sessionContext'
import { AssistantAppearanceSettings } from '../assistant/AssistantAppearanceEditor'
import { DesktopUpdates } from './DesktopUpdates'
import { AccountProfileEditor } from './AccountProfileEditor'
const NotificationPreferencesEditor = lazy(() => import('./NotificationPreferencesEditor').then(module => ({ default: module.NotificationPreferencesEditor })))

interface SettingsPageProps {
  theme: 'light' | 'dark'
  collapsed: boolean
  onThemeChange: (theme: 'light' | 'dark') => void
  onSidebarChange: (collapsed: boolean) => void
}

export function SettingsPage({ theme, collapsed, onThemeChange, onSidebarChange }: SettingsPageProps) {
  const { mode,user,logout } = useSession()
  const [defaultPage, setDefaultPage] = usePersistentState('hasarbotu-default-page', 'Durum Panosu')
  const [mockFolder, setMockFolder] = usePersistentState('hasarbotu-mock-folder', 'Demo Çalışma Alanı / 2026')
  const [notice, setNotice] = useState('')

  const reset = () => {
    onThemeChange('light')
    onSidebarChange(false)
    setDefaultPage('Durum Panosu')
    setMockFolder('Demo Çalışma Alanı / 2026')
    setNotice(mode === 'mock' ? 'Görünüm ayarları mock varsayılanlara döndürüldü.' : 'Görünüm ayarları sıfırlandı.')
  }

  return (
    <main className="page office-page settings-page">
      <section className="page-heading page-heading--compact"><div><h1>Ayarlar</h1>{mode === 'mock' && <p>Demo cihaz tercihleri</p>}</div><button className="button button--secondary" type="button" onClick={reset}><RotateCcw size={15} /> Varsayılanlara Dön</button></section>
      <div className="office-scroll settings-content">
        {mode === 'api' && user && <DesktopUpdates />}
        {mode === 'api' && user && <section className="settings-section"><header><MonitorCog size={19} /><div><h2>Hesabım</h2></div></header><AccountProfileEditor key={user.id} /><dl className="settings-status"><div><dt>E-posta</dt><dd>{user.email}</dd></div><div><dt>Roller</dt><dd>{user.roles.map((role) => ({ admin: 'Yönetici',expert: 'Eksper',case_manager: 'Dosya Sorumlusu',secretary: 'Sekreter',accounting: 'Muhasebe',read_only: 'Salt Okunur' })[role]).join(', ')}</dd></div></dl><div className="tracking-actions">{user.roles.includes('admin') && <Link className="button button--secondary" to="/yonetim?bolum=kayitlar">İşlem kayıtlarını aç</Link>}<button className="button button--secondary" onClick={() => { void logout() }}>Oturumu kapat</button></div></section>}
        {mode === 'api' && user && <AssistantAppearanceSettings key={user.id} />}
        {mode === 'api' && user && <Suspense fallback={<p role="status">Bildirim tercihleri yükleniyor…</p>}><NotificationPreferencesEditor key={user.id} /></Suspense>}
        <section className="settings-section"><header><MonitorCog size={19} /><div><h2>Görünüm</h2><span>{mode === 'mock' ? 'Ayarlar bu tarayıcıdaki mock profil için saklanır' : 'Bu cihazda saklanır'}</span></div></header>
          <div className="settings-grid">
            <fieldset><legend>Tema</legend><label><input type="radio" name="theme" checked={theme === 'light'} onChange={() => onThemeChange('light')} /> Açık tema</label><label><input type="radio" name="theme" checked={theme === 'dark'} onChange={() => onThemeChange('dark')} /> Koyu tema</label></fieldset>
            <fieldset><legend>Sol menü varsayılanı</legend><label><input type="radio" name="sidebar" checked={!collapsed} onChange={() => onSidebarChange(false)} /> Açık</label><label><input type="radio" name="sidebar" checked={collapsed} onChange={() => onSidebarChange(true)} /> Daraltılmış</label></fieldset>
          </div>
        </section>
        <section className="settings-section"><header><LayoutPanelLeft size={19} /><div><h2>Başlangıç</h2></div></header><label className="settings-field"><span>Varsayılan açılış sayfası</span><select value={defaultPage} onChange={(event) => { setDefaultPage(event.target.value); setNotice(mode === 'mock' ? 'Varsayılan açılış sayfası mock profil için güncellendi.' : 'Açılış sayfası güncellendi.') }}><option>Durum Panosu</option><option>Dosyalar</option></select></label></section>
        {mode === 'mock' && <>
        <section className="settings-section"><header><FolderCog size={19} /><div><h2>Mock Çalışma Klasörü</h2><span>Gerçek klasör seçimi veya dosya sistemi işlemi yapılmaz</span></div></header><div className="mock-folder"><div><span className="eyebrow">Görsel profil yolu</span><strong>{mockFolder}</strong><small>Bu değer yalnız prototip tercihidir; diskte karşılığı aranmaz.</small></div><button className="button button--secondary" type="button" onClick={() => { setMockFolder(mockFolder.includes('Demo') ? 'Ofis Simülasyonu / Temmuz 2026' : 'Demo Çalışma Alanı / 2026'); setNotice('Mock çalışma klasörü görünümü değiştirildi.') }}>Mock Klasörü Değiştir</button></div></section>
        <section className="settings-section"><header><CheckCircle2 size={19} /><div><h2>Sistem Durumu</h2><span>UI-first prototip</span></div></header><dl className="settings-status"><div><dt>Backend</dt><dd>Eklenmedi</dd></div><div><dt>Dosya Sistemi</dt><dd>Mock</dd></div><div><dt>AI Servisi</dt><dd>Mock karar desteği</dd></div><div><dt>Bağlantı</dt><dd>Prototip aktif</dd></div></dl></section>
        </>}
      </div>
      {notice && <button className="prototype-toast" type="button" onClick={() => setNotice('')}><CheckCircle2 size={15} />{notice}<X size={14} /></button>}
    </main>
  )
}
