import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { AssistantCaseSearch, DesktopAssistantPanel } from './DesktopAssistantPanel'
import { AssistantAppearanceProvider } from './AssistantAppearanceProvider'
import { mockCases } from '../../mocks/cases'
import { HttpCasesError } from '../../data/httpAdapter'
import type { CasePageResult, CasesDataPort } from '../../data/ports'
import type { CaseRecord } from '../../types/case'
import type { CaseOperationsPort, CaseOperationsRecord, CaseNoteRecord } from '../../data/caseOperationsPort'
import { SessionContext, type SessionContextValue } from '../../app/sessionContext'
import { assistantCaseSelectionKey, rememberAssistantCase } from '../../app/assistantCaseSelection'
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
    deleteNote: vi.fn(),
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
  await userEvent.click(screen.getByRole('tab', { name: 'Dosyalar' }))
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
  it('separates four panels, supports keyboard tabs and preserves drafts without repeating searches', async () => {
    const api = setup()
    expect(screen.getAllByRole('tab')).toHaveLength(4)
    expect(screen.getByRole('tab', { name: 'Hızlı not' })).toBeDisabled()
    await select()
    await userEvent.type(screen.getByRole('textbox', { name: 'Hızlı not' }), 'Sekmelerde korunan taslak')
    const loads = vi.mocked(api.cases.listCasePage).mock.calls.length
    screen.getByRole('tab', { name: 'Hızlı not' }).focus()
    await userEvent.keyboard('{Home}')
    expect(screen.getByRole('tabpanel', { name: 'Dosyalar' })).toBeVisible()
    expect(screen.queryByRole('textbox', { name: 'Hızlı not' })).not.toBeInTheDocument()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('textbox', { name: 'Hızlı not' })).toHaveValue('Sekmelerde korunan taslak')
    expect(api.cases.listCasePage).toHaveBeenCalledTimes(loads)
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
  })
  it('passes the current authenticated case to both native shortcuts and omits anonymous selection', async () => {
    const choose = vi.fn()
    vi.stubGlobal('hasarbotuAssistantMenu', { choose })
    const session: SessionContextValue = { mode: 'api', status: 'authenticated', user: { id: 'user-a', organizationId: 'org', email: 'test@example.test', displayName: 'Test', roles: ['admin'] }, notice: null, login: vi.fn(), logout: vi.fn(), reportUnauthorized: vi.fn() }
    try {
      const view = render(<SessionContext.Provider value={session}><AssistantAppearanceProvider><DesktopAssistantPanel /></AssistantAppearanceProvider></SessionContext.Provider>)
      act(() => { rememberAssistantCase('user-a', first.caseId) })
      await userEvent.click(screen.getByRole('button', { name: 'Uygulamayı aç' }))
      expect(choose).toHaveBeenLastCalledWith('open', first.caseId)
      act(() => { rememberAssistantCase('user-a', second.caseId) })
      await userEvent.click(screen.getByRole('button', { name: 'Bildirimler' }))
      expect(choose).toHaveBeenLastCalledWith('notifications', second.caseId)
      view.rerender(<SessionContext.Provider value={{ ...session, status: 'anonymous', user: null }}><AssistantAppearanceProvider><DesktopAssistantPanel /></AssistantAppearanceProvider></SessionContext.Provider>)
      await userEvent.click(screen.getByRole('button', { name: 'Giriş yap' }))
      expect(choose).toHaveBeenLastCalledWith('open', undefined)
    } finally { vi.unstubAllGlobals() }
  })
  it('receives a main-window storage selection without requiring another search', async () => {
    const api = setup()
    localStorage.setItem(assistantCaseSelectionKey('anonymous'), first.caseId)
    fireEvent(window, new StorageEvent('storage', { key: assistantCaseSelectionKey('anonymous'), newValue: first.caseId, storageArea: localStorage }))
    await screen.findByRole('textbox', { name: 'Hızlı not' })
    expect(screen.getByText(first.plate, { selector: '.touch-assistant__target strong' })).toBeInTheDocument()
    expect(api.cases.listCasePage).not.toHaveBeenCalled()
    const count = vi.mocked(api.cases.getCase).mock.calls.length
    fireEvent(window, new StorageEvent('storage', { key: assistantCaseSelectionKey('another-user'), newValue: second.caseId, storageArea: localStorage }))
    expect(api.cases.getCase).toHaveBeenCalledTimes(count)
  })
  it('hides the old target while a new main selection loads and restores each case draft', async () => {
    const api = setup()
    act(() => { rememberAssistantCase('anonymous', first.caseId) })
    await userEvent.type(await screen.findByRole('textbox', { name: 'Hızlı not' }), 'Birinci dosyanın taslağı')
    let finish!: (item: CaseRecord) => void
    vi.mocked(api.cases.getCase).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    act(() => { rememberAssistantCase('anonymous', second.caseId) })
    expect(screen.queryByRole('textbox', { name: 'Hızlı not' })).not.toBeInTheDocument()
    expect(screen.getByText('Seçili dosya yükleniyor…')).toBeInTheDocument()
    await act(async () => finish(second))
    expect(await screen.findByRole('textbox', { name: 'Hızlı not' })).toHaveValue('')
    act(() => { rememberAssistantCase('anonymous', first.caseId) })
    expect(await screen.findByRole('textbox', { name: 'Hızlı not' })).toHaveValue('Birinci dosyanın taslağı')
  })
  it('ignores a late previous selection response after a newer selection has loaded', async () => {
    const api = setup()
    let finish!: (item: CaseRecord) => void
    vi.mocked(api.cases.getCase).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    act(() => { rememberAssistantCase('anonymous', first.caseId) })
    act(() => { rememberAssistantCase('anonymous', second.caseId) })
    await screen.findByRole('textbox', { name: 'Hızlı not' })
    await act(async () => finish(first))
    expect(screen.getByText(second.plate, { selector: '.touch-assistant__target strong' })).toBeInTheDocument()
    expect(api.operations.createNote).not.toHaveBeenCalled()
  })
  it('reloads a selection changed while hidden on focus and retries failed loads without a search', async () => {
    const api = setup()
    vi.mocked(api.cases.getCase).mockRejectedValueOnce(new Error('offline'))
    localStorage.setItem(assistantCaseSelectionKey('anonymous'), second.caseId)
    fireEvent(window, new Event('focus'))
    await screen.findByRole('button', { name: 'Tekrar dene' })
    expect(screen.queryByRole('textbox', { name: 'Hızlı not' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Tekrar dene' }))
    await screen.findByRole('textbox', { name: 'Hızlı not' })
    expect(screen.getByText(second.plate, { selector: '.touch-assistant__target strong' })).toBeInTheDocument()
    expect(api.cases.listCasePage).not.toHaveBeenCalled()
  })
  it('opens the currently selected case folder from Touch', async () => {
    const open = vi.fn(async () => ({ opened: true }))
    Object.defineProperty(window, 'hasarbotuCaseFolders', { value: { open }, configurable: true })
    try {
      setup()
      await select()
      await userEvent.click(screen.getByRole('button', { name: 'Klasörü Aç' }))
      expect(open).toHaveBeenCalledExactlyOnceWith(first.caseId)
      await userEvent.click(screen.getByRole('tab', { name: 'Dosyalar' }))
      await userEvent.click(screen.getByRole('button', { name: /34 TEST 02/ }))
      await userEvent.click(screen.getByRole('button', { name: 'Klasörü Aç' }))
      expect(open).toHaveBeenLastCalledWith(second.caseId)
    } finally { Reflect.deleteProperty(window, 'hasarbotuCaseFolders') }
  })
  it('uses bounded server search covering open and closed cases, then writes only the selected case', async () => {
    const api = setup()
    expect(screen.getByRole('button', { name: 'Ara' })).toBeDisabled()
    await select()
    expect(api.cases.listCasePage).toHaveBeenCalledWith({ search: '34 TEST', page: 1, pageSize: 10 })
    await userEvent.type(screen.getByRole('textbox', { name: 'Hızlı not' }), 'Yeni hızlı not')
    await userEvent.click(screen.getByRole('button', { name: 'Notu kaydet' }))
    await screen.findByText('Not dosyaya kaydedildi.')
    expect(api.operations.createNote).toHaveBeenCalledWith(first.caseId, { noteType: 'internal', subject: null, body: 'Yeni hızlı not' }, expect.any(String))
    await userEvent.click(screen.getByRole('tab', { name: 'Geçmiş notlar' }))
    await screen.findByText('Yeni hızlı not')
    await userEvent.type(screen.getByRole('textbox', { name: 'Notlarda ara' }), 'görüşüldü')
    expect(screen.getByText(note.body)).toBeInTheDocument()
    expect(screen.queryByText('Yeni hızlı not')).not.toBeInTheDocument()
  })
  it('preserves a draft across tabs and keeps separate drafts for different cases', async () => {
    setup()
    await select()
    await userEvent.type(screen.getByRole('textbox', { name: 'Hızlı not' }), 'İlk taslak')
    await userEvent.click(screen.getByRole('tab', { name: 'Süreçler' }))
    await screen.findByText(new RegExp(first.stage), { selector: 'dd' })
    expect(screen.getByText('Atanmamış')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Hızlı not' }))
    expect(screen.getByRole('textbox', { name: 'Hızlı not' })).toHaveValue('İlk taslak')
    await userEvent.click(screen.getByRole('tab', { name: 'Dosyalar' }))
    await userEvent.click(screen.getByRole('button', { name: /34 TEST 02/ }))
    expect(screen.getByRole('textbox', { name: 'Hızlı not' })).toHaveValue('')
    await userEvent.click(screen.getByRole('tab', { name: 'Dosyalar' }))
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
    await userEvent.click(screen.getByRole('tab', { name: 'Geçmiş notlar' }))
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
    await userEvent.click(screen.getByRole('tab', { name: 'Geçmiş notlar' }))
    await screen.findByText(note.body)
  })
  it('refreshes process tracking on focus after the panel was hidden during an outage', async () => {
    setup()
    await select()
    vi.mocked(loadTracking).mockRejectedValueOnce(new Error('offline'))
    await userEvent.click(screen.getByRole('tab', { name: 'Süreçler' }))
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
    render(<AssistantAppearanceProvider><DesktopAssistantPanel /></AssistantAppearanceProvider>)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Giriş yap' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Çıkış' })).not.toBeInTheDocument()
    expect(screen.queryByText('Görünümümü özelleştir')).not.toBeInTheDocument()
  })
})
