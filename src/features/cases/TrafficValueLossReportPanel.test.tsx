import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { TrafficValueLossReportDataPort, TrafficValueLossReportContentRecord, TrafficValueLossReportPreviewRecord } from '../../data/trafficValueLossReportPort'
import type { TrafficValueLossVersionRecord } from '../../data/trafficValueLossPort'
import { TrafficValueLossReportPanel } from './TrafficValueLossReportPanel'

const CASE_ID = '019fb000-0000-7000-8000-000000000001'

function buildVersion(id: string, assessmentVersion: number): TrafficValueLossVersionRecord {
  return {
    id,
    organizationId: '019fb000-0000-7000-8000-000000000002',
    caseId: CASE_ID,
    calculationId: '019fb000-0000-7000-8000-000000000003',
    revisionId: '019fb000-0000-7000-8000-000000000004',
    assessmentVersion,
    status: 'approved',
    ruleSetId: 'real-market-analysis',
    ruleVersion: 'real-market-analysis/2026-07-01/1.0.0',
    effectiveFrom: '2026-07-01',
    input: {
      lossDate: '2026-07-10',
      notificationDate: '2026-07-11',
      evaluatedOn: '2026-07-16',
      heavyOrTotalDamage: false,
      vehicle: { make: null, model: null, variant: null, modelYear: null, mileage: null, usageType: null },
      faultRateBasisPoints: 0,
      preAccidentMarketValueMinor: 10_000_00,
      postRepairMarketValueMinor: 9_000_00,
      damageParts: [],
    },
    evaluation: {
      ruleSetId: 'real-market-analysis',
      ruleVersion: 'real-market-analysis/2026-07-01/1.0.0',
      effectiveFrom: '2026-07-01',
      calculationMethod: 'real_market_analysis',
      roundingRule: 'ceil_500_try',
      ruleSources: [],
      eligibilityStatus: 'calculable',
      grossValueLossMinor: 1_000_00,
      faultAdjustedValueLossMinor: 1_000_00,
      qualifyingPreComparableCount: 0,
      qualifyingPostComparableCount: 0,
      uncertainties: [],
      reasoning: [],
      humanApprovalRequired: true,
      canSubmitForApproval: true,
    },
    evidence: [],
    comparables: [],
    humanApprovalStatus: 'approved',
    approvedBy: 'user-1',
    approvedAt: '2026-07-16T09:00:00.000Z',
    approvalReason: 'Kanıtlar insan tarafından kontrol edildi.',
    createdBy: 'user-1',
    createdAt: '2026-07-16T08:00:00.000Z',
  }
}

function buildPreview(version: TrafficValueLossVersionRecord, reportNote: string | null): TrafficValueLossReportPreviewRecord {
  const content: TrafficValueLossReportContentRecord = {
    schemaVersion: 'traffic-value-loss-final-report/1.0.0',
    templateVersion: 'traffic-value-loss-final-report-tr/1.0.0',
    title: 'Trafik Değer Kaybı Nihai Raporu',
    caseReference: { caseId: CASE_ID, officeNumber: '2026/9001', plate: '34 FCB 900', caseType: 'traffic', lossDate: '2026-07-10', notificationDate: '2026-07-11' },
    assessment: {
      assessmentId: version.calculationId,
      versionId: version.id,
      assessmentVersion: version.assessmentVersion,
      status: 'approved',
      humanApprovalStatus: 'approved',
      approvedBy: 'user-1',
      approvedAt: '2026-07-16T09:00:00.000Z',
      approvalReason: 'Kanıtlar insan tarafından kontrol edildi.',
    },
    vehicle: { make: null, model: null, variant: null, modelYear: null, mileage: null, usageType: null },
    damageParts: [],
    calculation: {
      eligibilityStatus: 'calculable',
      calculationMethod: 'real_market_analysis',
      roundingRule: 'ceil_500_try',
      preAccidentMarketValueMinor: 10_000_00,
      postRepairMarketValueMinor: 9_000_00,
      grossValueLossMinor: 1_000_00,
      faultRateBasisPoints: 0,
      faultAdjustedValueLossMinor: 1_000_00,
      qualifyingPreComparableCount: 0,
      qualifyingPostComparableCount: 0,
      reasoning: [],
    },
    evidence: [],
    comparables: [],
    uncertainties: [],
    rule: { ruleSetId: version.ruleSetId, ruleVersion: version.ruleVersion, effectiveFrom: version.effectiveFrom, sources: [] },
    reportNote,
  }
  return { content, previewHash: 'a'.repeat(64), previewedAt: '2026-07-16T09:30:00.000Z' }
}

function buildPort(overrides: Partial<TrafficValueLossReportDataPort> = {}): TrafficValueLossReportDataPort {
  return {
    list: vi.fn(async () => []),
    preview: vi.fn(async (_caseId, versionId, expectedAssessmentVersion, reportNote) => buildPreview(buildVersion(versionId, expectedAssessmentVersion), reportNote)),
    generate: vi.fn(),
    download: vi.fn(),
    ...overrides,
  }
}

describe('TrafficValueLossReportPanel', () => {
  it('sürüm değişince not, onay ve mesaj render sırasında boşa döner', async () => {
    const port = buildPort()
    const user = userEvent.setup()
    const versionA = buildVersion('trl-version-a', 1)
    const { rerender } = render(<TrafficValueLossReportPanel caseId={CASE_ID} source="api" version={versionA} assessmentVersion={1} port={port} />)

    await user.type(screen.getByLabelText('Nihai rapor notu (isteğe bağlı)'), 'A sürümü notu')
    await user.click(screen.getByRole('button', { name: 'Nihai Raporu Önizle' }))
    await waitFor(() => expect(screen.getByText(/Nihai rapor önizlemesi hazırlandı/)).toBeInTheDocument())
    expect(screen.getByLabelText('Nihai rapor notu (isteğe bağlı)')).toHaveValue('A sürümü notu')

    const versionB = buildVersion('trl-version-b', 1)
    rerender(<TrafficValueLossReportPanel caseId={CASE_ID} source="api" version={versionB} assessmentVersion={1} port={port} />)

    expect(screen.getByLabelText('Nihai rapor notu (isteğe bağlı)')).toHaveValue('')
    expect(screen.queryByText(/Nihai rapor önizlemesi hazırlandı/)).not.toBeInTheDocument()
    expect(screen.queryByText('Trafik Değer Kaybı Nihai Raporu')).not.toBeInTheDocument()
  })

  it('sürüm aynı kalırken ilgisiz bir yeniden render girilen notu ve onayı sıfırlamaz', async () => {
    const port = buildPort()
    const user = userEvent.setup()
    const versionA = buildVersion('trl-version-stable', 2)
    const { rerender } = render(<TrafficValueLossReportPanel caseId={CASE_ID} source="api" version={versionA} assessmentVersion={2} port={port} />)

    await user.type(screen.getByLabelText('Nihai rapor notu (isteğe bağlı)'), 'Kalıcı not')
    await user.click(screen.getByRole('button', { name: 'Nihai Raporu Önizle' }))
    await waitFor(() => expect(screen.getByText('Trafik Değer Kaybı Nihai Raporu')).toBeInTheDocument())
    await user.click(screen.getByRole('checkbox', { name: /nihai PDF oluşturulmasını onaylıyorum/ }))
    expect(screen.getByRole('checkbox', { name: /nihai PDF oluşturulmasını onaylıyorum/ })).toBeChecked()

    // Aynı kimlikte (id değişmeden) yeni bir prop referansıyla ilgisiz bir render tetiklenir.
    rerender(<TrafficValueLossReportPanel caseId={CASE_ID} source="api" version={{ ...versionA }} assessmentVersion={2} port={port} />)

    expect(screen.getByLabelText('Nihai rapor notu (isteğe bağlı)')).toHaveValue('Kalıcı not')
    expect(screen.getByRole('checkbox', { name: /nihai PDF oluşturulmasını onaylıyorum/ })).toBeChecked()
  })
})
