import { afterEach,describe,expect,it,vi } from 'vitest'
import { cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react'
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
    await screen.findByText('Kontrolümü bekleyen evraklar (201)',{ selector: 'summary' })
    expect(screen.getAllByText(/^evrak-\d+\.pdf$/,{ selector: 'strong' })).toHaveLength(100)
    expect(screen.queryByText('evrak-100.pdf',{ selector: 'strong' })).not.toBeInTheDocument()
    expect(screen.queryByText('Bildirim 100',{ selector: 'strong' })).not.toBeInTheDocument()
    // Scope label queries to one row instead of scanning every control in the large document list.
    const firstRow = within(screen.getByText('evrak-0.pdf',{ selector: 'strong' }).closest('article')!)
    await userEvent.click(firstRow.getByRole('button',{ name: 'Türü düzelt / not ekle' }))
    const draft = () => within(screen.getByText('evrak-0.pdf',{ selector: 'strong' }).closest('article')!).getByLabelText('Kontrol notu')
    // This test checks batching and draft retention, rather than rerendering hundreds of rows per keystroke.
    fireEvent.change(draft(),{ target: { value: 'İnceleme taslağı' } })
    await userEvent.click(screen.getByText('Daha fazla evrak göster (101 kalan)',{ selector: 'button' }))
    expect(screen.getAllByText(/^evrak-\d+\.pdf$/,{ selector: 'strong' })).toHaveLength(200)
    expect(screen.getByText('evrak-100.pdf',{ selector: 'strong' })).toBeInTheDocument()
    expect(draft()).toHaveValue('İnceleme taslağı')
    await userEvent.click(screen.getByText('Daha fazla evrak göster (1 kalan)',{ selector: 'button' }))
    expect(screen.getAllByText(/^evrak-\d+\.pdf$/,{ selector: 'strong' })).toHaveLength(201)
    expect(screen.getByText('evrak-200.pdf',{ selector: 'strong' })).toBeInTheDocument()
    expect(draft()).toHaveValue('İnceleme taslağı')
    expect(screen.queryByText(/Daha fazla evrak/,{ selector: 'button' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByText('Daha fazla bildirim göster (1 kalan)',{ selector: 'button' }))
    expect(screen.getByText('Bildirim 100',{ selector: 'strong' })).toBeInTheDocument()
    expect(screen.getAllByText(/^Bildirim \d+$/,{ selector: 'strong' })).toHaveLength(101)
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
    expect(await screen.findByRole('button',{ name: 'Kontrol ettim, uygun' })).toBeEnabled()
    expect(fetch.mock.calls.every(([,options]) => options?.method !== 'POST')).toBe(true)
    await userEvent.click(screen.getByRole('button',{ name: 'Türü düzelt / not ekle' }))
    await userEvent.selectOptions(screen.getByLabelText('Evrak türü'),'victim_traffic_policy')
    await userEvent.click(screen.getByRole('button',{ name: 'Kontrol ettim, uygun' }))
    await waitFor(() => expect(fetch.mock.calls.some(([url,options]) => String(url).endsWith('/documents/doc/review') && JSON.parse(String(options?.body)).status === 'approved')).toBe(true))
  })
  it('uses an inferred photo category without requiring a type selection',async () => {
    const data = structuredClone(base)
    data.documents = [{ id: 'photo',caseId: 'case',plate: '34 TEST 123',officeNumber: '1',fileName: 'KM.jpg',relativePath: 'case/KM.jpg',status: 'pending',documentType: 'odometer_photo',observedAt: new Date().toISOString(),canReview: true }]
    const fetch = install(data)
    render(<MemoryRouter><TrackingWorkspace caseId="case" view="documents" /></MemoryRouter>)
    expect(await screen.findByText('KM fotoğrafı')).toBeInTheDocument()
    expect(screen.queryByLabelText('Evrak türü')).not.toBeInTheDocument()
    expect(screen.queryByText('Tramer işlemleri')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button',{ name: 'Kontrol ettim, uygun' }))
    await waitFor(() => expect(fetch.mock.calls.some(([url,options]) => String(url).endsWith('/documents/photo/review') && JSON.parse(String(options?.body)).documentType === 'odometer_photo')).toBe(true))
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
    await screen.findByText('Evrak eklendi: rapor.pdf')
    expect(screen.getByText('34 TEST 123')).toBeInTheDocument()
    expect(screen.getByRole('link',{ name: 'Dosyayı aç' })).toHaveAttribute('href','/dosyalar/case')
    await userEvent.click(screen.getByRole('button',{ name: 'Uyarıyı kapat' }))
    await waitFor(() => expect(screen.queryByLabelText('Yeni bildirim')).not.toBeInTheDocument())
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/notifications/dismiss'))).toBe(true)
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/notice/read'))).toBe(false)
  })
})
