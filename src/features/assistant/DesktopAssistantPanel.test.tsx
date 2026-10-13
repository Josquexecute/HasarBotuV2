import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { AssistantCaseSearch, DesktopAssistantPanel } from './DesktopAssistantPanel'
import { mockCases } from '../../mocks/cases'
import { HttpCasesError } from '../../data/httpAdapter'
import type { CasePageResult, CasesDataPort } from '../../data/ports'
import type { CaseOperationsPort, CaseOperationsRecord, CaseNoteRecord } from '../../data/caseOperationsPort'
import { SessionContext, type SessionContextValue } from '../../app/sessionContext'
import { loadTracking } from '../tracking/trackingApi'

vi.mock('../tracking/trackingApi', () => ({ loadTracking: vi.fn(async () => ({ tramer: [], documents: [], users: [], history: [] })) }))
const first = { ...mockCases[0]!, caseId: 'case-a', plate: '34 TEST 01', officeNumber: '2026/1', responsibleUserId: null }
const second = { ...first, caseId: 'case-b', plate: '34 TEST 02', officeNumber: '2026/2' }
const page = (items = [first, second], number = 1): CasePageResult => ({ items, page: number, pageSize: 10, totalCount: items.length, totalPages: 1 })
const note: CaseNoteRecord = { id: 'note-a', noteType: 'internal', subject: null, body: 'Servis ile görüşüldü.', createdAt: '2026-10-13T09:00:00Z', createdByUserId: 'user-a', createdByDisplayName: 'Test', legacySource: null }
function ports(canWrite = true) {
  let notes = [note]
  const cases: CasesDataPort = { listCases: vi.fn(), listCasePage: vi.fn(async () => page()), getCase: vi.fn(async (id) => id === first.caseId ? first : second) }
  const operations: CaseOperationsPort = {
    load: vi.fn(async (caseId): Promise<CaseOperationsRecord> => ({ caseId, asOfDate: '2026-10-13', notes, tasks: [], followUpHistory: [], permissions: { canWrite, canCompleteTasks: canWrite } })),
    createNote: vi.fn(async (_caseId, input) => { const saved = { ...note, ...input, id: 'new-note' }; notes = [...notes, saved]; return saved }),
    createTask: vi.fn(), completeTask: vi.fn(), cancelTask: vi.fn(),
  }
  return { cases, operations }
}
function setup(canWrite = true) {
  const api = ports(canWrite)
  const view = render(<MemoryRouter><AssistantCaseSearch {...api} /></MemoryRouter>)
  return { ...api, view }
}
async function search(text = '34 TEST') {
  await userEvent.clear(screen.getByRole('textbox', { name: 'Plaka veya dosya numarası' }))
  await userEvent.type(screen.getByRole('textbox', { name: 'Plaka veya dosya numarası' }), text)
  await userEvent.click(screen.getByRole('button', { name: 'Ara' }))
}
async function select() {
  await search()
  await userEvent.click(await screen.findByRole('button', { name: /34 TEST 01/ }))
  await screen.findByRole('textbox', { name: 'Hızlı not' })
}
describe('standalone Touch case workspace', () => {
  it('uses bounded server search covering open and closed cases, then writes only the selected case', async () => {
    const api = setup()
    expect(screen.getByRole('button', { name: 'Ara' })).toBeDisabled()
    await select()
    expect(api.cases.listCasePage).toHaveBeenCalledWith({ search: '34 TEST', page: 1, pageSize: 10 })
    await userEvent.type(screen.getByRole('textbox', { name: 'Hızlı not' }), 'Yeni hızlı not')
    await userEvent.click(screen.getByRole('button', { name: 'Notu kaydet' }))
    await screen.findByText('Not dosyaya kaydedildi.')
    expect(api.operations.createNote).toHaveBeenCalledWith(first.caseId, { noteType: 'internal', subject: null, body: 'Yeni hızlı not' }, expect.any(String))
    await userEvent.click(screen.getByRole('button', { name: 'Geçmiş notlar' }))
    await screen.findByText('Yeni hızlı not')
    await userEvent.type(screen.getByRole('textbox', { name: 'Notlarda ara' }), 'görüşüldü')
    expect(screen.getByText(note.body)).toBeInTheDocument()
    expect(screen.queryByText('Yeni hızlı not')).not.toBeInTheDocument()
  })
  it('preserves a draft across tabs and keeps separate drafts for different cases', async () => {
    setup()
    await select()
    await userEvent.type(screen.getByRole('textbox', { name: 'Hızlı not' }), 'İlk taslak')
    await userEvent.click(screen.getByRole('button', { name: 'Süreçler' }))
    await screen.findByText(new RegExp(first.stage), { selector: 'dd' })
    expect(screen.getByText('Atanmamış')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Hızlı not' }))
    expect(screen.getByRole('textbox', { name: 'Hızlı not' })).toHaveValue('İlk taslak')
    await userEvent.click(screen.getByRole('button', { name: /34 TEST 02/ }))
    expect(screen.getByRole('textbox', { name: 'Hızlı not' })).toHaveValue('')
    await userEvent.click(screen.getByRole('button', { name: /34 TEST 01/ }))
    expect(screen.getByRole('textbox', { name: 'Hızlı not' })).toHaveValue('İlk taslak')
  })
  it('ignores late search responses and removes stale clickable results while loading', async () => {
    const api = setup()
    let finish!: (value: CasePageResult) => void
    vi.mocked(api.cases.listCasePage).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    await search('OLD')
    await search('NEW')
    await screen.findByRole('button', { name: /34 TEST 02/ })
    await act(async () => finish(page([{ ...first, plate: 'STALE' }])))
    expect(screen.queryByRole('button', { name: /STALE/ })).not.toBeInTheDocument()
  })
  it('paginates without fetching all matching files', async () => {
    const api = setup()
    vi.mocked(api.cases.listCasePage).mockResolvedValueOnce({ ...page(), totalCount: 11, totalPages: 2 }).mockResolvedValueOnce({ ...page([second], 2), totalCount: 11, totalPages: 2 })
    await search()
    await userEvent.click(await screen.findByRole('button', { name: 'Sonraki' }))
    await waitFor(() => expect(api.cases.listCasePage).toHaveBeenLastCalledWith({ search: '34 TEST', page: 2, pageSize: 10 }))
    await screen.findByText('2 / 2')
    expect(screen.getByRole('button', { name: 'Sonraki' })).toBeDisabled()
  })
  it('restores the selected file on remount and reloads actual operations', async () => {
    const api = setup()
    await select()
    api.view.unmount()
    render(<MemoryRouter><AssistantCaseSearch cases={api.cases} operations={api.operations} /></MemoryRouter>)
    await screen.findByRole('textbox', { name: 'Hızlı not' })
    expect(api.cases.getCase).toHaveBeenCalledWith(first.caseId)
    await userEvent.click(screen.getByRole('button', { name: 'Geçmiş notlar' }))
    await screen.findByText(note.body)
    const count = vi.mocked(api.operations.load).mock.calls.length
    fireEvent(window, new Event('focus'))
    await waitFor(() => expect(api.operations.load).toHaveBeenCalledTimes(count + 2))
  })
  it('makes denied writing unavailable while keeping read access to notes', async () => {
    const api = setup(false)
    await select()
    await screen.findByText('Bu dosyaya not ekleme yetkiniz yok.')
    await userEvent.type(screen.getByRole('textbox', { name: 'Hızlı not' }), 'Yetkisiz')
    expect(screen.getByRole('button', { name: 'Notu kaydet' })).toBeDisabled()
    expect(api.operations.createNote).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Geçmiş notlar' }))
    await screen.findByText(note.body)
  })
  it('refreshes process tracking on focus after the panel was hidden during an outage', async () => {
    setup()
    await select()
    vi.mocked(loadTracking).mockRejectedValueOnce(new Error('offline'))
    await userEvent.click(screen.getByRole('button', { name: 'Süreçler' }))
    await screen.findByText(/Tramer ve evrak takibi alınamadı/)
    fireEvent(window, new Event('focus'))
    await screen.findByText('Tramer talebi yok.')
    expect(screen.queryByText(/Tramer ve evrak takibi alınamadı/)).not.toBeInTheDocument()
  })
  it('reports authentication failure without presenting a successful empty search', async () => {
    const reportUnauthorized = vi.fn()
    const session: SessionContextValue = { mode: 'api', status: 'authenticated', user: { id: 'user-a', organizationId: 'org', email: 'test@example.test', displayName: 'Test', roles: ['admin'] }, notice: null, login: vi.fn(), logout: vi.fn(), reportUnauthorized }
    const api = ports()
    vi.mocked(api.cases.listCasePage).mockRejectedValue(new HttpCasesError('unauthorized', 'expired'))
    render(<MemoryRouter><SessionContext.Provider value={session}><AssistantCaseSearch {...api} /></SessionContext.Provider></MemoryRouter>)
    await search()
    await screen.findByRole('alert')
    expect(reportUnauthorized).toHaveBeenCalledOnce()
    expect(screen.queryByText(/0 dosya/)).not.toBeInTheDocument()
  })
  it('keeps unauthenticated data hidden and native commands unavailable in a normal browser', () => {
    render(<DesktopAssistantPanel />)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Giriş yap' })).toBeDisabled()
  })
})
