import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { expect, it, vi } from 'vitest'
import { ActiveCaseContext } from '../../app/activeCase'
import { assistantCaseSelectionKey, rememberAssistantCase } from '../../app/assistantCaseSelection'
import { SessionContext, type SessionContextValue } from '../../app/sessionContext'
import { mockCases } from '../../mocks/cases'
import { ClosedCasesPage } from './ClosedCasesPage'

vi.mock('../../data/useClosedCases', () => ({ useClosedCases: () => ({ cases: [{ ...mockCases[0]!, caseId: 'closed-case' }], source: 'api', status: 'ok' }) }))
vi.mock('../../data/useReportsFees', () => ({ useClosureFeeList: () => ({ items: [], status: 'ok' }), useValueLossClosureList: () => ({ items: [], status: 'ok' }) }))

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
