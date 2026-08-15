import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, extname, join, relative } from 'node:path'
import { classifyV1ClaimTypeDocumentText, type V1ClaimTypeContentEvidenceKind } from '@hasarbotu/domain'
import { loadImage } from '@napi-rs/canvas'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

export const V1_CLAIM_DOCUMENT_EVIDENCE_VERSION = 'v1-claim-document-evidence/1.0.0' as const
const MAX_FILES = 64
const MAX_FILE_BYTES = 32 * 1024 * 1024
const MAX_PDF_PAGES = 100
const MAX_EXTRACTED_CHARACTERS = 1_000_000
const CONTENT_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg'])

export interface V1ClaimTypeDocumentEvidence {
  readonly kind: V1ClaimTypeContentEvidenceKind
  readonly sourceRelativePath: string
  readonly caseRelativePath: string
  readonly sourceFileHash: string
  readonly extractionMethod: 'pdf_text' | 'local_ocr'
  readonly extractionVersion: typeof V1_CLAIM_DOCUMENT_EVIDENCE_VERSION
  readonly marker: 'explicit_zmss_policy' | 'explicit_traffic_policy' | 'explicit_casco_policy'
  readonly confidence: number | null
}

export interface V1ClaimTypeDocumentEvidenceScan {
  readonly scanState: 'complete' | 'failed'
  readonly evidence: readonly V1ClaimTypeDocumentEvidence[]
}

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function listCandidates(folderAbsolutePath: string): Promise<Array<{ absolutePath: string; caseRelativePath: string }>> {
  const candidates: Array<{ absolutePath: string; caseRelativePath: string }> = []
  async function walk(absoluteDirectory: string): Promise<void> {
    const entries = await readdir(absoluteDirectory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name, 'tr-TR'))
    for (const entry of entries) {
      if (entry.name === '_HASARBOTU') continue
      const absolutePath = join(absoluteDirectory, entry.name)
      if (entry.isDirectory()) {
        await walk(absolutePath)
        continue
      }
      if (!entry.isFile() || !CONTENT_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue
      candidates.push({ absolutePath, caseRelativePath: relative(folderAbsolutePath, absolutePath).split('\\').join('/') })
      if (candidates.length > MAX_FILES) throw new Error('claim_document_file_limit_exceeded')
    }
  }
  await walk(folderAbsolutePath)
  return candidates
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const task = getDocument({ data: bytes, useSystemFonts: false, verbosity: 0 })
  try {
    const pdf = await task.promise
    if (pdf.numPages < 1 || pdf.numPages > MAX_PDF_PAGES) throw new Error('claim_document_page_limit_exceeded')
    let text = ''
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      text += ` ${content.items.map((item) => {
        const candidate = item as { readonly str?: unknown }
        return typeof candidate.str === 'string' ? candidate.str : ''
      }).join(' ')}`
      if (Array.from(text).length > MAX_EXTRACTED_CHARACTERS) throw new Error('claim_document_text_limit_exceeded')
    }
    return text
  } finally {
    await task.destroy().catch(() => undefined)
  }
}

async function localLanguagePath(): Promise<string> {
  const require = createRequire(import.meta.url)
  return join(dirname(require.resolve('@tesseract.js-data/tur/package.json')), '4.0.0')
}

/**
 * Yalniz unknown/no-KM source icin cagrilir. PDF text ve pinned offline OCR
 * kullanir; ham document text'i dondurmez veya loglamaz.
 */
export async function scanV1ClaimTypeDocumentEvidence(input: {
  readonly folderAbsolutePath: string
  readonly folderRelativePath: string
}): Promise<V1ClaimTypeDocumentEvidenceScan> {
  let ocrWorker: Awaited<ReturnType<(typeof import('tesseract.js'))['createWorker']>> | undefined
  try {
    const candidates = await listCandidates(input.folderAbsolutePath)
    // Text-layer PDF, OCR'dan daha kesin ve cok daha ucuzdur. Tum PDF'ler
    // once taranir; en az bir explicit policy kaniti cikarsa PDF katmaninin
    // kendi celiskileri korunur, genel fotograf arsivi OCR'a sokulmaz.
    candidates.sort((left, right) => {
      const leftTier = extname(left.absolutePath).toLowerCase() === '.pdf' ? 0 : 1
      const rightTier = extname(right.absolutePath).toLowerCase() === '.pdf' ? 0 : 1
      return leftTier - rightTier || left.caseRelativePath.localeCompare(right.caseRelativePath, 'tr-TR')
    })
    const evidence: V1ClaimTypeDocumentEvidence[] = []
    let pdfEvidenceDetected = false
    for (const candidate of candidates) {
      const metadata = await stat(candidate.absolutePath)
      if (!metadata.isFile() || metadata.size > MAX_FILE_BYTES) throw new Error('claim_document_size_limit_exceeded')
      // Bos bir dosya claim turune dair belge icerigi tasiyamaz. Envanterde
      // kalir; sonradan icerik kazanirsa yeni evidence/fingerprint uretilir.
      if (metadata.size === 0) continue
      const bytes = new Uint8Array(await readFile(candidate.absolutePath))
      const extension = extname(candidate.absolutePath).toLowerCase()
      if (extension !== '.pdf' && pdfEvidenceDetected) continue
      let extractedText: string
      let confidence: number | null
      let extractionMethod: 'pdf_text' | 'local_ocr'
      if (extension === '.pdf') {
        extractedText = await extractPdfText(bytes)
        confidence = null
        extractionMethod = 'pdf_text'
      } else {
        // Bozuk/yanlis uzantili dosyayi Tesseract worker'a vermeden once yerel
        // decoder ile fail-closed dogrula; worker kaynakli unhandled hata yok.
        await loadImage(Buffer.from(bytes))
        if (ocrWorker === undefined) {
          const { createWorker, OEM } = await import('tesseract.js')
          ocrWorker = await createWorker('tur', OEM.LSTM_ONLY, {
            langPath: await localLanguagePath(), cacheMethod: 'none', gzip: true, logger: () => undefined,
          })
          await ocrWorker.setParameters({ user_defined_dpi: '300' })
        }
        const recognized = await ocrWorker.recognize(Buffer.from(bytes), { rotateAuto: true }, { text: true })
        extractedText = recognized.data.text
        confidence = Math.round(recognized.data.confidence * 100) / 100
        extractionMethod = 'local_ocr'
      }
      const decision = classifyV1ClaimTypeDocumentText({ text: extractedText, extractionMethod, confidence })
      if (extension === '.pdf' && decision.kinds.length > 0) pdfEvidenceDetected = true
      const fileHash = hash(bytes)
      for (const kind of decision.kinds) {
        const expectedMarker = kind === 'traffic_policy_content'
          ? decision.markers.find((marker) => marker === 'explicit_zmss_policy' || marker === 'explicit_traffic_policy')
          : decision.markers.find((marker) => marker === 'explicit_casco_policy')
        if (expectedMarker === undefined) continue
        evidence.push({
          kind,
          sourceRelativePath: `${input.folderRelativePath}/${candidate.caseRelativePath}`,
          caseRelativePath: candidate.caseRelativePath,
          sourceFileHash: fileHash,
          extractionMethod,
          extractionVersion: V1_CLAIM_DOCUMENT_EVIDENCE_VERSION,
          marker: expectedMarker,
          confidence,
        })
      }
    }
    evidence.sort((left, right) => left.caseRelativePath.localeCompare(right.caseRelativePath, 'tr-TR') || left.kind.localeCompare(right.kind))
    return { scanState: 'complete', evidence }
  } catch {
    return { scanState: 'failed', evidence: [] }
  } finally {
    await ocrWorker?.terminate().catch(() => undefined)
  }
}
