import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from '../app/sessionContext'
import type { DataSourceKind } from './ports'
import {
  createHttpTrafficValueLossReportAdapter,
  TrafficValueLossReportError,
  type TrafficValueLossReportDataPort,
  type TrafficValueLossReportPreviewRecord,
  type TrafficValueLossReportRecord,
} from './trafficValueLossReportPort'

export type TrafficValueLossReportLoadStatus =
  | 'idle'
  | 'loading'
  | 'ok'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'unavailable'

function message(error: unknown): string {
  if (!(error instanceof TrafficValueLossReportError)) return 'Nihai rapor işlemi güvenli biçimde tamamlanamadı.'
  switch (error.kind) {
    case 'unauthorized': return 'Oturumunuz sona erdi. Yeniden giriş yapın.'
    case 'forbidden': return 'Bu işlem için rolünüz yeterli değil.'
    case 'validation': return 'Rapor girdileri kabul edilmedi. Nihai notu ve önizlemeyi kontrol edin.'
    case 'not_found': return 'Rapor veya onaylı değer kaybı sürümü bulunamadı.'
    case 'conflict': return 'Rapor önizlemesi ya da değer kaybı sürümü değişti. Önizlemeyi yenileyin.'
    case 'unavailable': return 'Nihai rapor servisine ulaşılamadı. Mock çıktıya geçilmedi.'
  }
}

/** Liste, önizleme ve hata mesajı ait oldukları istek anahtarıyla taşınır. */
interface TrafficValueLossReportsLoadState {
  readonly key: string
  readonly reports: readonly TrafficValueLossReportRecord[]
  readonly preview: TrafficValueLossReportPreviewRecord | null
  readonly status: TrafficValueLossReportLoadStatus
  readonly errorMessage: string | null
}

export function useTrafficValueLossReports(
  caseId: string,
  source: DataSourceKind,
  enabled: boolean,
  suppliedPort?: TrafficValueLossReportDataPort,
) {
  const { reportUnauthorized } = useSession()
  const port = useMemo(() => suppliedPort ?? createHttpTrafficValueLossReportAdapter(), [suppliedPort])
  const [busy, setBusy] = useState(false)
  const [requestVersion, setRequestVersion] = useState(0)
  const active = source === 'api' && enabled
  // Yükleme durumu efektte senkron sıfırlanmaz; istek anahtarı değişince RENDER
  // sırasında türetilir. Rapor önizlemesi de aynı anahtarı taşır: anahtar
  // değişince (case değişimi veya retry) önizleme kendiliğinden düşer ve
  // anahtarı tutmayan geç yanıt yeni state'i ezemez.
  const requestKey = `${caseId}#${requestVersion}`
  const [loaded, setLoaded] = useState<TrafficValueLossReportsLoadState>(
    () => ({ key: requestKey, reports: [], preview: null, status: 'loading', errorMessage: null }),
  )
  const empty: TrafficValueLossReportsLoadState = { key: requestKey, reports: [], preview: null, status: 'loading', errorMessage: null }
  const current: TrafficValueLossReportsLoadState = loaded.key === requestKey ? loaded : empty
  const errorMessage = active ? current.errorMessage : null

  const retry = useCallback(() => {
    setRequestVersion((value) => value + 1)
  }, [])
  const load = useCallback(async () => {
    const items = await port.list(caseId)
    setLoaded((prev) => prev.key === requestKey ? { ...prev, reports: items, status: 'ok' } : prev)
  }, [caseId, port, requestKey])

  useEffect(() => {
    if (!active) return undefined
    let cancelled = false
    /** Sonuç yalnız kendi anahtarına yazılır; başka anahtarın state'i taşınmaz. */
    const base = (prev: TrafficValueLossReportsLoadState): TrafficValueLossReportsLoadState => prev.key === requestKey
      ? prev
      : { key: requestKey, reports: [], preview: null, status: 'loading', errorMessage: null }
    port.list(caseId).then((items) => {
      if (cancelled) return
      setLoaded((prev) => ({ ...base(prev), reports: items, status: 'ok' }))
    }).catch((error: unknown) => {
      if (cancelled) return
      const kind = error instanceof TrafficValueLossReportError ? error.kind : 'unavailable'
      setLoaded((prev) => ({
        ...base(prev),
        status: kind === 'validation' ? 'unavailable' : kind,
        errorMessage: message(error),
      }))
      if (kind === 'unauthorized') reportUnauthorized()
    })
    return () => { cancelled = true }
  }, [active, caseId, port, reportUnauthorized, requestKey])

  const run = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    setBusy(true)
    setLoaded((prev) => prev.key === requestKey ? { ...prev, errorMessage: null } : prev)
    try {
      return await operation()
    } catch (error) {
      const kind = error instanceof TrafficValueLossReportError ? error.kind : 'unavailable'
      setLoaded((prev) => prev.key === requestKey
        ? { ...prev, status: kind === 'validation' ? 'ok' : kind, errorMessage: message(error) }
        : prev)
      if (kind === 'unauthorized') reportUnauthorized()
      throw error
    } finally {
      setBusy(false)
    }
  }, [reportUnauthorized, requestKey])

  return {
    reports: active ? current.reports : [],
    preview: active ? current.preview : null,
    status: active ? current.status : 'idle',
    busy,
    errorMessage,
    retry,
    clearPreview: () => setLoaded((prev) => prev.key === requestKey ? { ...prev, preview: null } : prev),
    previewReport: (versionId: string, expectedAssessmentVersion: number, reportNote: string | null) =>
      run(async () => {
        const next = await port.preview(caseId, versionId, expectedAssessmentVersion, reportNote)
        setLoaded((prev) => prev.key === requestKey ? { ...prev, preview: next } : prev)
        return next
      }),
    generateReport: (
      versionId: string,
      expectedAssessmentVersion: number,
      reportNote: string | null,
      previewHash: string,
      idempotencyKey: string,
    ) => run(async () => {
      const report = await port.generate(
        caseId,
        versionId,
        expectedAssessmentVersion,
        reportNote,
        previewHash,
        idempotencyKey,
      )
      setLoaded((prev) => prev.key === requestKey ? { ...prev, preview: null } : prev)
      await load()
      return report
    }),
    downloadReport: (reportId: string) => run(() => port.download(caseId, reportId)),
  }
}
