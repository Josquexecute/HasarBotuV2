import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from './App'

describe('HasarBotu V2 UI prototipi', () => {
  it('üst aramadaki sorguyu Enter ile Dosyalar ekranına ve liste aramasına aktarır', async () => {
    window.history.replaceState({}, '', '/ayarlar')
    const user = userEvent.setup()
    render(<App />)

    const globalSearch = screen.getByPlaceholderText('Plaka, dosya no veya isim ara')
    await user.type(globalSearch, '34mpa764{Enter}')

    expect(await screen.findByRole('heading', { name: 'Tüm Dosyalar 1' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Plaka, dosya no, şirket, kişi veya servis ara...')).toHaveValue('34mpa764')
    expect(screen.getAllByText('34 MPA 764').length).toBeGreaterThan(0)
    expect(window.location.pathname).toBe('/dosyalar')
    expect(new URLSearchParams(window.location.search).get('q')).toBe('34mpa764')
  })

  it('üst aramada boş sorgu gönderildiğinde bulunduğu ekranda kalır', async () => {
    window.history.replaceState({}, '', '/ayarlar')
    const user = userEvent.setup()
    render(<App />)

    const globalSearch = screen.getByPlaceholderText('Plaka, dosya no veya isim ara')
    await user.type(globalSearch, '   ')
    await user.keyboard('{Enter}')

    expect(screen.getByRole('heading', { name: 'Ayarlar' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/ayarlar')
    expect(window.location.search).toBe('')
  })

  it('plakayı boşluklu veya boşluksuz aynı kayıtla eşleştirir', async () => {
    window.history.replaceState({}, '', '/dosyalar')
    const user = userEvent.setup()
    render(<App />)

    const search = screen.getByPlaceholderText('Plaka, dosya no, şirket, kişi veya servis ara...')
    await user.type(search, '34mpa764')
    expect(screen.getByRole('heading', { name: 'Tüm Dosyalar 1' })).toBeInTheDocument()
    expect(screen.getAllByText('34 MPA 764').length).toBeGreaterThan(0)

    await user.clear(search)
    await user.type(search, '34 mpa764')
    expect(screen.getByRole('heading', { name: 'Tüm Dosyalar 1' })).toBeInTheDocument()
    expect(screen.getAllByText('34 MPA 764').length).toBeGreaterThan(0)
  })

  it('tire ve eğik çizgi olmadan ihbar ile ofis numarasını bulur', async () => {
    window.history.replaceState({}, '', '/dosyalar')
    const user = userEvent.setup()
    render(<App />)

    const search = screen.getByPlaceholderText('Plaka, dosya no, şirket, kişi veya servis ara...')
    await user.type(search, 'F20260977')
    expect(screen.getByRole('heading', { name: 'Tüm Dosyalar 1' })).toBeInTheDocument()
    expect(screen.getAllByText('34 SU 338').length).toBeGreaterThan(0)

    await user.clear(search)
    await user.type(search, '202617')
    expect(screen.getAllByText('34 SU 338').length).toBeGreaterThan(0)
    expect(screen.queryByText('34 MPA 764')).not.toBeInTheDocument()
  })

  it('Türkçe karakter farkına tolerans gösterir', async () => {
    window.history.replaceState({}, '', '/dosyalar')
    const user = userEvent.setup()
    render(<App />)

    const search = screen.getByPlaceholderText('Plaka, dosya no, şirket, kişi veya servis ara...')
    await user.type(search, 'omer 34mpa764')

    expect(screen.getByRole('heading', { name: 'Tüm Dosyalar 1' })).toBeInTheDocument()
    expect(screen.getAllByText('34 MPA 764').length).toBeGreaterThan(0)
  })

  it('farklı metaveri alanlarındaki kelimeleri birlikte eşleştirir', async () => {
    window.history.replaceState({}, '', '/dosyalar')
    const user = userEvent.setup()
    render(<App />)

    const search = screen.getByPlaceholderText('Plaka, dosya no, şirket, kişi veya servis ara...')
    await user.type(search, 'ahmet akşam')

    expect(screen.getByRole('heading', { name: 'Tüm Dosyalar 1' })).toBeInTheDocument()
    expect(screen.getAllByText('34 MPA 764').length).toBeGreaterThan(0)
    expect(screen.queryByText('07 YK 220')).not.toBeInTheDocument()
  })

  it('anonim mock veri kullandığını görünür biçimde belirtir ve kapanmış ücret kontrol örneğini gösterir', async () => {
    window.history.replaceState({}, '', '/raporlar-ve-ucretler')
    render(<App />)

    expect(screen.getByText('UI Prototip · Mock Veri')).toBeInTheDocument()
    const pendingFeeTable = screen.getByRole('table')
    expect(within(pendingFeeTable).getByText('2026/168')).toBeInTheDocument()
    expect(within(pendingFeeTable).getAllByText('Kontrol Bekliyor').length).toBeGreaterThan(0)
  })

  it('ana navigasyonu, tema, yoğunluk ve menü tercihlerini çalıştırır', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Operasyon Durumu' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Ana navigasyon' })).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Dosyalar' }))
    expect(screen.getByRole('heading', { name: /Tüm Dosyalar/ })).toBeInTheDocument()

    const themeRoot = document.querySelector('.theme-root')
    expect(themeRoot).toHaveAttribute('data-theme', 'light')
    await user.click(screen.getByRole('button', { name: 'Koyu temaya geç' }))
    expect(themeRoot).toHaveAttribute('data-theme', 'dark')

    await user.click(screen.getByRole('button', { name: 'Kompakt' }))
    expect(themeRoot).toHaveAttribute('data-density', 'comfortable')

    await user.click(screen.getByRole('button', { name: 'Menüyü daralt' }))
    expect(screen.getByRole('button', { name: 'Menüyü genişlet' })).toBeInTheDocument()
  })

  it('Durum Panosu filtreleme, yenileme ve dosyaya geçiş akışını çalıştırır', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Yenile' }))
    expect(screen.getByText('Son güncelleme şimdi')).toBeInTheDocument()

    const boardSearch = screen.getByPlaceholderText('Panoda ara...')
    await user.type(boardSearch, '55 SAM 605')
    expect(screen.getByRole('article', { name: '55 SAM 605, Yeni İhbar, Kritik öncelik. Dosyayı aç.' })).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: /34 MPA 764, Ekspertiz Bekliyor/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('article', { name: '55 SAM 605, Yeni İhbar, Kritik öncelik. Dosyayı aç.' }))
    expect(await screen.findByRole('button', { name: 'Tek Dosyayı Yenile' })).toBeInTheDocument()
    expect(screen.getAllByText('55 SAM 605').length).toBeGreaterThan(0)
  })

  it('dosya arama ve filtre temizleme akışını çalıştırır', async () => {
    window.history.replaceState({}, '', '/dosyalar')
    const user = userEvent.setup()
    render(<App />)

    const search = screen.getByPlaceholderText('Plaka, dosya no, şirket, kişi veya servis ara...')
    await user.type(search, 'bulunmayan kayıt')
    expect(screen.getByText('Eşleşen dosya bulunamadı')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Filtreleri temizle' }))
    expect(screen.getAllByText('34 MPA 764').length).toBeGreaterThan(0)
  })

  it('dosya sıralama, tür filtresi ve yeni ihbar mock adımlarını çalıştırır', async () => {
    window.history.replaceState({}, '', '/dosyalar')
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Plaka / Dosya No' }))
    const rows = within(screen.getByRole('table')).getAllByRole('row')
    expect(within(rows[1]).getByText('01 ADN 101')).toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Dosya türü' }), 'Kasko')
    expect(screen.getByRole('heading', { name: 'Tüm Dosyalar 6' })).toBeInTheDocument()
    expect(screen.queryByText('06 ABC 123')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Sütunlar' }))
    expect(screen.getByText('Sütun görünümü kompakt varsayılanlara sıfırlandı.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Yeni Dosya' }))
    const dialog = screen.getByRole('dialog', { name: 'Yeni İhbar Oluştur' })
    const analysisButton = within(dialog).getByRole('button', { name: 'Analize Geç' })
    expect(analysisButton).toBeDisabled()
    await user.click(within(dialog).getByRole('button', { name: 'Mock belge seç' }))
    expect(analysisButton).toBeEnabled()
    await user.click(analysisButton)
    expect(within(dialog).getByText('Alan kontrolü için örnek belge önizlemesi hazır.')).toBeInTheDocument()
  })

  it('satır seçimi hızlı detayı günceller, çift tık tam dosyayı ve sekmeleri açar', async () => {
    window.history.replaceState({}, '', '/dosyalar')
    const user = userEvent.setup()
    render(<App />)

    const plateCell = screen.getByText('06 ABC 123')
    const row = plateCell.closest('tr')
    expect(row).not.toBeNull()
    await user.click(row!)
    expect(screen.getByRole('heading', { name: '06 ABC 123' })).toBeInTheDocument()

    fireEvent.doubleClick(row!)
    expect(await screen.findByText('Dosya Özeti')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Operasyon' }))
    expect(screen.getByRole('heading', { name: 'Notlar ve Görüşmeler' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Dosyayı Kapat' }))
    expect(screen.getByRole('dialog', { name: 'Dosya Kapatma Kontrolü' })).toBeInTheDocument()
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Vazgeç' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('100+ mock fotoğrafı lazy yükler ve Dosya Asistanı panelini açıp kapatır', async () => {
    window.history.replaceState({}, '', '/dosyalar/case-2026-184')
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByText('Dosya Asistanı')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Asistanı kapat' }))
    expect(screen.queryByText('Dosya Asistanı')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Asistanı aç' }))
    expect(screen.getByText('Dosya Asistanı')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Evrak ve Fotoğraf' }))
    expect(screen.getAllByRole('img', { name: /Mock hasar fotoğrafı/ })).toHaveLength(12)
    await user.click(screen.getByRole('button', { name: 'Yoğun Test (108)' }))
    const photos = screen.getAllByRole('img', { name: /Mock hasar fotoğrafı/ })
    expect(photos).toHaveLength(108)
    expect(photos[0]).toHaveAttribute('loading', 'lazy')
    expect(screen.getByText('108 anonim mock görsel · lazy loading stres testi')).toBeInTheDocument()
  })

  it('tüm ana navigasyon çalışma alanlarını açar', async () => {
    const user = userEvent.setup()
    render(<App />)
    const destinations = [
      ['Kapanan Dosyalar', 'Kapanan Dosyalar'],
      ['Raporlar ve Ücretler', 'Raporlar ve Ücretler'],
      ['Mevzuat ve AI Yardımcısı', 'Mevzuat ve AI Yardımcısı'],
      ['Bildirimler', 'Bildirimler'],
      ['Yönetim', 'Yönetim'],
      ['Ayarlar', 'Ayarlar'],
      ['Durum Panosu', 'Operasyon Durumu'],
      ['Dosyalar', 'Tüm Dosyalar'],
    ] as const

    for (const [linkName, headingName] of destinations) {
      const link = screen.getByRole('link', { name: linkName === 'Bildirimler' ? /Bildirimler/ : linkName })
      await user.click(link)
      expect(screen.getByRole('heading', { name: new RegExp(headingName) })).toBeInTheDocument()
    }
  })

  it('plaka dışı alanlarda arama ile sorumlu ve servis filtrelerini çalıştırır', async () => {
    window.history.replaceState({}, '', '/dosyalar')
    const user = userEvent.setup()
    render(<App />)

    const search = screen.getByPlaceholderText('Plaka, dosya no, şirket, kişi veya servis ara...')
    await user.type(search, 'F-2026-0987')
    expect(screen.getAllByText('06 ABC 123').length).toBeGreaterThan(0)
    await user.clear(search)
    await user.type(search, 'Başkent Oto')
    expect(screen.getAllByText('06 ABC 123').length).toBeGreaterThan(0)
    await user.clear(search)
    await user.type(search, 'Selin Aras')
    expect(screen.getByRole('heading', { name: 'Tüm Dosyalar 4' })).toBeInTheDocument()

    await user.clear(search)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Dosya sorumlusu' }), 'Selin Aras')
    expect(screen.getByRole('heading', { name: 'Tüm Dosyalar 4' })).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Dosya servisi' }), 'Başkent Oto')
    expect(screen.getByRole('heading', { name: 'Tüm Dosyalar 1' })).toBeInTheDocument()
  })

  it('seçili sekmeyi dosya geçişinde korur ve Tek Dosyayı Yenile geri bildirimi verir', async () => {
    window.history.replaceState({}, '', '/dosyalar/case-2026-184')
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Değer Kaybı' }))
    expect(screen.getByText('İsteğe bağlı')).toBeInTheDocument()
    expect(screen.queryByText('Zorunlu süreç')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Sonraki dosyaya geç' }))
    expect(screen.getByRole('heading', { name: 'Değer Kaybı' })).toBeInTheDocument()
    expect(screen.getByText('Zorunlu süreç')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Tek Dosyayı Yenile' }))
    expect(screen.getByText('06 ABC 123 mock verisi yenilendi.')).toBeInTheDocument()
  })

  it('bildirimden ilgili dosyaya geçer', async () => {
    window.history.replaceState({}, '', '/bildirimler')
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: '34 MPA 764 dosyasına git' }))
    expect(screen.getByRole('button', { name: 'Tek Dosyayı Yenile' })).toBeInTheDocument()
    expect(screen.getAllByText('34 MPA 764').length).toBeGreaterThan(0)
  })

  it('mevzuat kaynak detayını açar ve Escape ile kapatır', async () => {
    window.history.replaceState({}, '', '/mevzuat-ve-ai')
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /Karayolları Trafik Kanunu/ }))
    expect(screen.getByRole('complementary', { name: 'Mevzuat kaynak detayı' })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('complementary', { name: 'Mevzuat kaynak detayı' })).not.toBeInTheDocument()
  })

  it('Yeni İhbar modalını ve hızlı detay panelini Escape ile kapatır', async () => {
    window.history.replaceState({}, '', '/dosyalar')
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByRole('complementary', { name: 'Hızlı dosya detayı' })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('complementary', { name: 'Hızlı dosya detayı' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Yeni Dosya' }))
    expect(screen.getByRole('dialog', { name: 'Yeni İhbar Oluştur' })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Yeni İhbar Oluştur' })).not.toBeInTheDocument()
  })
})
