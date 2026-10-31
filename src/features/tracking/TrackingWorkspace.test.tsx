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
function pendingDocument(id: string,overrides: Partial<TrackingSnapshot['documents'][number]> = {}): TrackingSnapshot['documents'][number] {
  return { id,caseId: 'case',plate: '34 TEST 123',officeNumber: '1',fileName: `${id}.pdf`,relativePath: `case/${id}.pdf`,status: 'pending',documentType: null,observedAt: new Date().toISOString(),canReview: true,...overrides }
}
describe('tracking screens',() => {
  it('approves every authorized pending document beyond the visible batch, preserving types and edited notes',async () => {
    const data = structuredClone(base)
    data.documents = [...Array.from({ length: 201 },(_,index) => pendingDocument(`doc-${index}`,{ documentType: index === 200 ? 'odometer_photo' : null })),pendingDocument('foreign',{ canReview: false }),pendingDocument('approved',{ status: 'approved' }),pendingDocument('rejected',{ status: 'rejected' })]
    const fetch = vi.spyOn(globalThis,'fetch').mockImplementation(async (url,options) => {
      if (options?.method !== 'POST') return Response.json(data)
      const id = String(url).split('/').at(-2)
      data.documents = data.documents.filter((item) => item.id !== id)
      return new Response(null,{ status: 204 })
    })
    render(<MemoryRouter><TrackingWorkspace /></MemoryRouter>)
    const bulk = await screen.findByRole('button',{ name: 'Hepsini uygun işaretle (201)' })
    expect(screen.queryByText('doc-200.pdf',{ selector: 'strong' })).not.toBeInTheDocument()
    expect(fetch.mock.calls.every(([,options]) => options?.method !== 'POST')).toBe(true)
    const firstRow = within(screen.getByText('doc-0.pdf',{ selector: 'strong' }).closest('article')!)
    await userEvent.click(firstRow.getByRole('button',{ name: 'Türü düzelt / not ekle' }))
    await userEvent.selectOptions(firstRow.getByLabelText('Evrak türü'),'victim_traffic_policy')
    fireEvent.change(firstRow.getByLabelText('Kontrol notu'),{ target: { value: 'Poliçe kontrol edildi' } })
    bulk.focus()
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByText('201 evrak uygun işaretlendi.')).toHaveAttribute('role','status')
    await waitFor(() => expect(screen.queryByRole('button',{ name: /Hepsini uygun/ })).not.toBeInTheDocument())
    const posts = fetch.mock.calls.filter(([,options]) => options?.method === 'POST')
    expect(posts).toHaveLength(201)
    expect(new Set(posts.map(([url]) => String(url))).size).toBe(201)
    expect(JSON.parse(String(posts[0]![1]?.body))).toEqual({ status: 'approved',documentType: 'victim_traffic_policy',note: 'Poliçe kontrol edildi' })
    expect(JSON.parse(String(posts[1]![1]?.body))).toEqual({ status: 'approved',documentType: 'other_document',note: '' })
    expect(JSON.parse(String(posts[200]![1]?.body))).toEqual({ status: 'approved',documentType: 'odometer_photo',note: '' })
    expect(data.documents.map((item) => item.id)).toEqual(['foreign','approved','rejected'])
    expect(fetch.mock.calls.filter(([,options]) => options?.method !== 'POST')).toHaveLength(2)
  })
  it('stops on a failed review, refreshes partial results and retries only the remaining pending documents',async () => {
    const data = structuredClone(base)
    data.documents = ['first','second','third'].map((id) => pendingDocument(id))
    let fail = true
    const fetch = vi.spyOn(globalThis,'fetch').mockImplementation(async (url,options) => {
      if (options?.method !== 'POST') return Response.json(data)
      const id = String(url).split('/').at(-2)
      if (id === 'second' && fail) {
        fail = false
        return Response.json({ error: { message: 'Evrak değişti veya zaten kontrol edildi.' } },{ status: 409 })
      }
      data.documents = data.documents.filter((item) => item.id !== id)
      return new Response(null,{ status: 204 })
    })
    render(<MemoryRouter><TrackingWorkspace /></MemoryRouter>)
    await userEvent.click(await screen.findByRole('button',{ name: 'Hepsini uygun işaretle (3)' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Toplu işlem durdu. 1/3 evrak uygun işaretlendi. Evrak değişti veya zaten kontrol edildi.')
    const retry = await screen.findByRole('button',{ name: 'Hepsini uygun işaretle (2)' })
    await waitFor(() => expect(retry).toBeEnabled())
    expect(fetch.mock.calls.filter(([,options]) => options?.method === 'POST').map(([url]) => String(url).split('/').at(-2))).toEqual(['first','second'])
    expect(screen.queryByText('first.pdf',{ selector: 'strong' })).not.toBeInTheDocument()
    await userEvent.click(retry)
    expect(await screen.findByText('2 evrak uygun işaretlendi.')).toBeInTheDocument()
    expect(fetch.mock.calls.filter(([,options]) => options?.method === 'POST').map(([url]) => String(url).split('/').at(-2))).toEqual(['first','second','second','third'])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('restores the same review draft when a refreshed list moves a document outside the visible batch',async () => {
    const data = structuredClone(base)
    const retained = pendingDocument('retained')
    data.documents = [retained,...Array.from({ length: 99 },(_,index) => pendingDocument(`other-${index}`))]
    const fetch = install(data)
    render(<MemoryRouter><TrackingWorkspace /></MemoryRouter>)
    const row = within((await screen.findByText('retained.pdf',{ selector: 'strong' })).closest('article')!)
    await userEvent.click(row.getByRole('button',{ name: 'Türü düzelt / not ekle' }))
    await userEvent.selectOptions(row.getByLabelText('Evrak türü'),'odometer_photo')
    fireEvent.change(row.getByLabelText('Kontrol notu'),{ target: { value: 'Korunan taslak' } })
    data.documents = [pendingDocument('arriving'),...data.documents.slice(1),retained]
    fireEvent(window,new Event('tracking-received'))
    await waitFor(() => expect(screen.queryByText('retained.pdf',{ selector: 'strong' })).not.toBeInTheDocument())
    await userEvent.click(screen.getByRole('button',{ name: 'Daha fazla evrak göster (1 kalan)' }))
    const restored = within(screen.getByText('retained.pdf',{ selector: 'strong' }).closest('article')!)
    await userEvent.click(restored.getByRole('button',{ name: 'Türü düzelt / not ekle' }))
    expect(restored.getByLabelText('Evrak türü')).toHaveValue('odometer_photo')
    expect(restored.getByLabelText('Kontrol notu')).toHaveValue('Korunan taslak')
    await userEvent.click(restored.getByRole('button',{ name: 'Kontrol ettim, uygun' }))
    await waitFor(() => expect(fetch.mock.calls.some(([url,options]) => String(url).endsWith('/retained/review') && JSON.parse(String(options?.body)).documentType === 'odometer_photo' && JSON.parse(String(options?.body)).note === 'Korunan taslak')).toBe(true))
  })
  it('serializes bulk reviews, blocks duplicate clicks and leaves newly arriving documents pending',async () => {
    const data = structuredClone(base)
    data.documents = ['first','second'].map((id) => pendingDocument(id))
    let finishFirst!: () => void
    const firstRequest = new Promise<void>((resolve) => { finishFirst = resolve })
    const fetch = vi.spyOn(globalThis,'fetch').mockImplementation(async (url,options) => {
      if (options?.method !== 'POST') return Response.json(data)
      const id = String(url).split('/').at(-2)
      if (id === 'first') await firstRequest
      data.documents = data.documents.filter((item) => item.id !== id)
      return new Response(null,{ status: 204 })
    })
    render(<MemoryRouter><TrackingWorkspace /></MemoryRouter>)
    const bulk = await screen.findByRole('button',{ name: 'Hepsini uygun işaretle (2)' })
    const firstRow = within(screen.getByText('first.pdf',{ selector: 'strong' }).closest('article')!)
    await userEvent.click(firstRow.getByRole('button',{ name: 'Türü düzelt / not ekle' }))
    fireEvent.click(bulk);fireEvent.click(bulk)
    expect(await screen.findByText('Evraklar uygun işaretleniyor… (0/2)')).toBeInTheDocument()
    expect(bulk).toBeDisabled()
    expect(firstRow.getByRole('button',{ name: 'Kontrol ettim, uygun' })).toBeDisabled()
    expect(firstRow.getByLabelText('Evrak türü')).toBeDisabled()
    expect(firstRow.getByLabelText('Kontrol notu')).toBeDisabled()
    expect(fetch.mock.calls.filter(([,options]) => options?.method === 'POST')).toHaveLength(1)
    data.documents.push(pendingDocument('arriving'))
    fireEvent(window,new Event('tracking-received'))
    expect(fetch.mock.calls.filter(([,options]) => options?.method !== 'POST')).toHaveLength(1)
    finishFirst()
    await screen.findByText('2 evrak uygun işaretlendi.')
    await screen.findByRole('button',{ name: 'Hepsini uygun işaretle (1)' })
    expect(fetch.mock.calls.filter(([,options]) => options?.method === 'POST')).toHaveLength(2)
    expect(data.documents.map((item) => item.id)).toEqual(['arriving'])
  })
  it('hides bulk approval when no pending documents can be reviewed',async () => {
    const data = structuredClone(base)
    data.documents = [pendingDocument('foreign',{ canReview: false }),pendingDocument('finished',{ status: 'approved',canReview: false })]
    install(data)
    render(<MemoryRouter><TrackingWorkspace /></MemoryRouter>)
    await screen.findByText('foreign.pdf',{ selector: 'strong' })
    expect(screen.queryByRole('button',{ name: /Hepsini uygun/ })).not.toBeInTheDocument()
  })
  it('reports a refresh failure separately after reviews have been saved',async () => {
    const data = structuredClone(base)
    data.documents = [pendingDocument('first')]
    let saved = false
    vi.spyOn(globalThis,'fetch').mockImplementation(async (_url,options) => {
      if (options?.method === 'POST') { saved = true;return new Response(null,{ status: 204 }) }
      if (saved) throw new Error('Bağlantı kesildi')
      return Response.json(data)
    })
    render(<MemoryRouter><TrackingWorkspace /></MemoryRouter>)
    await userEvent.click(await screen.findByRole('button',{ name: 'Hepsini uygun işaretle (1)' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Liste yenilenemedi: Bağlantı kesildi')
    expect(screen.getByText('1 evrak uygun işaretlendi.')).toBeInTheDocument()
  })
  it('refreshes the open case status when a new mailbox notification arrives',async () => {
    const data = structuredClone(base)
    data.tramer = [{ id: 'job',caseId: 'case',plate: '34 TEST 123',officeNumber: '1',assignedUserId: 'operator',assignedName: 'Tramer çalışanı',applicationNumber: '000310',status: 'result_pending',resultText: null,version: 2,canEdit: true }]
    install(data)
    render(<MemoryRouter><TrackingWorkspace caseId="case" /></MemoryRouter>)
    await screen.findByText('Sonuç bekleniyor',{ selector: '.tracking-status' })
    data.tramer[0] = { ...data.tramer[0]!,status: 'completed',resultText: 'Sonuç: Tamamlandı',version: 3 }
    fireEvent(window,new Event('tracking-received'))
    expect(await screen.findByText('Tamamlandı',{ selector: '.tracking-status' })).toBeInTheDocument()
    expect(screen.getByText('Sonuç: Tamamlandı')).toBeInTheDocument()
  })
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
    await screen.findByText('Giriş bekleniyor',{ selector: '.tracking-status' })
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
