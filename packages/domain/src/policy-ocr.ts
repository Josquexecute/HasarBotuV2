import {
  MAX_PDF_PAGE_TEXT_LENGTH,
  normalizeExtractedPageText,
  sanitizeExtractedPageText,
  sha256Text,
} from './pdf-text-extraction.js'

/** Paket 25: pinned, offline-only OCR execution identity. */
export const POLICY_OCR_ENGINE_NAME = 'tesseract.js' as const
export const POLICY_OCR_ENGINE_VERSION = '7.0.0' as const
export const POLICY_OCR_LANGUAGE_DATA_VERSION = 'tessdata-4.0.0-full/1.0.0' as const
export const POLICY_OCR_LANGUAGE_DATA_HASHES = {
  eng: 'ed350f3752f81ee8f38769edc14d92d997dababe23b565c59879372cc46a2468',
  tur: '1a151a9aee3fe92ab46a3d8ed859273da970e1ac60b469a20cd0144c15ae84c9',
} as const
export const POLICY_OCR_LANGUAGE_DATA_SIZES = { eng: 10_923_060, tur: 8_063_205 } as const
export const POLICY_OCR_SUPPORTED_SCRIPTS = ['Latin'] as const
export const POLICY_OCR_PREPROCESSING_VERSION = 'policy-ocr-preprocessing/1.0.0' as const
export const POLICY_OCR_QUALITY_VERSION = 'policy-ocr-quality/1.0.0' as const
export const POLICY_OCR_NORMALIZATION_VERSION = 'policy-ocr-normalization/1.0.0' as const
export const POLICY_OCR_LOCATOR_VERSION = 'policy-ocr-locator/1.0.0' as const
export const POLICY_OCR_OFFSET_UNIT = 'unicode_code_point' as const
export const POLICY_OCR_RENDER_PROFILES = ['standard', 'high_quality'] as const
export type PolicyOcrRenderProfile = (typeof POLICY_OCR_RENDER_PROFILES)[number]
export const POLICY_OCR_RENDER_PROFILE_VERSIONS = {
  standard: 'policy-ocr-render-standard/1.0.0',
  high_quality: 'policy-ocr-render-high-quality/1.0.0',
} as const
export const POLICY_OCR_RENDER_DPI = { standard: 300, high_quality: 400 } as const

export const POLICY_OCR_RUN_STATUSES = [
  'queued',
  'rendering',
  'preprocessing',
  'recognizing',
  'normalizing',
  'validating',
  'ready',
  'partial',
  'low_confidence',
  'control_required',
  'failed',
  'cancelled',
  'stale',
  'superseded',
] as const
export type PolicyOcrRunStatus = (typeof POLICY_OCR_RUN_STATUSES)[number]

export const POLICY_OCR_PAGE_STATUSES = [
  'accepted_candidate',
  'partial',
  'low_confidence',
  'unreadable',
  'unsupported',
  'failed',
  'control_required',
] as const
export type PolicyOcrPageStatus = (typeof POLICY_OCR_PAGE_STATUSES)[number]

export const POLICY_OCR_QUALITY_STATUSES = ['high', 'medium', 'low', 'insufficient', 'control_required'] as const
export type PolicyOcrQualityStatus = (typeof POLICY_OCR_QUALITY_STATUSES)[number]
export const POLICY_OCR_READING_ORDER_QUALITIES = ['reliable', 'probable', 'ambiguous', 'control_required'] as const
export type PolicyOcrReadingOrderQuality = (typeof POLICY_OCR_READING_ORDER_QUALITIES)[number]
export const POLICY_OCR_COMPOSITE_STATUSES = ['pdf_text_only', 'ocr_only', 'combined_non_overlapping', 'conflict_detected', 'control_required'] as const
export type PolicyOcrCompositeStatus = (typeof POLICY_OCR_COMPOSITE_STATUSES)[number]

export const POLICY_OCR_LANGUAGE_MODES = ['tur', 'eng', 'tur+eng'] as const
export type PolicyOcrLanguageMode = (typeof POLICY_OCR_LANGUAGE_MODES)[number]

export function policyOcrLanguageDataHash(languageMode: PolicyOcrLanguageMode): string {
  if (languageMode === 'eng') return POLICY_OCR_LANGUAGE_DATA_HASHES.eng
  if (languageMode === 'tur') return POLICY_OCR_LANGUAGE_DATA_HASHES.tur
  return sha256Text(`eng:${POLICY_OCR_LANGUAGE_DATA_HASHES.eng}\ntur:${POLICY_OCR_LANGUAGE_DATA_HASHES.tur}`)
}

export const POLICY_OCR_ELEMENT_TYPES = ['block', 'line', 'word'] as const
export type PolicyOcrElementType = (typeof POLICY_OCR_ELEMENT_TYPES)[number]

export const MAX_POLICY_OCR_PAGE_COUNT = 1_000
export const MAX_POLICY_OCR_SOURCE_BYTES = 64 * 1024 * 1024
export const MAX_POLICY_OCR_IMAGE_PIXELS = 30_000_000
export const MAX_POLICY_OCR_ELEMENTS_PER_PAGE = 20_000
export const MAX_POLICY_OCR_TOTAL_CHARACTERS = 5_000_000
export const MAX_POLICY_OCR_SOURCE_EXCERPT_LENGTH = 1_000
export const MAX_POLICY_OCR_RAW_TEXT_LENGTH = MAX_PDF_PAGE_TEXT_LENGTH

export interface PolicyOcrBoundingBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface PolicyOcrWordInput {
  readonly text: string
  readonly confidence: number
  readonly bbox: PolicyOcrBoundingBox
}

export interface PolicyOcrLineInput {
  readonly text: string
  readonly confidence: number
  readonly bbox: PolicyOcrBoundingBox
  readonly words: readonly PolicyOcrWordInput[]
}

export interface PolicyOcrBlockInput {
  readonly text: string
  readonly confidence: number
  readonly bbox: PolicyOcrBoundingBox
  readonly lines: readonly PolicyOcrLineInput[]
}

export interface PolicyOcrElementDraft {
  readonly elementIndex: number
  readonly type: PolicyOcrElementType
  readonly parentIndex: number | null
  readonly readingOrder: number
  readonly startOffset: number
  readonly endOffset: number
  readonly text: string
  readonly textHash: string
  readonly confidence: number
  readonly bbox: PolicyOcrBoundingBox
}

export interface PolicyOcrReadingOrderResult {
  readonly rawText: string
  readonly normalizedText: string
  readonly elements: readonly PolicyOcrElementDraft[]
  readonly quality: PolicyOcrReadingOrderQuality
}

export interface PolicyOcrQualityResult {
  readonly status: PolicyOcrQualityStatus
  readonly reasonCode: 'quality_good' | 'low_confidence' | 'insufficient_text' | 'empty_result' | 'suspicious_characters'
  readonly requiresHumanReview: boolean
}

function pointLength(value: string): number {
  return Array.from(value).length
}

function cleanOcrText(value: string): string {
  return normalizeExtractedPageText(sanitizeExtractedPageText(value))
}

function rawOcrText(value: string): string {
  return sanitizeExtractedPageText(value).normalize('NFC').replace(/\r\n?/gu, '\n').trim()
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100))
}

function compareGeometry(
  left: { readonly bbox: PolicyOcrBoundingBox; readonly text: string },
  right: { readonly bbox: PolicyOcrBoundingBox; readonly text: string },
): number {
  const verticalTolerance = Math.max(3, Math.min(left.bbox.height, right.bbox.height) * 0.45)
  if (Math.abs(left.bbox.y - right.bbox.y) > verticalTolerance) return left.bbox.y - right.bbox.y
  if (left.bbox.x !== right.bbox.x) return left.bbox.x - right.bbox.x
  if (left.bbox.width !== right.bbox.width) return left.bbox.width - right.bbox.width
  if (left.bbox.height !== right.bbox.height) return left.bbox.height - right.bbox.height
  return left.text.localeCompare(right.text, 'tr-TR')
}

function validBox(box: PolicyOcrBoundingBox): PolicyOcrBoundingBox {
  const values = [box.x, box.y, box.width, box.height]
  if (values.some((value) => !Number.isFinite(value) || value < 0)) throw new Error('invalid_ocr_bounding_box')
  return {
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height),
  }
}

/**
 * Produces deterministic reading order and Unicode code-point offsets.
 * OCR text is evidence; this function only normalizes whitespace and never
 * infers policy meaning or repairs words.
 */
export function buildPolicyOcrReadingOrder(blocks: readonly PolicyOcrBlockInput[]): PolicyOcrReadingOrderResult {
  const orderedBlocks = [...blocks]
    .map((block) => ({ ...block, text: cleanOcrText(block.text), bbox: validBox(block.bbox) }))
    .filter((block) => block.text.length > 0)
    .sort(compareGeometry)

  const lines = orderedBlocks.flatMap((block, blockOrder) =>
    [...block.lines]
      .map((line) => ({ ...line, text: cleanOcrText(line.text), bbox: validBox(line.bbox), blockOrder }))
      .filter((line) => line.text.length > 0)
      .sort(compareGeometry),
  )
  const normalizedText = lines.map((line) => line.text).join('\n')
  const rawText = [...blocks]
    .sort(compareGeometry)
    .flatMap((block) => [...block.lines].sort(compareGeometry).map((line) => rawOcrText(line.text)))
    .filter((line) => line.length > 0)
    .join('\n')
  if (pointLength(normalizedText) > MAX_POLICY_OCR_RAW_TEXT_LENGTH) throw new Error('ocr_page_text_limit_exceeded')

  const elements: PolicyOcrElementDraft[] = []
  let cursor = 0
  let readingOrder = 0
  for (const [blockOrder, block] of orderedBlocks.entries()) {
    const blockLines = lines.filter((line) => line.blockOrder === blockOrder)
    if (blockLines.length === 0) continue
    const blockStart = cursor
    const blockElementIndex = elements.length
    elements.push({
      elementIndex: blockElementIndex,
      type: 'block',
      parentIndex: null,
      readingOrder: readingOrder++,
      startOffset: blockStart,
      endOffset: blockStart,
      text: '',
      textHash: sha256Text(''),
      confidence: clampConfidence(block.confidence),
      bbox: block.bbox,
    })

    for (const line of blockLines) {
      const lineStart = cursor
      const lineEnd = lineStart + pointLength(line.text)
      const lineElementIndex = elements.length
      elements.push({
        elementIndex: lineElementIndex,
        type: 'line',
        parentIndex: blockElementIndex,
        readingOrder: readingOrder++,
        startOffset: lineStart,
        endOffset: lineEnd,
        text: line.text,
        textHash: sha256Text(line.text),
        confidence: clampConfidence(line.confidence),
        bbox: line.bbox,
      })

      const orderedWords = [...line.words]
        .map((word) => ({ ...word, text: cleanOcrText(word.text), bbox: validBox(word.bbox) }))
        .filter((word) => word.text.length > 0)
        .sort(compareGeometry)
      let searchCursor = 0
      for (const word of orderedWords) {
        const lineCodePoints = Array.from(line.text)
        const wordCodePoints = Array.from(word.text)
        const remainder = lineCodePoints.slice(searchCursor).join('')
        const relativeUtf16 = remainder.indexOf(word.text)
        const relative = relativeUtf16 < 0
          ? searchCursor
          : searchCursor + pointLength(remainder.slice(0, relativeUtf16))
        const wordStart = Math.min(lineEnd, lineStart + relative)
        const wordEnd = Math.min(lineEnd, wordStart + wordCodePoints.length)
        searchCursor = Math.max(searchCursor, wordEnd - lineStart)
        elements.push({
          elementIndex: elements.length,
          type: 'word',
          parentIndex: lineElementIndex,
          readingOrder: readingOrder++,
          startOffset: wordStart,
          endOffset: wordEnd,
          text: word.text,
          textHash: sha256Text(word.text),
          confidence: clampConfidence(word.confidence),
          bbox: word.bbox,
        })
      }
      cursor = lineEnd + 1
    }
    const blockEnd = Math.max(blockStart, cursor - 1)
    const blockText = Array.from(normalizedText).slice(blockStart, blockEnd).join('')
    elements[blockElementIndex] = {
      ...elements[blockElementIndex]!,
      endOffset: blockEnd,
      text: blockText,
      textHash: sha256Text(blockText),
    }
  }

  if (elements.length > MAX_POLICY_OCR_ELEMENTS_PER_PAGE) throw new Error('ocr_element_limit_exceeded')
  const horizontalGroups = [...orderedBlocks.map((block) => block.bbox), ...lines.map((line) => line.bbox)]
    .map((bbox) => ({ left: bbox.x, right: bbox.x + bbox.width, top: bbox.y, bottom: bbox.y + bbox.height }))
    .sort((left, right) => left.left - right.left)
  const overlappingColumns = horizontalGroups.some((left, index) => horizontalGroups.slice(index + 1).some((right) =>
    left.right < right.left && Math.max(left.top, right.top) < Math.min(left.bottom, right.bottom),
  ))
  const quality: PolicyOcrReadingOrderQuality = overlappingColumns ? 'ambiguous' : orderedBlocks.length > 4 ? 'probable' : 'reliable'
  return { rawText, normalizedText, elements, quality }
}

export function evaluatePolicyOcrQuality(input: {
  readonly normalizedText: string
  readonly meanConfidence: number
  readonly wordCount: number
  readonly lowConfidenceWordCount?: number
  readonly unreadableRegionCount?: number
  readonly readingOrderQuality?: PolicyOcrReadingOrderQuality
}): PolicyOcrQualityResult {
  const text = input.normalizedText.trim()
  if (text.length === 0 || input.wordCount === 0) {
    return { status: 'insufficient', reasonCode: 'empty_result', requiresHumanReview: true }
  }
  const characters = Array.from(text)
  const replacementCount = characters.filter((character) => character === '\uFFFD' || character === '?').length
  if (characters.length > 0 && replacementCount / characters.length > 0.05) {
    return { status: 'control_required', reasonCode: 'suspicious_characters', requiresHumanReview: true }
  }
  if (input.wordCount < 3) {
    return { status: 'insufficient', reasonCode: 'insufficient_text', requiresHumanReview: true }
  }
  const lowRatio = (input.lowConfidenceWordCount ?? 0) / Math.max(1, input.wordCount)
  if (input.meanConfidence < 70 || lowRatio > 0.25 || (input.unreadableRegionCount ?? 0) > 0) {
    return { status: 'low', reasonCode: 'low_confidence', requiresHumanReview: true }
  }
  if (input.readingOrderQuality === 'ambiguous' || input.readingOrderQuality === 'control_required') {
    return { status: 'control_required', reasonCode: 'low_confidence', requiresHumanReview: true }
  }
  if (input.meanConfidence < 85 || lowRatio > 0.1 || input.readingOrderQuality === 'probable') {
    return { status: 'medium', reasonCode: 'quality_good', requiresHumanReview: true }
  }
  return { status: 'high', reasonCode: 'quality_good', requiresHumanReview: false }
}

export function derivePolicyOcrRunStatus(input: {
  readonly eligiblePageCount: number
  readonly readyPageCount: number
  readonly lowQualityPageCount: number
  readonly emptyPageCount: number
  readonly failedPageCount: number
}): 'ready' | 'partial' | 'low_confidence' | 'control_required' {
  if (input.eligiblePageCount === 0) return 'control_required'
  if (input.readyPageCount === input.eligiblePageCount) return 'ready'
  if (input.readyPageCount > 0 && input.failedPageCount + input.emptyPageCount > 0) return 'partial'
  if (input.lowQualityPageCount === input.eligiblePageCount) return 'low_confidence'
  return 'control_required'
}

/** Keeps Package 24 and OCR layers separate while deriving a fail-closed composite view. */
export function derivePolicyOcrCompositeStatus(input: {
  readonly sourcePageStatus: 'image_only' | 'text'
  readonly pdfNormalizedText: string
  readonly ocrNormalizedText: string
}): PolicyOcrCompositeStatus {
  if (input.sourcePageStatus === 'image_only') return input.ocrNormalizedText.trim().length > 0 ? 'ocr_only' : 'control_required'
  const pdf = cleanOcrText(input.pdfNormalizedText).toLocaleLowerCase('tr-TR')
  const ocr = cleanOcrText(input.ocrNormalizedText).toLocaleLowerCase('tr-TR')
  if (pdf.length === 0 || ocr.length === 0) return 'control_required'
  if (pdf === ocr || pdf.includes(ocr) || ocr.includes(pdf)) return 'pdf_text_only'
  const tokens = (value: string) => new Set(value.split(/\s+/u).filter((item) => item.length > 1))
  const pdfTokens = tokens(pdf)
  const ocrTokens = tokens(ocr)
  const overlap = [...pdfTokens].filter((item) => ocrTokens.has(item)).length / Math.max(1, Math.min(pdfTokens.size, ocrTokens.size))
  return overlap < 0.2 ? 'combined_non_overlapping' : 'conflict_detected'
}

export function buildPolicyOcrOutputHash(pages: readonly {
  readonly pageNumber: number
  readonly status: PolicyOcrPageStatus
  readonly normalizedTextHash: string
  readonly qualityStatus: PolicyOcrQualityStatus
  readonly blockCount: number
  readonly lineCount: number
  readonly wordCount: number
}[]): string {
  return sha256Text([...pages]
    .sort((left, right) => left.pageNumber - right.pageNumber)
    .map((page) => JSON.stringify(page))
    .join('\n'))
}
