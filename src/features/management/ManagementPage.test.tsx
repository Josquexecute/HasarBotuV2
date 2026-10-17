import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DATA_SOURCE_STORAGE_KEY } from '../../data/ports'
import { SessionContext, type SessionContextValue } from '../../app/sessionContext'
import type { UserSummaryRecord, UsersDataPort } from '../../data/usersPort'
import { UsersError } from '../../data/usersPort'
import type { V1ImportQuarantineDataPort } from '../../data/v1ImportQuarantinePort'
import { ManagementPage } from './ManagementPage'

afterEach(() => {
  window.localStorage.clear()
})

describe('ManagementPage access', () => {
  it.each(['expert','case_manager','secretary','accounting','read_only'])('blocks %s on direct navigation without making administrative requests', role => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    const list = vi.fn()
    render(<SessionContext.Provider value={{ mode: 'api', status: 'authenticated', user: { roles: [role] } } as unknown as SessionContextValue}><ManagementPage usersPort={{ list } as unknown as UsersDataPort} /></SessionContext.Provider>)
    expect(screen.getByRole('alert')).toHaveTextContent('yalnızca yöneticilere')
    expect(screen.queryByRole('navigation', { name: 'Yönetim bölümleri' })).not.toBeInTheDocument()
    expect(list).not.toHaveBeenCalled()
  })
  it('blocks an unidentified API session', () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    render(<ManagementPage />)
    expect(screen.getByRole('alert')).toHaveTextContent('yalnızca yöneticilere')
  })
  it('preserves the explicitly selected mock preview', () => {
    render(<ManagementPage />)
    expect(screen.getByText('Ömer Faruk Kaya')).toBeInTheDocument()
  })
})

describe('ManagementPage — HB-011 gerçek rol ataması (yalnız admin)', () => {
  function adminSession(): SessionContextValue {
    return {
      mode: 'api',
      status: 'authenticated',
      user: { id: 'admin-1', organizationId: 'org-1', email: 'admin@office.example', displayName: 'Admin', roles: ['admin'] },
      notice: null,
      login: vi.fn(),
      logout: vi.fn(),
      reportUnauthorized: vi.fn(),
    }
  }

  function expertSession(): SessionContextValue {
    return {
      mode: 'api',
      status: 'authenticated',
      user: { id: 'expert-1', organizationId: 'org-1', email: 'expert@office.example', displayName: 'Eksper', roles: ['expert'] },
      notice: null,
      login: vi.fn(),
      logout: vi.fn(),
      reportUnauthorized: vi.fn(),
    }
  }

  const users: readonly UserSummaryRecord[] = [
    { id: 'usr-1', email: 'sekreter@office.example', displayName: 'Sekreter Kullanıcı', status: 'active', roles: ['secretary'], version: 1 },
  ]

  function makeUsersPort(overrides: Partial<UsersDataPort> = {}): UsersDataPort {
    return {
      list: vi.fn().mockResolvedValue(users),
      create: vi.fn().mockResolvedValue({ id: 'usr-new', email: 'expert@example.test', displayName: 'Yeni Eksper', status: 'active', roles: ['expert'], version: 1 }),
      updateRoles: vi.fn().mockResolvedValue({ ...users[0], roles: ['secretary', 'expert'], version: 2 }),
      updateName: vi.fn().mockResolvedValue({ userId: users[0]!.id, displayName: 'Güncel Ad Soyad', version: 2 }),
      ...overrides,
    } as UsersDataPort
  }

  function makeQuarantinePort(items = Array.from({ length: 5 }, (_, index) => ({
    id: `11111111-1111-4111-8111-11111111111${index}`,
    sourceToken: `0123456789abcde${index}`,
    sourceRelativePath: `2026/Mayis/SENTETIK-Q-${index + 1}`,
    reason: 'ambiguous_target' as const,
    reasonCode: index < 3 ? 'case_type_conflict' : 'ambiguous_target',
    status: 'unresolved' as const,
    mappingVersion: 'v1-remediation/2.3.0',
    evidenceSummary: { detectedCaseType: null, resolutionReason: null, sidecarConflictPreserved: false, evidenceCount: 0, evidenceKinds: [] },
    candidateCount: 0,
    candidateTargets: [],
    createdAt: `2026-08-15T10:00:0${index}Z`,
    resolution: null,
  }))): V1ImportQuarantineDataPort {
    return {
      list: vi.fn().mockResolvedValue({ items, page: 1, pageSize: 100, totalItems: items.length, totalPages: items.length === 0 ? 0 : 1 }),
    }
  }

  it('admin oturumunda gerçek rol tablosu görünür ve rol değişikliği gerçek PATCH çağırır', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    const usersPort = makeUsersPort()
    const user = userEvent.setup()
    render(
      <SessionContext.Provider value={adminSession()}>
        <ManagementPage usersPort={usersPort} />
      </SessionContext.Provider>,
    )

    expect(await screen.findByText('Kullanıcı ve Rol Yönetimi')).toBeInTheDocument()
    expect(screen.getByText('Sekreter Kullanıcı')).toBeInTheDocument()
    // Referans-tabanlı salt-okunur görünüm ARTIK gösterilmez (admin gerçek yönetim görür).
    expect(screen.queryByText('Kullanıcı ve Sorumlu Listesi')).not.toBeInTheDocument()

    const expertCheckbox = screen.getByRole('checkbox', { name: 'Eksper' })
    expect(expertCheckbox).not.toBeChecked()
    await user.click(expertCheckbox)
    await user.click(screen.getByRole('button', { name: 'Kaydet' }))

    await waitFor(() => expect(usersPort.updateRoles).toHaveBeenCalledWith(
      'usr-1',
      { roles: expect.arrayContaining(['secretary', 'expert']), expectedVersion: 1 },
    ))
    expect(await screen.findByText('Roller güncellendi.')).toBeInTheDocument()
  })
  it('lets the administrator rename another user through the real profile port', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    const updated = { ...users[0]!, displayName: 'Güncel Ad Soyad', version: 2 }
    const port = makeUsersPort({ list: vi.fn().mockResolvedValueOnce(users).mockResolvedValue([updated]) })
    render(<SessionContext.Provider value={adminSession()}><ManagementPage usersPort={port} /></SessionContext.Provider>)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Sekreter Kullanıcı ad soyadını düzenle' }))
    const input = screen.getByLabelText('Ad Soyad: sekreter@office.example')
    await user.clear(input); await user.type(input, 'Güncel Ad Soyad')
    await user.click(screen.getByRole('button', { name: 'Ad Soyadı Kaydet' }))
    await waitFor(() => expect(port.updateName).toHaveBeenCalledWith('usr-1', { displayName: 'Güncel Ad Soyad', expectedVersion: 1 }))
    expect(await screen.findByText('Güncel Ad Soyad')).toBeInTheDocument()
    expect(port.updateRoles).not.toHaveBeenCalled()
  })

  it('admin manually creates a user with chosen roles and sees the persisted response', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    const usersPort = makeUsersPort()
    const user = userEvent.setup()
    render(<SessionContext.Provider value={adminSession()}><ManagementPage usersPort={usersPort} /></SessionContext.Provider>)
    await user.click(await screen.findByRole('button', { name: 'Kullanıcı Ekle' }))
    const form = within(screen.getByRole('form', { name: 'Yeni kullanıcı' }))
    expect(form.getByRole('button', { name: 'Kullanıcıyı Kaydet' })).toBeDisabled()
    await user.type(form.getByLabelText('Ad Soyad'), 'Yeni Eksper')
    await user.type(form.getByLabelText('Giriş E-postası'), 'expert@example.test')
    await user.type(form.getByLabelText(/Başlangıç Parolası/), 'sentetik-parola-25')
    await user.click(form.getByRole('checkbox', { name: 'Eksper' }))
    await user.click(form.getByRole('button', { name: 'Kullanıcıyı Kaydet' }))
    await waitFor(() => expect(usersPort.create).toHaveBeenCalledWith({ displayName: 'Yeni Eksper', email: 'expert@example.test', password: 'sentetik-parola-25', roles: ['expert'] }))
    expect(await screen.findByText('Yeni Eksper')).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Yeni kullanıcı' })).not.toBeInTheDocument()
    expect(screen.getByText(/Kullanıcı kaydedildi/)).toBeInTheDocument()
  })

  it('keeps the new-user draft and shows an actionable duplicate email error', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    const usersPort = makeUsersPort({ create: vi.fn().mockRejectedValue(new UsersError('email_in_use', 'duplicate')) })
    const user = userEvent.setup()
    render(<SessionContext.Provider value={adminSession()}><ManagementPage usersPort={usersPort} /></SessionContext.Provider>)
    await user.click(await screen.findByRole('button', { name: 'Kullanıcı Ekle' }))
    const form = within(screen.getByRole('form', { name: 'Yeni kullanıcı' }))
    await user.type(form.getByLabelText('Ad Soyad'), 'Yeni Eksper')
    await user.type(form.getByLabelText('Giriş E-postası'), 'existing@example.test')
    await user.type(form.getByLabelText(/Başlangıç Parolası/), 'sentetik-parola-25')
    await user.click(form.getByRole('checkbox', { name: 'Eksper' }))
    await user.click(form.getByRole('button', { name: 'Kullanıcıyı Kaydet' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Bu e-posta adresiyle bir kullanıcı zaten kayıtlı')
    expect(form.getByLabelText('Ad Soyad')).toHaveValue('Yeni Eksper')
    expect(form.getByLabelText('Giriş E-postası')).toHaveValue('existing@example.test')
    expect(screen.queryByText(/Kullanıcı kaydedildi/)).not.toBeInTheDocument()
  })

  it('blocks a non-admin from the whole management page', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    const usersPort = makeUsersPort()
    render(
      <SessionContext.Provider value={expertSession()}>
        <ManagementPage usersPort={usersPort} />
      </SessionContext.Provider>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('yalnızca yöneticilere')
    expect(screen.queryByText('Kullanıcı ve Rol Yönetimi')).not.toBeInTheDocument()
    expect(usersPort.list).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Kullanıcı Ekle' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'V1 Aktarım Karantinası' })).not.toBeInTheDocument()
  })

  it('admin karantina sekmesinde 5 kaydi salt-okunur ve kompakt gorur', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    const quarantinePort = makeQuarantinePort()
    const user = userEvent.setup()
    render(
      <SessionContext.Provider value={adminSession()}>
        <ManagementPage usersPort={makeUsersPort()} quarantinePort={quarantinePort} />
      </SessionContext.Provider>,
    )
    await user.click(screen.getByRole('button', { name: 'V1 Aktarım Karantinası' }))
    expect(await screen.findByText('5 çözümlenmemiş kaynak · salt okunur')).toBeInTheDocument()
    expect(screen.getAllByText('Hedef dosya belirsiz')).toHaveLength(5)
    expect(screen.getByText('2026/Mayis/SENTETIK-Q-1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /çöz|sil|düzenle/i })).not.toBeInTheDocument()
  })

  it('admin karantina sekmesinde bos durumu acikca gosterir', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    const user = userEvent.setup()
    render(
      <SessionContext.Provider value={adminSession()}>
        <ManagementPage usersPort={makeUsersPort()} quarantinePort={makeQuarantinePort([])} />
      </SessionContext.Provider>,
    )
    await user.click(screen.getByRole('button', { name: 'V1 Aktarım Karantinası' }))
    expect(await screen.findByText('Çözümlenmemiş V1 aktarım kaydı bulunmuyor.')).toBeInTheDocument()
  })
})
