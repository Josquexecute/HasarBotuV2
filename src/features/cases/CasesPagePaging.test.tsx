import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DATA_SOURCE_STORAGE_KEY,
  HttpCasesError,
  type CasePageQuery,
  type CaseReferenceDataPort,
  type CasesDataPort,
  type OperationalAlertDataPort,
} from '../../data'
import type { CaseRecord } from '../../types/case'
import { CasesPage } from './CasesPage'
import { CASES_PAGE_SIZE } from './casesQuery'

const TOTAL = 137

function caseRecord(index: number): CaseRecord {
  return {
    caseId: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
    plate: `34 PG ${index}`,
    officeNumber: `2026/${index}`,
    noticeNumber: `IH-${index}`,
    claimNumber: `HS-${index}`,
    company: 'Sentetik Sigorta',
    type: 'Trafik',
    status: 'Açık',
    stage: 'Raporlama',
    missingDocuments: 0,
    assignee: '-',
    expert: '-',
    service: '-',
    followUp: '-',
    followUpTone: 'normal',
    lastAction: '-',
    vehicle: '-',
    insured: '-',
    estimatedDamage: 0,
    notes: [],
    version: 1,
    workflowStage: 'reporting',
    responsibleUserId: null,
    expertUserId: null,
    serviceId: null,
    serviceProfile: null,
    insurerId: null,
    followUpDate: null,
    lossDate: null,
    notificationDate: null,
    lifecycleStatus: 'open',
  } as CaseRecord
}

const ALL_CASES = Array.from({ length: TOTAL }, (_unused, index) => caseRecord(index + 1))

function stubCasesPort(total = TOTAL) {
  const queries: CasePageQuery[] = []
  const port: CasesDataPort = {
    listCases: async () => { throw new Error('listCases cagrilmamali') },
    getCase: async () => { throw new Error('getCase cagrilmamali') },
    listCasePage: async (query) => {
      queries.push(query)
      const start = (query.page - 1) * query.pageSize
      const source = ALL_CASES.slice(0, total)
      return {
        items: source.slice(start, start + query.pageSize),
        page: query.page,
        pageSize: query.pageSize,
        totalCount: source.length,
        totalPages: Math.max(1, Math.ceil(source.length / query.pageSize)),
      }
    },
  }
  return { port, queries }
}

function stubAlertPort() {
  const requested: string[][] = []
  const port: OperationalAlertDataPort = {
    list: async (caseIds) => {
      requested.push([...(caseIds ?? [])])
      return {
        schemaVersion: 'operational-alert/1.0.0',
        totalCount: 0,
        evaluatedAt: '2026-07-18T10:30:00.000Z',
        alerts: [],
        caseSummaries: (caseIds ?? []).map((caseId) => ({
          caseId,
          totalCount: 0,
          byType: { overdue_task: 0, overdue_follow_up: 0, missing_required_document: 0 },
        })),
      }
    },
  }
  return { port, requested }
}

const referencePort = {
  getCaseReferences: async () => ({
    users: [{ id: 'user-1', displayName: 'Sentetik Sorumlu' }],
    experts: [],
    services: [{ id: 'service-1', name: 'Sentetik Servis' }],
    insurers: [],
  }),
} as unknown as CaseReferenceDataPort

/** Plaka hem satirda hem hizli detay panelinde gorunur; sorgular tabloya sinirlanir. */
function rowPlates(): string[] {
  return [...document.querySelectorAll('tbody tr td:nth-child(2) .plate')]
    .map((node) => node.textContent ?? '')
}

async function findRow(plate: string): Promise<void> {
  await waitFor(() => expect(rowPlates()).toContain(plate))
}

function renderPage(casesPort: CasesDataPort, alertPort?: OperationalAlertDataPort) {
  return render(
    <MemoryRouter initialEntries={['/dosyalar']}>
      <Routes>
        <Route
          path="/dosyalar"
          element={<CasesPage casesPort={casesPort} alertPort={alertPort} referencePort={referencePort} />}
        />
        <Route path="/dosyalar/:caseId" element={<div>Gercek dosya detayi hedefi</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
})

afterEach(() => {
  window.localStorage.clear()
  vi.clearAllMocks()
})

describe('Dosyalar sunucu tarafi sayfalama', () => {
  it('yalniz aktif sayfanin kayitlarini render eder', async () => {
    const { port } = stubCasesPort()
    renderPage(port)

    await findRow('34 PG 1')
    expect(rowPlates()).toHaveLength(CASES_PAGE_SIZE)
    expect(rowPlates()).not.toContain(`34 PG ${CASES_PAGE_SIZE + 1}`)
  })

  it('toplam kayit sayisini ve sayfa bilgisini gosterir', async () => {
    const { port } = stubCasesPort()
    renderPage(port)

    await findRow('34 PG 1')
    expect(screen.getByText(String(TOTAL))).toBeInTheDocument()
    expect(screen.getByText(`Sayfa 1 / ${Math.ceil(TOTAL / CASES_PAGE_SIZE)}`)).toBeInTheDocument()
    expect(screen.getByText(`${CASES_PAGE_SIZE} / ${TOTAL} dosya gösteriliyor`)).toBeInTheDocument()
  })

  it('ileri/geri ile sayfa degistirir ve sunucudan yeni sayfa ister', async () => {
    const { port, queries } = stubCasesPort()
    renderPage(port)

    await findRow('34 PG 1')
    await userEvent.click(screen.getByRole('button', { name: 'Sonraki sayfa' }))

    await findRow(`34 PG ${CASES_PAGE_SIZE + 1}`)
    expect(rowPlates()).not.toContain('34 PG 1')
    expect(queries[queries.length - 1]).toMatchObject({ page: 2, pageSize: CASES_PAGE_SIZE })

    await userEvent.click(screen.getByRole('button', { name: 'Önceki sayfa' }))
    await findRow('34 PG 1')
  })

  it('ilk sayfada geri, son sayfada ileri devre disidir', async () => {
    const { port } = stubCasesPort()
    renderPage(port)

    await findRow('34 PG 1')
    expect(screen.getByRole('button', { name: 'Önceki sayfa' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Sonraki sayfa' }))
    await findRow(`34 PG ${CASES_PAGE_SIZE + 1}`)
    await userEvent.click(screen.getByRole('button', { name: 'Sonraki sayfa' }))
    await findRow(`34 PG ${CASES_PAGE_SIZE * 2 + 1}`)
    expect(screen.getByRole('button', { name: 'Sonraki sayfa' })).toBeDisabled()
  })

  it('arama degisince sayfa 1e doner', async () => {
    const { port, queries } = stubCasesPort()
    renderPage(port)

    await findRow('34 PG 1')
    await userEvent.click(screen.getByRole('button', { name: 'Sonraki sayfa' }))
    await waitFor(() => expect(queries[queries.length - 1].page).toBe(2))

    await userEvent.type(screen.getByPlaceholderText(/Plaka, dosya no/), 'PG')
    await waitFor(() => {
      const last = queries[queries.length - 1]
      expect(last.page).toBe(1)
      expect(last.search).toBe('PG')
    })
  })

  it('filtre ve siralama degisince de sayfa 1e doner', async () => {
    const { port, queries } = stubCasesPort()
    renderPage(port)

    await findRow('34 PG 1')
    await userEvent.click(screen.getByRole('button', { name: 'Sonraki sayfa' }))
    await waitFor(() => expect(queries[queries.length - 1].page).toBe(2))

    await userEvent.selectOptions(screen.getByLabelText('Dosya türü'), 'Kasko')
    await waitFor(() => {
      const last = queries[queries.length - 1]
      expect(last.page).toBe(1)
      expect(last.caseType).toBe('casco')
    })

    await userEvent.click(screen.getByRole('button', { name: 'Sonraki sayfa' }))
    await waitFor(() => expect(queries[queries.length - 1].page).toBe(2))
    await userEvent.selectOptions(screen.getByLabelText('Dosya sıralaması'), 'plate')
    await waitFor(() => {
      const last = queries[queries.length - 1]
      expect(last.page).toBe(1)
      expect(last.sortBy).toBe('plate')
    })
  })

  it('son sayfadaki kayitlar azalirsa gecerli son sayfaya doner', async () => {
    const queries: CasePageQuery[] = []
    let total = TOTAL
    const port: CasesDataPort = {
      listCases: async () => { throw new Error('listCases cagrilmamali') },
      getCase: async () => { throw new Error('getCase cagrilmamali') },
      listCasePage: async (query) => {
        queries.push(query)
        const source = ALL_CASES.slice(0, total)
        const totalPages = Math.max(1, Math.ceil(source.length / query.pageSize))
        // Sunucu aralik disi sayfa icin son gecerli sayfayi bildirir.
        const page = Math.min(query.page, totalPages)
        const start = (page - 1) * query.pageSize
        return {
          items: source.slice(start, start + query.pageSize),
          page,
          pageSize: query.pageSize,
          totalCount: source.length,
          totalPages,
        }
      },
    }
    renderPage(port)

    await findRow('34 PG 1')
    await userEvent.click(screen.getByRole('button', { name: 'Sonraki sayfa' }))
    await findRow(`34 PG ${CASES_PAGE_SIZE + 1}`)
    await userEvent.click(screen.getByRole('button', { name: 'Sonraki sayfa' }))
    await waitFor(() => expect(queries[queries.length - 1].page).toBe(3))

    // Kayitlar azalir: 3. sayfa artik yok, istemci gecerli son sayfaya doner.
    total = CASES_PAGE_SIZE + 5
    await userEvent.selectOptions(screen.getByLabelText('Dosya türü'), 'Kasko')
    await waitFor(() => {
      expect(screen.getByText('Sayfa 1 / 2')).toBeInTheDocument()
    })
  })

  it('satir uyari isteginde yalniz aktif sayfa kimlikleri gonderilir', async () => {
    const { port } = stubCasesPort()
    const alerts = stubAlertPort()
    renderPage(port, alerts.port)

    await findRow('34 PG 1')
    await waitFor(() => expect(alerts.requested.length).toBeGreaterThan(0))
    await waitFor(() => {
      const last = alerts.requested[alerts.requested.length - 1]
      expect(last).toHaveLength(CASES_PAGE_SIZE)
      expect(last[0]).toBe(ALL_CASES[0].caseId)
    })

    await userEvent.click(screen.getByRole('button', { name: 'Sonraki sayfa' }))
    await findRow(`34 PG ${CASES_PAGE_SIZE + 1}`)
    await waitFor(() => {
      const last = alerts.requested[alerts.requested.length - 1]
      expect(last[0]).toBe(ALL_CASES[CASES_PAGE_SIZE].caseId)
      expect(last).toHaveLength(CASES_PAGE_SIZE)
    })
  })

  it('normal kullanimda bilinmiyor uyari durumu kalmaz', async () => {
    const { port } = stubCasesPort()
    const alerts = stubAlertPort()
    renderPage(port, alerts.port)

    await findRow('34 PG 1')
    await waitFor(() => expect(alerts.requested.length).toBeGreaterThan(0))
    await waitFor(() => {
      expect(screen.queryByText(/uyarı durumu bilinmiyor/)).not.toBeInTheDocument()
    })
  })

  it('API hatasinda eski veya mock kayit gosterilmez', async () => {
    const port: CasesDataPort = {
      listCases: async () => { throw new Error('listCases cagrilmamali') },
      getCase: async () => { throw new Error('getCase cagrilmamali') },
      listCasePage: async () => { throw new HttpCasesError('unavailable', 'test') },
    }
    renderPage(port)

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('kullanılamıyor')
    })
    expect(rowPlates()).toEqual([])
    expect(screen.queryByText('34 MPA 764')).not.toBeInTheDocument()
  })

  it('API modunda butun liste cekilmez', async () => {
    // `listCases` cagrilirsa stub hata firlatir; sayfanin yuklenmesi cagrilmadigini gosterir.
    const { port } = stubCasesPort()
    renderPage(port)

    await findRow('34 PG 1')
    expect(screen.getByText(String(TOTAL))).toBeInTheDocument()
  })
})
