import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from './App'
import { DATA_SOURCE_STORAGE_KEY } from '../data/ports'
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

  it('kimliksiz erisim /ayarlar rotasini da login ekraninin arkasinda tutar', async () => {
    window.history.replaceState({}, '', '/ayarlar')
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    installFetch({ session: () => ({ status: 401 }) })

    render(<App />)

    expect(await screen.findByRole('button', { name: 'Giriş Yap' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Ayarlar' })).not.toBeInTheDocument()
  })

  it('giristen sonra /ayarlar sayfanin KENDI icin ek istek yapmadan acilir (oturum bootstrap + kabuk genelindeki bildirim rozeti)', async () => {
    window.history.replaceState({}, '', '/ayarlar')
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    const calls: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL) => {
      calls.push(String(input))
      return {
        ok: true,
        status: 200,
        json: async () => (String(input).includes('/operational-alerts') ? { schemaVersion: 'operational-alert/1.0.0', totalCount: 0, evaluatedAt: '2026-08-10T00:00:00.000Z', alerts: [] } : SESSION),
        headers: { get: () => null },
      } as unknown as Response
    }) as unknown as typeof fetch)

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Ayarlar' })).toBeInTheDocument()
    // Sidebar her rotada aynı, gerçek Bildirimler rozetini sorar (Paket 56 düzeltmesi:
    // önceden sabit kodlu "7" idi) -- /ayarlar sayfasının KENDİ içeriği hâlâ ek istek yapmaz.
    expect(calls).toHaveLength(2)
    expect(calls.some((call) => call.includes('/api/v1/auth/session'))).toBe(true)
    expect(calls.some((call) => call.includes('/api/v1/operational-alerts'))).toBe(true)
  })

  it('kimliksiz erisim /mevzuat-ve-ai rotasini da login ekraninin arkasinda tutar', async () => {
    window.history.replaceState({}, '', '/mevzuat-ve-ai')
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    installFetch({ session: () => ({ status: 401 }) })

    render(<App />)

    expect(await screen.findByRole('button', { name: 'Giriş Yap' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Mevzuat ve AI Yardımcısı' })).not.toBeInTheDocument()
  })

  it('giristen sonra /mevzuat-ve-ai dürüst boş durumu SAYFANIN KENDİ içeriği için ek istek yapmadan gösterir (oturum bootstrap + kabuk genelindeki bildirim rozeti)', async () => {
    window.history.replaceState({}, '', '/mevzuat-ve-ai')
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    const calls: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL) => {
      calls.push(String(input))
      return {
        ok: true,
        status: 200,
        json: async () => (String(input).includes('/operational-alerts') ? { schemaVersion: 'operational-alert/1.0.0', totalCount: 0, evaluatedAt: '2026-08-10T00:00:00.000Z', alerts: [] } : SESSION),
        headers: { get: () => null },
      } as unknown as Response
    }) as unknown as typeof fetch)

    render(<App />)

    expect(await screen.findByText('Mevzuat kaynak kütüphanesi henüz yapılandırılmadı.')).toBeInTheDocument()
    // Sidebar her rotada aynı, gerçek Bildirimler rozetini sorar (Paket 56 düzeltmesi:
    // önceden sabit kodlu "7" idi) -- /mevzuat-ve-ai sayfasının KENDİ içeriği hâlâ ek istek yapmaz.
    expect(calls).toHaveLength(2)
    expect(calls.some((call) => call.includes('/api/v1/auth/session'))).toBe(true)
    expect(calls.some((call) => call.includes('/api/v1/operational-alerts'))).toBe(true)
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
