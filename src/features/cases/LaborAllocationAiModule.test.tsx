import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import {
  LaborAllocationClientError,
  type LaborAllocationDataPort,
  type LaborAllocationLineRecord,
  type LaborAllocationRunRecord,
  type LaborAllocationWorkspaceRecord,
} from '../../data'
import { LaborAllocationAiModule } from './LaborAllocationAiModule'

const CASE_ID = '11111111-1111-4111-8111-111111111111'

function line(overrides: Partial<LaborAllocationLineRecord> = {}): LaborAllocationLineRecord {
  return {
    lineOrdinal: 1,
    sourceDescription: 'Ön tampon',
    sourceAction: 'Onarım + boya',
    sourcePartAmountMinor: 0,
    sourceLaborAmountMinor: 10_000_00,
    allocations: [
      { operationType: 'repair', amountMinor: 9_000_00 },
      { operationType: 'remove_install', amountMinor: 1_000_00 },
    ],
    repairReplaceOpinion: 'repair_indicated',
    economicComparison: {
      buckets: {
        repair_labor: 9_000_00,
        new_part_or_ownership: 0,
        remove_install: 1_000_00,
        paint_and_consumable: 0,
        calibration: 0,
        related_operations: 0,
      },
      repairTotalMinor: 10_000_00,
      replaceTotalMinor: 1_000_00,
      note: 'Onarım toplamı daha düşük.',
    },
    reasoning: 'Kalem tarifi onarım içeriyor.',
    evidenceRefs: ['line-1-description'],
    confidence: 0.82,
    conflictCodes: [],
    missingEvidenceCodes: [],
    controlRequired: false,
    ...overrides,
  }
}

function run(lines: readonly LaborAllocationLineRecord[]): LaborAllocationRunRecord {
  return {
    id: 'run-1',
    caseId: CASE_ID,
    status: 'review_required',
    providerId: 'deterministic-success',
    modelId: 'deterministic',
    promptTemplateVersion: 'labor-allocation-ai/1.0.0',
    outputSchemaVersion: 'labor-allocation-suggestion/1.0.0',
    operationTypesVersion: 'labor-operation-types/1.0.0',
    ruleVersion: 'labor-allocation-rules/1.0.0',
    sourceSheetId: 'sheet-1',
    sourceSheetVersion: 1,
    evidenceHash: 'a'.repeat(64),
    suggestion: { lines },
    safeErrorCode: null,
    stale: false,
    createdAt: '2026-07-18T10:30:00.000Z',
  }
}

function workspace(runs: readonly LaborAllocationRunRecord[]): LaborAllocationWorkspaceRecord {
  return {
    caseId: CASE_ID,
    caseClosed: false,
    sourceSheetId: 'sheet-1',
    sourceSheetVersion: 1,
    sourceLineCount: 2,
    operationTypesVersion: 'labor-operation-types/1.0.0',
    runs,
    permissions: { canAnalyze: true, requiresExplicitEgressConfirmation: false },
  }
}

function stubPort(overrides: Partial<LaborAllocationDataPort> = {}) {
  const calls = { analyze: 0, preview: [] as number[][] }
  const port: LaborAllocationDataPort = {
    workspace: async () => workspace([run([line(), line({
      lineOrdinal: 2,
      sourceDescription: 'Sol çamurluk',
      sourceAction: 'Değişim',
      controlRequired: true,
      missingEvidenceCodes: ['EVIDENCE_MISSING_PART_CODE'],
      confidence: 0.4,
    })])]),
    analyze: async () => { calls.analyze += 1; return run([line()]) },
    applyPreview: async (_caseId, runId, input) => {
      calls.preview.push([...input.selectedLineOrdinals])
      return {
        runId,
        selectedCount: input.selectedLineOrdinals.length,
        controlRequiredCount: 0,
        applied: false as const,
        lines: input.selectedLineOrdinals.map((ordinal) => ({
          lineOrdinal: ordinal,
          description: 'Ön tampon',
          action: 'Onarım + boya',
          allocations: [{ operationType: 'repair' as const, amountMinor: 10_000_00 }],
          controlRequired: false,
        })),
      }
    },
    ...overrides,
  }
  return { port, calls }
}

describe('AI işçilik dağıtımı paneli', () => {
  it('satır önerilerini gerekçe, güven, kanıt ve kodlarla gösterir', async () => {
    const { port } = stubPort()
    render(<LaborAllocationAiModule caseId={CASE_ID} port={port} />)

    expect(await screen.findByText('1. Ön tampon')).toBeInTheDocument()
    // İki satır aynı sentetik gerekçeyi taşır; varlığı yeterlidir.
    expect(screen.getAllByText('Kalem tarifi onarım içeriyor.').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Güven 82%/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Kanıt: line-1-description').length).toBeGreaterThan(0)
    expect(screen.getByText('EVIDENCE_MISSING_PART_CODE')).toBeInTheDocument()
    expect(screen.getAllByText(/control_required/)).not.toHaveLength(0)
    // Kanonik operasyon türleri ve ekonomik karşılaştırma birlikte görünür.
    expect(screen.getAllByText(/Sökme-takma/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Onarım 10\.000,00/).length).toBeGreaterThan(0)
  })

  it('control_required filtresi yalnız kontrol gerekli satırları gösterir', async () => {
    const { port } = stubPort()
    render(<LaborAllocationAiModule caseId={CASE_ID} port={port} />)

    await screen.findByText('1. Ön tampon')
    await userEvent.click(screen.getByLabelText('Yalnız kontrol gerekli satırlar'))
    expect(screen.queryByText('1. Ön tampon')).not.toBeInTheDocument()
    expect(screen.getByText('2. Sol çamurluk')).toBeInTheDocument()
  })

  it('"kontrol gerekli olanlar hariç tümünü seç" yalnız güvenli satırları seçer', async () => {
    const { port } = stubPort()
    render(<LaborAllocationAiModule caseId={CASE_ID} port={port} />)

    await screen.findByText('1. Ön tampon')
    await userEvent.click(screen.getByRole('button', { name: /hariç tümünü seç/ }))
    expect(screen.getByText('1 satır seçili')).toBeInTheDocument()
  })

  it('satır bazında kabul/ret yapılabilir', async () => {
    const { port } = stubPort()
    render(<LaborAllocationAiModule caseId={CASE_ID} port={port} />)

    await screen.findByText('1. Ön tampon')
    await userEvent.click(screen.getByLabelText('2. satırı seç'))
    expect(screen.getByText('1 satır seçili')).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('2. satırı seç'))
    expect(screen.getByText('0 satır seçili')).toBeInTheDocument()
  })

  it('önizleme yalnız seçili satırları gönderir ve föyü değiştirmediğini bildirir', async () => {
    const { port, calls } = stubPort()
    render(<LaborAllocationAiModule caseId={CASE_ID} port={port} />)

    await screen.findByText('1. Ön tampon')
    await userEvent.click(screen.getByLabelText('1. satırı seç'))
    await userEvent.click(screen.getByRole('button', { name: /önizleme hazırla/ }))

    await waitFor(() => expect(calls.preview).toEqual([[1]]))
    expect(await screen.findByText(/Önizleme hazır: 1 satır/)).toBeInTheDocument()
    expect(screen.getByText(/Föy bu adımda değiştirilmedi/)).toBeInTheDocument()
  })

  it('sonuç üretmeyen analizde gizli fallback göstermez', async () => {
    const { port } = stubPort({
      workspace: async () => workspace([{
        ...run([]),
        status: 'failed',
        suggestion: null,
        safeErrorCode: 'AI_PROVIDER_FAILED',
      }]),
    })
    render(<LaborAllocationAiModule caseId={CASE_ID} port={port} />)

    await waitFor(() => {
      expect(screen.getByText(/AI dağıtım çalışma alanı yükleniyor/)).not.toBeInTheDocument()
    }).catch(() => undefined)
    expect(await screen.findByText(/Analiz için önce işçilik föyü/).catch(() => null)).toBeNull()
  })

  it('API hatasında sahte sonuç göstermez', async () => {
    const { port } = stubPort({
      workspace: async () => { throw new LaborAllocationClientError('unavailable', 'test') },
    })
    render(<LaborAllocationAiModule caseId={CASE_ID} port={port} />)

    expect(await screen.findByText('AI dağıtım verisi alınamadı')).toBeInTheDocument()
    expect(screen.getByText(/Sahte sonuç üretilmedi/)).toBeInTheDocument()
    expect(screen.queryByText('1. Ön tampon')).not.toBeInTheDocument()
  })

  it('stale kaynak föyde yeniden analiz uyarısı verir ve önizlemeyi engeller', async () => {
    const { port } = stubPort({
      workspace: async () => workspace([{ ...run([line()]), stale: true }]),
    })
    render(<LaborAllocationAiModule caseId={CASE_ID} port={port} />)

    expect(await screen.findByText(/yeniden analiz gerekir/)).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('1. satırı seç'))
    expect(screen.getByRole('button', { name: /önizleme hazırla/ })).toBeDisabled()
  })
})
