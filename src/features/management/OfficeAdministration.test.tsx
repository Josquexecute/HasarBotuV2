import { render,screen,waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach,describe,expect,it,vi } from 'vitest'
import { PERMISSION_DEFINITIONS } from '@hasarbotu/contracts'
import { ServicesAdministration,PermissionsAdministration,InsurersAdministration } from './OfficeAdministration'
import { trackingRequest } from '../tracking/trackingApi'
vi.mock('../tracking/trackingApi',() => ({ trackingRequest: vi.fn() }))
const id = '019f5f00-0000-7000-8000-000000000001'
afterEach(() => vi.resetAllMocks())
describe('actual administration forms',() => {
  it('submits insurer revisions with a version and retains text on conflict',async () => {
    vi.mocked(trackingRequest).mockResolvedValueOnce({ items: [{ id,name: 'Test Sigorta',isActive: true,version: 2 }] }).mockRejectedValueOnce(new Error('Sigorta şirketi değişmiş. Listeyi yenileyin.'))
    render(<InsurersAdministration />)
    await userEvent.click(await screen.findByRole('button',{ name: 'Test Sigorta şirketini düzenle' }))
    await userEvent.clear(screen.getByLabelText('Şirket adı'));await userEvent.type(screen.getByLabelText('Şirket adı'),'Revize Sigorta')
    await userEvent.click(screen.getByRole('button',{ name: 'Şirketi kaydet' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Sigorta şirketi değişmiş')
    expect(screen.getByLabelText('Şirket adı')).toHaveValue('Revize Sigorta')
    expect(trackingRequest).toHaveBeenLastCalledWith(`administration/insurers/${id}`,{ name: 'Revize Sigorta',isActive: true,expectedVersion: 2 })
  })
  it('removes an insurer from future choices only after confirming the named entry',async () => {
    vi.mocked(trackingRequest).mockResolvedValueOnce({ items: [{ id,name: 'Test Sigorta',isActive: true,version: 2 }] }).mockResolvedValueOnce({ item: { id,name: 'Test Sigorta',isActive: false,version: 3 } }).mockResolvedValueOnce({ items: [{ id,name: 'Test Sigorta',isActive: false,version: 3 }] })
    render(<InsurersAdministration />)
    await userEvent.click(await screen.findByRole('button',{ name: 'Test Sigorta şirketini sil' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Geçmiş dosyalardaki kayıtları korunacaktır')
    expect(trackingRequest).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button',{ name: 'Silmeyi onayla' }))
    await screen.findByText(/seçim listesinden kaldırıldı/)
    expect(trackingRequest).toHaveBeenCalledWith(`administration/insurers/${id}/delete`,{ expectedVersion: 2 })
    expect(screen.queryByRole('button',{ name: 'Test Sigorta şirketini düzenle' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Silinen şirketleri göster'))
    expect(screen.getByRole('button',{ name: 'Test Sigorta şirketini düzenle' })).toBeInTheDocument()
  })
  it('retains service edits on a conflict and submits the real version and service type',async () => {
    vi.mocked(trackingRequest).mockResolvedValueOnce({ items: [{ id,name: 'Test Servis',serviceType: 'private',phone: null,isActive: true,version: 2 }] }).mockRejectedValueOnce(new Error('Servis değişmiş. Listeyi yenileyin.'))
    render(<ServicesAdministration />)
    await userEvent.click(await screen.findByRole('button',{ name: 'Test Servis servisini düzenle' }))
    const name = screen.getByLabelText('Servis adı')
    await userEvent.clear(name);await userEvent.type(name,'Yeni Servis')
    await userEvent.selectOptions(screen.getByLabelText('Servis türü'),'glass')
    await userEvent.click(screen.getByRole('button',{ name: 'Servisi kaydet' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Servis değişmiş')
    expect(name).toHaveValue('Yeni Servis')
    expect(trackingRequest).toHaveBeenLastCalledWith(`administration/services/${id}`,{ name: 'Yeni Servis',serviceType: 'glass',phone: null,isActive: true,expectedVersion: 2 })
  })
  it('saves changed role permissions with a version and preserves protected administrator access',async () => {
    const permissions = Object.fromEntries(PERMISSION_DEFINITIONS.map((item) => [item.code,[...item.roles]]))
    vi.mocked(trackingRequest).mockResolvedValueOnce({ version: 1,permissions }).mockResolvedValueOnce({ version: 2,permissions }).mockResolvedValueOnce({ version: 2,permissions })
    render(<PermissionsAdministration canEdit />)
    const owner = await screen.findByLabelText('Not ve görev · Sorumlu')
    expect(owner).toBeChecked()
    expect(screen.getByLabelText('Not ve görev · Yönetici')).toBeDisabled()
    expect(screen.getByLabelText('Not ve görev · Okuyucu')).toBeDisabled()
    await userEvent.click(owner)
    await userEvent.click(screen.getByRole('button',{ name: 'Yetkileri kaydet' }))
    await waitFor(() => expect(trackingRequest).toHaveBeenCalledWith('administration/permissions',expect.objectContaining({ expectedVersion: 1,permissions: expect.objectContaining({ operations_write: ['admin','expert','secretary'] }) })))
  })
})
