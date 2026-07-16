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

export function useTrafficValueLossReports(
  caseId: string,
  source: DataSourceKind,
  enabled: boolean,
  suppliedPort?: TrafficValueLossReportDataPort,
) {
  const { reportUnauthorized } = useSession()
  const port = useMemo(() => suppliedPort ?? createHttpTrafficValueLossReportAdapter(), [suppliedPort])
  const [reports, setReports] = useState<readonly TrafficValueLossReportRecord[]>([])
  const [preview, setPreview] = useState<TrafficValueLossReportPreviewRecord | null>(null)
  const [status, setStatus] = useState<TrafficValueLossReportLoadStatus>('idle')
  const [busy, setBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [requestVersion, setRequestVersion] = useState(0)

  const retry = useCallback(() => {
    setPreview(null)
    setErrorMessage(null)
    setRequestVersion((value) => value + 1)
  }, [])
  const load = useCallback(async () => {
    const items = await port.list(caseId)
    setReports(items)
    setStatus('ok')
  }, [caseId, port])

  useEffect(() => {
    if (source !== 'api' || !enabled) {
      setReports([])
      setPreview(null)
      setStatus('idle')
      return
    }
    let cancelled = false
    setStatus('loading')
    setErrorMessage(null)
    port.list(caseId).then((items) => {
      if (cancelled) return
      setReports(items)
      setStatus('ok')
    }).catch((error: unknown) => {
      if (cancelled) return
      const kind = error instanceof TrafficValueLossReportError ? error.kind : 'unavailable'
      setStatus(kind === 'validation' ? 'unavailable' : kind)
      setErrorMessage(message(error))
      if (kind === 'unauthorized') reportUnauthorized()
    })
    return () => { cancelled = true }
  }, [caseId, enabled, port, reportUnauthorized, requestVersion, source])

  const run = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    setBusy(true)
    setErrorMessage(null)
    try {
      return await operation()
    } catch (error) {
      const kind = error instanceof TrafficValueLossReportError ? error.kind : 'unavailable'
      setStatus(kind === 'validation' ? 'ok' : kind)
      setErrorMessage(message(error))
      if (kind === 'unauthorized') reportUnauthorized()
      throw error
    } finally {
      setBusy(false)
    }
  }, [reportUnauthorized])

  return {
    reports,
    preview,
    status,
    busy,
    errorMessage,
    retry,
    clearPreview: () => setPreview(null),
    previewReport: (versionId: string, expectedAssessmentVersion: number, reportNote: string | null) =>
      run(async () => {
        const next = await port.preview(caseId, versionId, expectedAssessmentVersion, reportNote)
        setPreview(next)
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
      setPreview(null)
      await load()
      return report
    }),
    downloadReport: (reportId: string) => run(() => port.download(caseId, reportId)),
  }
}
