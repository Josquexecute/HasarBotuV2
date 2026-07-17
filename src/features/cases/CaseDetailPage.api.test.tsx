import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { DATA_SOURCE_STORAGE_KEY } from '../../data'
import { CaseDetailPage } from './CaseDetailPage'

const CLOSED_CASE = {
  id: 'case-closed-38',
  caseType: 'casco' as const,
  officeCaseNumber: '2026/3802',
  notificationFormNumber: null,
  insurerClaimNumber: null,
  plate: '34 API 380',
  status: 'closed' as const,
  stage: 'closed' as const,
  responsibleUserId: null,
  expertUserId: null,
  serviceId: null,
  serviceProfile: null,
  insurerId: null,
  followUpDate: null,
  lossDate: '2026-07-10',
  notificationDate: '2026-07-11',
  lastInterventionAt: '2026-07-16T09:00:00.000Z',
  createdAt: '2026-07-11T08:00:00.000Z',
  updatedAt: '2026-07-16T09:00:00.000Z',
  version: 4,
}

describe('CaseDetailPage gercek API dogruluk siniri', () => {
  it('kapali case listede olmasa bile detail endpointinden acilir ve bagli olmayan modullerde mock gostermez', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    window.sessionStorage.setItem('hasarbotu-active-case-tab', 'Ağır Hasar')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL) => {
      const url = String(input)
      const body = url.endsWith('/api/v1/cases/case-closed-38')
        ? { case: CLOSED_CASE }
        : { items: [], pageInfo: { page: 1, pageSize: 100, totalItems: 0, totalPages: 0 } }
      return { ok: true, status: 200, json: async () => body } as Response
    }) as typeof fetch)

    render(
      <MemoryRouter initialEntries={['/dosyalar/case-closed-38']}>
        <Routes>
          <Route path="/dosyalar/:caseId" element={<CaseDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText('34 API 380')).toBeInTheDocument())
    expect(screen.getByText('Bu modül henüz gerçek API verisine bağlı değildir; mock kayıt gösterilmez.')).toBeInTheDocument()
    expect(screen.queryByText('PERT adayı değil')).not.toBeInTheDocument()
    expect(fetchSpy).toHaveBeenCalledWith('/api/v1/cases/case-closed-38', expect.anything())
  })
})
