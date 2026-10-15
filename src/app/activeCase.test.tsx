import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { ActiveCaseContext, useActiveCase } from './activeCase'
import { assistantCaseSelectionKey, rememberAssistantCase } from './assistantCaseSelection'
import { SessionContext, type SessionContextValue } from './sessionContext'
import { mockCases } from '../mocks/cases'
import type { CaseRecord } from '../types/case'
import type { DataSourceKind } from '../data/ports'

const first = { ...mockCases[0]!, caseId: 'case-first' }
const second = { ...first, caseId: 'case-second' }
const session: SessionContextValue = {
  mode: 'api', status: 'authenticated', user: { id: 'user-a', organizationId: 'org-a', email: 'a@example.test', displayName: 'Test', roles: ['admin'] },
  notice: null, login: vi.fn(), logout: vi.fn(), reportUnauthorized: vi.fn(),
}
function CaseScreen({ item, source }: { item: CaseRecord; source: DataSourceKind }) {
  const activate = useActiveCase(item, source)
  return <button onClick={() => activate(item)}>Dosyayı seç</button>
}
it('publishes main-window selections by case identity and keeps the last case after navigation', () => {
  const publish = vi.fn()
  const content = (item: CaseRecord) => <SessionContext.Provider value={session}><ActiveCaseContext.Provider value={publish}><CaseScreen item={item} source="api" /></ActiveCaseContext.Provider></SessionContext.Provider>
  const view = render(content(first))
  expect(localStorage.getItem(assistantCaseSelectionKey('user-a'))).toBe(first.caseId)
  view.rerender(content(second))
  expect(localStorage.getItem(assistantCaseSelectionKey('user-a'))).toBe(second.caseId)
  view.unmount()
  expect(publish).toHaveBeenLastCalledWith(null)
  expect(localStorage.getItem(assistantCaseSelectionKey('user-a'))).toBe(second.caseId)
  expect(localStorage.getItem(assistantCaseSelectionKey('user-b'))).toBeNull()
})
it('reselects the same main row after a different manual Touch selection', async () => {
  render(<SessionContext.Provider value={session}><ActiveCaseContext.Provider value={vi.fn()}><CaseScreen item={first} source="api" /></ActiveCaseContext.Provider></SessionContext.Provider>)
  rememberAssistantCase('user-a', second.caseId)
  await userEvent.click(screen.getByRole('button', { name: 'Dosyayı seç' }))
  expect(localStorage.getItem(assistantCaseSelectionKey('user-a'))).toBe(first.caseId)
})
it('keeps mock selections out of the authenticated Touch selection', () => {
  render(<SessionContext.Provider value={session}><ActiveCaseContext.Provider value={vi.fn()}><CaseScreen item={first} source="mock" /></ActiveCaseContext.Provider></SessionContext.Provider>)
  expect(localStorage.getItem(assistantCaseSelectionKey('user-a'))).toBeNull()
})
it('preserves the main target and records a diagnostic when local selection storage fails', () => {
  const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const publish = vi.fn()
  try {
    const view = render(<SessionContext.Provider value={session}><ActiveCaseContext.Provider value={publish}><CaseScreen item={first} source="api" /></ActiveCaseContext.Provider></SessionContext.Provider>)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ caseId: first.caseId }))
    expect(warning).toHaveBeenCalledOnce()
    view.unmount()
  } finally { storage.mockRestore(); warning.mockRestore() }
})
