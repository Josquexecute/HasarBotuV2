// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { URL as NodeURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'

const source = readFileSync(new NodeURL('../../../public/desktop-assistant-character.js', import.meta.url), 'utf8').replace(/^import .*\r?\n/gm, '')
const motionSource = readFileSync(new NodeURL('../../../public/desktop-assistant-motion.js', import.meta.url), 'utf8').replace(/^import .*\r?\n/gm, '').replace('export class', 'class')
const Play = new Function(readFileSync(new NodeURL('../../../public/desktop-assistant-play.js', import.meta.url), 'utf8').replace(/export /g, '') + '; return AssistantPlay')()
const appearanceSource = readFileSync(new NodeURL('../../../public/desktop-assistant-appearance.js', import.meta.url), 'utf8').replace(/^import .*\r?\n/gm, '').replace(/export /g, '')
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

function setup() {
  vi.useFakeTimers()
  const doc = document.implementation.createHTMLDocument()
  doc.body.innerHTML = '<button id="assistant"><canvas id="mochi"></canvas></button>'
  let hidden = false
  Object.defineProperty(doc, 'hidden', { get: () => hidden })
  const canvas = doc.querySelector('canvas')!
  const measure = vi.fn(() => 120)
  Object.defineProperty(canvas, 'clientWidth', { get: measure })
  const stops = vi.fn()
  const gradient = { addColorStop: stops }
  const context = { createRadialGradient: vi.fn(() => gradient), fillRect: vi.fn(), setTransform: vi.fn(), clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(), beginPath: vi.fn(), roundRect: vi.fn(), fill: vi.fn(), stroke: vi.fn(), drawImage: vi.fn(), fillStyle: '', strokeStyle: '', globalAlpha: 1,
    moveTo: vi.fn(), lineTo: vi.fn(), quadraticCurveTo: vi.fn(), bezierCurveTo: vi.fn(), arc: vi.fn(), ellipse: vi.fn(), closePath: vi.fn(), setLineDash: vi.fn(), fillText: vi.fn() }
  canvas.getContext = vi.fn(() => context) as unknown as typeof canvas.getContext
  const engines: Engine[] = []
  class Engine {
    busy = false
    lookX = 0
    lookY = 0
    ox = 0
    oy = 0
    tilt = 0
    sx = 1
    sy = 1
    eyeColor = '#111111'
    yaw = 0
    pitch = 0
    blush = 0
    open = 1
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
  let appearance: (value: { characterColor: string; accentColor: string; reduceMotion: boolean; customImage?: string; eyeColor?: string | null }) => void = () => {}
  let motionEvent: (value: { type: string; x?: number; active?: boolean; dx?: number; dy?: number; elapsed?: number }) => void = () => {}
  let playControl: (value: { type: string; id?: string }) => void = () => {}
  const playState = vi.fn()
  const unsubscribe = vi.fn()
  const frames = new Map<number, FrameRequestCallback>()
  let nextFrame = 0, now = 0
  const motion = Object.assign(new EventTarget(), { matches: false })
  const target = Object.assign(new EventTarget(), {
    hasarbotuAssistant: {
      onGaze: (callback: typeof gaze) => { gaze = callback; return unsubscribe },
      onAppearance: (callback: typeof appearance) => { appearance = callback; return unsubscribe },
      onMotion: (callback: typeof motionEvent) => { motionEvent = callback; return unsubscribe },
      onPlay: (callback: typeof playControl) => { playControl = callback; return unsubscribe },
      playState,
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
  const Motion = new Function('performance', 'AssistantPlay', motionSource + '; return AssistantMotion')(timing, Play)
  const drawAppearance = new Function('BotEngine', appearanceSource + '; return drawAssistantAppearance')(Engine)
  const eyeColor = new Function('BotEngine', appearanceSource + '; return assistantEyeColor')(Engine)
  new Function('BotEngine', 'AssistantMotion', 'drawAssistantAppearance', 'assistantEyeColor', 'window', 'document', 'ResizeObserver', 'performance', source)(Engine, Motion, drawAppearance, eyeColor, target, doc, Observer, timing)
  const step = (ms = 20) => {
    now += ms
    const pending = [...frames.values()]
    frames.clear()
    pending.forEach(callback => callback(now))
  }
  const setAppearance = (reduceMotion: boolean, customImage?: string, eyeColor?: string | null) => appearance({ characterColor: '#ffffff', accentColor: '#2563eb', reduceMotion, ...(customImage ? { customImage } : {}), ...(eyeColor !== undefined ? { eyeColor } : {}) })
  return { doc, canvas, context, measure, engines, target, frames, step, gaze: (x: number, y: number) => gaze({ x, y }), setAppearance, unsubscribe, motionEvent, playState, playControl: (type: string, id?: string) => playControl({ type, ...(id ? { id } : {}) }),
    hide: (value: boolean) => { hidden = value; doc.dispatchEvent(new Event('visibilitychange')) },
    resize: () => resize([], {} as ResizeObserver),
  }
}

it('holds cursor gaze through an entire scene and resumes from the latest point without another IPC event', () => {
  const ui = setup(), bot = ui.engines[0]
  ui.gaze(.8, -.6); ui.step()
  expect(bot.lookX).toBe(.8)
  ui.playControl('play', 'reading')
  ui.gaze(-.9, .7); ui.step(300)
  expect(bot.lookX).toBe(0); expect(bot.lookY).toBe(0)
  ui.step(600)
  expect(bot.lookX).toBe(0)
  ui.playControl('play', 'magic'); ui.step(300)
  expect(bot.lookX).toBe(0)
  ui.step(4000); ui.step()
  expect(bot.lookX).toBe(-.9); expect(bot.lookY).toBe(-.7)
  ui.target.dispatchEvent(new Event('pagehide'))
})

it('applies selected eyes to animated and reduced-motion engines immediately and restores automatic contrast', () => {
  const ui = setup()
  for (const color of ['#ffffff', '#000000', '#22cc88', '#ffff00']) {
    ui.setAppearance(false, undefined, color)
    expect(ui.engines.map(bot => bot.eyeColor)).toEqual([color, color])
    ui.setAppearance(true, undefined, color)
    expect(ui.engines.map(bot => bot.eyeColor)).toEqual([color, color])
  }
  ui.setAppearance(true, undefined, null)
  expect(ui.engines.map(bot => bot.eyeColor)).toEqual(['#111111', '#111111'])
  ui.target.dispatchEvent(new Event('pagehide'))
})

it('manual scenes keep drawing on settled engines and stop cleanly on pause or reduced motion', () => {
  const ui = setup()
  ui.step()
  ui.playControl('play', 'magic')
  expect(ui.playState).toHaveBeenLastCalledWith(expect.objectContaining({ reaction: 'magic', paused: false }))
  const before = ui.engines[0].draw.mock.calls.length
  ui.step(100); ui.step(100)
  expect(ui.engines[0].draw.mock.calls.length).toBeGreaterThan(before)
  expect(ui.frames.size).toBe(1)
  ui.playControl('pause')
  expect(ui.playState).toHaveBeenLastCalledWith(expect.objectContaining({ reaction: null, paused: true }))
  expect(ui.frames.size).toBe(0); expect(vi.getTimerCount()).toBe(0)
  ui.playControl('play', 'reading')
  expect(ui.playState).toHaveBeenLastCalledWith(expect.objectContaining({ reaction: 'reading', paused: false }))
  ui.setAppearance(true)
  ui.playControl('play', 'steam')
  expect(ui.playState).toHaveBeenLastCalledWith(expect.objectContaining({ reaction: null, reducedMotion: true }))
  expect(ui.frames.size).toBe(0)
  ui.target.dispatchEvent(new Event('pagehide'))
  expect(vi.getTimerCount()).toBe(0)
})

it('draws accent only as a soft halo behind the original character', () => {
  const ui = setup()
  ui.setAppearance(true)
  expect(ui.context.createRadialGradient).toHaveBeenCalled()
  expect(ui.context.fillRect).toHaveBeenCalledWith(0, 0, 120, 120)
  expect(ui.context.roundRect).not.toHaveBeenCalled()
  expect(ui.context.stroke).not.toHaveBeenCalled()
  expect(ui.engines[1].draw).toHaveBeenCalled()
})

it('custom skins keep both original engines drawing and default restoration cancels late image decodes', () => {
  const images: { onload: () => void }[] = []
  vi.stubGlobal('Image', class {
    naturalWidth = 256
    naturalHeight = 128
    onload = () => {}
    constructor() { images.push(this) }
  })
  const ui = setup(), button = ui.doc.querySelector('button')!
  ui.setAppearance(false, 'data:image/png;base64,one')
  ui.engines[0].draw.mockClear()
  images[0].onload()
  expect(button.dataset.customImage).toBe('true')
  expect(ui.engines[0].draw).toHaveBeenCalled()
  ui.setAppearance(false, 'data:image/png;base64,one', '#22cc88')
  expect(images).toHaveLength(1)
  expect(button.dataset.customImage).toBe('true')
  ui.setAppearance(true, 'data:image/png;base64,two')
  ui.engines[1].draw.mockClear()
  images[1].onload()
  expect(ui.engines[1].draw).toHaveBeenCalled()
  ui.setAppearance(false, 'data:image/png;base64,late')
  ui.setAppearance(false)
  images[2].onload()
  expect(button.dataset.customImage).toBe('false')
  ui.target.dispatchEvent(new Event('pagehide'))
})

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
  ui.step()
  expect(ui.engines[0].lookX).toBe(0)
  ui.motionEvent({ type: 'release' })
  ui.step(1500)
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
  expect(ui.unsubscribe).toHaveBeenCalledTimes(4)
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

it('shake samples reach the motion engine, while reduced motion, hiding and disposal cancel their effects', () => {
  const ui = setup()
  const bot = ui.engines[0] as typeof ui.engines[0] & { nausea: number }
  ui.doc.querySelector('button')!.dispatchEvent(new MouseEvent('pointerdown', { button: 0 }))
  for (let i = 1; i <= 8; i++) {
    ui.motionEvent({ type: 'drag', x: i % 2 ? 1 : -1, dx: i % 2 ? 70 : -70, dy: 0, elapsed: i * 40 })
    ui.step(40)
  }
  expect(bot.anim).toHaveBeenCalledWith('nausea', expect.arrayContaining([expect.arrayContaining([.8, 280])]))
  ui.motionEvent({ type: 'release' })
  ui.setAppearance(true)
  expect(bot.nausea).toBe(0)
  expect(ui.frames.size).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
  bot.anim.mockClear()
  ui.motionEvent({ type: 'drag', x: 1, dx: 100, dy: 0, elapsed: 400 })
  expect(bot.anim).not.toHaveBeenCalled()
  ui.setAppearance(false)
  ui.hide(true)
  expect(ui.frames.size).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
  ui.target.dispatchEvent(new Event('pagehide'))
  ui.motionEvent({ type: 'drag', x: -1, dx: -100, dy: 0, elapsed: 500 })
  expect(ui.frames.size).toBe(0)
})
