import { afterEach,expect,it,vi } from 'vitest'
import { cleanup,render,screen,waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GoogleConnectButton } from './GoogleConnectButton'

afterEach(() => { cleanup();vi.restoreAllMocks() })
it('opens a separate Gmail consent link and consumes completion in the initiating app',async () => {
  const complete = vi.fn()
  const fetch = vi.spyOn(globalThis,'fetch').mockImplementation(async (url) => {
    if (String(url).endsWith('/status')) return Response.json({ enabled: true })
    if (String(url).endsWith('/start')) return Response.json({ flowId: 'flow-id',url: 'https://accounts.google.com/o/oauth2/v2/auth?state=opaque' })
    return Response.json({ status: 'complete' })
  })
  render(<GoogleConnectButton purpose="mail" onComplete={complete} />)
  const button = screen.getByRole('button',{ name: 'SBM e-posta hesabını bağla' })
  await waitFor(() => expect(button).toBeEnabled())
  await userEvent.click(button)
  expect(await screen.findByRole('link',{ name: 'Google sayfasını aç' })).toHaveAttribute('target','_blank')
  expect(fetch.mock.calls.find(([url]) => String(url).endsWith('/start'))?.[1]).toMatchObject({ credentials: 'include',body: JSON.stringify({ purpose: 'mail' }) })
  await waitFor(() => expect(complete).toHaveBeenCalledTimes(1),{ timeout: 4000 })
  expect(screen.queryByRole('link',{ name: 'Google sayfasını aç' })).not.toBeInTheDocument()
})
it('shows unavailable Google access without a fake working button',async () => {
  vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({ enabled: false }))
  render(<GoogleConnectButton purpose="login" />)
  expect(await screen.findByText('Google bağlantısı henüz yapılandırılmamış.')).toBeInTheDocument()
  expect(screen.getByRole('button')).toBeDisabled()
})
