import { parentPort, workerData } from 'node:worker_threads'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { createCanvas, loadImage, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas'
import { createWorker, OEM, PSM } from 'tesseract.js'

Object.assign(globalThis, { DOMMatrix, ImageData, Path2D })
const input = workerData as { kind: 'pdf' | 'image'; bytes: Uint8Array }
let ocr: Awaited<ReturnType<typeof createWorker>> | undefined
let document: Awaited<ReturnType<(typeof import('pdfjs-dist/legacy/build/pdf.mjs'))['getDocument']>['promise']> | undefined
let task: ReturnType<(typeof import('pdfjs-dist/legacy/build/pdf.mjs'))['getDocument']> | undefined
async function recognize(bytes: Uint8Array): Promise<string> {
  if (!ocr) {
    const require = createRequire(import.meta.url)
    const langPath = join(dirname(require.resolve('@tesseract.js-data/tur/package.json')), '4.0.0')
    ocr = await createWorker('tur', OEM.LSTM_ONLY, { langPath, gzip: true, cacheMethod: 'none', logger: () => undefined })
    await ocr.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT })
  }
  const result = await ocr.recognize(Buffer.from(bytes), {}, { text: true, blocks: true })
  const words = (result.data.blocks ?? []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines.flatMap(line => line.words)))
  if (!words.length) return result.data.text
  // Sparse OCR's block order interleaves columns. Restore the visual table's row order.
  const rows: { y: number; height: number; words: typeof words }[] = []
  for (const word of words.sort((a, b) => (a.bbox.y0 + a.bbox.y1) - (b.bbox.y0 + b.bbox.y1))) {
    const y = (word.bbox.y0 + word.bbox.y1) / 2, height = word.bbox.y1 - word.bbox.y0
    const row = rows.find(row => Math.abs(row.y - y) < Math.max(row.height, height) * 0.6)
    if (row) row.words.push(word)
    else rows.push({ y, height, words: [word] })
  }
  return rows.map(row => row.words.sort((a, b) => a.bbox.x0 - b.bbox.x0).map(word => word.text).join(' ')).join('\n')
}
try {
  const texts: string[] = []
  let usedOcr = false
  if (input.kind === 'image') {
    const image = await loadImage(Buffer.from(input.bytes))
    if (image.width * image.height > 20_000_000) throw new Error('image_limit')
    const scale = image.width < 2500 && image.width * image.height <= 5_000_000 ? 2 : 1
    const canvas = createCanvas(image.width * scale, image.height * scale)
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
    texts.push(await recognize(canvas.toBuffer('image/png')))
    usedOcr = true
  } else {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    task = getDocument({ data: new Uint8Array(input.bytes), useSystemFonts: true })
    document = await task.promise
    if (document.numPages > 10) throw new Error('page_limit')
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number)
      const content = await page.getTextContent()
      let text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('')
      // A scanned page can still contain a selectable print header/footer.
      if (text.replace(/\s/g, '').length < 100 || !/(?:Plaka|Hasar|Eksper|Talep|Sigort)/i.test(text)) {
        const viewport = page.getViewport({ scale: 2 })
        if (viewport.width * viewport.height > 20_000_000) throw new Error('image_limit')
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
        await page.render({ canvas: canvas as never, canvasContext: canvas.getContext('2d') as never, viewport }).promise
        text = await recognize(canvas.toBuffer('image/png'))
        usedOcr = true
      }
      texts.push(text)
      page.cleanup()
    }
  }
  const text = texts.join('\n\n')
  if (!text.trim() || text.length > 200_000) throw new Error('text_limit')
  parentPort?.postMessage({ ok: true, text, method: usedOcr ? 'ocr' : 'pdf_text' })
} catch {
  parentPort?.postMessage({ ok: false })
} finally {
  await ocr?.terminate()
  await task?.destroy()
}
