import { render,screen,waitFor,within } from '@testing-library/react'
import { expect,it,vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { CaseReferenceFilters } from './CaseReferenceFilters'
it('lists and selects historical contact names independently of directory identities', async () => {
  const onServiceChange = vi.fn()
  render(<CaseReferenceFilters responsibleUserId="Tümü" serviceId="Tümü" onResponsibleChange={vi.fn()} onServiceChange={onServiceChange} port={{ getCaseReferences: async () => ({ insurers: [], services: [], experts: [], users: [], serviceContactNames: ['Tarihsel Servis'] }) }} />)
  const input = screen.getByLabelText('Dosya servisi')
  await waitFor(() => expect(input).toBeEnabled())
  await userEvent.click(input)
  await userEvent.click(await screen.findByRole('option', { name: 'Tarihsel Servis (eski kayıtlar)' }))
  expect(onServiceChange).toHaveBeenCalledWith('name:Tarihsel Servis')
})
it('lists all active case-manager references, including users with no cases on this page',async () => {
  render(<CaseReferenceFilters responsibleUserId="Tümü" serviceId="Tümü" onResponsibleChange={vi.fn()} onServiceChange={vi.fn()} port={{ getCaseReferences: async () => ({ insurers: [],services: [],experts: [],users: [
    { id: 'owner-a',displayName: 'Sorumlu A',roles: ['case_manager'] },
    { id: 'owner-b',displayName: 'Henüz Dosyasız Sorumlu',roles: ['expert','case_manager'] },
    { id: 'expert',displayName: 'Eksper',roles: ['expert'] },
    { id: 'viewer',displayName: 'Okuyucu',roles: ['read_only'] },
  ] }) }} />)
  const input = screen.getByLabelText('Dosya sorumlusu')
  await waitFor(() => expect(input).toBeEnabled())
  await userEvent.click(input)
  await screen.findByRole('option',{ name: 'Henüz Dosyasız Sorumlu' })
  expect(within(screen.getByRole('listbox')).getAllByRole('option').map((item) => item.textContent)).toEqual(['Tüm sorumlular','Sorumlu A','Henüz Dosyasız Sorumlu'])
})
