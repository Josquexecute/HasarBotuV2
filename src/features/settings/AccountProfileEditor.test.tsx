import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { SessionContext, type SessionContextValue } from '../../app/sessionContext'
import { USER_DIRECTORY_UPDATED_EVENT } from '../../app/userDirectory'
import { AccountProfileError, type AccountProfilePort } from '../../data/accountProfilePort'
import { AccountProfileEditor } from './AccountProfileEditor'

const profile = { userId: '019f0000-0000-7000-8000-000000000001', displayName: 'Eski Ad Soyad', version: 1 }
function renderEditor(port: AccountProfilePort) {
  return render(<SessionContext.Provider value={{ mode: 'api', status: 'authenticated', user: { id: profile.userId, organizationId: 'org', displayName: profile.displayName, email: 'profile@example.test', roles: ['read_only'] }, reportUnauthorized: vi.fn() } as unknown as SessionContextValue}><AccountProfileEditor port={port} /></SessionContext.Provider>)
}
it('saves the server profile and signals shared-name refresh after persistence', async () => {
  const updated = vi.fn(), user = userEvent.setup()
  window.addEventListener(USER_DIRECTORY_UPDATED_EVENT, updated)
  const port = { load: vi.fn().mockResolvedValue(profile), save: vi.fn().mockImplementation(async (_profile, displayName) => ({ ...profile, displayName, version: 2 })) }
  try {
    renderEditor(port)
    const input = await screen.findByLabelText('Ad Soyad')
    await waitFor(() => expect(input).toBeEnabled())
    await user.clear(input); await user.type(input, 'Ömer Şahin')
    await user.click(screen.getByRole('button', { name: 'Ad Soyadı Kaydet' }))
    await waitFor(() => expect(port.save).toHaveBeenCalledWith(profile, 'Ömer Şahin'))
    expect(await screen.findByRole('status')).toHaveTextContent('tüm ofiste görünür')
    expect(updated).toHaveBeenCalledTimes(1)
  } finally { window.removeEventListener(USER_DIRECTORY_UPDATED_EVENT, updated) }
})
it('preserves the edited name after a conflict and blocks duplicate submits while saving', async () => {
  let reject!: (error: Error) => void
  const port = { load: vi.fn().mockResolvedValue(profile), save: vi.fn(() => new Promise<never>((_done, fail) => { reject = fail })) }
  renderEditor(port)
  const input = screen.getByLabelText('Ad Soyad')
  await waitFor(() => expect(input).toBeEnabled())
  fireEvent.change(input, { target: { value: 'Yeni Ad Soyad' } })
  const form = input.closest('form')!
  fireEvent.submit(form); fireEvent.submit(form)
  await waitFor(() => expect(port.save).toHaveBeenCalledTimes(1))
  await act(async () => reject(new AccountProfileError('conflict')))
  expect(screen.getByRole('alert')).toHaveTextContent('başka bir oturumda değişti')
  expect(input).toHaveValue('Yeni Ad Soyad')
  expect(screen.getByRole('button', { name: 'Güncel bilgileri yükle' })).toBeEnabled()
})
