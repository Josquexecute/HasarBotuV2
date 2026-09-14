// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { URL as NodeURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

const source = readFileSync(new NodeURL('../../../public/desktop-assistant.js', import.meta.url), 'utf8')

function setup(available = true) {
  const doc = document.implementation.createHTMLDocument()
  doc.body.innerHTML = '<button id="assistant" disabled>Yardımcı</button>'
  const button = doc.querySelector('button')!
  button.setPointerCapture = vi.fn()
  const api = { press: vi.fn(), drag: vi.fn(), release: vi.fn(), cancel: vi.fn(), menu: vi.fn(), move: vi.fn() }
  const target = Object.assign(new EventTarget(), { hasarbotuAssistant: available ? api : undefined })
  // Evaluate the shipped, dependency-free renderer in an isolated DOM per test.
  new Function('window', 'document', source)(target, doc)
  const pointer = (type: string, pointerId = 1, mouseButton = 0) => {
    const event = new MouseEvent(type, { button: mouseButton })
    Object.defineProperty(event, 'pointerId', { value: pointerId })
    button.dispatchEvent(event)
  }
  return { button, api, target, pointer }
}

describe('assistant renderer input', () => {
  it('appears unavailable in a regular browser', () => { expect(setup(false).button.disabled).toBe(true) })
  it('captures the active pointer and releases without an extra click menu', () => {
    const { button, api, pointer } = setup()
    pointer('pointerdown'); pointer('pointermove'); pointer('pointerup')
    button.dispatchEvent(new MouseEvent('click', { detail: 1 }))
    expect(button.setPointerCapture).toHaveBeenCalledWith(1)
    expect(api.press).toHaveBeenCalledOnce()
    expect(api.drag).toHaveBeenCalledOnce()
    expect(api.release).toHaveBeenCalledOnce()
    expect(api.menu).not.toHaveBeenCalled()
  })
  it('ignores secondary pointers and the right mouse button', () => {
    const { api, pointer } = setup()
    pointer('pointerdown', 1, 2)
    expect(api.press).not.toHaveBeenCalled()
    pointer('pointerdown', 1); pointer('pointerdown', 2); pointer('pointermove', 2); pointer('pointerup', 2)
    expect(api.press).toHaveBeenCalledOnce()
    expect(api.drag).not.toHaveBeenCalled()
    expect(api.release).not.toHaveBeenCalled()
    pointer('pointerup', 1)
    expect(api.release).toHaveBeenCalledOnce()
  })
  it.each(['pointercancel', 'lostpointercapture'])('cancels capture on %s', (event) => {
    const { api, pointer } = setup()
    pointer('pointerdown'); pointer(event); pointer('pointermove'); pointer('pointerup')
    expect(api.cancel).toHaveBeenCalledOnce()
    expect(api.drag).not.toHaveBeenCalled()
    expect(api.release).not.toHaveBeenCalled()
  })
  it('cancels a drag when another app takes focus', () => {
    const { api, target, pointer } = setup()
    pointer('pointerdown'); target.dispatchEvent(new Event('blur')); pointer('pointerup')
    expect(api.cancel).toHaveBeenCalledOnce()
    expect(api.release).not.toHaveBeenCalled()
  })
  it('supports accessible activation, context menu and keyboard movement', () => {
    const { button, api } = setup()
    button.click()
    button.dispatchEvent(new MouseEvent('contextmenu'))
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(api.menu).toHaveBeenCalledTimes(2)
    expect(api.move).toHaveBeenCalledWith('left')
    expect(api.cancel).toHaveBeenCalledOnce()
  })
})
