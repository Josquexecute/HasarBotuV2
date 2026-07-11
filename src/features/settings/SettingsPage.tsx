import { useState } from 'react'
import { CheckCircle2, FolderCog, LayoutPanelLeft, MonitorCog, RotateCcw, X } from 'lucide-react'
import { usePersistentState } from '../../app/usePersistentState'

interface SettingsPageProps {
  theme: 'light' | 'dark'
  density: 'compact' | 'comfortable'
  collapsed: boolean
  onThemeChange: (theme: 'light' | 'dark') => void
  onDensityChange: (density: 'compact' | 'comfortable') => void
  onSidebarChange: (collapsed: boolean) => void
}

export function SettingsPage({ theme, density, collapsed, onThemeChange, onDensityChange, onSidebarChange }: SettingsPageProps) {
  const [defaultPage, setDefaultPage] = usePersistentState('hasarbotu-default-page', 'Durum Panosu')
  const [mockFolder, setMockFolder] = usePersistentState('hasarbotu-mock-folder', 'Demo Çalışma Alanı / 2026')
  const [notice, setNotice] = useState('')

  const reset = () => {
    onThemeChange('light')
    onDensityChange('compact')
    onSidebarChange(false)
    setDefaultPage('Durum Panosu')
    setMockFolder('Demo Çalışma Alanı / 2026')
    setNotice('Görünüm ayarları mock varsayılanlara döndürüldü.')
  }

  return (
    <main className="page office-page settings-page">
      <section className="page-heading page-heading--compact"><div><h1>Ayarlar</h1><p>Görünüm ve mock cihaz profilini düzenleyin</p></div><button className="button button--secondary" type="button" onClick={reset}><RotateCcw size={15} /> Varsayılanlara Dön</button></section>
      <div className="office-scroll settings-content">
        <section className="settings-section"><header><MonitorCog size={19} /><div><h2>Görünüm</h2><span>Ayarlar bu tarayıcıdaki mock profil için saklanır</span></div></header>
          <div className="settings-grid">
            <fieldset><legend>Tema</legend><label><input type="radio" name="theme" checked={theme === 'light'} onChange={() => onThemeChange('light')} /> Açık tema</label><label><input type="radio" name="theme" checked={theme === 'dark'} onChange={() => onThemeChange('dark')} /> Gerçek siyah koyu tema</label></fieldset>
            <fieldset><legend>Tablo yoğunluğu</legend><label><input type="radio" name="density" checked={density === 'compact'} onChange={() => onDensityChange('compact')} /> Kompakt</label><label><input type="radio" name="density" checked={density === 'comfortable'} onChange={() => onDensityChange('comfortable')} /> Rahat</label></fieldset>
            <fieldset><legend>Sol menü varsayılanı</legend><label><input type="radio" name="sidebar" checked={!collapsed} onChange={() => onSidebarChange(false)} /> Açık</label><label><input type="radio" name="sidebar" checked={collapsed} onChange={() => onSidebarChange(true)} /> Daraltılmış</label></fieldset>
          </div>
        </section>
        <section className="settings-section"><header><LayoutPanelLeft size={19} /><div><h2>Başlangıç</h2><span>Varsayılan ürün kararı Durum Panosu’dur</span></div></header><label className="settings-field"><span>Varsayılan açılış sayfası</span><select value={defaultPage} onChange={(event) => { setDefaultPage(event.target.value); setNotice('Varsayılan açılış sayfası mock profil için güncellendi.') }}><option>Durum Panosu</option><option>Dosyalar</option></select></label></section>
        <section className="settings-section"><header><FolderCog size={19} /><div><h2>Mock Çalışma Klasörü</h2><span>Gerçek klasör seçimi veya dosya sistemi işlemi yapılmaz</span></div></header><div className="mock-folder"><div><span className="eyebrow">Görsel profil yolu</span><strong>{mockFolder}</strong><small>Bu değer yalnız prototip tercihidir; diskte karşılığı aranmaz.</small></div><button className="button button--secondary" type="button" onClick={() => { setMockFolder(mockFolder.includes('Demo') ? 'Ofis Simülasyonu / Temmuz 2026' : 'Demo Çalışma Alanı / 2026'); setNotice('Mock çalışma klasörü görünümü değiştirildi.') }}>Mock Klasörü Değiştir</button></div></section>
        <section className="settings-section"><header><CheckCircle2 size={19} /><div><h2>Sistem Durumu</h2><span>UI-first prototip</span></div></header><dl className="settings-status"><div><dt>Backend</dt><dd>Eklenmedi</dd></div><div><dt>Dosya Sistemi</dt><dd>Mock</dd></div><div><dt>AI Servisi</dt><dd>Mock karar desteği</dd></div><div><dt>Bağlantı</dt><dd>Prototip aktif</dd></div></dl></section>
      </div>
      {notice && <button className="prototype-toast" type="button" onClick={() => setNotice('')}><CheckCircle2 size={15} />{notice}<X size={14} /></button>}
    </main>
  )
}
