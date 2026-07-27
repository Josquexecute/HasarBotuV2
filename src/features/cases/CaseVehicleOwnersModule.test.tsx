import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { CaseVehicleOwnersDataPort, CaseVehicleOwnersRecord } from '../../data/caseVehicleOwnersPort'
import { CaseVehicleOwnersClientError } from '../../data/caseVehicleOwnersPort'
import { CaseVehicleOwnersModule } from './CaseVehicleOwnersModule'

const CASE_ID = '018f3f4c-89ab-7def-8123-456789abcdef'

const emptyRecord: CaseVehicleOwnersRecord = {
  caseId: CASE_ID,
  setVersion: null,
  owners: [],
  updatedByUserId: null,
  updatedAt: null,
  permissions: { canEdit: true },
}

const savedRecord: CaseVehicleOwnersRecord = {
  caseId: CASE_ID,
  setVersion: 1,
  owners: [{ name: 'Ahmet Yılmaz', phone: '05321234567' }, { name: 'Ayşe Yılmaz', phone: null }],
  updatedByUserId: 'user-1',
  updatedAt: '2026-07-18T09:00:00.000Z',
  permissions: { canEdit: true },
}

function makePort(initial: CaseVehicleOwnersRecord, saveResult: CaseVehicleOwnersRecord = savedRecord): CaseVehicleOwnersDataPort {
  return {
    read: vi.fn().mockResolvedValue(initial),
    save: vi.fn().mockResolvedValue(saveResult),
  }
}

describe('CaseVehicleOwnersModule', () => {
  it('boş listede ilk sahibi ekler ve expectedSetVersion null gönderir', async () => {
    const port = makePort(emptyRecord)
    render(<CaseVehicleOwnersModule caseId={CASE_ID} port={port} />)
    const user = userEvent.setup()

    await screen.findByText('Araç Sahibi veya Sahipleri')
    expect(screen.getByText('Henüz kayıtlı araç sahibi yok.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sahip Ekle' }))

    await user.type(screen.getByLabelText('Sahip 1 adı'), 'Ahmet Yılmaz')
    await user.type(screen.getByLabelText('Sahip 1 telefonu'), '05321234567')
    await user.click(screen.getByRole('button', { name: 'Listeyi Kaydet' }))

    await waitFor(() => expect(port.save).toHaveBeenCalledWith(CASE_ID, {
      owners: [{ name: 'Ahmet Yılmaz', phone: '05321234567' }],
      expectedSetVersion: null,
    }))
    expect(await screen.findByText(/Ahmet Yılmaz · 05321234567/)).toBeInTheDocument()
  })

  it('mevcut listeyi gösterir, bir satırı kaldırıp doğru expectedSetVersion ile kaydeder', async () => {
    const port = makePort(savedRecord, { ...savedRecord, setVersion: 2, owners: [{ name: 'Ahmet Yılmaz', phone: '05321234567' }] })
    render(<CaseVehicleOwnersModule caseId={CASE_ID} port={port} />)
    const user = userEvent.setup()

    expect(await screen.findByText(/Ahmet Yılmaz · 05321234567/)).toBeInTheDocument()
    expect(screen.getByText('Ayşe Yılmaz')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Listeyi Düzenle' }))

    expect(screen.getByLabelText('Sahip 1 adı')).toHaveValue('Ahmet Yılmaz')
    expect(screen.getByLabelText('Sahip 2 adı')).toHaveValue('Ayşe Yılmaz')
    await user.click(screen.getByRole('button', { name: 'Sahip 2 satırını kaldır' }))
    await user.click(screen.getByRole('button', { name: 'Listeyi Kaydet' }))

    await waitFor(() => expect(port.save).toHaveBeenCalledWith(CASE_ID, {
      owners: [{ name: 'Ahmet Yılmaz', phone: '05321234567' }],
      expectedSetVersion: 1,
    }))
  })

  it(`üst sınıra ulaşınca "Sahip Ekle" gizlenir`, async () => {
    const sixOwners: CaseVehicleOwnersRecord = {
      ...savedRecord,
      owners: Array.from({ length: 6 }, (_, index) => ({ name: `Sahip ${index}`, phone: null })),
    }
    render(<CaseVehicleOwnersModule caseId={CASE_ID} port={makePort(sixOwners)} />)
    const user = userEvent.setup()
    await screen.findByText('Araç Sahibi veya Sahipleri')
    await user.click(screen.getByRole('button', { name: 'Listeyi Düzenle' }))
    expect(screen.queryByRole('button', { name: 'Sahip Ekle' })).not.toBeInTheDocument()
  })

  it('okuma hatasında sahte veri göstermez', async () => {
    const port: CaseVehicleOwnersDataPort = {
      read: vi.fn().mockRejectedValue(new CaseVehicleOwnersClientError('unavailable', 'down')),
      save: vi.fn(),
    }
    render(<CaseVehicleOwnersModule caseId={CASE_ID} port={port} />)
    expect(await screen.findByText('Araç sahibi bilgisi alınamadı')).toBeInTheDocument()
    expect(screen.getByText(/Sahte veri gösterilmiyor/)).toBeInTheDocument()
  })

  it('yetkisiz kullanıcıda düzenleme butonu gösterilmez', async () => {
    const port = makePort({ ...savedRecord, permissions: { canEdit: false } })
    render(<CaseVehicleOwnersModule caseId={CASE_ID} port={port} />)
    await screen.findByText('Araç Sahibi veya Sahipleri')
    expect(screen.queryByRole('button', { name: 'Listeyi Düzenle' })).not.toBeInTheDocument()
  })
})
