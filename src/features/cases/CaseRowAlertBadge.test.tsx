import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DATA_SOURCE_STORAGE_KEY,
  OperationalAlertError,
  useCases,
  type CasesDataStatus,
  type OperationalAlertCaseSummaryRecord,
  type OperationalAlertDataPort,
} from '../../data'
import { CasesPage } from './CasesPage'

vi.mock('../../data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data')>()
  return { ...actual, useCases: vi.fn() }
})

const mockedUseCases = vi.mocked(useCases)

const CASE_A = '11111111-1111-4111-8111-111111111111'
const CASE_B = '22222222-2222-4222-8222-222222222222'
const CASE_C = '33333333-3333-4333-8333-333333333333'

function caseRecord(caseId: string, plate: string, sequence: number, company = 'Sentetik Sigorta') {
  return {
    caseId,
    plate,
    officeNumber: `2026/${sequence}`,
    noticeNumber: `IH-${sequence}`,
    claimNumber: `HS-${sequence}`,
    company,
    // Mock modda QuickDetail zaman çizelgesi ve tutar alanlarını kullanır.
    notes: [],
    estimatedDamage: 0,
    type: 'Trafik' as const,
    status: 'Devam Ediyor',
    stage: 'Rapor',
    missingDocuments: 0,
    assignee: 'Sentetik Sorumlu',
    expert: 'Sentetik Eksper',
    service: 'Sentetik Servis',
    vehicle: 'Sentetik Araç',
    insured: 'Sentetik Sigortalı',
    followUp: '18 Tem',
    followUpTone: 'normal',
    lastAction: '18 Tem',
  }
}

const CASES = [
  caseRecord(CASE_A, '34 PT 1', 1),
  // Yalnız bu satıra uyan benzersiz bir arama terimi taşır.
  caseRecord(CASE_B, '34 PT 2', 2, 'Benzersizsigorta'),
  caseRecord(CASE_C, '34 PT 3', 3),
]

function summary(caseId: string, byType: Partial<OperationalAlertCaseSummaryRecord['byType']>) {
  const full = { overdue_task: 0, overdue_follow_up: 0, missing_required_document: 0, ...byType }
  return {
    caseId,
    totalCount: full.overdue_task + full.overdue_follow_up + full.missing_required_document,
    byType: full,
  }
}

function stubPort(summaries: readonly OperationalAlertCaseSummaryRecord[]) {
  const requestedCaseIds: string[][] = []
  const port: OperationalAlertDataPort = {
    list: async (caseIds) => {
      requestedCaseIds.push([...(caseIds ?? [])])
      return {
        schemaVersion: 'operational-alert/1.0.0',
        totalCount: 0,
        evaluatedAt: '2026-07-18T10:30:00.000Z',
        alerts: [],
        caseSummaries: summaries,
      }
    },
  }
  return { port, requestedCaseIds }
}

function renderPage(port?: OperationalAlertDataPort) {
  return render(
    <MemoryRouter initialEntries={['/dosyalar']}>
      <Routes>
        <Route path="/dosyalar" element={<CasesPage alertPort={port} />} />
        <Route path="/dosyalar/:caseId" element={<div>Gerçek dosya detayı hedefi</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
  mockedUseCases.mockReturnValue({
    cases: CASES,
    source: 'api',
    status: 'ok' as CasesDataStatus,
    reload: vi.fn(),
  } as ReturnType<typeof useCases>)
})

afterEach(() => {
  window.localStorage.clear()
  vi.clearAllMocks()
})

describe('Dosya satırı uyarı göstergesi', () => {
  it('satırda toplam uyarı sayısını ve tür ayrımını gösterir', async () => {
    const { port } = stubPort([
      summary(CASE_A, { overdue_task: 1, overdue_follow_up: 1, missing_required_document: 2 }),
      summary(CASE_B, {}),
      summary(CASE_C, { missing_required_document: 3 }),
    ])
    renderPage(port)

    const badge = await screen.findByRole('button', { name: /34 PT 1: 4 operasyonel uyarı/ })
    expect(badge).toHaveAccessibleName(/1 geciken görev · 1 geciken takip · 2 eksik evrak/)
    expect(screen.getByRole('button', { name: /34 PT 3: 3 operasyonel uyarı/ }))
      .toHaveAccessibleName(/3 eksik evrak/)
  })

  it('uyarısı olmayan satırda dikkat çekici rozet göstermez', async () => {
    const { port } = stubPort([
      summary(CASE_A, { overdue_task: 1 }),
      summary(CASE_B, {}),
      summary(CASE_C, {}),
    ])
    renderPage(port)

    await screen.findByRole('button', { name: /34 PT 1: 1 operasyonel uyarı/ })
    expect(screen.queryByRole('button', { name: /34 PT 2: .* operasyonel uyarı/ })).not.toBeInTheDocument()
    expect(screen.getByText('34 PT 2 için açık operasyonel uyarı yok')).toBeInTheDocument()
  })

  it('rozet tıklanınca dosya detayına gider', async () => {
    const { port } = stubPort([summary(CASE_A, { overdue_task: 2 })])
    renderPage(port)

    await userEvent.click(await screen.findByRole('button', { name: /34 PT 1: 2 operasyonel uyarı/ }))
    expect(screen.getByText('Gerçek dosya detayı hedefi')).toBeInTheDocument()
  })

  it('özet dönmeyen satır "uyarı yok" değil "bilinmiyor" gösterilir', async () => {
    // CASE_B ve CASE_C için özet gelmedi (erişilemez/kapsam dışı).
    const { port } = stubPort([summary(CASE_A, { overdue_task: 1 })])
    renderPage(port)

    await screen.findByRole('button', { name: /34 PT 1: 1 operasyonel uyarı/ })
    expect(screen.getByText('34 PT 2 uyarı durumu bilinmiyor')).toBeInTheDocument()
    expect(screen.queryByText('34 PT 2 için açık operasyonel uyarı yok')).not.toBeInTheDocument()
  })

  it('hata halinde tüm satırlar uyarısız gösterilmez', async () => {
    const port: OperationalAlertDataPort = {
      list: async () => { throw new OperationalAlertError('unavailable', 'test') },
    }
    renderPage(port)

    await waitFor(() => {
      expect(screen.getByText(/Uyarı göstergesi yüklenemedi/)).toBeInTheDocument()
    })
    for (const plate of ['34 PT 1', '34 PT 2', '34 PT 3']) {
      expect(screen.getByText(`${plate} uyarı durumu bilinmiyor`)).toBeInTheDocument()
      expect(screen.queryByText(`${plate} için açık operasyonel uyarı yok`)).not.toBeInTheDocument()
    }
  })

  it('yalnız görünür satırlar sorulur ve filtre değişince yeniden yüklenir', async () => {
    const { port, requestedCaseIds } = stubPort([summary(CASE_A, { overdue_task: 1 })])
    renderPage(port)

    await waitFor(() => expect(requestedCaseIds).toHaveLength(1))
    expect(requestedCaseIds[0]).toEqual([CASE_A, CASE_B, CASE_C])

    // Arama filtresi görünür satır kümesini daraltır.
    await userEvent.type(screen.getByPlaceholderText(/Plaka, dosya no/), 'Benzersizsigorta')
    await waitFor(() => expect(requestedCaseIds.length).toBeGreaterThan(1))
    expect(requestedCaseIds[requestedCaseIds.length - 1]).toEqual([CASE_B])
  })

  it('mock modda gerçek uyarı çağrısı yapılmaz ve sütun gösterilmez', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'mock')
    mockedUseCases.mockReturnValue({
      cases: CASES,
      source: 'mock',
      status: 'ok' as CasesDataStatus,
      reload: vi.fn(),
    } as ReturnType<typeof useCases>)
    const { port, requestedCaseIds } = stubPort([summary(CASE_A, { overdue_task: 1 })])
    renderPage(port)

    // Plaka hem satırda hem hızlı detayda görünür; varlığı yeterlidir.
    await waitFor(() => expect(screen.getAllByText('34 PT 1').length).toBeGreaterThan(0))
    expect(requestedCaseIds).toHaveLength(0)
    expect(screen.queryByRole('columnheader', { name: 'Uyarı' })).not.toBeInTheDocument()
  })
})
