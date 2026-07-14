import { readFile } from 'node:fs/promises'
import { parentPort, workerData } from 'node:worker_threads'
import {
  PDF_TEXT_NORMALIZATION_VERSION,
  PDF_TEXT_PARSER_VERSION,
  buildPdfExtractionOutputHash,
  derivePdfExtractionStatus,
  normalizeExtractedPageText,
  sanitizeExtractedPageText,
  segmentNormalizedPdfText,
  sha256Text,
} from '@hasarbotu/domain'
import { OPS, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PdfExtractedPageChunk } from '@hasarbotu/contracts'
import type { PdfParserWorkerInput, PdfParserWorkerMessage } from './pdf-parser-protocol.js'

const input = workerData as PdfParserWorkerInput

function send(message: PdfParserWorkerMessage): void {
  parentPort?.postMessage(message)
}

interface TextItemLike {
  readonly str?: unknown
  readonly hasEOL?: unknown
  readonly transform?: unknown
}

function readingOrderText(items: readonly unknown[]): string {
  const lines: string[] = []
  let current = ''
  let lastY: number | null = null
  for (const raw of items) {
    const item = raw as TextItemLike
    if (typeof item.str !== 'string' || item.str.length === 0) continue
    const transform = Array.isArray(item.transform) ? item.transform : []
    const y: number | null = typeof transform[5] === 'number' ? transform[5] : lastY
    if (current.length > 0 && y !== null && lastY !== null && Math.abs(y - lastY) > 2) {
      lines.push(current)
      current = ''
    }
    if (current.length > 0 && !current.endsWith(' ') && !item.str.startsWith(' ')) current += ' '
    current += item.str
    if (item.hasEOL === true) {
      lines.push(current)
      current = ''
    }
    lastY = y
  }
  if (current.length > 0) lines.push(current)
  return lines.join('\n')
}

function canonicalError(error: unknown): string {
  const name = (error as { name?: unknown }).name
  if (name === 'PasswordException') return 'encrypted_pdf'
  if (name === 'InvalidPDFException' || name === 'FormatError') return 'malformed_pdf'
  if (name === 'MissingPDFException') return 'source_missing'
  return 'parser_failed'
}

async function run(): Promise<void> {
  try {
    const data = new Uint8Array(await readFile(input.filePath))
    const task = getDocument({ data, useSystemFonts: false, verbosity: 0 })
    const pdf = await task.promise
    if (pdf.numPages < 1 || pdf.numPages > input.maxPages) throw Object.assign(new Error('page limit'), { name: 'PageLimitError' })

    const pageSummaries: Array<{
      pageNumber: number
      status: PdfExtractedPageChunk['status']
      rawTextHash: string
      normalizedTextHash: string
      segmentCount: number
    }> = []
    let totalCharacters = 0
    let textPageCount = 0
    let imageOnlyPageCount = 0
    let emptyPageCount = 0
    let failedPageCount = 0
    let segmentCount = 0
    let rawCharacterCount = 0
    let normalizedCharacterCount = 0

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      let pageChunk: PdfExtractedPageChunk
      try {
        const page = await pdf.getPage(pageNumber)
        const [content, operators] = await Promise.all([page.getTextContent(), page.getOperatorList()])
        const rawText = sanitizeExtractedPageText(readingOrderText(content.items))
        const normalizedText = normalizeExtractedPageText(rawText)
        if (rawText.length > input.maxPageCharacters || normalizedText.length > input.maxPageCharacters) {
          throw Object.assign(new Error('page output limit'), { name: 'OutputLimitError' })
        }
        totalCharacters += rawText.length + normalizedText.length
        if (totalCharacters > input.maxTotalCharacters) throw Object.assign(new Error('total output limit'), { name: 'OutputLimitError' })
        const hasImage = operators.fnArray.some((operation) => [
          OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject,
        ].includes(operation))
        const status: PdfExtractedPageChunk['status'] = normalizedText.length > 0 ? 'text' : hasImage ? 'image_only' : 'empty'
        const segments = status === 'text' ? segmentNormalizedPdfText(normalizedText) : []
        pageChunk = {
          pageNumber,
          status,
          rawText,
          normalizedText,
          rawTextHash: sha256Text(rawText),
          normalizedTextHash: sha256Text(normalizedText),
          segments: segments.map(({ segmentIndex, type, startOffset, endOffset, textHash }) => ({ segmentIndex, type, startOffset, endOffset, textHash })),
        }
      } catch (error) {
        const name = (error as { name?: unknown }).name
        if (name === 'OutputLimitError') throw error
        pageChunk = {
          pageNumber,
          status: 'failed',
          rawText: '',
          normalizedText: '',
          rawTextHash: sha256Text(''),
          normalizedTextHash: sha256Text(''),
          segments: [],
        }
      }
      if (pageChunk.status === 'text') textPageCount += 1
      else if (pageChunk.status === 'image_only') imageOnlyPageCount += 1
      else if (pageChunk.status === 'empty') emptyPageCount += 1
      else failedPageCount += 1
      segmentCount += pageChunk.segments.length
      rawCharacterCount += Array.from(pageChunk.rawText).length
      normalizedCharacterCount += Array.from(pageChunk.normalizedText).length
      pageSummaries.push({ pageNumber, status: pageChunk.status, rawTextHash: pageChunk.rawTextHash, normalizedTextHash: pageChunk.normalizedTextHash, segmentCount: pageChunk.segments.length })
      send({ kind: 'page', page: pageChunk })
    }
    const status = derivePdfExtractionStatus({ pageCount: pdf.numPages, textPageCount, imageOnlyPageCount, emptyPageCount, failedPageCount })
    send({ kind: 'complete', summary: {
      extractionId: input.extractionId,
      extractionVersion: input.extractionVersion,
      status,
      parserVersion: PDF_TEXT_PARSER_VERSION,
      normalizationVersion: PDF_TEXT_NORMALIZATION_VERSION,
      sourceHash: input.sourceHash,
      sourceSize: input.sourceSize,
      pageCount: pdf.numPages,
      textPageCount,
      imageOnlyPageCount,
      emptyPageCount,
      failedPageCount,
      segmentCount,
      rawCharacterCount,
      normalizedCharacterCount,
      outputHash: buildPdfExtractionOutputHash(pageSummaries),
    } })
    await task.destroy()
  } catch (error) {
    const name = (error as { name?: unknown }).name
    const errorCode = name === 'PageLimitError' ? 'page_limit_exceeded'
      : name === 'OutputLimitError' ? 'output_limit_exceeded'
        : canonicalError(error)
    send({ kind: 'error', errorCode })
  }
}

void run()
