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
  it('adds a newly received Tramer result to an already open inbox',async () => {
    request.mockResolvedValueOnce({ notifications: [],total: 0,unread: 0,page: 1 })
      .mockResolvedValue({ ...inbox,notifications: [{ ...item,kind: 'tramer',title: 'Tramer sonuçlandı — 000310' }] })
    renderInbox()
    await screen.findByText('Hepsi güncel')
    fireEvent(window,new Event('tracking-received'))
    expect(await screen.findByText('Tramer sonuçlandı — 000310')).toBeInTheDocument()
    expect(screen.queryByText('Hepsi güncel')).not.toBeInTheDocument()
  })
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
  it('marks every page once, waits for the server, refreshes the badge and returns to page one', async () => {
    let complete: () => void = () => undefined
    let unread = 120
    const pending = new Promise<void>(resolve => { complete = () => { unread = 0;resolve() } })
    request.mockImplementation(async path => path.endsWith('/read-all') ? pending : { notifications: unread ? [item] : [], total: unread, unread, page: path.includes('page=2') ? 2 : 1 })
    const updated = vi.fn()
    window.addEventListener('tracking-updated',updated)
    try {
      renderInbox()
      await userEvent.click(await screen.findByRole('button', { name: 'Sonraki' }))
      await screen.findByText('120 bildirim · 2 / 3')
      const button = screen.getByRole('button', { name: 'Tümünü okundu işaretle' })
      fireEvent.click(button);fireEvent.click(button)
      expect(request.mock.calls.filter(([path]) => path.endsWith('/read-all'))).toEqual([['tracking/notifications/read-all',{}]])
      expect(screen.getByRole('button', { name: 'Kaydediliyor…' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Tümü' })).toBeDisabled()
      expect(screen.getByText('Rapor eklendi')).toBeInTheDocument()
      expect(updated).not.toHaveBeenCalled()
      complete()
      expect(await screen.findByText('Hepsi güncel')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Tümünü okundu işaretle' })).toBeDisabled()
      expect(request.mock.calls.at(-1)?.[0]).toBe('tracking/notifications/inbox?page=1&read=unread')
      expect(updated).toHaveBeenCalledTimes(1)
    } finally { window.removeEventListener('tracking-updated',updated) }
  })
  it('marks the whole inbox even from the read filter and preserves that filter', async () => {
    let unread = 1
    request.mockImplementation(async path => {
      if (path.endsWith('/read-all')) { unread = 0;return undefined }
      return { ...inbox, notifications: [{ ...item,readAt: '2026-10-13T01:00:00Z' }],unread }
    })
    renderInbox()
    await userEvent.click(await screen.findByRole('button', { name: 'Okunmuş' }))
    await screen.findByText('Rapor eklendi')
    await userEvent.click(screen.getByRole('button', { name: 'Tümünü okundu işaretle' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tümünü okundu işaretle' })).toBeDisabled())
    expect(request.mock.calls.at(-1)?.[0]).toBe('tracking/notifications/inbox?page=1&read=read')
    expect(screen.getByRole('button', { name: 'Okunmuş' })).toHaveAttribute('aria-pressed','true')
  })
  it('keeps unread state on failure and permits a retry after refreshing', async () => {
    let fail = true
    request.mockImplementation(async path => {
      if (path.endsWith('/read-all')) { if (fail) throw new Error('Toplu kaydetme başarısız');return undefined }
      return inbox
    })
    renderInbox()
    await userEvent.click(await screen.findByRole('button', { name: 'Tümünü okundu işaretle' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Toplu kaydetme başarısız')
    expect(screen.getByRole('button', { name: /Okunmamış/ })).toHaveTextContent('1')
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Tekrar dene' }))
    await screen.findByText('Rapor eklendi')
    await userEvent.click(screen.getByRole('button', { name: 'Tümünü okundu işaretle' }))
    await waitFor(() => expect(request.mock.calls.filter(([path]) => path.endsWith('/read-all'))).toHaveLength(2))
    await screen.findByText('Rapor eklendi')
    // A new arrival returned by the refresh remains unread and actionable.
    expect(screen.getByRole('button', { name: /Okunmamış/ })).toHaveTextContent('1')
    expect(screen.getByRole('button', { name: 'Tümünü okundu işaretle' })).toBeEnabled()
  })
  it('disables the bulk action while loading and when there are no unread notifications', async () => {
    request.mockResolvedValue({ notifications: [],total: 0,unread: 0,page: 1 })
    renderInbox()
    expect(screen.getByRole('button', { name: 'Tümünü okundu işaretle' })).toBeDisabled()
    await screen.findByText('Hepsi güncel')
    expect(screen.getByRole('button', { name: 'Tümünü okundu işaretle' })).toBeDisabled()
    expect(request.mock.calls.some(([path]) => path.endsWith('/read-all'))).toBe(false)
  })
})
