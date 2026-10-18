import { createRequire } from 'node:module'
import { createCanvas, ImageData, loadImage } from '@napi-rs/canvas'
import { FIELD_PHOTO_MAX_BYTES, FIELD_PHOTO_MIN_JPEG_BYTES, FIELD_PHOTO_MAX_JPEG_BYTES } from '@hasarbotu/contracts'

const MAX_PIXELS = 64_000_000
const dimensions = (width: number, height: number) => {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width * height > MAX_PIXELS) throw new Error('image_too_large')
}
interface HeifImage {
  get_width(): number; get_height(): number
  display(target: { data: Uint8ClampedArray; width: number; height: number }, done: (result: { data: Uint8ClampedArray } | null) => void): void
  free(): void
}

function checkRasterHeader(bytes: Buffer) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    if (bytes.length < 24) throw new Error('unsupported_image')
    dimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20)); return
  }
  if (bytes[0] === 255 && bytes[1] === 216) {
    let cursor = 2
    while (cursor + 8 < bytes.length) {
      if (bytes[cursor++] !== 255) continue
      const marker = bytes[cursor++]!
      if (marker === 216 || marker === 1 || marker >= 208 && marker <= 215) continue
      if (marker === 218 || marker === 217) break
      const length = bytes.readUInt16BE(cursor)
      if (length < 2 || cursor + length > bytes.length) break
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
        dimensions(bytes.readUInt16BE(cursor + 5), bytes.readUInt16BE(cursor + 3)); return
      }
      cursor += length
    }
    throw new Error('unsupported_image')
  }
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') {
    const kind = bytes.subarray(12, 16).toString()
    if (kind === 'VP8X' && bytes.length >= 30) dimensions(1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3))
    else if (kind === 'VP8 ' && bytes.length >= 30) dimensions(bytes.readUInt16LE(26) & 16383, bytes.readUInt16LE(28) & 16383)
    else if (kind === 'VP8L' && bytes.length >= 25) { const bits = bytes.readUInt32LE(21); dimensions((bits & 16383) + 1, ((bits >>> 14) & 16383) + 1) }
    else throw new Error('unsupported_image')
    return
  }
  if (bytes.subarray(4, 8).toString() === 'ftyp' && bytes.subarray(8, 40).toString().includes('avif')) {
    const index = bytes.indexOf('ispe')
    if (index < 0 || index + 16 > bytes.length) throw new Error('unsupported_image')
    dimensions(bytes.readUInt32BE(index + 8), bytes.readUInt32BE(index + 12)); return
  }
  throw new Error('unsupported_image')
}

/** A legal JPEG comment meets the requested lower size bound without upscaling small images. */
export function meetMinimumJpegSize(bytes: Buffer): Buffer {
  if (bytes.length >= FIELD_PHOTO_MIN_JPEG_BYTES) return bytes
  const comments: Buffer[] = []
  let remaining = FIELD_PHOTO_MIN_JPEG_BYTES - bytes.length
  while (remaining > 0) {
    const length = Math.min(65537, Math.max(4, remaining))
    const segment = Buffer.alloc(length)
    segment[0] = 255; segment[1] = 254; segment.writeUInt16BE(length - 2, 2)
    comments.push(segment); remaining -= length
  }
  return Buffer.concat([bytes.subarray(0, 2), ...comments, bytes.subarray(2)])
}

export async function convertFieldPhoto(bytes: Buffer) {
  if (!bytes.length || bytes.length > FIELD_PHOTO_MAX_BYTES) throw new Error('image_too_large')
  const brands = bytes.subarray(8, 48).toString('latin1')
  const isHeif = bytes.subarray(4, 8).toString() === 'ftyp' && /heic|heix|hevc|hevx|mif1|msf1/u.test(brands) && !brands.includes('avif')
  let source
  if (isHeif) {
    const lib = await createRequire(import.meta.url)('libheif-js/wasm-bundle') as { HeifDecoder: new () => { decode(bytes: Buffer): HeifImage[] } }
    const images = new lib.HeifDecoder().decode(bytes)
    if (!images.length) throw new Error('unsupported_image')
    try {
      const image = images[0]!, width = image.get_width(), height = image.get_height()
      dimensions(width, height)
      const decoded = await new Promise<{ data: Uint8ClampedArray }>((resolve, reject) => image.display({ data: new Uint8ClampedArray(width * height * 4), width, height }, value => value ? resolve(value) : reject(new Error('unsupported_image'))))
      source = createCanvas(width, height)
      source.getContext('2d').putImageData(new ImageData(decoded.data, width, height), 0, 0)
    } finally { images.forEach(image => image.free()) }
  } else {
    checkRasterHeader(bytes)
    source = await loadImage(bytes)
  }
  dimensions(source.width, source.height)
  let scale = Math.min(1, 4096 / Math.max(source.width, source.height))
  for (let attempt = 0; attempt < 16; attempt++) {
    const width = Math.max(1, Math.round(source.width * scale)), height = Math.max(1, Math.round(source.height * scale))
    const canvas = createCanvas(width, height), context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height)
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'
    context.drawImage(source, 0, 0, width, height)
    let best = await canvas.encode('jpeg', 85)
    if (best.length <= FIELD_PHOTO_MAX_JPEG_BYTES) {
      let low = 86, high = 98
      while (low <= high) {
        const quality = Math.floor((low + high) / 2), candidate = await canvas.encode('jpeg', quality)
        if (candidate.length <= FIELD_PHOTO_MAX_JPEG_BYTES) { best = candidate; low = quality + 1 } else high = quality - 1
      }
      return { bytes: meetMinimumJpegSize(best), width, height }
    }
    scale *= Math.max(0.5, Math.min(0.85, Math.sqrt(FIELD_PHOTO_MAX_JPEG_BYTES / best.length) * 0.96))
  }
  throw new Error('image_conversion_failed')
}
