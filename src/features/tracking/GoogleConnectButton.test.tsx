import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GoogleConnectButton } from './GoogleConnectButton'
import { saveGoogleFlow, type OAuthWindow } from './googleOAuth'

const flowId = 'synthetic-browser-bound-flow-123456'
const url = 'https://accounts.google.com/o/oauth2/v2/auth?state=opaque'
function transport(status = 'complete', code = 200) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (target) => {
    if (String(target).endsWith('/status')) return Response.json({ enabled: true })
    if (String(target).endsWith('/start')) return Response.json({ flowId, url })
    return Response.json({ status }, { status: code })
  })
}
async function clickStart() {
  const button = screen.getByRole('button')
  await waitFor(() => expect(button).toBeEnabled())
  await userEvent.click(button)
}
afterEach(() => {
  cleanup(); sessionStorage.clear(); vi.restoreAllMocks()
  delete (window as OAuthWindow).hasarbotuDesktop
  delete (window as OAuthWindow).hasarbotuOAuth
})
it('reserves a web tab within the click, removes its opener and completes in the original app', async () => {
  const complete = vi.fn(), replace = vi.fn(), close = vi.fn()
  const popup = { opener: window, location: { replace }, close, closed: false }
  const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
  const fetch = transport()
  render(<GoogleConnectButton purpose="mail" onComplete={complete} />)
  await clickStart()
  expect(open).toHaveBeenCalledWith('/api/v1/google/result/web/mail/pending', '_blank')
  expect(popup.opener).toBeNull()
  expect(replace).toHaveBeenCalledWith(url)
  expect(open.mock.invocationCallOrder[0]).toBeLessThan(fetch.mock.invocationCallOrder[1]!)
  expect(fetch.mock.calls.find(([target]) => String(target).endsWith('/start'))?.[1]).toMatchObject({ credentials: 'include', body: JSON.stringify({ purpose: 'mail', client: 'web' }) })
  await waitFor(() => expect(complete).toHaveBeenCalledTimes(1))
  expect(close).toHaveBeenCalledTimes(1)
  expect(sessionStorage.getItem('hb-google-mail')).toBeNull()
  expect(screen.getByRole('status')).toHaveTextContent('Gmail hesabı bağlandı')
})
it('uses the existing secure Electron external-browser gate and focuses the app after completion', async () => {
  const complete = vi.fn(), focus = vi.fn().mockResolvedValue(undefined)
  ;(window as OAuthWindow).hasarbotuDesktop = { isDesktopShell: true }
  ;(window as OAuthWindow).hasarbotuOAuth = { focus }
  const open = vi.spyOn(window, 'open').mockReturnValue(null), fetch = transport()
  render(<GoogleConnectButton purpose="login" rememberMe={false} onComplete={complete} />)
  await clickStart()
  expect(open).toHaveBeenCalledExactlyOnceWith(url, '_blank', 'noopener,noreferrer')
  await waitFor(() => expect(complete).toHaveBeenCalledOnce())
  expect(focus).toHaveBeenCalledOnce()
  expect(JSON.parse(String(fetch.mock.calls.find(([target]) => String(target).endsWith('/complete'))?.[1]?.body))).toEqual({ flowId, rememberMe: false })
})
it('provides a safe link when the popup is blocked and still completes automatically', async () => {
  vi.spyOn(window, 'open').mockReturnValue(null)
  transport('pending')
  render(<GoogleConnectButton purpose="mail" />)
  await clickStart()
  expect(await screen.findByText(/yeni sekmeyi engelledi/)).toBeInTheDocument()
  expect(screen.getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer')
  expect(screen.getByRole('link')).toHaveAttribute('href', url)
})
it.each([['approval_required', 200, 'yönetici onayı'], ['denied', 400, 'izin verilmedi'], ['expired', 400, 'süresi doldu'], ['failed', 400, 'tamamlanamadı']])('shows %s without treating HTTP errors as generic transport failures', async (status, code, text) => {
  vi.spyOn(window, 'open').mockReturnValue(null)
  transport(String(status), Number(code))
  const complete = vi.fn()
  render(<GoogleConnectButton purpose="mail" onComplete={complete} />)
  await clickStart()
  await waitFor(() => expect(screen.getByText(new RegExp(String(text)))).toBeInTheDocument())
  expect(screen.getByRole('button')).toBeEnabled()
  expect(complete).not.toHaveBeenCalled()
})
it('resumes the browser-bound flow after a reload with its original persistence choice', async () => {
  saveGoogleFlow('login', { flowId, startedAt: Date.now(), rememberMe: false })
  const fetch = transport(), complete = vi.fn(), open = vi.spyOn(window, 'open').mockReturnValue(null)
  render(<GoogleConnectButton purpose="login" rememberMe={true} onComplete={complete} />)
  await waitFor(() => expect(complete).toHaveBeenCalledOnce())
  expect(open).not.toHaveBeenCalled()
  expect(JSON.parse(String(fetch.mock.calls.find(([target]) => String(target).endsWith('/complete'))?.[1]?.body))).toEqual({ flowId, rememberMe: false })
})
it('recovers a network interruption on focus without parallel completion requests', async () => {
  saveGoogleFlow('mail', { flowId, startedAt: Date.now() })
  let attempts = 0
  const complete = vi.fn()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async target => {
    if (String(target).endsWith('/status')) return Response.json({ enabled: true })
    if (++attempts === 1) throw new TypeError('offline')
    return Response.json({ status: 'complete' })
  })
  render(<GoogleConnectButton purpose="mail" onComplete={complete} />)
  expect(await screen.findByText(/Ağ erişimi sağlandığında/)).toBeInTheDocument()
  window.dispatchEvent(new Event('focus'))
  window.dispatchEvent(new Event('focus'))
  await waitFor(() => expect(complete).toHaveBeenCalledOnce())
  expect(attempts).toBe(2)
})
it('keeps successful completion when browser policy refuses closing a detached tab', async () => {
  transport()
  vi.spyOn(window, 'open').mockReturnValue({ opener: null, location: { replace: vi.fn() }, close: () => { throw new DOMException('Blocked') } } as unknown as Window)
  const complete = vi.fn()
  render(<GoogleConnectButton purpose="mail" onComplete={complete} />)
  await clickStart()
  await waitFor(() => expect(complete).toHaveBeenCalledOnce())
  expect(screen.getByRole('status')).toHaveTextContent('Gmail hesabı bağlandı')
})
it('rejects an unsafe consent URL and releases the reserved tab', async () => {
  const close = vi.fn(), replace = vi.fn()
  vi.spyOn(window, 'open').mockReturnValue({ opener: null, close, location: { replace } } as unknown as Window)
  vi.spyOn(globalThis, 'fetch').mockImplementation(async target => Response.json(String(target).endsWith('/status') ? { enabled: true } : { flowId, url: 'https://accounts.google.com@evil.example/' }))
  render(<GoogleConnectButton purpose="login" />)
  await clickStart()
  expect(await screen.findByRole('alert')).toHaveTextContent('başlatılamadı')
  expect(close).toHaveBeenCalledOnce()
  expect(replace).not.toHaveBeenCalled()
})
it('shows unavailable Google access without a fake working button', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ enabled: false }))
  render(<GoogleConnectButton purpose="login" />)
  expect(await screen.findByText('Google bağlantısı henüz yapılandırılmamış.')).toBeInTheDocument()
  expect(screen.getByRole('button')).toBeDisabled()
})
