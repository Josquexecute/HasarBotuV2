import { describe, expect, it } from 'vitest'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { convertFieldPhoto, meetMinimumJpegSize } from '../src/field-photo-image.js'
import { nextFieldPhotoName } from '../src/field-photo-worker.js'
import { readFile } from 'node:fs/promises'

describe('field photo conversion and naming', () => {
  it('decodes genuine HEIC/AVIF files and keeps camera EXIF orientation upright', async () => {
    for (const extension of ['heic', 'avif']) {
      const original = await readFile(new URL(`./fixtures/field-photo/synthetic.${extension}`, import.meta.url))
      const converted = await convertFieldPhoto(original)
      expect([converted.width, converted.height]).toEqual([640, 480])
      expect(converted.bytes.length).toBeGreaterThanOrEqual(102400)
      expect((await loadImage(converted.bytes)).width).toBe(640)
    }
    const rotated = await convertFieldPhoto(await readFile(new URL('./fixtures/field-photo/orientation-6.jpg', import.meta.url)))
    expect([rotated.width, rotated.height]).toEqual([100, 160])
  })
  it('preserves small image dimensions and supplies a standards-compliant 100 KB JPEG', async () => {
    const canvas = createCanvas(320, 240), context = canvas.getContext('2d')
    context.fillStyle = '#3a65d9'; context.fillRect(0, 0, 320, 240)
    const result = await convertFieldPhoto(await canvas.encode('png'))
    expect(result).toMatchObject({ width: 320, height: 240 })
    expect(result.bytes.length).toBeGreaterThanOrEqual(102400)
    expect(result.bytes.length).toBeLessThanOrEqual(614400)
    const decoded = await loadImage(result.bytes)
    expect([decoded.width, decoded.height]).toEqual([320, 240])
    const jpeg = await canvas.encode('jpeg', 98)
    expect(meetMinimumJpegSize(jpeg).subarray(-jpeg.length + 2)).toEqual(jpeg.subarray(2))
  })
  it('fits a detailed camera image within 600 KB without changing aspect ratio', async () => {
    const canvas = createCanvas(2400, 1800), context = canvas.getContext('2d')
    let seed = 42
    const data = context.createImageData(2400, 1800)
    for (let i = 0; i < data.data.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0
      data.data[i] = seed & 255; data.data[i + 1] = seed >>> 8 & 255; data.data[i + 2] = seed >>> 16 & 255; data.data[i + 3] = 255
    }
    context.putImageData(data, 0, 0)
    const result = await convertFieldPhoto(await canvas.encode('jpeg', 98))
    expect(result.bytes.length).toBeGreaterThanOrEqual(102400)
    expect(result.bytes.length).toBeLessThanOrEqual(614400)
    expect(result.width / result.height).toBeCloseTo(4 / 3, 2)
    expect(result.width).toBeLessThanOrEqual(2400)
    expect((await loadImage(result.bytes)).width).toBe(result.width)
  })
  it('accepts WebP photos and rejects scripts, corrupt input and decompression bombs', async () => {
    const canvas = createCanvas(100, 80)
    expect((await convertFieldPhoto(await canvas.encode('webp', 90))).width).toBe(100)
    await expect(convertFieldPhoto(Buffer.from('<svg><script>attack()</script></svg>'))).rejects.toThrow('unsupported_image')
    await expect(convertFieldPhoto(Buffer.from([255,216,255,0]))).rejects.toThrow('unsupported_image')
    const bomb = Buffer.alloc(32); Buffer.from([137,80,78,71,13,10,26,10]).copy(bomb); bomb.writeUInt32BE(100000,16); bomb.writeUInt32BE(100000,20)
    await expect(convertFieldPhoto(bomb)).rejects.toThrow('image_too_large')
  })
  it('continues damage numbering, preserves special photos and tolerates existing casing', () => {
    expect(nextFieldPhotoName('damage', [])).toBe('HASAR 101.jpg')
    expect(nextFieldPhotoName('damage', ['hasar 101.jpeg','HASAR 103.JPG','OTHER.jpg'])).toBe('HASAR 104.jpg')
    expect(nextFieldPhotoName('chassis', [])).toBe('ŞASE.jpg')
    expect(nextFieldPhotoName('chassis', ['şase.jpg','ŞASE 2.jpeg'])).toBe('ŞASE 3.jpg')
    expect(nextFieldPhotoName('odometer', ['KM.jpg'])).toBe('KM 2.jpg')
  })
})
