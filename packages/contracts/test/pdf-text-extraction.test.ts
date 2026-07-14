import { describe, expect, it } from 'vitest'
import {
  pdfExtractionChunkRequestSchema,
  pdfTextExtractionCreateRequestSchema,
  pdfTextSourceReferenceRequestSchema,
  pdfTextExtractionSchema,
} from '../src/index.js'

const id = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`
const hash = 'a'.repeat(64)

describe('PDF metin çıkarım contracts', () => {
  it('create komutunu boş ve strict tutar', () => {
    expect(pdfTextExtractionCreateRequestSchema.parse({})).toEqual({})
    expect(pdfTextExtractionCreateRequestSchema.safeParse({ parser: 'client-controlled' }).success).toBe(false)
  })

  it('Agent chunk sınırlarını ve Unicode offset sözleşmesini doğrular', () => {
    const chunk = { extractionId: id('1'), extractionVersion: 1, sequence: 0, pages: [{ pageNumber: 1, status: 'text', rawText: 'KASKO', normalizedText: 'KASKO', rawTextHash: hash, normalizedTextHash: hash, segments: [{ segmentIndex: 0, type: 'title', startOffset: 0, endOffset: 5, textHash: hash }] }] }
    expect(pdfExtractionChunkRequestSchema.parse(chunk).pages).toHaveLength(1)
    expect(pdfExtractionChunkRequestSchema.safeParse({ ...chunk, pages: [] }).success).toBe(false)
    expect(pdfExtractionChunkRequestSchema.safeParse({ ...chunk, unexpected: true }).success).toBe(false)
  })

  it('kaynak alıntısını 1000 code point ile sınırlar ve ters offseti reddeder', () => {
    const source = { sourceKey: 'PDF_1', pageId: id('2'), segmentId: id('3'), startOffset: 4, endOffset: 20, sectionHeading: 'Özel Şartlar', clauseIdentifier: 'K-1', sourceType: 'policy', confidence: 1 }
    expect(pdfTextSourceReferenceRequestSchema.parse(source).endOffset).toBe(20)
    expect(pdfTextSourceReferenceRequestSchema.safeParse({ ...source, endOffset: 4 }).success).toBe(false)
    expect(pdfTextSourceReferenceRequestSchema.safeParse({ ...source, endOffset: 1005 }).success).toBe(false)
  })

  it('response parser ve normalizasyon sürümünü sessizce genişletmez', () => {
    const base = { id: id('1'), caseId: id('2'), documentId: id('3'), documentVersionId: id('4'), extractionVersion: 1, status: 'ready', parserName: 'pdfjs-dist', parserVersion: '6.1.200', normalizationVersion: 'pdf-text-normalization/1.0.0', offsetUnit: 'unicode_code_point', sourceHash: hash, sourceSize: 100, pageCount: 1, textPageCount: 1, imageOnlyPageCount: 0, emptyPageCount: 0, failedPageCount: 0, segmentCount: 1, rawCharacterCount: 5, normalizedCharacterCount: 5, outputHash: hash, failureCode: null, activeJobId: null, version: 2, createdAt: '2026-07-14T08:00:00.000Z', startedAt: '2026-07-14T08:00:01.000Z', completedAt: '2026-07-14T08:00:02.000Z' }
    expect(pdfTextExtractionSchema.parse(base).parserVersion).toBe('6.1.200')
    expect(pdfTextExtractionSchema.safeParse({ ...base, parserVersion: 'latest' }).success).toBe(false)
  })
})
