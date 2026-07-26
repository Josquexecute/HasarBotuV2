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

/** Boş yükleme durumu modül düzeyindedir; render başına yeniden kurulmaz. */
function blankState(key: string, status: TrafficValueLossLoadStatus): TrafficValueLossLoadState {
  return { key, assessment: null, versions: [], currentApproved: null, previewResult: null, catalog: null, status, errorMessage: null }
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
  const [loaded, setLoaded] = useState<TrafficValueLossLoadState>(() => blankState(requestKey, 'loading'))
  const current = loaded.key === requestKey ? loaded : blankState(requestKey, 'loading')
  const view = active ? current : blankState(requestKey, 'idle')
  const { assessment, versions, currentApproved, previewResult, catalog, status, errorMessage } = view

  /** Yalniz gecerli anahtarin state'ini gunceller; bayat yazim yok sayilir. */
  const patch = useCallback((changes: Partial<TrafficValueLossLoadState>) => {
    setLoaded((prev) => prev.key === requestKey ? { ...prev, ...changes } : prev)
  }, [requestKey])

  const retry = useCallback(() => {
    setRequestVersion((value) => value + 1)
  }, [])

  const load = useCallback(async () => {
    const workspace = await port.load(caseId)
    patch({
      assessment: workspace.assessment,
      versions: workspace.versions,
      currentApproved: workspace.currentApproved ?? null,
      status: workspace.assessment === null ? 'empty' : 'ok',
    })
  }, [caseId, patch, port])

  useEffect(() => {
    if (!active) return undefined
    let cancelled = false
    port.load(caseId)
      .then((workspace) => {
        if (cancelled) return
        setLoaded((prev) => ({
          ...(prev.key === requestKey ? prev : blankState(requestKey, 'loading')),
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
          ...(prev.key === requestKey ? prev : blankState(requestKey, 'loading')),
          status: kind === 'validation' ? 'unavailable' : kind,
          errorMessage: safeMessage(error),
        }))
        if (kind === 'unauthorized') reportUnauthorized()
      })
    return () => { cancelled = true }
  }, [active, caseId, port, reportUnauthorized, requestKey])

  const command = useCallback(async (run: () => Promise<TrafficValueLossAssessmentRecord>) => {
    setBusy(true)
    patch({ errorMessage: null })
    try {
      await run()
      await load()
    } catch (error) {
      const kind = error instanceof TrafficValueLossError ? error.kind : 'unavailable'
      patch({ ...(kind === 'validation' ? {} : { status: kind }), errorMessage: safeMessage(error) })
      if (kind === 'unauthorized') reportUnauthorized()
      throw error
    } finally {
      setBusy(false)
    }
  }, [load, patch, reportUnauthorized])
  // React Compiler `assessment?.version` bağımlılığını `assessment` olarak
  // çıkarımladığı için manuel memoization'ı koruyamıyor ve bileşenin tamamını
  // optimizasyon dışı bırakıyordu. Sürüm önce primitife indirgenince çıkarımlanan
  // ve bildirilen bağımlılık birebir eşleşir; çağrıya giden değer aynı kalır.
  const assessmentVersion = assessment?.version ?? 0
  const preview = useCallback(async (input: TrafficValueLossDraftInput) => {
    setBusy(true)
    patch({ errorMessage: null })
    try {
      if (port.preview === undefined) throw new TrafficValueLossError('unavailable', 'preview endpoint unavailable')
      patch({ previewResult: await port.preview(caseId, assessmentVersion, input) })
    } catch (error) {
      patch({ errorMessage: safeMessage(error) })
      throw error
    } finally {
      setBusy(false)
    }
  }, [assessmentVersion, caseId, patch, port])
  const loadCatalog = useCallback(async (
    vehicleGroupCode: NonNullable<TrafficValueLossRealMarketInput['vehicleGroupCode']>,
  ) => {
    if (port.partCatalog === undefined) throw new TrafficValueLossError('unavailable', 'part catalog endpoint unavailable')
    patch({ catalog: await port.partCatalog(caseId, vehicleGroupCode) })
  }, [caseId, patch, port])

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
