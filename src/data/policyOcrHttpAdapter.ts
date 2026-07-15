import type {
  PolicyOcrDataPort,
  PolicyOcrElementRecord,
  PolicyOcrLanguageMode,
  PolicyOcrPageRecord,
  PolicyOcrRenderProfile,
  PolicyOcrRunRecord,
  PolicyOcrSourceReferenceRecord,
} from './ports'

export type HttpPolicyOcrErrorKind = 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'unavailable'

export class HttpPolicyOcrError extends Error {
  constructor(readonly kind: HttpPolicyOcrErrorKind, message: string) {
    super(message)
    this.name = 'HttpPolicyOcrError'
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

const runStatuses = ['queued', 'rendering', 'preprocessing', 'recognizing', 'normalizing', 'validating', 'ready', 'partial', 'low_confidence', 'control_required', 'failed', 'cancelled', 'stale', 'superseded']
const pageStatuses = ['accepted_candidate', 'partial', 'low_confidence', 'unreadable', 'unsupported', 'failed', 'control_required']

function run(value: unknown): PolicyOcrRunRecord {
  if (!record(value)
    || typeof value.id !== 'string'
    || typeof value.caseId !== 'string'
    || typeof value.documentId !== 'string'
    || typeof value.documentVersionId !== 'string'
    || typeof value.textExtractionId !== 'string'
    || typeof value.ocrVersion !== 'number'
    || !runStatuses.includes(String(value.status))
    || value.engineName !== 'tesseract.js'
    || value.engineVersion !== '7.0.0'
    || value.languageDataVersion !== 'tessdata-4.0.0-full/1.0.0'
    || typeof value.languageDataHash !== 'string'
    || !['tur', 'eng', 'tur+eng'].includes(String(value.languageMode))
    || !['standard', 'high_quality'].includes(String(value.renderProfile))
    || !['policy-ocr-render-standard/1.0.0', 'policy-ocr-render-high-quality/1.0.0'].includes(String(value.renderProfileVersion))
    || value.preprocessingVersion !== 'policy-ocr-preprocessing/1.0.0'
    || value.qualityVersion !== 'policy-ocr-quality/1.0.0'
    || value.normalizationVersion !== 'policy-ocr-normalization/1.0.0'
    || value.locatorVersion !== 'policy-ocr-locator/1.0.0'
    || value.offsetUnit !== 'unicode_code_point'
    || typeof value.eligiblePageCount !== 'number'
    || typeof value.version !== 'number') throw new HttpPolicyOcrError('unavailable', 'OCR response is invalid')
  return value as unknown as PolicyOcrRunRecord
}

function page(value: unknown): PolicyOcrPageRecord {
  if (!record(value)
    || typeof value.id !== 'string'
    || typeof value.ocrRunId !== 'string'
    || typeof value.pageNumber !== 'number'
    || !pageStatuses.includes(String(value.status))
    || typeof value.rawOcrText !== 'string'
    || typeof value.normalizedText !== 'string'
    || !['high', 'medium', 'low', 'insufficient', 'control_required'].includes(String(value.qualityStatus))
    || !['reliable', 'probable', 'ambiguous', 'control_required'].includes(String(value.readingOrderQuality))
    || !['pdf_text_only', 'ocr_only', 'combined_non_overlapping', 'conflict_detected', 'control_required'].includes(String(value.compositeStatus))
    || typeof value.meanConfidence !== 'number'
    || typeof value.requiresHumanReview !== 'boolean') throw new HttpPolicyOcrError('unavailable', 'OCR page response is invalid')
  return value as unknown as PolicyOcrPageRecord
}

function element(value: unknown): PolicyOcrElementRecord {
  if (!record(value)
    || typeof value.id !== 'string'
    || typeof value.pageId !== 'string'
    || !['block', 'line', 'word'].includes(String(value.type))
    || typeof value.startOffset !== 'number'
    || typeof value.endOffset !== 'number'
    || typeof value.text !== 'string'
    || typeof value.confidence !== 'number'
    || value.sourceLayer !== 'ocr'
    || !record(value.bbox)) throw new HttpPolicyOcrError('unavailable', 'OCR element response is invalid')
  return value as unknown as PolicyOcrElementRecord
}

export function createHttpPolicyOcrAdapter(options: { baseUrl?: string; fetchImpl?: typeof fetch } = {}): PolicyOcrDataPort {
  const base = options.baseUrl ?? ''
  const fetchImpl = options.fetchImpl ?? fetch
  const request = async (path: string, init?: RequestInit) => {
    let response: Response
    try {
      response = await fetchImpl(`${base}${path}`, { credentials: 'include', ...init, headers: { accept: 'application/json', ...(init?.headers ?? {}) } })
    } catch {
      throw new HttpPolicyOcrError('unavailable', 'OCR API unreachable')
    }
    if (response.status === 401) throw new HttpPolicyOcrError('unauthorized', 'HTTP 401')
    if (response.status === 403) throw new HttpPolicyOcrError('forbidden', 'HTTP 403')
    if (response.status === 404) throw new HttpPolicyOcrError('not_found', 'HTTP 404')
    if (response.status === 409) throw new HttpPolicyOcrError('conflict', 'HTTP 409')
    if (!response.ok) throw new HttpPolicyOcrError('unavailable', `HTTP ${response.status}`)
    try { return await response.json() } catch { throw new HttpPolicyOcrError('unavailable', 'invalid JSON') }
  }
  const path = (caseId: string, runId: string) => `/api/v1/cases/${encodeURIComponent(caseId)}/ocr-runs/${encodeURIComponent(runId)}`
  return {
    async listRuns(caseId, source) {
      const body = await request(`/api/v1/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(source.documentId)}/versions/${encodeURIComponent(source.documentVersionId)}/ocr-runs`)
      if (!record(body) || !Array.isArray(body.items)) throw new HttpPolicyOcrError('unavailable', 'OCR list is invalid')
      return body.items.map(run)
    },
    async createRun(caseId, source, textExtractionId, languageMode: PolicyOcrLanguageMode, renderProfile: PolicyOcrRenderProfile, idempotencyKey) {
      const body = await request(`/api/v1/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(source.documentId)}/versions/${encodeURIComponent(source.documentVersionId)}/ocr-runs`, { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ textExtractionId, languageMode, renderProfile }) })
      if (!record(body)) throw new HttpPolicyOcrError('unavailable', 'OCR envelope is invalid')
      return run(body.ocrRun)
    },
    async getRun(caseId, ocrRunId) {
      const body = await request(path(caseId, ocrRunId))
      if (!record(body)) throw new HttpPolicyOcrError('unavailable', 'OCR envelope is invalid')
      return run(body.ocrRun)
    },
    async listPages(caseId, ocrRunId) {
      const body = await request(`${path(caseId, ocrRunId)}/pages?page=1&pageSize=100`)
      if (!record(body) || !Array.isArray(body.items)) throw new HttpPolicyOcrError('unavailable', 'OCR pages are invalid')
      return body.items.map(page)
    },
    async listElements(caseId, ocrRunId, pageNumber = 1) {
      const body = await request(`${path(caseId, ocrRunId)}/elements?page=${pageNumber}&pageSize=100`)
      if (!record(body) || !Array.isArray(body.items)) throw new HttpPolicyOcrError('unavailable', 'OCR elements are invalid')
      return body.items.map(element)
    },
    async retryRun(caseId, value, idempotencyKey) {
      const body = await request(`${path(caseId, value.id)}/retry`, { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ expectedVersion: value.version }) })
      if (!record(body)) throw new HttpPolicyOcrError('unavailable', 'OCR retry envelope is invalid')
      return run(body.ocrRun)
    },
    async createSourceReference(caseId, value, item, elements, idempotencyKey) {
      const line = item.type === 'line' ? item : item.type === 'word' ? elements.find((candidate) => candidate.id === item.parentId && candidate.type === 'line') : undefined
      const block = item.type === 'block' ? item : line === undefined ? undefined : elements.find((candidate) => candidate.id === line.parentId && candidate.type === 'block')
      const body = await request(`${path(caseId, value.id)}/source-reference`, { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ sourceKey: `ocr-${item.pageNumber}-${item.elementIndex}`, pageId: item.pageId, blockId: block?.id ?? null, lineId: line?.id ?? null, wordId: item.type === 'word' ? item.id : null, startOffset: item.startOffset, endOffset: Math.min(item.endOffset, item.startOffset + 1000), sectionHeading: item.type === 'block' ? item.text.slice(0, 300) : 'Yerel OCR Poliçe Metni', clauseIdentifier: `Sayfa ${item.pageNumber} / ${item.type} ${item.elementIndex + 1}`, sourceType: 'policy', confidence: Math.min(1, item.confidence / 100) }) })
      if (!record(body) || !record(body.sourceReference) || typeof body.sourceReference.locator !== 'string' || !record(body.sourceReference.ocrLocator)) throw new HttpPolicyOcrError('unavailable', 'OCR source reference is invalid')
      return body.sourceReference as unknown as PolicyOcrSourceReferenceRecord
    },
  }
}
