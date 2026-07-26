import { AlertTriangle, CheckCircle2, Cpu, RefreshCw, ScanText, ShieldAlert } from 'lucide-react'
import type { DataSourceKind, PolicyOcrRunStatus } from '../../data/ports'
import { usePolicyOcr } from '../../data/usePolicyOcr'
const ACTIVE_STATUSES: PolicyOcrRunStatus[] = ['queued', 'rendering', 'preprocessing', 'recognizing', 'normalizing', 'validating']
const STATUS_LABELS: Record<PolicyOcrRunStatus, string> = {
  queued: 'Kuyrukta', rendering: 'Sayfa hazırlanıyor', preprocessing: 'Görüntü işleniyor', recognizing: 'Metin tanınıyor',
  normalizing: 'Metin normalize ediliyor', validating: 'Sonuç doğrulanıyor', ready: 'Teknik olarak hazır', partial: 'Kısmi',
  low_confidence: 'Düşük güven', control_required: 'Kontrol gerekli', failed: 'Başarısız', cancelled: 'İptal edildi',
  stale: 'Geçersiz sürüm', superseded: 'Eski sürüm',
}
const PAGE_LABELS = {
  accepted_candidate: 'Kaynak adayı', partial: 'Kısmi', low_confidence: 'Düşük güven', unreadable: 'Okunamadı',
  unsupported: 'Desteklenmiyor', failed: 'Başarısız', control_required: 'Kontrol gerekli',
} as const
const QUALITY_LABELS = { high: 'Yüksek', medium: 'Orta', low: 'Düşük', insufficient: 'Yetersiz', control_required: 'Kontrol gerekli' } as const
const READING_LABELS = { reliable: 'Güvenilir', probable: 'Olası', ambiguous: 'Belirsiz', control_required: 'Kontrol gerekli' } as const

function LoadState({ status, retry }: { status: string; retry: () => void }) {
  const content = status === 'loading' ? ['Yerel OCR kayıtları yükleniyor…', 'Doğrulanmış poliçe ve metin katmanı kontrol ediliyor.']
    : status === 'empty' ? ['OCR için uygun sayfa yok', 'Önce doğrulanmış Kasko PDF metin çıkarımında görsel sayfa bulunmalıdır.']
      : status === 'unauthorized' ? ['Oturum gerekli', 'Yerel OCR kayıtlarını görmek için yeniden giriş yapın.']
        : status === 'forbidden' ? ['Yetki yetersiz', 'Bu işlem mevcut rolünüz için izinli değil.']
          : status === 'not_found' ? ['Kayıt bulunamadı', 'Vaka veya belge organizasyon kapsamınızda değil.']
            : status === 'conflict' ? ['Sürüm çakışması', 'OCR kaydı değişti; güncel veriyi yeniden yükleyin.']
              : ['Bağlantı kurulamadı', 'OCR API’sine erişilemiyor; mock sonuç gösterilmedi.']
  return <div className="document-module-state policy-ocr-state" role={status === 'loading' ? 'status' : 'alert'}>
    {status === 'loading' ? <RefreshCw className="state-view__spinner" /> : <ShieldAlert />}
    <strong>{content[0]}</strong><span>{content[1]}</span>
    {['unavailable', 'conflict'].includes(status) && <button className="button button--secondary" type="button" onClick={retry}>Yeniden dene</button>}
  </div>
}

function ApiModule({ caseId }: { caseId: string }) {
  const data = usePolicyOcr(caseId)
  if (data.status !== 'ok') return <LoadState status={data.status} retry={data.retry} />
  const current = data.current
  const active = current !== null && ACTIVE_STATUSES.includes(current.status)
  const referencable = data.elements.filter((item) => item.type !== 'block')
  return <section className="policy-ocr-module" aria-labelledby="policy-ocr-heading">
    <header>
      <div><span className="eyebrow">Yerel ve çevrimdışı işlem</span><h2 id="policy-ocr-heading">Poliçe OCR Katmanı</h2><p>PDF metnini değiştirmez; OCR kanıtını ayrı sürüm ve kalite bilgisiyle saklar.</p></div>
      <button className="button button--primary" type="button" disabled={data.busy || data.selectedExtraction === null || active} onClick={() => void data.create()}><ScanText size={15} />{data.busy ? 'İşlem sürüyor…' : 'Yerel OCR Başlat'}</button>
    </header>

    <div className="policy-ocr-safety" role="note">
      <strong>OCR tamamen yerel çalışır.</strong><span>Bu sonuç poliçe yorumu değildir.</span><span>OCR sonucu yalnız kaynak oluşturmak için kullanılır.</span>
    </div>

    <div className="policy-ocr-toolbar">
      <label>Uygun metin çıkarımı<select value={data.selectedExtraction?.id ?? ''} onChange={(event) => data.selectExtraction(event.target.value)}><option value="">Uygun kayıt yok</option>{data.extractions.map((item) => <option key={item.id} value={item.id}>Metin v{item.extractionVersion} · {item.status} · {item.imageOnlyPageCount} görsel sayfa</option>)}</select></label>
      <label>OCR geçmişi<select value={current?.id ?? ''} onChange={(event) => data.selectRun(event.target.value)}><option value="">Henüz yok</option>{data.runs.map((item) => <option key={item.id} value={item.id}>v{item.ocrVersion} · {STATUS_LABELS[item.status]}</option>)}</select></label>
      <label>Dil seti<select value={data.language} disabled={active} onChange={(event) => data.setLanguage(event.target.value as typeof data.language)}><option value="tur+eng">Türkçe + İngilizce</option><option value="tur">Türkçe</option><option value="eng">İngilizce</option></select></label>
      <label>Render profili<select value={data.renderProfile} disabled={active} onChange={(event) => data.setRenderProfile(event.target.value as typeof data.renderProfile)}><option value="standard">Standart · 300 DPI</option><option value="high_quality">Yüksek kalite · 400 DPI</option></select></label>
      <div className="policy-ocr-engine"><Cpu /><div><span>Motor / model</span><strong>tesseract.js 7.0.0</strong><small>tessdata-4.0.0-full/1.0.0 · yerel checksum doğrulamalı</small></div></div>
    </div>

    {current === null ? <div className="policy-ocr-empty"><ScanText /><strong>OCR sürümü henüz yok</strong><span>İşlem yalnız uygun görsel poliçe sayfaları için kullanıcı komutuyla kuyruğa alınır.</span></div> : <>
      <div className="policy-ocr-summary"><span className={`status-badge status-badge--${current.status}`}>{STATUS_LABELS[current.status]}</span><dl><div><dt>Uygun sayfa</dt><dd>{current.eligiblePageCount}</dd></div><div><dt>Hazır</dt><dd>{current.readyPageCount}</dd></div><div><dt>Kontrol</dt><dd>{current.lowQualityPageCount}</dd></div><div><dt>Kelime</dt><dd>{current.wordCount}</dd></div><div><dt>Ortalama güven</dt><dd>{current.meanConfidence === null ? '—' : `%${current.meanConfidence.toFixed(1)}`}</dd></div></dl></div>
      <div className="policy-ocr-version"><span>{current.renderProfileVersion}</span><span>{current.preprocessingVersion}</span><span>{current.qualityVersion}</span><span>{current.normalizationVersion}</span><span>{current.locatorVersion}</span><span>Unicode code point</span><span title={current.languageDataHash}>Model SHA-256 · {current.languageDataHash.slice(0, 12)}…</span></div>
      {active && <div className="policy-pdf-notice" role="status"><RefreshCw className="state-view__spinner" /><span>{STATUS_LABELS[current.status]}. File Agent izole OCR worker’ını kullanıyor.</span></div>}
      {['partial', 'low_confidence', 'control_required'].includes(current.status) && <div className="policy-pdf-notice policy-pdf-notice--warning" role="alert"><AlertTriangle /><span>Düşük güvenli metin insan kontrolü gerektirir.</span>{current.renderProfile === 'standard' && <button className="text-button" type="button" disabled={data.busy} onClick={() => void data.retryRun()}>Yüksek kalite profiliyle yeni sürüm</button>}</div>}
      {current.status === 'failed' && <div className="policy-pdf-notice policy-pdf-notice--danger" role="alert"><ShieldAlert /><span>OCR güvenli hata koduyla tamamlanamadı: {current.failureCode ?? 'ocr_failed'}</span>{current.renderProfile === 'standard' && <button className="text-button" type="button" disabled={data.busy} onClick={() => void data.retryRun()}>Yüksek kalite profiliyle yeniden dene</button>}</div>}

      {data.pages.length > 0 && <div className="policy-ocr-pages"><h3>OCR sayfaları, metin katmanları ve kalite</h3>{data.pages.map((page) => {
        const pdfPage = data.pdfPages.find((item) => item.pageNumber === page.pageNumber)
        const conflict = page.compositeStatus === 'conflict_detected'
        return <article className={`policy-ocr-page policy-ocr-page--${page.qualityStatus}`} key={page.id}>
          <header><strong>Sayfa {page.pageNumber}</strong><span>{PAGE_LABELS[page.status]} · kalite {QUALITY_LABELS[page.qualityStatus]} · güven %{page.meanConfidence.toFixed(1)}</span></header>
          <div className="policy-ocr-page__meta"><span>{page.imageWidth}×{page.imageHeight} · {page.renderDpi} DPI</span><span>Döndürme {page.rotationDegrees}° · eğim {page.deskewDegrees.toFixed(2)}°</span><span>{page.blockCount} blok · {page.lineCount} satır · {page.wordCount} kelime</span><span>Düşük güvenli kelime: {page.lowConfidenceWordCount}</span><span>Okuma sırası: {READING_LABELS[page.readingOrderQuality]}</span>{page.requiresHumanReview && <strong>İnsan kontrolü gerekli</strong>}</div>
          {(conflict || page.readingOrderQuality === 'ambiguous') && <div className="policy-pdf-notice policy-pdf-notice--warning" role="alert"><AlertTriangle /><span>{conflict ? 'PDF metni ile OCR sonucu çelişiyor.' : 'Çok sütunlu okuma sırası belirsiz; kontrol gerekir.'}</span></div>}
          <div className="policy-ocr-comparison"><section><h4>Paket 24 PDF metni</h4><pre>{pdfPage?.normalizedText || 'Bu sayfada güvenilir PDF metni yok.'}</pre></section><section><h4>Paket 25 OCR metni</h4><pre>{page.normalizedText || 'OCR metni üretilemedi.'}</pre></section></div>
          <details><summary>Kontrollü ham OCR katmanı</summary><pre>{page.rawOcrText || 'Ham OCR metni üretilemedi.'}</pre></details>
        </article>
      })}</div>}

      {referencable.length > 0 && <div className="policy-ocr-elements"><h3>Blok / satır / kelime kanıt konumları</h3><p>Her sayfada en çok 100 öğe güvenli API sayfalamasıyla gösterilir.</p>{referencable.map((item) => <button type="button" key={item.id} disabled={data.busy || item.text.trim().length === 0} onClick={() => void data.makeReference(item)}><span>Sayfa {item.pageNumber} · {item.type === 'line' ? 'satır' : 'kelime'} · %{item.confidence.toFixed(1)}</span><strong>{item.text}</strong><small>x:{item.bbox.x} y:{item.bbox.y} w:{item.bbox.width} h:{item.bbox.height} · {item.startOffset}–{item.endOffset} · {item.sourceLayer}</small></button>)}<nav className="policy-ocr-pagination" aria-label="OCR kanıt sayfaları"><button className="button button--secondary" type="button" disabled={data.busy || data.elementPage === 1} onClick={() => void data.changeElementPage(data.elementPage - 1)}>Önceki</button><span>Sayfa {data.elementPage}</span><button className="button button--secondary" type="button" disabled={data.busy || data.elements.length < 100} onClick={() => void data.changeElementPage(data.elementPage + 1)}>Sonraki</button></nav></div>}
      {data.reference && <div className="policy-pdf-reference" role="status"><CheckCircle2 /><div><strong>OCR kaynak referansı doğrulandı</strong><span>{data.reference.locator}</span><span>Kalite: {QUALITY_LABELS[data.reference.ocrLocator.qualityStatus]} · okuma: {READING_LABELS[data.reference.ocrLocator.readingOrderQuality]}</span><q>{data.reference.rawExcerpt}</q></div></div>}
    </>}
  </section>
}

export function PolicyOcrApiModule({ caseId, source }: { caseId: string; source: DataSourceKind }) {
  if (source === 'mock') return <section className="policy-ocr-module policy-ocr-module--mock"><header><div><span className="eyebrow">Demo modu</span><h2>Poliçe OCR Katmanı</h2><p>Mock modda PDF rasterize edilmez, OCR worker çalışmaz ve sahte sonuç gerçek kanıt olarak gösterilmez.</p></div></header></section>
  return <ApiModule caseId={caseId} />
}
