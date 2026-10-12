import { afterEach,describe,expect,it,vi } from 'vitest'
import { cleanup,render,screen,waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import type { TrackingSnapshot } from '@hasarbotu/contracts'
import { TrackingWorkspace } from './TrackingWorkspace'
import { TrackingPopup } from './TrackingPopup'

const base: TrackingSnapshot = { tramer: [],documents: [],notifications: [],mailConnections: [],reviews: [],users: [],history: [],services: [],canManage: false,googleEnabled: false,automaticSbmEnabled: false }
afterEach(() => { cleanup();vi.restoreAllMocks() })
function install(data: TrackingSnapshot) {
  return vi.spyOn(globalThis,'fetch').mockImplementation(async (_url,options) => options?.method === 'POST' ? new Response(null,{ status: 204 }) : Response.json(data))
}
describe('tracking screens',() => {
  it('loads large lists in batches without losing an existing review draft',async () => {
    const data = structuredClone(base)
    const time = new Date().toISOString()
    data.documents = Array.from({ length: 201 },(_,index) => ({ id: `doc-${index}`,caseId: 'case',plate: '34 TEST 123',officeNumber: '1',fileName: `evrak-${index}.pdf`,relativePath: `case/evrak-${index}.pdf`,status: 'pending',documentType: null,observedAt: time,canReview: true }))
    data.notifications = Array.from({ length: 101 },(_,index) => ({ id: `notice-${index}`,caseId: 'case',plate: '34 TEST 123',officeNumber: '1',title: `Bildirim ${index}`,kind: 'document',createdAt: time,readAt: null,presentedAt: null }))
    const fetch = install(data)
    render(<MemoryRouter><TrackingWorkspace /></MemoryRouter>)
    await screen.findByText('Kontrolümü bekleyen evraklar (201)')
    expect(screen.queryByText('evrak-100.pdf')).not.toBeInTheDocument()
    expect(screen.queryByText('Bildirim 100')).not.toBeInTheDocument()
    const draft = screen.getAllByLabelText('Kontrol notu')[0]!
    await userEvent.type(draft,'İnceleme taslağı')
    await userEvent.click(screen.getByRole('button',{ name: 'Daha fazla evrak göster (101 kalan)' }))
    expect(screen.getByText('evrak-100.pdf')).toBeInTheDocument()
    expect(draft).toHaveValue('İnceleme taslağı')
    await userEvent.click(screen.getByRole('button',{ name: 'Daha fazla evrak göster (1 kalan)' }))
    expect(screen.getByText('evrak-200.pdf')).toBeInTheDocument()
    expect(screen.queryByRole('button',{ name: /Daha fazla evrak/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button',{ name: 'Daha fazla bildirim göster (1 kalan)' }))
    expect(screen.getByText('Bildirim 100')).toBeInTheDocument()
    expect(fetch.mock.calls.every(([,options]) => options?.method !== 'POST')).toBe(true)
  })

  it('keeps the application alive when the popup response is malformed',async () => {
    vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({}))
    render(<MemoryRouter><TrackingPopup /></MemoryRouter>)
    expect(await screen.findByText('Yeni bildirimler alınamıyor.')).toBeInTheDocument()
  })
  it('submits a long number as exact text, then renders the server result',async () => {
    const data = structuredClone(base)
    data.tramer = [{ id: 'job',caseId: 'case',plate: '34 TEST 123',officeNumber: '1',assignedUserId: 'operator',assignedName: 'Tramer çalışanı',applicationNumber: null,status: 'entry_pending',resultText: null,version: 1,canEdit: true }]
    const fetch = install(data)
    render(<MemoryRouter><TrackingWorkspace caseId="case" /></MemoryRouter>)
    const field = await screen.findByLabelText('SBM başvuru numarası')
    await userEvent.type(field,'00012345678901234567890')
    await userEvent.click(screen.getByRole('button',{ name: 'Numarayı kaydet' }))
    await waitFor(() => expect(fetch.mock.calls.some(([url,options]) => String(url).endsWith('/tramer') && options?.body === JSON.stringify({ action: 'number',applicationNumber: '00012345678901234567890',expectedVersion: 1 }))).toBe(true))
    expect(screen.getByRole('link',{ name: '34 TEST 123 · 1' })).toHaveAttribute('href','/dosyalar/case')
  })
  it('requires explicit document approval and never sends approval on loading',async () => {
    const data = structuredClone(base)
    data.documents = [{ id: 'doc',caseId: 'case',plate: '34 TEST 123',officeNumber: '1',fileName: 'poliçe.pdf',relativePath: 'case/poliçe.pdf',status: 'pending',documentType: null,observedAt: new Date().toISOString(),canReview: true }]
    const fetch = install(data)
    render(<MemoryRouter><TrackingWorkspace caseId="case" /></MemoryRouter>)
    expect(await screen.findByRole('button',{ name: 'Kontrol ettim, uygun' })).toBeDisabled()
    expect(fetch.mock.calls.every(([,options]) => options?.method !== 'POST')).toBe(true)
    await userEvent.selectOptions(screen.getByLabelText('Evrak türü'),'victim_traffic_policy')
    await userEvent.click(screen.getByRole('button',{ name: 'Kontrol ettim, uygun' }))
    await waitFor(() => expect(fetch.mock.calls.some(([url,options]) => String(url).endsWith('/documents/doc/review') && JSON.parse(String(options?.body)).status === 'approved')).toBe(true))
  })
  it('hides mutation controls for users without permission',async () => {
    const data = structuredClone(base)
    data.tramer = [{ id: 'job',caseId: 'case',plate: '34 TEST 123',officeNumber: '1',assignedUserId: 'operator',assignedName: 'Diğer çalışan',applicationNumber: null,status: 'entry_pending',resultText: null,version: 1,canEdit: false }]
    install(data)
    render(<MemoryRouter><TrackingWorkspace caseId="case" /></MemoryRouter>)
    await screen.findByText('Giriş bekleniyor')
    expect(screen.queryByRole('button',{ name: 'Numarayı kaydet' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button',{ name: 'Tramer sorumlusunu ata' })).not.toBeInTheDocument()
  })
  it('shows persistent popup and dismisses it without marking the notification read',async () => {
    const fetch = vi.spyOn(globalThis,'fetch').mockImplementation(async (_url,options) => options?.method === 'POST' ? new Response(null,{ status: 204 }) : Response.json({ notifications: [{ id: 'notice',caseId: 'case',plate: '34 TEST 123',title: 'Evrak eklendi: rapor.pdf' }] }))
    render(<MemoryRouter><TrackingPopup /></MemoryRouter>)
    await screen.findByText('34 TEST 123: Evrak eklendi: rapor.pdf')
    expect(screen.getByRole('link',{ name: 'Dosyayı aç' })).toHaveAttribute('href','/dosyalar/case')
    await userEvent.click(screen.getByRole('button',{ name: 'Uyarıyı kapat' }))
    await waitFor(() => expect(screen.queryByLabelText('Yeni bildirim')).not.toBeInTheDocument())
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/notifications/dismiss'))).toBe(true)
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/notice/read'))).toBe(false)
  })
})
