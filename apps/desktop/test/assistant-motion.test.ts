import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'

// Exercise the shipped browser code and actual drawing engine's interpolation.
const read = (path: string) => readFileSync(new URL('../../../public/' + path, import.meta.url), 'utf8')
const helpers = new Function(read('vendor/coucou/core/anim.js').replace(/export /g, '') + '; return { Ease, lerp }')()
const Engine = new Function('Ease', 'lerp', read('vendor/coucou/mochi/engine.js').replace(/^import .*\r?\n/gm, '').replace(/export /g, '') + '; return BotEngine')(helpers.Ease, helpers.lerp)
const Motion = new Function(read('desktop-assistant-motion.js').replace('export class', 'class') + '; return AssistantMotion')()
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

function setup() {
  vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] })
  const bot = new Engine()
  bot.nextBlink = Infinity
  const motion = new Motion(bot, () => performance.now(), () => .5)
  const advance = (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 1000 / 60) {
      vi.advanceTimersByTime(1000 / 60)
      motion.tick()
      bot.update(1 / 60)
    }
  }
  return { bot, motion, advance }
}

it('stretches only after quiet time, returns to rest and leaves no gesture timers or permanent frame work', () => {
  const { bot, motion, advance } = setup()
  advance(59000)
  expect(bot.sy).toBe(1)
  advance(1500)
  expect(bot.sy).toBeGreaterThan(1.02)
  advance(4500)
  expect(bot.sy).toBe(1)
  expect(bot.sx).toBe(1)
  expect(bot.tilt).toBe(0)
  expect(bot.open).toBe(1)
  expect(bot.busy).toBe(false)
  expect(vi.getTimerCount()).toBe(0)
  expect(motion.nextStretch).toBeGreaterThan(performance.now())
})

it('hover and pointer activity suppress the idle stretch', () => {
  const { bot, motion, advance } = setup()
  motion.hovered = true
  advance(65000)
  expect(bot.sy).toBe(1)
  motion.hovered = false
  motion.press()
  advance(65000)
  expect(bot.sy).toBe(1)
  motion.release()
  advance(59000)
  expect(bot.sy).toBe(1)
})

it('curiosity tilts toward the gaze and cannot repeatedly interrupt itself', () => {
  const { bot, motion, advance } = setup()
  bot.lookX = -.5
  motion.curious()
  advance(400)
  expect(bot.tilt).toBeLessThan(-.1)
  const tilt = bot.tilt
  motion.curious()
  expect(bot.tilt).toBe(tilt)
  advance(2000)
  expect(bot.tilt).toBe(0)
  expect(bot.es).toBe(1)
})

it('dragging interrupts a stretch continuously and releasing softly settles every body transform', () => {
  const { bot, motion, advance } = setup()
  advance(60500)
  expect(bot.sy).toBeGreaterThan(1)
  const before = { sy: bot.sy, sx: bot.sx, tilt: bot.tilt }
  motion.drag(-1)
  expect({ sy: bot.sy, sx: bot.sx, tilt: bot.tilt }).toEqual(before)
  advance(150)
  expect(bot.tilt).toBeLessThan(-.12)
  motion.drag(1)
  advance(150)
  expect(bot.tilt).toBeGreaterThan(.12)
  motion.release()
  advance(2000)
  expect(bot.sy).toBe(1)
  expect(bot.sx).toBe(1)
  expect(bot.oy).toBe(0)
  expect(bot.tilt).toBe(0)
  expect(bot.busy).toBe(false)
})

it('success during dragging is coalesced and acknowledged after release with one bounded hop', () => {
  const { bot, motion, advance } = setup()
  const emote = vi.spyOn(bot, 'triggerEmote')
  motion.press()
  motion.drag(1)
  motion.success()
  motion.success()
  expect(emote).not.toHaveBeenCalled()
  motion.release()
  expect(emote).toHaveBeenCalledTimes(1)
  advance(350)
  expect(bot.oy).toBeLessThan(-.1)
  const current = bot.oy
  motion.success()
  expect(bot.oy).toBe(current)
  expect(emote).toHaveBeenCalledTimes(1)
  advance(2000)
  expect(bot.busy).toBe(false)
  expect(bot.oy).toBe(0)
})

it('hiding or reducing motion cancels gestures, pending feedback and delayed greeting effects', () => {
  const { bot, motion, advance } = setup()
  bot.greet()
  motion.press()
  motion.drag(-1)
  motion.success()
  advance(100)
  motion.reset()
  advance(4000)
  expect(bot.tilt).toBe(0)
  expect(bot.sy).toBe(1)
  expect(bot.eyeOverride).toBe(null)
  expect(bot.hands).toBe(0)
  expect(motion.pendingSuccess).toBe(false)
  expect(bot.busy).toBe(false)
  expect(vi.getTimerCount()).toBe(0)
})

it('falls asleep after two minutes, settles without permanent frame work, and wakes on interaction', () => {
  const { bot, motion, advance } = setup()
  advance(124000)
  expect(motion.sleeping).toBe(true)
  expect(bot.eyeOverride).toBe('closed')
  expect(bot.busy).toBe(false)
  motion.activity()
  motion.curious()
  motion.work(true)
  motion.react('notification')
  motion.success()
  expect(motion.sleeping).toBe(true)
  expect(bot.eyeOverride).toBe('closed')
  motion.press()
  motion.release()
  motion.work(false)
  expect(motion.sleeping).toBe(false)
  expect(bot.eyeOverride).not.toBe('closed')
  advance(2000)
  expect(bot.eyeOverride).toBe(null)
  expect(bot.busy).toBe(false)
  expect(vi.getTimerCount()).toBe(0)
})

it('working pulses follow an active operation, prevent sleep and stop after the actual finish', () => {
  const { bot, motion, advance } = setup()
  motion.work(true)
  advance(1100)
  expect(bot.sy).toBeGreaterThan(1.01)
  advance(130000)
  expect(motion.sleeping).toBe(false)
  motion.work(false)
  advance(2500)
  expect(bot.busy).toBe(false)
  expect(vi.getTimerCount()).toBe(0)
})

it.each(['error', 'celebrate', 'notification', 'surprised'])('%s is bounded, coalesced and restores the body and hands', kind => {
  const { bot, motion, advance } = setup()
  motion.react(kind)
  advance(250)
  expect(bot.busy).toBe(true)
  const times = motion.lastReaction.get(kind)
  motion.react(kind)
  expect(motion.lastReaction.get(kind)).toBe(times)
  advance(4000)
  for (const [key, value] of Object.entries({ sx: 1, sy: 1, ox: 0, oy: 0, tilt: 0, hands: 0, es: 1 })) expect(bot[key]).toBe(value)
  expect(bot.busy).toBe(false)
  expect(vi.getTimerCount()).toBe(0)
})

it('every click gets a different reaction, including rapid presses, and dragging still defers feedback', () => {
  const { bot, motion, advance } = setup()
  const reactions = []
  for (let index = 0; index < 6; index++) { motion.press(); reactions.push(motion.lastTap); motion.release(); advance(100) }
  expect(new Set(reactions).size).toBe(6)
  advance(2500)
  expect(bot.busy).toBe(false)
  motion.press(); motion.drag(-1); motion.react('error')
  expect(motion.pendingReaction).toBe('error')
  motion.release()
  expect(bot.eyeOverride).toBe('line')
  advance(2500)
  expect(bot.busy).toBe(false)
})

it.each([0, .5, .999999])('shuffled click bags cover all six reactions and never repeat at bag boundaries (random %s)', random => {
  const { motion, advance } = setup()
  motion.random = () => random
  let previous: string | undefined
  for (let bag = 0; bag < 5; bag++) {
    const seen = new Set<string>()
    for (let click = 0; click < 6; click++) {
      motion.press()
      expect(motion.lastTap).not.toBe(previous)
      seen.add(motion.lastTap)
      previous = motion.lastTap
      motion.release()
      advance(40)
    }
    expect(seen.size).toBe(6)
  }
})

it('click reactions draw distinct poses, interrupt continuously and settle without new timers', () => {
  const { bot, motion, advance } = setup()
  const signatures = new Set<string>()
  for (let click = 0; click < 6; click++) {
    motion.press()
    motion.release()
    advance(180)
    const signature = [bot.sx, bot.sy, bot.tilt, bot.oy, bot.blush, bot.es, bot.eyeOverride]
      .map(value => typeof value === 'number' ? Math.round(value * 1000) / 1000 : value)
    signatures.add(JSON.stringify(signature))
    const pose = { sx: bot.sx, sy: bot.sy, tilt: bot.tilt, oy: bot.oy }
    if (click === 5) {
      motion.press()
      expect({ sx: bot.sx, sy: bot.sy, tilt: bot.tilt, oy: bot.oy }).toEqual(pose)
      motion.release()
    }
    advance(2400)
    expect(bot.busy).toBe(false)
    expect(bot.eyeOverride).toBe(null)
    expect(bot.sx).toBe(1)
    expect(bot.sy).toBe(1)
    expect(bot.oy).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  }
  expect(signatures.size).toBe(6)
})

it('edge peeking waits for a soft landing, then returns to rest and clears on reset', () => {
  const { bot, motion, advance } = setup()
  motion.press(); motion.drag(-1); advance(200); motion.release(); motion.edge(-1)
  advance(100)
  expect(bot.sy).toBeLessThan(.96)
  advance(1000)
  expect(bot.ox).toBeLessThan(-.03)
  advance(3000)
  expect(bot.ox).toBe(0)
  expect(bot.busy).toBe(false)
  motion.reset()
  expect(motion.pendingEdge).toBe(0)
})

it('retains a requested edge peek until the active operation finishes', () => {
  const { bot, motion, advance } = setup()
  motion.work(true)
  motion.edge(1)
  advance(1200)
  expect(bot.ox).toBe(0)
  expect(motion.pendingEdge).toBe(1)
  motion.work(false)
  advance(600)
  expect(bot.ox).toBeGreaterThan(.03)
  advance(2000)
  expect(bot.busy).toBe(false)
})
