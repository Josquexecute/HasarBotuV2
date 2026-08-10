import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionContext, type SessionContextValue } from '../app/sessionContext'
import type { OperationalAlertDataPort, OperationalAlertsRecord } from '../data/operationalAlertPort'
import { DATA_SOURCE_STORAGE_KEY } from '../data/ports'
import { Sidebar } from './Sidebar'

function renderSidebar(overrides: Partial<SessionContextValue>, operationalAlertPort?: OperationalAlertDataPort) {
  const value: SessionContextValue = {
    mode: 'api',
    status: 'authenticated',
    user: null,
    notice: null,
    login: vi.fn(),
    logout: vi.fn(),
    reportUnauthorized: vi.fn(),
    ...overrides,
  } as SessionContextValue
  return render(
    <MemoryRouter>
      <SessionContext.Provider value={value}>
        <Sidebar collapsed={false} onToggle={vi.fn()} operationalAlertPort={operationalAlertPort} />
      </SessionContext.Provider>
    </MemoryRouter>,
  )
}

function alertsOf(totalCount: number): OperationalAlertsRecord {
  return { schemaVersion: 'operational-alert/1.0.0', totalCount, evaluatedAt: '2026-08-10T00:00:00.000Z', alerts: [] }
}

function portReturning(record: OperationalAlertsRecord): OperationalAlertDataPort {
  return { list: vi.fn().mockResolvedValue(record) }
}

describe('Sidebar kullanıcı kartı', () => {
  it('gerçek oturumda kimliği ve rolü oturum verisinden gösterir', () => {
    renderSidebar({
      user: {
        id: 'usr-1',
        organizationId: 'org-1',
        email: 'gercek@test.local',
        displayName: 'Gerçek Kullanıcı',
        roles: ['expert', 'case_manager'],
      },
    })
    expect(screen.getByText('Gerçek Kullanıcı')).toBeInTheDocument()
    expect(screen.getByText('Eksper · Dosya Sorumlusu')).toBeInTheDocument()
    expect(screen.getByText('GK')).toBeInTheDocument()
    // API modunda sabit kodlu prototip kimliği gösterilmez.
    expect(screen.queryByText('Ömer Faruk Kaya')).not.toBeInTheDocument()
  })

  it('API modunda oturum yokken mock kimlik göstermez', () => {
    renderSidebar({ status: 'bootstrapping', user: null })
    expect(screen.getByText('Oturum bekleniyor')).toBeInTheDocument()
    expect(screen.queryByText('Ömer Faruk Kaya')).not.toBeInTheDocument()
  })

  it('mock modda prototip kimliği korunur', () => {
    renderSidebar({ mode: 'mock', status: 'mock', user: null })
    expect(screen.getByText('Ömer Faruk Kaya')).toBeInTheDocument()
    expect(screen.getByText('Eksper')).toBeInTheDocument()
  })

  it('bilinmeyen rol kodunda güvenli etiket kullanır', () => {
    renderSidebar({
      user: {
        id: 'usr-2',
        organizationId: 'org-1',
        email: 'x@test.local',
        displayName: 'Tek Ad',
        roles: ['unknown_role'],
      },
    })
    expect(screen.getByText('Kullanıcı')).toBeInTheDocument()
    expect(screen.getByText('TA')).toBeInTheDocument()
  })
})

describe('Sidebar Bildirimler rozeti', () => {
  afterEach(() => window.localStorage.clear())

  it('API modunda gerçek açık uyarı sayısını gösterir', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    renderSidebar({}, portReturning(alertsOf(3)))
    await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument())
  })

  it('gerçek uyarı sayısı sıfırken rozet göstermez -- sahte sabit sayı yok', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    const port = portReturning(alertsOf(0))
    renderSidebar({}, port)
    await waitFor(() => expect(port.list).toHaveBeenCalled())
    expect(screen.queryByText('7')).not.toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('mock modda rozet göstermez', () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'mock')
    renderSidebar({ mode: 'mock', status: 'mock', user: null })
    expect(screen.queryByText('7')).not.toBeInTheDocument()
  })
})
