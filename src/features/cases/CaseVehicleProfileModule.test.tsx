import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type {
  CaseVehicleProfileDataPort,
  CaseVehicleProfileRecord,
} from '../../data'
import { CaseVehicleProfileClientError } from '../../data'
import { CaseVehicleProfileModule } from './CaseVehicleProfileModule'

const CASE_ID = '018f3f4c-89ab-7def-8123-456789abcdef'
const PROFILE_ID = '018f3f4c-89ab-7def-8123-456789abcdf0'
const VERSION_ID = '018f3f4c-89ab-7def-8123-456789abcdf1'

const emptyRecord: CaseVehicleProfileRecord = {
  caseId: CASE_ID,
  profileId: null,
  version: null,
  current: null,
  history: [],
  permissions: { canEdit: true },
}

const savedRecord: CaseVehicleProfileRecord = {
  caseId: CASE_ID,
  profileId: PROFILE_ID,
  version: 1,
  current: {
    id: VERSION_ID,
    profileVersion: 1,
    revisionReason: null,
    createdAt: '2026-07-18T09:00:00.000Z',
    brand: 'Sentetik Marka',
    model: 'Örnek Model',
    modelYear: 2021,
    variant: null,
    vehicleClass: 'passenger_car',
    chassisPrefix: 'NM4BJ12',
    engineCode: 'K9K-628',
    evidenceSource: 'registration_document',
    evidenceReference: 'Ruhsat s.1',
  },
  history: [{
    id: VERSION_ID,
    profileVersion: 1,
    revisionReason: null,
    createdAt: '2026-07-18T09:00:00.000Z',
    brand: 'Sentetik Marka',
    model: 'Örnek Model',
    modelYear: 2021,
    variant: null,
    vehicleClass: 'passenger_car',
    chassisPrefix: 'NM4BJ12',
    engineCode: 'K9K-628',
    evidenceSource: 'registration_document',
    evidenceReference: 'Ruhsat s.1',
  }],
  permissions: { canEdit: true },
}

function makePort(initial: CaseVehicleProfileRecord): CaseVehicleProfileDataPort {
  return {
    read: vi.fn().mockResolvedValue(initial),
    save: vi.fn().mockResolvedValue(savedRecord),
  }
}

describe('CaseVehicleProfileModule', () => {
  it('ilk kayıtta sürüm gerekçesi istemez ve expectedVersion null gönderir', async () => {
    const port = makePort(emptyRecord)
    render(<CaseVehicleProfileModule caseId={CASE_ID} port={port} />)
    const user = userEvent.setup()

    await screen.findByText('Araç Profili')
    expect(screen.getByText(/Henüz kaydedilmedi/)).toBeInTheDocument()
    expect(screen.queryByText('Değişiklik gerekçesi')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Marka'), 'Sentetik Marka')
    await user.type(screen.getByLabelText('Model'), 'Örnek Model')
    await user.type(screen.getByLabelText('Şasi ön eki'), 'NM4BJ12')
    await user.click(screen.getByRole('button', { name: 'Araç profilini kaydet' }))

    await waitFor(() => expect(port.save).toHaveBeenCalledWith(CASE_ID, expect.objectContaining({
      expectedVersion: null,
      reason: null,
      fields: expect.objectContaining({
        brand: 'Sentetik Marka',
        model: 'Örnek Model',
        chassisPrefix: 'NM4BJ12',
      }),
    })))
  })

  it('şasi alanı tam numarayı kabul etmez ve dışarı gönderilmediğini belirtir', async () => {
    render(<CaseVehicleProfileModule caseId={CASE_ID} port={makePort(emptyRecord)} />)
    const chassis = await screen.findByLabelText('Şasi ön eki')
    // 17 karakterlik tam VIN girilemez; alan yalnız prefix kabul eder.
    expect(chassis).toHaveAttribute('maxLength', '11')
    expect(screen.getByText(/Tam şasi numarası girilmez ve dışarı gönderilmez/)).toBeInTheDocument()
    expect(screen.getByText(/AI sağlayıcısına gönderilmez/)).toBeInTheDocument()
  })

  it('mevcut sürümde gerekçe zorunludur ve sürüm geçmişi görünür', async () => {
    const port = makePort(savedRecord)
    render(<CaseVehicleProfileModule caseId={CASE_ID} port={port} />)
    const user = userEvent.setup()

    await screen.findByText('Araç Profili')
    // Başlıktaki mevcut sürüm bilgisi; geçmiş listesindeki satırdan ayrı sorgulanır.
    expect(screen.getByText(/Sürüm 1 · Kullanıcı girişi/)).toBeInTheDocument()
    expect(screen.getByLabelText('Marka')).toHaveValue('Sentetik Marka')
    expect(screen.getByText(/Sürüm geçmişi \(1\)/)).toBeInTheDocument()

    const submit = screen.getByRole('button', { name: 'Yeni sürüm kaydet' })
    expect(submit).toBeDisabled()

    await user.type(screen.getByLabelText('Değişiklik gerekçesi'), 'Ruhsat ile doğrulandı')
    expect(submit).toBeEnabled()
    await user.click(submit)
    await waitFor(() => expect(port.save).toHaveBeenCalledWith(CASE_ID, expect.objectContaining({
      expectedVersion: 1,
      reason: 'Ruhsat ile doğrulandı',
    })))
  })

  it('okuma hatasında sahte veri göstermez', async () => {
    const port: CaseVehicleProfileDataPort = {
      read: vi.fn().mockRejectedValue(new CaseVehicleProfileClientError('unavailable', 'down')),
      save: vi.fn(),
    }
    render(<CaseVehicleProfileModule caseId={CASE_ID} port={port} />)
    expect(await screen.findByText('Araç profili alınamadı')).toBeInTheDocument()
    expect(screen.getByText(/Sahte veri gösterilmiyor/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Marka')).not.toBeInTheDocument()
  })

  it('yetkisiz kullanıcıda kaydetmeyi devre dışı bırakır', async () => {
    const port = makePort({ ...emptyRecord, permissions: { canEdit: false } })
    render(<CaseVehicleProfileModule caseId={CASE_ID} port={port} />)
    const user = userEvent.setup()
    await screen.findByText('Araç Profili')
    await user.type(screen.getByLabelText('Marka'), 'Sentetik Marka')
    await user.type(screen.getByLabelText('Model'), 'Örnek Model')
    expect(screen.getByRole('button', { name: 'Araç profilini kaydet' })).toBeDisabled()
  })
})
