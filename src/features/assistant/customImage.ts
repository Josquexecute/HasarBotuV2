import { prepareAssistantTexture } from '../../../public/desktop-assistant-image.js'

const MAX_BYTES = 2 * 1024 * 1024

/** Check dimensions before decoding to avoid allocating an unbounded source bitmap. */
export function sourceImageSize(bytes: Uint8Array): { width: number; height: number; type: string } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const text = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length))
  if (bytes.length >= 24 && text(1, 3) === 'PNG' && bytes[0] === 137 && text(12, 4) === 'IHDR') {
    return { width: view.getUint32(16), height: view.getUint32(20), type: 'image/png' }
  }
  if (bytes.length >= 30 && text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') {
    const kind = text(12, 4)
    if (kind === 'VP8X') return { width: 1 + (view.getUint32(24, true) & 0xffffff), height: 1 + (bytes[27]! | bytes[28]! << 8 | bytes[29]! << 16), type: 'image/webp' }
    if (kind === 'VP8 ' && text(23, 3) === '\x9d\x01\x2a') return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff, type: 'image/webp' }
    if (kind === 'VP8L' && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true)
      return { width: (bits & 0x3fff) + 1, height: (bits >>> 14 & 0x3fff) + 1, type: 'image/webp' }
    }
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) return null
      while (bytes[offset] === 0xff) offset++
      const marker = bytes[offset++]!
      if (marker === 0xd9 || marker === 0xda || offset + 2 > bytes.length) break
      const length = view.getUint16(offset)
      if (length < 2 || offset + length > bytes.length) return null
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 8) {
        return { height: view.getUint16(offset + 3), width: view.getUint16(offset + 5), type: 'image/jpeg' }
      }
      offset += length
    }
  }
  return null
}

export async function prepareAssistantImage(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('PNG, JPG veya WebP görseli seçin.')
  if (file.size > MAX_BYTES || file.size === 0) throw new Error('Görsel en fazla 2 MB olabilir.')
  const dimensions = sourceImageSize(new Uint8Array(await file.arrayBuffer()))
  if (!dimensions || dimensions.type !== file.type || dimensions.width < 1 || dimensions.height < 1) throw new Error('Görsel dosyası geçersiz.')
  if (dimensions.width > 8192 || dimensions.height > 8192 || dimensions.width * dimensions.height > 16_777_216) throw new Error('Görsel en fazla 16 megapiksel ve 8192 piksel kenarlı olabilir.')
  let image: ImageBitmap
  try { image = await createImageBitmap(file) }
  catch { throw new Error('Görsel açılamadı. Başka bir görsel seçin.') }
  try {
    return prepareAssistantTexture(image).toDataURL('image/png')
  } finally { image.close() }
}

export async function positionAssistantImage(source: string, placement: { scale: number; x: number; y: number }): Promise<string> {
  const image = new Image()
  image.src = source
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = image.width; canvas.height = image.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Görsel işlenemedi.')
  const width = image.width * placement.scale, height = image.height * placement.scale
  context.drawImage(image, (canvas.width - width) / 2 + placement.x * canvas.width / 100, (canvas.height - height) / 2 + placement.y * canvas.height / 100, width, height)
  return canvas.toDataURL('image/png')
}
