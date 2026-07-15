import { describe, expect, it } from 'vitest'
import {
  POLICY_OCR_LANGUAGE_DATA_HASHES,
  buildPolicyOcrOutputHash,
  buildPolicyOcrReadingOrder,
  derivePolicyOcrRunStatus,
  derivePolicyOcrCompositeStatus,
  evaluatePolicyOcrQuality,
  policyOcrLanguageDataHash,
  sha256Text,
} from '../src/index.js'

const box = (x: number, y: number, width = 80, height = 20) => ({ x, y, width, height })

describe('Paket 25 yerel OCR domain kuralları', () => {
  it('geometriyi deterministik okuma sırasına ve Unicode code point offsetlerine çevirir', () => {
    const input = [{
      text: 'İkinci 😀 satır\nİlk satır', confidence: 92, bbox: box(0, 0, 200, 100),
      lines: [
        { text: 'İkinci 😀 satır', confidence: 91, bbox: box(10, 50, 180, 20), words: [{ text: 'İkinci', confidence: 92, bbox: box(10, 50) }, { text: '😀', confidence: 90, bbox: box(95, 50, 20) }, { text: 'satır', confidence: 91, bbox: box(120, 50) }] },
        { text: 'İlk satır', confidence: 95, bbox: box(10, 10, 180, 20), words: [{ text: 'İlk', confidence: 95, bbox: box(10, 10) }, { text: 'satır', confidence: 94, bbox: box(60, 10) }] },
      ],
    }]
    const first = buildPolicyOcrReadingOrder(input)
    const second = buildPolicyOcrReadingOrder(input)
    expect(first).toEqual(second)
    expect(first).toMatchObject({ rawText: 'İlk satır\nİkinci 😀 satır', normalizedText: 'İlk satır\nİkinci 😀 satır', quality: 'reliable' })
    const emoji = first.elements.find((item) => item.text === '😀')
    expect(emoji).toMatchObject({ startOffset: 17, endOffset: 18 })
    expect(Array.from(first.normalizedText).slice(emoji!.startOffset, emoji!.endOffset).join('')).toBe('😀')
  })

  it('aynı girdide aynı kanonik output hashini üretir', () => {
    const pages = [
      { pageNumber: 2, status: 'low_confidence' as const, normalizedTextHash: sha256Text('b'), qualityStatus: 'low' as const, blockCount: 1, lineCount: 1, wordCount: 1 },
      { pageNumber: 1, status: 'accepted_candidate' as const, normalizedTextHash: sha256Text('a'), qualityStatus: 'high' as const, blockCount: 1, lineCount: 1, wordCount: 2 },
    ]
    expect(buildPolicyOcrOutputHash(pages)).toBe(buildPolicyOcrOutputHash([...pages].reverse()))
  })

  it('yan yana sütun adayını kesin sıraya zorlamadan ambiguous işaretler', () => {
    const result = buildPolicyOcrReadingOrder([
      { text: 'Sol sütun', confidence: 90, bbox: box(0, 0, 100, 100), lines: [{ text: 'Sol sütun', confidence: 90, bbox: box(0, 10, 90, 20), words: [{ text: 'Sol', confidence: 90, bbox: box(0, 10, 30, 20) }, { text: 'sütun', confidence: 90, bbox: box(35, 10, 50, 20) }] }] },
      { text: 'Sağ sütun', confidence: 90, bbox: box(200, 0, 100, 100), lines: [{ text: 'Sağ sütun', confidence: 90, bbox: box(200, 10, 90, 20), words: [{ text: 'Sağ', confidence: 90, bbox: box(200, 10, 30, 20) }, { text: 'sütun', confidence: 90, bbox: box(235, 10, 50, 20) }] }] },
    ])
    expect(result.quality).toBe('ambiguous')
    expect(evaluatePolicyOcrQuality({ normalizedText: result.normalizedText, meanConfidence: 95, wordCount: 4, readingOrderQuality: result.quality }).status).toBe('control_required')
  })

  it.each([
    [{ normalizedText: 'Kasko poliçesi cam teminatı', meanConfidence: 90, wordCount: 4 }, 'high', 'quality_good', false],
    [{ normalizedText: 'Kasko poliçesi', meanConfidence: 60, wordCount: 3 }, 'low', 'low_confidence', true],
    [{ normalizedText: 'iki kelime', meanConfidence: 95, wordCount: 2 }, 'insufficient', 'insufficient_text', true],
    [{ normalizedText: '???? metin', meanConfidence: 95, wordCount: 3 }, 'control_required', 'suspicious_characters', true],
    [{ normalizedText: '', meanConfidence: 0, wordCount: 0 }, 'insufficient', 'empty_result', true],
  ] as const)('kaliteyi fail-closed değerlendirir', (input, status, reason, review) => {
    expect(evaluatePolicyOcrQuality(input)).toEqual({ status, reasonCode: reason, requiresHumanReview: review })
  })

  it.each([
    [{ eligiblePageCount: 2, readyPageCount: 2, lowQualityPageCount: 0, emptyPageCount: 0, failedPageCount: 0 }, 'ready'],
    [{ eligiblePageCount: 2, readyPageCount: 1, lowQualityPageCount: 0, emptyPageCount: 0, failedPageCount: 1 }, 'partial'],
    [{ eligiblePageCount: 2, readyPageCount: 0, lowQualityPageCount: 2, emptyPageCount: 0, failedPageCount: 0 }, 'low_confidence'],
    [{ eligiblePageCount: 0, readyPageCount: 0, lowQualityPageCount: 0, emptyPageCount: 0, failedPageCount: 0 }, 'control_required'],
  ] as const)('run durumunu deterministik üretir', (input, status) => {
    expect(derivePolicyOcrRunStatus(input)).toBe(status)
  })

  it('tur/eng/tur+eng model checksum kimliğini sabitler', () => {
    expect(policyOcrLanguageDataHash('tur')).toBe(POLICY_OCR_LANGUAGE_DATA_HASHES.tur)
    expect(policyOcrLanguageDataHash('eng')).toBe(POLICY_OCR_LANGUAGE_DATA_HASHES.eng)
    expect(policyOcrLanguageDataHash('tur+eng')).toMatch(/^[a-f0-9]{64}$/)
    expect(policyOcrLanguageDataHash('tur+eng')).not.toBe(POLICY_OCR_LANGUAGE_DATA_HASHES.tur)
  })

  it('PDF ve OCR katmanlarını çoğaltmadan deterministik composite/conflict sonucu üretir', () => {
    expect(derivePolicyOcrCompositeStatus({ sourcePageStatus: 'image_only', pdfNormalizedText: '', ocrNormalizedText: 'Cam teminatı' })).toBe('ocr_only')
    expect(derivePolicyOcrCompositeStatus({ sourcePageStatus: 'text', pdfNormalizedText: 'Cam teminatı vardır', ocrNormalizedText: 'Cam teminatı vardır' })).toBe('pdf_text_only')
    expect(derivePolicyOcrCompositeStatus({ sourcePageStatus: 'text', pdfNormalizedText: 'Cam teminatı vardır', ocrNormalizedText: 'Cam teminatı yoktur' })).toBe('conflict_detected')
    expect(derivePolicyOcrCompositeStatus({ sourcePageStatus: 'text', pdfNormalizedText: 'Poliçe ana metni', ocrNormalizedText: 'Kaşe imza alanı' })).toBe('combined_non_overlapping')
  })

  it('geçersiz kutuyu ve sayfa çıktı limitini reddeder', () => {
    expect(() => buildPolicyOcrReadingOrder([{ text: 'x', confidence: 1, bbox: box(-1, 0), lines: [] }])).toThrow('invalid_ocr_bounding_box')
    expect(() => buildPolicyOcrReadingOrder([{ text: 'x'.repeat(200_001), confidence: 1, bbox: box(0, 0), lines: [{ text: 'x'.repeat(200_001), confidence: 1, bbox: box(0, 0), words: [] }] }])).toThrow('ocr_page_text_limit_exceeded')
  })
})
