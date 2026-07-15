import { useCallback, useEffect, useRef, useState } from 'react'
import { useSession } from '../app/sessionContext'
import { createHttpPolicyAiAdapter, HttpPolicyAiError } from './policyAiHttpAdapter'
import type { DataSourceKind, PolicyAiCandidateCategory, PolicyAiCandidateReviewInput, PolicyAiWorkspaceRecord } from './ports'

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
  const [workspace, setWorkspace] = useState<PolicyAiWorkspaceRecord | null>(null)
  const [status, setStatus] = useState<PolicyAiLoadStatus>('idle')
  const [busyAction, setBusyAction] = useState<BusyAction>(null)
  const [busyCandidateId, setBusyCandidateId] = useState<string | null>(null)
  const [filter, setFilter] = useState<PolicyAiCandidateCategory | 'all'>('all')
  const [version, setVersion] = useState(0)

  const fail = useCallback((error: unknown) => {
    const kind = error instanceof HttpPolicyAiError ? error.kind : 'unavailable'
    setStatus(kind)
    if (kind === 'unauthorized') reportUnauthorized()
  }, [reportUnauthorized])

  useEffect(() => {
    planAttempt.current = null
    startAttempt.current = null
    reviewAttempt.current = null
    promoteAttempt.current = null
  }, [caseId, source])

  useEffect(() => {
    if (source !== 'api') {
      setStatus('idle')
      setWorkspace(null)
      return
    }
    let cancelled = false
    setStatus('loading')
    setWorkspace(null)
    void adapter.current.load(caseId).then((value) => {
      if (cancelled) return
      setWorkspace(value)
      setStatus(value.run === null && value.availableSources.length === 0 ? 'empty' : 'ok')
    }).catch((error: unknown) => {
      if (!cancelled) fail(error)
    })
    return () => { cancelled = true }
  }, [caseId, fail, source, version])

  const plan = useCallback(async () => {
    if (workspace === null || workspace.availableSources.length === 0 || busyAction !== null) return
    const sourceIdentity = workspace.availableSources.map((item) => item.sourceType === 'pdf_text' ? `pdf:${item.extractionId}:${item.segmentId}` : `ocr:${item.ocrRunId}:${item.elementId}`).sort().join('|')
    const identity = `${caseId}:plan:${sourceIdentity}`
    if (planAttempt.current?.identity !== identity) planAttempt.current = { identity, key: crypto.randomUUID() }
    setBusyAction('plan')
    try {
      const planned = await adapter.current.plan(caseId, workspace.availableSources, planAttempt.current.key)
      planAttempt.current = null
      startAttempt.current = null
      setWorkspace({ ...workspace, run: planned, candidates: [], conflicts: [], promotionPreview: null, promotion: null })
      setStatus('ok')
      setVersion((value) => value + 1)
    } catch (error) {
      fail(error)
    } finally {
      setBusyAction(null)
    }
  }, [busyAction, caseId, fail, workspace])

  const start = useCallback(async () => {
    if (workspace?.run === null || workspace === null || busyAction !== null) return
    const identity = `${caseId}:start:${workspace.run.id}:${workspace.run.sourceBundleHash}:${workspace.run.version}`
    if (startAttempt.current?.identity !== identity) startAttempt.current = { identity, key: crypto.randomUUID() }
    setBusyAction('start')
    try {
      const started = await adapter.current.start(caseId, workspace.run, startAttempt.current.key)
      startAttempt.current = null
      setWorkspace({ ...workspace, run: started, promotionPreview: null, promotion: null })
      setStatus('ok')
      setVersion((value) => value + 1)
    } catch (error) {
      fail(error)
    } finally {
      setBusyAction(null)
    }
  }, [busyAction, caseId, fail, workspace])

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
      setWorkspace({ ...workspace, candidates: workspace.candidates.map((item) => item.candidateId === candidateId ? { ...item, review: reviewed } : item), promotionPreview: preview, promotion: null })
      setStatus('ok')
    } catch (error) {
      fail(error)
    } finally {
      setBusyCandidateId(null)
      setBusyAction(null)
    }
  }, [busyAction, caseId, fail, workspace])

  const promote = useCallback(async () => {
    if (workspace === null) return
    const preview = workspace.promotionPreview
    if (preview === null || !preview.canPromote || busyAction !== null) return
    const identity = `${caseId}:promote:${preview.runId}:${preview.reviewSetHash}:${preview.targetAnalysisId ?? 'new'}:${preview.targetAnalysisVersion ?? 0}`
    if (promoteAttempt.current?.identity !== identity) promoteAttempt.current = { identity, key: crypto.randomUUID() }
    setBusyAction('promote')
    try {
      const promoted = await adapter.current.promote(caseId, preview, promoteAttempt.current.key)
      promoteAttempt.current = null
      setWorkspace({ ...workspace, promotion: promoted })
      setStatus('ok')
    } catch (error) {
      fail(error)
    } finally {
      setBusyAction(null)
    }
  }, [busyAction, caseId, fail, workspace])

  const retry = useCallback(() => {
    setStatus('loading')
    setVersion((value) => value + 1)
  }, [])

  const candidates = workspace?.candidates.filter((item) => filter === 'all' || item.category === filter) ?? []
  return { workspace, status, busy: busyAction !== null, busyAction, busyCandidateId, filter, setFilter, candidates, plan, start, review, promote, retry }
}
