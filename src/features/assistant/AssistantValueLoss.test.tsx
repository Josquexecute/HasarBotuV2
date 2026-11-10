import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AssistantValueLoss } from './AssistantValueLoss'
import { VALUE_LOSS_SAVED_STORAGE_KEY, notifyValueLossSaved } from '../../app/valueLossSaved'
import type { ValueLossCalculatorPort } from '../../data/valueLossCalculatorPort'

const record = { input: {}, result: { amountMinor: 5_500_000 }, savedAt: '2026-11-10T12:00:00Z' }
const port = () => ({ load: vi.fn(), loadCalculation: vi.fn().mockResolvedValue(record), catalog: vi.fn(), calculate: vi.fn() }) as unknown as ValueLossCalculatorPort

describe('Touch saved case estimate', () => {
  it('loads the saved case amount and refreshes after a matching calculation or cross-window event', async () => {
    const api = port()
    render(<AssistantValueLoss caseId="one" port={api} />)
    await screen.findByText(/55\.000,00/)
    act(() => notifyValueLossSaved('other'))
    expect(api.loadCalculation).toHaveBeenCalledTimes(1)
    vi.mocked(api.loadCalculation!).mockResolvedValue({ ...record, result: { amountMinor: 0 } } as never)
    act(() => notifyValueLossSaved('one'))
    await screen.findByText(/^₺0,00$|^0,00\s*₺$/)
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: VALUE_LOSS_SAVED_STORAGE_KEY, newValue: JSON.stringify({ caseId: 'one' }) })))
    await waitFor(() => expect(api.loadCalculation).toHaveBeenCalledTimes(3))
  })
  it('does not display an old amount after a refresh failure', async () => {
    const api = port()
    render(<AssistantValueLoss caseId="one" port={api} />)
    await screen.findByText(/55\.000,00/)
    vi.mocked(api.loadCalculation!).mockRejectedValue(new Error('offline'))
    act(() => window.dispatchEvent(new Event('focus')))
    await screen.findByText('Tutar alınamadı')
    expect(screen.queryByText(/55\.000,00/)).not.toBeInTheDocument()
  })
})
