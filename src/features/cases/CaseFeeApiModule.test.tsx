import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  CaseDocumentsDataPort,
  CaseDocumentWorkspaceRecord,
  CaseClosureFeeWorkspaceRecord,
  ReportsFeesDataPort,
} from '../../data'
import type { CaseRecord } from '../../types/case'
import { CaseFeeApiModule } from './CaseFeeApiModule'

const CASE_ID = '018f3f4c-89ab-7def-8123-456789abcdef'
const VERSION_ID = '018f3f4c-89ab-7def-8123-456789abcdee'
const FEE_ID = '018f3f4c-89ab-7def-8123-456789abcded'

const item: CaseRecord = {
  caseId: CASE_ID,
  plate: '34 ABC 39',
  officeNumber: '2026/39',
  noticeNumber: 'İHB-39',
  claimNumber: 'HSR-39',
  company: 'Sentetik Sigorta',
  type: 'Trafik',
  status: 'Kapalı',
  stage: 'Kapalı',
  missingDocuments: 0,
  assignee: 'Sorumlu',
  expert: 'Eksper',
  service: 'Servis',
  followUp: '—',
  followUpTone: 'normal',
  lastAction: 'Bugün',
  vehicle: '—',
  insured: '—',
  estimatedDamage: 0,
  notes: [],
  version: 1,
  lifecycleStatus: 'closed',
  workflowStage: 'closed',
}

const documentWorkspace: CaseDocumentWorkspaceRecord = {
  caseId: CASE_ID,
  caseType: 'traffic',
  ruleSetVersion: 'test',
  overallStatus: 'present',
  requirements: [],
  alternativeGroups: [],
  missingCount: 0,
  controlRequiredCount: 0,
  evaluatedAt: '2026-07-16T10:00:00.000Z',
  documents: [{
    id: VERSION_ID,
    documentId: FEE_ID,
    documentType: 'expert_report',
    versionNumber: 1,
    originalFileName: 'sentetik.pdf',
    displayName: 'Nihai Ekspertiz Raporu',
    mimeType: 'application/pdf',
    byteSize: 256,
    contentHash: 'a'.repeat(64),
    relativePath: 'EVRAK/sentetik.pdf',
    status: 'ready',
    hashVerified: true,
    sizeVerified: true,
    verifiedAt: '2026-07-16T08:00:00.000Z',
  }],
  photos: [],
}

function renderModule(feePort: ReportsFeesDataPort) {
  const documentPort: CaseDocumentsDataPort = {
    getCaseDocumentWorkspace: vi.fn(async () => documentWorkspace),
  }
  render(
    <CaseFeeApiModule item={item} source="api" feePort={feePort} documentPort={documentPort} />,
  )
}

describe('CaseFeeApiModule', () => {
  it('ready nihai rapordan minor-unit adayı oluşturur; mock sonuç göstermez', async () => {
    const createCandidate = vi.fn(async () => ({
      id: FEE_ID,
      caseId: CASE_ID,
      version: 1,
      currentVersion: {
        id: VERSION_ID,
        feeVersion: 1,
        status: 'control_required' as const,
        candidateAmountMinor: 485_000,
        approvedAmountMinor: null,
        currency: 'TRY' as const,
        sourceDocumentVersionId: VERSION_ID,
        sourcePage: 12,
        sourceType: 'manual' as const,
        ruleVersion: 'closure-fee/1.0.0' as const,
        correctionReason: null,
        createdByUserId: VERSION_ID,
        approvedByUserId: null,
        approvedAt: null,
        createdAt: '2026-07-16T10:00:00.000Z',
      },
      history: [],
      permissions: { canCreateCandidate: false, canApprove: false, canCorrect: false },
    }))
    const feePort: ReportsFeesDataPort = {
      getCaseFee: vi.fn(async () => ({
        fee: null,
        permissions: { canCreateCandidate: true, canApprove: false, canCorrect: false },
      })),
      listFees: vi.fn(async () => []),
      getCaseSummaryReport: vi.fn(),
      createCandidate,
      approve: vi.fn(),
      correct: vi.fn(),
    }
    renderModule(feePort)
    await screen.findByText('Aday tutar kesin aylık toplama girmez. Yalnız doğrulanmış nihai ekspertiz raporu kaynak olabilir.')
    fireEvent.change(screen.getByLabelText('Aday Tutar (TL)'), { target: { value: '4850,00' } })
    fireEvent.change(screen.getByLabelText('Kaynak Sayfa'), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: 'Adayı Kaydet' }))
    await waitFor(() => expect(createCandidate).toHaveBeenCalledWith(
      CASE_ID,
      expect.objectContaining({ candidateAmountMinor: 485_000, sourcePage: 12 }),
      expect.any(String),
    ))
    expect(screen.queryByText(/mock/i)).toBeNull()
  })

  it('control_required adayı açık checkbox olmadan onaylatmaz', async () => {
    const approve = vi.fn()
    const feeWorkspace: CaseClosureFeeWorkspaceRecord = {
      fee: {
        id: FEE_ID,
        caseId: CASE_ID,
        version: 1,
        currentVersion: {
          id: VERSION_ID,
          feeVersion: 1,
          status: 'control_required',
          candidateAmountMinor: 485_000,
          approvedAmountMinor: null,
          currency: 'TRY',
          sourceDocumentVersionId: VERSION_ID,
          sourcePage: 12,
          sourceType: 'manual',
          ruleVersion: 'closure-fee/1.0.0',
          correctionReason: null,
          createdByUserId: VERSION_ID,
          approvedByUserId: null,
          approvedAt: null,
          createdAt: '2026-07-16T10:00:00.000Z',
        },
        history: [],
        permissions: { canCreateCandidate: false, canApprove: true, canCorrect: false },
      },
      permissions: { canCreateCandidate: false, canApprove: true, canCorrect: false },
    }
    const feePort: ReportsFeesDataPort = {
      getCaseFee: vi.fn(async () => feeWorkspace),
      listFees: vi.fn(async () => []),
      getCaseSummaryReport: vi.fn(),
      createCandidate: vi.fn(),
      approve,
      correct: vi.fn(),
    }
    renderModule(feePort)
    const button = await screen.findByRole('button', { name: 'Ücreti Onayla' })
    expect(button).toBeDisabled()
    fireEvent.click(screen.getByLabelText('Aday tutarı ve kaynak sayfayı kontrol ettim.'))
    fireEvent.click(button)
    await waitFor(() => expect(approve).toHaveBeenCalledWith(FEE_ID, 1, expect.any(String)))
  })
})
