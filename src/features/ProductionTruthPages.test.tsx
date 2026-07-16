import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { DATA_SOURCE_STORAGE_KEY } from '../data'
import { ClosedCasesPage } from './closed/ClosedCasesPage'
import { ReportsPage } from './reports/ReportsPage'

const CLOSED_CASE = {
  id: 'case-real-closed',
  caseType: 'traffic',
  officeCaseNumber: '2026/3899',
  notificationFormNumber: null,
  insurerClaimNumber: null,
  plate: '34 GER 038',
  status: 'closed',
  stage: 'closed',
  responsibleUserId: null,
  expertUserId: null,
  serviceId: null,
  serviceProfile: null,
  insurerId: null,
  followUpDate: null,
  lossDate: null,
  notificationDate: '2026-07-12',
  lastInterventionAt: null,
  createdAt: '2026-07-12T08:00:00.000Z',
  updatedAt: '2026-07-16T10:00:00.000Z',
  version: 3,
}

describe('production truth sayfalari', () => {
  it('Kapanan Dosyalar API modunda gercek closed case listesini kullanir ve eksik alan uydurmaz', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [CLOSED_CASE],
        pageInfo: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 },
      }),
    } as Response)
    const user = userEvent.setup()
    render(<MemoryRouter><ClosedCasesPage /></MemoryRouter>)

    expect(await screen.findByText('34 GER 038')).toBeInTheDocument()
    expect(screen.queryByText('26 ESK 26')).not.toBeInTheDocument()
    expect(screen.getByText('Kapanış ayrıntısı henüz bağlı değil')).toBeInTheDocument()
    await user.click(screen.getByText('34 GER 038'))
    await waitFor(() => expect(screen.getByText('Kapanış ayrıntıları bağlı değil')).toBeInTheDocument())
    expect(screen.queryByText('Kapanış kontrolü tamamlandı')).not.toBeInTheDocument()
  })

  it('Raporlar API modunda mock toplam ve ücretleri göstermeden fail-closed kalir', () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    render(<ReportsPage />)
    expect(screen.getByText('Gerçek rapor verisi henüz bağlı değil')).toBeInTheDocument()
    expect(screen.getByText('Mock dosya, ücret veya dönem toplamı gösterilmiyor.')).toBeInTheDocument()
    expect(screen.queryByText('Onaylı Eksper Ücreti')).not.toBeInTheDocument()
  })
})
