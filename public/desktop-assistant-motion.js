// Cosmetic gestures share the engine's tweens, so interruptions start at the
// current pose and use the existing frame loop. No gesture owns a timer.
const smooth = t => t * t * (3 - 2 * t)
const resting = { tilt: 0, sx: 1, sy: 1, oy: 0, es: 1, open: 1, blush: 0 }

export class AssistantMotion {
  constructor(bot, clock = () => performance.now(), random = Math.random) {
    this.bot = bot
    this.clock = clock
    this.random = random
    this.hovered = false
    this.pressed = false
    this.dragging = false
    this.activeUntil = 0
    this.lastCuriosity = -Infinity
    this.lastSuccess = -Infinity
    this.pendingSuccess = false
    this.activity()
  }

  activity() {
    this.nextStretch = this.clock() + 45000 + this.random() * 30000
  }

  pose(properties) {
    for (const [property, keys] of Object.entries(properties)) {
      this.bot.anim(property, keys.map(([value, duration]) => [value, duration, smooth]))
    }
  }

  settle() {
    this.bot.interruptGreet()
    this.pose(Object.fromEntries(Object.entries(resting).map(([key, value]) => [key, [[value, 220]]])))
  }

  curious() {
    const now = this.clock()
    this.activity()
    if (this.pressed || now < this.activeUntil || now - this.lastCuriosity < 12000) return
    this.lastCuriosity = now
    this.activeUntil = now + 1300
    this.settle()
    const direction = this.bot.lookX < 0 ? -1 : 1
    this.pose({ tilt: [[direction * .12, 300], [direction * .12, 500], [0, 500]], es: [[1.08, 300], [1.08, 500], [1, 500]] })
    this.bot.triggerEmote('happy', .9)
  }

  tick() {
    const now = this.clock()
    if (this.pressed || this.hovered || now < this.activeUntil || now < this.nextStretch || this.bot.tweens.size) return
    this.activity()
    this.activeUntil = now + 2100
    this.pose({
      sy: [[1.1, 650], [1.1, 350], [.98, 450], [1, 500]],
      sx: [[.94, 650], [.94, 350], [1.02, 450], [1, 500]],
      oy: [[-.025, 650], [-.025, 350], [0, 950]],
      open: [[.45, 600], [.45, 400], [1, 700]],
      tilt: [[-.055, 650], [.055, 650], [0, 650]],
    })
  }

  press() {
    this.activity()
    this.pressed = true
    this.settle()
    this.bot.squash()
  }

  drag(x) {
    this.activity()
    this.pressed = this.dragging = true
    this.settle()
    this.pose({ tilt: [[x * .14, 140], [0, 420]], sx: [[.98, 140], [1, 420]], sy: [[1.03, 140], [1, 420]] })
  }

  release() {
    this.activity()
    this.pressed = false
    if (this.dragging) {
      this.dragging = false
      this.settle()
      this.activeUntil = this.clock() + 650
      this.pose({ sy: [[.94, 110], [1.035, 210], [1, 300]], sx: [[1.05, 110], [.98, 210], [1, 300]], oy: [[.025, 110], [0, 400]] })
    }
    if (this.pendingSuccess) {
      this.pendingSuccess = false
      this.success()
    }
  }

  success() {
    const now = this.clock()
    this.activity()
    if (this.pressed) { this.pendingSuccess = true; return }
    // Several saves in a burst get one small acknowledgement.
    if (now - this.lastSuccess < 6000) return
    this.lastSuccess = now
    this.activeUntil = now + 1400
    this.settle()
    this.bot.triggerEmote('happy', 1.2)
    this.pose({ oy: [[.025, 100], [-.12, 240], [0, 380]], sy: [[.95, 100], [1.045, 240], [1, 380]], sx: [[1.04, 100], [.98, 240], [1, 380]] })
  }

  reset() {
    this.bot.interruptGreet()
    for (const [property, value] of Object.entries(resting)) {
      this.bot.tweens.delete(property)
      this.bot.locks.delete(property)
      this.bot[property] = value
    }
    this.bot.eyeOverride = null
    this.bot.eyeOverrideUntil = 0
    this.hovered = this.pressed = this.dragging = this.pendingSuccess = false
    this.activeUntil = 0
    this.activity()
  }
}
