import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CasesPage } from './CasesPage'
import { DATA_SOURCE_STORAGE_KEY } from '../../data'

/**
 * HB-2026-014: api modunda gercek API hatasi UI'da ACIKCA gosterilir;
 * mock verisi hatayi hicbir zaman maskelemez.
 */
function renderPage(): void {
  render(
    <MemoryRouter initialEntries={['/dosyalar']}>
      <CasesPage />
    </MemoryRouter>,
  )
}

afterEach(() => {
  window.localStorage.removeItem(DATA_SOURCE_STORAGE_KEY)
  vi.restoreAllMocks()
})

describe('CasesPage api modu durumlari', () => {
  it('401: oturum uyarisi gosterir, mock plaka gostermez', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    } as Response)

    renderPage()
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert').textContent).toContain('Oturum gerekli')
    expect(screen.queryByText('34 MPA 764')).not.toBeInTheDocument()
  })

  it('ag hatasi: servis kullanilamiyor uyarisi gosterir, mock plaka gostermez', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('failed to fetch'))

    renderPage()
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert').textContent).toContain('kullanılamıyor')
    expect(screen.queryByText('34 MPA 764')).not.toBeInTheDocument()
  })

  it('varsayilan mock modda uyarisiz baseline listesi gosterilir', () => {
    renderPage()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getAllByText('34 MPA 764').length).toBeGreaterThan(0)
  })

  it('gercek API liste ozetinde evrak tam veya 0 TL gibi sahte kesin sonuc gostermez', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [{
          id: 'case-api-1',
          caseType: 'traffic',
          officeCaseNumber: '2026/3801',
          notificationFormNumber: null,
          insurerClaimNumber: null,
          plate: '34 API 038',
          status: 'open',
          stage: 'new_notification',
          responsibleUserId: null,
          expertUserId: null,
          serviceId: null,
          serviceProfile: null,
          insurerId: null,
          followUpDate: null,
          lossDate: null,
          notificationDate: null,
          lastInterventionAt: null,
          createdAt: '2026-07-16T08:00:00.000Z',
          updatedAt: '2026-07-16T08:00:00.000Z',
          version: 1,
        }],
        pageInfo: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 },
      }),
    } as Response)

    renderPage()
    expect((await screen.findAllByText('34 API 038')).length).toBeGreaterThan(0)
    expect(screen.getByText('Evrak özeti bu listede hesaplanmıyor')).toBeInTheDocument()
    expect(screen.queryByText('Zorunlu evraklar tam')).not.toBeInTheDocument()
    expect(screen.queryByText('₺0')).not.toBeInTheDocument()
  })
})
