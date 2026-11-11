import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FolderRecovery } from './FolderRecovery'

const id = '019fe084-1ec1-7797-835a-777eb0cc59c2'
const check = { id, requestedAt: '2026-11-11T10:00:00.000Z', completedAt: null, repaired: null, remaining: null }
const row = { caseId: id, plate: '72 ACJ 327', officeNumber: '2026/863', relativePath: '2026 OFİS/Kasım 2026/72ACJ327', status: 'needs_check' }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('operator folder recovery', () => {
  it('finds the archived record and waits for a completed worker scan before reporting the result', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ items: [row], latestCheck: null }))
      .mockResolvedValueOnce(response(check, 202))
      .mockResolvedValueOnce(response({ items: [row], latestCheck: check }))
      .mockResolvedValueOnce(response({ items: [{ ...row, status: 'verified' }], latestCheck: { ...check, completedAt: '2026-11-11T10:00:30.000Z', repaired: 1, remaining: 0 } }))
    vi.stubGlobal('fetch', fetcher)
    render(<FolderRecovery />)
    fireEvent.change(screen.getByLabelText('Plaka'), { target: { value: '72ACJ327' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Bul' })) })
    expect(screen.getByText('2026/863')).toBeInTheDocument()
    expect(screen.getByText('Kontrol gerekiyor')).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Kontrol et ve düzelt' })) })
    expect(screen.getByRole('status')).toHaveTextContent('kontrol ediliyor')
    expect(screen.queryByText(/Kontrol tamamlandı/)).not.toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(screen.getByRole('status')).toHaveTextContent('1 düzeltme yapıldı')
    expect(screen.getByText('Bağlantı doğrulanmış')).toBeInTheDocument()
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ method: 'POST', credentials: 'include', body: '{}' })
  })
  it('keeps unresolved matches visible without claiming a repair succeeded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(check, 202)).mockResolvedValueOnce(response({ items: [row], latestCheck: { ...check, completedAt: '2026-11-11T10:00:30.000Z', repaired: 0, remaining: 1 } })))
    render(<FolderRecovery />)
    fireEvent.change(screen.getByLabelText('Plaka'), { target: { value: '72ACJ327' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Kontrol et ve düzelt' })) })
    expect(screen.getByRole('status')).toHaveTextContent('0 düzeltme yapıldı')
    expect(screen.getByText('Kontrol gerekiyor')).toBeInTheDocument()
  })
  it('shows authorization failure and cancels an in-progress check when leaving the page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ error: { message: 'Erişim yetkiniz yok.' } }, 403)))
    const view = render(<FolderRecovery />)
    fireEvent.change(screen.getByLabelText('Plaka'), { target: { value: '72ACJ327' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Bul' })) })
    expect(screen.getByRole('alert')).toHaveTextContent('Erişim yetkiniz yok.')
    let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_url, init) => { signal = init.signal; return new Promise(() => {}) }))
    fireEvent.click(screen.getByRole('button', { name: 'Kontrol et ve düzelt' }))
    view.unmount()
    expect(signal?.aborted).toBe(true)
  })
})
