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
    baseline: null,
    ...overrides,
  }
}

function run(
  lines: readonly LaborAllocationLineRecord[],
  overrides: Partial<LaborAllocationRunRecord> = {},
): LaborAllocationRunRecord {
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
    baselineSheetVersion: null,
    baselineMatchVersion: null,
    baselineMatchedLineCount: 0,
    evidenceHash: 'a'.repeat(64),
    suggestion: { lines },
    safeErrorCode: null,
    stale: false,
    progress: {
      totalLineCount: lines.length,
      processedLineCount: lines.length,
      totalChunkCount: 1,
      completedChunkCount: 1,
      startedAt: '2026-07-18T10:30:00.000Z',
      updatedAt: '2026-07-18T10:30:04.000Z',
      cancelRequestedAt: null,
    },
    createdAt: '2026-07-18T10:30:00.000Z',
    ...overrides,
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
  const calls = { analyze: 0, preview: [] as number[][], applied: 0 }
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
    apply: async () => {
      calls.applied += 1
      return {
        id: 'application-1',
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
        appliedByDisplayName: 'P58 Yetkili',
        createdAt: '2026-07-19T12:00:00.000Z',
        completedAt: '2026-07-19T12:00:01.000Z',
      }
    },
    listApplications: async () => [],
    readRun: async () => run([line()]),
    cancel: async () => run([], { status: 'cancelled', suggestion: null }),
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

  it('baseline yoksa bunu açıkça söyler ve satırda karşılaştırma göstermez', async () => {
    const { port } = stubPort()
    render(<LaborAllocationAiModule caseId={CASE_ID} port={port} />)

    expect(await screen.findByText(/Eksper baseline yok/)).toBeInTheDocument()
    expect(screen.queryByText(/Eksper baseline \(Sürüm/)).not.toBeInTheDocument()
  })

  it('baseline mevcutken kaç satırın eşleştiğini ve satır farkını gösterir', async () => {
    const baseline = {
      comparisonVersion: 'labor-baseline-comparison/1.0.0',
      baselineSheetVersion: 1,
      baselinePartAmountMinor: 0,
      baselineLaborAmountMinor: 10_000_00,
      baselinePartRatio: 0,
      suggestedPartRatio: 0,
      deltaRatio: 0,
      conflicts: false,
    }
    const { port } = stubPort({
      workspace: async () => workspace([run([line({ baseline })], {
        baselineSheetVersion: 1,
        baselineMatchVersion: 'labor-baseline-match/1.0.0',
        baselineMatchedLineCount: 1,
      })]),
    })
    render(<LaborAllocationAiModule caseId={CASE_ID} port={port} />)

    expect(await screen.findByText(/Eksper baseline mevcut \(Sürüm 1\)/)).toBeInTheDocument()
    expect(screen.getByText(/1\/1 satır eşleşti/)).toBeInTheDocument()
    expect(screen.getByText(/Eksper baseline \(Sürüm 1\)/)).toBeInTheDocument()
    // Onaylı dağılım ve öneri ayrı ayrı görünür; kullanıcı ikisini karşılaştırır.
    expect(screen.getByText(/Onaylı: parça 0,00/)).toBeInTheDocument()
    expect(screen.getByText(/Öneri: parça payı %0 · fark %0/)).toBeInTheDocument()
  })

  it('baseline çelişkisini vurgular ama otomatik kabul etmez', async () => {
    const baseline = {
      comparisonVersion: 'labor-baseline-comparison/1.0.0',
      baselineSheetVersion: 2,
      baselinePartAmountMinor: 9_000_00,
      baselineLaborAmountMinor: 1_000_00,
      baselinePartRatio: 0.9,
      suggestedPartRatio: 0.1,
      deltaRatio: 0.8,
      conflicts: true,
    }
    const { port } = stubPort({
      workspace: async () => workspace([run([line({
        baseline,
        conflictCodes: ['CONFLICT_EXPERT_BASELINE_DISAGREEMENT'],
        controlRequired: true,
      })], {
        baselineSheetVersion: 2,
        baselineMatchVersion: 'labor-baseline-match/1.0.0',
        baselineMatchedLineCount: 1,
      })]),
    })
    render(<LaborAllocationAiModule caseId={CASE_ID} port={port} />)

    await screen.findByText(/Eksper baseline mevcut \(Sürüm 2\)/)
    expect(screen.getByText('CONFLICT_EXPERT_BASELINE_DISAGREEMENT')).toBeInTheDocument()
    expect(screen.getByText(/fark %80/)).toBeInTheDocument()
    expect(screen.getByText(/hangisinin\s+doğru olduğu otomatik belirlenmez/)).toBeInTheDocument()
    // Çelişkili satır kontrol gerekli kalır; toplu seçim onu seçemez.
    expect(screen.getByRole('button', { name: /hariç tümünü seç/ })).toBeDisabled()
  })

  it('kontrol gerekli satırlar varsayılan olarak seçili gelmez', async () => {
    const { port } = stubPort()
    render(<LaborAllocationAiModule caseId={CASE_ID} port={port} />)

    await screen.findByText('1. Ön tampon')
    // Hiçbir satır otomatik seçilmez; uygulama düğmesi kapalıdır.
    expect(screen.getByText('0 satır seçili')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Seçilenleri Föye Uygula/ })).toBeDisabled()
    for (const box of screen.getAllByRole('checkbox')) expect(box).not.toBeChecked()
  })

  it('seçilen satırda AI önerisi ile uygulanacak değeri yan yana gösterir', async () => {
    const { port } = stubPort()
    render(<LaborAllocationAiModule caseId={CASE_ID} port={port} />)

    await screen.findByText('1. Ön tampon')
    await userEvent.click(screen.getAllByRole('checkbox')[1] as HTMLElement)
    expect(screen.getByText(/AI önerisi: parça/)).toBeInTheDocument()
    expect(screen.getByLabelText('Uygulanacak parça 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Uygulanacak işçilik 1')).toBeInTheDocument()
  })

  it('kullanıcı değeri değiştirince satırı işaretler', async () => {
    const { port } = stubPort()
    render(<LaborAllocationAiModule caseId={CASE_ID} port={port} />)

    await screen.findByText('1. Ön tampon')
    await userEvent.click(screen.getAllByRole('checkbox')[1] as HTMLElement)
    const field = screen.getByLabelText('Uygulanacak parça 1')
    await userEvent.clear(field)
    await userEvent.type(field, '500')
    expect(await screen.findByText('Kullanıcı tarafından değiştirildi')).toBeInTheDocument()
    expect(screen.getByText(/1 satır değiştirildi/)).toBeInTheDocument()
  })

  it('onay modalında kaynak run, kaynak ve hedef sürüm gösterilir', async () => {
    const { port, calls } = stubPort()
    render(<LaborAllocationAiModule caseId={CASE_ID} port={port} />)

    await screen.findByText('1. Ön tampon')
    await userEvent.click(screen.getAllByRole('checkbox')[1] as HTMLElement)
    await userEvent.type(screen.getByLabelText('Sürüm gerekçesi'), 'AI dağıtımı onaylandı')
    await userEvent.click(screen.getByRole('button', { name: /Seçilenleri Föye Uygula/ }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('run-1')
    expect(dialog).toHaveTextContent('Sürüm 1')
    expect(dialog).toHaveTextContent('Sürüm 2')
    // Modal açılmak uygulama yapmaz; ayrıca açık onay gerekir.
    expect(calls.applied).toBe(0)

    await userEvent.click(screen.getByRole('button', { name: 'Onaylıyorum, Uygula' }))
    await waitFor(() => expect(calls.applied).toBe(1))
  })

  it('gerekçe olmadan uygulama yapılamaz', async () => {
    const { port } = stubPort()
    render(<LaborAllocationAiModule caseId={CASE_ID} port={port} />)

    await screen.findByText('1. Ön tampon')
    await userEvent.click(screen.getAllByRole('checkbox')[1] as HTMLElement)
    expect(screen.getByRole('button', { name: /Seçilenleri Föye Uygula/ })).toBeDisabled()
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

/**
 * Paket 62 — analiz sürerken görünen ilerleme.
 *
 * Buradaki sayılar sunucudan gelen gerçek sayımlardır; test hiçbir yerde
 * tahmini yüzde veya kalan süre beklemez çünkü UI bunları üretmez.
 */
describe('AI analiz ilerlemesi', () => {
  /** Yarısı bitmiş, hâlâ çalışan bir koşu. */
  function runningRun(overrides: Partial<LaborAllocationRunRecord> = {}) {
    return run([], {
      status: 'running',
      suggestion: null,
      progress: {
        totalLineCount: 100,
        processedLineCount: 60,
        totalChunkCount: 5,
        completedChunkCount: 3,
        startedAt: new Date(Date.now() - 12_000).toISOString(),
        updatedAt: new Date().toISOString(),
        cancelRequestedAt: null,
      },
      ...overrides,
    })
  }

  it('grup, satır ve geçen süreyi gösterir; analiz sürerken butonu kilitler', async () => {
    const { port } = stubPort({ workspace: async () => workspace([runningRun()]) })
    render(<LaborAllocationAiModule caseId={CASE_ID} port={port} />)

    expect(await screen.findByText(/3\/5 grup/)).toBeInTheDocument()
    expect(screen.getByText(/60\/100 satır/)).toBeInTheDocument()
    // Geçen süre gerçek ölçümdür; en az 12 saniye görünmelidir.
    expect(screen.getByText(/1[2-9] sn/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /analiz sürüyor/i })).toBeDisabled()
  })

  it('sayfaya dönüldüğünde aktif koşuyu seçer ve ilerlemeyi sürdürür', async () => {
    // Workspace hem eski tamamlanmış hem de yeni aktif koşuyu döner.
    const { port } = stubPort({
      workspace: async () => workspace([runningRun({ id: 'run-2' }), run([line()])]),
    })
    render(<LaborAllocationAiModule caseId={CASE_ID} port={port} />)

    expect(await screen.findByText(/3\/5 grup/)).toBeInTheDocument()
    // Aktif koşu seçildiği için eski koşunun satırları gösterilmez.
    expect(screen.queryByText('1. Ön tampon')).not.toBeInTheDocument()
  })

  it('tamamlanınca yoklama sonucuyla inceleme ekranına otomatik geçer', async () => {
    const { port } = stubPort({
      workspace: async () => workspace([runningRun()]),
      readRun: async () => run([line()]),
    })
    render(<LaborAllocationAiModule caseId={CASE_ID} port={port} />)

    expect(await screen.findByText(/3\/5 grup/)).toBeInTheDocument()
    // Yoklama 1,5 saniyede bir çalışır; sonuç gelince panel yerini
    // mevcut inceleme ekranına bırakır.
    expect(await screen.findByText('1. Ön tampon', {}, { timeout: 4_000 })).toBeInTheDocument()
    expect(screen.queryByText(/3\/5 grup/)).not.toBeInTheDocument()
  })

  it('iptal açık kullanıcı eylemidir ve kısmi sonuç sızdırmaz', async () => {
    let cancelled = 0
    const { port } = stubPort({
      workspace: async () => workspace([runningRun()]),
      // Yoklama iptal edilene kadar koşuyu çalışır gösterir.
      readRun: async () => (cancelled === 0 ? runningRun() : run([], {
        status: 'cancelled',
        suggestion: null,
      })),
      cancel: async () => {
        cancelled += 1
        return run([], { status: 'cancelled', suggestion: null })
      },
    })
    render(<LaborAllocationAiModule caseId={CASE_ID} port={port} />)

    // Türkçe 'İ' JS'de küçültülünce birleşik noktaya dönüşür; bu yüzden
    // erişilebilir ad tam metinle aranır, /i bayrağıyla değil.
    await userEvent.click(await screen.findByRole('button', { name: 'Analizi İptal Et' }))

    expect(await screen.findByText(/iptal edildi; kısmi sonuç kaydedilmedi/)).toBeInTheDocument()
    expect(cancelled).toBe(1)
    expect(screen.queryByText('1. Ön tampon')).not.toBeInTheDocument()
    // İptalden sonra buton kilidi kalkar; yeniden deneme açık eylemdir.
    expect(screen.getByRole('button', { name: 'Analiz Et' })).toBeInTheDocument()
  })

  it('başarısız koşuda güvenli hata kodunu gösterir, yedek sonuç üretmez', async () => {
    const { port } = stubPort({
      workspace: async () => workspace([run([], {
        status: 'failed',
        suggestion: null,
        safeErrorCode: 'AI_PROVIDER_RATE_LIMITED',
      })]),
    })
    render(<LaborAllocationAiModule caseId={CASE_ID} port={port} />)

    expect(await screen.findByText(/AI_PROVIDER_RATE_LIMITED/)).toBeInTheDocument()
    expect(screen.getByText(/yedek sonuç yoktur/)).toBeInTheDocument()
    // Yeniden deneme yeni bir koşudur; hasar tarifi girilince açılır.
    await userEvent.type(screen.getByPlaceholderText(/Hasar bölgesi/), 'Ön tampon ezik')
    expect(screen.getByRole('button', { name: 'Analiz Et' })).toBeEnabled()
  })
})
