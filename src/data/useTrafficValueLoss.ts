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

/** Yükleme kapsamındaki bütün dilimler ait oldukları istek anahtarıyla taşınır. */
interface TrafficValueLossLoadState {
  readonly key: string
  readonly assessment: TrafficValueLossAssessmentRecord | null
  readonly versions: readonly TrafficValueLossVersionRecord[]
  readonly currentApproved: TrafficValueLossVersionRecord | null
  readonly previewResult: TrafficValueLossPreviewRecord | null
  readonly catalog: TrafficValueLossPartCatalogRecord | null
  readonly status: TrafficValueLossLoadStatus
  readonly errorMessage: string | null
}

export function useTrafficValueLoss(
  caseId: string,
  source: DataSourceKind,
  enabled: boolean,
  suppliedPort?: TrafficValueLossDataPort,
): UseTrafficValueLossResult {
  const { reportUnauthorized } = useSession()
  const port = useMemo(() => suppliedPort ?? createHttpTrafficValueLossAdapter(), [suppliedPort])
  const [busy, setBusy] = useState(false)
  const [requestVersion, setRequestVersion] = useState(0)
  const active = source === 'api' && enabled
  // Yükleme kapsamındaki bütün dilimler (assessment, sürümler, current-approved,
  // önizleme, katalog, durum, hata mesajı) tek bir anahtarlı nesnede taşınır.
  // Efektte senkron sıfırlama yapılmaz: anahtar değişince RENDER sırasında boş
  // türetilir, böylece başka bir case'in veya eski bir retry'ın değer kaybı
  // verisi hiçbir frame'de görünmez. Bütün yazıcılar anahtar korumalıdır;
  // geç dönen bir yükleme veya komut sonucu yeni anahtarın state'ini ezemez.
  const requestKey = `${caseId}#${requestVersion}`
  const blank = useCallback((key: string, status: TrafficValueLossLoadStatus): TrafficValueLossLoadState => ({
    key,
    assessment: null,
    versions: [],
    currentApproved: null,
    previewResult: null,
    catalog: null,
    status,
    errorMessage: null,
  }), [])
  const [loaded, setLoaded] = useState<TrafficValueLossLoadState>(() => blank(requestKey, 'loading'))
  const current = loaded.key === requestKey ? loaded : blank(requestKey, 'loading')
  const view = active ? current : blank(requestKey, 'idle')
  const { assessment, versions, currentApproved, previewResult, catalog, status, errorMessage } = view

  const retry = useCallback(() => {
    setRequestVersion((value) => value + 1)
  }, [])

  const load = useCallback(async () => {
    const workspace = await port.load(caseId)
    setLoaded((prev) => prev.key !== requestKey ? prev : {
      ...prev,
      assessment: workspace.assessment,
      versions: workspace.versions,
      currentApproved: workspace.currentApproved ?? null,
      status: workspace.assessment === null ? 'empty' : 'ok',
    })
  }, [caseId, port, requestKey])

  useEffect(() => {
    if (!active) return undefined
    let cancelled = false
    port.load(caseId)
      .then((workspace) => {
        if (cancelled) return
        setLoaded((prev) => ({
          ...(prev.key === requestKey ? prev : blank(requestKey, 'loading')),
          assessment: workspace.assessment,
          versions: workspace.versions,
          currentApproved: workspace.currentApproved ?? null,
          status: workspace.assessment === null ? 'empty' : 'ok',
        }))
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const kind = error instanceof TrafficValueLossError ? error.kind : 'unavailable'
        setLoaded((prev) => ({
          ...(prev.key === requestKey ? prev : blank(requestKey, 'loading')),
          status: kind === 'validation' ? 'unavailable' : kind,
          errorMessage: safeMessage(error),
        }))
        if (kind === 'unauthorized') reportUnauthorized()
      })
    return () => { cancelled = true }
  }, [active, blank, caseId, port, reportUnauthorized, requestKey])

  const command = useCallback(async (run: () => Promise<TrafficValueLossAssessmentRecord>) => {
    setBusy(true)
    setLoaded((prev) => prev.key === requestKey ? { ...prev, errorMessage: null } : prev)
    try {
      await run()
      await load()
    } catch (error) {
      const kind = error instanceof TrafficValueLossError ? error.kind : 'unavailable'
      setLoaded((prev) => prev.key !== requestKey ? prev : {
        ...prev,
        ...(kind === 'validation' ? {} : { status: kind }),
        errorMessage: safeMessage(error),
      })
      if (kind === 'unauthorized') reportUnauthorized()
      throw error
    } finally {
      setBusy(false)
    }
  }, [load, reportUnauthorized, requestKey])
  // React Compiler `assessment?.version` bağımlılığını `assessment` olarak
  // çıkarımladığı için manuel memoization'ı koruyamıyor ve bileşenin tamamını
  // optimizasyon dışı bırakıyordu. Sürüm önce primitife indirgenince çıkarımlanan
  // ve bildirilen bağımlılık birebir eşleşir; çağrıya giden değer aynı kalır.
  const assessmentVersion = assessment?.version ?? 0
  const preview = useCallback(async (input: TrafficValueLossDraftInput) => {
    setBusy(true)
    setLoaded((prev) => prev.key === requestKey ? { ...prev, errorMessage: null } : prev)
    try {
      if (port.preview === undefined) throw new TrafficValueLossError('unavailable', 'preview endpoint unavailable')
      const result = await port.preview(caseId, assessmentVersion, input)
      setLoaded((prev) => prev.key === requestKey ? { ...prev, previewResult: result } : prev)
    } catch (error) {
      setLoaded((prev) => prev.key === requestKey ? { ...prev, errorMessage: safeMessage(error) } : prev)
      throw error
    } finally {
      setBusy(false)
    }
  }, [assessmentVersion, caseId, port, requestKey])
  const loadCatalog = useCallback(async (
    vehicleGroupCode: NonNullable<TrafficValueLossRealMarketInput['vehicleGroupCode']>,
  ) => {
    if (port.partCatalog === undefined) throw new TrafficValueLossError('unavailable', 'part catalog endpoint unavailable')
    const result = await port.partCatalog(caseId, vehicleGroupCode)
    setLoaded((prev) => prev.key === requestKey ? { ...prev, catalog: result } : prev)
  }, [caseId, port, requestKey])

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
