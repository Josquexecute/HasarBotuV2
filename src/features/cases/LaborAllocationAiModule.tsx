import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCheck, GitCompareArrows, ShieldAlert, Sparkles } from 'lucide-react'
import { LoadingState } from '../../components/StateViews'
import { LaborCategoryReview } from './LaborCategoryReview.js'
import {
  effectiveCategoryAmounts,
  type CategoryDraftEntry,
} from './laborCategoryRules.js'
import {
  LaborAllocationClientError,
  LaborExcelProfileClientError,
  createHttpLaborAllocationAdapter,
  createHttpLaborExcelProfileAdapter,
  type LaborAllocationApplicationRecord,
  type LaborAllocationApplyPreviewRecord,
  type LaborExcelProfileCandidatesRecord,
  type LaborExcelProfileDataPort,
  type LaborExcelProjectionRecord,
  type LaborAllocationDataPort,
  type LaborAllocationLineRecord,
  type LaborAllocationRunRecord,
  type LaborAllocationWorkspaceRecord,
} from '../../data'

/**
 * Paket 54 dilim 2 — AI işçilik dağıtımı önizleme paneli.
 *
 * Bu dilimde föy REVİZE EDİLMEZ. Kullanıcı satır bazında kabul/ret yapar ve
 * yalnız seçilmiş sonuçlardan açık onaya gidecek bir önizleme üretilir.
 * Hata halinde sahte sonuç gösterilmez.
 */
const OPERATION_LABELS: Record<string, string> = {
  repair: 'Onarım',
  replace: 'Değişim',
  remove_install: 'Sökme-takma',
  paint: 'Boya',
  consumable: 'Sarf',
  calibration: 'Ayar/kalibrasyon',
  related_operation: 'İlişkili operasyon',
  other: 'Diğer',
}

const OPINION_LABELS: Record<string, string> = {
  repair_indicated: 'Onarım işaret ediyor',
  replace_indicated: 'Değişim işaret ediyor',
  comparable: 'Karşılaştırılabilir',
  insufficient_evidence: 'Kanıt yetersiz',
}

function formatMinor(value: number): string {
  return `${(value / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺`
}

export function LaborAllocationAiModule({ caseId, port, excelPort, onSheetApplied }: {
  readonly caseId: string
  readonly port?: LaborAllocationDataPort
  /** Paket 60: salt okunur Excel projeksiyonu portu. */
  readonly excelPort?: LaborExcelProfileDataPort
  /** Föy uygulandığında tetiklenir; üst modül yeni sürüme geçer. */
  readonly onSheetApplied?: () => void
}) {
  const adapter = useMemo(() => port ?? createHttpLaborAllocationAdapter(), [port])
  const excelAdapter = useMemo(
    () => excelPort ?? createHttpLaborExcelProfileAdapter(),
    [excelPort],
  )
  const [workspace, setWorkspace] = useState<LaborAllocationWorkspaceRecord | null>(null)
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading')
  const [errorKind, setErrorKind] = useState<string | null>(null)
  const [run, setRun] = useState<LaborAllocationRunRecord | null>(null)
  const [damageDescription, setDamageDescription] = useState('')
  const [selected, setSelected] = useState<readonly number[]>([])
  /** Satır sırası -> kategori -> ham kullanıcı girdisi. */
  const [categoryDraft, setCategoryDraft] = useState<Record<number, CategoryDraftEntry>>({})
  const [onlyControlRequired, setOnlyControlRequired] = useState(false)
  const [preview, setPreview] = useState<LaborAllocationApplyPreviewRecord | null>(null)
  const [busy, setBusy] = useState(false)
  /**
   * Paket 58 uygulama durumu. `draft` kullanıcının düzenlediği nihai değerdir;
   * AI önerisi ayrı durur ve yan yana gösterilir.
   */
  const [draft, setDraft] = useState<Record<number, { part: string; labor: string }>>({})
  const [reason, setReason] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [applications, setApplications] = useState<readonly LaborAllocationApplicationRecord[]>([])
  /** Paket 60: salt okunur Excel projeksiyonu; dosyaya yazmaz. */
  const [projection, setProjection] = useState<LaborExcelProjectionRecord | null>(null)
  /** Paket 63: aday profiller, seçim ve projeksiyonun bağlı olduğu uygulama. */
  const [candidates, setCandidates] = useState<LaborExcelProfileCandidatesRecord | null>(null)
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const [projectionApplicationId, setProjectionApplicationId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const [result, history] = await Promise.all([
        adapter.workspace(caseId),
        adapter.listApplications(caseId),
      ])
      setWorkspace(result)
      setApplications(history)
      // Paket 62: önce aktif koşu — sayfadan ayrılıp dönen kullanıcı
      // ilerlemeyi kaldığı yerden görür. Aktif koşu yoksa EN SON koşu
      // gösterilir; başarısız veya iptal edilmiş son deneme sessizce
      // gizlenip yerine eski bir öneri tazeymiş gibi sunulmaz.
      const active = result.runs.find((item) => (
        ['queued', 'running', 'cancel_requested'].includes(item.status)
      )) ?? null
      const latest = active ?? result.runs.at(0) ?? null
      setRun(latest)
      setStatus('ok')
    } catch (error) {
      setWorkspace(null)
      setErrorKind(error instanceof LaborAllocationClientError ? error.kind : 'unavailable')
      setStatus('error')
    }
  }, [adapter, caseId])

  useEffect(() => { void load() }, [load])

  /**
   * Paket 62 — analiz arka planda çalışır; aktif run için durum yoklanır.
   *
   * Sayfadan ayrılıp dönüldüğünde de çalışır: `load` mevcut aktif run'ı
   * getirir ve bu efekt oradan devam eder. Tamamlanınca yoklama durur ve
   * mevcut AI inceleme ekranı kendiliğinden görünür.
   */
  useEffect(() => {
    const active = run !== null
      && ['queued', 'running', 'cancel_requested'].includes(run.status)
    if (!active || run === null) return undefined
    let cancelled = false
    const timer = setInterval(() => {
      void adapter.readRun(caseId, run.id)
        .then((next) => { if (!cancelled) setRun(next) })
        .catch(() => undefined)
    }, 1_500)
    return () => { cancelled = true; clearInterval(timer) }
  }, [adapter, caseId, run])

  /** Aktif analizde geçen süre; tahmin değil, gerçek ölçüm. */
  const [elapsedMs, setElapsedMs] = useState(0)
  useEffect(() => {
    const startedAt = run?.progress.startedAt
    const active = run !== null
      && ['queued', 'running', 'cancel_requested'].includes(run.status)
    if (!active || startedAt === null || startedAt === undefined) return undefined
    const started = new Date(startedAt).getTime()
    setElapsedMs(Date.now() - started)
    const timer = setInterval(() => setElapsedMs(Date.now() - started), 1_000)
    return () => clearInterval(timer)
  }, [run])

  /** Analiz hâlâ sürüyor mu; buton kilidi ve ilerleme paneli buna bakar. */
  const analysisActive = run !== null
    && ['queued', 'running', 'cancel_requested'].includes(run.status)
  const lines = useMemo(() => run?.suggestion?.lines ?? [], [run])
  const visibleLines = onlyControlRequired ? lines.filter((line) => line.controlRequired) : lines
  const selectableOrdinals = useMemo(
    () => lines.filter((line) => !line.controlRequired).map((line) => line.lineOrdinal),
    [lines],
  )

  const analyze = async () => {
    if (workspace?.sourceSheetVersion === null || workspace === null) return
    setBusy(true)
    setPreview(null)
    try {
      const result = await adapter.analyze(caseId, {
        expectedSheetVersion: workspace.sourceSheetVersion as number,
        damageDescription: damageDescription.trim(),
        confirmedEgress: workspace.permissions.requiresExplicitEgressConfirmation,
      })
      setRun(result)
      setSelected([])
      setErrorKind(null)
    } catch (error) {
      setErrorKind(error instanceof LaborAllocationClientError ? error.kind : 'unavailable')
    } finally {
      setBusy(false)
    }
  }

  /** Aktif analizi iptal etmeyi DENER; açık kullanıcı eylemidir. */
  const cancelRun = async () => {
    if (run === null) return
    setBusy(true)
    try {
      setRun(await adapter.cancel(caseId, run.id))
      setErrorKind(null)
    } catch (error) {
      setErrorKind(error instanceof LaborAllocationClientError ? error.kind : 'unavailable')
    } finally {
      setBusy(false)
    }
  }

  const buildPreview = async () => {
    if (run === null || workspace?.sourceSheetVersion === null || workspace === null) return
    setBusy(true)
    try {
      setPreview(await adapter.applyPreview(caseId, run.id, {
        expectedSheetVersion: workspace.sourceSheetVersion as number,
        selectedLineOrdinals: selected,
      }))
      setErrorKind(null)
    } catch (error) {
      setPreview(null)
      setErrorKind(error instanceof LaborAllocationClientError ? error.kind : 'unavailable')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Paket 63 — dosyanın sigorta şirketine ait aday profilleri getirir.
   *
   * Paket 60'taki "listedeki ilk profili al" davranışı kaldırıldı: o davranış
   * başka bir şirketin şablonunu sessizce seçebiliyordu. Artık aday kümesi
   * sunucuda süzülür ve seçim kullanıcınındır.
   */
  const openProjection = async (applicationId: string) => {
    setBusy(true)
    try {
      const result = await excelAdapter.candidates(caseId)
      setCandidates(result)
      setProjectionApplicationId(applicationId)
      setProjection(null)
      // Öneri varsa ön-seçili gelir ama KESİNLEŞMEZ; kullanıcı onaylamalıdır.
      setSelectedProfileId(result.suggestedProfileId)
      setErrorKind(null)
    } catch (error) {
      setCandidates(null)
      setProjection(null)
      setErrorKind(error instanceof LaborAllocationClientError ? error.kind : 'unavailable')
    } finally {
      setBusy(false)
    }
  }

  /** Seçilen profille projeksiyonu hesaplar; açık kullanıcı eylemidir. */
  const runProjection = async (profileId: string) => {
    if (projectionApplicationId === null) return
    setBusy(true)
    try {
      setProjection(await excelAdapter.project(caseId, projectionApplicationId, profileId))
      setErrorKind(null)
    } catch (error) {
      setProjection(null)
      setErrorKind(error instanceof LaborExcelProfileClientError ? error.kind : 'unavailable')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Profil değişince eski projeksiyon geçersizdir; bayat sayı gösterilmez.
   * Profil sürümü değişmiş veya profil pasifleşmişse de aynı kural geçerlidir
   * (aday listesi yeniden okunduğunda fark edilir).
   */
  const chooseProfile = (profileId: string) => {
    setSelectedProfileId(profileId)
    setProjection(null)
  }

  /** Seçili profilin aday kaydı; eşleşme önizlemesi bundan beslenir. */
  const selectedCandidate = candidates?.candidates.find(
    (item) => item.profileId === selectedProfileId,
  ) ?? null

  /**
   * Projeksiyon bayat mı? Hesaplandıktan sonra profil sürümü değişmiş veya
   * profil aday olmaktan çıkmışsa (pasifleşme) sayılar artık güvenilmez.
   */
  const projectionStale = projection !== null && (
    selectedCandidate === null
    || selectedCandidate.profileId !== projection.profileId
    || selectedCandidate.profileVersion !== projection.profileVersion
  )

  const toggle = (ordinal: number) => {
    setSelected((current) => current.includes(ordinal)
      ? current.filter((item) => item !== ordinal)
      : [...current, ordinal].sort((left, right) => left - right))
  }

  /** Düzenlenmemiş satır AI'nin önerdiği kaynak tutarı taşır. */
  const draftValue = (line: LaborAllocationLineRecord, field: 'part' | 'labor'): string => {
    const entry = draft[line.lineOrdinal]
    if (entry !== undefined) return entry[field]
    const minor = field === 'part' ? line.sourcePartAmountMinor : line.sourceLaborAmountMinor
    return minor === 0 ? '' : String(minor / 100)
  }

  const parseMinor = (value: string): number | null => {
    const trimmed = value.trim()
    if (trimmed === '') return 0
    const parsed = Number(trimmed.replace(',', '.'))
    if (!Number.isFinite(parsed) || parsed < 0) return null
    return Math.round(parsed * 100)
  }

  const appliedLines = useMemo(() => selected.map((ordinal) => {
    const line = lines.find((item) => item.lineOrdinal === ordinal)
    if (line === undefined) return null
    const entry = draft[ordinal]
    const part = entry === undefined
      ? line.sourcePartAmountMinor
      : parseMinor(entry.part)
    const labor = entry === undefined
      ? line.sourceLaborAmountMinor
      : parseMinor(entry.labor)
    if (part === null || labor === null) return null
    /*
     * P64 — kullanıcının düzelttiği kategori dağılımı yalnız GEÇERLİYSE
     * gönderilir. Toplam işçilik tutarını tutmuyorsa satır uygulanabilir
     * sayılmaz; sistem farkı hiçbir kategoriye aktarmaz.
     */
    const categoryEdited = categoryDraft[ordinal] !== undefined
    const categoryAmounts = categoryEdited
      ? effectiveCategoryAmounts(line, categoryDraft[ordinal])
      : null
    const categoryTotal = categoryAmounts === null
      ? null
      : categoryAmounts.reduce((sum, item) => sum + item.amountMinor, 0)
    const categoryValid = !categoryEdited || categoryTotal === labor
    return {
      lineOrdinal: ordinal,
      description: line.sourceDescription,
      action: line.sourceAction,
      partAmountMinor: part,
      laborAmountMinor: labor,
      modified: part !== line.sourcePartAmountMinor || labor !== line.sourceLaborAmountMinor,
      categoryAmounts: categoryEdited && categoryValid && categoryAmounts !== null
        ? categoryAmounts
        : undefined,
      categoryValid,
    }
  }).filter((item) => item !== null), [selected, lines, draft, categoryDraft])

  const applyBlocked = appliedLines.length !== selected.length
    || appliedLines.some((line) => line.partAmountMinor + line.laborAmountMinor <= 0)
    // Kategori toplamı işçilik tutarını tutmuyorsa uygulama açılmaz.
    || appliedLines.some((line) => !line.categoryValid)
    || reason.trim() === ''

  const applyNow = async () => {
    if (run === null || workspace?.sourceSheetVersion === null || workspace === null) return
    setBusy(true)
    try {
      await adapter.apply(caseId, run.id, {
        expectedSheetVersion: workspace.sourceSheetVersion as number,
        reason: reason.trim(),
        confirmed: true,
        lines: appliedLines.map((line) => ({
          lineOrdinal: line.lineOrdinal,
          description: line.description,
          action: line.action,
          partAmountMinor: line.partAmountMinor,
          laborAmountMinor: line.laborAmountMinor,
          // Kullanıcı dağılımı düzeltmediyse alan hiç gönderilmez; sunucu
          // öneriyi olduğu gibi uygular ve UI dağılım uydurmuş olmaz.
          ...(line.categoryAmounts === undefined
            ? {}
            : { categoryAmounts: line.categoryAmounts }),
        })),
      })
      setConfirmOpen(false)
      setErrorKind(null)
      setSelected([])
      setDraft({})
      setReason('')
      setPreview(null)
      // Föy değişti: çalışma alanı ve provenance yeniden okunur, üst modül
      // yeni sürüme geçer.
      await load()
      onSheetApplied?.()
    } catch (error) {
      setErrorKind(error instanceof LaborAllocationClientError ? error.kind : 'unavailable')
    } finally {
      setBusy(false)
    }
  }

  if (status === 'loading') return <LoadingState label="AI dağıtım çalışma alanı yükleniyor" />
  if (status === 'error' || workspace === null) {
    return (
      <div className="dashboard-state" role="alert">
        <AlertTriangle size={24} />
        <strong>AI dağıtım verisi alınamadı</strong>
        <span>
          {errorKind === 'unauthorized'
            ? 'Oturum gerekli. Sahte sonuç gösterilmiyor.'
            : 'API veya ağ bağlantısını kontrol edin. Sahte sonuç üretilmedi.'}
        </span>
      </div>
    )
  }

  return (
    <section className="allocation-panel" aria-label="AI işçilik dağıtımı">
      <header className="allocation-panel__head">
        <div>
          <h3><Sparkles size={16} aria-hidden="true" /> AI İşçilik Dağıtımı</h3>
          <small>
            Taksonomi {workspace.operationTypesVersion} · Kaynak föy sürümü{' '}
            {workspace.sourceSheetVersion ?? '—'} · {workspace.sourceLineCount} satır
          </small>
        </div>
      </header>

      {workspace.sourceSheetId === null ? (
        <p className="allocation-panel__notice">Analiz için önce işçilik föyü oluşturulmalıdır.</p>
      ) : (
        <div className="allocation-panel__controls">
          <label className="field">
            <span>Hasar tarifi</span>
            <textarea
              value={damageDescription}
              onChange={(event) => setDamageDescription(event.target.value)}
              placeholder="Hasar bölgesi ve gözlemler..."
              rows={2}
            />
          </label>
          <button
            className="button button--primary"
            type="button"
            disabled={
              busy || analysisActive
              || damageDescription.trim() === '' || !workspace.permissions.canAnalyze
            }
            onClick={() => void analyze()}
          >
            {analysisActive ? 'Analiz sürüyor…' : (busy ? 'Çalışıyor…' : 'Analiz Et')}
          </button>
        </div>
      )}

      {/*
        Paket 62 — GERÇEK ilerleme. Sahte yüzde veya tahmini kalan süre yoktur;
        yalnız tamamlanan grup, işlenen satır ve gerçekten geçen süre gösterilir.
      */}
      {analysisActive && run !== null && (
        <div className="allocation-progress" role="status" aria-live="polite">
          <strong>
            {run.status === 'cancel_requested'
              ? 'İptal isteği gönderildi; sonuç doğrulanıyor…'
              : 'AI dağıtımı hesaplanıyor…'}
          </strong>
          <span>
            {run.progress.completedChunkCount}/{run.progress.totalChunkCount} grup
            {' · '}
            {run.progress.processedLineCount}/{run.progress.totalLineCount} satır
            {' · '}
            {Math.floor(elapsedMs / 1000)} sn
          </span>
          <small>
            Sayfadan ayrılabilirsiniz; analiz sunucuda devam eder ve
            döndüğünüzde kaldığı yerden görünür.
          </small>
          <button
            className="button button--secondary"
            type="button"
            disabled={busy || run.status === 'cancel_requested'}
            onClick={() => void cancelRun()}
          >
            Analizi İptal Et
          </button>
        </div>
      )}

      {errorKind !== null && (
        <p className="allocation-panel__error" role="alert">
          İstek tamamlanamadı ({errorKind}). Sahte sonuç üretilmedi.
        </p>
      )}

      {run !== null && !analysisActive && run.status !== 'review_required' && (
        <p className="allocation-panel__error" role="alert">
          {run.status === 'cancelled'
            ? 'Analiz iptal edildi; kısmi sonuç kaydedilmedi.'
            : `Analiz sonuç üretmedi: ${run.safeErrorCode ?? run.status}. Kural tabanlı yedek sonuç yoktur.`}
        </p>
      )}

      {run !== null && run.stale && (
        <p className="allocation-panel__error" role="alert">
          Kaynak föy bu analizden sonra değişti; yeniden analiz gerekir.
        </p>
      )}

      {/*
        Paket 57: baseline'ın varlığı ve kaç satırın güvenle eşleştiği açıkça
        gösterilir. "Kısmen eşleşti" durumu gizlenmez; belirsiz eşleşen satırda
        baseline varmış gibi davranılmaz.
      */}
      {run !== null && run.status === 'review_required' && (
        <p className="allocation-panel__baseline">
          {run.baselineSheetVersion === null
            ? 'Eksper baseline yok: bu dosyada karşılaştırılabilir önceki onaylı föy sürümü bulunmuyor.'
            : `Eksper baseline mevcut (Sürüm ${run.baselineSheetVersion}) · ${run.baselineMatchedLineCount}/${lines.length} satır eşleşti`}
        </p>
      )}

      {lines.length > 0 && (
        <>
          <div className="allocation-panel__toolbar">
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={onlyControlRequired}
                onChange={(event) => setOnlyControlRequired(event.target.checked)}
              />
              <span>Yalnız kontrol gerekli satırlar</span>
            </label>
            <button
              className="button button--secondary"
              type="button"
              disabled={selectableOrdinals.length === 0}
              onClick={() => setSelected(selectableOrdinals)}
            >
              <CheckCheck size={14} /> Kontrol gerekli olanlar hariç tümünü seç
            </button>
            <button className="button button--secondary" type="button" onClick={() => setSelected([])}>
              Seçimi temizle
            </button>
            <span className="allocation-panel__count">{selected.length} satır seçili</span>
          </div>

          <ul className="allocation-lines" aria-label="Satır önerileri">
            {visibleLines.map((line: LaborAllocationLineRecord) => (
              <li
                key={line.lineOrdinal}
                className={line.controlRequired ? 'allocation-line allocation-line--control' : 'allocation-line'}
              >
                <label className="allocation-line__select">
                  <input
                    type="checkbox"
                    checked={selected.includes(line.lineOrdinal)}
                    onChange={() => toggle(line.lineOrdinal)}
                    aria-label={`${line.lineOrdinal}. satırı seç`}
                  />
                </label>
                <div className="allocation-line__body">
                  <strong>{line.lineOrdinal}. {line.sourceDescription}</strong>
                  <small>{line.sourceAction}</small>
                  <div className="allocation-line__allocations">
                    {line.allocations.map((allocation) => (
                      <span key={allocation.operationType}>
                        {OPERATION_LABELS[allocation.operationType] ?? allocation.operationType}
                        {' · '}{formatMinor(allocation.amountMinor)}
                      </span>
                    ))}
                  </div>
                  <p className="allocation-line__reasoning">{line.reasoning}</p>
                  <div className="allocation-line__economics">
                    <span>{OPINION_LABELS[line.repairReplaceOpinion] ?? line.repairReplaceOpinion}</span>
                    <span>Onarım {formatMinor(line.economicComparison.repairTotalMinor)}</span>
                    <span>Değişim {formatMinor(line.economicComparison.replaceTotalMinor)}</span>
                    <small>{line.economicComparison.note}</small>
                  </div>
                  {/*
                    Paket 57: eksper baseline karşılaştırması. Baseline otomatik
                    doğru sayılmaz; fark yalnız gösterilir, otomatik kabul yok.
                  */}
                  {/*
                    Paket 58: satır seçilince AI önerisi ile uygulanacak nihai
                    değer YAN YANA gösterilir ve kullanıcı değeri düzenleyebilir.
                  */}
                  {selected.includes(line.lineOrdinal) && (
                    <div className="allocation-apply-line">
                      <span className="allocation-apply-line__suggested">
                        AI önerisi: parça {formatMinor(line.sourcePartAmountMinor)}
                        {' · '}işçilik {formatMinor(line.sourceLaborAmountMinor)}
                      </span>
                      <label className="allocation-apply-line__field">
                        <span>Uygulanacak parça (₺)</span>
                        <input
                          aria-label={`Uygulanacak parça ${line.lineOrdinal}`}
                          inputMode="decimal"
                          value={draftValue(line, 'part')}
                          onChange={(event) => setDraft((current) => ({
                            ...current,
                            [line.lineOrdinal]: {
                              part: event.target.value,
                              labor: draftValue(line, 'labor'),
                            },
                          }))}
                        />
                      </label>
                      <label className="allocation-apply-line__field">
                        <span>Uygulanacak işçilik (₺)</span>
                        <input
                          aria-label={`Uygulanacak işçilik ${line.lineOrdinal}`}
                          inputMode="decimal"
                          value={draftValue(line, 'labor')}
                          onChange={(event) => setDraft((current) => ({
                            ...current,
                            [line.lineOrdinal]: {
                              part: draftValue(line, 'part'),
                              labor: event.target.value,
                            },
                          }))}
                        />
                      </label>
                      {appliedLines.find((item) => item.lineOrdinal === line.lineOrdinal)?.modified && (
                        <strong className="allocation-apply-line__modified">
                          Kullanıcı tarafından değiştirildi
                        </strong>
                      )}
                    </div>
                  )}
                  {selected.includes(line.lineOrdinal) && (
                    <LaborCategoryReview
                      line={line}
                      appliedLaborAmountMinor={
                        appliedLines.find((item) => item.lineOrdinal === line.lineOrdinal)
                          ?.laborAmountMinor ?? line.sourceLaborAmountMinor
                      }
                      draft={categoryDraft[line.lineOrdinal]}
                      onChange={(category, value) => setCategoryDraft((current) => {
                        // İlk düzenlemede taslak AI önerisinden doldurulur ki
                        // dokunulmayan kategoriler sıfıra düşmesin.
                        const existing = current[line.lineOrdinal]
                          ?? Object.fromEntries((line.categoryAllocation?.amounts ?? [])
                            .map((item) => [item.category, (item.amountMinor / 100).toFixed(2)]))
                        return {
                          ...current,
                          [line.lineOrdinal]: { ...existing, [category]: value },
                        }
                      })}
                    />
                  )}
                  {line.baseline !== null && (
                    <div
                      className={line.baseline.conflicts
                        ? 'allocation-baseline allocation-baseline--conflict'
                        : 'allocation-baseline'}
                    >
                      <strong>
                        <GitCompareArrows size={12} aria-hidden="true" />
                        {' '}Eksper baseline (Sürüm {line.baseline.baselineSheetVersion})
                      </strong>
                      <span>
                        Onaylı: parça {formatMinor(line.baseline.baselinePartAmountMinor)}
                        {' · '}işçilik {formatMinor(line.baseline.baselineLaborAmountMinor)}
                        {' · '}parça payı %{(line.baseline.baselinePartRatio * 100).toFixed(0)}
                      </span>
                      <span>
                        Öneri: parça payı %{(line.baseline.suggestedPartRatio * 100).toFixed(0)}
                        {' · '}fark %{(line.baseline.deltaRatio * 100).toFixed(0)}
                      </span>
                      {line.baseline.conflicts && (
                        <small>
                          Öneri, eksperin onayladığı dağılımdan belirgin ayrışıyor; hangisinin
                          doğru olduğu otomatik belirlenmez, satır kontrol gerektirir.
                        </small>
                      )}
                    </div>
                  )}
                  <div className="allocation-line__meta">
                    <span>Güven {(line.confidence * 100).toFixed(0)}%</span>
                    {line.evidenceRefs.length > 0 && <span>Kanıt: {line.evidenceRefs.join(', ')}</span>}
                    {line.conflictCodes.map((code) => <span key={code} className="allocation-code">{code}</span>)}
                    {line.missingEvidenceCodes.map((code) => (
                      <span key={code} className="allocation-code">{code}</span>
                    ))}
                    {line.controlRequired && (
                      <span className="allocation-code allocation-code--control">
                        <ShieldAlert size={12} /> control_required
                      </span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <div className="allocation-panel__apply">
            <button
              className="button button--primary"
              type="button"
              disabled={busy || selected.length === 0 || run?.stale === true}
              onClick={() => void buildPreview()}
            >
              Seçilenlerden önizleme hazırla
            </button>
            {preview !== null && (
              <div className="allocation-preview" role="status">
                <strong>
                  Önizleme hazır: {preview.selectedCount} satır
                  {preview.controlRequiredCount > 0 && ` (${preview.controlRequiredCount} kontrol gerekli)`}
                </strong>
                <span>
                  Föy bu adımda değiştirilmedi. Kesinleşme için açık kullanıcı onayı gerekir.
                </span>
              </div>
            )}
          </div>

          {/* Paket 58: gerçek uygulama. Föyü değiştiren TEK yol budur. */}
          <div className="allocation-panel__apply">
            <label className="field allocation-panel__reason">
              <span>Sürüm gerekçesi</span>
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="AI dağıtımı incelendi ve onaylandı"
              />
            </label>
            <button
              className="button button--primary"
              type="button"
              disabled={busy || selected.length === 0 || applyBlocked || run?.stale === true}
              onClick={() => setConfirmOpen(true)}
            >
              Seçilenleri Föye Uygula
            </button>
            {appliedLines.filter((line) => line.modified).length > 0 && (
              <span className="allocation-panel__count">
                {appliedLines.filter((line) => line.modified).length} satır değiştirildi
              </span>
            )}
          </div>

          {confirmOpen && (
            <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Uygulama onayı">
              <div className="modal modal--small">
                <header className="modal__header"><h2>AI Dağıtımını Föye Uygula</h2></header>
                <div className="modal__body">
                <p>
                  Bu işlem yeni ve değiştirilemez bir işçilik föyü sürümü oluşturur.
                  Uygulanan dağılım kalıcı olarak kaydedilir.
                </p>
                <dl className="allocation-confirm">
                  <div><dt>Kaynak analiz</dt><dd>{run?.id}</dd></div>
                  <div><dt>Kaynak föy sürümü</dt><dd>Sürüm {workspace.sourceSheetVersion}</dd></div>
                  <div>
                    <dt>Hedef föy sürümü</dt>
                    <dd>Sürüm {(workspace.sourceSheetVersion ?? 0) + 1}</dd>
                  </div>
                  <div><dt>Uygulanacak satır</dt><dd>{appliedLines.length}</dd></div>
                  <div>
                    <dt>Değiştirilen satır</dt>
                    <dd>{appliedLines.filter((line) => line.modified).length}</dd>
                  </div>
                  <div>
                    <dt>Kontrol gerekli satır</dt>
                    <dd>
                      {appliedLines.filter((line) => (
                        lines.find((item) => item.lineOrdinal === line.lineOrdinal)?.controlRequired === true
                      )).length}
                    </dd>
                  </div>
                </dl>
                </div>
                <footer className="modal__footer">
                  <button className="button button--secondary" type="button" onClick={() => setConfirmOpen(false)}>
                    Vazgeç
                  </button>
                  <button
                    className="button button--primary"
                    type="button"
                    disabled={busy}
                    onClick={() => void applyNow()}
                  >
                    Onaylıyorum, Uygula
                  </button>
                </footer>
              </div>
            </div>
          )}
        </>
      )}

      {applications.length > 0 && (
        <details className="allocation-applications">
          <summary>Uygulama geçmişi ({applications.length})</summary>
          <ul>
            {applications.map((application) => (
              <li key={application.id}>
                <strong>
                  Sürüm {application.sourceSheetVersion} → {application.targetSheetVersion ?? '—'}
                </strong>
                <span>
                  {application.selectedLineCount} uygulandı
                  {' · '}{application.rejectedLineCount} reddedildi
                  {' · '}{application.modifiedLineCount} değiştirildi
                </span>
                <small>{application.appliedByDisplayName}</small>
                {/*
                  Paket 60: uygulanmış dağıtımın Excel sütunlarına projeksiyonu.
                  SALT OKUNUR — dosyaya yazmaz.
                */}
                {application.status === 'completed' && (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => void openProjection(application.id)}
                  >
                    Excel projeksiyonu
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/*
        Paket 63 — profil seçimi. Otomatik öneri gerçek şablon eşleşmesi
        DEĞİLDİR: Excel dosyası okunmadan yalnız "profil önerisi" denir.
      */}
      {candidates !== null && projection === null && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Excel şablon profili seçimi">
          <div className="modal">
            <header className="modal__header"><h2>Excel Şablon Profili Seç</h2></header>
            <div className="modal__body">
              <p className="allocation-panel__notice">
                Gerçek Excel dosyası HENÜZ okunmadı; aşağıdaki yalnız
                <strong> profil önerisidir</strong>, şablon eşleşmesi değildir.
                Sigorta şirketi: {candidates.insurerName ?? 'tanımsız'}.
              </p>

              {candidates.candidates.length === 0 && (
                <p className="allocation-panel__error" role="alert">
                  {candidates.reason === 'insurer_unknown'
                    ? 'Dosyada sigorta şirketi tanımlı değil ve genel şablon profili yok.'
                    : 'Bu sigorta şirketi için tanımlı aktif şablon profili yok.'}
                  {' '}Yönetim ekranından profil tanımlayın; sahte sütun üretilmez.
                </p>
              )}

              {candidates.candidates.length > 0 && (
                <>
                  <p className="allocation-panel__hint">
                    {candidates.reason === 'single_insurer_profile'
                      ? 'Bu şirket için tek aktif profil bulundu ve önerildi; onaylamadan kesinleşmez.'
                      : 'Birden fazla aday var; profili siz seçmelisiniz.'}
                  </p>
                  <ul className="profile-choice">
                    {candidates.candidates.map((candidate) => (
                      <li key={candidate.profileId}>
                        <label>
                          <input
                            type="radio"
                            name="excel-profile"
                            checked={selectedProfileId === candidate.profileId}
                            onChange={() => chooseProfile(candidate.profileId)}
                          />
                          <span>
                            {candidate.name} · Sürüm {candidate.profileVersion}
                            {candidate.scope === 'generic'
                              ? ' · Genel şablon'
                              : ` · ${candidate.insurerName ?? 'Şirkete bağlı'}`}
                            {candidates.suggestedProfileId === candidate.profileId && ' · Önerilen'}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {selectedCandidate !== null && (
                <section className="profile-preview" aria-label="Profil eşleşme önizlemesi">
                  <h3>Profil Önizlemesi</h3>
                  <dl>
                    <dt>Hedef sayfa</dt>
                    <dd>{selectedCandidate.targetSheet ?? 'Tanımlanmadı'}</dd>
                    <dt>Kimlik doğrulaması</dt>
                    <dd>
                      {[
                        selectedCandidate.identityChecks.plate ? 'Plaka' : null,
                        selectedCandidate.identityChecks.officeNumber ? 'Dosya numarası' : null,
                      ].filter((item) => item !== null).join(', ') || 'Kural tanımlanmadı'}
                    </dd>
                  </dl>
                  <table className="data-table module-table">
                    <thead>
                      <tr><th>Operasyon türü</th><th>Excel sütunu</th></tr>
                    </thead>
                    <tbody>
                      {Object.entries(selectedCandidate.mapping).map(([type, column]) => (
                        <tr key={type}>
                          <td>{OPERATION_LABELS[type] ?? type}</td>
                          <td>
                            {column === null
                              ? <span className="allocation-code">Eşlenmedi</span>
                              : (selectedCandidate.columns.find((item) => item.key === column)?.label
                                ?? column)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {selectedCandidate.unmappedCategories.length > 0 && (
                    <p className="allocation-panel__hint">
                      {selectedCandidate.unmappedCategories.length} dağıtım kategorisi hiçbir
                      sütuna eşlenmemiş; bu türlere düşen tutar hiçbir sütuna yazılamaz.
                    </p>
                  )}
                </section>
              )}
            </div>
            <footer className="modal__footer">
              <button
                className="button"
                type="button"
                onClick={() => { setCandidates(null); setSelectedProfileId(null) }}
              >
                Kapat
              </button>
              <button
                className="button button--primary"
                type="button"
                disabled={busy || selectedProfileId === null}
                onClick={() => { if (selectedProfileId !== null) void runProjection(selectedProfileId) }}
              >
                Bu Profille Önizle
              </button>
            </footer>
          </div>
        </div>
      )}

      {projection !== null && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Excel projeksiyonu">
          <div className="modal">
            <header className="modal__header"><h2>Excel Projeksiyonu</h2></header>
            <div className="modal__body">
              <p className="allocation-panel__notice">
                Bu görünüm hiçbir Excel dosyasına YAZMAZ. Uygulanmış dağıtımın seçilen
                şablonun sütunlarına nasıl düşeceğini gösterir.
                {selectedCandidate !== null && (
                  <> Profil: {selectedCandidate.name} · Sürüm {projection.profileVersion}
                    {' · Hedef sayfa: '}{selectedCandidate.targetSheet ?? 'tanımlanmadı'}
                  </>
                )}
              </p>

              {projectionStale && (
                <p className="allocation-panel__error" role="alert">
                  Profil bu önizleme hesaplandıktan sonra değişti veya pasifleştirildi.
                  Gösterilen sayılar bayattır; profili yeniden seçip önizlemeyi tazeleyin.
                </p>
              )}
              <div className="table-scroll">
                <table className="data-table module-table">
                  <thead>
                    <tr>
                      <th>Kalem</th>
                      {projection.columns.map((column) => <th key={column.key}>{column.label}</th>)}
                      <th>Durum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projection.lines.map((projectionLine) => (
                      <tr key={projectionLine.lineOrdinal}>
                        <td>{projectionLine.lineOrdinal}. {projectionLine.description}</td>
                        {projection.columns.map((column) => (
                          <td key={column.key}>
                            {projectionLine.status === 'manual_entry_required'
                              ? '—'
                              : formatMinor(projectionLine.cells[column.key] ?? 0)}
                          </td>
                        ))}
                        <td>
                          {projectionLine.status === 'manual_entry_required'
                            ? 'Manuel giriş gerekli'
                            : (projectionLine.reviewRequired ? 'Kontrol gerekli' : 'Hazır')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Toplam</td>
                      {projection.columns.map((column) => (
                        <td key={column.key}>{formatMinor(projection.columnTotals[column.key] ?? 0)}</td>
                      ))}
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
              {projection.manualEntryLineCount > 0 && (
                <p className="allocation-panel__error">
                  {projection.manualEntryLineCount} satırda kullanıcı tutarı değiştirdiği için
                  tür bazlı dağılım doğrulanmış değil; bu satırlarda sütun tutarı üretilmez ve
                  manuel giriş gerekir.
                </p>
              )}
              {projection.unmappedTotalMinor > 0 && (
                <p className="allocation-panel__notice">
                  Eşlenmemiş operasyon türlerine {formatMinor(projection.unmappedTotalMinor)} düşüyor;
                  bu tutar hiçbir sütuna yazılmaz.
                </p>
              )}
            </div>
            <footer className="modal__footer">
              <button className="button button--secondary" type="button" onClick={() => setProjection(null)}>
                Kapat
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  )
}
