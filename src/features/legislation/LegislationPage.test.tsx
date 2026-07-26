import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DATA_SOURCE_STORAGE_KEY } from '../../data/ports'
import { legislationSources } from '../../mocks/workspaces'
import { LegislationPage } from './LegislationPage'

afterEach(() => {
  window.localStorage.clear()
})

describe('LegislationPage veri kaynağı ayrımı', () => {
  it('API modunda dürüst boş durum gösterir ve hiçbir örnek kaynak DOM\'a girmez', () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    const { container } = render(<LegislationPage />)

    expect(screen.getByText('Mevzuat kaynak kütüphanesi henüz yapılandırılmadı.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Mevzuat ve AI Yardımcısı' })).toBeInTheDocument()

    // Sabit örnek mevzuat metinlerinin hiçbiri render edilmez.
    const markup = container.textContent ?? ''
    for (const source of legislationSources) {
      expect(markup).not.toContain(source.title)
      expect(markup).not.toContain(source.reference)
      expect(markup).not.toContain(source.summary)
    }
    // Mock kütüphane ve mock soru–cevap yüzeyi sunulmaz.
    expect(screen.queryByText('Kaynak Kütüphanesi')).not.toBeInTheDocument()
    expect(screen.queryByText('Mock Soru–Cevap')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Mevzuat kaynak türü')).not.toBeInTheDocument()
    expect(markup).not.toContain('yerel mock kaynak')
  })

  it('mock modda prototip kaynak kütüphanesi ve mock soru–cevap korunur', () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'mock')
    render(<LegislationPage />)

    expect(screen.queryByText('Mevzuat kaynak kütüphanesi henüz yapılandırılmadı.')).not.toBeInTheDocument()
    expect(screen.getByText('Kaynak Kütüphanesi')).toBeInTheDocument()
    expect(screen.getByText('Mock Soru–Cevap')).toBeInTheDocument()
    expect(screen.getByText(legislationSources[0].title)).toBeInTheDocument()
  })

  it('varsayılan (seçim yapılmamış) durumda mock içerik sızdırmaz', () => {
    const { container } = render(<LegislationPage />)
    const markup = container.textContent ?? ''
    const showsMock = markup.includes(legislationSources[0].title)
    expect(showsMock).toBe(!markup.includes('Mevzuat kaynak kütüphanesi henüz yapılandırılmadı.'))
  })
})
