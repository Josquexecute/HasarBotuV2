import { render,screen,within } from '@testing-library/react'
import { expect,it,vi } from 'vitest'
import { CaseReferenceFilters } from './CaseReferenceFilters'
it('lists all active case-manager references, including users with no cases on this page',async () => {
  render(<CaseReferenceFilters responsibleUserId="Tümü" serviceId="Tümü" onResponsibleChange={vi.fn()} onServiceChange={vi.fn()} port={{ getCaseReferences: async () => ({ insurers: [],services: [],experts: [],users: [
    { id: 'owner-a',displayName: 'Sorumlu A',roles: ['case_manager'] },
    { id: 'owner-b',displayName: 'Henüz Dosyasız Sorumlu',roles: ['expert','case_manager'] },
    { id: 'expert',displayName: 'Eksper',roles: ['expert'] },
    { id: 'viewer',displayName: 'Okuyucu',roles: ['read_only'] },
  ] }) }} />)
  await screen.findByRole('option',{ name: 'Henüz Dosyasız Sorumlu' })
  expect(within(screen.getByLabelText('Dosya sorumlusu')).getAllByRole('option').map((item) => item.textContent)).toEqual(['Tümü','Sorumlu A','Henüz Dosyasız Sorumlu'])
})
