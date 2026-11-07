import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Profiler } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { CaseFaultResponse } from '@hasarbotu/contracts'
import { CaseFaultModule } from './CaseFaultModule'
import { CaseFaultClientError, type CaseFaultPort } from '../../data/caseFaultPort'
import { publishCaseFaultChange } from '../../data/caseFaultEvents'

const initial: CaseFaultResponse = { caseId: 'case-a', caseType: 'traffic', insuredPercent: null, version: 0, updatedAt: null, permissions: { canEdit: true } }
function fixture(value: Partial<CaseFaultResponse> = {}) {
  let record = { ...initial, ...value }
  const port: CaseFaultPort = {
    read: vi.fn(async () => record),
    save: vi.fn(async (_id, input) => {
      if (input.expectedVersion !== record.version) throw new CaseFaultClientError(409)
      record = { ...record, insuredPercent: input.insuredPercent, version: record.version + 1 }
      return record
    }),
  }
  return { port, update: (next: Partial<CaseFaultResponse>) => { record = { ...record, ...next } } }
}

describe('shared main/Touch fault editor', () => {
  it('does not commit renders for unrelated invalidations or unchanged focus reads', async () => {
    const { port } = fixture()
    const committed = vi.fn()
    render(<Profiler id="fault" onRender={committed}><CaseFaultModule caseId="case-a" port={port} /></Profiler>)
    await screen.findByRole('combobox', { name: 'Sigortalı kusur oranı' })
    const before = committed.mock.calls.length
    await act(async () => {
      publishCaseFaultChange('anonymous', 'another-case')
      fireEvent.focus(window)
    })
    expect(port.read).toHaveBeenCalledTimes(2)
    expect(committed).toHaveBeenCalledTimes(before)
  })
  it.each(['traffic', 'casco'] as const)('uses the correct left/right labels and six choices for %s', async caseType => {
    const { port } = fixture({ caseType })
    render(<CaseFaultModule caseId="case-a" port={port} />)
    const left = await screen.findByRole('combobox', { name: caseType === 'traffic' ? 'Sigortalı kusur oranı' : 'Kaskolu Sigortalı kusur oranı' })
    const right = screen.getByRole('combobox', { name: caseType === 'traffic' ? 'Mağdur kusur oranı' : 'Karşı Taraf kusur oranı' })
    expect(within(left).getAllByRole('option').map(node => node.textContent)).toEqual(['Belirlenmemiş', '%0', '%25', '%50', '%75', '%100'])
    expect(screen.queryByRole('spinbutton')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    for (const value of ['0', '25', '50', '75', '100']) {
      await userEvent.selectOptions(left, value)
      expect(right).toHaveValue(String(100 - Number(value)))
      await userEvent.selectOptions(right, value)
      expect(left).toHaveValue(String(100 - Number(value)))
    }
    await userEvent.selectOptions(right, '')
    expect(left).toHaveValue('')
    expect(port.save).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Kusuru kaydet' }))
    expect(port.save).toHaveBeenCalledWith('case-a', { insuredPercent: null, expectedVersion: 0 }, expect.any(AbortSignal))
  })
  it('shows potential recourse only for positive casco counterparty fault', async () => {
    const { port } = fixture({ caseType: 'casco', insuredPercent: 25 })
    render(<CaseFaultModule caseId="case-a" port={port} />)
    expect(await screen.findByRole('note')).toHaveTextContent('Potansiyel Rücu: %75Kesinleşmiş rücu değildir.')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Kaskolu Sigortalı kusur oranı' }), '100')
    expect(screen.queryByRole('note')).toBeNull()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Kaskolu Sigortalı kusur oranı' }), '')
    expect(screen.queryByRole('note')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Vazgeç' }))
    expect(screen.getByRole('note')).toHaveTextContent('%75')
  })
  it('persists edits, synchronizes another mounted view and restores after remount', async () => {
    const { port } = fixture()
    const view = render(<><div data-testid="main"><CaseFaultModule caseId="case-a" port={port} /></div><div data-testid="touch"><CaseFaultModule caseId="case-a" port={port} /></div></>)
    const main = within(screen.getByTestId('main')), touch = within(screen.getByTestId('touch'))
    await userEvent.selectOptions(await main.findByRole('combobox', { name: 'Sigortalı kusur oranı' }), '25')
    await userEvent.click(main.getByRole('button', { name: 'Kusuru kaydet' }))
    await waitFor(() => expect(touch.getByRole('combobox', { name: 'Sigortalı kusur oranı' })).toHaveValue('25'))
    expect(main.getByRole('combobox', { name: 'Mağdur kusur oranı' })).toHaveValue('75')
    expect(port.read).toHaveBeenCalledTimes(3)
    view.unmount()
    render(<CaseFaultModule caseId="case-a" port={port} />)
    expect(await screen.findByRole('combobox', { name: 'Sigortalı kusur oranı' })).toHaveValue('25')
  })
  it('preserves a draft on external update and blocks overwriting it', async () => {
    const api = fixture()
    render(<CaseFaultModule caseId="case-a" port={api.port} />)
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Sigortalı kusur oranı' }), '25')
    api.update({ insuredPercent: 75, version: 1 })
    act(() => publishCaseFaultChange('anonymous', 'case-a'))
    await screen.findByText(/Başka pencerede güncellendi/)
    expect(screen.getByRole('combobox', { name: 'Sigortalı kusur oranı' })).toHaveValue('25')
    expect(screen.getByRole('button', { name: 'Kusuru kaydet' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Kusur bilgisini yenile' }))
    expect(screen.getByRole('combobox', { name: 'Sigortalı kusur oranı' })).toHaveValue('75')
    expect(api.port.save).not.toHaveBeenCalled()
  })
  it('keeps a failed/conflicting save visible and refreshes explicitly', async () => {
    const api = fixture()
    vi.mocked(api.port.save).mockRejectedValue(new CaseFaultClientError(409))
    render(<CaseFaultModule caseId="case-a" port={api.port} />)
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Sigortalı kusur oranı' }), '25')
    await userEvent.click(screen.getByRole('button', { name: 'Kusuru kaydet' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Dosya veya kusur bilgisi değişti')
    expect(screen.getByRole('combobox', { name: 'Sigortalı kusur oranı' })).toHaveValue('25')
    expect(screen.queryByText('Kusur bilgisi kaydedildi.')).toBeNull()
  })
  it('ignores unrelated accounts/cases and cancels subscriptions and requests on unmount', async () => {
    const api = fixture()
    const view = render(<CaseFaultModule caseId="case-a" port={api.port} />)
    await screen.findByRole('combobox', { name: 'Sigortalı kusur oranı' })
    act(() => { publishCaseFaultChange('other-user', 'case-a'); publishCaseFaultChange('anonymous', 'case-b') })
    expect(api.port.read).toHaveBeenCalledTimes(1)
    fireEvent.focus(window)
    await waitFor(() => expect(api.port.read).toHaveBeenCalledTimes(2))
    const signal = vi.mocked(api.port.read).mock.calls.at(-1)![1]!
    view.unmount()
    expect(signal.aborted).toBe(true)
    act(() => { publishCaseFaultChange('anonymous', 'case-a'); fireEvent.focus(window) })
    expect(api.port.read).toHaveBeenCalledTimes(2)
  })
  it('never shows a previous case response after navigation', async () => {
    let resolveFirst!: (value: CaseFaultResponse) => void
    const api = fixture({ caseId: 'case-b', caseType: 'casco', insuredPercent: 100 })
    vi.mocked(api.port.read).mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve }))
    const view = render(<CaseFaultModule caseId="case-a" port={api.port} />)
    view.rerender(<CaseFaultModule caseId="case-b" port={api.port} />)
    expect(await screen.findByRole('combobox', { name: 'Kaskolu Sigortalı kusur oranı' })).toHaveValue('100')
    await act(async () => resolveFirst(initial))
    expect(screen.queryByRole('combobox', { name: 'Sigortalı kusur oranı' })).toBeNull()
  })
  it.each([{ permissions: { canEdit: false } }, { caseType: null }] as Partial<CaseFaultResponse>[])('renders unavailable editing honestly (%j)', async record => {
    const { port } = fixture(record)
    render(<CaseFaultModule caseId="case-a" port={port} />)
    await waitFor(() => expect(screen.queryByText('Kusur bilgisi yükleniyor…')).toBeNull())
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Kusuru kaydet' })).toBeNull()
  })
})
