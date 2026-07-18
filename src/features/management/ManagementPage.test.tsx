import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DATA_SOURCE_STORAGE_KEY, ReferenceDataError, type CaseReferenceDataPort } from '../../data'
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
    await waitFor(() => expect(port.getCaseReferences).not.toHaveBeenCalled())
  })

  it('kural ve yetki bölümleri her iki modda kilitli proje kuralı olarak kalır', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    render(<ManagementPage port={makePort()} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Belge Kuralları' }))
    expect(screen.getByText('Yalnız iki dosya türü vardır')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Erişim ve Yetki' }))
    expect(screen.getByText('AI Güvenlik Sınırı')).toBeInTheDocument()
  })
})
