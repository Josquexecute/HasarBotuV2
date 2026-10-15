import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LegislationApiContent } from './LegislationApiContent'
import { SessionContext, type SessionContextValue } from '../../app/sessionContext'

const source = { id: 'ktk', title: 'Resmî test kaynağı', kind: 'Kanun', publisher: 'Mevzuat Bilgi Sistemi', url: 'https://www.mevzuat.gov.tr/MevzuatMetin/1.5.2918.pdf', format: 'pdf', pageCount: 2, contentHash: 'a'.repeat(64), verifiedAt: '2026-10-14T12:00:00.000Z', effectiveFrom: null, applicability: 'snapshot_requires_date_review' }
const organizationId = '019fe084-1ec1-7797-835a-777eb0cc59c2'
const answer = { id: '019fe084-1ec2-7407-ac68-c3cf1641a1b5', mode: 'sources', createdAt: '2026-10-14T12:00:00.000Z', question: 'Trafik işleten sorumluluğu', eventDate: null, caseId: null, libraryVersion: 'v1', provider: null, statements: [{ text: 'Dayanak metni incelenmeli.', citationIds: ['ktk:p2'] }], citations: [{ id: 'ktk:p2', sourceId: 'ktk', title: source.title, url: source.url + '#page=2', page: 2, locatorKind: 'page', contentHash: source.contentHash, excerpt: 'Dayanak metni incelenmeli.' }], missingInformation: ['Olay tarihi belirtilmedi.'], requiresReview: true }
function install(enabled = false) {
  const calls: { path: string; init?: RequestInit }[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    calls.push({ path: input, init })
    const body = input.endsWith('/library') ? { version: 'v1', aiEnabled: enabled, sources: [source] }
      : input.endsWith('/history') ? { items: [] }
      : input.endsWith('/questions') ? answer
      : input.includes('/sources/') ? { source, page: Number(new URL(input, 'http://localhost').searchParams.get('page')), text: 'Gerçek kaynak sayfası' }
      : { organizationId, version: init?.method === 'PUT' ? 1 : 0, configured: init?.method === 'PUT', enabled: init?.method === 'PUT', model: 'gemini-3.8-flash', canConfigure: true, encryptionAvailable: true }
    return new Response(JSON.stringify(body))
  }))
  return calls
}
afterEach(() => { vi.unstubAllGlobals();localStorage.clear() })
describe('real legislation workspace', () => {
  it('retrieves official sources, searches and opens the cited physical page', async () => {
    const calls = install(), user = userEvent.setup()
    render(<LegislationApiContent />)
    await screen.findByRole('button', { name: /Resmî test kaynağı/ })
    expect(screen.getByRole('button', { name: 'AI ile kaynaklı yanıt' })).toBeDisabled()
    await user.type(screen.getByLabelText('Sorunuz'), answer.question)
    await user.click(screen.getByRole('button', { name: 'Kaynaklarda ara' }))
    await screen.findByText('Dayanak metni incelenmeli.', { selector: 'p' })
    await user.click(screen.getByRole('button', { name: source.title + ' · Sayfa 2' }))
    await screen.findByText('Gerçek kaynak sayfası')
    expect(screen.getByLabelText('Kaynak sayfası')).toHaveValue(2)
    expect(screen.getByRole('link', { name: 'Resmî metni aç' })).toHaveAttribute('href', source.url + '#page=2')
    expect(calls.find(c => c.path.endsWith('/questions'))?.init).toMatchObject({ credentials: 'include', method: 'POST' })
    expect(screen.getByText('Olay tarihi belirtilmedi.')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })
  it('saves the API key via authenticated PUT and clears it without browser persistence', async () => {
    const calls = install(), user = userEvent.setup(), key = 'AQ.synthetic-authorization-key.' + 'test_'.repeat(60)
    render(<LegislationApiContent />)
    await screen.findByRole('button', { name: /Resmî test kaynağı/ })
    await user.click(screen.getByText('Gemini bağlantı ayarları'))
    const input = screen.getByLabelText(/Gemini API anahtarı/)
    expect(input).toHaveAttribute('type', 'password')
    await user.click(input);await user.paste(key)
    await user.click(screen.getByRole('button', { name: 'Gemini ayarlarını kaydet' }))
    await screen.findByText('Gemini ayarları kaydedildi. Bağlantıyı kaynaklı AI yanıtıyla deneyin.')
    expect(input).toHaveValue('')
    const sent = calls.find(c => c.init?.method === 'PUT')
    expect(JSON.parse(String(sent?.init?.body))).toMatchObject({ expectedOrganizationId: organizationId, expectedVersion: 0, apiKey: key })
    expect(JSON.stringify(localStorage)).not.toContain(key)
    expect(JSON.stringify(sessionStorage)).not.toContain(key)
  })
  it('isolates pending requests when the active account changes', async () => {
    let resolveOld: ((response: Response) => void) | undefined
    const fetcher = vi.fn((path: string) => path.endsWith('/questions') ? new Promise<Response>(resolve => { resolveOld = resolve }) : Promise.resolve(new Response(JSON.stringify(path.endsWith('/library') ? { version: 'v1', aiEnabled: false, sources: [source] } : path.endsWith('/history') ? { items: [] } : { organizationId, version: 0, configured: false, enabled: false, model: 'gemini-3.8-flash', canConfigure: false, encryptionAvailable: true }))))
    vi.stubGlobal('fetch', fetcher)
    const session = (id: string): SessionContextValue => ({ mode: 'api', status: 'authenticated', user: { id, organizationId, email: 'synthetic@example.test', displayName: 'Synthetic', roles: ['admin'] }, notice: null, login: vi.fn(), logout: vi.fn(), reportUnauthorized: vi.fn() })
    const user = userEvent.setup(), view = render(<SessionContext.Provider value={session('first')}><LegislationApiContent /></SessionContext.Provider>)
    await screen.findByRole('button', { name: /Resmî test kaynağı/ })
    await user.type(screen.getByLabelText('Sorunuz'), 'Eski hesabın özel sorusu')
    await user.click(screen.getByRole('button', { name: 'Kaynaklarda ara' }))
    await waitFor(() => expect(resolveOld).toBeDefined())
    view.rerender(<SessionContext.Provider value={session('second')}><LegislationApiContent /></SessionContext.Provider>)
    resolveOld!(new Response(JSON.stringify(answer)))
    await screen.findByRole('button', { name: /Resmî test kaynağı/ })
    expect(screen.getByLabelText('Sorunuz')).toHaveValue('')
    expect(screen.queryByText('Dayanak metni incelenmeli.')).not.toBeInTheDocument()
  })
  it('retains an invalid key and identifies the field without treating date guidance as a service error',async () => {
    install()
    const user = userEvent.setup()
    render(<LegislationApiContent />)
    await screen.findByRole('button',{ name: /Resmî test kaynağı/ })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await user.click(screen.getByText('Gemini bağlantı ayarları'))
    await user.type(screen.getByLabelText(/Gemini API anahtarı/),'synthetic-key with-spaces')
    await user.click(screen.getByRole('button',{ name: 'Gemini ayarlarını kaydet' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Yalnız anahtarı yapıştırın')
    expect(screen.getByLabelText(/Gemini API anahtarı/)).toHaveValue('synthetic-key with-spaces')
    expect(screen.getByText('Tarih ve sürüm bilgilendirmesi')).toBeInTheDocument()
  })
})
