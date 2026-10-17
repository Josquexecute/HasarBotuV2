import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createHttpReportsFeesAdapter, type CaseSummaryReportRecord } from './reportsFeesPort'
import { useCaseSummaryReport } from './useReportsFees'

const report: CaseSummaryReportRecord = {
  period: '2026-10', periodStart: '2026-10-01', periodEndExclusive: '2026-11-01', generatedAt: '2026-10-16T10:00:00Z', periodBasis: 'open_created_closed_finalized', includesFinancials: false,
  summary: { totalCaseCount: 0, openCaseCount: 0, closedCaseCount: 0, trafficCaseCount: 0, cascoCaseCount: 0, approvedFeeCount: 0, approvedFeeTotalMinor: null, controlRequiredFeeCount: 0, closedCaseWithoutFeeCount: 0, approvedValueLossCount: 0, approvedValueLossTotalMinor: null, controlRequiredValueLossCount: 0, notApplicableValueLossCount: 0 },
  responsibleUsers: [{ id: 'owner', name: 'Sorumlu' }], services: [{ id: 'service', name: 'Servis' }], distribution: [], pendingFees: [],
}

it('keeps period filter choices while replacing the report and hides them for another period', async () => {
  let finish!: (value: CaseSummaryReportRecord) => void
  const getCaseSummaryReport = vi.fn().mockResolvedValueOnce(report).mockImplementation(() => new Promise<CaseSummaryReportRecord>(resolve => { finish = resolve }))
  const port = { ...createHttpReportsFeesAdapter(), getCaseSummaryReport }
  const { result, rerender } = renderHook(({ period, serviceId }) => useCaseSummaryReport({ period, serviceId }, true, port), { initialProps: { period: '2026-10', serviceId: '' } })
  await waitFor(() => expect(result.current.status).toBe('ok'))
  rerender({ period: '2026-10', serviceId: 'service' })
  expect(result.current.status).toBe('loading')
  expect(result.current.report).toBeNull()
  expect(result.current.filterOptions.services).toEqual(report.services)
  await act(async () => finish(report))
  rerender({ period: '2026-11', serviceId: '' })
  expect(result.current.report).toBeNull()
  expect(result.current.filterOptions.services).toEqual([])
})
