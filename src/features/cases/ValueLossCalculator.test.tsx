import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SessionContext, type SessionContextValue } from '../../app/sessionContext'
import type { ValueLossCalculatorPort } from '../../data/valueLossCalculatorPort'
import type { CaseRecord } from '../../types/case'
import { ValueLossCalculator } from './ValueLossCalculator'

const session = { user: { id: 'user-1', organizationId: 'org-1', roles: ['expert'] }, reportUnauthorized: vi.fn() } as unknown as SessionContextValue
const result = { amountMinor: 5_500_000, ruleVersion: 'calculator-reference/2026-07-01/1.1.0', calculationMethod: 'real_market_analysis' as const, issues: [] }
function sourceCase(fields: Record<string, string> = {}): CaseRecord {
  return { caseId: 'case-1', type: 'Trafik', lossDate: '2026-10-01', estimatedDamage: 100_000, eksist: { vehicleFields: { Marka: 'Toyota', 'Araç Tipi': 'Corolla Sedan', 'Model Yılı': '2024', 'Araç Tarife Grubu': 'OTOMOBİL', Kilometre: '50.000', 'Önceki Hasar Sayısı': '0', ...fields } } } as unknown as CaseRecord
}
const item = sourceCase()
function fixture(): ValueLossCalculatorPort {
  return { load: vi.fn().mockResolvedValue(null), catalog: vi.fn().mockResolvedValue({ vehicleGroupCode: 'A', ruleIdentity: result.ruleVersion, parts: [{ stableRuleId: 'part-1', label: 'SOL ÇAMURLUK', supportedOperations: ['replacement', 'repair', 'paint'], coefficients: { replacement: '1', repair: { light: '0.5', medium: '1', heavy: '1.5' }, paint: { full: '1', local: '0.5' } } }] }), calculate: vi.fn().mockResolvedValue(result) }
}
function view(port: ValueLossCalculatorPort, current = item, user = session) { return <SessionContext.Provider value={user}><ValueLossCalculator item={current} source="api" port={port} /></SessionContext.Provider> }
async function addPart() {
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Hasarlı parça' })).toBeEnabled())
  await userEvent.click(screen.getByRole('combobox', { name: 'Hasarlı parça' }))
  await userEvent.click(screen.getByRole('option', { name: 'SOL ÇAMURLUK' }))
  await userEvent.click(screen.getByRole('button', { name: 'Ekle' }))
}
async function fill() {
  fireEvent.change(screen.getByLabelText('Rayiç bedeli (TL)'), { target: { value: '1.000.000' } })
  await addPart()
  await userEvent.selectOptions(screen.getByLabelText('SOL ÇAMURLUK önceki durumu'), 'none')
}
const calculate = () => userEvent.click(screen.getByRole('button', { name: 'Hesapla' }))

describe('automatic value loss calculator', () => {
  it('calculates using imported vehicle, usage, damage amount and history count', async () => {
    const port = fixture()
    render(view(port)); await fill(); await calculate(); await screen.findByText(/55\.000,00/)
    expect(port.calculate).toHaveBeenCalledWith('case-1', expect.objectContaining({ vehicleIdentity: { manufacturer: 'Toyota', model: 'Corolla Sedan' }, bodyType: 'sedan', modelYear: 2024, usageValue: 50000, damageAmountMinor: 10_000_000, previousDamageCount: 0, partSelections: [expect.objectContaining({ stableRuleId: 'part-1', quantity: 1, material: 'unspecified', priorPartState: 'none' })] }))
  })
  it('removes identity, position, quantity, material and coefficient controls', async () => {
    render(view(fixture())); await addPart()
    for (const label of ['Marka', 'Model', 'Kasa / araç yapısı', 'SOL ÇAMURLUK konumu', 'SOL ÇAMURLUK adedi', 'SOL ÇAMURLUK malzemesi', 'SOL ÇAMURLUK parça niteliği']) expect(screen.queryByLabelText(label, { exact: true })).not.toBeInTheDocument()
    expect(screen.queryByText('Aynı parçaya farklı konum ekle')).not.toBeInTheDocument()
    expect(screen.queryByText('Kaynakla doğrulanmış referans katsayıları')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Dosyadan alınan araç bilgileri')).toHaveTextContent('Toyota · Corolla Sedan · Sedan')
  })
  it('blocks an unknown part history without treating it as undamaged', async () => {
    const port = fixture()
    render(view(port)); await addPart(); await calculate()
    expect(screen.getByLabelText('SOL ÇAMURLUK önceki durumu')).toHaveValue('unknown')
    expect(screen.getByRole('alert')).toHaveTextContent('Önceki parça hasarı bilinmiyor')
    expect(port.calculate).not.toHaveBeenCalled()
  })
  it('does not default a missing previous damage count to zero', async () => {
    const port = fixture()
    render(view(port, sourceCase({ 'Önceki Hasar Sayısı': '' }))); await fill(); await calculate()
    expect(screen.getByRole('alert')).toHaveTextContent('Önceki hasar sayısı bilinmiyor')
    expect(port.calculate).not.toHaveBeenCalled()
  })
  it.each(['repair_paint', 'replacement_paint'] as const)('keeps %s on one physical row', async operation => {
    const port = fixture()
    render(view(port)); await fill(); await userEvent.selectOptions(screen.getByLabelText('SOL ÇAMURLUK işlemi'), operation)
    await userEvent.selectOptions(screen.getByLabelText('SOL ÇAMURLUK boya türü'), 'local')
    if (operation === 'repair_paint') await userEvent.click(screen.getByLabelText('Parça bedeli bilinmiyor'))
    await calculate(); await screen.findByText(/55\.000,00/)
    expect(screen.getAllByText('SOL ÇAMURLUK', { selector: 'strong' })).toHaveLength(1)
    expect(port.calculate).toHaveBeenCalledWith('case-1', expect.objectContaining({ partSelections: [expect.objectContaining({ operation, paintMode: 'local' })] }))
  })
  it('requires actual repair inputs and permits the documented unknown price path', async () => {
    const port = fixture()
    render(view(port)); await fill(); await userEvent.selectOptions(screen.getByLabelText('SOL ÇAMURLUK işlemi'), 'repair'); await calculate()
    expect(screen.getByRole('alert')).toHaveTextContent('yeni parça bedelini')
    expect(port.calculate).not.toHaveBeenCalled()
    await userEvent.click(screen.getByLabelText('Parça bedeli bilinmiyor')); await calculate(); await screen.findByText(/55\.000,00/)
  })
  it('does not infer steel for paintless repair from an unverified name', async () => {
    const port = fixture()
    render(view(port)); await fill(); await userEvent.selectOptions(screen.getByLabelText('SOL ÇAMURLUK işlemi'), 'paintless_repair'); await calculate()
    expect(screen.getByRole('alert')).toHaveTextContent('referans katsayısı bulunamadı')
    expect(port.calculate).not.toHaveBeenCalled()
  })
  it('rejects duplicate physical parts', async () => {
    render(view(fixture())); await fill(); await addPart()
    expect(screen.getByRole('alert')).toHaveTextContent('zaten eklendi')
  })
  it('invalidates a result and ignores a response for obsolete inputs', async () => {
    const port = fixture()
    render(view(port)); await fill(); await calculate(); await screen.findByText(/55\.000,00/)
    fireEvent.change(screen.getByLabelText('Rayiç bedeli (TL)'), { target: { value: '1.100.000' } })
    expect(screen.queryByText(/55\.000,00/)).not.toBeInTheDocument()
    let resolve!: (value: typeof result) => void
    vi.mocked(port.calculate).mockImplementationOnce(() => new Promise(done => { resolve = done })); await calculate()
    fireEvent.change(screen.getByLabelText('Rayiç bedeli (TL)'), { target: { value: '1.200.000' } })
    await act(async () => resolve(result)); expect(screen.queryByText(/55\.000,00/)).not.toBeInTheDocument()
  })
  it('retains inputs and result across navigation and isolates another case', async () => {
    const port = fixture(), mounted = render(view(port))
    await fill(); await calculate(); await screen.findByText(/55\.000,00/); mounted.unmount()
    const reopened = render(view(port))
    expect(screen.getByLabelText('Rayiç bedeli (TL)')).toHaveValue('1.000.000'); expect(screen.getByText(/55\.000,00/)).toBeInTheDocument()
    reopened.rerender(view(port, { ...item, caseId: 'case-2' })); expect(screen.queryByText(/55\.000,00/)).not.toBeInTheDocument()
  })
  it.each([2, undefined])('migrates draft format %s without trusting a default undamaged state', async formatVersion => {
    const port = fixture(), mounted = render(view(port))
    await fill(); await calculate(); await screen.findByText(/55\.000,00/); mounted.unmount()
    const key = 'hasarbotu-value-loss-calculator-v1:org-1:user-1:case-1', stored = JSON.parse(sessionStorage.getItem(key)!)
    sessionStorage.setItem(key, JSON.stringify({ ...stored, verificationVersion: 2, draft: { ...stored.draft, formatVersion } }))
    render(view(port))
    expect(screen.getByLabelText('Rayiç bedeli (TL)')).toHaveValue('1.000.000'); expect(screen.getByLabelText('SOL ÇAMURLUK önceki durumu')).toHaveValue('unknown')
    expect(screen.queryByText(/55\.000,00/)).not.toBeInTheDocument()
  })
  it('updates automatic source fields while retaining the entered market value', async () => {
    const port = fixture(), mounted = render(view(port))
    await fill(); await calculate(); await screen.findByText(/55\.000,00/)
    mounted.rerender(view(port, sourceCase({ 'Model Yılı': '2023' })))
    expect(screen.getByLabelText('Model yılı')).toHaveValue('2023'); expect(screen.getByLabelText('Rayiç bedeli (TL)')).toHaveValue('1.000.000')
    expect(screen.queryByText(/55\.000,00/)).not.toBeInTheDocument()
  })
  it('shows a server issue without fabricating an amount', async () => {
    const port = fixture()
    vi.mocked(port.calculate).mockResolvedValue({ ...result, amountMinor: null, issues: [{ field: 'parts', message: 'Kontrol gerekli' }] })
    render(view(port)); await fill(); await calculate()
    expect(await screen.findByRole('alert')).toHaveTextContent('Kontrol gerekli'); expect(screen.queryByText(/55\.000,00/)).not.toBeInTheDocument()
  })
})
