import { describe, expect, it } from 'vitest'
import {
  buildPdfExtractionOutputHash,
  derivePdfExtractionStatus,
  normalizeExtractedPageText,
  sanitizeExtractedPageText,
  segmentNormalizedPdfText,
  sha256Text,
  sliceByCodePoint,
} from '../src/index.js'

describe('PDF metin çıkarım domain çekirdeği', () => {
  it('SHA-256 çıktısını bilinen vektör ve Türkçe Unicode için deterministik üretir', () => {
    expect(sha256Text('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Text('Poliçe şartı')).toBe(sha256Text('Poliçe şartı'))
  })

  it('kontrol karakterlerini temizler, NFC ve boşluk normalizasyonunu sürümler', () => {
    expect(sanitizeExtractedPageText('  KASKO\t \r\nŞart\u0000  \n\n')).toBe('  KASKO\nŞart')
    expect(normalizeExtractedPageText('  KASKO\t \r\nS\u0327art\u00a0  metni\n\n\n')).toBe('KASKO\nŞart metni')
  })

  it('segment offsetlerini Unicode code point olarak exact ve tekrar üretilebilir tutar', () => {
    const text = 'KASKO POLİÇE\n1. Çarpışma teminatı\n- Özel şart 🚗'
    const first = segmentNormalizedPdfText(text)
    const second = segmentNormalizedPdfText(text)
    expect(first).toEqual(second)
    expect(first.map((segment) => segment.type)).toEqual(['title', 'clause', 'list'])
    for (const segment of first) expect(sliceByCodePoint(text, segment.startOffset, segment.endOffset)).toBe(segment.text)
  })

  it('ready, partial ve OCR gerekli durumlarını yalnız sayfa gerçeklerinden türetir', () => {
    expect(derivePdfExtractionStatus({ pageCount: 2, textPageCount: 2, imageOnlyPageCount: 0, emptyPageCount: 0, failedPageCount: 0 })).toBe('ready')
    expect(derivePdfExtractionStatus({ pageCount: 2, textPageCount: 1, imageOnlyPageCount: 1, emptyPageCount: 0, failedPageCount: 0 })).toBe('partial')
    expect(derivePdfExtractionStatus({ pageCount: 1, textPageCount: 0, imageOnlyPageCount: 1, emptyPageCount: 0, failedPageCount: 0 })).toBe('ocr_required')
  })

  it('çıktı hashini giriş sırasından bağımsız fakat sayfa içeriğine duyarlı üretir', () => {
    const pages = [
      { pageNumber: 2, status: 'empty' as const, rawTextHash: sha256Text(''), normalizedTextHash: sha256Text(''), segmentCount: 0 },
      { pageNumber: 1, status: 'text' as const, rawTextHash: sha256Text('A'), normalizedTextHash: sha256Text('A'), segmentCount: 1 },
    ]
    expect(buildPdfExtractionOutputHash(pages)).toBe(buildPdfExtractionOutputHash([...pages].reverse()))
    expect(buildPdfExtractionOutputHash(pages)).not.toBe(buildPdfExtractionOutputHash([{ ...pages[0]!, status: 'failed' }, pages[1]!]))
  })
})
