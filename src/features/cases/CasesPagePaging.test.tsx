import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router'
import { CaseListCacheContext, createCaseListCache } from '../../data/caseListCache'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpCasesError } from '../../data/httpAdapter'
import type { OperationalAlertDataPort } from '../../data/operationalAlertPort'
import { DATA_SOURCE_STORAGE_KEY, type CasePageQuery, type CaseReferenceDataPort, type CasesDataPort } from '../../data/ports'
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
  return [...document.querySelectorAll('tbody tr .plate')]
    .map((node) => node.textContent ?? '')
}

async function findRow(plate: string): Promise<void> {
  await waitFor(() => expect(rowPlates()).toContain(plate))
}

function DetailTarget() {
  const navigate = useNavigate()
  return <><span>Gercek dosya detayi hedefi</span><button onClick={() => navigate('/dosyalar')}>Listeye dön</button><button onClick={() => navigate('/dosyalar?q=PG')}>Yeni global arama</button></>
}

function renderPage(casesPort: CasesDataPort, alertPort?: OperationalAlertDataPort, cache = createCaseListCache(), initialUrl = '/dosyalar') {
  return render(
    <CaseListCacheContext.Provider value={cache}>
    <MemoryRouter initialEntries={[initialUrl]}>
      <Routes>
        <Route
          path="/dosyalar"
          element={<CasesPage casesPort={casesPort} alertPort={alertPort} referencePort={referencePort} />}
        />
        <Route path="/dosyalar/:caseId" element={<DetailTarget />} />
      </Routes>
    </MemoryRouter>
    </CaseListCacheContext.Provider>,
  )
}

beforeEach(() => {
  window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
})

afterEach(() => {
  window.localStorage.clear()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('Dosyalar sonsuz kaydırma', () => {
  it('loads only the first 50 rows and shows the real total without paging controls', async () => {
    const { port, queries } = stubCasesPort()
    renderPage(port)
    await findRow('34 PG 1')
    expect(rowPlates()).toHaveLength(CASES_PAGE_SIZE)
    expect(queries).toHaveLength(1)
    expect(queries[0]).toMatchObject({ page: 1, pageSize: 50 })
    expect(screen.getByText('50 / 137 dosya gösteriliyor')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sonraki sayfa' })).not.toBeInTheDocument()
  })

  it('observes the bottom of the actual table scroller and ignores concurrent load triggers', async () => {
    let intersect: IntersectionObserverCallback | undefined
    const observe = vi.fn(), disconnect = vi.fn()
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit) {
        intersect = callback
        expect(options.root).toBe(document.querySelector('[aria-label="Dosya listesi"]'))
      }
      observe = observe
      disconnect = disconnect
    })
    const { port, queries } = stubCasesPort()
    const view = renderPage(port)
    await findRow('34 PG 1')
    await waitFor(() => expect(observe).toHaveBeenCalled())
    act(() => {
      const entries = [{ isIntersecting: true }] as IntersectionObserverEntry[]
      intersect!(entries, {} as IntersectionObserver)
      intersect!(entries, {} as IntersectionObserver)
    })
    await findRow('34 PG 100')
    expect(rowPlates()).toHaveLength(100)
    expect(queries.map(query => query.page)).toEqual([1, 2])
    expect(document.querySelector('tbody tr')?.classList.contains('is-selected')).toBe(true)
    view.unmount()
    expect(disconnect).toHaveBeenCalled()
  })

  it('appends all batches, keeps earlier rows and stops exactly at the final batch', async () => {
    const { port, queries } = stubCasesPort()
    renderPage(port)
    await findRow('34 PG 1')
    await userEvent.click(screen.getByRole('button', { name: 'Daha fazla dosya yükle' }))
    await findRow('34 PG 100')
    expect(rowPlates()).toContain('34 PG 1')
    await userEvent.click(screen.getByRole('button', { name: 'Daha fazla dosya yükle' }))
    await findRow('34 PG 137')
    expect(rowPlates()).toHaveLength(TOTAL)
    expect(screen.getByText('Tüm dosyalar yüklendi.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Daha fazla dosya yükle' })).not.toBeInTheDocument()
    expect(queries.map(query => query.page)).toEqual([1, 2, 3])
  })

  it('deduplicates repeated IDs when live updates shift the page boundary', async () => {
    const { port } = stubCasesPort()
    const original = port.listCasePage
    port.listCasePage = async query => {
      const result = await original(query)
      return query.page === 2 ? { ...result, items: [{ ...ALL_CASES[49], company: 'Güncel Sentetik Şirket' }, ...result.items.slice(1)] } : result
    }
    renderPage(port)
    await findRow('34 PG 1')
    await userEvent.click(screen.getByRole('button', { name: 'Daha fazla dosya yükle' }))
    await findRow('34 PG 100')
    expect(rowPlates()).toHaveLength(99)
    expect(rowPlates().filter(plate => plate === '34 PG 50')).toHaveLength(1)
    expect(screen.getByText('Güncel Sentetik Şirket')).toBeInTheDocument()
  })

  it('retains loaded rows after an append error and retries the same batch explicitly', async () => {
    const { port, queries } = stubCasesPort()
    const original = port.listCasePage
    let fail = true
    port.listCasePage = async query => {
      if (query.page === 2 && fail) { fail = false; queries.push(query); throw new HttpCasesError('unavailable', 'synthetic') }
      return original(query)
    }
    renderPage(port)
    await findRow('34 PG 1')
    await userEvent.click(screen.getByRole('button', { name: 'Daha fazla dosya yükle' }))
    expect(await screen.findByText(/Diğer dosyalar yüklenemedi/)).toBeInTheDocument()
    expect(rowPlates()).toHaveLength(50)
    await userEvent.click(screen.getByRole('button', { name: 'Diğer dosyaları yeniden yükle' }))
    await findRow('34 PG 100')
    expect(queries.map(query => query.page)).toEqual([1, 2, 2])
  })

  it('starts from the first batch when search, filters or sorting change', async () => {
    const { port, queries } = stubCasesPort()
    renderPage(port)
    await findRow('34 PG 1')
    await userEvent.click(screen.getByRole('button', { name: 'Daha fazla dosya yükle' }))
    await findRow('34 PG 100')
    await userEvent.selectOptions(screen.getByLabelText('Dosya türü'), 'Kasko')
    await waitFor(() => expect(queries.at(-1)).toMatchObject({ page: 1, caseType: 'casco' }))
    await waitFor(() => expect(rowPlates()).toHaveLength(50))
    await userEvent.type(screen.getByPlaceholderText(/Plaka, dosya no/), 'PG')
    await waitFor(() => expect(queries.at(-1)).toMatchObject({ page: 1, search: 'PG' }))
    await userEvent.selectOptions(screen.getByLabelText('Dosya sıralaması'), 'plate')
    await waitFor(() => expect(queries.at(-1)).toMatchObject({ page: 1, sortBy: 'plate' }))
    expect(rowPlates()).not.toContain('34 PG 100')
  })

  it('ignores a late append response after filters change', async () => {
    const { port } = stubCasesPort()
    const original = port.listCasePage
    let release: (() => void) | undefined
    port.listCasePage = async query => {
      if (query.page === 2) await new Promise<void>(resolve => { release = resolve })
      return original(query)
    }
    renderPage(port)
    await findRow('34 PG 1')
    await userEvent.click(screen.getByRole('button', { name: 'Daha fazla dosya yükle' }))
    await waitFor(() => expect(release).toBeDefined())
    await userEvent.selectOptions(screen.getByLabelText('Dosya türü'), 'Kasko')
    await findRow('34 PG 1')
    await act(async () => { release!() })
    expect(rowPlates()).toHaveLength(50)
    expect(rowPlates()).not.toContain('34 PG 51')
  })

  it('refreshes and shortens the loaded range if the last requested page disappears', async () => {
    const { port, queries } = stubCasesPort()
    const original = port.listCasePage
    let shrink = false
    port.listCasePage = async query => {
      if (!shrink) return original(query)
      queries.push(query)
      const page = Math.min(query.page, 2)
      return { items: ALL_CASES.slice((page - 1) * 50, Math.min(page * 50, 55)), page, pageSize: 50, totalCount: 55, totalPages: 2 }
    }
    renderPage(port)
    await findRow('34 PG 1')
    await userEvent.click(screen.getByRole('button', { name: 'Daha fazla dosya yükle' }))
    await findRow('34 PG 100')
    shrink = true
    await userEvent.click(screen.getByRole('button', { name: 'Daha fazla dosya yükle' }))
    await waitFor(() => expect(rowPlates()).toHaveLength(55))
    expect(screen.getByText('55 / 55 dosya gösteriliyor')).toBeInTheDocument()
    expect(queries.slice(-3).map(query => query.page)).toEqual([3, 1, 2])
  })

  it('restores selection, filters and both scroll axes on return while refreshing the loaded range', async () => {
    const { port, queries } = stubCasesPort()
    const cache = createCaseListCache()
    renderPage(port, stubAlertPort().port, cache, '/dosyalar?q=PG')
    await findRow('34 PG 1')
    await userEvent.selectOptions(screen.getByLabelText('Dosya türü'), 'Kasko')
    await findRow('34 PG 1')
    await userEvent.click(screen.getByRole('button', { name: 'Daha fazla dosya yükle' }))
    await findRow('34 PG 80')
    await userEvent.click(document.querySelectorAll('tbody tr')[79])
    const scroller = screen.getByLabelText('Dosya listesi')
    fireEvent.scroll(scroller, { target: { scrollTop: 1234, scrollLeft: 240 } })
    await userEvent.click(screen.getByRole('button', { name: 'Tam Dosyayı Aç' }))
    expect(await screen.findByText('Gercek dosya detayi hedefi')).toBeInTheDocument()
    const before = queries.length
    await userEvent.click(screen.getByRole('button', { name: 'Listeye dön' }))
    await waitFor(() => expect(queries.length).toBe(before + 2))
    await findRow('34 PG 100')
    expect(screen.getByLabelText('Dosya türü')).toHaveValue('Kasko')
    expect(screen.getByPlaceholderText(/Plaka, dosya no/)).toHaveValue('PG')
    expect(document.querySelectorAll('tbody tr')[79]).toHaveClass('is-selected')
    expect(screen.getByLabelText('Dosya listesi').scrollTop).toBe(1234)
    expect(screen.getByLabelText('Dosya listesi').scrollLeft).toBe(240)
    expect(queries.slice(-2).map(query => query.page)).toEqual([1, 2])
    expect(queries.at(-1)?.search).toBe('PG')
  })

  it('takes a fresh global search from the URL instead of restoring a locally edited old query', async () => {
    const { port, queries } = stubCasesPort()
    renderPage(port, stubAlertPort().port, createCaseListCache(), '/dosyalar?q=PG')
    await findRow('34 PG 1')
    await userEvent.selectOptions(screen.getByLabelText('Dosya türü'), 'Kasko')
    await userEvent.type(screen.getByPlaceholderText(/Plaka, dosya no/), ' local')
    await findRow('34 PG 1')
    await userEvent.click(screen.getByRole('button', { name: 'Tam Dosyayı Aç' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Yeni global arama' }))
    await findRow('34 PG 1')
    expect(screen.getByPlaceholderText(/Plaka, dosya no/)).toHaveValue('PG')
    expect(screen.getByLabelText('Dosya türü')).toHaveValue('Tümü')
    expect(queries.at(-1)).toMatchObject({ page: 1, search: 'PG' })
    expect(queries.at(-1)?.caseType).toBeUndefined()
  })

  it('loads alert summaries past 100 rows in bounded groups and reuses unchanged groups', async () => {
    const { port } = stubCasesPort()
    const alerts = stubAlertPort()
    renderPage(port, alerts.port)
    await screen.findByText('34 PG 50 için açık operasyonel uyarı yok')
    await userEvent.click(screen.getByRole('button', { name: 'Daha fazla dosya yükle' }))
    await screen.findByText('34 PG 100 için açık operasyonel uyarı yok')
    await userEvent.click(screen.getByRole('button', { name: 'Daha fazla dosya yükle' }))
    await screen.findByText('34 PG 137 için açık operasyonel uyarı yok')
    expect(alerts.requested.map(ids => ids.length)).toEqual([50, 100, 37])
    expect(screen.queryByText(/uyarı durumu bilinmiyor/)).not.toBeInTheDocument()
  })

  it('clears the list on session expiry during an append', async () => {
    const { port } = stubCasesPort()
    const original = port.listCasePage
    port.listCasePage = async query => { if (query.page > 1) throw new HttpCasesError('unauthorized', 'synthetic'); return original(query) }
    renderPage(port)
    await findRow('34 PG 1')
    await userEvent.click(screen.getByRole('button', { name: 'Daha fazla dosya yükle' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Yeniden giriş yapın')
    expect(rowPlates()).toHaveLength(0)
  })

  it('does not show stale or mock records when the initial request fails', async () => {
    const { port } = stubCasesPort()
    port.listCasePage = async () => { throw new HttpCasesError('unavailable', 'synthetic') }
    renderPage(port)
    expect(await screen.findByRole('alert')).toHaveTextContent('Dosyalar yüklenemedi')
    expect(rowPlates()).toHaveLength(0)
    expect(screen.queryByText('34 MPA 764')).not.toBeInTheDocument()
  })
})
