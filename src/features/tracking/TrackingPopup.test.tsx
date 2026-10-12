import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TrackingPopup } from './TrackingPopup'
import { trackingRequest } from './trackingApi'

vi.mock('./trackingApi',() => ({ trackingRequest: vi.fn() }))
const notice = { id: 'notice',caseId: 'case',plate: '34 TEST 01',title: 'Yeni evrak' }
afterEach(() => { vi.resetAllMocks() })
describe('owned notification popup',() => {
  it('dismisses the backlog in one request while retaining future polling',async () => {
    vi.mocked(trackingRequest).mockResolvedValueOnce({ notifications: Array.from({ length: 20 },(_,i) => ({ ...notice,id: String(i) })) })
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce({ notifications: [] })
      .mockResolvedValueOnce({ notifications: [{ ...notice,id: 'future' }] })
    render(<MemoryRouter><TrackingPopup /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button',{ name: 'Uyarıyı kapat' }))
    await waitFor(() => expect(screen.queryByRole('button',{ name: 'Uyarıyı kapat' })).not.toBeInTheDocument())
    expect(trackingRequest).toHaveBeenNthCalledWith(2,'tracking/notifications/dismiss',{})
    act(() => { window.dispatchEvent(new Event('tracking-updated')) })
    await waitFor(() => expect(trackingRequest).toHaveBeenCalledTimes(3))
    act(() => { window.dispatchEvent(new Event('tracking-updated')) })
    expect(await screen.findByRole('button',{ name: 'Uyarıyı kapat' })).toBeInTheDocument()
  })
  it('does not restore a stale poll result after dismissal',async () => {
    let finish!: (value: unknown) => void
    vi.mocked(trackingRequest).mockResolvedValueOnce({ notifications: [notice] })
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
      .mockResolvedValueOnce(undefined)
    render(<MemoryRouter><TrackingPopup /></MemoryRouter>)
    await screen.findByRole('button',{ name: 'Uyarıyı kapat' })
    act(() => { window.dispatchEvent(new Event('tracking-updated')) })
    fireEvent.click(screen.getByRole('button',{ name: 'Uyarıyı kapat' }))
    await waitFor(() => expect(screen.queryByRole('button')).not.toBeInTheDocument())
    await act(async () => { finish({ notifications: [notice] }) })
    expect(screen.queryByText('34 TEST 01: Yeni evrak')).not.toBeInTheDocument()
  })
})
