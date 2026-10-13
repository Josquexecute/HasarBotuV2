import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { trackingRequest } from '../tracking/trackingApi'
import { TrackingInbox } from './TrackingInbox'

vi.mock('../tracking/trackingApi', () => ({ trackingRequest: vi.fn() }))
const request = vi.mocked(trackingRequest)
const item = { id: 'notice', caseId: 'case', plate: '34 TEST 123', officeNumber: '2026/1', title: 'Rapor eklendi', kind: 'document', readAt: null, presentedAt: null, createdAt: '2026-10-13T00:10:00Z' }
const inbox = { notifications: [item], total: 1, unread: 1, page: 1 }
function Destination() { const location = useLocation(); return <p>Dosya {location.search}</p> }
function renderInbox() {
  return render(<MemoryRouter initialEntries={['/bildirimler']}><Routes><Route path="/bildirimler" element={<TrackingInbox />} /><Route path="/dosyalar/:caseId" element={<Destination />} /></Routes></MemoryRouter>)
}
beforeEach(() => { request.mockReset() })

describe('notification card actions', () => {
  it('marks a notification read once before opening the actual document tab', async () => {
    let complete: () => void = () => undefined
    const pending = new Promise<void>(resolve => { complete = resolve })
    request.mockImplementation(async path => path.endsWith('/read') ? pending : inbox)
    renderInbox()
    const card = await screen.findByRole('button', { name: '34 TEST 123 dosyasına git' })
    fireEvent.click(card); fireEvent.click(card)
    expect(request.mock.calls.filter(([path]) => path.endsWith('/read'))).toHaveLength(1)
    expect(screen.queryByText('Dosya ?tab=documents')).not.toBeInTheDocument()
    complete()
    expect(await screen.findByText('Dosya ?tab=documents')).toBeInTheDocument()
  })
  it('keeps the user in the inbox when marking read fails, then retries', async () => {
    request.mockImplementation(async path => { if (path.endsWith('/read')) throw new Error('Kaydetme başarısız'); return inbox })
    renderInbox()
    await userEvent.click(await screen.findByRole('button', { name: '34 TEST 123 dosyasına git' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Kaydetme başarısız')
    expect(screen.queryByText('Dosya ?tab=documents')).not.toBeInTheDocument()
    request.mockResolvedValue(inbox)
    await userEvent.click(screen.getByRole('button', { name: 'Tekrar dene' }))
    expect(await screen.findByText('Rapor eklendi')).toBeInTheDocument()
  })
  it('does not get stuck loading when the selected segment is clicked again', async () => {
    request.mockResolvedValue(inbox)
    renderInbox()
    await screen.findByText('Rapor eklendi')
    await userEvent.click(screen.getByRole('button', { name: /Okunmamış/ }))
    await waitFor(() => expect(screen.getByText('Rapor eklendi')).toBeInTheDocument())
    expect(screen.queryByText('Bildirimler yükleniyor…')).not.toBeInTheDocument()
  })
})
