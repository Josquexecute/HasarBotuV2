import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { SessionContext, type SessionContextValue } from '../app/sessionContext'
import { Sidebar } from './Sidebar'

function renderSidebar(overrides: Partial<SessionContextValue>) {
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
        <Sidebar collapsed={false} onToggle={vi.fn()} />
      </SessionContext.Provider>
    </MemoryRouter>,
  )
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
