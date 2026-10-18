import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SessionContext, type SessionContextValue } from '../../app/sessionContext'
import type { ValueLossCalculatorPort } from '../../data/valueLossCalculatorPort'
import type { CaseRecord } from '../../types/case'
import { ValueLossCalculator } from './ValueLossCalculator'

const item = { caseId: 'case-1', type: 'Trafik', lossDate: '2026-10-01', estimatedDamage: 100_000 } as CaseRecord
const session = { user: { id: 'user-1', organizationId: 'org-1', roles: ['expert'] }, reportUnauthorized: vi.fn() } as unknown as SessionContextValue
const result = { amountMinor: 5_500_000, ruleVersion: 'real-market-analysis/2026-07-01/1.0.0', calculationMethod: 'real_market_analysis' as const, issues: [] }
function fixture(): ValueLossCalculatorPort {
  return { load: vi.fn().mockResolvedValue(null), catalog: vi.fn().mockResolvedValue({ vehicleGroupCode: 'A', ruleIdentity: result.ruleVersion, parts: [{ stableRuleId: 'part-1', label: 'SOL ÇAMURLUK', supportedOperations: ['replacement','repair','paint'], coefficients: {} }] }), calculate: vi.fn().mockResolvedValue(result) }
}
function view(port: ValueLossCalculatorPort, current = item, user = session) { return <SessionContext.Provider value={user}><ValueLossCalculator item={current} source="api" port={port} /></SessionContext.Provider> }
async function fill() {
  fireEvent.change(screen.getByLabelText('Model yılı'), { target: { value: '2024' } })
  fireEvent.change(screen.getByLabelText('Kilometre'), { target: { value: '50000' } })
  fireEvent.change(screen.getByLabelText('Rayiç bedeli (TL)'), { target: { value: '1.000.000' } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Ekle' })).toBeEnabled())
  fireEvent.change(screen.getByLabelText('Hasarlı parça'), { target: { value: 'SOL ÇAMURLUK' } })
  fireEvent.click(screen.getByRole('button', { name: 'Ekle' }))
}

describe('simple value loss calculator', () => {
  it('shows one calculation action and returns an amount without evidence, draft, approval or report steps', async () => {
    const port = fixture()
    render(view(port)); await fill()
    for (const text of ['Kanıtlar','Onaya Gönder','İnsan Onayı Ver','Sürüm Geçmişi','Nihai Rapor','Önizleme Oluştur']) expect(screen.queryByText(text)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Hesapla' }))
    expect(await screen.findByText(/55\.000,00/)).toBeInTheDocument()
    expect(port.calculate).toHaveBeenCalledWith('case-1', expect.objectContaining({ marketValueMinor: 100_000_000, damageAmountMinor: 10_000_000, parts: [expect.objectContaining({ stableRuleId: 'part-1', operation: 'replacement' })] }))
  })
  it('invalidates an old result immediately and ignores a response if its inputs changed during the request', async () => {
    const port = fixture()
    render(view(port)); await fill()
    await userEvent.click(screen.getByRole('button', { name: 'Hesapla' })); await screen.findByText(/55\.000,00/)
    fireEvent.change(screen.getByLabelText('Kilometre'), { target: { value: '60000' } })
    expect(screen.queryByText(/55\.000,00/)).not.toBeInTheDocument()
    let resolve!: (value: typeof result) => void
    vi.mocked(port.calculate).mockImplementationOnce(() => new Promise(done => { resolve = done }))
    await userEvent.click(screen.getByRole('button', { name: 'Hesapla' }))
    fireEvent.change(screen.getByLabelText('Kilometre'), { target: { value: '70000' } })
    await act(async () => resolve(result))
    expect(screen.queryByText(/55\.000,00/)).not.toBeInTheDocument()
  })
  it('remembers inputs and amount across navigation and keeps another case or user isolated', async () => {
    const port = fixture()
    const current = render(view(port)); await fill()
    await userEvent.click(screen.getByRole('button', { name: 'Hesapla' })); await screen.findByText(/55\.000,00/)
    current.unmount()
    const reopened = render(view(port))
    expect(screen.getByLabelText('Kilometre')).toHaveValue('50000')
    expect(screen.getByText(/55\.000,00/)).toBeInTheDocument()
    reopened.rerender(view(port, { ...item, caseId: 'case-2' }))
    expect(screen.getByLabelText('Kilometre')).toHaveValue('')
    expect(screen.queryByText(/55\.000,00/)).not.toBeInTheDocument()
    reopened.rerender(view(port, item, { ...session, user: { ...session.user!, id: 'user-2' } }))
    expect(screen.getByLabelText('Kilometre')).toHaveValue('')
  })
  it('reveals repair prices only when required and rejects incomplete repair inputs', async () => {
    const port = fixture()
    render(view(port)); await fill()
    expect(screen.queryByLabelText('SOL ÇAMURLUK yeni parça bedeli')).not.toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('SOL ÇAMURLUK işlemi'), 'repair')
    await userEvent.click(screen.getByRole('button', { name: 'Hesapla' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('yeni parça bedelini')
    expect(port.calculate).not.toHaveBeenCalled()
    await userEvent.click(screen.getByLabelText('Parça bedeli bilinmiyor'))
    await userEvent.click(screen.getByRole('button', { name: 'Hesapla' }))
    expect(await screen.findByText(/55\.000,00/)).toBeInTheDocument()
    expect(port.calculate).toHaveBeenCalledWith(item.caseId, expect.objectContaining({ parts: [expect.objectContaining({ operation: 'repair', partPriceAvailability: 'unavailable', newPartPriceMinor: null })] }))
  })
  it('does not invent a number when the server blocks a calculation and keeps the entered values', async () => {
    const port = fixture()
    vi.mocked(port.calculate).mockResolvedValue({ ...result, amountMinor: null, issues: [{ field: 'vehicleCondition', message: 'Ağır hasarlı araç için hesaplanamaz.' }] })
    render(view(port)); await fill()
    await userEvent.click(screen.getByRole('button', { name: 'Hesapla' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Ağır hasarlı')
    expect(screen.queryByText(/55\.000,00/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Rayiç bedeli (TL)')).toHaveValue('1.000.000')
  })
  it('clears incompatible parts and switches mileage to working hours for group D', async () => {
    const port = fixture()
    render(view(port)); await fill()
    await userEvent.selectOptions(screen.getByLabelText('Araç türü'), 'İŞ MAKİNESİ')
    expect(screen.queryByText('SOL ÇAMURLUK', { selector: 'strong' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Çalışma saati')).toHaveValue('')
    await waitFor(() => expect(port.catalog).toHaveBeenLastCalledWith('case-1','D'))
  })
})
