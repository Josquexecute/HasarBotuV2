import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCanvas } from '@napi-rs/canvas'
import { prepareAssistantTexture } from '../../../public/desktop-assistant-image.js'

afterEach(() => vi.restoreAllMocks())

function texture(width: number, height: number, paint: (context: ReturnType<ReturnType<typeof createCanvas>['getContext']>) => void) {
  const image = createCanvas(width, height)
  paint(image.getContext('2d'))
  const create = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((name, options) => name === 'canvas'
    ? createCanvas(1, 1) as unknown as HTMLCanvasElement : create(name, options))
  return prepareAssistantTexture(image as unknown as HTMLCanvasElement)
}

function bounds(canvas: HTMLCanvasElement) {
  const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
  let left = canvas.width, top = canvas.height, right = -1, bottom = -1, outside = 0
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    if (pixels[(y * canvas.width + x) * 4 + 3] < 24) continue
    left = Math.min(left, x); right = Math.max(right, x)
    top = Math.min(top, y); bottom = Math.max(bottom, y)
    if ((Math.abs((x + .5) / canvas.width * 2 - 1) ** 2.7 + Math.abs((y + .5) / canvas.height * 2 - 1) ** 2.7) > 1) outside++
  }
  return { left, top, right, bottom, outside }
}

describe('automatic Touch skin placement', () => {
  it.each(['transparent', 'black', 'white'])('fits a padded off-center round skin to the entire body on %s', backdrop => {
    const skin = texture(600, 400, context => {
      if (backdrop !== 'transparent') { context.fillStyle = backdrop; context.fillRect(0, 0, 600, 400) }
      context.fillStyle = '#e53935'; context.beginPath(); context.arc(420, 130, 65, 0, Math.PI * 2); context.fill()
      context.fillStyle = '#ffd600'; context.fillRect(395, 100, 50, 50)
    })
    const b = bounds(skin)
    expect(Math.abs((b.left + b.right + 1) / 2 - skin.width / 2)).toBeLessThan(2)
    expect(Math.abs((b.top + b.bottom + 1) / 2 - skin.height / 2)).toBeLessThan(2)
    expect((b.bottom - b.top) / skin.height).toBeGreaterThan(.97)
    expect((b.right - b.left) / skin.width).toBeGreaterThan(.97)
    expect(b.outside).toBe(0)
    // The old contain fit left the body exposed on both sides of round logos.
    const context = skin.getContext('2d')!
    for (const x of [8, skin.width - 9]) {
      const pixel = context.getImageData(x, skin.height / 2, 1, 1).data
      expect(pixel[3]).toBe(255)
      expect(pixel[0]).toBeGreaterThan(200)
    }
  })

  it.each([[70, 260], [260, 70]])('fits a transparent %ix%i figure inside the rounded body without distortion', (width, height) => {
    const skin = texture(500, 500, context => { context.fillStyle = '#e53935'; context.fillRect(30, 100, width, height) })
    const b = bounds(skin)
    expect(b.outside).toBe(0)
    expect(Math.abs((b.right - b.left + 1) / (b.bottom - b.top + 1) - width / height)).toBeLessThan(.05)
    expect(Math.max((b.right - b.left) / skin.width, (b.bottom - b.top) / skin.height)).toBeGreaterThan(.85)
  })

  it('finds the emblem inside a black panel on a light export canvas, ignoring detached specks', () => {
    const skin = texture(400, 400, context => {
      context.fillStyle = '#f5f7fa'; context.fillRect(0, 0, 400, 400)
      context.fillStyle = '#000'; context.fillRect(180, 60, 140, 140)
      context.fillStyle = '#e53935'; context.beginPath(); context.arc(250, 130, 60, 0, Math.PI * 2); context.fill()
      context.fillStyle = '#ffd600'; context.fillRect(225, 100, 50, 50)
      context.fillStyle = '#001c58'; context.fillRect(1, 398, 1, 1)
    })
    const b = bounds(skin)
    expect(b.outside).toBe(0)
    expect((b.bottom - b.top) / skin.height).toBeGreaterThan(.97)
    expect((b.right - b.left) / skin.width).toBeGreaterThan(.97)
    expect(skin.getContext('2d')!.getImageData(0, 0, 1, 1).data[3]).toBe(0)
  })

  it('retains top, bottom and central emblem details when fitting the wider body', () => {
    const skin = texture(400, 400, context => {
      context.fillStyle = '#e53935'; context.beginPath(); context.arc(200, 200, 160, 0, Math.PI * 2); context.fill()
      context.fillStyle = '#ffd600'; context.fillRect(185, 44, 30, 20)
      context.fillStyle = '#001c58'; context.fillRect(185, 336, 30, 20)
      context.fillStyle = '#208040'; context.fillRect(185, 185, 30, 30)
    })
    const context = skin.getContext('2d')!
    expect([...context.getImageData(128, 5, 1, 1).data]).toEqual([255, 214, 0, 255])
    expect([...context.getImageData(128, 192, 1, 1).data]).toEqual([0, 28, 88, 255])
    expect([...context.getImageData(128, 99, 1, 1).data]).toEqual([32, 128, 64, 255])
  })

  it('keeps square artwork and hollow rings in aspect-preserving contain mode', () => {
    for (const hollow of [false, true]) {
      const skin = texture(300, 300, context => {
        context.fillStyle = '#e53935'
        if (hollow) {
          context.beginPath(); context.arc(150, 150, 100, 0, Math.PI * 2); context.fill()
          context.globalCompositeOperation = 'destination-out'
          context.beginPath(); context.arc(150, 150, 80, 0, Math.PI * 2); context.fill()
        } else context.fillRect(50, 50, 200, 200)
      })
      const b = bounds(skin)
      expect(Math.abs((b.right - b.left) / (b.bottom - b.top) - 1)).toBeLessThan(.03)
      expect(skin.getContext('2d')!.getImageData(8, skin.height / 2, 1, 1).data[3]).toBe(0)
    }
  })

  it.each([[80, 320], [320, 80]])('covers the body with an opaque %ix%i photograph', (width, height) => {
    const skin = texture(width, height, context => {
      const gradient = context.createLinearGradient(0, 0, width, height)
      gradient.addColorStop(0, '#c45f32'); gradient.addColorStop(1, '#12667d')
      context.fillStyle = gradient; context.fillRect(0, 0, width, height)
    })
    const pixels = skin.getContext('2d')!.getImageData(0, 0, skin.width, skin.height).data
    expect([...pixels].filter((_, index) => index % 4 === 3).every(alpha => alpha === 255)).toBe(true)
  })
})
