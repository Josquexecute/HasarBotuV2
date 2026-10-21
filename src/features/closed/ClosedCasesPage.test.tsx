import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { expect, it, vi } from 'vitest'
import { ActiveCaseContext } from '../../app/activeCase'
import { assistantCaseSelectionKey, rememberAssistantCase } from '../../app/assistantCaseSelection'
import { SessionContext, type SessionContextValue } from '../../app/sessionContext'
import { mockCases } from '../../mocks/cases'
import { useClosedCases } from '../../data/useClosedCases'
import { useValueLossClosureList } from '../../data/useReportsFees'
import type { TrafficValueLossClosureSummaryRecord } from '../../data/reportsFeesPort'
import { ClosedCasesPage } from './ClosedCasesPage'

vi.mock('../../data/useClosedCases', () => ({ useClosedCases: vi.fn(() => ({ cases: [{ ...mockCases[0]!, caseId: 'closed-case' }], source: 'api', status: 'ok', reload: vi.fn() })) }))
vi.mock('../../data/useReportsFees', () => ({ useClosureFeeList: () => ({ items: [], status: 'ok' }), useValueLossClosureList: vi.fn(() => ({ items: [], status: 'ok' })) }))

it('syncs closed list selections to Touch, including repeated keyboard selection', async () => {
  const session: SessionContextValue = {
    mode: 'api', status: 'authenticated', user: { id: 'user-a', organizationId: 'org-a', email: 'a@example.test', displayName: 'Test', roles: ['admin'] },
    notice: null, login: vi.fn(), logout: vi.fn(), reportUnauthorized: vi.fn(),
  }
  render(<MemoryRouter><SessionContext.Provider value={session}><ActiveCaseContext.Provider value={vi.fn()}><ClosedCasesPage /></ActiveCaseContext.Provider></SessionContext.Provider></MemoryRouter>)
  await userEvent.click(screen.getByText(mockCases[0]!.plate))
  expect(localStorage.getItem(assistantCaseSelectionKey('user-a'))).toBe('closed-case')
  rememberAssistantCase('user-a', 'other-case')
  const row = screen.getAllByRole('row')[1]!
  row.focus()
  await userEvent.keyboard('{Enter}')
  expect(localStorage.getItem(assistantCaseSelectionKey('user-a'))).toBe('closed-case')
})

it('sorts closure instants across months and years, keeps same-day times, and places missing dates last', async () => {
  const cases = ['34 OLD 01', '34 SEP 02', '34 AM 03', '34 PM 04', '34 NONE 05'].map((plate, index) => ({
    ...mockCases[0]!, caseId: `closed-${index}`, plate,
  }))
  const summary: TrafficValueLossClosureSummaryRecord = {
    status: 'not_applicable', reason: 'Kasko dosyası', ruleVersion: 'traffic-value-loss-closure/1.0.0', requiresHumanReview: false,
    assessmentId: null, assessmentVersionId: null, assessmentVersion: null, assessmentStatus: null,
    humanApprovalStatus: null, calculationRuleVersion: null, resultCode: null, amountMinor: null, reportId: null, reportGeneratedAt: null,
  }
  vi.mocked(useClosedCases).mockReturnValue({ cases, source: 'api', status: 'ok', reload: vi.fn() })
  vi.mocked(useValueLossClosureList).mockReturnValue({
    status: 'ok',
    items: ['2025-12-31T12:00:00.000Z', '2026-09-30T12:00:00.000Z', '2026-10-02T08:00:00.000Z', '2026-10-02T18:00:00.000Z'].map((closedAt, index) => ({
      caseId: cases[index]!.caseId, officeCaseNumber: cases[index]!.officeNumber, plate: cases[index]!.plate,
      caseType: 'casco', closedAt, closureMode: 'normal', closureReason: null, summary,
    })),
  })
  render(<MemoryRouter><ClosedCasesPage /></MemoryRouter>)
  const rowPlates = () => screen.getAllByRole('row').slice(1).map(row => within(row).getByText(/^34 /).textContent)
  expect(rowPlates()).toEqual(['34 PM 04', '34 AM 03', '34 SEP 02', '34 OLD 01', '34 NONE 05'])
  expect(screen.getAllByText('02.10.2026')).toHaveLength(2)
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Kapanan dosya sıralaması' }), 'plate')
  expect(rowPlates()).toEqual(['34 AM 03', '34 NONE 05', '34 OLD 01', '34 PM 04', '34 SEP 02'])
})

it('preserves chronological sorting for mock calendar dates across a month boundary', () => {
  vi.mocked(useClosedCases).mockReturnValue({ cases: [], source: 'mock', status: 'idle', reload: vi.fn() })
  render(<MemoryRouter><ClosedCasesPage /></MemoryRouter>)
  expect(screen.getAllByRole('row').slice(1).map(row => within(row).getAllByRole('cell')[0]!.textContent)).toEqual([
    '09.07.2026', '08.07.2026', '07.07.2026', '04.07.2026', '02.07.2026', '30.06.2026', '28.06.2026', '25.06.2026',
  ])
})
