import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  class NodeWorker {
    terminate = vi.fn<() => Promise<number>>(async () => 0)
  }
  const page = {
    getTextContent: vi.fn(async () => ({ items: [{ str: 'SYNTHETIC POLICY', transform: [1, 0, 0, 1, 0, 750] }] })),
    getOperatorList: vi.fn(async () => ({ fnArray: [] })),
    getViewport: vi.fn(() => ({ width: 2, height: 2 })),
    render: vi.fn(() => ({ promise: Promise.resolve() })),
    cleanup: vi.fn(() => true),
  }
  const pdf = { numPages: 1, getPage: vi.fn(async () => page) }
  const canvas = {
    width: 2, height: 2,
    getContext: () => ({ fillStyle: '', fillRect: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(16) }), putImageData: vi.fn() }),
    toBuffer: () => Buffer.from('synthetic PNG'),
  }
  return {
    NodeWorker, page, pdf, canvas, nativeWorker: new NodeWorker(),
    input: {} as Record<string, unknown>,
    messages: [] as Array<{ kind: string; errorCode?: string }>,
    documentPromise: Promise.resolve(pdf),
    destroy: vi.fn<() => Promise<void>>(async () => undefined),
    facadeTerminate: vi.fn<() => Promise<void>>(async () => undefined),
    recognize: vi.fn(async () => ({ data: { blocks: [], text: '', confidence: 0, rotateRadians: 0 } })),
  }
})

vi.mock('node:fs/promises', () => ({ readFile: vi.fn(async () => Buffer.from('synthetic PDF')) }))
vi.mock('node:worker_threads', () => ({
  Worker: state.NodeWorker,
  workerData: state.input,
  parentPort: { postMessage: (message: { kind: string; errorCode?: string }) => state.messages.push(message) },
}))
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', async () => ({
  version: (await import('@hasarbotu/domain')).PDF_TEXT_PARSER_VERSION,
  OPS: { paintImageXObject: 1, paintInlineImageXObject: 2, paintImageMaskXObject: 3 },
  getDocument: () => ({ promise: state.documentPromise, destroy: state.destroy }),
}))
vi.mock('@napi-rs/canvas', () => ({ createCanvas: () => state.canvas }))
vi.mock('tesseract.js', () => ({
  OEM: { LSTM_ONLY: 1 },
  createWorker: async () => ({ worker: state.nativeWorker, recognize: state.recognize, terminate: state.facadeTerminate }),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const terminal = () => state.messages.filter(message => message.kind === 'complete' || message.kind === 'error')

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  state.messages.length = 0
  state.pdf.numPages = 1
  state.documentPromise = Promise.resolve(state.pdf)
  state.destroy.mockResolvedValue(undefined)
  state.nativeWorker.terminate.mockResolvedValue(0)
  // Match the installed Tesseract 7 facade: request termination but discard its promise.
  state.facadeTerminate.mockImplementation(async () => { void state.nativeWorker.terminate() })
  state.canvas.width = 2; state.canvas.height = 2
  Object.assign(state.input, {
    filePath: 'C:/synthetic/policy.pdf', languageAssetDirectory: 'C:/synthetic/assets',
    extractionId: '01900000-0000-7000-8000-000000000001', extractionVersion: 1,
    ocrRunId: '01900000-0000-7000-8000-000000000002', ocrRunVersion: 1,
    sourceHash: 'a'.repeat(64), sourceSize: 100, maxPages: 10,
    maxPageCharacters: 10000, maxTotalCharacters: 100000, maxImagePixels: 1000, maxElementsPerPage: 1000,
    renderDpi: 300, languageMode: 'eng', languageDataHash: 'b'.repeat(64),
    eligiblePages: [{ textPageId: '01900000-0000-7000-8000-000000000003', pageNumber: 1, sourcePageStatus: 'image_only' }],
  })
})

describe('worker terminal resource ownership', () => {
  it('does not hand PDF completion to the terminating parent before async task destruction', async () => {
    const destroyed = deferred<void>()
    state.destroy.mockReturnValue(destroyed.promise)
    await import('../src/pdf-parser-worker.js')
    await vi.waitFor(() => expect(state.destroy).toHaveBeenCalledOnce())
    expect(state.page.cleanup).toHaveBeenCalledOnce()
    expect(terminal()).toEqual([])
    destroyed.resolve()
    await vi.waitFor(() => expect(terminal()).toEqual([expect.objectContaining({ kind: 'complete' })]))
  })

  it('destroys a PDF task on page-limit failure before notifying the parent', async () => {
    const destroyed = deferred<void>()
    state.destroy.mockReturnValue(destroyed.promise)
    state.pdf.numPages = 11
    await import('../src/pdf-parser-worker.js')
    await vi.waitFor(() => expect(state.destroy).toHaveBeenCalledOnce())
    expect(terminal()).toEqual([])
    destroyed.resolve()
    await vi.waitFor(() => expect(terminal()).toEqual([{ kind: 'error', errorCode: 'page_limit_exceeded' }]))
  })

  it('does not report PDF success when destruction fails', async () => {
    state.destroy.mockRejectedValue(new Error('synthetic cleanup failure'))
    await import('../src/pdf-parser-worker.js')
    await vi.waitFor(() => expect(terminal()).toEqual([{ kind: 'error', errorCode: 'parser_failed' }]))
  })

  it('joins actual Tesseract Node Worker termination as well as its immediately resolved facade', async () => {
    const stopped = deferred<number>(), destroyed = deferred<void>()
    state.nativeWorker.terminate.mockReturnValue(stopped.promise)
    state.destroy.mockReturnValue(destroyed.promise)
    await import('../src/policy-ocr-worker.js')
    await vi.waitFor(() => expect(state.facadeTerminate).toHaveBeenCalledOnce())
    expect(state.destroy).not.toHaveBeenCalled()
    expect(state.page.cleanup).toHaveBeenCalledOnce()
    expect([state.canvas.width, state.canvas.height]).toEqual([1, 1])
    expect(terminal()).toEqual([])
    stopped.resolve(0)
    await vi.waitFor(() => expect(state.destroy).toHaveBeenCalledOnce())
    expect(terminal()).toEqual([])
    destroyed.resolve()
    await vi.waitFor(() => expect(terminal()).toEqual([expect.objectContaining({ kind: 'complete' })]))
  })

  it('releases an acquired PDF page and OCR thread before reporting a pixel-limit failure', async () => {
    const stopped = deferred<number>()
    state.nativeWorker.terminate.mockReturnValue(stopped.promise)
    state.input.maxImagePixels = 1
    await import('../src/policy-ocr-worker.js')
    await vi.waitFor(() => expect(state.facadeTerminate).toHaveBeenCalledOnce())
    expect(state.page.cleanup).toHaveBeenCalledOnce()
    expect(terminal()).toEqual([])
    stopped.resolve(0)
    await vi.waitFor(() => expect(terminal()).toEqual([{ kind: 'error', errorCode: 'image_pixel_limit_exceeded' }]))
    expect(state.destroy).toHaveBeenCalledOnce()
  })

  it('attempts PDF destruction and fails the OCR result if facade cleanup rejects', async () => {
    state.facadeTerminate.mockRejectedValue(new Error('synthetic cleanup failure'))
    await import('../src/policy-ocr-worker.js')
    await vi.waitFor(() => expect(terminal()).toEqual([{ kind: 'error', errorCode: 'ocr_worker_cleanup_failed' }]))
    expect(state.nativeWorker.terminate).toHaveBeenCalled()
    expect(state.destroy).toHaveBeenCalledOnce()
  })
})
