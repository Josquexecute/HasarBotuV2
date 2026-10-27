import { describe, expect, it, vi } from 'vitest'
import { prepareAssistantImage, sourceImageSize } from './customImage'
import { removeDarkBackdrop } from '../../../public/desktop-assistant-image.js'

function png(width: number, height: number) {
  const bytes = new Uint8Array(33), view = new DataView(bytes.buffer)
  bytes.set([137, 80, 78, 71], 0); bytes.set([73, 72, 68, 82], 12)
  view.setUint32(16, width); view.setUint32(20, height)
  return bytes
}
describe('Touch image input', () => {
  it('removes only the exterior black matte, preserving connected black logo details', () => {
    const size = 40, pixels = new Uint8ClampedArray(size * size * 4)
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      pixels[i + 3] = 255
      if (x >= 7 && x <= 32 && y >= 7 && y <= 32 && y !== 20) { pixels[i] = 255; pixels[i + 1] = 220 }
    }
    removeDarkBackdrop(pixels, size, size)
    expect(pixels[3]).toBe(0)
    expect(pixels[(20 * size + 20) * 4 + 3]).toBe(255)
    expect(pixels[(20 * size + 20) * 4]).toBe(0)
    expect(pixels[(10 * size + 10) * 4]).toBe(255)
  })
  it('preserves transparent artwork and images without a uniform black border', () => {
    for (const alpha of [0, 128, 255]) {
      const pixels = new Uint8ClampedArray(16 * 16 * 4).fill(255)
      pixels[3] = alpha
      const original = pixels.slice()
      removeDarkBackdrop(pixels, 16, 16)
      expect(pixels).toEqual(original)
    }
  })
  it('recognizes PNG, JPEG and WebP dimensions before native decoding', () => {
    expect(sourceImageSize(png(200, 100))).toEqual({ width: 200, height: 100, type: 'image/png' })
    const jpeg = new Uint8Array([255, 216, 255, 192, 0, 8, 8, 0, 40, 0, 80, 3])
    expect(sourceImageSize(jpeg)).toEqual({ width: 80, height: 40, type: 'image/jpeg' })
    const webp = new Uint8Array(30)
    for (const [offset, value] of [[0, 'RIFF'], [8, 'WEBP'], [12, 'VP8X']] as const) webp.set([...value].map(c => c.charCodeAt(0)), offset)
    webp[24] = 79; webp[27] = 39
    expect(sourceImageSize(webp)).toEqual({ width: 80, height: 40, type: 'image/webp' })
  })
  it('rejects unsafe type, size, forged format and decompression bombs before decoding', async () => {
    const decode = vi.fn(); vi.stubGlobal('createImageBitmap', decode)
    const input = (bytes: Uint8Array, type: string, size = bytes.length) => ({ type, size, arrayBuffer: async () => bytes.buffer }) as File
    for (const file of [input(png(1, 1), 'image/svg+xml'), input(png(1, 1), 'image/png', 2_097_153), input(png(1, 1), 'image/jpeg'), input(png(50_000, 50_000), 'image/png')]) {
      await expect(prepareAssistantImage(file)).rejects.toThrow()
    }
    expect(decode).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
