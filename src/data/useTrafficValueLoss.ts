import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from '../app/sessionContext'
import type { DataSourceKind } from './ports'
import {
  createHttpTrafficValueLossAdapter,
  TrafficValueLossError,
  type TrafficValueLossAssessmentRecord,
  type TrafficValueLossDataPort,
  type TrafficValueLossDraftInput,
  type TrafficValueLossPartCatalogRecord,
  type TrafficValueLossPreviewRecord,
  type TrafficValueLossRealMarketInput,
  type TrafficValueLossVersionRecord,
} from './trafficValueLossPort'

export type TrafficValueLossLoadStatus =
  | 'idle'
  | 'loading'
  | 'empty'
  | 'ok'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'unavailable'

export interface UseTrafficValueLossResult {
  readonly assessment: TrafficValueLossAssessmentRecord | null
  readonly currentApproved: TrafficValueLossVersionRecord | null
  readonly versions: readonly TrafficValueLossVersionRecord[]
  readonly previewResult: TrafficValueLossPreviewRecord | null
  readonly catalog: TrafficValueLossPartCatalogRecord | null
  readonly status: TrafficValueLossLoadStatus
  readonly busy: boolean
  readonly errorMessage: string | null
  retry(): void
  preview(input: TrafficValueLossDraftInput): Promise<void>
  loadCatalog(vehicleGroupCode: NonNullable<TrafficValueLossRealMarketInput['vehicleGroupCode']>): Promise<void>
  createVersion(input: TrafficValueLossDraftInput, idempotencyKey: string): Promise<void>
  submit(idempotencyKey: string): Promise<void>
  approve(reason: string | null, idempotencyKey: string): Promise<void>
  reject(reason: string, idempotencyKey: string): Promise<void>
}

function safeMessage(error: unknown): string {
  if (!(error instanceof TrafficValueLossError)) return 'Değer kaybı işlemi güvenli biçimde tamamlanamadı.'
  switch (error.kind) {
    case 'unauthorized': return 'Oturumunuz sona erdi. Yeniden giriş yapın.'
    case 'forbidden': return 'Bu işlem için rolünüz yeterli değil.'
    case 'validation': return 'Girdiler kabul edilmedi. Alanları ve kanıt bağlantılarını kontrol edin.'
    case 'not_found': return 'Dosya veya değer kaybı sürümü bulunamadı.'
    case 'conflict': return 'Değer kaybı sürümü değişti. Güncel veriyi yeniden yükleyin.'
    case 'unavailable': return 'Değer kaybı servisine ulaşılamadı. Mock veriye geçilmedi.'
  }
}

export function useTrafficValueLoss(
  caseId: string,
  source: DataSourceKind,
  enabled: boolean,
  suppliedPort?: TrafficValueLossDataPort,
): UseTrafficValueLossResult {
  const { reportUnauthorized } = useSession()
  const port = useMemo(() => suppliedPort ?? createHttpTrafficValueLossAdapter(), [suppliedPort])
  const [assessment, setAssessment] = useState<TrafficValueLossAssessmentRecord | null>(null)
  const [versions, setVersions] = useState<readonly TrafficValueLossVersionRecord[]>([])
  const [currentApproved, setCurrentApproved] = useState<TrafficValueLossVersionRecord | null>(null)
  const [previewResult, setPreviewResult] = useState<TrafficValueLossPreviewRecord | null>(null)
  const [catalog, setCatalog] = useState<TrafficValueLossPartCatalogRecord | null>(null)
  const [status, setStatus] = useState<TrafficValueLossLoadStatus>('idle')
  const [busy, setBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [requestVersion, setRequestVersion] = useState(0)

  const retry = useCallback(() => {
    setErrorMessage(null)
    setRequestVersion((value) => value + 1)
  }, [])

  const load = useCallback(async () => {
    const workspace = await port.load(caseId)
    setAssessment(workspace.assessment)
    setVersions(workspace.versions)
    setCurrentApproved(workspace.currentApproved ?? null)
    setStatus(workspace.assessment === null ? 'empty' : 'ok')
  }, [caseId, port])

  useEffect(() => {
    if (source !== 'api' || !enabled) {
      setAssessment(null)
      setVersions([])
      setCurrentApproved(null)
      setPreviewResult(null)
      setCatalog(null)
      setStatus('idle')
      return
    }
    let cancelled = false
    setStatus('loading')
    setErrorMessage(null)
    port.load(caseId)
      .then((workspace) => {
        if (cancelled) return
        setAssessment(workspace.assessment)
        setVersions(workspace.versions)
        setCurrentApproved(workspace.currentApproved ?? null)
        setStatus(workspace.assessment === null ? 'empty' : 'ok')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const kind = error instanceof TrafficValueLossError ? error.kind : 'unavailable'
        setStatus(kind === 'validation' ? 'unavailable' : kind)
        setErrorMessage(safeMessage(error))
        if (kind === 'unauthorized') reportUnauthorized()
      })
    return () => { cancelled = true }
  }, [caseId, enabled, port, reportUnauthorized, requestVersion, source])

  const command = useCallback(async (run: () => Promise<TrafficValueLossAssessmentRecord>) => {
    setBusy(true)
    setErrorMessage(null)
    try {
      await run()
      await load()
    } catch (error) {
      const kind = error instanceof TrafficValueLossError ? error.kind : 'unavailable'
      if (kind !== 'validation') setStatus(kind)
      setErrorMessage(safeMessage(error))
      if (kind === 'unauthorized') reportUnauthorized()
      throw error
    } finally {
      setBusy(false)
    }
  }, [load, reportUnauthorized])
  // React Compiler `assessment?.version` bağımlılığını `assessment` olarak
  // çıkarımladığı için manuel memoization'ı koruyamıyor ve bileşenin tamamını
  // optimizasyon dışı bırakıyordu. Sürüm önce primitife indirgenince çıkarımlanan
  // ve bildirilen bağımlılık birebir eşleşir; çağrıya giden değer aynı kalır.
  const assessmentVersion = assessment?.version ?? 0
  const preview = useCallback(async (input: TrafficValueLossDraftInput) => {
    setBusy(true)
    setErrorMessage(null)
    try {
      if (port.preview === undefined) throw new TrafficValueLossError('unavailable', 'preview endpoint unavailable')
      setPreviewResult(await port.preview(caseId, assessmentVersion, input))
    } catch (error) {
      setErrorMessage(safeMessage(error))
      throw error
    } finally {
      setBusy(false)
    }
  }, [assessmentVersion, caseId, port])
  const loadCatalog = useCallback(async (
    vehicleGroupCode: NonNullable<TrafficValueLossRealMarketInput['vehicleGroupCode']>,
  ) => {
    if (port.partCatalog === undefined) throw new TrafficValueLossError('unavailable', 'part catalog endpoint unavailable')
    setCatalog(await port.partCatalog(caseId, vehicleGroupCode))
  }, [caseId, port])

  return {
    assessment,
    currentApproved,
    versions,
    previewResult,
    catalog,
    status,
    busy,
    errorMessage,
    retry,
    preview,
    loadCatalog,
    createVersion: (input, key) => command(() => port.createVersion(caseId, assessment?.version ?? 0, input, key)),
    submit: (key) => {
      if (assessment === null) return Promise.reject(new TrafficValueLossError('not_found', 'assessment missing'))
      return command(() => port.submit(caseId, assessment.currentVersion.id, assessment.version, key))
    },
    approve: (reason, key) => {
      if (assessment === null) return Promise.reject(new TrafficValueLossError('not_found', 'assessment missing'))
      return command(() => port.approve(caseId, assessment.currentVersion.id, assessment.version, reason, key))
    },
    reject: (reason, key) => {
      if (assessment === null) return Promise.reject(new TrafficValueLossError('not_found', 'assessment missing'))
      return command(() => port.reject(caseId, assessment.currentVersion.id, assessment.version, reason, key))
    },
  }
}
