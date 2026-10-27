import { AssistantPlay } from './desktop-assistant-play.js'

// Cosmetic gestures share the engine's tweens, so interruptions start at the
// current pose and use the existing frame loop. No gesture owns a timer.
const smooth = t => t * t * (3 - 2 * t)
const resting = { tilt: 0, sx: 1, sy: 1, oy: 0, ox: 0, es: 1, open: 1, blush: 0, hands: 0, nausea: 0 }
const tapReactions = ['squash', 'hop', 'wiggle', 'wink', 'blush', 'surprised']
const idleReactions = ['dance', 'laugh', 'wink', 'blush', 'surprised', 'doze', 'yawn', 'stretch', 'wave', 'excited', 'play']
// Distances are Electron DIPs, not the saturated cosmetic tilt or CSS pixels.
const shake = { window: 1100, leg: 40, speed: 650, reversals: 4, cooldown: 14000 }

export class AssistantMotion {
  constructor(bot, clock = () => performance.now(), random = Math.random) {
    this.bot = bot
    this.cursorGaze = { x: 0, y: 0 }
    this.clock = clock
    this.random = random
    this.play = new AssistantPlay(bot, clock, random)
    this.drawOriginal = this.drawBase.bind(this)
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
    this.bot.nausea = 0
    this.idleQueue = []
    this.lastDizzy = -Infinity
    this.dizzy = false
    this.recoverUntil = 0
    this.clearShake()
    this.activity()
  }

  take(queue, choices, previous) {
    if (!queue.length) {
      queue.push(...choices)
      for (let i = queue.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1))
        const item = queue[i]
        queue[i] = queue[j]
        queue[j] = item
      }
      if (queue.at(-1) === previous) [queue[0], queue[queue.length - 1]] = [queue.at(-1), queue[0]]
    }
    return queue.pop()
  }

  eyes(shape, duration) {
    this.bot.eyeOverride = shape
    this.bot.eyeOverrideUntil = this.clock() / 1000 + duration / 1000
  }

  activity(wake = false) {
    if (this.sleeping && !wake) return
    const now = this.clock()
    this.nextStretch = now + 45000 + this.random() * 30000
    this.nextIdle = now + 16000 + this.random() * 12000
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
    this.bot.eyeOverride = null
    this.bot.eyeOverrideUntil = 0
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
    this.play.tick(this.sleeping)
    if (this.dizzy) {
      if (now < this.recoverUntil) {
        if (this.dragging && !this.bot.tweens.size) this.wobble()
        return
      }
      this.dizzy = false
      this.recoverUntil = 0
    }
    if (this.pressed && !this.dragging) {
      const held = now - this.pressedAt
      this.play.hold(held)
      const phase = held >= 3500 ? 3 : held >= 1800 ? 2 : held >= 650 ? 1 : 0
      if (phase > this.holdPhase) {
        this.holdPhase = phase
        this.settle()
        this.eyes(phase === 1 ? 'dot' : phase === 2 ? 'tired' : 'line', 1100)
        this.pose({ tilt: [[phase === 3 ? -.12 : .1, 300], [0, 650]], es: [[phase === 1 ? 1.15 : .94, 300], [1, 650]] })
      }
      return
    }
    if (this.pressed || this.hovered || now < this.activeUntil || this.bot.tweens.size || this.sleeping) return
    if (this.pendingSuccess) { this.pendingSuccess = false; this.success(); return }
    if (this.pendingReaction) { const reaction = this.pendingReaction; this.pendingReaction = undefined; this.react(reaction); return }
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
      this.play.clear()
      this.sleeping = true
      this.bot.lookX = this.bot.lookY = 0
      this.bot.eyeOverride = 'closed'
      this.bot.eyeOverrideUntil = Infinity
      this.pose({ tilt: [[.07, 650], [0, 650]], sy: [[.96, 650], [1, 650]] })
      return
    }
    if (now < this.nextStretch) {
      if (now >= this.nextIdle) {
        this.nextIdle = now + 16000 + this.random() * 12000
        this.lastIdle = this.take(this.idleQueue, idleReactions, this.lastIdle)
        this.idle(this.lastIdle)
        this.play.idle()
      }
      return
    }
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
    this.pressedAt = this.clock()
    this.holdPhase = 0
    this.clearShake()
    if (this.dizzy) return
    this.play.tap()
    this.settle()
    this.bot.eyeOverride = null
    this.bot.eyeOverrideUntil = 0
    const now = this.clock()
    this.activeUntil = now + 1000
    this.lastTap = this.take(this.tapQueue, tapReactions, this.lastTap)
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
    this.tapCount = now - (this.lastClickAt ?? -Infinity) <= 360 ? Math.min(3, this.tapCount + 1) : 1
    this.lastInteraction = this.tapCount === 1 ? 'single' : this.tapCount === 2 ? 'double' : 'burst'
    if (this.tapCount === 2) this.pose({ hands: [[.8, 180], [0, 520]], oy: [[-.085, 200], [0, 430]] })
    if (this.tapCount === 3) {
      this.eyes('happy', 1000)
      this.pose({ hands: [[1, 180], [0, 700]], tilt: [[-.13, 180], [.13, 240], [0, 420]], blush: [[.65, 250], [0, 650]] })
    }
  }

  drag(x, sample) {
    this.activity()
    this.pressed = this.dragging = true
    this.tapCount = 0
    this.lastClickAt = undefined
    if (sample) this.sampleShake(sample)
    if (this.dizzy) return
    this.play.drag()
    this.settle()
    this.eyes(Math.abs(x) > .75 ? 'wide' : 'dot', 550)
    this.pose({ tilt: [[x * .14, 140], [0, 420]], sx: [[.98, 140], [1, 420]], sy: [[1.03, 140], [1, 420]] })
  }

  release() {
    this.activity()
    if (!this.pressed) return
    this.pressed = false
    if (!this.dragging && !this.holdPhase) this.lastClickAt = this.clock()
    else { this.tapCount = 0; this.lastClickAt = undefined }
    this.clearShake()
    if (this.dizzy) {
      this.dragging = false
      this.recoverUntil = this.clock() + 3600
      this.activeUntil = this.recoverUntil
      this.eyes('dot', 1800)
      this.wobble(true)
      this.play.recover()
      return
    }
    if (this.holdPhase) this.settle()
    if (this.dragging) {
      this.play.drop()
      this.dragging = false
      this.settle()
      this.activeUntil = this.clock() + 650
      this.lastLanding = this.take(this.landingQueue ??= [], ['bounce', 'stumble', 'balance'], this.lastLanding)
      this.pose({ sy: [[.94, 110], [1.035, 210], [1, 300]], sx: [[1.05, 110], [.98, 210], [1, 300]], oy: [[.025, 110], [this.lastLanding === 'bounce' ? -.075 : 0, 180], [0, 300]], tilt: [[this.lastLanding === 'stumble' ? -.13 : .055, 150], [.04, 180], [0, 280]] })
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
    if (!active && this.clock() >= this.activeUntil && !this.pressed && !this.dizzy) this.settle()
  }

  edge(direction) {
    if (this.sleeping) return
    this.pendingEdge = 0
    if (!direction) return
    if (this.pressed || this.dizzy || this.working || this.clock() < this.activeUntil || this.bot.tweens.size) { this.pendingEdge = direction; return }
    this.activity()
    this.activeUntil = this.clock() + 1500
    this.settle()
    this.pose({ tilt: [[direction * .1, 300], [direction * .1, 650], [0, 500]], ox: [[direction * .045, 300], [direction * .045, 650], [0, 500]] })
  }

  react(kind) {
    if (this.sleeping) return
    if (this.pressed || this.dizzy) { this.pendingReaction = kind; return }
    const now = this.clock()
    const cooldown = kind === 'notification' ? 15000 : 5000
    if (now - (this.lastReaction.get(kind) ?? -Infinity) < cooldown) return
    this.lastReaction.set(kind, now)
    this.play.clear()
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
    if (this.pressed || this.dizzy) { this.pendingSuccess = true; return }
    // Several saves in a burst get one small acknowledgement.
    if (now - this.lastSuccess < 6000) return
    this.lastSuccess = now
    this.play.clear()
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
    this.dizzy = false
    this.recoverUntil = 0
    this.holdPhase = 0
    this.tapCount = 0
    this.lastClickAt = undefined
    this.clearShake()
    this.play.reset()
    this.play.sleeping = asleep
    this.play.publish()
    this.activity()
  }

  get animating() { return this.play.animating }

  get gazeBlocked() {
    const now = this.clock() / 1000
    return this.sleeping || this.pressed || this.dragging || this.dizzy || this.play.animating
      || this.clock() < this.activeUntil || now < this.bot.waveUntil
      || this.bot.eyeOverride && now <= this.bot.eyeOverrideUntil
      || this.bot.particles?.length > 0
      || [...this.bot.tweens.keys()].some(property => property !== 'open')
  }

  gaze(x, y) { this.cursorGaze = { x, y } }

  updateGaze() {
    // Keep the latest cursor while choreography owns the eyes. The engine's
    // normal interpolation eases both handoffs without adding a competing tween.
    const target = this.gazeBlocked ? { x: 0, y: 0 } : this.cursorGaze
    this.bot.lookX = target.x
    this.bot.lookY = target.y
  }

  control(command) {
    if (command.type === 'sleep') {
      this.reset()
      this.sleeping = true
      this.bot.lookX = this.bot.lookY = 0
      this.bot.eyeOverride = 'closed'
      this.bot.eyeOverrideUntil = Infinity
      this.play.sleeping = true
      this.play.publish()
      return true
    }
    if (command.type === 'wake') {
      this.activity(true)
      this.play.sleeping = false
      this.play.publish()
      return true
    }
    if (command.type === 'play') {
      if (this.play.reducedMotion) return false
      this.activity(true)
    }
    const accepted = this.play.control(command)
    if (accepted && ['play', 'calm', 'stop', 'pause'].includes(command.type)) {
      this.dizzy = false
      this.recoverUntil = 0
      this.activeUntil = this.clock() + 220
      this.settle()
    }
    return accepted
  }

  clearShake() {
    this.opposite = 0
    this.shakeElapsed = 0
    this.shakeLeg = { x: 0, y: 0, duration: 0 }
    this.shakeTurns = []
  }

  sampleShake({ dx, dy, elapsed }) {
    if (![dx, dy, elapsed].every(Number.isFinite) || elapsed <= this.shakeElapsed) return
    const dt = elapsed - this.shakeElapsed
    this.shakeElapsed = elapsed
    if (this.dizzy || this.clock() - this.lastDizzy < shake.cooldown) return
    if (dt > 220) { this.shakeTurns = []; this.shakeLeg = { x: 0, y: 0, duration: 0 } }
    const leg = this.shakeLeg
    // Ignore tiny reversals until they accumulate into a real opposite leg.
    if (dx && leg.x && Math.sign(dx) !== Math.sign(leg.x)) {
      this.opposite = (this.opposite ?? 0) + dx
      if (Math.abs(this.opposite) < 8) { leg.duration += dt; leg.y += Math.abs(dy); return }
      const valid = Math.abs(leg.x) >= shake.leg && leg.duration <= 220
        && Math.abs(leg.x) / Math.max(leg.duration, 1) * 1000 >= shake.speed && Math.abs(leg.x) > leg.y * 1.6
      this.shakeTurns = valid ? this.shakeTurns.filter(time => elapsed - time <= shake.window) : []
      if (valid) this.shakeTurns.push(elapsed)
      this.shakeLeg = { x: this.opposite, y: Math.abs(dy), duration: dt }
      this.opposite = 0
      if (this.shakeTurns.length >= shake.reversals) {
        this.lastDizzy = this.clock()
        this.dizzy = true
        this.recoverUntil = Infinity
        this.settle()
        this.eyes('dot', 2400)
        this.wobble()
        this.play.shake()
      }
    } else {
      this.opposite = 0
      leg.x += dx
      leg.y += Math.abs(dy)
      leg.duration += dt
    }
  }

  wobble(recover = false) {
    this.pose({
      nausea: recover ? [[.6, 300], [.3, 1500], [0, 1500]] : [[.8, 280], [.65, 1400], [.5, 600]],
      tilt: [[-.14, 320], [.13, 480], [-.09, 500], [.06, 520], [0, recover ? 1400 : 500]],
      ox: [[-.035, 320], [.035, 480], [-.02, 500], [0, recover ? 1900 : 1020]],
      sy: [[.96, 320], [1.025, 480], [1, recover ? 2400 : 1520]],
      es: [[1.12, 300], [1, recover ? 2900 : 2020]],
    })
  }

  idle(kind) {
    this.settle()
    this.activeUntil = this.clock() + 2600
    if (kind === 'stretch' || kind === 'yawn') {
      this.eyes(kind === 'yawn' ? 'tired' : 'happy', 1900)
      this.pose({ sy: [[1.1, 650], [1.1, 350], [1, 900]], sx: [[.94, 650], [.94, 350], [1, 900]], hands: [[.8, 500], [0, 1400]] })
    } else if (kind === 'dance' || kind === 'laugh' || kind === 'excited' || kind === 'play') {
      this.eyes(kind === 'play' ? 'wide' : 'happy', 2200)
      this.pose({ tilt: [[-.1, 300], [.1, 400], [-.08, 400], [.08, 400], [0, 500]], oy: [[-.06, 300], [0, 400], [-.05, 400], [0, 900]], hands: [[kind === 'laugh' ? .4 : 1, 350], [0, 1600]], sy: [[1.04, 300], [.96, 400], [1.03, 400], [1, 900]] })
      if (kind === 'play') this.pose({ es: [[1.18, 350], [1, 1700]], ox: [[-.035, 350], [.035, 500], [0, 1200]] })
      if (kind === 'laugh') this.pose({ blush: [[.5, 300], [0, 1600]], open: [[.55, 300], [1, 1600]] })
      if (kind === 'excited') this.pose({ es: [[1.17, 250], [1, 1800]], oy: [[-.09, 220], [0, 320], [-.08, 220], [0, 800]] })
    } else {
      this.eyes(({ wink: 'wink', blush: 'happy', surprised: 'dot', doze: 'closed', wave: 'happy' })[kind], 1900)
      this.pose({ tilt: [[kind === 'doze' ? .09 : -.07, 500], [0, 1500]], es: [[kind === 'surprised' ? 1.22 : 1, 300], [1, 1700]] })
      if (kind === 'blush') this.pose({ blush: [[.8, 350], [0, 1600]] })
      if (kind === 'wave') this.pose({ hands: [[1, 300], [.45, 300], [1, 300], [0, 1100]] })
    }
  }

  draw(context, width, height) {
    this.play.draw(context, width, height, this.drawOriginal)
    this.drawNauseaDecorations(context, width, height)
  }

  drawBase(context, width, height) {
    const level = this.bot.nausea
    const color = this.bot.bodyColor
    if (level > 0) {
      const base = color ?? [.9, .91, .93]
      this.bot.bodyColor = base.map((channel, i) => channel + ([.55, .78, .49][i] - channel) * level * .55)
    }
    try { this.bot.draw(context, width, height) }
    finally { this.bot.bodyColor = color }
  }

  drawNauseaDecorations(context, width, height) {
    const level = this.bot.nausea
    if (!(level > .001) || this.play.scene?.definition.id === 'orbit-stars') return
    const radius = width * .3
    context.save()
    context.globalAlpha = level
    context.translate(width / 2 + this.bot.ox * radius, height / 2 + this.bot.oy * radius + radius * .06)
    // Keep the original orbit in window space when a new scene turns the body.
    context.fillStyle = '#e6bd55'
    for (let i = 0; i < 3; i++) {
      const angle = this.clock() / 1000 * .8 + i * Math.PI * 2 / 3
      const x = Math.cos(angle) * radius * 1.28, y = -.85 * radius + Math.sin(angle) * radius * .22
      context.beginPath()
      for (let point = 0; point < 8; point++) {
        const a = point * Math.PI / 4, r = radius * (point % 2 ? .035 : .09)
        context.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r)
      }
      context.closePath()
      context.fill()
    }
    if (this.play.scene) { context.restore(); return }
    context.rotate(this.bot.tilt)
    context.scale(this.bot.sx, this.bot.sy)
    context.strokeStyle = this.bot.eyeColor ?? '#1a1412'
    context.lineWidth = radius * .045
    context.lineCap = 'round'
    context.beginPath()
    context.moveTo(-radius * .18, radius * .4)
    context.bezierCurveTo(-radius * .06, radius * .25, radius * .06, radius * .55, radius * .18, radius * .4)
    context.stroke()
    context.restore()
  }
}
