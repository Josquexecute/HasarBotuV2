import { useCallback, useEffect, useRef, useState } from 'react'
import { useSession } from '../app/sessionContext'
import { createHttpPolicyAiAdapter, HttpPolicyAiError } from './policyAiHttpAdapter'
import type {
  DataSourceKind,
  PolicyAiCandidateCategory,
  PolicyAiCandidateReviewInput,
  PolicyAiProviderId,
  PolicyAiPromotionRecord,
  PolicyAiSourceSelectionRecord,
  PolicyAiWorkspaceRecord,
} from './ports'

export type PolicyAiLoadStatus = 'idle' | 'loading' | 'ok' | 'empty' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'unavailable'
type BusyAction = 'plan' | 'start' | 'review' | 'promote' | null
interface IdempotencyAttempt { readonly identity: string; readonly key: string }

export function usePolicyAi(caseId: string, source: DataSourceKind) {
  const { reportUnauthorized } = useSession()
  const adapter = useRef(createHttpPolicyAiAdapter())
  const planAttempt = useRef<IdempotencyAttempt | null>(null)
  const startAttempt = useRef<IdempotencyAttempt | null>(null)
  const reviewAttempt = useRef<IdempotencyAttempt | null>(null)
  const promoteAttempt = useRef<IdempotencyAttempt | null>(null)
  const [busyAction, setBusyAction] = useState<BusyAction>(null)
  const [busyCandidateId, setBusyCandidateId] = useState<string | null>(null)
  const [filter, setFilter] = useState<PolicyAiCandidateCategory | 'all'>('all')
  const [version, setVersion] = useState(0)
  const active = source === 'api'
  // Yükleme durumu efektte senkron sıfırlanmaz; istek anahtarı değişince RENDER
  // sırasında türetilir. Başka case'in workspace'i hiçbir frame'de görünmez.
  // Bütün yazımlar anahtar korumalıdır: geç dönen yükleme veya mutasyon sonucu
  // daha yeni bir isteğin state'ini ezemez.
  const requestKey = `${caseId}#${version}`
  const [loaded, setLoaded] = useState<{ key: string; workspace: PolicyAiWorkspaceRecord | null; status: PolicyAiLoadStatus }>(
    () => ({ key: requestKey, workspace: null, status: 'loading' }),
  )
  const current = loaded.key === requestKey ? loaded : { key: requestKey, workspace: null, status: 'loading' as const }
  const workspace = active ? current.workspace : null
  const status: PolicyAiLoadStatus = active ? current.status : 'idle'

  const fail = useCallback((error: unknown) => {
    const kind = error instanceof HttpPolicyAiError ? error.kind : 'unavailable'
    setLoaded((prev) => prev.key === requestKey ? { ...prev, status: kind } : prev)
    if (kind === 'unauthorized') reportUnauthorized()
  }, [reportUnauthorized, requestKey])

  useEffect(() => {
    planAttempt.current = null
    startAttempt.current = null
    reviewAttempt.current = null
    promoteAttempt.current = null
  }, [caseId, source])

  useEffect(() => {
    if (!active) return undefined
    let cancelled = false
    void adapter.current.load(caseId).then((value) => {
      if (cancelled) return
      setLoaded({ key: requestKey, workspace: value, status: 'ok' })
    }).catch((error: unknown) => {
      if (!cancelled) fail(error)
    })
    return () => { cancelled = true }
  }, [active, caseId, fail, requestKey])

  const plan = useCallback(async (providerId: PolicyAiProviderId, selectedSources: readonly PolicyAiSourceSelectionRecord[]) => {
    if (workspace === null || selectedSources.length === 0 || busyAction !== null) return
    const provider = workspace.providers.find((item) => item.providerId === providerId)
    if (provider?.configured !== true) return
    const availableSourceKeys = new Set(workspace.availableSources.map((item) => item.sourceType === 'pdf_text'
      ? `pdf:${item.extractionId}:${item.segmentId}`
      : `ocr:${item.ocrRunId}:${item.elementId}`))
    const selectedSourceKeys = selectedSources.map((item) => item.sourceType === 'pdf_text'
      ? `pdf:${item.extractionId}:${item.segmentId}`
      : `ocr:${item.ocrRunId}:${item.elementId}`)
    if (new Set(selectedSourceKeys).size !== selectedSourceKeys.length || selectedSourceKeys.some((key) => !availableSourceKeys.has(key))) return
    const sourceIdentity = [...selectedSourceKeys].sort().join('|')
    const identity = `${caseId}:plan:${providerId}:${sourceIdentity}`
    if (planAttempt.current?.identity !== identity) planAttempt.current = { identity, key: crypto.randomUUID() }
    setBusyAction('plan')
    try {
      const planned = await adapter.current.plan(caseId, providerId, selectedSources, planAttempt.current.key)
      planAttempt.current = null
      startAttempt.current = null
      // İyimser sonuç hemen ardından gelen sürüm artışının anahtarına yazılır;
      // böylece yeniden okuma başlayana kadar planlanan run görünür kalır.
      setLoaded({ key: `${caseId}#${version + 1}`, workspace: { ...workspace, run: planned, candidates: [], conflicts: [], promotionPreview: null, promotion: null }, status: 'ok' })
      setVersion((value) => value + 1)
    } catch (error) {
      fail(error)
    } finally {
      setBusyAction(null)
    }
  }, [busyAction, caseId, fail, version, workspace])

  const start = useCallback(async () => {
    if (workspace?.run === null || workspace === null || busyAction !== null) return
    const identity = `${caseId}:start:${workspace.run.id}:${workspace.run.sourceBundleHash}:${workspace.run.version}`
    if (startAttempt.current?.identity !== identity) startAttempt.current = { identity, key: crypto.randomUUID() }
    setBusyAction('start')
    try {
      const started = await adapter.current.start(caseId, workspace.run, startAttempt.current.key)
      startAttempt.current = null
      // İyimser sonuç sürüm artışının anahtarına yazılır (bkz. plan).
      setLoaded({ key: `${caseId}#${version + 1}`, workspace: { ...workspace, run: started, promotionPreview: null, promotion: null }, status: 'ok' })
      setVersion((value) => value + 1)
    } catch (error) {
      fail(error)
    } finally {
      setBusyAction(null)
    }
  }, [busyAction, caseId, fail, version, workspace])

  const review = useCallback(async (candidateId: string, input: PolicyAiCandidateReviewInput) => {
    if (workspace?.run === null || workspace === null || busyAction !== null) return
    const identity = `${caseId}:review:${workspace.run.id}:${candidateId}:${JSON.stringify(input)}`
    if (reviewAttempt.current?.identity !== identity) reviewAttempt.current = { identity, key: crypto.randomUUID() }
    setBusyAction('review')
    setBusyCandidateId(candidateId)
    try {
      const reviewed = await adapter.current.review(caseId, workspace.run.id, candidateId, input, reviewAttempt.current.key)
      const preview = await adapter.current.previewPromotion(caseId, workspace.run.id)
      reviewAttempt.current = null
      promoteAttempt.current = null
      setLoaded((prev) => prev.key === requestKey
        ? { key: requestKey, workspace: { ...workspace, candidates: workspace.candidates.map((item) => item.candidateId === candidateId ? { ...item, review: reviewed } : item), promotionPreview: preview, promotion: null }, status: 'ok' }
        : prev)
    } catch (error) {
      fail(error)
    } finally {
      setBusyCandidateId(null)
      setBusyAction(null)
    }
  }, [busyAction, caseId, fail, requestKey, workspace])

  const promote = useCallback(async (): Promise<PolicyAiPromotionRecord | null> => {
    if (workspace === null) return null
    const preview = workspace.promotionPreview
    if (preview === null || !preview.canPromote || busyAction !== null) return null
    const identity = `${caseId}:promote:${preview.runId}:${preview.reviewSetHash}:${preview.targetAnalysisId ?? 'new'}:${preview.targetAnalysisVersion ?? 0}`
    if (promoteAttempt.current?.identity !== identity) promoteAttempt.current = { identity, key: crypto.randomUUID() }
    setBusyAction('promote')
    try {
      const promoted = await adapter.current.promote(caseId, preview, promoteAttempt.current.key)
      promoteAttempt.current = null
      setLoaded((prev) => prev.key === requestKey
        ? { key: requestKey, workspace: { ...workspace, promotion: promoted }, status: 'ok' }
        : prev)
      return promoted
    } catch (error) {
      fail(error)
      return null
    } finally {
      setBusyAction(null)
    }
  }, [busyAction, caseId, fail, requestKey, workspace])

  const retry = useCallback(() => {
    setVersion((value) => value + 1)
  }, [])

  const candidates = workspace?.candidates.filter((item) => filter === 'all' || item.category === filter) ?? []
  return { workspace, status, busy: busyAction !== null, busyAction, busyCandidateId, filter, setFilter, candidates, plan, start, review, promote, retry }
}
