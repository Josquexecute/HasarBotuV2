import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { SessionContext, type SessionContextValue } from '../../app/sessionContext'
import { DATA_SOURCE_STORAGE_KEY } from '../../data/ports'
import { CaseDetailPage } from './CaseDetailPage'

const CLOSED_CASE = {
  id: 'case-closed-38',
  caseType: 'casco' as const,
  officeCaseNumber: '2026/3802',
  notificationFormNumber: null,
  insurerClaimNumber: null,
  plate: '34 API 380',
  status: 'closed' as const,
  stage: 'closed' as const,
  responsibleUserId: null,
  expertUserId: null,
  serviceId: null,
  serviceProfile: null,
  insurerId: null,
  followUpDate: null,
  lossDate: '2026-07-10',
  notificationDate: '2026-07-11',
  lastInterventionAt: '2026-07-16T09:00:00.000Z',
  createdAt: '2026-07-11T08:00:00.000Z',
  updatedAt: '2026-07-16T09:00:00.000Z',
  version: 4,
  legacyReferences: { responsibleNames: [], expertNames: [], serviceNames: [] },
}

describe('CaseDetailPage gercek API dogruluk siniri', () => {
  it('kaldırılmış İşçilik sekmesi kaydedilmiş olsa da özeti açar ve işçilik isteği yapmaz', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    window.sessionStorage.setItem('hasarbotu-active-case-tab', 'İşçilik')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL) => {
      const body = String(input).includes('case-closed-38?')
        ? { case: CLOSED_CASE }
        : { items: [], pageInfo: { page: 1, pageSize: 100, totalItems: 0, totalPages: 0 } }
      return { ok: true, status: 200, json: async () => body } as Response
    }) as typeof fetch)
    render(<MemoryRouter initialEntries={['/dosyalar/case-closed-38']}>
      <Routes><Route path="/dosyalar/:caseId" element={<CaseDetailPage />} /></Routes>
    </MemoryRouter>)
    await waitFor(() => expect(screen.getByText('34 API 380')).toBeInTheDocument(), { timeout: 15_000 })
    expect(screen.queryByRole('button', { name: 'İşçilik' })).not.toBeInTheDocument()
    expect(window.sessionStorage.getItem('hasarbotu-active-case-tab')).toBe('Özet')
    expect(screen.getByRole('button', { name: 'Ağır Hasar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Değer Kaybı' })).toBeInTheDocument()
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('/labor'))).toBe(false)
  })

  it('kapali case listede olmasa bile detail endpointinden acilir ve bagli olmayan modullerde mock gostermez', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    window.sessionStorage.setItem('hasarbotu-active-case-tab', 'Geçmiş')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL) => {
      const url = String(input)
      const body = url.endsWith('/api/v1/cases/case-closed-38?includeLegacyReferences=true')
        ? { case: CLOSED_CASE }
        : { items: [], pageInfo: { page: 1, pageSize: 100, totalItems: 0, totalPages: 0 } }
      return { ok: true, status: 200, json: async () => body } as Response
    }) as typeof fetch)

    render(
      <MemoryRouter initialEntries={['/dosyalar/case-closed-38']}>
        <Routes>
          <Route path="/dosyalar/:caseId" element={<CaseDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )

    // Contracts paketi büyüdükçe ilk dinamik import + Zod şema kurulumu 1 sn'lik
    // varsayılanı aşabiliyor; kapı süreye değil gerçek yükleme sonucuna bakmalı.
    await waitFor(() => expect(screen.getByText('34 API 380')).toBeInTheDocument(), { timeout: 15_000 })
    expect(screen.getByText('Bu modül henüz gerçek API verisine bağlı değildir; mock kayıt gösterilmez.')).toBeInTheDocument()
    expect(screen.queryByText('Servis görüşmesi notu eklendi')).not.toBeInTheDocument()
    expect(fetchSpy).toHaveBeenCalledWith('/api/v1/cases/case-closed-38?includeLegacyReferences=true', expect.anything())
  })

  it('yerel case override, dosya sunucuda yeniden yüklenip sürüm değiştiğinde mutabakatla geri gelmez', async () => {
    // Regresyon (HB-2026-096 madde 4): override eskiden efektle bir sonraki
    // tikte sıfırlanıyordu; RENDER sırasında türetilen anahtar (`caseId#version`)
    // artık sürüm değiştiği ANDA aynı render'da düşer. Bu test, düzenleme ile
    // uygulanan yerel override'ın "Tek Dosyayı Yenile" sunucudan farklı bir
    // sürüm getirdiğinde eski override'a değil TAZE sunucu verisine dönüştüğünü
    // doğrudan doğrular.
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    window.sessionStorage.setItem('hasarbotu-active-case-tab', 'Geçmiş')
    const CASE_ID = 'case-fail-closed-1'
    const base = {
      id: CASE_ID,
      caseType: 'traffic' as const,
      officeCaseNumber: '2026/9001',
      notificationFormNumber: null,
      insurerClaimNumber: null,
      plate: '34 FCB 900',
      status: 'open' as const,
      responsibleUserId: null,
      expertUserId: null,
      serviceId: null,
      serviceProfile: null,
      insurerId: null,
      followUpDate: null,
      lossDate: '2026-07-10',
      notificationDate: '2026-07-11',
      lastInterventionAt: '2026-07-16T09:00:00.000Z',
      createdAt: '2026-07-11T08:00:00.000Z',
      updatedAt: '2026-07-16T09:00:00.000Z',
    }
    const initialDto = { ...base, stage: 'new_notification' as const, version: 4 }
    const patchedDto = { ...base, stage: 'damage_assessment' as const, version: 4 }
    const refreshedDto = { ...base, stage: 'parts_and_labor' as const, version: 6 }
    let getCallCount = 0
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (method === 'PATCH' && url.endsWith(`/api/v1/cases/${CASE_ID}`)) {
        return { ok: true, status: 200, json: async () => ({ case: patchedDto }) } as Response
      }
      if (url.endsWith(`/api/v1/cases/${CASE_ID}?includeLegacyReferences=true`)) {
        getCallCount += 1
        const body = {
          ...(getCallCount === 1 ? initialDto : refreshedDto),
          legacyReferences: { responsibleNames: [], expertNames: [], serviceNames: [] },
        }
        return { ok: true, status: 200, json: async () => ({ case: body }) } as Response
      }
      return { ok: true, status: 200, json: async () => ({ items: [], pageInfo: { page: 1, pageSize: 100, totalItems: 0, totalPages: 0 } }) } as Response
    }) as typeof fetch)

    const sessionValue: SessionContextValue = {
      mode: 'api',
      status: 'authenticated',
      user: { id: 'user-1', organizationId: 'org-1', email: 'eksper@baran.example', displayName: 'Eksper', roles: ['expert'] },
      notice: null,
      login: vi.fn(),
      logout: vi.fn(),
      reportUnauthorized: vi.fn(),
    }
    const user = userEvent.setup()
    render(
      <SessionContext.Provider value={sessionValue}>
        <MemoryRouter initialEntries={[`/dosyalar/${CASE_ID}`]}>
          <Routes>
            <Route path="/dosyalar/:caseId" element={<CaseDetailPage />} />
          </Routes>
        </MemoryRouter>
      </SessionContext.Provider>,
    )

    await waitFor(() => expect(screen.getByText('34 FCB 900')).toBeInTheDocument(), { timeout: 15_000 })
    expect(screen.getByText('Yeni İhbar')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Temel Bilgileri Düzenle' }))
    await screen.findByRole('dialog', { name: 'Temel Dosya Bilgilerini Düzenle' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Değişiklikleri Kaydet' })).toBeEnabled())
    await user.selectOptions(screen.getByLabelText('Workflow aşaması'), 'damage_assessment')
    await user.click(screen.getByRole('button', { name: 'Değişiklikleri Kaydet' }))

    // Yerel override uygulanır: header AYNI render'da (sunucu yenilenmeden) yeni değeri gösterir.
    await waitFor(() => expect(screen.getByText('Hasar Tespiti')).toBeInTheDocument())
    expect(screen.queryByRole('dialog', { name: 'Temel Dosya Bilgilerini Düzenle' })).not.toBeInTheDocument()

    const getCallsBeforeReload = getCallCount
    await user.click(screen.getByRole('button', { name: 'Tek Dosyayı Yenile' }))
    await waitFor(() => expect(getCallCount).toBeGreaterThan(getCallsBeforeReload))

    // Sürüm 4 -> 6 sunucudan geldiği anda override anahtarı uyuşmaz ve düşer;
    // ekran bayat "Hasar Tespiti" override'ını değil taze sunucu aşamasını gösterir.
    await waitFor(() => expect(screen.getByText('Onarım Takibi')).toBeInTheDocument())
    expect(screen.queryByText('Hasar Tespiti')).not.toBeInTheDocument()
    expect(fetchSpy).toHaveBeenCalledWith(`/api/v1/cases/${CASE_ID}`, expect.objectContaining({ method: 'PATCH' }))
  })
})
