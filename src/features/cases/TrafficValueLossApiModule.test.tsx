import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SessionContext, type SessionContextValue } from '../../app/sessionContext'
import type {
  CaseDocumentsDataPort,
  TrafficValueLossAssessmentRecord,
  TrafficValueLossDataPort,
  TrafficValueLossDraftInput,
  TrafficValueLossReportContentRecord,
  TrafficValueLossReportDataPort,
  TrafficValueLossReportRecord,
  TrafficValueLossVersionRecord,
} from '../../data'
import { TrafficValueLossError, TrafficValueLossReportError } from '../../data'
import type { CaseRecord } from '../../types/case'
import { TrafficValueLossApiModule } from './TrafficValueLossApiModule'

const CASE_ID = '019fa000-0000-7000-8000-000000000001'
const DOCUMENT_ID = '019fa000-0000-7000-8000-000000000002'
const DOCUMENT_VERSION_ID = '019fa000-0000-7000-8000-000000000003'
const USER_ID = '019fa000-0000-7000-8000-000000000004'

const item: CaseRecord = {
  caseId: CASE_ID,
  plate: '34 TEST 033',
  officeNumber: '2026/33',
  noticeNumber: 'IHB-33',
  claimNumber: 'HSR-33',
  company: 'Sentetik Sigorta',
  type: 'Trafik',
  status: 'Açık',
  stage: 'Hasar Tespiti',
  missingDocuments: 0,
  assignee: 'Test Sorumlusu',
  expert: 'Test Eksper',
  service: 'Test Servis',
  followUp: 'Bugün',
  followUpTone: 'today',
  lastAction: 'Test',
  vehicle: 'Sentetik Araç',
  insured: 'Sentetik Sigortalı',
  estimatedDamage: 12_000,
  notes: [],
  lossDate: '2026-07-02',
  notificationDate: '2026-07-03',
}

const session: SessionContextValue = {
  mode: 'api',
  status: 'authenticated',
  user: {
    id: USER_ID,
    organizationId: '019fa000-0000-7000-8000-000000000005',
    email: 'eksper@example.test',
    displayName: 'Sentetik Eksper',
    roles: ['admin', 'expert'],
  },
  notice: null,
  login: async () => undefined,
  logout: async () => undefined,
  reportUnauthorized: vi.fn(),
}

const documentPort: CaseDocumentsDataPort = {
  getCaseDocumentWorkspace: vi.fn().mockResolvedValue({
    caseId: CASE_ID,
    caseType: 'traffic',
    ruleSetVersion: '2026.07.14.1',
    overallStatus: 'present',
    requirements: [],
    alternativeGroups: [],
    missingCount: 0,
    controlRequiredCount: 0,
    evaluatedAt: '2026-07-16T08:00:00.000Z',
    documents: [{
      id: DOCUMENT_VERSION_ID,
      documentId: DOCUMENT_ID,
      documentType: 'expert_report',
      versionNumber: 1,
      originalFileName: 'sentetik-ekspertiz.pdf',
      displayName: 'Sentetik Ekspertiz Raporu',
      mimeType: 'application/pdf',
      byteSize: 2048,
      contentHash: 'a'.repeat(64),
      relativePath: '2026/Temmuz 2026/34TEST033/EVRAK/sentetik-ekspertiz.pdf',
      status: 'ready',
      hashVerified: true,
      sizeVerified: true,
      verifiedAt: '2026-07-16T08:00:00.000Z',
    }],
    photos: [],
  }),
}

function reportContent(version: TrafficValueLossVersionRecord): TrafficValueLossReportContentRecord {
  const evidenceById = new Map(version.evidence.map((evidence) => [evidence.id, evidence]))
  return {
    schemaVersion: 'traffic-value-loss-final-report/1.0.0',
    templateVersion: 'traffic-value-loss-final-report-tr/1.0.0',
    title: 'Trafik Değer Kaybı Nihai Raporu',
    caseReference: {
      caseId: CASE_ID,
      officeNumber: item.officeNumber,
      plate: item.plate,
      caseType: 'traffic',
      lossDate: item.lossDate ?? null,
      notificationDate: item.notificationDate ?? null,
    },
    assessment: {
      assessmentId: '019fa000-0000-7000-8000-000000000007',
      versionId: version.id,
      assessmentVersion: version.assessmentVersion,
      status: 'approved',
      humanApprovalStatus: 'approved',
      approvedBy: USER_ID,
      approvedAt: '2026-07-16T09:00:00.000Z',
      approvalReason: 'Kanıtlar insan tarafından kontrol edildi.',
    },
    vehicle: version.input.vehicle,
    damageParts: version.input.damageParts,
    calculation: {
      eligibilityStatus: version.evaluation.eligibilityStatus,
      calculationMethod: version.evaluation.calculationMethod,
      roundingRule: version.evaluation.roundingRule,
      preAccidentMarketValueMinor: version.input.preAccidentMarketValueMinor,
      postRepairMarketValueMinor: version.input.postRepairMarketValueMinor,
      grossValueLossMinor: version.evaluation.grossValueLossMinor,
      faultRateBasisPoints: version.input.faultRateBasisPoints,
      faultAdjustedValueLossMinor: version.evaluation.faultAdjustedValueLossMinor,
      qualifyingPreComparableCount: version.evaluation.qualifyingPreComparableCount,
      qualifyingPostComparableCount: version.evaluation.qualifyingPostComparableCount,
      reasoning: version.evaluation.reasoning,
    },
    evidence: version.evidence,
    comparables: version.comparables.map((comparable) => {
      const evidence = evidenceById.get(comparable.evidenceId)
      return {
        ...comparable,
        evidenceKey: evidence?.evidenceKey ?? 'missing',
        sourceReference: evidence?.externalReference ?? null,
      }
    }),
    uncertainties: version.evaluation.uncertainties,
    rule: {
      ruleSetId: version.ruleSetId,
      ruleVersion: version.ruleVersion,
      effectiveFrom: version.effectiveFrom,
      sources: version.evaluation.ruleSources,
    },
    reportNote: 'Sentetik nihai rapor notu.',
  }
}

function mutableReportPort(sourceVersion: () => TrafficValueLossVersionRecord | null): TrafficValueLossReportDataPort {
  let reports: readonly TrafficValueLossReportRecord[] = []
  return {
    list: vi.fn(async () => reports),
    preview: vi.fn(async () => {
      const version = sourceVersion()
      if (version === null) throw new Error('report source not set')
      return {
        content: reportContent(version),
        previewHash: 'd'.repeat(64),
        previewedAt: '2026-07-16T09:30:00.000Z',
      }
    }),
    generate: vi.fn(async () => {
      const version = sourceVersion()
      if (version === null) throw new Error('report source not set')
      const content = reportContent(version)
      const report: TrafficValueLossReportRecord = {
        id: '019fa000-0000-7000-8000-000000000009',
        caseId: CASE_ID,
        assessmentId: content.assessment.assessmentId,
        assessmentVersionId: version.id,
        assessmentVersion: version.assessmentVersion,
        status: 'ready',
        format: 'pdf',
        schemaVersion: content.schemaVersion,
        templateVersion: content.templateVersion,
        ruleVersion: content.rule.ruleVersion,
        contentHash: 'd'.repeat(64),
        pdfHash: 'e'.repeat(64),
        pdfByteSize: 4096,
        content,
        generatedBy: USER_ID,
        generatedAt: '2026-07-16T09:31:00.000Z',
        version: 1,
      }
      reports = [report]
      return report
    }),
    download: vi.fn(async () => ({ blob: new Blob(['%PDF-1.4'], { type: 'application/pdf' }), filename: 'trafik-deger-kaybi-v1.pdf' })),
  }
}

function versionFrom(
  input: TrafficValueLossDraftInput,
  status: TrafficValueLossVersionRecord['status'],
  humanApprovalStatus: TrafficValueLossVersionRecord['humanApprovalStatus'] = 'pending',
): TrafficValueLossVersionRecord {
  const evidence = input.evidence.map((entry, index) => ({
    ...entry,
    id: `evidence-${index + 1}`,
    createdAt: '2026-07-16T08:00:00.000Z',
  }))
  const evidenceByKey = new Map(evidence.map((entry) => [entry.evidenceKey, entry.id]))
  return {
    id: '019fa000-0000-7000-8000-000000000006',
    assessmentVersion: 1,
    status,
    ruleSetId: 'traffic-value-loss-market-difference',
    ruleVersion: '2026.07.01.1',
    effectiveFrom: '2026-07-01',
    input: {
      lossDate: item.lossDate ?? null,
      notificationDate: item.notificationDate ?? null,
      evaluatedOn: input.evaluatedOn,
      heavyOrTotalDamage: input.heavyOrTotalDamage,
      vehicle: input.vehicle,
      faultRateBasisPoints: input.faultRateBasisPoints,
      preAccidentMarketValueMinor: input.preAccidentMarketValueMinor,
      postRepairMarketValueMinor: input.postRepairMarketValueMinor,
      damageParts: input.damageParts,
    },
    evaluation: {
      ruleSetId: 'traffic-value-loss-market-difference',
      ruleVersion: '2026.07.01.1',
      effectiveFrom: '2026-07-01',
      calculationMethod: 'market_value_difference',
      roundingRule: 'half_up_minor_unit',
      ruleSources: [
        {
          code: 'RG-2026',
          title: 'Resmî Gazete sentetik kural kaynağı',
          sourceType: 'official_gazette',
          publishedAt: '2026-06-12',
          effectiveFrom: '2026-07-01',
          locator: 'Madde 2',
          url: 'https://www.resmigazete.gov.tr/sentetik',
        },
        {
          code: 'SEDDK-2026',
          title: 'SEDDK sentetik genelge kaynağı',
          sourceType: 'seddk_circular',
          publishedAt: '2026-06-15',
          effectiveFrom: '2026-07-01',
          locator: 'Bölüm 3',
          url: 'https://www.seddk.gov.tr/sentetik',
        },
      ],
      eligibilityStatus: 'calculable',
      grossValueLossMinor: 10_000_000,
      faultAdjustedValueLossMinor: 7_500_000,
      qualifyingPreComparableCount: 3,
      qualifyingPostComparableCount: 3,
      uncertainties: [],
      reasoning: ['Altı doğrulanmış emsal ve doğrulanmış belge metadata kanıtı değerlendirildi.'],
      humanApprovalRequired: true,
      canSubmitForApproval: true,
    },
    evidence,
    comparables: input.comparables.map((comparable, index) => ({
      id: `comparable-${index + 1}`,
      comparableKey: comparable.comparableKey,
      side: comparable.side,
      amountMinor: comparable.amountMinor,
      mileage: comparable.mileage,
      observedAt: comparable.observedAt,
      evidenceId: evidenceByKey.get(comparable.evidenceKey) ?? '',
      excluded: comparable.excluded,
      exclusionReason: comparable.exclusionReason,
    })),
    humanApprovalStatus,
    approvedBy: humanApprovalStatus === 'approved' ? USER_ID : null,
    approvedAt: humanApprovalStatus === 'approved' ? '2026-07-16T09:00:00.000Z' : null,
    approvalReason: humanApprovalStatus === 'approved' ? 'Kanıtlar insan tarafından kontrol edildi.' : null,
    createdBy: USER_ID,
    createdAt: '2026-07-16T08:00:00.000Z',
  }
}

function mutablePort() {
  let assessment: TrafficValueLossAssessmentRecord | null = null
  let versions: readonly TrafficValueLossVersionRecord[] = []
  const store = (currentVersion: TrafficValueLossVersionRecord, version: number) => {
    assessment = {
      id: '019fa000-0000-7000-8000-000000000007',
      caseId: CASE_ID,
      currentVersion,
      version,
      createdAt: '2026-07-16T08:00:00.000Z',
      updatedAt: '2026-07-16T09:00:00.000Z',
    }
    versions = [currentVersion]
    return assessment
  }
  const port: TrafficValueLossDataPort = {
    load: vi.fn(async () => ({ assessment, versions })),
    createVersion: vi.fn(async (_caseId, _expectedVersion, input) => store(versionFrom(input, 'draft'), 1)),
    submit: vi.fn(async () => {
      if (assessment === null) throw new Error('assessment missing')
      return store({ ...assessment.currentVersion, status: 'awaiting_approval' }, assessment.version + 1)
    }),
    approve: vi.fn(async () => {
      if (assessment === null) throw new Error('assessment missing')
      return store({
        ...assessment.currentVersion,
        status: 'approved',
        humanApprovalStatus: 'approved',
        approvedBy: USER_ID,
        approvedAt: '2026-07-16T09:00:00.000Z',
        approvalReason: 'Kanıtlar insan tarafından kontrol edildi.',
      }, assessment.version + 1)
    }),
    reject: vi.fn(async () => {
      if (assessment === null) throw new Error('assessment missing')
      return store({ ...assessment.currentVersion, status: 'rejected', humanApprovalStatus: 'rejected' }, assessment.version + 1)
    }),
  }
  return port
}

function renderModule(
  port: TrafficValueLossDataPort,
  record: CaseRecord = item,
  reportPort?: TrafficValueLossReportDataPort,
) {
  return render(
    <SessionContext.Provider value={session}>
      <TrafficValueLossApiModule item={record} source="api" port={port} documentPort={documentPort} reportPort={reportPort} />
    </SessionContext.Provider>,
  )
}

describe('TrafficValueLossApiModule kullanıcı kontrollü API akışı', () => {
  it('emsal ve kanıt girdisinden sürüm üretir, submit eder ve insan onayıyla kesinleştirir', async () => {
    const user = userEvent.setup()
    const port = mutablePort()
    const reportPort = mutableReportPort(() => {
      const input = vi.mocked(port.createVersion).mock.calls[0]?.[2]
      return input === undefined ? null : versionFrom(input, 'approved', 'approved')
    })
    renderModule(port, item, reportPort)

    await screen.findByText(/1 doğrulanmış belge sürümü/)
    await user.selectOptions(screen.getByLabelText('Ağır / tam hasar'), 'no')
    await user.type(screen.getByLabelText('Kusur oranı (%)'), '75')
    await user.type(screen.getByLabelText('Marka'), 'Sentetik')
    await user.type(screen.getByLabelText('Model'), 'Model 33')
    await user.type(screen.getByLabelText('Varyant'), 'Paket')
    await user.type(screen.getByLabelText('Model yılı'), '2024')
    await user.type(screen.getByLabelText('Kilometre'), '50000')
    await user.type(screen.getByLabelText('Kullanım şekli'), 'Hususi')
    await user.type(screen.getByLabelText('Kaza öncesi piyasa değeri'), '1000000')
    await user.type(screen.getByLabelText('Onarım sonrası piyasa değeri'), '900000')
    await user.type(screen.getByLabelText('Parça kodu'), 'SOL_CAMURLUK')
    await user.type(screen.getByLabelText('Parça adı'), 'Sol çamurluk')
    await user.selectOptions(screen.getByLabelText('Önceki hasar'), 'no')
    await user.click(screen.getByRole('checkbox', { name: /Ekspertiz raporu/ }))
    for (const support of ['Araç kimliği', 'Kilometre', 'Kullanım', 'Hasarlı parçalar', 'Önceki hasar', 'Kusur', 'Ağır/tam hasar']) {
      await user.click(screen.getByRole('checkbox', { name: new RegExp(`^${support.replace('/', '\\/')}$`) }))
    }

    const amounts = screen.getAllByLabelText('Emsal tutarı')
    const mileages = screen.getAllByLabelText('Emsal kilometresi')
    const references = screen.getAllByLabelText('Emsal kaynağı')
    const verified = screen.getAllByLabelText('Doğrulandı')
    for (let index = 0; index < 6; index += 1) {
      await user.type(amounts[index], index < 3 ? String(1_020_000 - index * 10_000) : String(910_000 - (index - 3) * 10_000))
      await user.type(mileages[index], String(49_000 + index * 300))
      await user.type(references[index], `ref:sentetik-emsal-${index + 1}`)
      await user.click(verified[index])
    }

    await user.click(screen.getByRole('button', { name: /Taslağı Hesapla ve Sürümle/ }))
    await waitFor(() => expect(port.createVersion).toHaveBeenCalledTimes(1))
    const input = vi.mocked(port.createVersion).mock.calls[0][2]
    expect(input.comparables).toHaveLength(6)
    expect(input.evidence.some((entry) => entry.documentVersionId === DOCUMENT_VERSION_ID && entry.sourceHash === 'a'.repeat(64))).toBe(true)
    expect(await screen.findByText('Yeni hesaplama taslağı ve sürümü oluşturuldu.')).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: /insan onayına gönderiyorum/ }))
    await user.click(screen.getByRole('button', { name: 'Onaya Gönder' }))
    await waitFor(() => expect(port.submit).toHaveBeenCalledTimes(1))

    await user.click(await screen.findByRole('checkbox', { name: /insan olarak inceledim/ }))
    await user.type(screen.getByLabelText('Onay / red gerekçesi'), 'Kanıtlar insan tarafından kontrol edildi.')
    await user.click(screen.getByRole('button', { name: 'İnsan Onayı Ver' }))
    await waitFor(() => expect(port.approve).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('İnsan onaylı sonuç')).toBeInTheDocument()
    expect(screen.getByText('Hesap v1')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Nihai rapor notu (isteğe bağlı)'), 'Sentetik nihai rapor notu.')
    await user.click(screen.getByRole('button', { name: 'Nihai Raporu Önizle' }))
    await waitFor(() => expect(reportPort.preview).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Trafik Değer Kaybı Nihai Raporu')).toBeInTheDocument()
    expect(screen.getAllByText('2026.07.01.1').length).toBeGreaterThanOrEqual(2)
    await user.click(screen.getByRole('checkbox', { name: /bu önizlemeden nihai PDF/ }))
    await user.click(screen.getByRole('button', { name: 'Onayla ve Nihai PDF Oluştur' }))
    await waitFor(() => expect(reportPort.generate).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Final PDF hazır')).toBeInTheDocument()
    const downloadButton = screen.getByRole('button', { name: 'PDF İndir' })
    expect(downloadButton).toBeEnabled()
    vi.mocked(reportPort.download).mockRejectedValueOnce(
      new TrafficValueLossReportError('unavailable', 'network'),
    )
    await user.click(downloadButton)
    expect(await screen.findByText('Nihai rapor servisine ulaşılamadı. Mock çıktıya geçilmedi.')).toBeInTheDocument()
    expect(screen.queryByText('PDF çıktısı tarayıcıya aktarılamadı.')).not.toBeInTheDocument()
  }, 25_000)

  it('API kesintisinde mock sonuç göstermez ve Kasko dosyasında destek dışı sınırı korur', async () => {
    const unavailable: TrafficValueLossDataPort = {
      load: vi.fn().mockRejectedValue(new TrafficValueLossError('unavailable', 'network')),
      createVersion: vi.fn(),
      submit: vi.fn(),
      approve: vi.fn(),
      reject: vi.fn(),
    }
    const view = renderModule(unavailable)
    expect(await screen.findByText('Bağlantı kurulamadı')).toBeInTheDocument()
    expect(screen.getByText(/mock sonuç gösterilmedi/)).toBeInTheDocument()
    view.unmount()

    const casco = { ...item, type: 'Kasko' as const }
    renderModule(unavailable, casco)
    expect(screen.getByText('Kasko değer kaybı bu akışta desteklenmiyor')).toBeInTheDocument()
    expect(unavailable.load).toHaveBeenCalledTimes(1)
  })

  it('bloklayan belirsizlikleri görünür tutar ve submit işlemini kapalı bırakır', async () => {
    const input: TrafficValueLossDraftInput = {
      evaluatedOn: '2026-07-16',
      heavyOrTotalDamage: null,
      vehicle: { make: null, model: null, variant: null, modelYear: null, mileage: null, usageType: null },
      faultRateBasisPoints: null,
      preAccidentMarketValueMinor: null,
      postRepairMarketValueMinor: null,
      damageParts: [],
      comparables: [],
      evidence: [],
    }
    const baseVersion = versionFrom(input, 'control_required')
    const controlVersion: TrafficValueLossVersionRecord = {
      ...baseVersion,
      evaluation: {
        ...baseVersion.evaluation,
        eligibilityStatus: 'control_required',
        grossValueLossMinor: null,
        faultAdjustedValueLossMinor: null,
        qualifyingPreComparableCount: 0,
        qualifyingPostComparableCount: 0,
        uncertainties: [{
          code: 'missing_vehicle_identity',
          field: 'vehicle',
          reason: 'Araç kimliği doğrulanmış kanıtla tamamlanmalıdır.',
          blocking: true,
          requiresHumanReview: true,
        }],
        canSubmitForApproval: false,
      },
    }
    const assessment: TrafficValueLossAssessmentRecord = {
      id: '019fa000-0000-7000-8000-000000000008',
      caseId: CASE_ID,
      currentVersion: controlVersion,
      version: 1,
      createdAt: '2026-07-16T08:00:00.000Z',
      updatedAt: '2026-07-16T08:00:00.000Z',
    }
    const port: TrafficValueLossDataPort = {
      load: vi.fn().mockResolvedValue({ assessment, versions: [controlVersion] }),
      createVersion: vi.fn(),
      submit: vi.fn(),
      approve: vi.fn(),
      reject: vi.fn(),
    }
    renderModule(port)
    expect(await screen.findByText('missing_vehicle_identity')).toBeInTheDocument()
    expect(screen.getByText('Araç kimliği doğrulanmış kanıtla tamamlanmalıdır.')).toBeInTheDocument()
    expect(screen.getByText(/Belirsizlikler çözülmeden onaya gönderilemez/)).toBeInTheDocument()
    expect(port.submit).not.toHaveBeenCalled()
  })
})
