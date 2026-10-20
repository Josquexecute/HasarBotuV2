// Cosmetic gestures share the engine's tweens, so interruptions start at the
// current pose and use the existing frame loop. No gesture owns a timer.
const smooth = t => t * t * (3 - 2 * t)
const resting = { tilt: 0, sx: 1, sy: 1, oy: 0, ox: 0, es: 1, open: 1, blush: 0, hands: 0 }
const tapReactions = ['squash', 'hop', 'wiggle', 'wink', 'blush', 'surprised']

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
    this.pendingReaction = undefined
    this.working = this.sleeping = false
    this.lastReaction = new Map()
    this.tapQueue = []
    this.lastTap = undefined
    this.nextWork = 0
    this.activity()
  }

  activity(wake = false) {
    if (this.sleeping && !wake) return
    const now = this.clock()
    this.nextStretch = now + 45000 + this.random() * 30000
    this.sleepAt = now + 120000
    if (this.sleeping) {
      this.sleeping = false
      this.bot.eyeOverride = null
      this.bot.eyeOverrideUntil = 0
      this.settle()
      this.pose({ es: [[1.1, 180], [1, 350]], sy: [[1.04, 180], [1, 350]] })
    }
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
    if (this.sleeping) return
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
    if (this.pressed || this.hovered || now < this.activeUntil || this.bot.tweens.size || this.sleeping) return
    if (this.pendingEdge && !this.working) {
      const direction = this.pendingEdge
      this.pendingEdge = 0
      this.edge(direction)
      return
    }
    if (this.working) {
      if (now < this.nextWork) return
      this.nextWork = now + 3200
      this.pose({ tilt: [[-.045, 450], [.045, 600], [0, 450]], es: [[1.08, 450], [1, 1050]], sy: [[1.025, 600], [1, 900]] })
      return
    }
    if (now >= this.sleepAt) {
      this.sleeping = true
      this.bot.lookX = this.bot.lookY = 0
      this.bot.eyeOverride = 'closed'
      this.bot.eyeOverrideUntil = Infinity
      this.pose({ tilt: [[.07, 650], [0, 650]], sy: [[.96, 650], [1, 650]] })
      return
    }
    if (now < this.nextStretch) return
    // A stretch is cosmetic, so it must not postpone falling asleep indefinitely.
    this.nextStretch = now + 45000 + this.random() * 30000
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
    if (this.pressed) return
    this.activity(true)
    this.pressed = true
    this.settle()
    this.bot.eyeOverride = null
    this.bot.eyeOverrideUntil = 0
    const now = this.clock()
    this.activeUntil = now + 1000
    if (!this.tapQueue.length) {
      this.tapQueue = [...tapReactions]
      for (let i = this.tapQueue.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1))
        const item = this.tapQueue[i]
        this.tapQueue[i] = this.tapQueue[j]
        this.tapQueue[j] = item
      }
      // A fresh shuffled bag must not repeat the previous bag's final reaction.
      if (this.tapQueue.at(-1) === this.lastTap) {
        const last = this.tapQueue.length - 1
        const first = this.tapQueue[0]
        this.tapQueue[0] = this.tapQueue[last]
        this.tapQueue[last] = first
      }
    }
    this.lastTap = this.tapQueue.pop()
    if (this.lastTap === 'squash') this.bot.squash()
    else if (this.lastTap === 'hop') {
      this.pose({ oy: [[-.1, 210], [0, 340]], sy: [[1.06, 210], [1, 340]], sx: [[.97, 210], [1, 340]] })
    } else if (this.lastTap === 'wiggle') {
      this.pose({ tilt: [[-.17, 170], [.17, 240], [-.08, 180], [0, 240]], ox: [[-.025, 170], [.025, 240], [0, 420]] })
    } else if (this.lastTap === 'wink') {
      this.bot.eyeOverride = 'wink'
      this.bot.eyeOverrideUntil = now / 1000 + .85
      this.pose({ tilt: [[.1, 200], [.1, 300], [0, 320]], es: [[1.08, 200], [1, 620]] })
    } else if (this.lastTap === 'blush') {
      this.bot.eyeOverride = 'happy'
      this.bot.eyeOverrideUntil = now / 1000 + .85
      this.pose({ blush: [[.8, 180], [.8, 300], [0, 360]], tilt: [[-.07, 230], [0, 550]], sy: [[.97, 230], [1, 550]] })
    } else if (this.lastTap === 'surprised') {
      this.bot.eyeOverride = 'dot'
      this.bot.eyeOverrideUntil = now / 1000 + .85
      this.pose({ es: [[1.22, 140], [1.22, 250], [1, 430]], oy: [[-.06, 180], [0, 400]], sy: [[1.04, 180], [1, 400]] })
    }
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
    if (this.pendingReaction) {
      const reaction = this.pendingReaction
      this.pendingReaction = undefined
      this.react(reaction)
    }
  }

  work(active) {
    if (this.working === active) return
    this.working = active
    if (this.sleeping) return
    this.activity()
    this.nextWork = this.clock() + 400
    // Do not cut off a confirmed task celebration when its promise finishes.
    if (!active && this.clock() >= this.activeUntil && !this.pressed) this.settle()
  }

  edge(direction) {
    if (this.sleeping) return
    this.pendingEdge = 0
    if (!direction) return
    if (this.pressed || this.working || this.clock() < this.activeUntil || this.bot.tweens.size) { this.pendingEdge = direction; return }
    this.activity()
    this.activeUntil = this.clock() + 1500
    this.settle()
    this.pose({ tilt: [[direction * .1, 300], [direction * .1, 650], [0, 500]], ox: [[direction * .045, 300], [direction * .045, 650], [0, 500]] })
  }

  react(kind) {
    if (this.sleeping) return
    if (this.pressed && kind !== 'surprised') { this.pendingReaction = kind; return }
    const now = this.clock()
    const cooldown = kind === 'notification' ? 15000 : 5000
    if (now - (this.lastReaction.get(kind) ?? -Infinity) < cooldown) return
    this.lastReaction.set(kind, now)
    this.activity()
    this.activeUntil = now + 1800
    this.settle()
    if (kind === 'error') {
      this.bot.eyeOverride = 'line'
      this.bot.eyeOverrideUntil = now / 1000 + 1.4
      this.pose({ tilt: [[-.1, 140], [.1, 180], [-.07, 180], [.05, 180], [0, 300]], ox: [[-.025, 140], [.025, 180], [0, 480]] })
    } else if (kind === 'celebrate') {
      this.bot.triggerEmote('happy', 1.6)
      this.pose({ hands: [[1, 260], [1, 800], [0, 280]], tilt: [[-.1, 260], [.1, 320], [-.08, 320], [0, 400]], oy: [[-.065, 250], [0, 450]] })
    } else if (kind === 'notification') {
      this.bot.triggerEmote('happy', 1)
      this.pose({ oy: [[-.045, 220], [0, 320]], tilt: [[.08, 220], [-.08, 280], [0, 380]], es: [[1.1, 220], [1, 660]] })
    } else if (kind === 'surprised') {
      // Keep the bounce inside the helper's fixed canvas bounds.
      this.bot.eyeOverride = 'dot'
      this.bot.eyeOverrideUntil = now / 1000 + 1.1
      this.pose({ es: [[1.22, 130], [1.22, 300], [1, 500]], oy: [[-.07, 160], [0, 380]], sy: [[1.04, 160], [1, 380]] })
    }
  }

  success() {
    if (this.sleeping) return
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

  reset(preserveSleep = false) {
    const asleep = preserveSleep && this.sleeping
    this.bot.interruptGreet()
    for (const [property, value] of Object.entries(resting)) {
      this.bot.tweens.delete(property)
      this.bot.locks.delete(property)
      this.bot[property] = value
    }
    this.bot.eyeOverride = asleep ? 'closed' : null
    this.bot.eyeOverrideUntil = asleep ? Infinity : 0
    this.hovered = this.pressed = this.dragging = this.pendingSuccess = false
    this.sleeping = asleep
    this.working = false
    this.pendingReaction = undefined
    this.pendingEdge = 0
    this.activeUntil = 0
    this.activity()
  }
}
