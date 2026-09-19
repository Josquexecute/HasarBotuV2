import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { parseEksist } from '@hasarbotu/domain'
import type { CaseReferenceDataPort } from '../../data/ports'
import { CaseCommandError } from '../../data/commandPort'
import type { EksistPort, QuickCreation } from '../../data/eksistPort'
import type { WorkspaceCommandPort, WorkspaceProvisioningRecord } from '../../data/workspacePort'
import { CaseCreateModal } from './CaseCreateModal'
import { mockCases } from '../../mocks/cases'

const refs: CaseReferenceDataPort = { getCaseReferences: async () => ({ users: [{ id: 'user', displayName: 'User' }], experts: [], insurers: [], services: [] }) }
const plan = { id: 'plan', caseId: 'case', status: 'queued', relativePath: '2026/Eylül 2026/34TR2491', requiredSubdirectories: [], storageRootKey: 'main', lastErrorCode: null, canApprove: false, canRetry: false, approvedAt: null, readyAt: null, createdAt: '', updatedAt: '' } satisfies WorkspaceProvisioningRecord
const result: QuickCreation = { case: { ...mockCases[0]!, caseId: 'case', officeNumber: '2026/1', plate: '34 TR 2491' }, provisioning: plan, duplicate: false }
function setup(create = vi.fn().mockResolvedValue(result), readPlan = vi.fn().mockResolvedValue(plan)) {
  const port: EksistPort = { create, readSource: vi.fn(async input => {
    const text = input.kind === 'text' ? input.text : 'Talep İşlem Ref No: 123\nÜrün: Trafik\nPlaka: 034 - TR2491'
    return { id: 'source', extraction: parseEksist(text), text, method: input.kind === 'text' ? 'clipboard' : 'ocr' }
  }) }
  const workspace: WorkspaceCommandPort = { listActiveRoots: async () => [{ rootKey: 'main', label: 'Çalışma' }], readPlan, readCurrentPlan: vi.fn(), createPlan: vi.fn(), approvePlan: vi.fn() }
  const close = vi.fn()
  render(<MemoryRouter initialEntries={['/yeni']}><Routes>
    <Route path="/yeni" element={<CaseCreateModal currentUser={{ id: 'user', organizationId: 'org', displayName: 'User', email: 'user@example.test', roles: ['admin'] }} onClose={close} onUnauthorized={vi.fn()} referencePort={refs} eksistPort={port} workspacePort={workspace} />} />
    <Route path="/dosyalar" element={<p>DOSYA LİSTESİ</p>} /><Route path="/dosyalar/:id" element={<p>DOSYA DETAYI</p>} />
  </Routes></MemoryRouter>)
  return { port, create, readPlan, close }
}
async function fill() {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Kaydet ve detayını aç' })).toBeEnabled())
  fireEvent.change(screen.getByLabelText('Plaka *'), { target: { value: '34 TR 2491' } })
  fireEvent.change(screen.getByLabelText(/İhbar tarihi/), { target: { value: '2026-09-19' } })
}
afterEach(cleanup)
describe('Eksist creation UI', () => {
  it.each([['Kaydet ve kapat', 'DOSYA LİSTESİ'], ['Kaydet ve detayını aç', 'DOSYA DETAYI']])('waits for verified folders before %s', async (button, destination) => {
    const read = vi.fn().mockResolvedValue({ ...plan, status: 'ready' })
    const { create } = setup(undefined, read)
    await fill()
    await userEvent.dblClick(screen.getByRole('button', { name: button }))
    expect(create).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(destination)).not.toBeInTheDocument()
    expect(await screen.findByText(/henüz doğrulanmadı/)).toBeInTheDocument()
    expect(await screen.findByText(destination, {}, { timeout: 3000 })).toBeInTheDocument()
    expect(create.mock.calls[0]![0].case).not.toHaveProperty('lifecycleStatus')
  })
  it('keeps partial failure visible and reuses frozen input and key after retry', async () => {
    const create = vi.fn().mockResolvedValueOnce({ ...result, provisioning: { ...plan, status: 'failed', lastErrorCode: 'storage_unavailable' } }).mockResolvedValueOnce({ ...result, provisioning: { ...plan, status: 'ready' } })
    setup(create); await fill()
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet ve detayını aç' }))
    expect(await screen.findByText(/Klasör oluşturulamadı/)).toBeInTheDocument()
    expect(screen.getByLabelText('Plaka *')).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Aynı kaydı yeniden dene' }))
    expect(await screen.findByText('DOSYA DETAYI')).toBeInTheDocument()
    expect(create.mock.calls[0]).toEqual(create.mock.calls[1])
  })
  it('preserves key after a lost response and unlocks only definitive validation failure', async () => {
    const create = vi.fn().mockRejectedValueOnce(new CaseCommandError('unavailable', 'lost response')).mockRejectedValueOnce(new CaseCommandError('validation', 'invalid', [{ path: 'notificationDate', code: 'required' }]))
    setup(create); await fill()
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet ve detayını aç' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Aynı kaydı yeniden dene' }))
    await waitFor(() => expect(screen.getByLabelText('Plaka *')).toBeEnabled())
    expect(create.mock.calls[0]).toEqual(create.mock.calls[1])
  })
  it('autofills reviewed fields, preserves distinct identities, and blocks unresolved references', async () => {
    const { create } = setup(); await fill()
    fireEvent.change(screen.getByLabelText('Eksist metni veya panodan görsel'), { target: { value: 'Talep İşlem Ref No: 123\nÜrün: Kasko\nPlaka: 034 - TR2491\nHasar Zamanı: 17/09/2026 00:00\nSigorta Şirketi: Belirsiz Sigorta\nEksper Atama Tarihi: 2026-09-18\nSigortalı Ad/Ünvan: ALİ' } })
    await userEvent.click(screen.getByRole('button', { name: 'Metni forma aktar' }))
    expect(await screen.findByLabelText('Eksist talep referansı *')).toHaveValue('123')
    expect(screen.getByLabelText('Plaka *')).toHaveValue('34 TR 2491')
    expect(screen.getByLabelText('Dosya türü *')).toHaveValue('casco')
    expect(screen.getByLabelText(/İhbar tarihi/)).toHaveValue('2026-09-19')
    expect(screen.getByLabelText('İhbar numarası')).toHaveValue('')
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet ve detayını aç' }))
    expect(create).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Eşleştirmeden kaynakta sakla' }))
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet ve detayını aç' }))
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0]![0].source).toMatchObject({ id: 'source', reference: '123' })
  })
  it('accepts a pasted image and an uploaded PDF through the same import callback', async () => {
    const { port } = setup(); await fill()
    const image = new File(['png'], 'clipboard.png', { type: 'image/png' })
    fireEvent.paste(screen.getByLabelText('Eksist metni veya panodan görsel'), { clipboardData: { items: [{ type: image.type, getAsFile: () => image }] } })
    await waitFor(() => expect(port.readSource).toHaveBeenCalledWith({ kind: 'image', name: 'clipboard.png', base64: 'cG5n' }))
    await waitFor(() => expect(screen.getByLabelText('PDF veya ekran görüntüsü yükle')).toBeEnabled())
    await userEvent.upload(screen.getByLabelText('PDF veya ekran görüntüsü yükle'), new File(['pdf'], 'source.pdf', { type: 'application/pdf' }))
    await waitFor(() => expect(port.readSource).toHaveBeenCalledWith({ kind: 'pdf', name: 'source.pdf', base64: 'cGRm' }))
  })
  it('does not require empty optional vehicle fields and retains user corrections', async () => {
    const { create } = setup(); await fill()
    fireEvent.change(screen.getByLabelText('Eksist metni veya panodan görsel'), { target: { value: 'Talep İşlem Ref No: 777\nÜrün: Trafik\nPlaka: 034 - TR2491\nMarka: VOLKSWAGEN' } })
    await userEvent.click(screen.getByRole('button', { name: 'Metni forma aktar' }))
    await screen.findByLabelText('Marka')
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'PASSAT' } })
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet ve detayını aç' }))
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0]![0]).not.toHaveProperty('vehicle')
    expect(create.mock.calls[0]![0].source.vehicleDraft).toEqual({ brand: 'VOLKSWAGEN', model: 'PASSAT', modelYear: '', vehicleClass: '' })
  })
})
