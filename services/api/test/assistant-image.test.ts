import { createCanvas, loadImage } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import { sanitizeAssistantImage } from '../src/assistant-appearance/image.js'

describe('Touch custom image sanitization', () => {
  it('re-encodes a bounded transparent PNG and strips appended content', async () => {
    const canvas = createCanvas(80, 40), context = canvas.getContext('2d')
    context.fillStyle = '#1122ee'; context.fillRect(20, 0, 40, 40)
    const bytes = Buffer.concat([canvas.toBuffer('image/png'), Buffer.from('private metadata')])
    const output = await sanitizeAssistantImage(`data:image/png;base64,${bytes.toString('base64')}`)
    const png = Buffer.from(output.split(',')[1]!, 'base64')
    expect(png.includes(Buffer.from('private metadata'))).toBe(false)
    const decoded = await loadImage(png)
    expect([decoded.width, decoded.height]).toEqual([80, 40])
    const result = createCanvas(80, 40), drawn = result.getContext('2d')
    drawn.drawImage(decoded, 0, 0)
    expect([...drawn.getImageData(0, 0, 1, 1).data]).toEqual([0, 0, 0, 0])
    expect([...drawn.getImageData(30, 10, 1, 1).data]).toEqual([17, 34, 238, 255])
  })
  it('rejects forged raster headers, oversized decoded allocation and animated PNG', async () => {
    const png = createCanvas(2, 2).toBuffer('image/png')
    const large = Buffer.from(png); large.writeUInt32BE(50_000, 16)
    const animation = Buffer.concat([png.subarray(0, 33), Buffer.from([0, 0, 0, 0, 97, 99, 84, 76, 0, 0, 0, 0]), png.subarray(33)])
    for (const bytes of [Buffer.from('<svg onload="alert(1)"/>'), large, animation, png.subarray(0, 30)]) {
      await expect(sanitizeAssistantImage(`data:image/png;base64,${bytes.toString('base64')}`)).rejects.toThrow()
    }
  })
  it('removes compressed ancillary profiles before native decoding', async () => {
    const png = createCanvas(2, 2).toBuffer('image/png')
    const profile = Buffer.alloc(28)
    profile.writeUInt32BE(16, 0)
    profile.write('iCCP', 4)
    profile.write('untrusted profile', 8)
    const bytes = Buffer.concat([png.subarray(0, 33), profile, png.subarray(33)])
    const result = await sanitizeAssistantImage(`data:image/png;base64,${bytes.toString('base64')}`)
    expect(Buffer.from(result.split(',')[1]!, 'base64').includes(Buffer.from('untrusted'))).toBe(false)
  })
})
