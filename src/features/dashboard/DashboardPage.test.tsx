import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockDashboard, useDashboard } from '../../data'
import { DashboardPage } from './DashboardPage'

vi.mock('../../data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data')>()
  return {
    ...actual,
    useDashboard: vi.fn(),
  }
})

const mockedUseDashboard = vi.mocked(useDashboard)

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/dosyalar/:caseId" element={<div>Gerçek dosya detayı hedefi</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockedUseDashboard.mockReturnValue({
    dashboard: buildMockDashboard(),
    source: 'mock',
    status: 'ok',
    reload: vi.fn(),
  })
})

describe('DashboardPage gerçek veri görünüm davranışları', () => {
  it('insan onayı özetinden filtreler ve dosya detayına klavyeyle geçer', () => {
    renderDashboard()

    fireEvent.click(screen.getByRole('button', { name: /Bekleyen Onay/ }))
    const cards = screen.getAllByRole('article')
    expect(cards).toHaveLength(3)
    expect(cards[0]).toHaveAccessibleName(/öncelik/)

    fireEvent.keyDown(cards[0], { key: 'Enter' })
    expect(screen.getByText('Gerçek dosya detayı hedefi')).toBeInTheDocument()
  })

  it('arama ve öncelik filtreleri birlikte uygulanır', () => {
    renderDashboard()

    fireEvent.change(screen.getByPlaceholderText('Panoda ara...'), { target: { value: '34 MPA 764' } })
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.getByRole('article')).toHaveAccessibleName(/34 MPA 764/)

    fireEvent.change(screen.getByRole('combobox', { name: 'Pano önceliği' }), {
      target: { value: 'normal' },
    })
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
    expect(screen.getByText('Eşleşen dosya bulunamadı')).toBeInTheDocument()
  })
})
