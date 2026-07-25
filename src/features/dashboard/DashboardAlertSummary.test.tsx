import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DATA_SOURCE_STORAGE_KEY,
  OperationalAlertError,
  buildMockDashboard,
  useDashboard,
  type OperationalAlertDataPort,
  type OperationalAlertRecord,
} from '../../data'
import { DashboardPage } from './DashboardPage'

vi.mock('../../data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data')>()
  return { ...actual, useDashboard: vi.fn() }
})

const mockedUseDashboard = vi.mocked(useDashboard)

const CASE_A = '11111111-1111-4111-8111-111111111111'
const CASE_B = '22222222-2222-4222-8222-222222222222'

function alert(overrides: Partial<OperationalAlertRecord> = {}): OperationalAlertRecord {
  return {
    dedupeKey: `overdue_task:${CASE_A}:task-1`,
    type: 'overdue_task',
    severity: 'high',
    caseId: CASE_A,
    plate: '34 P 4951',
    officeNumber: '2026/4951',
    summary: 'Süresi geçmiş görev: Servisten onay al',
    sourceDate: '2026-07-12',
    caseDetailPath: `/dosyalar/${CASE_A}`,
    ...overrides,
  }
}

const ALERTS: readonly OperationalAlertRecord[] = [
  alert(),
  alert({
    dedupeKey: `missing_required_document:${CASE_B}:victim_traffic_policy`,
    type: 'missing_required_document',
    caseId: CASE_B,
    plate: '34 P 4952',
    officeNumber: '2026/4952',
    summary: 'Eksik zorunlu evrak: Mağdur trafik poliçesi',
    sourceDate: '2026-07-18',
    caseDetailPath: `/dosyalar/${CASE_B}`,
  }),
  alert({
    dedupeKey: `missing_required_document:${CASE_B}:accident_report`,
    type: 'missing_required_document',
    caseId: CASE_B,
    plate: '34 P 4952',
    officeNumber: '2026/4952',
    summary: 'Eksik zorunlu evrak: Zabıt',
    sourceDate: '2026-07-18',
    caseDetailPath: `/dosyalar/${CASE_B}`,
  }),
  alert({
    dedupeKey: `overdue_follow_up:${CASE_A}`,
    type: 'overdue_follow_up',
    severity: 'medium',
    summary: 'Takip tarihi geçti',
    sourceDate: '2026-07-10',
  }),
]

function stubPort(alerts: readonly OperationalAlertRecord[], totalCount = alerts.length) {
  let calls = 0
  const port: OperationalAlertDataPort = {
    list: async () => {
      calls += 1
      return {
        schemaVersion: 'operational-alert/1.0.0',
        totalCount,
        evaluatedAt: '2026-07-18T10:30:00.000Z',
        alerts,
      }
    },
  }
  return { port, callCount: () => calls }
}

function renderDashboard(port?: OperationalAlertDataPort) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<DashboardPage alertPort={port} />} />
        <Route path="/bildirimler" element={<div>Bildirimler ekranı hedefi</div>} />
        <Route path="/dosyalar/:caseId" element={<div>Gerçek dosya detayı hedefi</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
  mockedUseDashboard.mockReturnValue({
    dashboard: buildMockDashboard(),
    source: 'api',
    status: 'ok',
    reload: vi.fn(),
  })
})

afterEach(() => {
  window.localStorage.clear()
})

describe('Durum Panosu operasyonel uyarı özeti', () => {
  it('toplam sayacı API totalCount değerinden gösterir', async () => {
    // Liste kırpılmış olsa bile sayaç API'nin bildirdiği toplamdan gelir.
    const { port } = stubPort(ALERTS, 4)
    renderDashboard(port)

    const total = await screen.findByRole('button', { name: /4 açık operasyonel uyarı/ })
    expect(total).toBeInTheDocument()
  })

  it('tür bazında özet gösterir', async () => {
    const { port } = stubPort(ALERTS)
    renderDashboard(port)

    expect(await screen.findByRole('button', { name: 'Geciken görev: 1. Bildirimler ekranını aç.' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Geciken takip: 1. Bildirimler ekranını aç.' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Eksik zorunlu evrak: 2. Bildirimler ekranını aç.' })).toBeInTheDocument()
  })

  it('yalnız ilk birkaç kritik uyarıyı render eder, tam listeyi değil', async () => {
    const many = Array.from({ length: 200 }, (_unused, index) => alert({
      dedupeKey: `overdue_task:${CASE_A}:task-${index}`,
      summary: `Süresi geçmiş görev: Görev ${index}`,
    }))
    const { port } = stubPort(many)
    renderDashboard(port)

    await screen.findByText('Süresi geçmiş görev: Görev 0')
    const preview = screen.getByRole('list', { name: 'Öne çıkan uyarılar' })
    expect(preview.querySelectorAll('li')).toHaveLength(3)
    expect(screen.queryByText('Süresi geçmiş görev: Görev 3')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Tüm uyarıları gör \(200\)/ })).toBeInTheDocument()
  })

  it('toplam rozeti tıklanınca Bildirimler ekranına gider', async () => {
    const { port } = stubPort(ALERTS)
    renderDashboard(port)

    await userEvent.click(await screen.findByRole('button', { name: /4 açık operasyonel uyarı/ }))
    expect(screen.getByText('Bildirimler ekranı hedefi')).toBeInTheDocument()
  })

  it('tür kartı tıklanınca Bildirimler ekranına gider', async () => {
    const { port } = stubPort(ALERTS)
    renderDashboard(port)

    await userEvent.click(await screen.findByRole('button', { name: /Eksik zorunlu evrak: 2/ }))
    expect(screen.getByText('Bildirimler ekranı hedefi')).toBeInTheDocument()
  })

  it('öne çıkan uyarı tıklanınca dosya detayına gider', async () => {
    const { port } = stubPort(ALERTS)
    renderDashboard(port)

    await userEvent.click(await screen.findByText('Süresi geçmiş görev: Servisten onay al'))
    expect(screen.getByText('Gerçek dosya detayı hedefi')).toBeInTheDocument()
  })

  it('uyarı yoksa nötr boş durum gösterir', async () => {
    const { port } = stubPort([])
    renderDashboard(port)

    expect(await screen.findByText('Açık operasyonel uyarı yok.')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Öne çıkan uyarılar' })).not.toBeInTheDocument()
    expect(screen.queryByText('Operasyonel uyarılar alınamadı')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Bildirimleri aç/ }))
    expect(screen.getByText('Bildirimler ekranı hedefi')).toBeInTheDocument()
  })

  it('hata halinde sıfır göstermez; açık hata durumu render eder', async () => {
    const port: OperationalAlertDataPort = {
      list: async () => { throw new OperationalAlertError('unavailable', 'test') },
    }
    renderDashboard(port)

    expect(await screen.findByText('Operasyonel uyarılar alınamadı')).toBeInTheDocument()
    expect(screen.queryByText('Açık operasyonel uyarı yok.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /0 açık operasyonel uyarı/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Geciken görev: 0/ })).not.toBeInTheDocument()
  })

  it('oturum hatasında da sıfır göstermez', async () => {
    const port: OperationalAlertDataPort = {
      list: async () => { throw new OperationalAlertError('unauthorized', 'test') },
    }
    renderDashboard(port)

    expect(await screen.findByText('Operasyonel uyarılar alınamadı')).toBeInTheDocument()
    expect(screen.getByText(/yeniden giriş yapın/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /açık operasyonel uyarı/ })).not.toBeInTheDocument()
  })

  it('aynı veri için tek istek yapar; mükerrer çağrı oluşmaz', async () => {
    const { port, callCount } = stubPort(ALERTS)
    renderDashboard(port)

    await screen.findByRole('button', { name: /4 açık operasyonel uyarı/ })
    await waitFor(() => expect(callCount()).toBe(1))
    expect(callCount()).toBe(1)
  })

  it('mock modda uyarı özeti gösterilmez ve API çağrılmaz', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'mock')
    mockedUseDashboard.mockReturnValue({
      dashboard: buildMockDashboard(),
      source: 'mock',
      status: 'ok',
      reload: vi.fn(),
    })
    const { port, callCount } = stubPort(ALERTS)
    renderDashboard(port)

    expect(screen.queryByLabelText('Operasyonel uyarı özeti')).not.toBeInTheDocument()
    expect(screen.queryByText('Açık operasyonel uyarı yok.')).not.toBeInTheDocument()
    await waitFor(() => expect(callCount()).toBe(0))
  })
})
