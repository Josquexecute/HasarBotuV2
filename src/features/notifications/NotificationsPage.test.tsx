import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { DATA_SOURCE_STORAGE_KEY } from '../../data'
import { initialNotifications } from '../../mocks/workspaces'
import { NotificationsPage } from './NotificationsPage'

function renderPage() {
  return render(<MemoryRouter><NotificationsPage /></MemoryRouter>)
}

afterEach(() => {
  window.localStorage.clear()
})

describe('NotificationsPage veri kaynağı ayrımı', () => {
  it('API modunda dürüst boş durum gösterir ve hiçbir örnek bildirim DOM\'a girmez', () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    const { container } = renderPage()

    expect(screen.getByText('Bildirim altyapısı henüz etkin değil.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Bildirimler' })).toBeInTheDocument()

    // Sabit örnek bildirim metinlerinin hiçbiri render edilmez.
    const markup = container.textContent ?? ''
    for (const item of initialNotifications) {
      expect(markup).not.toContain(item.title)
      expect(markup).not.toContain(item.detail)
      expect(markup).not.toContain(item.plate)
      expect(markup).not.toContain(item.officeNumber)
    }
    // Mock listeye bağlı kontroller de sunulmaz.
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Tümünü Okundu İşaretle/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Bildirim türü')).not.toBeInTheDocument()
    expect(markup).not.toContain('okunmamış')
  })

  it('mock modda prototip bildirim listesi korunur', () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'mock')
    renderPage()

    expect(screen.queryByText('Bildirim altyapısı henüz etkin değil.')).not.toBeInTheDocument()
    expect(screen.getByRole('list')).toBeInTheDocument()
    expect(screen.getByText(initialNotifications[0].title)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Tümünü Okundu İşaretle/ })).toBeInTheDocument()
  })

  it('varsayılan (seçim yapılmamış) durumda mock içerik sızdırmaz', () => {
    const { container } = renderPage()
    const markup = container.textContent ?? ''
    const showsMock = markup.includes(initialNotifications[0].title)
    // Varsayılan kaynak mock ise prototip görünür; api ise boş durum görünür.
    // Her iki halde de "yarı dolu" bir karışım oluşmamalıdır.
    expect(showsMock).toBe(!markup.includes('Bildirim altyapısı henüz etkin değil.'))
  })
})
