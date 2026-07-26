import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { LaborAllocationDataPort } from '../../data/laborAllocationPort'
import type { LaborExcelProfileCandidateRecord, LaborExcelProfileCandidatesRecord, LaborExcelProfileDataPort, LaborExcelProjectionRecord } from '../../data/laborExcelProfilePort'
import { LaborAllocationAiModule } from './LaborAllocationAiModule'

/**
 * Paket 63 — çoklu Excel profil seçimi (UI).
 *
 * Ana iddialar: körü körüne "ilk profili al" davranışı yok; otomatik öneri
 * seçim yerine geçmiyor; gerçek şablon eşleşmesi iddia edilmiyor; profil
 * değişince eski projeksiyon gösterilmiyor.
 */
const CASE_ID = '11111111-1111-4111-8111-111111111111'
const APPLICATION_ID = '22222222-2222-4222-8222-222222222222'

const COLUMNS = [
  { key: 'ISCILIK', label: 'İşçilik Bedeli' },
  { key: 'PARCA', label: 'Parça Bedeli' },
]

function candidate(
  overrides: Partial<LaborExcelProfileCandidateRecord> = {},
): LaborExcelProfileCandidateRecord {
  return {
    profileId: 'profile-1',
    profileVersion: 1,
    name: 'A Sigorta Şablonu',
    scope: 'insurer',
    insurerId: 'insurer-a',
    insurerName: 'A Sigorta',
    targetSheet: 'İşçilik',
    identityChecks: { plate: true, officeNumber: false },
    columns: COLUMNS,
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
    unmappedCategories: [
      'mechanical', 'electrical', 'upholstery_lock', 'glass', 'calibration',
    ],
    writable: true,
    ...overrides,
  }
}

function candidatesRecord(
  overrides: Partial<LaborExcelProfileCandidatesRecord> = {},
): LaborExcelProfileCandidatesRecord {
  return {
    caseId: CASE_ID,
    insurerId: 'insurer-a',
    insurerName: 'A Sigorta',
    candidates: [candidate()],
    suggestedProfileId: 'profile-1',
    reason: 'single_insurer_profile',
    templateVerified: false,
    ...overrides,
  }
}

function projectionRecord(
  overrides: Partial<LaborExcelProjectionRecord> = {},
): LaborExcelProjectionRecord {
  return {
    caseId: CASE_ID,
    applicationId: APPLICATION_ID,
    profileId: 'profile-1',
    profileVersion: 1,
    columns: COLUMNS,
    lines: [{
      lineOrdinal: 1,
      description: 'Ön tampon',
      status: 'projected',
      reviewRequired: false,
      cells: { ISCILIK: 1_000_00, PARCA: 0 },
      unmappedAmountMinor: 0,
      totalMinor: 1_000_00,
    }],
    columnTotals: { ISCILIK: 1_000_00, PARCA: 0 },
    projectedLineCount: 1,
    manualEntryLineCount: 0,
    reviewRequiredLineCount: 0,
    unmappedTotalMinor: 0,
    written: false,
    ...overrides,
  }
}

/** Uygulanmış föy geçmişi; "Excel Önizle" düğmesi buradan çıkar. */
function application() {
  return {
    id: APPLICATION_ID,
    caseId: CASE_ID,
    runId: 'run-1',
    status: 'completed' as const,
    sourceSheetVersion: 1,
    targetSheetVersion: 2,
    selectedLineCount: 1,
    rejectedLineCount: 0,
    modifiedLineCount: 0,
    controlRequiredLineCount: 0,
    lines: [],
    appliedByDisplayName: 'P63 Yetkili',
    createdAt: '2026-07-20T10:00:00.000Z',
    completedAt: '2026-07-20T10:00:01.000Z',
  }
}

function allocationPort(): LaborAllocationDataPort {
  return {
    workspace: async () => ({
      caseId: CASE_ID,
      caseClosed: false,
      sourceSheetId: 'sheet-1',
      sourceSheetVersion: 1,
      sourceLineCount: 1,
      operationTypesVersion: 'labor-operation-types/1.0.0',
      runs: [],
      permissions: { canAnalyze: true, requiresExplicitEgressConfirmation: false },
    }),
    analyze: async () => { throw new Error('kullanilmadi') },
    readRun: async () => { throw new Error('kullanilmadi') },
    cancel: async () => { throw new Error('kullanilmadi') },
    applyPreview: async () => { throw new Error('kullanilmadi') },
    apply: async () => { throw new Error('kullanilmadi') },
    listApplications: async () => [application()],
  } as unknown as LaborAllocationDataPort
}

function excelPort(overrides: Partial<LaborExcelProfileDataPort> = {}) {
  const port: LaborExcelProfileDataPort = {
    list: vi.fn(),
    save: vi.fn(),
    setStatus: vi.fn(),
    candidates: vi.fn().mockResolvedValue(candidatesRecord()),
    project: vi.fn().mockResolvedValue(projectionRecord()),
    ...overrides,
  }
  return port
}

async function openSelection(excel: LaborExcelProfileDataPort) {
  render(
    <LaborAllocationAiModule caseId={CASE_ID} port={allocationPort()} excelPort={excel} />,
  )
  const trigger = await screen.findByRole('button', { name: /Excel/ }, { timeout: 3_000 })
  await userEvent.click(trigger)
}

describe('Paket 63 Excel profil seçimi', () => {
  it('şablon profillerini listelemeden aday ucunu kullanır', async () => {
    const excel = excelPort()
    await openSelection(excel)

    await waitFor(() => expect(excel.candidates).toHaveBeenCalledWith(CASE_ID))
    // P60'taki "listedeki ilk profili al" davranışı kaldırıldı.
    expect(excel.list).not.toHaveBeenCalled()
  })

  it('önerilen profili işaretler ama kullanıcı onaylamadan projeksiyon üretmez', async () => {
    const excel = excelPort()
    await openSelection(excel)

    expect(await screen.findByText(/profil önerisidir/)).toBeInTheDocument()
    const radio = await screen.findByRole('radio')
    expect(radio).toBeChecked()
    // Öneri seçim yerine geçmez: onay verilene kadar projeksiyon çağrılmaz.
    expect(excel.project).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Bu Profille Önizle' }))
    await waitFor(() => expect(excel.project)
      .toHaveBeenCalledWith(CASE_ID, APPLICATION_ID, 'profile-1'))
  })

  it('eşleşme önizlemesinde hedef sayfa, kimlik kuralı ve eşlenmemiş kategoriler görünür', async () => {
    await openSelection(excelPort())

    expect(await screen.findByText('İşçilik')).toBeInTheDocument()
    expect(screen.getByText('Plaka')).toBeInTheDocument()
    expect(screen.getByText(/5 dağıtım kategorisi hiçbir/)).toBeInTheDocument()
    expect(screen.getAllByText('Eşlenmedi').length).toBe(5)
  })

  it('birden fazla adayda öneri yapılmaz ve önizleme düğmesi kilitli kalır', async () => {
    const excel = excelPort({
      candidates: vi.fn().mockResolvedValue(candidatesRecord({
        candidates: [candidate(), candidate({ profileId: 'profile-2', name: 'A Sigorta Şablonu 2' })],
        suggestedProfileId: null,
        reason: 'selection_required',
      })),
    })
    await openSelection(excel)

    expect(await screen.findByText(/profili siz seçmelisiniz/)).toBeInTheDocument()
    expect(screen.getAllByRole('radio').every((radio) => !(radio as HTMLInputElement).checked))
      .toBe(true)
    expect(screen.getByRole('button', { name: 'Bu Profille Önizle' })).toBeDisabled()

    await userEvent.click(screen.getAllByRole('radio')[1] as HTMLElement)
    expect(screen.getByRole('button', { name: 'Bu Profille Önizle' })).toBeEnabled()
  })

  it('hiç aday yoksa açık boş durum gösterir; sahte sütun üretmez', async () => {
    const excel = excelPort({
      candidates: vi.fn().mockResolvedValue(candidatesRecord({
        candidates: [], suggestedProfileId: null, reason: 'no_candidates',
      })),
    })
    await openSelection(excel)

    expect(await screen.findByText(/tanımlı aktif şablon profili yok/)).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(excel.project).not.toHaveBeenCalled()
  })

  it('sigorta şirketi tanımsız dosyada ayrı boş durum gösterir', async () => {
    const excel = excelPort({
      candidates: vi.fn().mockResolvedValue(candidatesRecord({
        insurerId: null, insurerName: null,
        candidates: [], suggestedProfileId: null, reason: 'insurer_unknown',
      })),
    })
    await openSelection(excel)

    expect(await screen.findByText(/sigorta şirketi tanımlı değil/)).toBeInTheDocument()
  })

  it('profil değiştirilince eski projeksiyon gösterilmez', async () => {
    const excel = excelPort({
      candidates: vi.fn().mockResolvedValue(candidatesRecord({
        candidates: [candidate(), candidate({ profileId: 'profile-2', name: 'İkinci Şablon' })],
        suggestedProfileId: null,
        reason: 'selection_required',
      })),
    })
    await openSelection(excel)

    await userEvent.click((await screen.findAllByRole('radio'))[0] as HTMLElement)
    await userEvent.click(screen.getByRole('button', { name: 'Bu Profille Önizle' }))
    expect(await screen.findByText('Excel Projeksiyonu')).toBeInTheDocument()

    // Projeksiyondan çıkıp başka profil seçilince bayat sayı taşınmaz.
    await userEvent.click(screen.getByRole('button', { name: 'Kapat' }))
    await userEvent.click((await screen.findAllByRole('radio'))[1] as HTMLElement)
    expect(screen.queryByText('Excel Projeksiyonu')).not.toBeInTheDocument()
  })

  it('profil sürümü değişmişse projeksiyonu bayat olarak işaretler', async () => {
    const excel = excelPort({
      // Aday listesi sürüm 2'yi bildirirken projeksiyon sürüm 1'den hesaplandı.
      candidates: vi.fn().mockResolvedValue(candidatesRecord({
        candidates: [candidate({ profileVersion: 2 })],
      })),
      project: vi.fn().mockResolvedValue(projectionRecord({ profileVersion: 1 })),
    })
    await openSelection(excel)

    await userEvent.click(await screen.findByRole('button', { name: 'Bu Profille Önizle' }))
    expect(await screen.findByText(/Gösterilen sayılar bayattır/)).toBeInTheDocument()
  })
})
