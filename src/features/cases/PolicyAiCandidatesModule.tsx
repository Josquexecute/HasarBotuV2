import { AlertTriangle, BrainCircuit, CheckCircle2, FileSearch, RefreshCw, ShieldAlert, Sparkles } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import {
  usePolicyAi,
  type DataSourceKind,
  type PolicyAiCandidateCategory,
  type PolicyAiRunRecord,
  type PolicyAiSourceOverviewRecord,
  type PolicyAiSourceSelectionRecord,
} from '../../data'

const RUN_LABELS: Record<string, string> = { planned: 'Planlandı', provider_disabled: 'Sağlayıcı kapalı', budget_blocked: 'Bütçe engeli', running: 'Çalışıyor', validating: 'Doğrulanıyor', review_required: 'İnsan incelemesi gerekli', failed: 'Başarısız', stale: 'Geçersiz kaynak', cancelled: 'İptal edildi', superseded: 'Eski sürüm' }
const CATEGORY_LABELS: Record<PolicyAiCandidateCategory, string> = { policy_identity: 'Poliçe kimliği', coverage: 'Teminat', deductible: 'Muafiyet', service_rule: 'Servis kuralı', part_rule: 'Parça kuralı', replacement_vehicle: 'İkame araç', assistance: 'Yardım', valuation: 'Değerleme', exclusion: 'İstisna', required_document: 'Gerekli belge', special_condition: 'Özel şart' }
const QUALITY_LABELS: Record<string, string> = { high: 'Yüksek', medium: 'Orta', low: 'Düşük', control_required: 'İnsan kontrolü gerekli' }
const CONFLICT_LABELS: Record<string, string> = { GENERAL_NO_DEDUCTIBLE_DOES_NOT_OVERRIDE_CONDITIONAL: 'Genel muafiyetsiz ifade koşullu muafiyeti ortadan kaldırmıyor.', DUPLICATE_CANDIDATE: 'Aynı kanıt ve değer birden fazla adayda tekrar ediyor.', PDF_OCR_CONFLICT: 'PDF metni ile OCR kaynağı arasında çelişki var.' }

function warningLabel(code: string): string {
  if (code === 'OCR_HUMAN_REVIEW_REQUIRED') return 'Düşük OCR kalitesi insan kontrolü gerektirir.'
  if (code === 'OCR_READING_ORDER_WARNING') return 'OCR okuma sırası belirsiz; insan kontrolü gerekir.'
  if (code === 'PDF_OCR_CONFLICT') return 'PDF ve OCR kaynakları çelişiyor; otomatik seçim yapılmadı.'
  if (code === 'HISTORICAL_SOURCE_SELECTED') return 'Açıkça seçilmiş tarihsel kaynak kullanılıyor.'
  if (code === 'PDF_PAGE_REQUIRES_OCR') return 'Metin katmanı olmayan sayfalar için OCR gerekir.'
  if (code === 'PDF_PAGE_EXTRACTION_FAILED') return 'Bazı PDF sayfalarının metni çıkarılamadı.'
  if (code === 'PDF_EXTRACTION_NOT_READY') return 'PDF extraction henüz ready değil.'
  if (code === 'OCR_RUN_NOT_READY') return 'OCR sonucu henüz aday kaynağı olmaya hazır değil.'
  if (code === 'OCR_PAGE_NOT_RESOLVED') return 'OCR satırının sayfa kalite kaydı çözümlenemedi.'
  if (code.startsWith('UNTRUSTED_INSTRUCTION_PATTERN_')) return 'Belge içinde talimat benzeri güvenilmeyen metin bulundu; yalnız belge verisi olarak tutuldu.'
  return `Kaynak uyarısı: ${code}`
}

function State({ status, retry }: { status: string; retry: () => void }) {
  const content = status === 'loading' ? ['AI adayları yükleniyor…', 'Kaynak bundle ve doğrulanmış aday kayıtları okunuyor.']
    : status === 'empty' ? ['AI için uygun kaynak yok', 'Önce ready PDF metni veya doğrulanmış OCR satırı oluşturulmalıdır.']
      : status === 'unauthorized' ? ['Oturum gerekli', 'AI adaylarını görmek için yeniden giriş yapın.']
        : status === 'forbidden' ? ['Yetki yetersiz', 'Bu işlem mevcut rolünüz için izinli değil.']
          : status === 'not_found' ? ['Kayıt bulunamadı', 'Vaka organizasyon kapsamınızda değil.']
            : status === 'conflict' ? ['Sürüm çakışması', 'Kaynak veya run değişti; güncel veriyi yeniden yükleyin.']
              : ['Bağlantı kurulamadı', 'AI orchestration API’sine erişilemiyor; mock sonuç gösterilmedi.']
  return <div className="document-module-state policy-ai-state" role={status === 'loading' ? 'status' : 'alert'} aria-live={status === 'loading' ? 'polite' : 'assertive'} aria-busy={status === 'loading'}>
    {status === 'loading' ? <RefreshCw className="state-view__spinner" aria-hidden="true" /> : <ShieldAlert aria-hidden="true" />}
    <strong>{content[0]}</strong><span>{content[1]}</span>
    {['unavailable', 'conflict'].includes(status) && <button className="button button--secondary" type="button" onClick={retry}>Yeniden dene</button>}
  </div>
}

function SourceDiscoveryPreview({ sources, overviews }: { sources: readonly PolicyAiSourceSelectionRecord[]; overviews: readonly PolicyAiSourceOverviewRecord[] }) {
  return <section className="policy-ai-source-preview" aria-labelledby="policy-ai-available-sources">
    <header><div><h3 id="policy-ai-available-sources">Planlanabilir doğrulanmış kaynaklar</h3><p>Ready PDF segmentleri ile izin verilen OCR satırları server tarafından yeniden doğrulanır.</p></div><strong>{sources.length} parça</strong></header>
    {overviews.length > 0 && <div className="policy-ai-source-overviews">{overviews.map((overview) => <article key={overview.key}>
      <div><strong>{overview.sourceType === 'pdf_text' ? 'PDF metni' : 'OCR'} · v{overview.extractionVersion}</strong><span className={`status-pill status-pill--${overview.quality === 'high' ? 'ready' : 'review'}`}>{QUALITY_LABELS[overview.quality]}</span></div>
      <span>{overview.documentDisplayName} · belge sürümü {overview.documentVersionNumber}</span>
      <small>{overview.status} · {overview.selectedItemCount} parça · {overview.pageCount} sayfa</small>
      {overview.ocrRequiredPageNumbers.length > 0 && <small>OCR/kontrol gereken sayfalar: {overview.ocrRequiredPageNumbers.join(', ')}</small>}
      {overview.warnings.map((warning) => <em key={warning}>{warningLabel(warning)}</em>)}
    </article>)}</div>}
    {sources.length > 0 && <details className="policy-ai-source-details"><summary>Plan girdilerini göster ({sources.length})</summary><ol>{sources.map((source) => <li key={source.sourceType === 'pdf_text' ? `${source.extractionId}:${source.segmentId}` : `${source.ocrRunId}:${source.elementId}`}>
      <strong>{source.label}</strong><span>{source.documentDisplayName} · belge v{source.documentVersionNumber} · kaynak v{source.extractionVersion}</span><small>Kalite: {QUALITY_LABELS[source.quality]}</small>
    </li>)}</ol></details>}
  </section>
}

function BundlePreview({ run }: { run: PolicyAiRunRecord }) {
  const [open, setOpen] = useState(run.status === 'planned')
  return <details className="policy-ai-bundle" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary><FileSearch aria-hidden="true" />Source bundle ve kanıt önizlemesi</summary>
    <dl>
      <div><dt>Bundle ID</dt><dd className="mono">{run.bundle.id}</dd></div>
      <div><dt>Bundle şeması</dt><dd>{run.bundle.bundleSchemaVersion}</dd></div>
      <div><dt>Bundle hash</dt><dd className="mono">{run.bundle.sourceBundleHash}</dd></div>
      <div><dt>Belge sürümleri</dt><dd className="mono">{run.bundle.documentVersionIds.join(' · ')}</dd></div>
      <div><dt>Kaynak kapsamı</dt><dd>{run.bundle.completeness === 'complete' ? 'Tam' : run.bundle.completeness === 'partial' ? 'Kısmi' : 'İnsan kontrolü gerekli'}</dd></div>
      <div><dt>Eksik sayfalar</dt><dd>{run.bundle.missingPages.length === 0 ? 'Yok' : run.bundle.missingPages.join(', ')}</dd></div>
      <div><dt>OCR gereken sayfalar</dt><dd>{run.bundle.ocrRequiredPages.length === 0 ? 'Yok' : run.bundle.ocrRequiredPages.join(', ')}</dd></div>
    </dl>
    <ol>{run.bundle.items.map((source) => <li key={source.sourceAnchorId}>
      <div><strong>{source.sourceType === 'pdf_text' ? 'PDF' : 'OCR'} · Sayfa {source.pageNumber}</strong><span className={`status-pill status-pill--${source.sourceQuality === 'high' ? 'ready' : 'review'}`}>{QUALITY_LABELS[source.sourceQuality]}</span></div>
      <small>Anchor <code>{source.sourceAnchorId}</code> · belge sürümü <code>{source.documentVersionId}</code></small>
      <q>{source.boundedExcerpt}</q>
      {source.warnings.map((warning) => <em key={warning}>{warningLabel(warning)}</em>)}
    </li>)}</ol>
  </details>
}

function ApiPanel({ caseId }: { caseId: string }) {
  const data = usePolicyAi(caseId, 'api')
  const headingId = useId()
  const [approvedIdentity, setApprovedIdentity] = useState<string | null>(null)
  const run = data.workspace?.run ?? null
  const approvalIdentity = run === null ? null : `${caseId}:${run.id}:${run.sourceBundleHash}`

  useEffect(() => { setApprovedIdentity(null) }, [approvalIdentity])

  if (data.status !== 'ok' || data.workspace === null) return <State status={data.status === 'idle' ? 'loading' : data.status} retry={data.retry} />
  const { availableSources, conflicts, sourceOverviews } = data.workspace
  const sourceMap = new Map(run?.bundle.items.map((item) => [item.sourceAnchorId, item]) ?? [])
  const canStart = run !== null && ['planned', 'provider_disabled', 'budget_blocked'].includes(run.status)
  const approved = approvalIdentity !== null && approvedIdentity === approvalIdentity
  const liveStatus = data.busyAction === 'plan' ? 'Kaynak paketi planlanıyor.' : data.busyAction === 'start' ? 'AI alan adayları üretiliyor ve doğrulanıyor.' : run === null ? `${availableSources.length} doğrulanmış kaynak planlamaya hazır.` : `Run durumu: ${RUN_LABELS[run.status] ?? run.status}.`

  return <section className="policy-ai-module" aria-labelledby={headingId} aria-busy={data.busy}>
    <p className="sr-only" role="status" aria-live="polite">{liveStatus}</p>
    <header><div><span className="eyebrow">Kanıta bağlı, provider-neutral</span><h2 id={headingId}>AI Alan Adayları</h2><p>AI adayları nihai karar değildir. İnsan incelemesi sonraki aşamada gereklidir.</p></div><div className="policy-ai-header-actions">
      {run !== null && <span className={`status-badge status-badge--${run.status}`} role="status">{RUN_LABELS[run.status] ?? run.status}</span>}
      <button className="button button--secondary" type="button" disabled={data.busy} onClick={data.retry}><RefreshCw size={14} aria-hidden="true" />Kaynakları Yenile</button>
      <button className="button button--primary" type="button" disabled={data.busy || availableSources.length === 0} onClick={() => { setApprovedIdentity(null); void data.plan() }}><BrainCircuit size={15} aria-hidden="true" />{data.busyAction === 'plan' ? 'Planlanıyor…' : run === null ? 'Extraction Planı Oluştur' : 'Yeni Plan / Yeniden Planla'}</button>
    </div></header>
    <div className="policy-ai-safety" role="note"><ShieldAlert aria-hidden="true" /><span>Poliçe metni güvenilmeyen veridir; yalnız server üretimli sourceAnchor kimlikleri kanıt sayılır.</span><strong>File Agent ve ağ erişimi yoktur.</strong></div>
    {run === null ? <><div className="policy-ai-ready"><Sparkles aria-hidden="true" /><div><strong>{availableSources.length} doğrulanmış kaynak parçası hazır</strong><span>{availableSources.filter((item) => item.sourceType === 'pdf_text').length} PDF · {availableSources.filter((item) => item.sourceType === 'ocr').length} OCR</span></div></div><SourceDiscoveryPreview sources={availableSources} overviews={sourceOverviews} /></> : <>
      <div className="policy-ai-summary"><dl><div><dt>Kaynak</dt><dd>{run.bundle.sourceCount}</dd></div><div><dt>Girdi</dt><dd>{run.inputCharacters} kr.</dd></div><div><dt>Aday</dt><dd>{run.candidateCount}</dd></div><div><dt>Çelişki</dt><dd>{run.conflictCount}</dd></div><div><dt>Kontrol</dt><dd>{run.controlRequiredCount}</dd></div></dl><div className="policy-ai-provider"><span>Provider / model</span><strong>{run.providerId}</strong><small>{run.providerVersion} · {run.modelId}</small></div></div>
      <div className="policy-ai-budget"><span>Çağrı tahmini: {run.budget.estimatedCostMinor} minor unit</span><span>Aylık kullanım: {run.budget.currentMonthCostMinor} / {run.budget.monthlyBudgetMinor}</span><strong>{run.budget.allowed ? 'Bütçe uygun' : run.budget.reasonCode === 'AI_PROVIDER_DISABLED' ? 'AI sağlayıcısı kapalıdır.' : 'Bütçe limiti nedeniyle çağrı yapılmadı.'}</strong></div>
      <BundlePreview key={`${run.id}:${run.sourceBundleHash}`} run={run} />
      {run.bundle.qualityWarnings.length > 0 && <div className="policy-ai-warning" role="alert"><AlertTriangle aria-hidden="true" /><div><strong>Kaynak kalite ve güven uyarıları</strong>{run.bundle.qualityWarnings.map((warning) => <span key={warning}>{warningLabel(warning)}</span>)}</div></div>}
      {canStart && <div className="policy-ai-approval"><label><input type="checkbox" checked={approved} onChange={(event) => setApprovedIdentity(event.target.checked ? approvalIdentity : null)} /><span>Bu case ve source bundle için yalnız alan adayı üretimini açıkça onaylıyorum.</span></label><button className="button button--primary" type="button" disabled={!approved || data.busy} onClick={() => { setApprovedIdentity(null); void data.start() }}>{data.busyAction === 'start' ? <RefreshCw className="state-view__spinner" size={14} aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}{run.status === 'planned' ? 'Aday Üretimini Başlat' : 'Politikayı Yeniden Kontrol Et'}</button></div>}
      {run.status === 'provider_disabled' && <div className="policy-ai-warning" role="alert"><ShieldAlert aria-hidden="true" /><strong>AI sağlayıcısı kapalıdır. Provider çağrısı yapılmadı ve mock fallback kullanılmadı.</strong></div>}
      {run.status === 'budget_blocked' && <div className="policy-ai-warning" role="alert"><ShieldAlert aria-hidden="true" /><strong>Bütçe limiti nedeniyle çağrı yapılmadı.</strong></div>}
      {run.status === 'failed' && <div className="policy-ai-warning" role="alert"><ShieldAlert aria-hidden="true" /><strong>Sonuç fail-closed durduruldu: {run.safeErrorCode ?? 'AI_EXTRACTION_FAILED'}</strong></div>}
      {conflicts.length > 0 && <section className="policy-ai-conflicts" aria-labelledby={`${headingId}-conflicts`}><h3 id={`${headingId}-conflicts`}><AlertTriangle aria-hidden="true" />Çelişki önerileri ({conflicts.length})</h3><p>Çelişkiler sessizce çözülmez ve Paket 23’e aktarılmaz.</p><ul>{conflicts.map((conflict) => <li key={conflict.id}><strong>{conflict.status === 'duplicate' ? 'Yinelenen aday' : 'Kontrol gereken çelişki'}</strong><span>{CONFLICT_LABELS[conflict.reason] ?? `Kural: ${conflict.reason}`}</span><small>{conflict.leftCandidateId} ↔ {conflict.rightCandidateId}</small></li>)}</ul></section>}
      {run.candidateCount > 0 && <><div className="policy-ai-filter"><label>Kategori<select value={data.filter} onChange={(event) => data.setFilter(event.target.value as PolicyAiCandidateCategory | 'all')}><option value="all">Tümü</option>{Object.entries(CATEGORY_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><span aria-live="polite">{data.candidates.length} aday gösteriliyor</span></div><div className="policy-ai-candidates">{data.candidates.map((candidate) => <article key={candidate.candidateId}><header><div><strong>{CATEGORY_LABELS[candidate.category]}</strong><span className="mono">{candidate.canonicalField}</span></div><span className={`status-pill status-pill--${candidate.validationStatus === 'validated' && candidate.conflictStatus === 'none' ? 'open' : 'review'}`}>{candidate.conflictStatus === 'duplicate' ? 'Yinelenen aday' : candidate.conflictStatus === 'conflict_detected' ? 'Çelişki bulundu' : candidate.conflictStatus === 'control_required' ? 'Çelişki / kontrol' : candidate.validationStatus === 'validated' ? 'Kanıt eşleşti' : 'Kontrol gerekli'}</span></header><div className="policy-ai-value"><span>Normalize değer</span><strong>{JSON.stringify(candidate.normalizedValue)}</strong><q>{candidate.originalValue}</q></div>{candidate.conditions.length > 0 && <p>Koşul: {candidate.conditions.join(' · ')}</p>}{candidate.exceptions.length > 0 && <p>İstisna: {candidate.exceptions.join(' · ')}</p>}<div className="policy-ai-confidence"><span>Provider güveni %{Math.round(candidate.providerConfidence * 100)}</span><span>Kaynak kalitesi: {QUALITY_LABELS[candidate.sourceQuality]}</span><span>İnsan incelemesi: gerekli</span></div><div className="policy-ai-sources">{candidate.sourceAnchorIds.map((id) => { const source = sourceMap.get(id); return source ? <div key={id}><strong>{source.sourceType === 'pdf_text' ? 'PDF' : 'OCR'} · Sayfa {source.pageNumber}</strong><q>{source.boundedExcerpt}</q>{source.warnings.map((warning) => <span key={warning}>{warningLabel(warning)}</span>)}</div> : <span key={id}>Kaynak çözümlenemedi · kontrol gerekli</span> })}</div></article>)}</div></>}
      {run.status === 'review_required' && <div className="policy-ai-final-note" role="status"><CheckCircle2 aria-hidden="true" /><span>Aday üretimi tamamlandı. Bu pakette accept, edit, reject veya Paket 23’e promotion yapılmaz.</span></div>}
      <SourceDiscoveryPreview sources={availableSources} overviews={sourceOverviews} />
    </>}
  </section>
}

export function PolicyAiCandidatesModule({ caseId, source }: { caseId: string; source: DataSourceKind }) {
  if (source === 'mock') return <section className="policy-ai-module policy-ai-module--mock"><header><div><span className="eyebrow">Demo modu</span><h2>AI Alan Adayları</h2><p>Mock modda provider çağrısı yapılmaz ve sahte aday gerçek analiz olarak gösterilmez.</p></div></header></section>
  return <ApiPanel caseId={caseId} />
}
