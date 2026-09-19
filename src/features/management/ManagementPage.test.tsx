import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DATA_SOURCE_STORAGE_KEY, type CaseReferenceDataPort } from '../../data/ports'
import { ReferenceDataError } from '../../data/referenceHttpAdapter'
import { SessionContext, type SessionContextValue } from '../../app/sessionContext'
import type { UserSummaryRecord, UsersDataPort } from '../../data/usersPort'
import type { V1ImportQuarantineDataPort } from '../../data/v1ImportQuarantinePort'
import { ManagementPage } from './ManagementPage'

const references = {
  insurers: [{ id: 'ins-1', name: 'Sentetik Sigorta' }],
  services: [
    {
      id: 'srv-1',
      name: 'Gerçek Yetkili Servis',
      serviceType: 'authorized' as const,
      isActive: true,
      agreement: {
        status: 'eligible' as const,
        agreementStatus: 'agreed' as const,
        serviceType: 'authorized' as const,
        operation: 'closure_documents' as const,
        evaluationDate: '2026-07-18',
        dateSource: 'loss_date' as const,
        isAuthorized: true,
        isInsurerAgreed: true,
        reason: 'Anlaşma kaydı doğrulandı.',
        ruleVersion: '2026.07.14.1',
        matchedAgreementIds: [],
        requiresHumanReview: false,
      },
    },
  ],
  users: [
    { id: 'usr-1', displayName: 'Gerçek Eksper' },
    { id: 'usr-2', displayName: 'Gerçek Sorumlu' },
  ],
  experts: [{ id: 'usr-1', displayName: 'Gerçek Eksper' }],
}

function makePort(overrides: Partial<CaseReferenceDataPort> = {}): CaseReferenceDataPort {
  return {
    getCaseReferences: vi.fn().mockResolvedValue(references),
    ...overrides,
  } as CaseReferenceDataPort
}

afterEach(() => {
  window.localStorage.clear()
})

describe('ManagementPage', () => {
  it('API modunda gerçek kullanıcı ve servis verisini gösterir; mock kayıt sızdırmaz', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    render(<ManagementPage port={makePort()} />)
    const user = userEvent.setup()

    expect(await screen.findByText('Gerçek Eksper')).toBeInTheDocument()
    expect(screen.getByText('Gerçek Sorumlu')).toBeInTheDocument()
    // Mock kullanıcılar API modunda görünmez.
    expect(screen.queryByText('Ömer Faruk Kaya')).not.toBeInTheDocument()
    // Eksper rolü referans verisinden türetilir.
    expect(screen.getByText('Eksper')).toBeInTheDocument()
    expect(screen.getByText('Eksper değil')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Servisler' }))
    expect(await screen.findByText('Gerçek Yetkili Servis')).toBeInTheDocument()
    expect(screen.getByText('Yetkili')).toBeInTheDocument()
    expect(screen.getByText('Anlaşmalı')).toBeInTheDocument()
    expect(screen.queryByText('Akşam Otomotiv')).not.toBeInTheDocument()
    // Gerçek sözleşmede karşılığı olmayan mock sütunları gösterilmez.
    expect(screen.queryByText('Telefon')).not.toBeInTheDocument()
    expect(screen.queryByText('Açık Dosya')).not.toBeInTheDocument()
  })

  it('API modunda servis hatasında mock fallback yapmaz', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    const port = makePort({
      getCaseReferences: vi.fn().mockRejectedValue(new ReferenceDataError('unavailable', 'down')),
    })
    render(<ManagementPage port={port} />)
    expect(await screen.findByText(/mock fallback yapılmadı/)).toBeInTheDocument()
    expect(screen.queryByText('Ömer Faruk Kaya')).not.toBeInTheDocument()
  })

  it('oturum yoksa mock kayıt göstermez', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    const port = makePort({
      getCaseReferences: vi.fn().mockRejectedValue(new ReferenceDataError('unauthorized', 'no session')),
    })
    render(<ManagementPage port={port} />)
    expect(await screen.findByText(/Oturum gerekli/)).toBeInTheDocument()
    expect(screen.queryByText('Ömer Faruk Kaya')).not.toBeInTheDocument()
  })

  it('mock modda prototip listesi korunur ve referans servisi çağrılmaz', async () => {
    const port = makePort()
    render(<ManagementPage port={port} />)
    expect(await screen.findByText('Ömer Faruk Kaya')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Excel Şablonları' })).not.toBeInTheDocument()
    await waitFor(() => expect(port.getCaseReferences).not.toHaveBeenCalled())
  })

  it('kural ve yetki bölümleri her iki modda kilitli proje kuralı olarak kalır', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    render(<ManagementPage port={makePort()} />)
    expect(screen.queryByRole('button', { name: 'Excel Şablonları' })).not.toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Belge Kuralları' }))
    expect(screen.getByText('Yalnız iki dosya türü vardır')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Erişim ve Yetki' }))
    expect(screen.getByText('AI Güvenlik Sınırı')).toBeInTheDocument()
  })
})

describe('ManagementPage — HB-011 gerçek rol ataması (yalnız admin)', () => {
  function adminSession(): SessionContextValue {
    return {
      mode: 'api',
      status: 'authenticated',
      user: { id: 'admin-1', organizationId: 'org-1', email: 'admin@baran.example', displayName: 'Admin', roles: ['admin'] },
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
      user: { id: 'expert-1', organizationId: 'org-1', email: 'expert@baran.example', displayName: 'Eksper', roles: ['expert'] },
      notice: null,
      login: vi.fn(),
      logout: vi.fn(),
      reportUnauthorized: vi.fn(),
    }
  }

  const users: readonly UserSummaryRecord[] = [
    { id: 'usr-1', email: 'sekreter@baran.example', displayName: 'Sekreter Kullanıcı', status: 'active', roles: ['secretary'], version: 1 },
  ]

  function makeUsersPort(overrides: Partial<UsersDataPort> = {}): UsersDataPort {
    return {
      list: vi.fn().mockResolvedValue(users),
      updateRoles: vi.fn().mockResolvedValue({ ...users[0], roles: ['secretary', 'expert'], version: 2 }),
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
        <ManagementPage port={makePort()} usersPort={usersPort} />
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

  it('admin olmayan oturumda mevcut salt-okunur referans görünümü değişmeden kalır', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    const usersPort = makeUsersPort()
    render(
      <SessionContext.Provider value={expertSession()}>
        <ManagementPage port={makePort()} usersPort={usersPort} />
      </SessionContext.Provider>,
    )

    expect(await screen.findByText('Gerçek Eksper')).toBeInTheDocument()
    expect(screen.queryByText('Kullanıcı ve Rol Yönetimi')).not.toBeInTheDocument()
    expect(usersPort.list).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'V1 Aktarım Karantinası' })).not.toBeInTheDocument()
  })

  it('admin karantina sekmesinde 5 kaydi salt-okunur ve kompakt gorur', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    const quarantinePort = makeQuarantinePort()
    const user = userEvent.setup()
    render(
      <SessionContext.Provider value={adminSession()}>
        <ManagementPage port={makePort()} usersPort={makeUsersPort()} quarantinePort={quarantinePort} />
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
        <ManagementPage port={makePort()} usersPort={makeUsersPort()} quarantinePort={makeQuarantinePort([])} />
      </SessionContext.Provider>,
    )
    await user.click(screen.getByRole('button', { name: 'V1 Aktarım Karantinası' }))
    expect(await screen.findByText('Çözümlenmemiş V1 aktarım kaydı bulunmuyor.')).toBeInTheDocument()
  })
})
