import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { SessionContext, type SessionContextValue } from '../../app/sessionContext'
import { FieldApp } from './FieldApp'
import { fieldRequest, uploadFieldPhoto } from './field-api'

vi.mock('./field-api', async importOriginal => ({
  ...await importOriginal<typeof import('./field-api')>(),
  fieldRequest: vi.fn(),
  uploadFieldPhoto: vi.fn(),
}))

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

it('offers VİTES and uploads multiple selected photos with the category and current user', async () => {
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn().mockReturnValue('blob:gear')
    static revokeObjectURL = vi.fn()
  })
  vi.mocked(fieldRequest).mockResolvedValueOnce({ items: [{ id: 'case-1', plate: '34 ABC 123', officeNumber: '2026/1', status: 'open', canUpload: true }] }).mockResolvedValue({ items: [] })
  vi.mocked(uploadFieldPhoto).mockResolvedValue({ id: 'upload-1', status: 'queued' } as never)
  const session: SessionContextValue = { mode: 'api', status: 'authenticated', notice: null,
    user: { id: 'user-gear', organizationId: 'org-1', email: 'synthetic@example.test', displayName: 'Synthetic', roles: ['expert'] }, login: vi.fn(), logout: vi.fn(), reportUnauthorized: vi.fn() }
  const user = userEvent.setup()
  const view = render(<SessionContext.Provider value={session}><FieldApp /></SessionContext.Provider>)
  try {
    await user.type(screen.getByLabelText('Plaka ara'), '34 ABC 123')
    await user.click(screen.getByRole('button', { name: 'Ara' }))
    await user.click(await screen.findByRole('button', { name: /34 ABC 123/ }))
    await user.click(screen.getByRole('button', { name: 'VİTES' }))
    expect(screen.getByRole('button', { name: 'VİTES' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/plakanın HASAR alt klasörüne/)).toBeInTheDocument()
    const files = [new File(['one'], 'gear-1.jpg', { type: 'image/jpeg' }), new File(['two'], 'gear-2.webp', { type: 'image/webp' })]
    await user.upload(screen.getByLabelText('Galeriden fotoğraf seç'), files)
    await user.click(screen.getByRole('button', { name: '2 fotoğrafı yükle' }))
    expect(uploadFieldPhoto).toHaveBeenCalledTimes(2)
    for (const file of files) expect(uploadFieldPhoto).toHaveBeenCalledWith(expect.objectContaining({ file, kind: 'gear', caseId: 'case-1', userId: 'user-gear' }))
  } finally { view.unmount() }
})

it('releases removed photo previews immediately and retains the remaining selection until unmount', async () => {
  const createObjectURL = vi.fn().mockReturnValueOnce('blob:removed').mockReturnValueOnce('blob:retained')
  const revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = createObjectURL
    static revokeObjectURL = revokeObjectURL
  })
  vi.mocked(fieldRequest)
    .mockResolvedValueOnce({ items: [{ id: 'case-1', plate: '34 ABC 123', officeNumber: '2026/1', status: 'open', canUpload: true }] })
    .mockResolvedValue({ items: [] })
  const session: SessionContextValue = {
    mode: 'api', status: 'authenticated', notice: null,
    user: { id: 'user-1', organizationId: 'org-1', email: 'synthetic@example.test', displayName: 'Synthetic', roles: ['expert'] },
    login: vi.fn(), logout: vi.fn(), reportUnauthorized: vi.fn(),
  }
  const user = userEvent.setup()
  const view = render(<SessionContext.Provider value={session}><FieldApp /></SessionContext.Provider>)
  try {
    await user.type(screen.getByLabelText('Plaka ara'), '34 ABC 123')
    await user.click(screen.getByRole('button', { name: 'Ara' }))
    await user.click(await screen.findByRole('button', { name: /34 ABC 123/ }))
    await user.upload(screen.getByLabelText('Galeriden fotoğraf seç'), [
      new File(['removed'], 'removed.jpg', { type: 'image/jpeg' }),
      new File(['retained'], 'retained.jpg', { type: 'image/jpeg' }),
    ])
    expect(createObjectURL).toHaveBeenCalledTimes(2)
    await user.click(screen.getByRole('button', { name: 'removed.jpg seçimini kaldır' }))
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:removed')
    expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:retained')
    view.unmount()
    expect(revokeObjectURL.mock.calls).toEqual([['blob:removed'], ['blob:retained']])
  } finally { view.unmount() }
})
