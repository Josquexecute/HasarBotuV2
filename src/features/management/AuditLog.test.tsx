import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuditEvent } from '@hasarbotu/contracts'
import { SessionContext, type SessionContextValue } from '../../app/sessionContext'
import { DATA_SOURCE_STORAGE_KEY } from '../../data/ports'
import { AuditLog } from './AuditLog'
import { MemoryRouter } from 'react-router'
import { ManagementPage } from './ManagementPage'

const actorId = '11111111-1111-4111-8111-111111111111'
vi.mock('../../data/useUsers', () => ({ useUsers: () => ({ items: [{ id: actorId, displayName: 'Test Yönetici' }] }) }))

afterEach(() => vi.restoreAllMocks())

function auditPage(page = 1, totalPages = 1, overrides: Partial<AuditEvent> = {}) {
  return {
    items: [{
      id: `22222222-2222-4222-8222-${String(page).padStart(12, '0')}`,
      organizationId: '33333333-3333-4333-8333-333333333333', actorUserId: actorId,
      action: 'case.updated', targetLabel: `Test dosyası ${page}`, entityType: 'case', entityId: 'case-test', requestId: null,
      occurredAt: '2026-10-20T09:15:00.000Z', details: { version: page }, ...overrides,
    }],
    pageInfo: { page, pageSize: 50, totalItems: totalPages * 50, totalPages },
  }
}

function renderLog() {
  const session: SessionContextValue = { mode: 'api', status: 'authenticated', user: { id: actorId, organizationId: 'test-org', displayName: 'Test Yönetici', email: 'test@example.test', roles: ['admin'] }, notice: null, login: vi.fn(), logout: vi.fn(), reportUnauthorized: vi.fn() }
  return render(<MemoryRouter><SessionContext.Provider value={session}><AuditLog /></SessionContext.Provider></MemoryRouter>)
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('AuditLog', () => {
  it('renders validated events with actor names, system fallback, Turkey time and details', async () => {
    const first = auditPage()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ ...first, items: [
      ...first.items,
      { ...first.items[0], id: '44444444-4444-4444-8444-444444444444', actorUserId: null, action: 'system.event', entityType: null, entityId: null, targetLabel: null },
      { ...first.items[0], id: '55555555-5555-4555-8555-555555555555', actorUserId: '66666666-6666-4666-8666-666666666666', action: 'unknown.actor' },
    ] }))
    renderLog()
    const row = (await screen.findByRole('button', { name: 'Dosya bilgileri güncellendi ayrıntıları' })).closest('tr')!
    expect(within(row).getByText('Test Yönetici')).toBeInTheDocument()
    expect(within(row).getByText(/12:15:00/)).toHaveAttribute('dateTime', '2026-10-20T09:15:00.000Z')
    await userEvent.click(within(row).getByRole('button'))
    await userEvent.click(screen.getByRole('button', { name: 'Ham teknik kayıt' }))
    expect(screen.getByText(/"version": 1/)).toBeVisible()
    expect(screen.getByText('Sistem')).toBeInTheDocument()
    expect(screen.getByText('Genel işlem')).toBeInTheDocument()
    expect(screen.getByText('Eski / bilinmeyen kullanıcı')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Önceki' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Sonraki' })).toBeDisabled()
  })

  it('paginates, encodes all filters, converts inclusive Turkey dates and resets to page one', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const params = new URL(String(input), 'https://office.example.test').searchParams
      return json(auditPage(Number(params.get('page')), 2))
    })
    const user = userEvent.setup()
    renderLog()
    await screen.findByText('Test dosyası 1')
    await user.click(screen.getByRole('button', { name: 'Sonraki' }))
    await screen.findByText('Test dosyası 2')
    expect(screen.getByRole('button', { name: 'Sonraki' })).toBeDisabled()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Kullanıcı' }), actorId)
    await user.click(screen.getByText('Teknik filtre'))
    await user.type(screen.getByRole('textbox', { name: 'İşlem kodu' }), '  case.updated  ')
    fireEvent.change(screen.getByLabelText('Başlangıç'), { target: { value: '2026-10-19' } })
    fireEvent.change(screen.getByLabelText('Bitiş'), { target: { value: '2026-10-20' } })
    await user.click(screen.getByRole('button', { name: 'Filtrele' }))
    await screen.findByText('Test dosyası 1')
    const params = new URL(String(fetchSpy.mock.lastCall![0]), 'https://office.example.test').searchParams
    expect(Object.fromEntries(params)).toEqual({
      page: '1', pageSize: '50', presentation: 'readable', actorUserId: actorId, action: 'case.updated',
      occurredFrom: '2026-10-18T21:00:00.000Z', occurredTo: '2026-10-20T20:59:59.999Z',
    })
    await user.click(screen.getByRole('button', { name: 'Sonraki' }))
    await screen.findByText('Test dosyası 2')
    expect(String(fetchSpy.mock.lastCall![0])).toContain('actorUserId=')
    await user.click(screen.getByRole('button', { name: 'Önceki' }))
    await screen.findByText('Test dosyası 1')
    expect(screen.getByRole('button', { name: 'Önceki' })).toBeDisabled()
  })

  it.each([
    { status: 401, message: 'Oturum sona erdi.' },
    { status: 403, message: 'İşlem kayıtları yalnız yöneticilere açıktır.' },
    { status: 503, message: 'İşlem servisi geçici olarak kullanılamıyor.' },
  ])('surfaces HTTP $status and recovers through explicit refresh', async ({ status, message }) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ error: { message } }, status)).mockResolvedValueOnce(json(auditPage()))
    renderLog()
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Yenile' }))
    await screen.findByText('Test dosyası 1')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy.mock.calls[0]![1]).toEqual(expect.objectContaining({ credentials: 'include', signal: expect.any(AbortSignal) }))
  })

  it('surfaces network failures and rejects malformed records instead of displaying them', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Bağlantı kesildi')).mockResolvedValueOnce(json({ ...auditPage(), items: [{ ...auditPage().items[0], occurredAt: 'invalid' }] }))
    renderLog()
    expect(await screen.findByRole('alert')).toHaveTextContent('Bağlantı kesildi')
    await userEvent.click(screen.getByRole('button', { name: 'Yenile' }))
    await waitFor(() => expect(screen.getByRole('alert')).not.toHaveTextContent('Bağlantı kesildi'))
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows an empty result without enabling pagination', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ items: [], pageInfo: { page: 1, pageSize: 50, totalItems: 0, totalPages: 0 } }))
    renderLog()
    expect(await screen.findByText('Kayıt bulunamadı.')).toBeInTheDocument()
    expect(screen.getByText('0 kayıt · Sayfa 1 / 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sonraki' })).toBeDisabled()
  })

  it('aborts the previous filter request and ignores late responses after refresh', async () => {
    let resolveFirst!: (response: Response) => void
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => new Promise<Response>(resolve => { resolveFirst = resolve })).mockResolvedValueOnce(json(auditPage(2)))
    renderLog()
    expect(screen.getByRole('status')).toHaveTextContent('Kayıtlar yükleniyor')
    const signal = fetchSpy.mock.calls[0]![1]!.signal!
    await userEvent.click(screen.getByRole('button', { name: 'Yenile' }))
    await screen.findByText('Test dosyası 2')
    expect(signal.aborted).toBe(true)
    await act(async () => { resolveFirst(json(auditPage(1))) })
    expect(screen.getByText('Test dosyası 2')).toBeInTheDocument()
    expect(screen.queryByText('Test dosyası 1')).not.toBeInTheDocument()
  })

  it('expands grouped originals, displays recorded changes, and toggles grouping without a request', async () => {
    const first = auditPage(1, 1, { action: 'access.viewed', details: { route: '/api/v1/cases/:caseId', method: 'GET', statusCode: 200 } })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ ...first, items: [first.items[0], { ...first.items[0], id: '44444444-4444-4444-8444-444444444444', occurredAt: '2026-10-20T09:15:30.000Z' }] }))
    renderLog()
    expect(await screen.findByText('2 kayıt')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Test dosyası 1' })).toHaveAttribute('href', '/dosyalar/case-test')
    await userEvent.click(screen.getByRole('button', { name: 'Dosya görüntülendi ayrıntıları' }))
    expect(screen.getAllByText('İşlem ayrıntıları')).toHaveLength(2)
    await userEvent.click(screen.getByRole('checkbox', { name: 'Tekrarlanan görüntülemeleri gruplandır' }))
    expect(screen.getAllByRole('button', { name: 'Dosya görüntülendi ayrıntıları' })).toHaveLength(2)
    expect(fetchSpy).toHaveBeenCalledOnce()
  })

  it('shows recorded old and new values and sends Turkish search, outcome, category and sort to the server', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json(auditPage(1, 1, { details: { before: { caseType: 'traffic' }, after: { caseType: 'casco' }, password: 'Synthetic-private-fixture' } })))
    renderLog()
    await userEvent.click(await screen.findByRole('button', { name: 'Dosya bilgileri güncellendi ayrıntıları' }))
    expect(screen.getByText('Trafik')).toBeInTheDocument()
    expect(screen.getByText('Kasko')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Ham teknik kayıt' }))
    expect(screen.queryByText(/Synthetic-private-fixture/)).not.toBeInTheDocument()
    await userEvent.type(screen.getByRole('textbox', { name: 'Kayıtlarda ara' }), 'Dosya bilgileri')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sonuç' }), 'success')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'İşlem grubu' }), 'cases')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sıralama' }), 'asc')
    await userEvent.click(screen.getByRole('button', { name: 'Filtrele' }))
    await screen.findByText('Test dosyası 1')
    const params = new URL(String(fetchSpy.mock.lastCall![0]), 'https://office.example.test').searchParams
    expect(params.get('search')).toBe('Dosya bilgileri')
    expect(params.get('result')).toBe('success')
    expect(params.get('category')).toBe('cases')
    expect(params.get('sort')).toBe('asc')
  })

  it.each(['expert', 'case_manager', 'secretary', 'accounting', 'read_only'] as const)('does not mount audit or fetch records for %s even on the audit deep link', (role) => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    window.history.replaceState({}, '', '/yonetim?bolum=kayitlar')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const session: SessionContextValue = {
      mode: 'api', status: 'authenticated', notice: null,
      user: { id: 'test-user', organizationId: 'test-org', displayName: 'Test', email: 'test@example.test', roles: [role] },
      login: vi.fn(), logout: vi.fn(), reportUnauthorized: vi.fn(),
    }
    render(<SessionContext.Provider value={session}><ManagementPage /></SessionContext.Provider>)
    expect(screen.getByRole('alert')).toHaveTextContent('yalnızca yöneticilere')
    expect(screen.queryByRole('region', { name: 'İşlem kayıtları' })).not.toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
