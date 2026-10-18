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
