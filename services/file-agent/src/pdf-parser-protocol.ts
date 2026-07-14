import type { PdfExtractedPageChunk, PdfExtractionResultSummary } from '@hasarbotu/contracts'

export interface PdfParserWorkerInput {
  readonly filePath: string
  readonly extractionId: string
  readonly extractionVersion: number
  readonly sourceHash: string
  readonly sourceSize: number
  readonly maxPages: number
  readonly maxPageCharacters: number
  readonly maxTotalCharacters: number
}

export type PdfParserWorkerMessage =
  | { readonly kind: 'page'; readonly page: PdfExtractedPageChunk }
  | { readonly kind: 'complete'; readonly summary: PdfExtractionResultSummary }
  | { readonly kind: 'error'; readonly errorCode: string }
