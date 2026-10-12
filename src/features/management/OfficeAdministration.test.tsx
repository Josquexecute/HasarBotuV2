import { render,screen,waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach,describe,expect,it,vi } from 'vitest'
import { PERMISSION_DEFINITIONS } from '@hasarbotu/contracts'
import { ServicesAdministration,PermissionsAdministration } from './OfficeAdministration'
import { trackingRequest } from '../tracking/trackingApi'
vi.mock('../tracking/trackingApi',() => ({ trackingRequest: vi.fn() }))
const id = '019f5f00-0000-7000-8000-000000000001'
afterEach(() => vi.resetAllMocks())
describe('actual administration forms',() => {
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
