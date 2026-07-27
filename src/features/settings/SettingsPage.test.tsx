import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { usePersistentState } from '../../app/usePersistentState'
import { SettingsPage } from './SettingsPage'

/**
 * UAT-tarzı uçtan uca doğrulama: Ayarlar için tema, kullanıcı tercihleri,
 * kalıcılık (localStorage) ve sıfırlama zincirini gerçek `usePersistentState`
 * kancasıyla (App.tsx'in üretimde kullandığı AYNI kanca) doğrular.
 *
 * ÖNEMLİ BULGU: Ayarlar sayfası hiçbir sunucu çağrısı yapmaz — tema/yoğunluk/
 * menü/açılış sayfası/mock klasör tercihleri yalnız TARAYICI localStorage'ında
 * saklanır (HB-2026-013, Paket 08: "Kabul edilmiş UI davranışı ve Ayarlar
 * ekranı değiştirilmez"). Bu nedenle "oturum yenileme" ve "tenant izolasyonu"
 * bu modül için sunucu tarafında DEĞİL, yalnız route-koruması seviyesinde
 * anlamlıdır (bkz. `src/app/App.test.tsx` — `/ayarlar` diğer tüm rotalarla
 * aynı `AppGate` oturum kapısından geçer; ayrıca korunmuş rota davranışı
 * `scripts/router-v8-browser-smoke.mjs`'de gerçek Chrome ile zaten
 * kanıtlıdır). Bu dosya o boşluğu değil, ÖNCEDEN HİÇ TEST EDİLMEMİŞ olan
 * SettingsPage'in kendi denetimlerini (radyo düğmeleri, açılış sayfası
 * seçimi, mock klasör değiştirme, sıfırlama) ve bunların gerçek
 * `localStorage` kalıcılığını kapatır.
 */
function SettingsHarness() {
  const [theme, setTheme] = usePersistentState<'light' | 'dark'>('hasarbotu-theme', 'light')
  const [density, setDensity] = usePersistentState<'compact' | 'comfortable'>('hasarbotu-density', 'compact')
  const [collapsed, setCollapsed] = usePersistentState('hasarbotu-sidebar-collapsed', false)
  return (
    <SettingsPage
      theme={theme}
      density={density}
      collapsed={collapsed}
      onThemeChange={setTheme}
      onDensityChange={setDensity}
      onSidebarChange={setCollapsed}
    />
  )
}

function readPersisted(key: string): unknown {
  const raw = window.localStorage.getItem(key)
  return raw === null ? undefined : (JSON.parse(raw) as unknown)
}

describe('SettingsPage — tema, tercih, kalıcılık', () => {
  it('tema/yoğunluk/menü radyo düğmeleri gerçek localStorage anahtarlarına kalıcı yazar', async () => {
    const user = userEvent.setup()
    render(<SettingsHarness />)

    await user.click(screen.getByRole('radio', { name: 'Gerçek siyah koyu tema' }))
    expect(readPersisted('hasarbotu-theme')).toBe('dark')
    expect(screen.getByRole('radio', { name: 'Gerçek siyah koyu tema' })).toBeChecked()

    await user.click(screen.getByRole('radio', { name: 'Rahat' }))
    expect(readPersisted('hasarbotu-density')).toBe('comfortable')
    expect(screen.getByRole('radio', { name: 'Rahat' })).toBeChecked()

    await user.click(screen.getByRole('radio', { name: 'Daraltılmış' }))
    expect(readPersisted('hasarbotu-sidebar-collapsed')).toBe(true)
    expect(screen.getByRole('radio', { name: 'Daraltılmış' })).toBeChecked()
  })

  it('sayfa yenilemesini (yeniden mount) simüle eder: önceden yazılmış localStorage değerleri gerçekten hidratlanır', () => {
    window.localStorage.setItem('hasarbotu-theme', JSON.stringify('dark'))
    window.localStorage.setItem('hasarbotu-density', JSON.stringify('comfortable'))
    window.localStorage.setItem('hasarbotu-sidebar-collapsed', JSON.stringify(true))
    window.localStorage.setItem('hasarbotu-default-page', JSON.stringify('Dosyalar'))
    window.localStorage.setItem('hasarbotu-mock-folder', JSON.stringify('Ofis Simülasyonu / Temmuz 2026'))

    render(<SettingsHarness />)

    expect(screen.getByRole('radio', { name: 'Gerçek siyah koyu tema' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Rahat' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Daraltılmış' })).toBeChecked()
    expect(screen.getByLabelText('Varsayılan açılış sayfası')).toHaveValue('Dosyalar')
    expect(screen.getByText('Ofis Simülasyonu / Temmuz 2026')).toBeInTheDocument()
  })

  it('varsayılan açılış sayfası seçimini değiştirir, kalıcı yazar ve bildirim gösterir', async () => {
    const user = userEvent.setup()
    render(<SettingsHarness />)

    await user.selectOptions(screen.getByLabelText('Varsayılan açılış sayfası'), 'Dosyalar')
    expect(readPersisted('hasarbotu-default-page')).toBe('Dosyalar')
    expect(screen.getByText('Varsayılan açılış sayfası mock profil için güncellendi.')).toBeInTheDocument()
  })

  it('mock çalışma klasörünü değiştirir, kalıcı yazar ve tekrar tıklayınca eski değere döner', async () => {
    const user = userEvent.setup()
    render(<SettingsHarness />)

    expect(screen.getByText('Demo Çalışma Alanı / 2026')).toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: 'Mock Klasörü Değiştir' })

    await user.click(toggle)
    expect(screen.getByText('Ofis Simülasyonu / Temmuz 2026')).toBeInTheDocument()
    expect(readPersisted('hasarbotu-mock-folder')).toBe('Ofis Simülasyonu / Temmuz 2026')

    await user.click(toggle)
    expect(screen.getByText('Demo Çalışma Alanı / 2026')).toBeInTheDocument()
    expect(readPersisted('hasarbotu-mock-folder')).toBe('Demo Çalışma Alanı / 2026')
  })

  it('"Varsayılanlara Dön" tüm ayarları mock varsayılanlara sıfırlar ve kalıcı yazar', async () => {
    const user = userEvent.setup()
    render(<SettingsHarness />)

    await user.click(screen.getByRole('radio', { name: 'Gerçek siyah koyu tema' }))
    await user.click(screen.getByRole('radio', { name: 'Rahat' }))
    await user.click(screen.getByRole('radio', { name: 'Daraltılmış' }))
    await user.selectOptions(screen.getByLabelText('Varsayılan açılış sayfası'), 'Dosyalar')
    await user.click(screen.getByRole('button', { name: 'Mock Klasörü Değiştir' }))

    await user.click(screen.getByRole('button', { name: /Varsayılanlara Dön/ }))

    expect(screen.getByRole('radio', { name: 'Açık tema' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Kompakt' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Açık' })).toBeChecked()
    expect(screen.getByLabelText('Varsayılan açılış sayfası')).toHaveValue('Durum Panosu')
    expect(screen.getByText('Demo Çalışma Alanı / 2026')).toBeInTheDocument()
    expect(screen.getByText('Görünüm ayarları mock varsayılanlara döndürüldü.')).toBeInTheDocument()

    expect(readPersisted('hasarbotu-theme')).toBe('light')
    expect(readPersisted('hasarbotu-density')).toBe('compact')
    expect(readPersisted('hasarbotu-sidebar-collapsed')).toBe(false)
    expect(readPersisted('hasarbotu-default-page')).toBe('Durum Panosu')
    expect(readPersisted('hasarbotu-mock-folder')).toBe('Demo Çalışma Alanı / 2026')
  })

  it('bildirim kapatma kontrolü bildirimi temizler', async () => {
    const user = userEvent.setup()
    render(<SettingsHarness />)

    await user.selectOptions(screen.getByLabelText('Varsayılan açılış sayfası'), 'Dosyalar')
    const notice = screen.getByText('Varsayılan açılış sayfası mock profil için güncellendi.')
    await user.click(notice)
    expect(screen.queryByText('Varsayılan açılış sayfası mock profil için güncellendi.')).not.toBeInTheDocument()
  })
})
