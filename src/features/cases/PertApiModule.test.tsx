import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { PertAssessmentRecord, PertDataPort, PertWorkspaceRecord } from '../../data'
import type { CaseRecord } from '../../types/case'
import { PertApiModule } from './PertApiModule'

const CASE_ID = '018f3f4c-89ab-7def-8123-456789abcdef'
const USER_ID = '018f3f4c-89ab-7def-8123-456789abcdea'
const VERSION_ID = '018f3f4c-89ab-7def-8123-456789abcdec'

const item: CaseRecord = {
  caseId: CASE_ID,
  plate: '34 ABC 45',
  officeNumber: '2026/45',
  noticeNumber: 'İHB-45',
  claimNumber: 'HSR-45',
  company: 'Sentetik Sigorta',
  type: 'Kasko',
  status: 'Açık',
  stage: 'Hasar Tespiti',
  missingDocuments: 0,
  assignee: 'Sorumlu',
  expert: 'Eksper',
  service: 'Servis',
  followUp: 'Bugün',
  followUpTone: 'today',
  lastAction: 'Bugün',
  vehicle: '—',
  insured: '—',
  estimatedDamage: 0,
  notes: [],
  version: 3,
  lifecycleStatus: 'open',
  workflowStage: 'damage_assessment',
}

const assessment: PertAssessmentRecord = {
  id: VERSION_ID,
  caseId: CASE_ID,
  version: 1,
  currentVersion: {
    id: VERSION_ID,
    assessmentVersion: 1,
    previousVersionId: null,
    workflowStatus: 'pert_candidate',
    estimatedDamageMinor: 4_800_000_00,
    marketValueMinor: 6_250_000_00,
    damageRatioPercent: 77,
    structuralNote: 'Ön panel ölçümü bekleniyor.',
    expertOpinion: null,
    expertRationale: null,
    centerDecision: null,
    centerNote: null,
    schemaVersion: 'pert-assessment/1.0.0',
    currency: 'TRY',
    sourceType: 'user_entered',
    revisionReason: null,
    createdByUserId: USER_ID,
    createdByDisplayName: 'P45 Eksper',
    createdAt: '2026-07-18T09:00:00.000Z',
  },
  versions: [],
  createdByUserId: USER_ID,
  createdByDisplayName: 'P45 Eksper',
  createdAt: '2026-07-18T09:00:00.000Z',
  updatedAt: '2026-07-18T09:00:00.000Z',
}
const fullAssessment = { ...assessment, versions: [assessment.currentVersion] }

function makePort(workspace: PertWorkspaceRecord): PertDataPort {
  return {
    load: vi.fn().mockResolvedValue(workspace),
    create: vi.fn().mockResolvedValue(fullAssessment),
    revise: vi.fn().mockResolvedValue(fullAssessment),
  }
}

const workspaceOf = (canWrite: boolean, withAssessment: boolean): PertWorkspaceRecord => ({
  caseId: CASE_ID,
  caseVersion: 3,
  lifecycleStatus: canWrite ? 'open' : 'closed',
  assessment: withAssessment ? fullAssessment : null,
  permissions: { canWrite },
})

describe('PertApiModule', () => {
  it('boş değerlendirmede kullanıcı veri girip açık onayla oluşturur; oran türetilir', async () => {
    const port = makePort(workspaceOf(true, false))
    render(<PertApiModule item={item} source="api" onUnauthorized={vi.fn()} port={port} />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'PERT Değerlendirmesi Oluştur' }))
    await user.selectOptions(screen.getByLabelText('Süreç durumu'), 'under_review')
    await user.type(screen.getByLabelText('Tahmini hasar (₺)'), '480000')
    await user.type(screen.getByLabelText('Rayiç değer (₺)'), '625000')
    expect(screen.getByText('%77')).toBeInTheDocument()

    expect(screen.getByRole('button', { name: /Değerlendirmeyi Kaydet/ })).toBeDisabled()
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /Değerlendirmeyi Kaydet/ }))

    await waitFor(() => expect(port.create).toHaveBeenCalledWith(CASE_ID, expect.objectContaining({
      workflowStatus: 'under_review',
      estimatedDamageMinor: 48_000_000,
      marketValueMinor: 62_500_000,
      expertOpinion: null,
      centerDecision: null,
      expectedCaseVersion: 3,
      confirmed: true,
    })))
  })

  it('kanaat gerekçesiz kaydı istemci tarafında engeller', async () => {
    const port = makePort(workspaceOf(true, false))
    render(<PertApiModule item={item} source="api" onUnauthorized={vi.fn()} port={port} />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'PERT Değerlendirmesi Oluştur' }))
    await user.selectOptions(screen.getByLabelText('Eksper kanaati'), 'pert')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /Değerlendirmeyi Kaydet/ }))
    expect(await screen.findByText(/gerekçe zorunludur/)).toBeInTheDocument()
    expect(port.create).not.toHaveBeenCalled()
  })

  it('mevcut değerlendirmede üç ayrı karar alanını ve oranı gösterir', async () => {
    const port = makePort(workspaceOf(true, true))
    render(<PertApiModule item={item} source="api" onUnauthorized={vi.fn()} port={port} />)
    expect(await screen.findByText('Eksper kanaati')).toBeInTheDocument()
    expect(screen.getByText('Merkez / sigorta kararı')).toBeInTheDocument()
    expect(screen.getByText('%77')).toBeInTheDocument()
    expect(screen.getByText('Kanaat verilmedi')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Değerlendirmeyi Düzenle' })).toBeInTheDocument()
  })

  it('kapalı dosyada düzenleme sunmaz', async () => {
    const port = makePort(workspaceOf(false, true))
    render(<PertApiModule item={item} source="api" onUnauthorized={vi.fn()} port={port} />)
    await screen.findByText('Eksper kanaati')
    expect(screen.queryByRole('button', { name: 'Değerlendirmeyi Düzenle' })).not.toBeInTheDocument()
    expect(screen.getByText(/salt okunurdur/)).toBeInTheDocument()
  })
})
