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
const completeText = 'Talep İşlem Ref No: 123\nÜrün: Kasko\nPlaka: 034 - TR2491\nHasar Zamanı: 17/09/2026 00:00\nSigorta Şirketi: KAYNAK SİGORTA A.Ş.\nEksper Atama Tarihi: 18.09.2026 09:30:00\nEksper Ad-Soyad: KAYNAK EKSPER\nLevha No: E123\nTamirhane Ad / Ünvan: KAYNAK SERVİS\nMarka: VOLKSWAGEN\nAraç Tipi: PASSAT\nModel Yılı: 2014\nAraç Tarife Grubu: OTOMOBİL\nMotor No: CAYZ46629\nŞasi No: WVWZZZ3CZEE144172'
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
  it('clears corrected validation errors before starting a quick creation attempt', async () => {
    const { create } = setup()
    await fill()
    const message = 'Çalışma klasörü için ihbar tarihi zorunludur. Atama tarihi ihbar tarihi değildir.'
    fireEvent.change(screen.getByLabelText(/İhbar tarihi/), { target: { value: '' } })
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet ve detayını aç' }))
    expect(screen.getByText(message)).toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(/İhbar tarihi/), { target: { value: '2026-09-19' } })
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet ve detayını aç' }))
    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    expect(screen.queryByText(message)).not.toBeInTheDocument()
  })
  it.each(['Kaydet ve kapat', 'Kaydet ve detayını aç'])('preserves SBM contacts through name deletion and revision before %s', async button => {
    const { create } = setup(); await fill()
    const text = completeText + '\nTamirhane Yeri Bilgileri\nTamirhane Ad / Ünvan: KAYNAK SERVİS\nTelefon: 0212 555 10 10\nAçık Adres: Kaynak servis adresi'
    fireEvent.change(screen.getByLabelText('Eksist metni veya panodan görsel'), { target: { value: text } })
    await userEvent.click(screen.getByRole('button', { name: 'Metni forma aktar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Servisi revize et' }))
    const name = screen.getByLabelText('Servis adı')
    fireEvent.change(name, { target: { value: '' } })
    expect(screen.getAllByLabelText('Servis telefonu').every(field => (field as HTMLInputElement).value === '0212 555 10 10')).toBe(true)
    expect(screen.getByRole('button', { name: 'Revizyonu uygula' })).toBeDisabled()
    fireEvent.change(name, { target: { value: 'KAYNAK SERVİS DÜZELTİLDİ' } })
    await userEvent.click(screen.getByRole('button', { name: 'Revizyonu uygula' }))
    await userEvent.click(screen.getByRole('button', { name: 'Servisi revize et' }))
    expect(screen.getByLabelText('Servis adı')).toHaveValue('KAYNAK SERVİS DÜZELTİLDİ')
    await userEvent.click(screen.getByRole('button', { name: 'Vazgeç' }))
    await userEvent.click(screen.getByRole('button', { name: button }))
    expect(create.mock.calls[0]![0]).toMatchObject({ case: { serviceDetails: { name: 'KAYNAK SERVİS DÜZELTİLDİ', phone: '0212 555 10 10', address: 'Kaynak servis adresi' } }, source: { serviceRevision: { name: 'KAYNAK SERVİS DÜZELTİLDİ' } } })
  })
  it('transfers matching SBM service name, phone and address together and permits correction', async () => {
    const { create } = setup(); await fill()
    const text = completeText + '\nTamirhane Yeri Bilgileri\nTamirhane Ad / Ünvan: KAYNAK SERVİS\nTelefon: 0212 555 10 10\nAçık Adres: Kaynak servis adresi\nAtama Yapan İletişim Bilgileri\nTelefon: 0532 555 99 99'
    fireEvent.change(screen.getByLabelText('Eksist metni veya panodan görsel'), { target: { value: text } })
    await userEvent.click(screen.getByRole('button', { name: 'Metni forma aktar' }))
    expect(screen.getByLabelText('Servis telefonu')).toHaveValue('0212 555 10 10')
    expect(screen.getByLabelText('Servis adresi')).toHaveValue('Kaynak servis adresi')
    fireEvent.change(screen.getByLabelText('Servis telefonu'), { target: { value: '0212 555 11 11' } })
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet ve detayını aç' }))
    expect(create.mock.calls[0]![0].case.serviceDetails).toEqual({ name: 'KAYNAK SERVİS', phone: '0212 555 11 11', address: 'Kaynak servis adresi' })
  })
  it('resolves multiple source insurers explicitly and accepts repeated traffic labels', async () => {
    const { create } = setup(); await fill()
    const text = completeText.replace('Ürün: Kasko','Ürün: Trafik\nÜrün: TRAFİK').replace('Sigorta Şirketi: KAYNAK SİGORTA A.Ş.','Sigorta Şirketi: KAYNAK SİGORTA A.Ş.\nSigorta Şirketi: DİĞER SİGORTA')
    fireEvent.change(screen.getByLabelText('Eksist metni veya panodan görsel'), { target: { value: text } })
    await userEvent.click(screen.getByRole('button', { name: 'Metni forma aktar' }))
    expect(await screen.findByLabelText('Dosya türü *')).toHaveValue('traffic')
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet ve detayını aç' }))
    expect(create).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('combobox', { name: /Sigorta şirketi/ }), { target: { value: 'DİĞER SİGORTA' } })
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet ve detayını aç' }))
    expect(create).toHaveBeenCalledOnce()
    expect(create.mock.calls[0]![0].source.insurerReview).toEqual({ name: 'DİĞER SİGORTA', confirmed: true })
  })
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
  it('locks source company, expert and assignment date, with server-managed follow-up date', async () => {
    const { create } = setup(); await fill()
    fireEvent.change(screen.getByLabelText('Eksist metni veya panodan görsel'), { target: { value: completeText } })
    await userEvent.click(screen.getByRole('button', { name: 'Metni forma aktar' }))
    expect(await screen.findByLabelText('Eksist talep referansı *')).toHaveValue('123')
    expect(screen.getByLabelText('Plaka *')).toHaveValue('34 TR 2491')
    expect(screen.getByLabelText('Dosya türü *')).toHaveValue('casco')
    expect(screen.getByLabelText(/İhbar tarihi/)).toHaveValue('2026-09-19')
    expect(screen.getByLabelText('İhbar numarası')).toHaveValue('18.09.2026 09:30:00')
    for (const label of ['İhbar numarası', 'Takip tarihi', 'Sigorta şirketi', 'Eksper', 'Servis']) expect(screen.getByLabelText(label)).toHaveAttribute('readonly')
    expect(screen.getByLabelText('Sigorta şirketi')).toHaveValue('KAYNAK SİGORTA A.Ş.')
    expect(screen.getByLabelText('Eksper')).toHaveValue('KAYNAK EKSPER')
    expect(screen.getByText('WVWZZZ3CZEE144172')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Eşleştirmeden kaynakta sakla' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet ve detayını aç' }))
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0]![0].source).toMatchObject({ id: 'source', reference: '123' })
    expect(create.mock.calls[0]![0].case).not.toHaveProperty('followUpDate')
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
  it('requires explicit OCR expert review, resets confirmation on edit and sends the corrected name', async () => {
    const { port, create } = setup(); await fill()
    const text = completeText.replace('KAYNAK EKSPER', 'SENTETİK EKSPER')
    vi.mocked(port.readSource).mockResolvedValue({ id: 'source', extraction: parseEksist(text), text, method: 'ocr' })
    await userEvent.upload(screen.getByLabelText('PDF veya ekran görüntüsü yükle'), new File(['png'], 'source.png', { type: 'image/png' }))
    const name = await screen.findByLabelText('Doğrulanan eksper adı')
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet ve detayını aç' }))
    expect(create).not.toHaveBeenCalled()
    const confirmation = screen.getByRole('checkbox', { name: /Eksper adını orijinal belgeyle/ })
    await userEvent.click(confirmation)
    fireEvent.change(name, { target: { value: 'SENTETIK EKSPER' } })
    expect(confirmation).not.toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet ve detayını aç' }))
    expect(create).not.toHaveBeenCalled()
    await userEvent.click(confirmation)
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet ve detayını aç' }))
    expect(create.mock.calls[0]![0].source.expertReview).toEqual({ name: 'SENTETIK EKSPER', confirmed: true })
    expect(screen.getByLabelText('Eksper')).toHaveValue('SENTETİK EKSPER')
  })
  it('blocks incomplete vehicle extraction instead of silently saving a partial vehicle', async () => {
    const { create } = setup(); await fill()
    fireEvent.change(screen.getByLabelText('Eksist metni veya panodan görsel'), { target: { value: 'Talep İşlem Ref No: 777\nÜrün: Trafik\nPlaka: 034 - TR2491\nMarka: VOLKSWAGEN' } })
    await userEvent.click(screen.getByRole('button', { name: 'Metni forma aktar' }))
    await screen.findByLabelText('Marka')
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet ve detayını aç' }))
    expect(create).not.toHaveBeenCalled()
    expect(screen.getByText(/Kaynakta eksik araç bilgileri/)).toBeInTheDocument()
  })
  it('requires the pencil dialog to revise a service and preserves cancelled edits', async () => {
    const { create } = setup(); await fill()
    fireEvent.change(screen.getByLabelText('Eksist metni veya panodan görsel'), { target: { value: completeText } })
    await userEvent.click(screen.getByRole('button', { name: 'Metni forma aktar' }))
    await screen.findByLabelText('Eksist talep referansı *')
    await userEvent.click(screen.getByRole('button', { name: 'Servisi revize et' }))
    expect(screen.getByRole('dialog', { name: 'Servisi revize et' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Servis adı'), { target: { value: 'VAZGEÇİLEN SERVİS' } })
    await userEvent.keyboard('{Escape}')
    expect(screen.getByLabelText('Servis')).toHaveValue('KAYNAK SERVİS')
    await userEvent.click(screen.getByRole('button', { name: 'Servisi revize et' }))
    fireEvent.change(screen.getByLabelText('Servis adı'), { target: { value: 'REVİZE SERVİS' } })
    await userEvent.click(screen.getByRole('button', { name: 'Revizyonu uygula' }))
    expect(screen.getByLabelText('Servis')).toHaveValue('REVİZE SERVİS')
    expect(create).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet ve detayını aç' }))
    expect(create.mock.calls[0]![0].source.serviceRevision).toEqual({ name: 'REVİZE SERVİS' })
  })
})
