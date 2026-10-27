import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TouchReaction } from '../../../public/desktop-assistant-play.js'
import { parseTouchPlayCommand, parseTouchPlayState } from '../src/main/assistant-play.js'

const { Play, catalog: runtimeCatalog } = new Function(readFileSync(new URL('../../../public/desktop-assistant-play.js', import.meta.url), 'utf8').replace(/export /g, '') + '; return { Play: AssistantPlay, catalog: TOUCH_REACTIONS }')()
const catalog = runtimeCatalog as TouchReaction[]
afterEach(() => vi.restoreAllMocks())
function setup() {
  let now = 0, seed = 431
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }
  const play = new Play({}, () => now, random)
  const advance = (ms: number) => { now += ms; play.tick() }
  return { play, advance }
}

describe('Touch personality and finite cosmetic scenes', () => {
  it('provides 61 named scenes across all interactions and finishes every manual scene', () => {
    expect(catalog).toHaveLength(61)
    expect(new Set(catalog.map(item => item.id)).size).toBe(61)
    expect(new Set(catalog.map(item => item.name)).size).toBe(61)
    expect(new Set(catalog.map(item => item.group)).size).toBe(8)
    const { play, advance } = setup()
    for (const scene of catalog) {
      expect(play.start(scene.id, true)).toBe(true)
      advance(scene.duration + 1)
      expect(play.animating).toBe(false)
      expect(play.sequence).toBeNull()
      expect(play.history.length).toBeLessThanOrEqual(8)
    }
  })
  it('escalates the nine deliberate click reactions, reaches anger, then calms without interaction', () => {
    const { play, advance } = setup(), seen = [], moods = new Set()
    for (let i = 0; i < 12; i++) {
      play.tap(); seen.push(play.scene.definition.id); moods.add(play.mood); advance(800)
    }
    expect(seen.slice(0, 9)).toEqual(['grin', 'double-take', 'furrow', 'grumble', 'tomato', 'stomp', 'foam-bat', 'enough-sign', 'sulk'])
    expect(moods).toEqual(new Set(['happy', 'surprised', 'bothered', 'angry']))
    advance(30_000)
    expect(play.mood).toBe('happy')
    expect(play.score).toBe(0)
  })
  it('plays the complete fast-click sequence and breathing recovery without growing queues or timers', () => {
    const timeout = vi.spyOn(globalThis, 'setTimeout'), interval = vi.spyOn(globalThis, 'setInterval')
    const { play, advance } = setup(), events: unknown[] = []
    play.onChange = (state: unknown) => events.push(state)
    for (let i = 0; i < 10_000; i++) play.tap()
    expect(play.score).toBe(100)
    expect(play.taps.length).toBeLessThanOrEqual(16)
    expect(play.history.length).toBeLessThanOrEqual(8)
    expect(play.sequence.ids).toHaveLength(6)
    const seen = []
    while (play.scene) { seen.push(play.scene.definition.id); advance(play.scene.definition.duration + 1) }
    expect(seen).toEqual(['eye-twitch', 'rattle', 'steam', 'puff-up', 'tantrum', 'breathe'])
    expect(events.length).toBeLessThan(30)
    expect(timeout).not.toHaveBeenCalled(); expect(interval).not.toHaveBeenCalled()
  })
  it('continues varying angry reactions after the nine-step escalation instead of repeating sulking forever', () => {
    const { play, advance } = setup(), previous: string[] = [], seen = new Set()
    for (let i = 0; i < 60; i++) {
      play.tap()
      const id = play.scene.definition.id
      if (i >= 9) {
        expect(previous.slice(-4)).not.toContain(id)
        expect(id).not.toBe('grin'); expect(id).not.toBe('double-take')
        seen.add(id)
      }
      previous.push(id); advance(600)
    }
    expect(seen.size).toBeGreaterThanOrEqual(5)
    expect(play.history.length).toBeLessThanOrEqual(8)
  })
  it('distinguishes five hold phases and does not restart a phase on each frame', () => {
    const { play, advance } = setup(), seen = []
    for (const elapsed of [700, 1900, 3600, 5600, 8100]) {
      advance(100); play.hold(elapsed); seen.push(play.scene.definition.id)
      const started = play.scene.started
      for (let i = 0; i < 20; i++) play.hold(elapsed)
      expect(play.scene.started).toBe(started)
    }
    expect(seen).toEqual(['bored', 'eye-roll', 'pout', 'escape', 'nap'])
  })
  it('varies drag and landing scenes, throttles drag changes and lets a new drag interrupt a tantrum', () => {
    const { play, advance } = setup(), seen = new Set()
    for (let i = 0; i < 20; i++) {
      play.drag(); seen.add(play.scene.definition.id)
      const started = play.scene.started
      play.drag(); expect(play.scene.started).toBe(started)
      advance(1900)
    }
    expect(seen.size).toBe(7)
    play.drop(); expect(play.scene.definition.group).toBe('land')
    for (let i = 0; i < 6; i++) play.tap()
    expect(play.sequence).not.toBeNull()
    advance(1900); play.drag()
    expect(play.sequence).toBeNull(); expect(play.scene.definition.group).toBe('drag')
  })
  it('separates shaking from the nine-step fall, faint, recovery and angry-look story', () => {
    const { play, advance } = setup(), seen = []
    play.shake()
    while (play.scene) { seen.push(play.scene.definition.id); advance(play.scene.definition.duration + 1) }
    play.recover()
    while (play.scene) { seen.push(play.scene.definition.id); advance(play.scene.definition.duration + 1) }
    expect(seen).toEqual(['dizzy-spin', 'spiral-stare', 'orbit-stars', 'queasy', 'wobble', 'trip', 'faint', 'revive', 'glare'])
  })
  it('weights rare surprises below everyday activities and avoids the last four automatic choices', () => {
    const { play } = setup()
    const seen = new Set(), previous: string[] = []
    let rare = 0
    for (let i = 0; i < 3000; i++) {
      const id = play.pick(), definition = catalog.find(item => item.id === id)!
      expect(previous.slice(-4)).not.toContain(id)
      if (definition.group === 'rare') rare++
      seen.add(id); previous.push(id); play.start(id)
    }
    expect(seen.size).toBe(22)
    expect(rare / 3000).toBeGreaterThan(.03); expect(rare / 3000).toBeLessThan(.2)
    expect(play.history.length).toBeLessThanOrEqual(8)
  })
  it('supports calm, stop, pause and explicit resume, and reduced motion overrides manual play', () => {
    const { play } = setup()
    for (let i = 0; i < 10; i++) play.tap()
    play.control({ type: 'calm' })
    expect(play.mood).toBe('happy'); expect(play.scene.definition.id).toBe('breathe'); expect(play.sequence).toBeNull()
    play.control({ type: 'stop' }); expect(play.animating).toBe(false)
    play.control({ type: 'pause' }); play.tap(); play.idle(); expect(play.animating).toBe(false)
    expect(play.control({ type: 'play', id: 'unknown-scene' })).toBe(false); expect(play.paused).toBe(true)
    expect(play.control({ type: 'play', id: 'magic' })).toBe(true); expect(play.paused).toBe(false)
    play.setReduced(true)
    expect(play.animating).toBe(false); expect(play.control({ type: 'play', id: 'magic' })).toBe(false)
    play.setReduced(false); expect(play.control({ type: 'play', id: 'magic' })).toBe(true)
    play.reset(); expect(play.scene).toBeNull(); expect(play.sequence).toBeNull(); expect(play.taps).toHaveLength(0)
  })
  it('publishes only state transitions rather than sending state on each animation frame', () => {
    const { play, advance } = setup(), changed = vi.fn()
    play.onChange = changed; play.tick()
    for (let i = 0; i < 240; i++) advance(16)
    expect(changed).toHaveBeenCalledTimes(1)
    play.start('magic')
    for (let i = 0; i < 120; i++) advance(16)
    expect(changed).toHaveBeenCalledTimes(2)
  })
  it('restores personal eyes, skin and all temporary face changes even if drawing fails', () => {
    const bot = { ox: 0, oy: 0, tilt: 0, yaw: .1, pitch: .2, blush: .3, open: .8, eyeOverride: 'wink', eyeOverrideUntil: 7, eyeColor: '#cc2277', bodyColor: [.1, .2, .3], skin: {} }
    const before = { ...bot }
    let now = 0
    const play = new Play(bot, () => now, () => .5)
    play.start('tomato'); now = 500
    const context = { save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(), scale: vi.fn() }
    expect(() => play.draw(context, 120, 120, () => { throw new Error('drawing interrupted') })).toThrow('drawing interrupted')
    expect(bot).toEqual(before); expect(bot.bodyColor).toBe(before.bodyColor); expect(bot.skin).toBe(before.skin)
    expect(context.restore).toHaveBeenCalledOnce()
  })
})

describe('cosmetic IPC boundaries', () => {
  it('accepts only bounded commands and reconstructs safe values', () => {
    for (const type of ['calm', 'stop', 'pause', 'resume', 'sleep', 'wake']) expect(parseTouchPlayCommand({ type })).toEqual({ type })
    expect(parseTouchPlayCommand({ type: 'play', id: 'foam-bat' })).toEqual({ type: 'play', id: 'foam-bat' })
    for (const value of [null, [], { type: 'eval' }, { type: 'pause', id: 'x' }, { type: 'play', id: '../file' }, { type: 'play', id: 'x'.repeat(49) }, { type: 'play', id: '__proto__' }, { type: 'play', id: 'magic', url: 'https://example.test' }]) expect(parseTouchPlayCommand(value)).toBeUndefined()
  })
  it('accepts only valid cosmetic state and drops extra data from the renderer', () => {
    const state = { mood: 'angry', reaction: 'steam', paused: false, reducedMotion: false, sleeping: false }
    expect(parseTouchPlayState({ ...state, privateData: 'never forwarded' })).toEqual(state)
    for (const value of [null, [], { ...state, mood: {} }, { ...state, reaction: 'file://secret' }, { ...state, paused: 1 }, { ...state, reducedMotion: undefined }]) expect(parseTouchPlayState(value)).toBeUndefined()
  })
})
