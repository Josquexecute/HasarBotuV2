import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, FileDown, LoaderCircle } from 'lucide-react'
import {
  CaseInventoryClientError,
  createHttpCaseInventoryAdapter,
  type CaseInventoryDataPort,
  type CaseInventoryPreviewRecord,
} from '../../data/caseInventoryPort'

/**
 * Dosya Envanteri — gerçek `.xlsx` dışa aktarma paneli (yalnız API modunda).
 *
 * Önizleme yalnız SAYIM döner; PII taşımaz. Gerçek satırlar (telefon dahil)
 * yalnız indirme sırasında üretilir ve tarayıcıya dosya olarak iner.
 */
export function CaseInventoryExportPanel({ port }: { readonly port?: CaseInventoryDataPort }) {
  const [adapter] = useState<CaseInventoryDataPort>(() => port ?? createHttpCaseInventoryAdapter())
  const [caseType, setCaseType] = useState<'' | 'traffic' | 'casco'>('')
  const [status, setStatus] = useState<'' | 'open' | 'closed'>('')
  const queryKey = `${caseType}#${status}`
  // Önizleme sayımı sorgu anahtarına bağlıdır; anahtar değişince RENDER
  // sırasında yeniden yüklenir (bkz. src/data hook'larındaki anahtarlı desen).
  const [preview, setPreview] = useState<{ key: string; value: CaseInventoryPreviewRecord | null; error: string | null }>(
    () => ({ key: queryKey, value: null, error: null }),
  )
  const current = preview.key === queryKey ? preview : { key: queryKey, value: null, error: null }
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    adapter.preview({
      ...(caseType === '' ? {} : { caseType }),
      ...(status === '' ? {} : { status }),
    }).then((result) => {
      if (cancelled) return
      setPreview({ key: queryKey, value: result, error: null })
    }).catch((error: unknown) => {
      if (cancelled) return
      setPreview({ key: queryKey, value: null, error: error instanceof CaseInventoryClientError ? error.kind : 'unavailable' })
    })
    return () => { cancelled = true }
  }, [adapter, caseType, status, queryKey])

  const download = useCallback(async () => {
    setDownloading(true)
    setDownloadError(null)
    try {
      const { blob, filename } = await adapter.exportWorkbook({
        ...(caseType === '' ? {} : { caseType }),
        ...(status === '' ? {} : { status }),
      })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      anchor.rel = 'noopener'
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      setDownloadError(error instanceof CaseInventoryClientError ? error.kind : 'unavailable')
    } finally {
      setDownloading(false)
    }
  }, [adapter, caseType, status])

  return (
    <section className="info-panel" aria-label="Dosya Envanteri">
      <header><div><h2>Dosya Envanteri</h2><span>Gerçek .xlsx dışa aktarma · kullanıcı kontrollü filtre</span></div><FileDown size={16} /></header>
      <div className="filterbar" aria-label="Envanter filtreleri">
        <label className="select-field">
          <span className="select-field__label">Dosya türü</span>
          <select aria-label="Envanter dosya türü" value={caseType} onChange={(event) => setCaseType(event.target.value as typeof caseType)}>
            <option value="">Tümü</option>
            <option value="traffic">Trafik</option>
            <option value="casco">Kasko</option>
          </select>
        </label>
        <label className="select-field">
          <span className="select-field__label">Durum</span>
          <select aria-label="Envanter durumu" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
            <option value="">Tümü</option>
            <option value="open">Açık</option>
            <option value="closed">Kapalı</option>
          </select>
        </label>
      </div>
      {current.error !== null && <div className="assistant-note" role="alert"><AlertTriangle size={15} /><span>Sayım alınamadı ({current.error}); mock veri gösterilmedi.</span></div>}
      {current.value !== null && (
        <p>
          <strong>{current.value.totalCount}</strong> dosya listelenecek
          {current.value.truncated ? ` (ilk ${current.value.maxRows} satırla sınırlı)` : ''}.
          {' '}Telefon sütunları {current.value.includesPhones ? 'bu oturumda dahil edilir.' : 'bu oturumda üretilmez (yetki).'}
        </p>
      )}
      {downloadError !== null && <div className="assistant-note" role="alert"><AlertTriangle size={15} /><span>İndirme başarısız ({downloadError}).</span></div>}
      <button className="button button--primary" type="button" disabled={downloading || current.value === null} onClick={() => void download()}>
        {downloading ? <LoaderCircle className="spin" size={15} /> : <FileDown size={15} />} Excel İndir
      </button>
    </section>
  )
}
