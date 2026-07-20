import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  LaborExcelProfileClientError,
  type LaborExcelProfileDataPort,
  type LaborExcelProfileRecord,
} from '../../data'
import { LaborExcelProfilesModule } from './LaborExcelProfilesModule'

const PROFILE_ID = '018f3f4c-89ab-7def-8123-456789abcd60'

const profile: LaborExcelProfileRecord = {
  id: PROFILE_ID,
  schemaVersion: 'labor-excel-profile/1.0.0',
  version: 1,
  writable: true,
  status: 'active',
  deactivatedAt: null,
  statusReason: null,
  current: {
    id: '018f3f4c-89ab-7def-8123-456789abcd61',
    profileVersion: 1,
    name: 'Sentetik Şablon',
    insurerId: null,
    targetSheet: 'İşçilik',
    identityChecks: { plate: true, officeNumber: false },
    columns: [
      { key: 'ISCILIK', label: 'İşçilik Bedeli' },
      { key: 'PARCA', label: 'Parça Bedeli' },
    ],
      mapping: {
        bodywork: 'ISCILIK',
        mechanical: null,
        electrical: null,
        upholstery_lock: null,
        glass: null,
        calibration: null,
        repair: 'ISCILIK',
        paint: 'PARCA',
      },
    revisionReason: null,
    createdAt: '2026-07-19T18:00:00.000Z',
  },
  history: [],
  createdByDisplayName: 'P60 Yönetici',
  createdAt: '2026-07-19T18:00:00.000Z',
  updatedAt: '2026-07-19T18:00:00.000Z',
}

function makePort(overrides: Partial<LaborExcelProfileDataPort> = {}, canWrite = true) {
  const saved: unknown[] = []
  const port: LaborExcelProfileDataPort = {
    list: vi.fn().mockResolvedValue({ profiles: [profile], permissions: { canWrite } }),
    save: vi.fn().mockImplementation(async (input) => { saved.push(input); return profile }),
    setStatus: vi.fn().mockResolvedValue(profile),
    candidates: vi.fn(),
    project: vi.fn(),
    ...overrides,
  }
  return { port, saved }
}

describe('LaborExcelProfilesModule', () => {
  it('profilleri ve eşlenen tür sayısını gösterir', async () => {
    const { port } = makePort()
    render(<LaborExcelProfilesModule port={port} />)

    expect(await screen.findByText('Sentetik Şablon')).toBeInTheDocument()
    expect(screen.getByText('Sürüm 1')).toBeInTheDocument()
    // 8 dağıtım kategorisinin 3'ü eşlenmiş.
    expect(screen.getByText('3/8')).toBeInTheDocument()
    expect(screen.getByText(/Bu ekran Excel dosyası yazmaz/)).toBeInTheDocument()
  })

  it('yeni profil oluştururken gerekçe istemez', async () => {
    const { port, saved } = makePort()
    render(<LaborExcelProfilesModule port={port} />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: /Yeni Şablon Profili/ }))
    expect(screen.queryByText('Değişiklik gerekçesi')).not.toBeInTheDocument()

    await user.clear(screen.getByLabelText('Profil adı'))
    await user.type(screen.getByLabelText('Profil adı'), 'Yeni Şablon')
    await user.selectOptions(screen.getByLabelText('Onarım sütunu'), 'ISCILIK')
    await user.click(screen.getByRole('button', { name: 'Profili Kaydet' }))

    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]).toMatchObject({ profileId: null, expectedVersion: null, reason: null })
  })

  it('mevcut profilde gerekçe zorunludur', async () => {
    const { port, saved } = makePort()
    render(<LaborExcelProfilesModule port={port} />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Düzenle' }))
    const submit = screen.getByRole('button', { name: 'Yeni Sürüm Kaydet' })
    expect(submit).toBeDisabled()

    await user.type(screen.getByLabelText('Değişiklik gerekçesi'), 'Kolon adı düzeltildi')
    expect(submit).toBeEnabled()
    await user.click(submit)
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]).toMatchObject({ profileId: PROFILE_ID, expectedVersion: 1 })
  })

  it('eşlenmemiş türün sonucunu açıkça söyler', async () => {
    const { port } = makePort()
    render(<LaborExcelProfilesModule port={port} />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Düzenle' }))
    expect(screen.getByText(/Eşlenmeyen tür projeksiyonda sütuna yazılmaz/)).toBeInTheDocument()
    // Her dağıtım kategorisi için bir seçim alanı bulunur.
    expect(screen.getByLabelText('Cam sütunu')).toHaveValue('')
  })

  it('yazma yetkisi olmayan kullanıcıya düzenleme sunmaz', async () => {
    const { port } = makePort({}, false)
    render(<LaborExcelProfilesModule port={port} />)

    await screen.findByText('Sentetik Şablon')
    expect(screen.queryByRole('button', { name: /Yeni Şablon Profili/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Düzenle' })).not.toBeInTheDocument()
  })

  it('hata halinde sahte profil göstermez', async () => {
    const { port } = makePort({
      list: vi.fn().mockRejectedValue(new LaborExcelProfileClientError('unavailable', 'down')),
    })
    render(<LaborExcelProfilesModule port={port} />)

    expect(await screen.findByText('Şablon profilleri alınamadı')).toBeInTheDocument()
    expect(screen.getByText(/Sahte veri gösterilmiyor/)).toBeInTheDocument()
    expect(screen.queryByText('Sentetik Şablon')).not.toBeInTheDocument()
  })

  it('profil yoksa sahte profil uydurmadığını söyler', async () => {
    const { port } = makePort({
      list: vi.fn().mockResolvedValue({ profiles: [], permissions: { canWrite: true } }),
    })
    render(<LaborExcelProfilesModule port={port} />)

    expect(await screen.findByText(/Henüz şablon profili tanımlanmadı/)).toBeInTheDocument()
    expect(screen.getByText(/önceden gömülü değildir/)).toBeInTheDocument()
  })
})
