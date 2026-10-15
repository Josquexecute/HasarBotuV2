import { useCallback, useEffect, useRef, useState } from 'react'
import { useSession } from '../app/sessionContext'
import { createHttpPolicyOcrAdapter, HttpPolicyOcrError } from './policyOcrHttpAdapter'
import { createHttpPolicyPdfTextAdapter, HttpPolicyPdfTextError } from './policyPdfTextHttpAdapter'
import type {
  PdfPolicySourceRecord,
  PdfTextExtractionRecord,
  PdfTextPageRecord,
  PolicyOcrElementRecord,
  PolicyOcrLanguageMode,
  PolicyOcrPageRecord,
  PolicyOcrRenderProfile,
  PolicyOcrRunRecord,
  PolicyOcrSourceReferenceRecord,
} from './ports'

export type PolicyOcrLoadStatus = 'loading' | 'ok' | 'empty' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'unavailable'
const activeStatuses = ['queued', 'rendering', 'preprocessing', 'recognizing', 'normalizing', 'validating']
const readableStatuses = ['ready', 'partial', 'low_confidence', 'control_required', 'failed', 'superseded']

export function usePolicyOcr(caseId: string) {
  const { reportUnauthorized } = useSession()
  const ocrRef = useRef(createHttpPolicyOcrAdapter())
  const pdfRef = useRef(createHttpPolicyPdfTextAdapter())
  const keyRef = useRef<{ identity: string; value: string } | null>(null)
  const runEpoch = useRef(0)
  const invalidateRun = useCallback(() => { runEpoch.current++ }, [])
  const [source, setSource] = useState<PdfPolicySourceRecord | null>(null)
  const [extractions, setExtractions] = useState<readonly PdfTextExtractionRecord[]>([])
  const [selectedExtraction, setSelectedExtraction] = useState<PdfTextExtractionRecord | null>(null)
  // PDF sayfalari secili extraction'a baglidir; secim degisince liste efektte
  // senkron temizlenmez, RENDER sirasinda bos turetilir. Onceki extraction'in
  // sayfalari hicbir frame'de gorunmez.
  const [pdfPageState, setPdfPageState] = useState<{ key: string; items: readonly PdfTextPageRecord[] }>({ key: '', items: [] })
  const pdfPageKey = selectedExtraction?.id ?? ''
  const pdfPages = pdfPageState.key === pdfPageKey ? pdfPageState.items : []
  const [runs, setRuns] = useState<readonly PolicyOcrRunRecord[]>([])
  const [current, setCurrent] = useState<PolicyOcrRunRecord | null>(null)
  const [pages, setPages] = useState<readonly PolicyOcrPageRecord[]>([])
  const [elements, setElements] = useState<readonly PolicyOcrElementRecord[]>([])
  const [elementPage, setElementPage] = useState(1)
  const [reference, setReference] = useState<PolicyOcrSourceReferenceRecord | null>(null)
  const [language, setLanguage] = useState<PolicyOcrLanguageMode>('tur+eng')
  const [renderProfile, setRenderProfile] = useState<PolicyOcrRenderProfile>('standard')
  const [busy, setBusy] = useState(false)
  const [version, setVersion] = useState(0)
  // Yukleme durumu efektte senkron sifirlanmaz; istek anahtari degisince RENDER
  // sirasinda 'loading' turetilir ve butun durum yazicilari anahtarli oldugundan
  // gec donen bir yanit yeni anahtarin durumunu ezemez.
  const requestKey = `${caseId}#${version}`
  const [loadStatus, setLoadStatus] = useState<{ key: string; value: PolicyOcrLoadStatus }>(
    () => ({ key: requestKey, value: 'loading' }),
  )
  const status = loadStatus.key === requestKey ? loadStatus.value : 'loading'
  const setStatus = useCallback((value: PolicyOcrLoadStatus) => setLoadStatus({ key: requestKey, value }), [requestKey])

  const fail = useCallback((error: unknown) => {
    const kind = error instanceof HttpPolicyOcrError || error instanceof HttpPolicyPdfTextError ? error.kind : 'unavailable'
    setStatus(kind)
    if (kind === 'unauthorized') reportUnauthorized()
  }, [reportUnauthorized, setStatus])

  const loadRun = useCallback(async (value: PolicyOcrRunRecord | null) => {
    const generation = ++runEpoch.current
    setCurrent(value)
    setPages([])
    setElements([])
    setElementPage(1)
    setReference(null)
    try {
      if (value !== null && readableStatuses.includes(value.status)) {
        const [pageItems, elementItems] = await Promise.all([ocrRef.current.listPages(caseId, value.id), ocrRef.current.listElements(caseId, value.id)])
        if (runEpoch.current !== generation) return false
        setPages(pageItems)
        setElements(elementItems)
      }
      return runEpoch.current === generation
    } catch (error) {
      if (runEpoch.current === generation) fail(error)
      return false
    }
  }, [caseId, fail])

  useEffect(() => {
    let cancelled = false
    void pdfRef.current.listSources(caseId).then(async (sources) => {
      if (cancelled) return
      const selected = sources[0] ?? null
      setSource(selected)
      if (selected === null) { setStatus('empty'); return }
      const textRuns = await pdfRef.current.listExtractions(caseId, selected)
      if (cancelled) return
      const eligible = textRuns.filter((item) => ['partial', 'ocr_required'].includes(item.status))
      setExtractions(eligible)
      setSelectedExtraction(eligible[0] ?? null)
      const ocrRuns = await ocrRef.current.listRuns(caseId, selected)
      if (cancelled) return
      setRuns(ocrRuns)
      const loaded = await loadRun(ocrRuns[0] ?? null)
      if (!cancelled && loaded) setStatus('ok')
    }).catch((error) => { if (!cancelled) fail(error) })
    return () => { cancelled = true; invalidateRun() }
  }, [caseId, fail, invalidateRun, loadRun, setStatus, version])

  useEffect(() => {
    if (selectedExtraction === null) return undefined
    let cancelled = false
    void pdfRef.current.listPages(caseId, selectedExtraction.id).then((items) => {
      if (!cancelled) setPdfPageState({ key: pdfPageKey, items })
    }).catch((error) => { if (!cancelled) fail(error) })
    return () => { cancelled = true }
  }, [caseId, fail, pdfPageKey, selectedExtraction])

  useEffect(() => {
    if (current === null || !activeStatuses.includes(current.status)) return
    let cancelled = false
    let inFlight = false
    const timer = setInterval(() => {
      if (cancelled || inFlight) return
      inFlight = true
      const generation = runEpoch.current
      void ocrRef.current.getRun(caseId, current.id).then(async (value) => {
        if (cancelled || runEpoch.current !== generation) return
        setRuns((items) => items.map((item) => item.id === value.id ? value : item))
        await loadRun(value)
      }).catch(error => { if (!cancelled) fail(error) }).finally(() => { inFlight = false })
    }, 1200)
    return () => { cancelled = true; clearInterval(timer) }
  }, [caseId, current, fail, loadRun])

  const create = useCallback(async () => {
    if (source === null || selectedExtraction === null || busy) return
    let generation = runEpoch.current
    setBusy(true)
    const identity = `${caseId}:${source.documentVersionId}:${selectedExtraction.id}:${language}:${renderProfile}`
    if (keyRef.current?.identity !== identity) keyRef.current = { identity, value: crypto.randomUUID() }
    try {
      const value = await ocrRef.current.createRun(caseId, source, selectedExtraction.id, language, renderProfile, keyRef.current.value)
      if (runEpoch.current !== generation) return
      keyRef.current = null
      setRuns((items) => [value, ...items.filter((item) => item.id !== value.id)])
      const pending = loadRun(value)
      generation = runEpoch.current
      if (await pending) setStatus('ok')
    } catch (error) { if (runEpoch.current === generation) fail(error) }
    finally { if (runEpoch.current === generation) setBusy(false) }
  }, [busy, caseId, fail, language, loadRun, renderProfile, selectedExtraction, setStatus, source])

  const retryRun = useCallback(async () => {
    if (current === null || busy) return
    let generation = runEpoch.current
    setBusy(true)
    try {
      const value = await ocrRef.current.retryRun(caseId, current, crypto.randomUUID())
      if (runEpoch.current !== generation) return
      setRuns((items) => [value, ...items])
      const pending = loadRun(value)
      generation = runEpoch.current
      await pending
    } catch (error) { if (runEpoch.current === generation) fail(error) }
    finally { if (runEpoch.current === generation) setBusy(false) }
  }, [busy, caseId, current, fail, loadRun])

  const makeReference = useCallback(async (item: PolicyOcrElementRecord) => {
    if (current === null || busy) return
    const generation = runEpoch.current
    setBusy(true)
    try {
      const value = await ocrRef.current.createSourceReference(caseId, current, item, elements, crypto.randomUUID())
      if (runEpoch.current === generation) setReference(value)
    } catch (error) { if (runEpoch.current === generation) fail(error) }
    finally { if (runEpoch.current === generation) setBusy(false) }
  }, [busy, caseId, current, elements, fail])

  const changeElementPage = useCallback(async (nextPage: number) => {
    if (current === null || busy || nextPage < 1) return
    const generation = runEpoch.current
    setBusy(true)
    try {
      const items = await ocrRef.current.listElements(caseId, current.id, nextPage)
      if (runEpoch.current !== generation) return
      setElements(items)
      setElementPage(nextPage)
    } catch (error) { if (runEpoch.current === generation) fail(error) }
    finally { if (runEpoch.current === generation) setBusy(false) }
  }, [busy, caseId, current, fail])

  return {
    source, extractions, selectedExtraction, pdfPages, runs, current, pages, elements, elementPage, reference,
    language, renderProfile, status, busy, setLanguage, setRenderProfile, create,
    selectExtraction: (id: string) => setSelectedExtraction(extractions.find((item) => item.id === id) ?? null),
    selectRun: (id: string) => {
      const value = runs.find((item) => item.id === id) ?? null
      setBusy(true)
      const pending = loadRun(value), generation = runEpoch.current
      void pending.finally(() => { if (runEpoch.current === generation) setBusy(false) })
    },
    retryRun, makeReference, changeElementPage, retry: () => setVersion((item) => item + 1),
  }
}
