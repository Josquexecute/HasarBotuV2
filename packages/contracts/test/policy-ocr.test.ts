import { describe, expect, it } from 'vitest'
import {
  API_ERROR_CODES,
  jobPayloadSchema,
  jobResultRequestSchema,
  policyOcrChunkRequestSchema,
  policyOcrRunCreateRequestSchema,
  policyOcrRunResponseSchema,
  policyOcrSourceReferenceRequestSchema,
} from '../src/index.js'

const ID = '01900000-0000-7000-8000-000000000001'
const HASH = 'a'.repeat(64)
const DATE = '2026-07-15T09:00:00.000Z'
const versions = {
  engineVersion: '7.0.0', languageDataVersion: 'tessdata-4.0.0-full/1.0.0',
  renderProfileVersion: 'policy-ocr-render-standard/1.0.0', preprocessingVersion: 'policy-ocr-preprocessing/1.0.0',
  qualityVersion: 'policy-ocr-quality/1.0.0',
  normalizationVersion: 'policy-ocr-normalization/1.0.0', locatorVersion: 'policy-ocr-locator/1.0.0',
} as const
const run = { id: ID, caseId: ID, documentId: ID, documentVersionId: ID, textExtractionId: ID, ocrVersion: 1, status: 'queued', engineName: 'tesseract.js', ...versions, languageDataHash: HASH, languageMode: 'tur+eng', renderProfile: 'standard', offsetUnit: 'unicode_code_point', sourceHash: HASH, sourceSize: 100, eligiblePageCount: 1, processedPageCount: 0, readyPageCount: 0, lowQualityPageCount: 0, emptyPageCount: 0, failedPageCount: 0, blockCount: 0, lineCount: 0, wordCount: 0, normalizedCharacterCount: 0, meanConfidence: null, outputHash: null, failureCode: null, activeJobId: ID, version: 1, createdAt: DATE, startedAt: null, completedAt: null }

describe('Paket 25 OCR contracts', () => {
  it('create komutunu strict doğrular, varsayılan profili uygular ve tekrar sayfayı reddeder', () => {
    expect(policyOcrRunCreateRequestSchema.parse({ textExtractionId: ID })).toEqual({ textExtractionId: ID, languageMode: 'tur+eng', renderProfile: 'standard' })
    expect(policyOcrRunCreateRequestSchema.safeParse({ textExtractionId: ID, languageMode: 'tur', pageNumbers: [2, 2] }).success).toBe(false)
    expect(policyOcrRunCreateRequestSchema.safeParse({ textExtractionId: ID, cloud: true }).success).toBe(false)
  })

  it('run response bütün motor/render/locator sürüm kimliğini zorunlu tutar', () => {
    expect(policyOcrRunResponseSchema.parse({ ocrRun: run }).ocrRun.engineVersion).toBe('7.0.0')
    expect(policyOcrRunResponseSchema.safeParse({ ocrRun: { ...run, locatorVersion: 'latest' } }).success).toBe(false)
  })

  it('OCR source locator hiyerarşisini ve offset sınırını doğrular', () => {
    const base = { sourceKey: 'ocr-1-1', pageId: ID, blockId: ID, lineId: ID, wordId: ID, startOffset: 0, endOffset: 10, sectionHeading: 'Cam', clauseIdentifier: 'Madde 1', sourceType: 'policy', confidence: .9 }
    expect(policyOcrSourceReferenceRequestSchema.safeParse(base).success).toBe(true)
    expect(policyOcrSourceReferenceRequestSchema.safeParse({ ...base, blockId: null }).success).toBe(false)
    expect(policyOcrSourceReferenceRequestSchema.safeParse({ ...base, endOffset: 1001 }).success).toBe(false)
  })

  it('Agent OCR payloadında mutlak/UNC yolu ve sürümsüz motoru reddeder', () => {
    const payload = { kind: 'policy_ocr', ocrRunId: ID, ocrRunVersion: 1, textExtractionId: ID, storageRootKey: 'root', relativePath: '2026/policy.pdf', declaredHash: HASH, declaredSize: 100, languageMode: 'tur+eng', languageDataHash: HASH, ...versions, renderProfile: 'standard', renderDpi: 300, eligiblePages: [{ textPageId: ID, pageNumber: 1, sourcePageStatus: 'image_only' }], maxSourceBytes: 1000, maxImagePixels: 30000000, maxPageCharacters: 200000, maxTotalCharacters: 5000000, maxElementsPerPage: 20000, timeoutMs: 300000, workerMemoryMb: 512 }
    expect(jobPayloadSchema.safeParse(payload).success).toBe(true)
    expect(jobPayloadSchema.safeParse({ ...payload, relativePath: 'C:/policy.pdf' }).success).toBe(false)
    expect(jobPayloadSchema.safeParse({ ...payload, relativePath: '\\\\server\\policy.pdf' }).success).toBe(false)
    expect(jobPayloadSchema.safeParse({ ...payload, engineVersion: 'latest' }).success).toBe(false)
  })

  it('chunk raw/normalized katman, geometri, code-point offset ve bounded page taşır', () => {
    const chunk = { ocrRunId: ID, ocrRunVersion: 1, sequence: 0, pages: [{ textPageId: ID, pageNumber: 1, status: 'accepted_candidate', languageMode: 'tur+eng', imageWidth: 100, imageHeight: 100, renderDpi: 300, rotationDegrees: 0, deskewDegrees: 0, threshold: 127, rawOcrText: 'Cam', rawTextHash: HASH, normalizedText: 'Cam', normalizedTextHash: HASH, meanConfidence: 90, minimumConfidence: 80, qualityStatus: 'high', readingOrderQuality: 'reliable', compositeStatus: 'ocr_only', qualityReasonCode: 'quality_good', requiresHumanReview: false, lowConfidenceWordCount: 0, unreadableRegionCount: 0, processingDurationMs: 10, elements: [{ elementIndex: 0, type: 'block', parentIndex: null, readingOrder: 0, startOffset: 0, endOffset: 3, textHash: HASH, confidence: 90, bbox: { x: 0, y: 0, width: 90, height: 20 } }] }] }
    expect(policyOcrChunkRequestSchema.safeParse(chunk).success).toBe(true)
    expect(policyOcrChunkRequestSchema.safeParse({ ...chunk, pages: [...chunk.pages, ...chunk.pages, ...chunk.pages] }).success).toBe(false)
  })

  it('job result yalnız canonical OCR summary kabul eder', () => {
    const summary = { ocrRunId: ID, ocrRunVersion: 1, status: 'ready', ...versions, languageDataHash: HASH, sourceHash: HASH, sourceSize: 100, eligiblePageCount: 1, processedPageCount: 1, readyPageCount: 1, lowQualityPageCount: 0, emptyPageCount: 0, failedPageCount: 0, blockCount: 1, lineCount: 1, wordCount: 1, normalizedCharacterCount: 3, meanConfidence: 90, outputHash: HASH }
    expect(jobResultRequestSchema.safeParse({ outcome: 'verified', policyOcr: summary }).success).toBe(true)
    expect(jobResultRequestSchema.safeParse({ outcome: 'verified', policyOcr: { ...summary, engineVersion: '8' } }).success).toBe(false)
  })

  it('OCR güvenli hata kodlarını genel kabul kümesine ekler', () => {
    expect(API_ERROR_CODES).toEqual(expect.arrayContaining(['ocr_conflict', 'ocr_stale', 'ocr_source_invalid', 'ocr_engine_unavailable', 'ocr_limit_exceeded']))
  })
})
