import { AlertTriangle, BrainCircuit, CheckCircle2, Eye, FileSearch, RefreshCw, ShieldAlert, Sparkles } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import {
  usePolicyAi,
  type DataSourceKind,
  type PolicyAiCandidateCategory,
  type PolicyAiCandidateRecord,
  type PolicyAiCandidateReviewInput,
  type PolicyAiPromotionRecord,
  type PolicyAiReviewAction,
  type PolicyAiRunRecord,
  type PolicyAiSourceItemRecord,
  type PolicyAiSourceOverviewRecord,
  type PolicyAiSourceSelectionRecord,
} from '../../data'

const RUN_LABELS: Record<string, string> = { planned: 'Planlandı', provider_disabled: 'Sağlayıcı kapalı', budget_blocked: 'Bütçe engeli', running: 'Çalışıyor', validating: 'Doğrulanıyor', review_required: 'İnsan incelemesi gerekli', failed: 'Başarısız', stale: 'Geçersiz kaynak', cancelled: 'İptal edildi', superseded: 'Eski sürüm' }
const CATEGORY_LABELS: Record<PolicyAiCandidateCategory, string> = { policy_identity: 'Poliçe kimliği', coverage: 'Teminat', deductible: 'Muafiyet', service_rule: 'Servis kuralı', part_rule: 'Parça kuralı', replacement_vehicle: 'İkame araç', assistance: 'Yardım', valuation: 'Değerleme', exclusion: 'İstisna', required_document: 'Gerekli belge', special_condition: 'Özel şart' }
const QUALITY_LABELS: Record<string, string> = { high: 'Yüksek', medium: 'Orta', low: 'Düşük', control_required: 'İnsan kontrolü gerekli' }
const CONFLICT_LABELS: Record<string, string> = { GENERAL_NO_DEDUCTIBLE_DOES_NOT_OVERRIDE_CONDITIONAL: 'Genel muafiyetsiz ifade koşullu muafiyeti ortadan kaldırmıyor.', DUPLICATE_CANDIDATE: 'Aynı kanıt ve değer birden fazla adayda tekrar ediyor.', PDF_OCR_CONFLICT: 'PDF metni ile OCR kaynağı arasında çelişki var.' }
export type PolicyAnalysisWorkflowPhase = 'source' | 'planned' | 'review' | 'applied'

function sourceSelectionKey(source: PolicyAiSourceSelectionRecord): string {
  return source.sourceType === 'pdf_text'
    ? `pdf:${source.extractionId}:${source.segmentId}`
    : `ocr:${source.ocrRunId}:${source.elementId}`
}

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

function promotionMessage(code: string): string {
  if (code === 'AI_REVIEW_PENDING') return 'Bütün adaylar incelenmeden taslak sürüm oluşturulamaz.'
  if (code === 'AI_NO_APPROVED_CANDIDATE') return 'Aktarılabilecek kabul edilmiş veya düzenlenmiş aday yok.'
  if (code === 'AI_REVIEW_SET_ALREADY_PROMOTED') return 'Bu inceleme sürümü daha önce Paket 23 taslağına aktarıldı.'
  if (code === 'AI_PROMOTION_SOURCE_AMBIGUOUS') return 'Tekil ve doğrulanmış Kasko poliçesi kaynağı belirlenemedi.'
  if (code === 'AI_PROMOTION_TARGET_AMBIGUOUS') return 'Hedef poliçe analizi tekil olarak belirlenemedi.'
  if (code === 'AI_REJECTED_CANDIDATES_EXCLUDED') return 'Reddedilen adaylar taslak aktarımına alınmayacak.'
  if (code === 'AI_CONTROL_REQUIRED_CANDIDATES_EXCLUDED') return 'Kontrol gereken adaylar taslak aktarımına alınmayacak.'
  if (code === 'AI_CANDIDATE_CONFLICTS_PRESERVED') return 'Açık aday çelişkileri Paket 23 taslağında korunacak.'
  return code
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

function SourceDiscoveryPreview({
  sources,
  overviews,
  selectedKeys,
  onSelectionChange,
  disabled,
}: {
  sources: readonly PolicyAiSourceSelectionRecord[]
  overviews: readonly PolicyAiSourceOverviewRecord[]
  selectedKeys: ReadonlySet<string>
  onSelectionChange: (key: string, selected: boolean) => void
  disabled: boolean
}) {
  return <section className="policy-ai-source-preview" aria-labelledby="policy-ai-available-sources">
    <header><div><h3 id="policy-ai-available-sources">Planlanabilir doğrulanmış kaynaklar</h3><p>Ready PDF segmentleri ile izin verilen OCR satırları server tarafından yeniden doğrulanır. Kullanılacak parçaları açıkça seçin.</p></div><strong>{selectedKeys.size} / {sources.length} seçili</strong></header>
    {overviews.length > 0 && <div className="policy-ai-source-overviews">{overviews.map((overview) => <article key={overview.key}>
      <div><strong>{overview.sourceType === 'pdf_text' ? 'PDF metni' : 'OCR'} · v{overview.extractionVersion}</strong><span className={`status-pill status-pill--${overview.quality === 'high' ? 'ready' : 'review'}`}>{QUALITY_LABELS[overview.quality]}</span></div>
      <span>{overview.documentDisplayName} · belge sürümü {overview.documentVersionNumber}</span>
      <small>{overview.status} · {overview.selectedItemCount} parça · {overview.pageCount} sayfa</small>
      {overview.ocrRequiredPageNumbers.length > 0 && <small>OCR/kontrol gereken sayfalar: {overview.ocrRequiredPageNumbers.join(', ')}</small>}
      {overview.warnings.map((warning) => <em key={warning}>{warningLabel(warning)}</em>)}
    </article>)}</div>}
    {sources.length > 0 && <details className="policy-ai-source-details"><summary>Plan girdilerini seç ({sources.length})</summary><ol>{sources.map((source) => {
      const key = sourceSelectionKey(source)
      return <li key={key}>
        <label><input type="checkbox" checked={selectedKeys.has(key)} disabled={disabled} onChange={(event) => onSelectionChange(key, event.target.checked)} /><span><strong>{source.label}</strong><span>{source.documentDisplayName} · belge v{source.documentVersionNumber} · kaynak v{source.extractionVersion}</span><small>Kalite: {QUALITY_LABELS[source.quality]}</small></span></label>
      </li>
    })}</ol></details>}
  </section>
}

function EvidenceDialog({
  candidate,
  sources,
  onClose,
}: {
  candidate: PolicyAiCandidateRecord
  sources: readonly PolicyAiSourceItemRecord[]
  onClose: () => void
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])
  return <div className="policy-ai-review-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose()
  }}>
    <section className="policy-ai-review-dialog policy-ai-evidence-dialog" role="dialog" aria-modal="true" aria-labelledby="policy-ai-evidence-title">
      <header><div><span className="eyebrow">Kanıt görüntüleme</span><h3 id="policy-ai-evidence-title">{CATEGORY_LABELS[candidate.category]} · {candidate.canonicalField}</h3><p>Provider değeri yalnız aşağıdaki server doğrulamalı sourceAnchor kayıtlarına dayanır.</p></div><button type="button" className="icon-button" aria-label="Kanıt penceresini kapat" onClick={onClose} autoFocus>×</button></header>
      <div className="policy-ai-evidence-list">{sources.map((source) => <article key={source.sourceAnchorId}>
        <div><strong>{source.sourceType === 'pdf_text' ? 'PDF metni' : 'OCR'} · Sayfa {source.pageNumber}</strong><span className={`status-pill status-pill--${source.sourceQuality === 'high' ? 'ready' : 'review'}`}>{QUALITY_LABELS[source.sourceQuality]}</span></div>
        <dl><div><dt>Belge</dt><dd className="mono">{source.documentId}</dd></div><div><dt>Belge sürümü</dt><dd className="mono">{source.documentVersionId}</dd></div><div><dt>Kaynak sürümü</dt><dd className="mono">{source.extractionId}</dd></div><div><dt>Source anchor</dt><dd className="mono">{source.sourceAnchorId}</dd></div><div><dt>Metin hash</dt><dd className="mono">{source.textHash}</dd></div></dl>
        <q>{source.boundedExcerpt}</q>
        {source.warnings.map((warning) => <p className="text-warning" key={warning}>{warningLabel(warning)}</p>)}
      </article>)}</div>
      <footer><button type="button" className="button button--secondary" onClick={onClose}>Kapat</button></footer>
    </section>
  </div>
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

function ReviewDialog({candidate,action,busy,onClose,onSubmit}:{candidate:PolicyAiCandidateRecord;action:Exclude<PolicyAiReviewAction,'accepted'>;busy:boolean;onClose:()=>void;onSubmit:(input:PolicyAiCandidateReviewInput)=>void}) {
  const [reason,setReason]=useState('')
  const [normalized,setNormalized]=useState(JSON.stringify(candidate.review?.normalizedValue??candidate.normalizedValue,null,2))
  const [original,setOriginal]=useState(candidate.review?.originalValue??candidate.originalValue)
  const [conditions,setConditions]=useState((candidate.review?.conditions??candidate.conditions).join('\n'))
  const [exceptions,setExceptions]=useState((candidate.review?.exceptions??candidate.exceptions).join('\n'))
  const [error,setError]=useState<string|null>(null)
  const title=action==='edited'?'Adayı düzenle':action==='rejected'?'Adayı reddet':'Kontrol gerektirir olarak işaretle'
  const submit=()=>{const expectedReviewVersion=candidate.review?.reviewVersion??0;if(reason.trim().length===0){setError('Gerekçe zorunludur.');return}if(action!=='edited'){onSubmit({action,expectedReviewVersion,reason:reason.trim()});return}try{onSubmit({action:'edited',expectedReviewVersion,reason:reason.trim(),normalizedValue:JSON.parse(normalized) as unknown,originalValue:original.trim(),conditions:conditions.split('\n').map(value=>value.trim()).filter(Boolean),exceptions:exceptions.split('\n').map(value=>value.trim()).filter(Boolean)})}catch{setError('Normalize değer geçerli JSON olmalıdır.')}}
  return <div className="policy-ai-review-backdrop" role="presentation"><section className="policy-ai-review-dialog" role="dialog" aria-modal="true" aria-labelledby="policy-ai-review-title"><header><div><span className="eyebrow">İnsan incelemesi</span><h3 id="policy-ai-review-title">{title}</h3><p className="mono">{candidate.canonicalField}</p></div><button type="button" className="icon-button" aria-label="İnceleme penceresini kapat" onClick={onClose} disabled={busy}>×</button></header>{action==='edited'&&<div className="policy-ai-review-fields"><label>Normalize değer (JSON)<textarea value={normalized} onChange={event=>setNormalized(event.target.value)} rows={4}/></label><label>Kaynakta görülen değer<input value={original} onChange={event=>setOriginal(event.target.value)} maxLength={1000}/></label><label>Koşullar (satır başına bir değer)<textarea value={conditions} onChange={event=>setConditions(event.target.value)} rows={3}/></label><label>İstisnalar (satır başına bir değer)<textarea value={exceptions} onChange={event=>setExceptions(event.target.value)} rows={3}/></label></div>}<label>Gerekçe<textarea value={reason} onChange={event=>setReason(event.target.value)} rows={3} maxLength={500} autoFocus/></label>{error&&<p className="form-error" role="alert">{error}</p>}<footer><button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>Vazgeç</button><button type="button" className="button button--primary" onClick={submit} disabled={busy}>{busy?'Kaydediliyor…':'Kararı Kaydet'}</button></footer></section></div>
}

function ApiPanel({
  caseId,
  onPromotionApplied,
  onPhaseChange,
}: {
  caseId: string
  onPromotionApplied?: (promotion: PolicyAiPromotionRecord) => void
  onPhaseChange?: (phase: PolicyAnalysisWorkflowPhase) => void
}) {
  const data = usePolicyAi(caseId, 'api')
  const headingId = useId()
  const [approvedIdentity, setApprovedIdentity] = useState<string | null>(null)
  const [reviewTarget,setReviewTarget]=useState<{candidate:PolicyAiCandidateRecord;action:Exclude<PolicyAiReviewAction,'accepted'>}|null>(null)
  const [evidenceTarget,setEvidenceTarget]=useState<PolicyAiCandidateRecord|null>(null)
  const [promotionApproved,setPromotionApproved]=useState(false)
  const [selectedSourceKeys,setSelectedSourceKeys]=useState<ReadonlySet<string>>(new Set())
  const run = data.workspace?.run ?? null
  const approvalIdentity = run === null ? null : `${caseId}:${run.id}:${run.sourceBundleHash}`
  const availableSourceIdentity = data.workspace?.availableSources.map(sourceSelectionKey).sort().join('|') ?? ''

  useEffect(() => { setApprovedIdentity(null) }, [approvalIdentity])
  useEffect(()=>{setPromotionApproved(false)},[data.workspace?.promotionPreview?.reviewSetHash])
  useEffect(() => {
    setSelectedSourceKeys((current) => {
      const available = new Set(data.workspace?.availableSources.map(sourceSelectionKey) ?? [])
      const retained = [...current].filter((key) => available.has(key))
      return new Set(retained.length > 0 ? retained : available)
    })
  }, [availableSourceIdentity, data.workspace?.availableSources])
  useEffect(() => {
    const preview = data.workspace?.promotionPreview
    const phase: PolicyAnalysisWorkflowPhase = data.workspace?.promotion !== null
      || preview?.blockers.includes('AI_REVIEW_SET_ALREADY_PROMOTED') === true
      ? 'applied'
      : run === null
        ? 'source'
        : run.status === 'review_required'
          ? 'review'
          : 'planned'
    onPhaseChange?.(phase)
  }, [data.workspace?.promotion, data.workspace?.promotionPreview, onPhaseChange, run])

  if (data.status !== 'ok' || data.workspace === null) return <State status={data.status === 'idle' ? 'loading' : data.status} retry={data.retry} />
  const { availableSources, conflicts, sourceOverviews } = data.workspace
  const promotionPreview=data.workspace.promotionPreview
  const sourceMap = new Map(run?.bundle.items.map((item) => [item.sourceAnchorId, item]) ?? [])
  const selectedSources = availableSources.filter((source) => selectedSourceKeys.has(sourceSelectionKey(source)))
  const canStart = run !== null && ['planned', 'provider_disabled', 'budget_blocked'].includes(run.status)
  const approved = approvalIdentity !== null && approvedIdentity === approvalIdentity
  const liveStatus = data.busyAction === 'plan' ? 'Kaynak paketi planlanıyor.' : data.busyAction === 'start' ? 'AI alan adayları üretiliyor ve doğrulanıyor.' : data.busyAction==='review'?'İnsan inceleme kararı kaydediliyor.':data.busyAction==='promote'?'Onaylanan adaylar yeni taslak analiz sürümüne aktarılıyor.':run === null ? `${availableSources.length} doğrulanmış kaynak planlamaya hazır.` : `Run durumu: ${RUN_LABELS[run.status] ?? run.status}.`

  return <section className="policy-ai-module" aria-labelledby={headingId} aria-busy={data.busy}>
    <p className="sr-only" role="status" aria-live="polite">{liveStatus}</p>
    <header><div><span className="eyebrow">Kanıta bağlı, güvenli dış sağlayıcı pilotu</span><h2 id={headingId}>AI Alan Adayları</h2><p>AI adayları nihai karar değildir. İnsan incelemesi ve açık promotion onayı zorunludur.</p></div><div className="policy-ai-header-actions">
      {run !== null && <span className={`status-badge status-badge--${run.status}`} role="status">{RUN_LABELS[run.status] ?? run.status}</span>}
      <button className="button button--secondary" type="button" disabled={data.busy} onClick={data.retry}><RefreshCw size={14} aria-hidden="true" />Kaynakları Yenile</button>
      <button className="button button--primary" type="button" disabled={data.busy || selectedSources.length === 0} onClick={() => { setApprovedIdentity(null); void data.plan(selectedSources) }}><BrainCircuit size={15} aria-hidden="true" />{data.busyAction === 'plan' ? 'Planlanıyor…' : run === null ? 'Analiz Planı Oluştur' : 'Yeni Plan / Yeniden Planla'}</button>
    </div></header>
    <div className="policy-ai-safety" role="note"><ShieldAlert aria-hidden="true" /><span>Poliçe metni güvenilmeyen veridir; yalnız server üretimli sourceAnchor kimlikleri kanıt sayılır.</span><strong>File Agent, fiziksel dosya ve provider secret istemciye açılmaz.</strong></div>
    {run === null ? <><div className="policy-ai-ready"><Sparkles aria-hidden="true" /><div><strong>{availableSources.length} doğrulanmış kaynak parçası hazır</strong><span>{availableSources.filter((item) => item.sourceType === 'pdf_text').length} PDF · {availableSources.filter((item) => item.sourceType === 'ocr').length} OCR</span></div></div><SourceDiscoveryPreview sources={availableSources} overviews={sourceOverviews} selectedKeys={selectedSourceKeys} onSelectionChange={(key, selected) => setSelectedSourceKeys((current) => {
      const next = new Set(current)
      if (selected) next.add(key)
      else next.delete(key)
      return next
    })} disabled={data.busy} /></> : <>
      <div className="policy-ai-summary"><dl><div><dt>Kaynak</dt><dd>{run.bundle.sourceCount}</dd></div><div><dt>Girdi</dt><dd>{run.inputCharacters} kr.</dd></div><div><dt>Aday</dt><dd>{run.candidateCount}</dd></div><div><dt>Çelişki</dt><dd>{run.conflictCount}</dd></div><div><dt>Kontrol</dt><dd>{run.controlRequiredCount}</dd></div></dl><div className="policy-ai-provider"><span>Provider / model</span><strong>{run.providerId}</strong><small>{run.providerVersion} · {run.modelId}</small></div></div>
      <div className="policy-ai-budget"><span>Çağrı tahmini: {run.budget.estimatedCostMinor} minor unit</span><span>Aylık kullanım: {run.budget.currentMonthCostMinor} / {run.budget.monthlyBudgetMinor}</span><strong>{run.budget.allowed ? 'Bütçe uygun' : run.budget.reasonCode === 'AI_PROVIDER_DISABLED' ? 'AI sağlayıcısı kapalıdır.' : 'Bütçe limiti nedeniyle çağrı yapılmadı.'}</strong></div>
      {run.privacy.externalProvider && <div className="policy-ai-privacy" role="note"><ShieldAlert aria-hidden="true" /><div><strong>Dış sağlayıcı veri sınırı</strong><span>{run.privacy.redactedValueCount} hassas değer maskelendi · {run.privacy.outboundInputCharacters} karakter gönderim paketi</span><small>Kategoriler: {run.privacy.redactedCategories.length === 0 ? 'tespit edilmedi' : run.privacy.redactedCategories.join(' · ')}</small><small>{run.privacy.retentionMode === 'free_tier_product_improvement' ? 'Ücretsiz sağlayıcı katmanında gönderilen sentetik içerik ürün geliştirme amacıyla kullanılabilir; gerçek müşteri verisi gönderilmez.' : 'Uygulama saklama kapalıdır (`store: false`); sağlayıcının abuse-monitoring politikası ayrıca geçerlidir.'}</small><code>{run.privacy.policyVersion} · {run.privacy.pricingVersion}</code></div></div>}
      <BundlePreview key={`${run.id}:${run.sourceBundleHash}`} run={run} />
      {run.bundle.qualityWarnings.length > 0 && <div className="policy-ai-warning" role="alert"><AlertTriangle aria-hidden="true" /><div><strong>Kaynak kalite ve güven uyarıları</strong>{run.bundle.qualityWarnings.map((warning) => <span key={warning}>{warningLabel(warning)}</span>)}</div></div>}
      {canStart && <div className="policy-ai-approval"><label><input type="checkbox" checked={approved} onChange={(event) => setApprovedIdentity(event.target.checked ? approvalIdentity : null)} /><span>{run.privacy.externalProvider ? 'Maskelenmiş kaynak parçalarının dış AI sağlayıcısına gönderilmesini ve yalnız alan adayı üretilmesini açıkça onaylıyorum.' : 'Bu case ve source bundle için yalnız alan adayı üretimini açıkça onaylıyorum.'}</span></label><button className="button button--primary" type="button" disabled={!approved || data.busy} onClick={() => { setApprovedIdentity(null); void data.start() }}>{data.busyAction === 'start' ? <RefreshCw className="state-view__spinner" size={14} aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}{run.status === 'planned' ? 'Aday Üretimini Başlat' : 'Politikayı Yeniden Kontrol Et'}</button></div>}
      {run.status === 'provider_disabled' && <div className="policy-ai-warning" role="alert"><ShieldAlert aria-hidden="true" /><strong>AI sağlayıcısı kapalıdır. Provider çağrısı yapılmadı ve mock fallback kullanılmadı.</strong></div>}
      {run.status === 'budget_blocked' && <div className="policy-ai-warning" role="alert"><ShieldAlert aria-hidden="true" /><strong>Bütçe limiti nedeniyle çağrı yapılmadı.</strong></div>}
      {run.status === 'failed' && <div className="policy-ai-warning" role="alert"><ShieldAlert aria-hidden="true" /><strong>Sonuç fail-closed durduruldu: {run.safeErrorCode ?? 'AI_EXTRACTION_FAILED'}</strong></div>}
      {conflicts.length > 0 && <section className="policy-ai-conflicts" aria-labelledby={`${headingId}-conflicts`}><h3 id={`${headingId}-conflicts`}><AlertTriangle aria-hidden="true" />Çelişki önerileri ({conflicts.length})</h3><p>Çelişkiler sessizce çözülmez ve Paket 23’e aktarılmaz.</p><ul>{conflicts.map((conflict) => <li key={conflict.id}><strong>{conflict.status === 'duplicate' ? 'Yinelenen aday' : 'Kontrol gereken çelişki'}</strong><span>{CONFLICT_LABELS[conflict.reason] ?? `Kural: ${conflict.reason}`}</span><small>{conflict.leftCandidateId} ↔ {conflict.rightCandidateId}</small></li>)}</ul></section>}
      {run.candidateCount > 0 && <><div className="policy-ai-filter"><label>Kategori<select value={data.filter} onChange={(event) => data.setFilter(event.target.value as PolicyAiCandidateCategory | 'all')}><option value="all">Tümü</option>{Object.entries(CATEGORY_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><span aria-live="polite">{data.candidates.length} aday gösteriliyor</span></div><div className="policy-ai-candidates">{data.candidates.map((candidate) => <article key={candidate.candidateId}><header><div><strong>{CATEGORY_LABELS[candidate.category]}</strong><span className="mono">{candidate.canonicalField}</span></div><span className={`status-pill status-pill--${candidate.review?.action==='accepted'||candidate.review?.action==='edited'?'ready':'review'}`}>{candidate.review===null?'İnceleme bekliyor':candidate.review.action==='accepted'?'Kabul edildi':candidate.review.action==='edited'?'Düzenlenip kabul edildi':candidate.review.action==='rejected'?'Reddedildi':'Kontrol gerektirir'}</span></header><div className="policy-ai-value"><span>Provider adayı</span><strong>{JSON.stringify(candidate.normalizedValue)}</strong><q>{candidate.originalValue}</q></div>{candidate.conditions.length > 0 && <p>Koşul: {candidate.conditions.join(' · ')}</p>}{candidate.exceptions.length > 0 && <p>İstisna: {candidate.exceptions.join(' · ')}</p>}{candidate.review?.action==='edited'&&<div className="policy-ai-reviewed-value"><span>İnsan düzenlemesi</span><strong>{JSON.stringify(candidate.review.normalizedValue)}</strong><q>{candidate.review.originalValue}</q></div>}<div className="policy-ai-confidence"><span>Provider güveni %{Math.round(candidate.providerConfidence * 100)}</span><span>Kaynak kalitesi: {QUALITY_LABELS[candidate.sourceQuality]}</span><span>Kanıt: {candidate.validationStatus==='validated'?'doğrulandı':'kontrol gerekli'}</span></div><div className="policy-ai-sources">{candidate.sourceAnchorIds.map((id) => { const source = sourceMap.get(id); return source ? <div key={id}><strong>{source.sourceType === 'pdf_text' ? 'PDF' : 'OCR'} · Sayfa {source.pageNumber}</strong><q>{source.boundedExcerpt}</q>{source.warnings.map((warning) => <span key={warning}>{warningLabel(warning)}</span>)}</div> : <span key={id}>Kaynak çözümlenemedi · kontrol gerekli</span> })}</div><div className="policy-ai-evidence-action"><button type="button" className="button button--secondary" onClick={()=>setEvidenceTarget(candidate)}><Eye size={13} aria-hidden="true"/>Kanıtı Görüntüle ({candidate.sourceAnchorIds.length})</button></div>{run.status==='review_required'&&<footer className="policy-ai-review-actions"><button type="button" className="button button--primary" disabled={data.busy} onClick={()=>void data.review(candidate.candidateId,{action:'accepted',expectedReviewVersion:candidate.review?.reviewVersion??0})}>{data.busyCandidateId===candidate.candidateId?'Kaydediliyor…':'Kabul Et'}</button><button type="button" className="button button--secondary" disabled={data.busy} onClick={()=>setReviewTarget({candidate,action:'edited'})}>Düzenle</button><button type="button" className="button button--secondary" disabled={data.busy} onClick={()=>setReviewTarget({candidate,action:'rejected'})}>Reddet</button><button type="button" className="button button--secondary" disabled={data.busy} onClick={()=>setReviewTarget({candidate,action:'control_required'})}>Kontrol Gerektirir</button></footer>}</article>)}</div></>}
      {run.status === 'review_required'&&promotionPreview!==null&&<section className="policy-ai-promotion" aria-labelledby={`${headingId}-promotion`}><header><div><span className="eyebrow">Paket 23 taslak aktarımı</span><h3 id={`${headingId}-promotion`}>İnceleme ve aktarım özeti</h3></div><strong>{promotionPreview.promotableCount} aktarılabilir aday</strong></header><dl><div><dt>Kabul</dt><dd>{promotionPreview.acceptedCount}</dd></div><div><dt>Düzenleme</dt><dd>{promotionPreview.editedCount}</dd></div><div><dt>Red</dt><dd>{promotionPreview.rejectedCount}</dd></div><div><dt>Kontrol</dt><dd>{promotionPreview.controlRequiredCount}</dd></div><div><dt>Bekleyen</dt><dd>{promotionPreview.pendingCount}</dd></div><div><dt>Korunan çelişki</dt><dd>{promotionPreview.preservedConflictCount}</dd></div></dl>{promotionPreview.blockers.length>0&&<div className="policy-ai-warning" role="alert"><AlertTriangle aria-hidden="true"/><span>{promotionPreview.blockers.map(promotionMessage).join(' · ')}</span></div>}{promotionPreview.warnings.length>0&&<p>{promotionPreview.warnings.map(promotionMessage).join(' · ')}</p>}<label className="policy-ai-promotion-confirm"><input type="checkbox" checked={promotionApproved} onChange={event=>setPromotionApproved(event.target.checked)} disabled={!promotionPreview.canPromote||data.busy}/><span>Kabul edilen ve düzenlenen adayların kaynak ve çelişki geçmişiyle yeni, onaysız Paket 23 taslak sürümüne uygulanmasını onaylıyorum.</span></label><button type="button" className="button button--primary" disabled={!promotionApproved||!promotionPreview.canPromote||data.busy||data.workspace.promotion!==null} onClick={()=>void data.promote().then((promotion)=>{if(promotion!==null)onPromotionApplied?.(promotion)})}>{data.busyAction==='promote'?'Uygulanıyor…':'Onaylanan Adayları Uygula'}</button>{data.workspace.promotion!==null&&<div className="policy-ai-promotion-success" role="status"><CheckCircle2 aria-hidden="true"/><div><strong>Taslak analiz sürümü oluşturuldu</strong><span>Analiz {data.workspace.promotion.analysisId} · sürüm {data.workspace.promotion.analysisVersion}</span><small>{data.workspace.promotion.promotedCandidateCount} aday ve {data.workspace.promotion.preservedConflictCount} çelişki kaydı korundu.</small></div></div>}</section>}
      {reviewTarget!==null&&<ReviewDialog candidate={reviewTarget.candidate} action={reviewTarget.action} busy={data.busyAction==='review'} onClose={()=>setReviewTarget(null)} onSubmit={input=>{void data.review(reviewTarget.candidate.candidateId,input).then(()=>setReviewTarget(null))}}/>}
      {evidenceTarget!==null&&<EvidenceDialog candidate={evidenceTarget} sources={evidenceTarget.sourceAnchorIds.map((id)=>sourceMap.get(id)).filter((source):source is PolicyAiSourceItemRecord=>source!==undefined)} onClose={()=>setEvidenceTarget(null)}/>}
      {run.status === 'review_required' && <div className="policy-ai-final-note" role="status"><CheckCircle2 aria-hidden="true" /><span>AI adayları nihai karar değildir. İnsan kararı append-only saklanır; promotion yalnız onaysız bir Paket 23 taslak sürümü oluşturur.</span></div>}
      <SourceDiscoveryPreview sources={availableSources} overviews={sourceOverviews} selectedKeys={selectedSourceKeys} onSelectionChange={(key, selected) => setSelectedSourceKeys((current) => {
        const next = new Set(current)
        if (selected) next.add(key)
        else next.delete(key)
        return next
      })} disabled={data.busy} />
    </>}
  </section>
}

export function PolicyAiCandidatesModule({
  caseId,
  source,
  onPromotionApplied,
  onPhaseChange,
}: {
  caseId: string
  source: DataSourceKind
  onPromotionApplied?: (promotion: PolicyAiPromotionRecord) => void
  onPhaseChange?: (phase: PolicyAnalysisWorkflowPhase) => void
}) {
  if (source === 'mock') return <section className="policy-ai-module policy-ai-module--mock"><header><div><span className="eyebrow">Demo modu</span><h2>AI Alan Adayları</h2><p>Mock modda provider çağrısı yapılmaz ve sahte aday gerçek analiz olarak gösterilmez.</p></div></header></section>
  return <ApiPanel caseId={caseId} onPromotionApplied={onPromotionApplied} onPhaseChange={onPhaseChange} />
}
