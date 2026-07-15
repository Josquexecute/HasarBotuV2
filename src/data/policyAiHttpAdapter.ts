import type {
  PolicyAiCandidateRecord,
  PolicyAiDataPort,
  PolicyAiRunRecord,
  PolicyAiRunStatus,
  PolicyAiSourceItemRecord,
  PolicyAiSourceOverviewRecord,
  PolicyAiSourceSelectionRecord,
  PolicyAiWorkspaceRecord,
  PolicyOcrPageRecord,
} from './ports'
import { createHttpPolicyOcrAdapter, HttpPolicyOcrError } from './policyOcrHttpAdapter'
import { createHttpPolicyPdfTextAdapter, HttpPolicyPdfTextError } from './policyPdfTextHttpAdapter'

export type HttpPolicyAiErrorKind = 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'unavailable'

export class HttpPolicyAiError extends Error {
  constructor(readonly kind: HttpPolicyAiErrorKind, message: string) {
    super(message)
    this.name = 'HttpPolicyAiError'
  }
}

const runStatuses: readonly PolicyAiRunStatus[] = ['planned', 'provider_disabled', 'budget_blocked', 'running', 'validating', 'review_required', 'failed', 'stale', 'cancelled', 'superseded']
const candidateCategories = ['policy_identity', 'coverage', 'deductible', 'service_rule', 'part_rule', 'replacement_vehicle', 'assistance', 'valuation', 'exclusion', 'required_document', 'special_condition'] as const
const sourceQualities = ['high', 'medium', 'low', 'control_required'] as const
const validationStatuses = ['validated', 'control_required', 'rejected_evidence'] as const
const conflictStatuses = ['none', 'duplicate', 'conflict_detected', 'control_required'] as const
const humanReviewStatuses = ['pending', 'control_required'] as const
const sha256Pattern = /^[a-f0-9]{64}$/
const maximumBundleItems = 200
const maximumItemsPerExtraction = 40

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasString(value: unknown, maximum = 2_000): value is string {
  return typeof value === 'string' && value.length <= maximum
}

function hasStringArray(value: unknown, maximumItems: number, maximumText = 500): value is string[] {
  return Array.isArray(value) && value.length <= maximumItems && value.every((item) => hasString(item, maximumText))
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isNullableNonnegativeInteger(value: unknown): value is number | null {
  return value === null || isNonnegativeInteger(value)
}

function isNullableString(value: unknown, maximum = 100): value is string | null {
  return value === null || hasString(value, maximum)
}

function isNormalizedValue(value: unknown, depth = 0): boolean {
  if (depth > 8) return false
  if (value === null || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'string') return value.length <= 2_000
  if (Array.isArray(value)) return value.length <= 20 && value.every((item) => isNormalizedValue(item, depth + 1))
  if (!record(value) || Object.keys(value).length > 20) return false
  return Object.entries(value).every(([key, item]) => /^[a-zA-Z0-9_.-]{1,80}$/.test(key) && isNormalizedValue(item, depth + 1))
}

function sourceItem(value: unknown): PolicyAiSourceItemRecord {
  if (!record(value)
    || !hasString(value.sourceAnchorId, 64) || !sha256Pattern.test(value.sourceAnchorId)
    || !['pdf_text', 'ocr'].includes(String(value.sourceType))
    || !hasString(value.documentId, 80)
    || !hasString(value.documentVersionId, 80)
    || !hasString(value.extractionId, 80)
    || !hasString(value.sourceItemId, 80)
    || !isNonnegativeInteger(value.pageNumber) || value.pageNumber < 1
    || !hasString(value.boundedExcerpt, 2_000)
    || !hasString(value.textHash, 64) || !sha256Pattern.test(value.textHash)
    || !sourceQualities.includes(value.sourceQuality as typeof sourceQualities[number])
    || !hasStringArray(value.warnings, 20, 64)
    || typeof value.historicalSelected !== 'boolean') throw new HttpPolicyAiError('unavailable', 'policy AI source response is invalid')
  return value as unknown as PolicyAiSourceItemRecord
}

function run(value: unknown): PolicyAiRunRecord {
  if (!record(value)
    || !hasString(value.id, 80)
    || !hasString(value.caseId, 80)
    || !runStatuses.includes(value.status as PolicyAiRunStatus)
    || !hasString(value.providerId, 80)
    || !hasString(value.providerVersion, 80)
    || !hasString(value.modelId, 80)
    || !hasString(value.promptTemplateVersion, 80)
    || !hasString(value.outputSchemaVersion, 80)
    || !hasString(value.sourceBundleHash, 64) || !sha256Pattern.test(value.sourceBundleHash)
    || !hasString(value.sourceBundleId, 80)
    || !isNonnegativeInteger(value.candidateCount)
    || !isNonnegativeInteger(value.conflictCount)
    || !isNonnegativeInteger(value.controlRequiredCount)
    || !isNonnegativeInteger(value.inputCharacters)
    || !isNonnegativeInteger(value.estimatedCostMinor)
    || !isNullableNonnegativeInteger(value.actualCostMinor)
    || !isNullableString(value.safeErrorCode, 64)
    || !isNonnegativeInteger(value.version) || value.version < 1
    || !hasString(value.createdAt, 40)
    || !isNullableString(value.startedAt, 40)
    || !isNullableString(value.completedAt, 40)
    || !record(value.budget)
    || typeof value.budget.enabled !== 'boolean'
    || typeof value.budget.providerAvailable !== 'boolean'
    || typeof value.budget.providerAllowed !== 'boolean'
    || !isNonnegativeInteger(value.budget.estimatedCostMinor)
    || !isNonnegativeInteger(value.budget.currentMonthCostMinor)
    || !isNonnegativeInteger(value.budget.monthlyBudgetMinor)
    || !isNonnegativeInteger(value.budget.perRequestBudgetMinor)
    || typeof value.budget.allowed !== 'boolean'
    || !isNullableString(value.budget.reasonCode, 64)
    || !record(value.bundle)
    || !hasString(value.bundle.id, 80)
    || !hasString(value.bundle.sourceBundleHash, 64) || !sha256Pattern.test(value.bundle.sourceBundleHash)
    || value.bundle.sourceBundleHash !== value.sourceBundleHash
    || !hasString(value.bundle.bundleSchemaVersion, 80)
    || !hasStringArray(value.bundle.documentVersionIds, 200, 80)
    || value.bundle.documentVersionIds.length === 0
    || !isNonnegativeInteger(value.bundle.inputCharacters)
    || !isNonnegativeInteger(value.bundle.sourceCount)
    || !['complete', 'partial', 'control_required'].includes(String(value.bundle.completeness))
    || !Array.isArray(value.bundle.missingPages) || !value.bundle.missingPages.every((page) => isNonnegativeInteger(page) && page > 0)
    || !Array.isArray(value.bundle.ocrRequiredPages) || !value.bundle.ocrRequiredPages.every((page) => isNonnegativeInteger(page) && page > 0)
    || !hasStringArray(value.bundle.qualityWarnings, 100, 64)
    || !hasString(value.bundle.createdAt, 40)
    || !Array.isArray(value.bundle.items)
    || value.bundle.items.length > maximumBundleItems) throw new HttpPolicyAiError('unavailable', 'policy AI run response is invalid')
  const items = value.bundle.items.map(sourceItem)
  if (items.length !== value.bundle.sourceCount) throw new HttpPolicyAiError('unavailable', 'policy AI source count is invalid')
  return { ...value, bundle: { ...value.bundle, items } } as unknown as PolicyAiRunRecord
}

function candidate(value: unknown): PolicyAiCandidateRecord {
  if (!record(value)
    || !hasString(value.candidateId, 80)
    || !candidateCategories.includes(value.category as typeof candidateCategories[number])
    || !hasString(value.canonicalField, 120)
    || !isNormalizedValue(value.normalizedValue)
    || !hasString(value.originalValue, 1_000)
    || !hasStringArray(value.conditions, 20)
    || !hasStringArray(value.exceptions, 20)
    || !hasStringArray(value.sourceAnchorIds, 20, 64) || value.sourceAnchorIds.length === 0 || !value.sourceAnchorIds.every((id) => sha256Pattern.test(id))
    || typeof value.providerConfidence !== 'number' || !Number.isFinite(value.providerConfidence) || value.providerConfidence < 0 || value.providerConfidence > 1
    || !sourceQualities.includes(value.sourceQuality as typeof sourceQualities[number])
    || !validationStatuses.includes(value.validationStatus as typeof validationStatuses[number])
    || !conflictStatuses.includes(value.conflictStatus as typeof conflictStatuses[number])
    || !humanReviewStatuses.includes(value.humanReviewStatus as typeof humanReviewStatuses[number])
    || !hasString(value.providerId, 80)
    || !hasString(value.providerVersion, 80)
    || !hasString(value.modelId, 80)
    || !hasString(value.promptTemplateVersion, 80)
    || !hasString(value.outputSchemaVersion, 80)) throw new HttpPolicyAiError('unavailable', 'policy AI candidate response is invalid')
  return value as unknown as PolicyAiCandidateRecord
}

function candidates(value: unknown): Pick<PolicyAiWorkspaceRecord, 'candidates' | 'conflicts'> {
  if (!record(value) || !Array.isArray(value.items) || !Array.isArray(value.conflicts) || value.items.length > 100 || value.conflicts.length > 5_050) throw new HttpPolicyAiError('unavailable', 'policy AI candidates response is invalid')
  const items = value.items.map(candidate)
  if (new Set(items.map((item) => item.candidateId)).size !== items.length) throw new HttpPolicyAiError('unavailable', 'policy AI candidate identifiers are invalid')
  const conflicts = value.conflicts.map((item) => {
    if (!record(item)
      || !hasString(item.id, 80)
      || !hasString(item.leftCandidateId, 80)
      || !hasString(item.rightCandidateId, 80)
      || !['duplicate', 'conflict_detected', 'control_required'].includes(String(item.status))
      || !hasString(item.reason, 64)) throw new HttpPolicyAiError('unavailable', 'policy AI conflict response is invalid')
    return item as unknown as PolicyAiWorkspaceRecord['conflicts'][number]
  })
  return { candidates: items, conflicts }
}

function ocrPageWarnings(page: PolicyOcrPageRecord): string[] {
  return [
    ...(page.requiresHumanReview ? ['OCR_HUMAN_REVIEW_REQUIRED'] : []),
    ...(['ambiguous', 'control_required'].includes(page.readingOrderQuality) ? ['OCR_READING_ORDER_WARNING'] : []),
    ...(['conflict_detected', 'control_required'].includes(page.compositeStatus) ? ['PDF_OCR_CONFLICT'] : []),
  ]
}

function weakestQuality(pages: readonly PolicyOcrPageRecord[]): PolicyAiSourceOverviewRecord['quality'] {
  if (pages.length === 0) return 'control_required'
  if (pages.some((page) => ['insufficient', 'control_required'].includes(page.qualityStatus))) return 'control_required'
  if (pages.some((page) => page.qualityStatus === 'low')) return 'low'
  if (pages.some((page) => page.qualityStatus === 'medium')) return 'medium'
  return 'high'
}

interface Discovery {
  readonly selections: readonly PolicyAiSourceSelectionRecord[]
  readonly overviews: readonly PolicyAiSourceOverviewRecord[]
}

export function createHttpPolicyAiAdapter(options: { readonly baseUrl?: string; readonly fetchImpl?: typeof fetch } = {}): PolicyAiDataPort {
  const base = options.baseUrl ?? ''
  const fetchImpl = options.fetchImpl ?? fetch
  const pdf = createHttpPolicyPdfTextAdapter({ baseUrl: base, fetchImpl })
  const ocr = createHttpPolicyOcrAdapter({ baseUrl: base, fetchImpl })

  const request = async (path: string, init?: RequestInit): Promise<unknown> => {
    let response: Response
    try {
      response = await fetchImpl(`${base}${path}`, { credentials: 'include', ...init, headers: { accept: 'application/json', ...(init?.headers ?? {}) } })
    } catch {
      throw new HttpPolicyAiError('unavailable', 'policy AI API unreachable')
    }
    if (response.status === 401) throw new HttpPolicyAiError('unauthorized', 'HTTP 401')
    if (response.status === 403) throw new HttpPolicyAiError('forbidden', 'HTTP 403')
    if (response.status === 404) throw new HttpPolicyAiError('not_found', 'HTTP 404')
    if (response.status === 409) throw new HttpPolicyAiError('conflict', 'HTTP 409')
    if (!response.ok) throw new HttpPolicyAiError('unavailable', `HTTP ${response.status}`)
    try { return await response.json() } catch { throw new HttpPolicyAiError('unavailable', 'invalid JSON') }
  }

  const discover = async (caseId: string): Promise<Discovery> => {
    try {
      const sources = await pdf.listSources(caseId)
      const selections: PolicyAiSourceSelectionRecord[] = []
      const overviews: PolicyAiSourceOverviewRecord[] = []
      for (const source of sources) {
        const [extractions, runs] = await Promise.all([pdf.listExtractions(caseId, source), ocr.listRuns(caseId, source)])
        const extraction = extractions.find((item) => item.status === 'ready')
        if (extraction !== undefined) {
          const [segments, pages] = await Promise.all([pdf.listSegments(caseId, extraction.id), pdf.listPages(caseId, extraction.id)])
          const ocrRequiredPageNumbers = pages.filter((page) => ['image_only', 'empty', 'failed'].includes(page.status)).map((page) => page.pageNumber)
          const pdfWarnings = [
            ...(pages.some((page) => ['image_only', 'empty'].includes(page.status)) ? ['PDF_PAGE_REQUIRES_OCR'] : []),
            ...(pages.some((page) => page.status === 'failed') ? ['PDF_PAGE_EXTRACTION_FAILED'] : []),
          ]
          const selected = segments.slice(0, Math.min(maximumItemsPerExtraction, maximumBundleItems - selections.length))
          for (const segment of selected) selections.push({ sourceType: 'pdf_text', documentId: source.documentId, documentVersionId: source.documentVersionId, documentVersionNumber: source.versionNumber, documentDisplayName: source.displayName, extractionId: extraction.id, extractionVersion: extraction.extractionVersion, segmentId: segment.id, pageNumber: segment.pageNumber, label: `PDF · Sayfa ${segment.pageNumber} · ${segment.type}`, quality: 'high', warnings: [] })
          overviews.push({ key: `pdf:${extraction.id}`, sourceType: 'pdf_text', documentVersionId: source.documentVersionId, documentVersionNumber: source.versionNumber, documentDisplayName: source.displayName, extractionId: extraction.id, extractionVersion: extraction.extractionVersion, status: extraction.status, pageCount: extraction.pageCount, selectedItemCount: selected.length, quality: extraction.failedPageCount > 0 ? 'control_required' : ocrRequiredPageNumbers.length > 0 ? 'medium' : 'high', ocrRequiredPageNumbers, warnings: pdfWarnings })
        } else if (extractions[0] !== undefined) {
          const latest = extractions[0]
          overviews.push({ key: `pdf:${latest.id}`, sourceType: 'pdf_text', documentVersionId: source.documentVersionId, documentVersionNumber: source.versionNumber, documentDisplayName: source.displayName, extractionId: latest.id, extractionVersion: latest.extractionVersion, status: latest.status, pageCount: latest.pageCount, selectedItemCount: 0, quality: 'control_required', ocrRequiredPageNumbers: [], warnings: ['PDF_EXTRACTION_NOT_READY'] })
        }

        const ocrRun = runs.find((item) => ['ready', 'partial', 'low_confidence', 'control_required'].includes(item.status))
        if (ocrRun !== undefined) {
          const [elements, pages] = await Promise.all([ocr.listElements(caseId, ocrRun.id), ocr.listPages(caseId, ocrRun.id)])
          const selected = elements.filter((item) => item.type === 'line').slice(0, Math.min(maximumItemsPerExtraction, maximumBundleItems - selections.length))
          for (const element of selected) {
            const page = pages.find((item) => item.pageNumber === element.pageNumber)
            const quality = page?.qualityStatus === 'high' ? 'high' : page?.qualityStatus === 'medium' ? 'medium' : page?.qualityStatus === 'low' ? 'low' : 'control_required'
            selections.push({ sourceType: 'ocr', documentId: source.documentId, documentVersionId: source.documentVersionId, documentVersionNumber: source.versionNumber, documentDisplayName: source.displayName, extractionVersion: ocrRun.ocrVersion, ocrRunId: ocrRun.id, elementId: element.id, pageNumber: element.pageNumber, label: `OCR · Sayfa ${element.pageNumber} · güven %${element.confidence.toFixed(1)}`, quality, warnings: page === undefined ? ['OCR_PAGE_NOT_RESOLVED'] : ocrPageWarnings(page) })
          }
          const warnings = [...new Set(pages.flatMap(ocrPageWarnings))].sort()
          overviews.push({ key: `ocr:${ocrRun.id}`, sourceType: 'ocr', documentVersionId: source.documentVersionId, documentVersionNumber: source.versionNumber, documentDisplayName: source.displayName, extractionId: ocrRun.id, extractionVersion: ocrRun.ocrVersion, status: ocrRun.status, pageCount: pages.length, selectedItemCount: selected.length, quality: weakestQuality(pages), ocrRequiredPageNumbers: pages.filter((page) => page.requiresHumanReview).map((page) => page.pageNumber), warnings })
        } else if (runs[0] !== undefined) {
          const latest = runs[0]
          overviews.push({ key: `ocr:${latest.id}`, sourceType: 'ocr', documentVersionId: source.documentVersionId, documentVersionNumber: source.versionNumber, documentDisplayName: source.displayName, extractionId: latest.id, extractionVersion: latest.ocrVersion, status: latest.status, pageCount: latest.eligiblePageCount, selectedItemCount: 0, quality: 'control_required', ocrRequiredPageNumbers: [], warnings: ['OCR_RUN_NOT_READY'] })
        }
        if (selections.length >= maximumBundleItems) break
      }
      return { selections, overviews }
    } catch (error) {
      if (error instanceof HttpPolicyPdfTextError || error instanceof HttpPolicyOcrError) throw new HttpPolicyAiError(error.kind, error.message)
      throw error
    }
  }

  return {
    async load(caseId) {
      const [discovery, list] = await Promise.all([discover(caseId), request(`/api/v1/cases/${encodeURIComponent(caseId)}/policy-ai-extractions`)])
      if (!record(list) || !Array.isArray(list.items)) throw new HttpPolicyAiError('unavailable', 'policy AI list is invalid')
      const summary = list.items[0]
      if (!record(summary)) return { run: null, candidates: [], conflicts: [], availableSources: discovery.selections, sourceOverviews: discovery.overviews }
      if (!hasString(summary.id, 80)) throw new HttpPolicyAiError('unavailable', 'policy AI list item is invalid')
      const detail = await request(`/api/v1/cases/${encodeURIComponent(caseId)}/policy-ai-extractions/${encodeURIComponent(summary.id)}`)
      if (!record(detail)) throw new HttpPolicyAiError('unavailable', 'policy AI detail is invalid')
      const current = run(detail.run)
      if (current.caseId !== caseId) throw new HttpPolicyAiError('unavailable', 'policy AI case identity is invalid')
      let candidateData: Pick<PolicyAiWorkspaceRecord, 'candidates' | 'conflicts'> = { candidates: [], conflicts: [] }
      if (current.candidateCount > 0) {
        candidateData = candidates(await request(`/api/v1/cases/${encodeURIComponent(caseId)}/policy-ai-extractions/${encodeURIComponent(current.id)}/candidates?page=1&pageSize=100`))
        const anchors = new Set(current.bundle.items.map((item) => item.sourceAnchorId))
        const candidateIds = new Set(candidateData.candidates.map((item) => item.candidateId))
        if (candidateData.candidates.length !== current.candidateCount
          || candidateData.candidates.some((item) => item.sourceAnchorIds.some((anchor) => !anchors.has(anchor)))
          || candidateData.conflicts.some((item) => !candidateIds.has(item.leftCandidateId) || !candidateIds.has(item.rightCandidateId))) throw new HttpPolicyAiError('unavailable', 'policy AI candidate evidence response is invalid')
      }
      return { run: current, ...candidateData, availableSources: discovery.selections, sourceOverviews: discovery.overviews }
    },
    async plan(caseId, sources, idempotencyKey) {
      const selected = sources.map((source) => {
        if (source.sourceType === 'pdf_text' && source.extractionId !== undefined && source.segmentId !== undefined) return { sourceType: 'pdf_text' as const, extractionId: source.extractionId, segmentId: source.segmentId }
        if (source.sourceType === 'ocr' && source.ocrRunId !== undefined && source.elementId !== undefined) return { sourceType: 'ocr' as const, ocrRunId: source.ocrRunId, elementId: source.elementId }
        throw new HttpPolicyAiError('unavailable', 'policy AI source selection is invalid')
      })
      const value = await request(`/api/v1/cases/${encodeURIComponent(caseId)}/policy-ai-extractions/plan`, { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ providerId: 'deterministic-success', sources: selected }) })
      if (!record(value)) throw new HttpPolicyAiError('unavailable', 'policy AI plan is invalid')
      const planned = run(value.run)
      if (planned.caseId !== caseId) throw new HttpPolicyAiError('unavailable', 'policy AI plan case identity is invalid')
      return planned
    },
    async start(caseId, current, idempotencyKey) {
      const value = await request(`/api/v1/cases/${encodeURIComponent(caseId)}/policy-ai-extractions/${encodeURIComponent(current.id)}/start`, { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ expectedVersion: current.version, expectedSourceBundleHash: current.sourceBundleHash }) })
      if (!record(value)) throw new HttpPolicyAiError('unavailable', 'policy AI start is invalid')
      const started = run(value.run)
      if (started.caseId !== caseId || started.id !== current.id || started.sourceBundleHash !== current.sourceBundleHash) throw new HttpPolicyAiError('unavailable', 'policy AI start identity is invalid')
      return started
    },
  }
}
