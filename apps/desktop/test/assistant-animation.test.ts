// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { URL as NodeURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'

const source = readFileSync(new NodeURL('../../../public/desktop-assistant-character.js', import.meta.url), 'utf8').replace(/^import .*\r?\n/gm, '')
const motionSource = readFileSync(new NodeURL('../../../public/desktop-assistant-motion.js', import.meta.url), 'utf8').replace('export class', 'class')
afterEach(() => vi.useRealTimers())

function setup() {
  vi.useFakeTimers()
  const doc = document.implementation.createHTMLDocument()
  doc.body.innerHTML = '<button id="assistant"><canvas id="mochi"></canvas></button>'
  let hidden = false
  Object.defineProperty(doc, 'hidden', { get: () => hidden })
  const canvas = doc.querySelector('canvas')!
  const measure = vi.fn(() => 120)
  Object.defineProperty(canvas, 'clientWidth', { get: measure })
  const context = { setTransform: vi.fn(), clearRect: vi.fn() }
  canvas.getContext = vi.fn(() => context) as unknown as typeof canvas.getContext
  const engines: Engine[] = []
  class Engine {
    busy = false
    lookX = 0
    lookY = 0
    tweens = new Map()
    locks = new Set()
    anim = vi.fn()
    interruptGreet = vi.fn()
    draw = vi.fn()
    update = vi.fn(() => { if (this.lookX || this.lookY) this.busy = true })
    greet = vi.fn()
    triggerEmote = vi.fn(() => { this.busy = true })
    squash = vi.fn(() => { this.busy = true })
    constructor() { engines.push(this) }
  }
  let gaze: (point: { x: number; y: number }) => void = () => {}
  let appearance: (value: { characterColor: string; accentColor: string; reduceMotion: boolean }) => void = () => {}
  let motionEvent: (value: { type: string; x?: number; active?: boolean }) => void = () => {}
  const unsubscribe = vi.fn()
  const frames = new Map<number, FrameRequestCallback>()
  let nextFrame = 0, now = 0
  const motion = Object.assign(new EventTarget(), { matches: false })
  const target = Object.assign(new EventTarget(), {
    hasarbotuAssistant: {
      onGaze: (callback: typeof gaze) => { gaze = callback; return unsubscribe },
      onAppearance: (callback: typeof appearance) => { appearance = callback; return unsubscribe },
      onMotion: (callback: typeof motionEvent) => { motionEvent = callback; return unsubscribe },
    },
    matchMedia: () => motion,
    devicePixelRatio: 1,
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    setTimeout, clearTimeout,
  })
  let resize: ResizeObserverCallback = () => {}
  class Observer {
    observe = vi.fn()
    disconnect = vi.fn()
    constructor(callback: ResizeObserverCallback) { resize = callback }
  }
  const timing = { now: () => now }
  const Motion = new Function('performance', motionSource + '; return AssistantMotion')(timing)
  new Function('BotEngine', 'AssistantMotion', 'window', 'document', 'ResizeObserver', 'performance', source)(Engine, Motion, target, doc, Observer, timing)
  const step = (ms = 20) => {
    now += ms
    const pending = [...frames.values()]
    frames.clear()
    pending.forEach(callback => callback(now))
  }
  const setAppearance = (reduceMotion: boolean) => appearance({ characterColor: '#ffffff', accentColor: '#2563eb', reduceMotion })
  return { doc, canvas, measure, engines, target, frames, step, gaze: (x: number, y: number) => gaze({ x, y }), setAppearance, unsubscribe, motionEvent,
    hide: (value: boolean) => { hidden = value; doc.dispatchEvent(new Event('visibilitychange')) },
    resize: () => resize([], {} as ResizeObserver),
  }
}

it('ignores gaze, hover and background feedback while asleep and wakes only on a press', () => {
  const ui = setup()
  ui.step(124000)
  const button = ui.doc.querySelector('button')!
  expect(button.dataset.sleeping).toBe('true')
  ui.gaze(1,1)
  button.dispatchEvent(new Event('pointerenter'))
  vi.advanceTimersByTime(650)
  ui.motionEvent({ type: 'notification' })
  ui.step()
  expect(button.dataset.sleeping).toBe('true')
  expect(ui.engines[0].lookX).toBe(0)
  expect(ui.engines[0].lookY).toBe(0)
  expect(ui.engines[0].triggerEmote).not.toHaveBeenCalled()
  ui.hide(true)
  ui.hide(false)
  ui.setAppearance(true)
  expect(button.dataset.sleeping).toBe('true')
  ui.setAppearance(false)
  button.dispatchEvent(new MouseEvent('pointerdown',{ button: 0 }))
  expect(button.dataset.sleeping).toBe('false')
  ui.gaze(.5,.5)
  expect(ui.engines[0].lookX).toBe(.5)
  ui.target.dispatchEvent(new Event('pagehide'))
})

it('settled poses sleep between engine checks and do not redraw unchanged pixels', () => {
  const ui = setup()
  ui.step()
  const draws = ui.engines[0].draw.mock.calls.length
  expect(ui.frames.size).toBe(0)
  for (let tick = 0; tick < 8; tick++) { vi.advanceTimersByTime(125); expect(ui.frames.size).toBe(1); ui.step(125) }
  expect(ui.frames.size).toBe(0)
  expect(ui.engines[0].draw).toHaveBeenCalledTimes(draws)
  expect(vi.getTimerCount()).toBe(1)
})

it('changed gaze wakes immediately and draws active motion without waiting for idle checks', () => {
  const ui = setup()
  ui.step()
  ui.gaze(.5, .4)
  expect(ui.frames.size).toBe(1)
  expect(vi.getTimerCount()).toBe(0)
  ui.step()
  expect(ui.engines[0].lookY).toBe(-.4)
  expect(ui.engines[0].draw).toHaveBeenCalledTimes(2)
  expect(ui.frames.size).toBe(1)
})

it('internal delayed emotes are detected without a permanent display-frame loop', () => {
  const ui = setup()
  ui.step()
  ui.engines[0].busy = true
  vi.advanceTimersByTime(125)
  ui.step()
  expect(ui.engines[0].draw).toHaveBeenCalledTimes(2)
  expect(ui.frames.size).toBe(1)
})

it('expired facial expressions redraw even after body movement has settled', () => {
  const ui = setup()
  ui.step()
  const engine = ui.engines[0] as typeof ui.engines[0] & { eyeOverride: string | null }
  engine.eyeOverride = 'happy'
  engine.update.mockImplementationOnce(() => { engine.eyeOverride = null })
  vi.advanceTimersByTime(125)
  ui.step(125)
  expect(engine.draw).toHaveBeenCalledTimes(2)
  expect(ui.frames.size).toBe(0)
})

it.each([60, 144])('keeps active drawing near 60 fps on a %i Hz display without fractional timestamp drift', refreshRate => {
  const ui = setup()
  ui.gaze(1, 1)
  const initial = ui.engines[0].draw.mock.calls.length
  for (let frame = 0; frame < refreshRate; frame++) ui.step(1000 / refreshRate)
  const drawn = ui.engines[0].draw.mock.calls.length - initial
  expect(drawn).toBeGreaterThanOrEqual(59)
  expect(drawn).toBeLessThanOrEqual(61)
})

it('hidden and reduced-motion characters stop timers and frames; the neutral pose remains visible', () => {
  const ui = setup()
  ui.step()
  ui.hide(true)
  expect(vi.getTimerCount()).toBe(0)
  ui.gaze(1, 1)
  expect(ui.frames.size).toBe(0)
  ui.hide(false)
  expect(ui.frames.size).toBe(1)
  ui.setAppearance(true)
  expect(ui.frames.size).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
  expect(ui.engines[1].draw).toHaveBeenCalled()
  ui.setAppearance(false)
  expect(ui.frames.size).toBe(1)
})

it('press and hover wake a settled character; disposal removes subscriptions and pending work', () => {
  const ui = setup()
  ui.step()
  const button = ui.doc.querySelector('button')!
  button.dispatchEvent(new MouseEvent('pointerdown', { button: 0 }))
  expect(ui.engines[0].interruptGreet).toHaveBeenCalled()
  expect(ui.frames.size).toBe(1)
  ui.engines[0].busy = false
  ui.motionEvent({ type: 'release' })
  ui.step(1100)
  button.dispatchEvent(new Event('pointerenter'))
  vi.advanceTimersByTime(650)
  expect(ui.engines[0].triggerEmote).toHaveBeenCalledWith('happy', .9)
  ui.target.dispatchEvent(new Event('pagehide'))
  expect(ui.unsubscribe).toHaveBeenCalledTimes(3)
  expect(ui.frames.size).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
  ui.gaze(1, 1)
  expect(ui.frames.size).toBe(0)
  ui.motionEvent({ type: 'success' })
  expect(ui.frames.size).toBe(0)
})

it('success wakes a settled character but hidden and reduced-motion feedback is discarded', () => {
  const ui = setup()
  ui.step()
  ui.motionEvent({ type: 'success' })
  expect(ui.engines[0].triggerEmote).toHaveBeenCalledWith('happy', 1.2)
  expect(ui.frames.size).toBe(1)
  ui.hide(true)
  ui.motionEvent({ type: 'success' })
  ui.doc.querySelector('button')!.dispatchEvent(new Event('pointerenter'))
  expect(ui.frames.size).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
  ui.hide(false)
  ui.setAppearance(true)
  ui.motionEvent({ type: 'success' })
  expect(ui.engines[0].triggerEmote).toHaveBeenCalledTimes(1)
  expect(ui.frames.size).toBe(0)
})

it('keyboard activation gets one reaction while a pointer click does not add a second reaction', () => {
  const ui = setup()
  ui.step()
  const button = ui.doc.querySelector('button')!
  const interrupt = ui.engines[0].interruptGreet
  button.click()
  expect(interrupt).toHaveBeenCalledOnce()
  expect(ui.frames.size).toBe(1)
  button.dispatchEvent(new MouseEvent('click', { detail: 1 }))
  expect(interrupt).toHaveBeenCalledOnce()
  ui.setAppearance(true)
  button.click()
  expect(ui.frames.size).toBe(0)
})

it('animation uses cached layout dimensions and updates physical pixels on monitor resize', () => {
  const ui = setup()
  ui.gaze(1, 1)
  ui.step(); ui.step(); ui.step()
  expect(ui.measure).toHaveBeenCalledOnce()
  ui.target.devicePixelRatio = 2
  ui.resize()
  expect(ui.measure).toHaveBeenCalledTimes(2)
  expect(ui.canvas.width).toBe(240)
})

it('working state survives reduced motion and visibility; error affordance remains available without animation', () => {
  const ui = setup()
  ui.setAppearance(true)
  ui.motionEvent({ type: 'working', active: true })
  ui.motionEvent({ type: 'error', active: true })
  expect(ui.doc.querySelector('button')!.title).toContain('Açıklama')
  expect(ui.doc.querySelector('button')!.getAttribute('aria-label')).toContain('hatasının açıklamasını')
  expect(ui.frames.size).toBe(0)
  ui.setAppearance(false)
  ui.step(500)
  expect(ui.engines[0].anim).toHaveBeenCalledWith('tilt', expect.any(Array))
  ui.hide(true)
  ui.motionEvent({ type: 'working', active: false })
  ui.hide(false)
  ui.motionEvent({ type: 'error', active: false })
  expect(ui.doc.querySelector('button')!.title).not.toContain('Açıklama')
})
