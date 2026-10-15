import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { OperationalAlertError, type OperationalAlertDataPort, type OperationalAlertRecord, type OperationalAlertsRecord } from '../../data/operationalAlertPort'
import { DATA_SOURCE_STORAGE_KEY } from '../../data/ports'
import { initialNotifications } from '../../mocks/workspaces'
import { NotificationsPage } from './NotificationsPage'

const CASE_ID = '11111111-1111-4111-8111-111111111111'

const overdueTask: OperationalAlertRecord = {
  dedupeKey: `overdue_task:${CASE_ID}:task-1`,
  type: 'overdue_task',
  severity: 'high',
  caseId: CASE_ID,
  plate: '34 P 4902',
  officeNumber: '2026/4902',
  summary: 'Süresi geçmiş görev: Servisten onay al',
  sourceDate: '2026-07-12',
  caseDetailPath: `/dosyalar/${CASE_ID}`,
}

const missingDocument: OperationalAlertRecord = {
  dedupeKey: `missing_required_document:${CASE_ID}:accident_report`,
  type: 'missing_required_document',
  severity: 'high',
  caseId: CASE_ID,
  plate: '34 P 4903',
  officeNumber: '2026/4903',
  summary: 'Eksik zorunlu evrak: Zabıt',
  sourceDate: '2026-07-18',
  caseDetailPath: `/dosyalar/${CASE_ID}`,
}

function stubPort(alerts: readonly OperationalAlertRecord[]): OperationalAlertDataPort {
  const record: OperationalAlertsRecord = {
    schemaVersion: 'operational-alert/1.0.0',
    totalCount: alerts.length,
    evaluatedAt: '2026-07-18T10:30:00.000Z',
    alerts,
  }
  return { list: async () => record }
}

function failingPort(kind: 'unavailable' | 'unauthorized'): OperationalAlertDataPort {
  return { list: async () => { throw new OperationalAlertError(kind, 'test') } }
}

function renderPage(port?: OperationalAlertDataPort) {
  return render(<MemoryRouter><NotificationsPage port={port} /></MemoryRouter>)
}

afterEach(() => {
  window.localStorage.clear()
})

describe('NotificationsPage gerçek operasyonel uyarılar', () => {
  it('API modunda uyarıları tür, önem, dosya ve kaynak tarihiyle listeler', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    renderPage(stubPort([overdueTask, missingDocument]))

    expect(await screen.findByText('Süresi geçmiş görev: Servisten onay al')).toBeInTheDocument()
    expect(screen.getByText('Eksik zorunlu evrak: Zabıt')).toBeInTheDocument()
    expect(screen.getByText('Geciken Görev · Öncelikli')).toBeInTheDocument()
    expect(screen.getByText('12 Temmuz 2026')).toHaveAttribute('datetime', '2026-07-12')
    expect(screen.getByText('34 P 4902')).toBeInTheDocument()
    expect(screen.getByText('2026/4903')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /dosyasına git/ })).toHaveLength(2)
  })

  it('sayaç yalnız API sonucundan hesaplanır', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    renderPage(stubPort([overdueTask, missingDocument]))
    expect(await screen.findByText('2 okunmamış uyarı')).toBeInTheDocument()
  })

  it('boş sonuç gerçek boş durum olarak gösterilir', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    const { container } = renderPage(stubPort([]))

    expect(await screen.findByText('Okunmamış operasyonel uyarı yok.')).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(container.textContent ?? '').not.toContain(initialNotifications[0].title)
  })

  it('API kapalıyken mock fallback yapmaz', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    const { container } = renderPage(failingPort('unavailable'))

    expect(await screen.findByText('Operasyonel uyarılar şu anda alınamıyor.')).toBeInTheDocument()
    const markup = container.textContent ?? ''
    for (const item of initialNotifications) {
      expect(markup).not.toContain(item.title)
      expect(markup).not.toContain(item.detail)
      expect(markup).not.toContain(item.plate)
    }
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('oturum hatasında da örnek kayda düşmez', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    const { container } = renderPage(failingPort('unauthorized'))

    await waitFor(() => {
      expect(screen.getByText('Operasyonel uyarılar şu anda alınamıyor.')).toBeInTheDocument()
    })
    expect(container.textContent ?? '').not.toContain(initialNotifications[0].title)
  })

  it('okundu/ertelendi gibi kullanıcı durumu kontrolü sunmaz', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    renderPage(stubPort([overdueTask]))

    await screen.findByText(overdueTask.summary)
    expect(screen.getByRole('button', { name: /Tümünü Okundu İşaretle/ })).toBeDisabled()
    expect(screen.queryByLabelText('Bildirim okuma durumu')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Okunmamış')).not.toBeInTheDocument()
  })

  it('tür filtresi yalnız seçilen uyarı türünü gösterir', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    const { default: userEvent } = await import('@testing-library/user-event')
    renderPage(stubPort([overdueTask, missingDocument]))

    await screen.findByText(overdueTask.summary)
    await userEvent.selectOptions(screen.getByLabelText('Uyarı türü'), 'missing_required_document')
    expect(screen.queryByText(overdueTask.summary)).not.toBeInTheDocument()
    expect(screen.getByText(missingDocument.summary)).toBeInTheDocument()
    expect(screen.getByText('1 uyarı gösteriliyor')).toBeInTheDocument()
  })
})

describe('NotificationsPage veri kaynağı ayrımı', () => {
  it('acknowledges all warnings, refreshes the count and prevents double submission', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    const port = stubPort([overdueTask, missingDocument])
    let finish!: () => void
    port.markAllRead = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    renderPage(port)
    const button = await screen.findByRole('button', { name: 'Tümünü Okundu İşaretle' })
    await userEvent.dblClick(button)
    expect(port.markAllRead).toHaveBeenCalledOnce()
    port.list = async () => ({ schemaVersion: 'operational-alert/1.0.0', totalCount: 0, evaluatedAt: '2026-07-18T10:30:00.000Z', alerts: [] })
    finish()
    await screen.findByText('0 okunmamış uyarı')
    expect(screen.queryByText(overdueTask.summary)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tümünü Okundu İşaretle' })).toBeDisabled()
  })
  it('retains warnings and allows retry when read acknowledgement fails', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    const port = stubPort([overdueTask])
    port.markAllRead = vi.fn(async () => { throw new Error('offline') })
    renderPage(port)
    await userEvent.click(await screen.findByRole('button', { name: 'Tümünü Okundu İşaretle' }))
    await screen.findByRole('alert')
    expect(screen.getByText(overdueTask.summary)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tümünü Okundu İşaretle' })).toBeEnabled()
  })
  it('API modunda hiçbir örnek bildirim DOM\'a girmez', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    const { container } = renderPage(stubPort([overdueTask]))

    await screen.findByText(overdueTask.summary)
    const markup = container.textContent ?? ''
    for (const item of initialNotifications) {
      expect(markup).not.toContain(item.title)
      expect(markup).not.toContain(item.detail)
      expect(markup).not.toContain(item.plate)
      expect(markup).not.toContain(item.officeNumber)
    }
  })

  it('mock modda prototip bildirim listesi korunur ve API çağrılmaz', () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'mock')
    let called = false
    renderPage({ list: async () => { called = true; throw new Error('unexpected') } })

    expect(screen.getByRole('list')).toBeInTheDocument()
    expect(screen.getByText(initialNotifications[0].title)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Tümünü Okundu İşaretle/ })).toBeInTheDocument()
    expect(called).toBe(false)
  })
})
