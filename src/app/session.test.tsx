import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionProvider } from './session'
import { useSession } from './sessionContext'
import { DATA_SOURCE_STORAGE_KEY } from '../data/ports'
import { HttpAuthError, type AuthPort, type SessionUser } from '../data/authPort'

const USER: SessionUser = {
  id: 'user-1',
  organizationId: 'org-1',
  email: 'yazici@baran.example',
  displayName: 'Yazıcı Kullanıcı',
  roles: ['case_manager'],
}

function fakeAuth(overrides: Partial<AuthPort> = {}): AuthPort {
  return {
    bootstrap: overrides.bootstrap ?? (() => Promise.resolve(null)),
    login: overrides.login ?? (() => Promise.resolve(USER)),
    logout: overrides.logout ?? (() => Promise.resolve()),
  }
}

function Probe() {
  const session = useSession()
  return (
    <div>
      <span data-testid="status">{session.status}</span>
      <span data-testid="user">{session.user?.displayName ?? '-'}</span>
      <span data-testid="notice">{session.notice ?? '-'}</span>
      <button type="button" onClick={() => { void session.login('yazici@baran.example', 'cok-guclu-parola-42') }}>login</button>
      <button type="button" onClick={() => { void session.logout() }}>logout</button>
      <button type="button" onClick={() => session.reportUnauthorized()}>expire</button>
    </div>
  )
}

function renderProvider(auth?: AuthPort) {
  return render(
    <SessionProvider {...(auth !== undefined ? { authPort: auth } : {})}>
      <Probe />
    </SessionProvider>,
  )
}

afterEach(() => {
  window.localStorage.removeItem(DATA_SOURCE_STORAGE_KEY)
  vi.restoreAllMocks()
})

describe('SessionProvider mock mod (varsayilan)', () => {
  it('oturum kapisi yok: status mock, bootstrap cagrilmaz', () => {
    const bootstrap = vi.fn()
    renderProvider(fakeAuth({ bootstrap }))
    expect(screen.getByTestId('status').textContent).toBe('mock')
    expect(bootstrap).not.toHaveBeenCalled()
  })
})

describe('SessionProvider api mod bootstrap', () => {
  it('gecerli oturum -> authenticated + kullanici', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    renderProvider(fakeAuth({ bootstrap: () => Promise.resolve(USER) }))
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))
    expect(screen.getByTestId('user').textContent).toBe('Yazıcı Kullanıcı')
  })

  it('oturum yok -> anonymous', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    renderProvider(fakeAuth({ bootstrap: () => Promise.resolve(null) }))
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'))
  })

  it('servise ulasilamiyor -> anonymous + not gosterilir (sahte oturum yok)', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    renderProvider(fakeAuth({ bootstrap: () => Promise.reject(new HttpAuthError('unavailable', 'down')) }))
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'))
    expect(screen.getByTestId('notice').textContent).toContain('ulaşılamıyor')
    expect(screen.getByTestId('user').textContent).toBe('-')
  })
})

describe('SessionProvider login/logout/expiry', () => {
  it('login basarili -> authenticated', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    const user = userEvent.setup()
    renderProvider(fakeAuth({ bootstrap: () => Promise.resolve(null), login: () => Promise.resolve(USER) }))
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'))
    await user.click(screen.getByRole('button', { name: 'login' }))
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))
    expect(screen.getByTestId('user').textContent).toBe('Yazıcı Kullanıcı')
  })

  it('logout -> anonymous + kullanici temizlenir', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    const user = userEvent.setup()
    const logout = vi.fn(() => Promise.resolve())
    renderProvider(fakeAuth({ bootstrap: () => Promise.resolve(USER), logout }))
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))
    await user.click(screen.getByRole('button', { name: 'logout' }))
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'))
    expect(logout).toHaveBeenCalledOnce()
    expect(screen.getByTestId('user').textContent).toBe('-')
  })

  it('reportUnauthorized: authenticated -> expired (oturum sona erdi)', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    const user = userEvent.setup()
    renderProvider(fakeAuth({ bootstrap: () => Promise.resolve(USER) }))
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))
    await user.click(screen.getByRole('button', { name: 'expire' }))
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('expired'))
    expect(screen.getByTestId('user').textContent).toBe('-')
  })
})
