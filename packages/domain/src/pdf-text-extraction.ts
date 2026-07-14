/** Paket 24: deterministic, parser-independent PDF text normalization. */
export const PDF_TEXT_NORMALIZATION_VERSION = 'pdf-text-normalization/1.0.0' as const
export const PDF_TEXT_PARSER_NAME = 'pdfjs-dist' as const
export const PDF_TEXT_PARSER_VERSION = '6.1.200' as const

export const PDF_TEXT_EXTRACTION_STATUSES = [
  'queued', 'processing', 'ready', 'partial', 'ocr_required', 'failed', 'cancelled', 'stale',
] as const
export type PdfTextExtractionStatus = (typeof PDF_TEXT_EXTRACTION_STATUSES)[number]

export const PDF_TEXT_PAGE_STATUSES = ['text', 'image_only', 'empty', 'failed', 'skipped'] as const
export type PdfTextPageStatus = (typeof PDF_TEXT_PAGE_STATUSES)[number]

export const PDF_TEXT_SEGMENT_TYPES = [
  'title', 'heading', 'clause', 'paragraph', 'list', 'table', 'header_footer', 'unknown',
] as const
export type PdfTextSegmentType = (typeof PDF_TEXT_SEGMENT_TYPES)[number]

export const PDF_TEXT_OFFSET_UNIT = 'unicode_code_point' as const
export const MAX_PDF_SOURCE_BYTES = 64 * 1024 * 1024
export const MAX_PDF_PAGE_COUNT = 1_000
export const MAX_PDF_PAGE_TEXT_LENGTH = 200_000
export const MAX_PDF_TOTAL_TEXT_LENGTH = 5_000_000
export const MAX_PDF_SEGMENTS_PER_PAGE = 2_000
export const MAX_PDF_SOURCE_EXCERPT_LENGTH = 1_000

export interface PdfTextSegmentDraft {
  readonly segmentIndex: number
  readonly type: PdfTextSegmentType
  /** Zero-based, half-open offsets in Unicode code points on normalized page text. */
  readonly startOffset: number
  readonly endOffset: number
  readonly text: string
  readonly textHash: string
}

const SHA256_INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
] as const
const SHA256_K = [
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
] as const

function rotateRight(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count))
}

export function sha256Text(value: string): string {
  const encoded: number[] = []
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if (code <= 0x7f) encoded.push(code)
    else if (code <= 0x7ff) encoded.push(0xc0 | (code >>> 6), 0x80 | (code & 0x3f))
    else if (code <= 0xffff) encoded.push(0xe0 | (code >>> 12), 0x80 | ((code >>> 6) & 0x3f), 0x80 | (code & 0x3f))
    else encoded.push(0xf0 | (code >>> 18), 0x80 | ((code >>> 12) & 0x3f), 0x80 | ((code >>> 6) & 0x3f), 0x80 | (code & 0x3f))
  }
  const input = Uint8Array.from(encoded)
  const bitLength = input.length * 8
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64
  const bytes = new Uint8Array(paddedLength)
  bytes.set(input)
  bytes[input.length] = 0x80
  const view = new DataView(bytes.buffer)
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false)
  view.setUint32(paddedLength - 4, bitLength >>> 0, false)
  const hash: number[] = [...SHA256_INITIAL]
  const words = new Uint32Array(64)
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false)
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotateRight(words[index - 15]!, 7) ^ rotateRight(words[index - 15]!, 18) ^ (words[index - 15]! >>> 3)
      const s1 = rotateRight(words[index - 2]!, 17) ^ rotateRight(words[index - 2]!, 19) ^ (words[index - 2]! >>> 10)
      words[index] = (words[index - 16]! + s0 + words[index - 7]! + s1) >>> 0
    }
    let [a,b,c,d,e,f,g,h] = hash as [number,number,number,number,number,number,number,number]
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
      const choice = (e & f) ^ (~e & g)
      const temp1 = (h + s1 + choice + SHA256_K[index]! + words[index]!) >>> 0
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (s0 + majority) >>> 0
      h=g;g=f;f=e;e=(d+temp1)>>>0;d=c;c=b;b=a;a=(temp1+temp2)>>>0
    }
    const state = [a,b,c,d,e,f,g,h]
    for (let index = 0; index < 8; index += 1) hash[index] = (hash[index]! + state[index]!) >>> 0
  }
  return hash.map((valuePart) => valuePart.toString(16).padStart(8, '0')).join('')
}

/** Parser output is retained as reading-order raw text, with unsafe controls removed. */
export function sanitizeExtractedPageText(value: string): string {
  const lineNormalized = value.replace(/\r\n?/g, '\n')
  let safe = ''
  for (const character of lineNormalized) {
    const code = character.codePointAt(0) ?? 0
    if (character === '\n' || character === '\t' || code >= 32) safe += character
  }
  return safe
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n+$/g, '')
}

/** Versioned normalization; does not infer policy meaning or alter letter content. */
export function normalizeExtractedPageText(rawText: string): string {
  const safe = sanitizeExtractedPageText(rawText).normalize('NFC').replace(/\u00a0/g, ' ')
  const lines = safe.split('\n').map((line) => line.replace(/[\t ]+/g, ' ').trim())
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function codePointLength(value: string): number {
  return Array.from(value).length
}

export function sliceByCodePoint(value: string, startOffset: number, endOffset: number): string {
  return Array.from(value).slice(startOffset, endOffset).join('')
}

function segmentType(line: string, index: number): PdfTextSegmentType {
  if (line.includes('|')) return 'table'
  if (/^[-*\u2022]\s+/u.test(line)) return 'list'
  if (/^(?:\d+(?:\.\d+)*[.)]?|[A-ZÇĞİÖŞÜ][.)])\s+/u.test(line)) return 'clause'
  const letters = line.replace(/[^A-Za-zÇĞİÖŞÜçğıöşü]/gu, '')
  const isUpper = letters.length >= 3 && letters === letters.toLocaleUpperCase('tr-TR')
  if (index === 0 && line.length <= 160 && isUpper) return 'title'
  if (line.length <= 160 && isUpper) return 'heading'
  return 'paragraph'
}

/** One deterministic segment per non-empty normalized line. */
export function segmentNormalizedPdfText(normalizedText: string): readonly PdfTextSegmentDraft[] {
  const segments: PdfTextSegmentDraft[] = []
  let codePointCursor = 0
  for (const line of normalizedText.split('\n')) {
    const length = codePointLength(line)
    if (line.length > 0) {
      const startOffset = codePointCursor
      const endOffset = startOffset + length
      const text = sliceByCodePoint(normalizedText, startOffset, endOffset)
      segments.push({
        segmentIndex: segments.length,
        type: segmentType(line, segments.length),
        startOffset,
        endOffset,
        text,
        textHash: sha256Text(text),
      })
    }
    codePointCursor += length + 1
  }
  if (segments.length > MAX_PDF_SEGMENTS_PER_PAGE) throw new Error('segment_limit_exceeded')
  return segments
}

export function derivePdfExtractionStatus(input: {
  readonly pageCount: number
  readonly textPageCount: number
  readonly imageOnlyPageCount: number
  readonly emptyPageCount: number
  readonly failedPageCount: number
}): 'ready' | 'partial' | 'ocr_required' {
  if (input.textPageCount === 0 && input.pageCount > 0) return 'ocr_required'
  if (input.imageOnlyPageCount > 0 || input.failedPageCount > 0 || input.emptyPageCount > 0) return 'partial'
  return 'ready'
}

export function buildPdfExtractionOutputHash(pages: readonly {
  readonly pageNumber: number
  readonly status: PdfTextPageStatus
  readonly rawTextHash: string
  readonly normalizedTextHash: string
  readonly segmentCount: number
}[]): string {
  const canonical = [...pages]
    .sort((left, right) => left.pageNumber - right.pageNumber)
    .map((page) => JSON.stringify(page))
    .join('\n')
  return sha256Text(canonical)
}
