import { AlertTriangle, CheckCircle2, FileSearch, RefreshCw, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { usePolicyPdfText, type DataSourceKind } from '../../data'
import type { PdfTextExtractionStatus } from '../../data'

const STATUS_LABELS: Record<PdfTextExtractionStatus, string> = {
  queued: 'Kuyrukta',
  processing: 'İşleniyor',
  ready: 'Hazır',
  partial: 'Kısmi metin',
  ocr_required: 'OCR gerekli',
  failed: 'Başarısız',
  cancelled: 'İptal edildi',
  stale: 'Geçersiz sürüm',
}

function LoadState({ status, retry }: { status: string; retry: () => void }) {
  const content = status === 'loading'
    ? ['Poliçe metni yükleniyor…', 'Doğrulanmış PDF ve çıkarım kaydı okunuyor.']
    : status === 'empty'
      ? ['Uygun poliçe PDF’i yok', 'Ready ve fiziksel olarak doğrulanmış Kasko poliçesi bulunamadı.']
      : status === 'unauthorized'
        ? ['Oturum gerekli', 'Gerçek PDF metin çıkarımını görmek için yeniden giriş yapın.']
        : status === 'forbidden'
          ? ['Yetki yetersiz', 'Bu işlem mevcut rolünüz için izinli değil.']
          : status === 'not_found'
            ? ['Dosya bulunamadı', 'Vaka veya belge organizasyon kapsamınızda değil.']
            : status === 'conflict'
              ? ['Sürüm çakışması', 'Belge veya çıkarım değişti; güncel veriyi yeniden yükleyin.']
              : ['Bağlantı kurulamadı', 'PDF metin çıkarım API’sine erişilemiyor; mock sonuç gösterilmedi.']
  return <div className="document-module-state policy-pdf-state" role={status === 'loading' ? 'status' : 'alert'}>
    {status === 'loading' ? <RefreshCw className="state-view__spinner" /> : <ShieldAlert />}
    <strong>{content[0]}</strong><span>{content[1]}</span>
    {(status === 'unavailable' || status === 'conflict') && <button className="button button--secondary" type="button" onClick={retry}>Yeniden dene</button>}
  </div>
}

function ApiModule({ caseId }: { caseId: string }) {
  const data = usePolicyPdfText(caseId)
  const [textMode, setTextMode] = useState<'normalized' | 'raw'>('normalized')
  if (data.status !== 'ok') return <LoadState status={data.status} retry={data.retry} />
  const current = data.current
  return <section className="policy-pdf-module" aria-labelledby="policy-pdf-heading">
    <header>
      <div><span className="eyebrow">Doğrulanmış PDF kaynağı</span><h2 id="policy-pdf-heading">Poliçe Metin Çıkarımı</h2><p>Yalnız metin ve kanıt konumu üretir; poliçe yorumu yapmaz.</p></div>
      <button className="button button--primary" type="button" disabled={data.busy || data.selected === null || current?.status === 'queued' || current?.status === 'processing'} onClick={() => void data.create()}><FileSearch size={15} />{data.busy ? 'İşlem sürüyor…' : 'Metni Çıkar'}</button>
    </header>
    <div className="policy-pdf-toolbar">
      <label>Doğrulanmış poliçe PDF’i<select value={data.selected?.documentVersionId ?? ''} onChange={(event) => data.selectSource(event.target.value)}>{data.sources.map((item) => <option key={item.documentVersionId} value={item.documentVersionId}>{item.displayName} · v{item.versionNumber}</option>)}</select></label>
      <label>Çıkarım sürümü<select value={current?.id ?? ''} onChange={(event) => data.selectExtraction(event.target.value)}><option value="">Henüz yok</option>{data.extractions.map((item) => <option key={item.id} value={item.id}>v{item.extractionVersion} · {STATUS_LABELS[item.status]}</option>)}</select></label>
      <div className="policy-pdf-parser"><span>Parser</span><strong>pdfjs-dist 6.1.200</strong><small>pdf-text-normalization/1.0.0 · Unicode code point</small></div>
    </div>
    {current === null ? <div className="policy-pdf-empty"><FileSearch /><strong>Metin çıkarımı henüz yok</strong><span>İşlem kullanıcı komutuyla ve idempotent kuyruk işi olarak başlatılır.</span></div> : <>
      <div className="policy-pdf-summary">
        <span className={`status-badge status-badge--${current.status}`}>{STATUS_LABELS[current.status]}</span>
        <dl><div><dt>Sayfa</dt><dd>{current.pageCount}</dd></div><div><dt>Metin sayfası</dt><dd>{current.textPageCount}</dd></div><div><dt>Görsel sayfası</dt><dd>{current.imageOnlyPageCount}</dd></div><div><dt>Segment</dt><dd>{current.segmentCount}</dd></div></dl>
      </div>
      {(current.status === 'queued' || current.status === 'processing') && <div className="policy-pdf-notice" role="status"><RefreshCw className="state-view__spinner" /><span>File Agent güvenli worker içinde PDF metnini çıkarıyor.</span></div>}
      {(current.status === 'partial' || current.status === 'ocr_required') && <div className="policy-pdf-notice policy-pdf-notice--warning" role="alert"><AlertTriangle /><span>{current.status === 'ocr_required' ? 'Metin katmanı bulunamadı. OCR bu paketin kapsamı dışındadır.' : 'Bazı sayfalarda metin yok veya çıkarım tamamlanamadı; insan kontrolü gerekir.'}</span></div>}
      {current.status === 'failed' && <div className="policy-pdf-notice policy-pdf-notice--danger" role="alert"><ShieldAlert /><span>Çıkarım güvenli hata koduyla başarısız oldu: {current.failureCode ?? 'pdf_extraction_failed'}</span></div>}
      {data.pages.length > 0 && <div className="policy-pdf-pages">
        <div className="policy-pdf-pages__head"><h3>Sayfa metinleri</h3><div className="segmented-control" aria-label="Metin görünümü"><button type="button" className={textMode === 'normalized' ? 'is-active' : ''} onClick={() => setTextMode('normalized')}>Normalize</button><button type="button" className={textMode === 'raw' ? 'is-active' : ''} onClick={() => setTextMode('raw')}>Ham</button></div></div>
        {data.pages.map((page) => <article key={page.id} className="policy-pdf-page"><header><strong>Sayfa {page.pageNumber}</strong><span>{page.status === 'text' ? 'Metin' : page.status === 'image_only' ? 'Yalnız görsel' : page.status}</span></header><pre>{textMode === 'normalized' ? page.normalizedText : page.rawText}</pre></article>)}
      </div>}
      {data.segments.length > 0 && <div className="policy-pdf-segments"><h3>Deterministik segmentler</h3>{data.segments.map((segment) => <button type="button" key={segment.id} disabled={data.busy} onClick={() => void data.makeReference(segment)}><span>Sayfa {segment.pageNumber} · {segment.type} · {segment.startOffset}–{segment.endOffset}</span><strong>{segment.text}</strong><small>Kaynak referansı oluştur</small></button>)}</div>}
      {data.reference && <div className="policy-pdf-reference" role="status"><CheckCircle2 /><div><strong>Kaynak referansı doğrulandı</strong><span>{data.reference.locator}</span><q>{data.reference.rawExcerpt}</q></div></div>}
    </>}
  </section>
}

export function PolicyPdfTextApiModule({ caseId, source }: { caseId: string; source: DataSourceKind }) {
  if (source === 'mock') return <section className="policy-pdf-module policy-pdf-module--mock"><header><div><span className="eyebrow">Demo modu</span><h2>Poliçe Metin Çıkarımı</h2><p>Mock modda fiziksel PDF işlemi yapılmaz ve sonuç gerçek analiz olarak gösterilmez.</p></div></header></section>
  return <ApiModule caseId={caseId} />
}
