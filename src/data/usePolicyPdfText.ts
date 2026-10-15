import { useCallback, useEffect, useRef, useState } from 'react'
import { useSession } from '../app/sessionContext'
import { createHttpPolicyPdfTextAdapter, HttpPolicyPdfTextError } from './policyPdfTextHttpAdapter'
import type {
  PdfPolicySourceRecord, PdfTextExtractionRecord, PdfTextPageRecord,
  PdfTextSegmentRecord, PdfTextSourceReferenceRecord,
} from './ports'

export type PolicyPdfTextLoadStatus = 'loading' | 'ok' | 'empty' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'unavailable'

interface Workspace {
  key: string
  sources: readonly PdfPolicySourceRecord[]
  selected: PdfPolicySourceRecord | null
  extractions: readonly PdfTextExtractionRecord[]
  current: PdfTextExtractionRecord | null
  pages: readonly PdfTextPageRecord[]
  segments: readonly PdfTextSegmentRecord[]
  reference: PdfTextSourceReferenceRecord | null
  status: PolicyPdfTextLoadStatus
  busy: boolean
}

const emptyWorkspace = (key: string): Workspace => ({
  key, sources: [], selected: null, extractions: [], current: null,
  pages: [], segments: [], reference: null, status: 'loading', busy: false,
})
const isPending = (value: PdfTextExtractionRecord) => ['queued', 'processing'].includes(value.status)

export function usePolicyPdfText(caseId: string) {
  const { reportUnauthorized } = useSession()
  const [adapter] = useState(createHttpPolicyPdfTextAdapter)
  const epoch = useRef(0)
  const invalidate = useCallback(() => { epoch.current++ }, [])
  const createKey = useRef<{ source: string; value: string } | null>(null)
  const [revision, setRevision] = useState(0)
  const requestKey = `${caseId}#${revision}`
  const [loaded, setLoaded] = useState(() => emptyWorkspace(requestKey))
  const data = loaded.key === requestKey ? loaded : emptyWorkspace(requestKey)

  // A selection owns its requests, including requests already started by polling.
  const update = useCallback((generation: number, patch: Partial<Workspace>) => {
    if (epoch.current !== generation) return
    setLoaded(previous => epoch.current === generation && previous.key === requestKey ? { ...previous, ...patch } : previous)
  }, [requestKey])
  const fail = useCallback((generation: number, error: unknown) => {
    if (epoch.current !== generation) return
    const kind = error instanceof HttpPolicyPdfTextError ? error.kind : 'unavailable'
    update(generation, { status: kind, busy: false })
    if (kind === 'unauthorized') reportUnauthorized()
  }, [reportUnauthorized, update])
  const readContent = useCallback(async (value: PdfTextExtractionRecord | null) => {
    if (!value || !['ready', 'partial', 'ocr_required'].includes(value.status)) return { pages: [], segments: [] }
    const [pages, segments] = await Promise.all([
      adapter.listPages(caseId, value.id), adapter.listSegments(caseId, value.id),
    ])
    return { pages, segments }
  }, [adapter, caseId])

  useEffect(() => {
    const generation = ++epoch.current
    const load = async () => {
      const sources = await adapter.listSources(caseId)
      if (epoch.current !== generation) return
      const selected = sources[0] ?? null
      const extractions = selected ? await adapter.listExtractions(caseId, selected) : []
      if (epoch.current !== generation) return
      const current = extractions[0] ?? null
      const content = await readContent(current)
      if (epoch.current === generation) setLoaded({
        ...emptyWorkspace(requestKey), sources, selected, extractions, current, ...content,
        status: selected ? 'ok' : 'empty',
      })
    }
    void load().catch(error => {
      if (epoch.current !== generation) return
      setLoaded({ ...emptyWorkspace(requestKey), status: error instanceof HttpPolicyPdfTextError ? error.kind : 'unavailable' })
      if (error instanceof HttpPolicyPdfTextError && error.kind === 'unauthorized') reportUnauthorized()
    })
    return invalidate
  }, [adapter, caseId, invalidate, readContent, reportUnauthorized, requestKey])

  const currentId = data.current?.id
  const pending = data.current !== null && isPending(data.current)
  useEffect(() => {
    if (!currentId || !pending) return
    const generation = epoch.current
    let cancelled = false
    let inFlight = false
    const timer = setInterval(() => {
      if (inFlight || cancelled || epoch.current !== generation) return
      inFlight = true
      void adapter.getExtraction(caseId, currentId).then(async current => {
        if (cancelled || epoch.current !== generation) return
        const content = await readContent(current)
        if (cancelled || epoch.current !== generation) return
        setLoaded(previous => ({
          ...previous, current, ...content,
          extractions: previous.extractions.map(item => item.id === current.id ? current : item),
        }))
      }).catch(error => { if (!cancelled) fail(generation, error) })
        .finally(() => { inFlight = false })
    }, 1000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [adapter, caseId, currentId, fail, pending, readContent])

  const selectSource = useCallback((documentVersionId: string) => {
    const selected = data.sources.find(item => item.documentVersionId === documentVersionId) ?? null
    const generation = ++epoch.current
    update(generation, { selected, extractions: [], current: null, pages: [], segments: [], reference: null, busy: false, status: 'loading' })
    const load = async () => {
      const extractions = selected ? await adapter.listExtractions(caseId, selected) : []
      if (epoch.current !== generation) return
      const current = extractions[0] ?? null
      const content = await readContent(current)
      update(generation, { extractions, current, ...content, status: selected ? 'ok' : 'empty' })
    }
    void load().catch(error => fail(generation, error))
  }, [adapter, caseId, data.sources, fail, readContent, update])

  const selectExtraction = useCallback((id: string) => {
    const current = data.extractions.find(item => item.id === id) ?? null
    const generation = ++epoch.current
    update(generation, { current, pages: [], segments: [], reference: null, busy: true })
    void readContent(current).then(content => update(generation, { ...content, busy: false }))
      .catch(error => fail(generation, error))
  }, [data.extractions, fail, readContent, update])

  const create = useCallback(async () => {
    if (!data.selected || data.busy) return
    const selected = data.selected
    const generation = ++epoch.current
    const sourceKey = `${caseId}:${selected.documentVersionId}`
    if (createKey.current?.source !== sourceKey) createKey.current = { source: sourceKey, value: crypto.randomUUID() }
    update(generation, { busy: true, reference: null })
    try {
      const current = await adapter.createExtraction(caseId, selected, createKey.current.value)
      if (epoch.current !== generation) return
      createKey.current = null
      const content = await readContent(current)
      update(generation, { current, ...content, extractions: [current, ...data.extractions.filter(item => item.id !== current.id)], busy: false, status: 'ok' })
    } catch (error) { fail(generation, error) }
  }, [adapter, caseId, data.busy, data.extractions, data.selected, fail, readContent, update])

  const extractionForReference = data.current
  const makeReference = useCallback(async (item: PdfTextSegmentRecord) => {
    if (!extractionForReference || data.busy || !data.segments.some(segment => segment.id === item.id)) return
    const generation = epoch.current
    update(generation, { busy: true })
    try {
      const reference = await adapter.createSourceReference(caseId, extractionForReference.id, item, crypto.randomUUID())
      update(generation, { reference, busy: false })
    } catch (error) { fail(generation, error) }
  }, [adapter, caseId, data.busy, data.segments, extractionForReference, fail, update])

  return { ...data, create, selectSource, selectExtraction, makeReference, retry: () => setRevision(value => value + 1) }
}
