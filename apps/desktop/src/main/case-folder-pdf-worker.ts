import { parentPort, workerData } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { createCanvas } from '@napi-rs/canvas'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const { bytes, page: requestedPage } = workerData as { bytes: Uint8Array; page: number }
const task = getDocument({
  data: bytes,
  disableFontFace: true,
  useWasm: false,
  isOffscreenCanvasSupported: false,
  maxImageSize: 16_000_000,
  enableXfa: false,
  standardFontDataUrl: fileURLToPath(new URL('../standard_fonts/', import.meta.resolve('pdfjs-dist'))).replaceAll('\\', '/'),
  cMapUrl: fileURLToPath(new URL('../cmaps/', import.meta.resolve('pdfjs-dist'))).replaceAll('\\', '/'),
  cMapPacked: true,
})
try {
  const pdf = await task.promise
  const pageNumber = Math.min(requestedPage, pdf.numPages)
  const page = await pdf.getPage(pageNumber)
  const original = page.getViewport({ scale: 1 })
  const scale = Math.min(4, 2400 / Math.max(original.width, original.height))
  const viewport = page.getViewport({ scale })
  const canvas = createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)))
  await page.render({
    canvas: null,
    canvasContext: canvas.getContext('2d') as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise
  parentPort?.postMessage({ kind: 'pdf', src: canvas.toDataURL('image/png'), page: pageNumber, pageCount: pdf.numPages })
} finally {
  await task.destroy()
}
