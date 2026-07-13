import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from './App'
import { DATA_SOURCE_STORAGE_KEY } from '../data'

/**
 * Uctan uca oturum kapisi (Paket 10): gercek SessionProvider + HttpAuthAdapter
 * + LoginPage + Topbar, fetch yonlendirici mock'u ile surulur. `api` mod.
 */
const SESSION = {
  user: {
    id: 'user-1',
    organizationId: 'org-1',
    email: 'yazici@baran.example',
    displayName: 'Yazıcı Kullanıcı',
    roles: ['case_manager'],
  },
  expiresAt: '2026-07-13T21:00:00.000Z',
}

interface RouteMap {
  session: () => { status: number; body?: unknown }
  cases?: () => { status: number; body?: unknown }
}

function installFetch(routes: RouteMap): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL) => {
    const url = String(input)
    let result: { status: number; body?: unknown }
    if (url.endsWith('/api/v1/auth/session')) result = routes.session()
    else if (url.endsWith('/api/v1/auth/login')) result = { status: 200, body: SESSION }
    else if (url.endsWith('/api/v1/auth/logout')) result = { status: 204 }
    else if (url.includes('/api/v1/cases')) result = routes.cases?.() ?? { status: 200, body: { items: [] } }
    else result = { status: 404 }
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      json: async () => result.body,
      headers: { get: () => null },
    } as unknown as Response
  }) as unknown as typeof fetch)
}

afterEach(() => {
  window.localStorage.removeItem(DATA_SOURCE_STORAGE_KEY)
  vi.restoreAllMocks()
  window.history.replaceState({}, '', '/')
})

describe('App oturum kapisi (api mod)', () => {
  it('oturum yokken login ekrani gosterir, korumali rotalar gizlidir', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    installFetch({ session: () => ({ status: 401 }) })

    render(<App />)

    expect(await screen.findByRole('button', { name: 'Giriş Yap' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Operasyon Durumu' })).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Ana navigasyon' })).not.toBeInTheDocument()
  })

  it('giris -> korumali uygulama; cikis -> tekrar login', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    installFetch({ session: () => ({ status: 401 }) })
    const user = userEvent.setup()

    render(<App />)
    await screen.findByRole('button', { name: 'Giriş Yap' })

    await user.type(screen.getByLabelText('E-posta'), 'yazici@baran.example')
    await user.type(screen.getByLabelText('Parola'), 'cok-guclu-parola-42')
    await user.click(screen.getByRole('button', { name: 'Giriş Yap' }))

    // Korumali uygulama acildi: pano + oturum gostergesi + cikis dugmesi.
    expect(await screen.findByRole('heading', { name: 'Operasyon Durumu' })).toBeInTheDocument()
    expect(screen.getByText('Oturum aktif')).toBeInTheDocument()
    expect(screen.queryByText('UI Prototip · Mock Veri')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Oturumu kapat' }))
    expect(await screen.findByRole('button', { name: 'Giriş Yap' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Operasyon Durumu' })).not.toBeInTheDocument()
  })

  it('kimlikli oturumda 401 -> guvenli "oturum sona erdi" akisi (mock veri gosterilmez)', async () => {
    window.history.replaceState({}, '', '/dosyalar')
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    installFetch({ session: () => ({ status: 200, body: SESSION }), cases: () => ({ status: 401 }) })

    render(<App />)

    expect(await screen.findByText(/Oturumunuz sona erdi/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Giriş Yap' })).toBeInTheDocument()
    expect(screen.queryByText('34 MPA 764')).not.toBeInTheDocument()
  })
})

describe('App mock mod (varsayilan baseline korunur)', () => {
  it('login kapisi olmadan pano ve navigasyon acilir', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Operasyon Durumu' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Ana navigasyon' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Giriş Yap' })).not.toBeInTheDocument()
  })
})
