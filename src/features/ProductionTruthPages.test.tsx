import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import {
  DATA_SOURCE_STORAGE_KEY,
  createHttpCasesAdapter,
  createHttpReportsFeesAdapter,
} from '../data'
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
    const casesPort = createHttpCasesAdapter({
      fetchImpl: async (input, init) => {
        void input
        void init
        return new Response(JSON.stringify({
          items: [CLOSED_CASE],
          pageInfo: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      },
    })
    const feePort = createHttpReportsFeesAdapter({
      fetchImpl: async (input, init) => {
        void input
        void init
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      },
    })
    const user = userEvent.setup()
    render(<MemoryRouter><ClosedCasesPage casesPort={casesPort} feePort={feePort} /></MemoryRouter>)

    expect(await screen.findByText('34 GER 038')).toBeInTheDocument()
    expect(screen.queryByText('26 ESK 26')).not.toBeInTheDocument()
    expect(screen.getByText('Kapanış ayrıntısı henüz bağlı değil')).toBeInTheDocument()
    await user.click(screen.getByText('34 GER 038'))
    await waitFor(() => expect(screen.getByText('Kapanış ayrıntıları bağlı değil')).toBeInTheDocument())
    expect(screen.queryByText('Kapanış kontrolü tamamlandı')).not.toBeInTheDocument()
  })

  it('Raporlar API modunda gerçek dönem toplamını gösterir ve mock toplama düşmez', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    const currentPeriod = new Date().toISOString().slice(0, 7)
    const reportPort = createHttpReportsFeesAdapter({
      fetchImpl: async (input, init) => {
        void input
        void init
        return new Response(JSON.stringify({
          period: currentPeriod,
          periodStart: `${currentPeriod}-01`,
          periodEndExclusive: '2026-08-01',
          generatedAt: '2026-07-16T10:00:00.000Z',
          periodBasis: 'open_created_closed_finalized',
          summary: {
            totalCaseCount: 3,
            openCaseCount: 1,
            closedCaseCount: 2,
            trafficCaseCount: 2,
            cascoCaseCount: 1,
            approvedFeeCount: 1,
            approvedFeeTotalMinor: 485_000,
            controlRequiredFeeCount: 0,
            closedCaseWithoutFeeCount: 1,
          },
          distribution: [
            { code: 'traffic', count: 2 },
            { code: 'casco', count: 1 },
            { code: 'closed', count: 2 },
          ],
          responsibleUsers: [],
          services: [],
          pendingFees: [],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      },
    })
    render(<MemoryRouter><ReportsPage reportPort={reportPort} /></MemoryRouter>)
    expect((await screen.findAllByText(/₺4\.850/))).toHaveLength(2)
    expect(screen.getByText('Onaylı Eksper Ücreti')).toBeInTheDocument()
    expect(screen.queryByText(/28\.750,00/)).not.toBeInTheDocument()
  })
})
