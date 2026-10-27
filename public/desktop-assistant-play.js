// Cosmetic scenes own one bounded timeline. They never own timers, documents,
// account preferences or engine tweens; interruption simply replaces the scene.
const groups = {
  tap: 'Tıklamalar', rapid: 'Hızlı tıklamalar', shake: 'Baş dönmesi',
  drag: 'Havada', land: 'İnişler', hold: 'Uzun basış', idle: 'Kendi hâlinde', rare: 'Sürprizler',
}
const rows = [
  ['grin', 'Kocaman gülümseme', 'tap', 1400],
  ['double-take', 'Bir daha bakayım!', 'tap', 1800],
  ['furrow', 'Kaş çatma', 'tap', 1900],
  ['grumble', 'Homurdanma', 'tap', 2200],
  ['tomato', 'Domates gibi kızarma', 'tap', 2000],
  ['stomp', 'Ayak diretme', 'tap', 2200],
  ['foam-bat', 'Oyuncak sopam nerede?', 'tap', 2600],
  ['enough-sign', 'YETER! tabelası', 'tap', 2700],
  ['sulk', 'Kollar bağlı, küstüm', 'tap', 3000],
  ['eye-twitch', 'Göz seğirmesi', 'rapid', 700],
  ['rattle', 'Sinirden titreme', 'rapid', 700],
  ['steam', 'Kulaklardan duman', 'rapid', 900],
  ['puff-up', 'Basınç yükseliyor', 'rapid', 1000],
  ['tantrum', 'Minik öfke nöbeti', 'rapid', 1400],
  ['breathe', 'Derin bir nefes', 'rapid', 2300],
  ['dizzy-spin', 'Dünya dönüyor', 'shake', 700],
  ['spiral-stare', 'Spiral gözler', 'shake', 1000],
  ['orbit-stars', 'Yıldızları sayma', 'shake', 1000],
  ['queasy', 'Midede kelebek değil...', 'shake', 1100],
  ['wobble', 'Yalpalama', 'shake', 800],
  ['trip', 'Muz kabuğuna bastım', 'shake', 900],
  ['faint', 'Bayılmış numarası', 'shake', 1400],
  ['revive', 'Yavaşça ayılma', 'shake', 1500],
  ['glare', 'Sana bakıyorum!', 'shake', 2000],
  ['cling', 'Bırakma beni!', 'drag', 2100],
  ['scared', 'Yükseklik korkusu', 'drag', 1900],
  ['swim', 'Havada yüzme', 'drag', 2500],
  ['hero', 'Pelerinli kahraman', 'drag', 2600],
  ['pendulum', 'Sarkaç gibi sallanma', 'drag', 2600],
  ['panic', 'Düşüyorum galiba!', 'drag', 1900],
  ['parachute', 'Mini paraşüt', 'drag', 2800],
  ['somersault', 'Taklalı iniş', 'land', 1800],
  ['spring-landing', 'Yaylı zıplama', 'land', 1900],
  ['skid', 'Frenler nerede?', 'land', 1900],
  ['nap', 'Uyku bastırdı', 'hold', 3400],
  ['bored', 'Kum saatiyle sıkılma', 'hold', 2500],
  ['eye-roll', 'Göz devirme', 'hold', 2300],
  ['pout', 'Kocaman somurtma', 'hold', 2700],
  ['escape', 'Gizli kaçış planı', 'hold', 2600],
  ['shuffle-dance', 'Minik ayak dansı', 'idle', 3200],
  ['whistle', 'Islık molası', 'idle', 3000],
  ['dream-cloud', 'Bulutlarda rüya', 'idle', 3600],
  ['huge-yawn', 'Kocaman esneme', 'idle', 3000],
  ['reading', 'Kitap kurdu', 'idle', 3600],
  ['coffee-break', 'Kahve molası', 'idle', 3500],
  ['workout', 'Minik halterci', 'idle', 3400],
  ['pirouette', 'Kurdeleli piruet', 'idle', 3000],
  ['explore', 'Büyüteçli keşif', 'idle', 3200],
  ['juggle', 'Üç top cambazı', 'idle', 3600],
  ['party-hat', 'Parti şapkası', 'rare', 3100],
  ['confetti', 'Konfeti sürprizi', 'rare', 3000],
  ['heart-gift', 'Sana küçük bir kalp', 'rare', 3300],
  ['magic', 'Şapkadan tavşan', 'rare', 3800],
  ['mini-disco', 'Mini disko', 'rare', 3800],
  ['disguise', 'Bıyıklı kılık değiştirme', 'rare', 3200],
  ['peek-spy', 'Gizli gözlemci', 'rare', 3000],
  ['rubber-duck', 'Vak vak arkadaşım', 'rare', 3400],
  ['paper-plane', 'Kâğıt uçak', 'rare', 3300],
  ['bubblegum', 'Sakız balonu', 'rare', 3100],
  ['umbrella', 'Kişisel yağmur bulutu', 'rare', 3600],
  ['accordion', 'Akordeon konseri', 'rare', 3500],
]
export const TOUCH_REACTIONS = Object.freeze(rows.map(([id, name, group, duration]) => Object.freeze({
  id, name, group, groupName: groups[group], duration, weight: group === 'rare' ? .3 : group === 'idle' ? 5 : 2,
})))
const byId = new Map(TOUCH_REACTIONS.map(scene => [scene.id, scene]))
const tapStages = rows.filter(row => row[2] === 'tap').map(row => row[0])
const rapidStages = rows.filter(row => row[2] === 'rapid').map(row => row[0])
const shakeStart = ['dizzy-spin', 'spiral-stare', 'orbit-stars', 'queasy']
const shakeEnd = ['wobble', 'trip', 'faint', 'revive', 'glare']
const holdStages = ['bored', 'eye-roll', 'pout', 'escape', 'nap']
const holdTimes = [650, 1800, 3500, 5500, 8000]
const colors = ['#ee6585', '#eab83f', '#62b6b0', '#8d83db', '#6fa8df']
const ease = t => t * t * (3 - 2 * t)
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const outline = '#28344a'

export class AssistantPlay {
  constructor(bot, clock = () => performance.now(), random = Math.random) {
    this.bot = bot
    this.clock = clock
    this.random = random
    this.score = 0
    this.lastInput = this.lastDecay = clock()
    this.lastTap = -Infinity
    this.streak = 0
    this.taps = []
    this.history = []
    this.scene = this.sequence = null
    this.paused = this.reducedMotion = false
    this.sleeping = false
    this.rapidUntil = -Infinity
    this.nextDrag = 0
    this.holdStage = -1
    this.onChange = () => {}
    this.lastState = ''
    this.frame = { dx: 0, dy: 0, r: 0, sx: 1, sy: 1, eye: null, blush: 0, open: 1, yaw: 0, pitch: 0 }
  }

  get mood() { return this.score >= 75 ? 'angry' : this.score >= 50 ? 'bothered' : this.score >= 25 ? 'surprised' : 'happy' }
  get animating() { return Boolean(this.scene) }

  publish() {
    const reaction = this.scene?.definition.id ?? null
    const key = `${this.mood}:${reaction}:${this.paused}:${this.reducedMotion}:${this.sleeping}`
    if (key === this.lastState) return
    this.lastState = key
    this.onChange({ mood: this.mood, reaction, paused: this.paused, reducedMotion: this.reducedMotion, sleeping: this.sleeping })
  }

  decay(now) {
    const from = Math.max(this.lastDecay, this.lastInput + 2000)
    if (now > from) this.score = Math.max(0, this.score - (now - from) * .004)
    this.lastDecay = now
  }

  agitate(amount) {
    const now = this.clock()
    this.decay(now)
    this.score = Math.min(100, this.score + amount)
    this.lastInput = now
  }

  pick(group) {
    const recent = this.history.slice(-4)
    let candidates = TOUCH_REACTIONS.filter(item => (group ? item.group === group : item.group === 'idle' || item.group === 'rare')
      && !(group === 'tap' && this.mood === 'angry' && (item.id === 'grin' || item.id === 'double-take')) && !recent.includes(item.id))
    if (!candidates.length) candidates = TOUCH_REACTIONS.filter(item => item.group === group && item.id !== this.history.at(-1))
    const total = candidates.reduce((sum, item) => sum + item.weight, 0)
    let ticket = this.random() * total
    for (const item of candidates) { ticket -= item.weight; if (ticket <= 0) return item.id }
    return candidates.at(-1)?.id ?? 'grin'
  }

  start(id, manual = false) {
    const definition = byId.get(id)
    if (!definition || this.reducedMotion || this.paused && !manual) return false
    this.sequence = null
    this.begin(definition)
    return true
  }

  begin(definition) {
    this.scene = { definition, started: this.clock() }
    this.history.push(definition.id)
    if (this.history.length > 8) this.history.shift()
    this.publish()
  }

  runSequence(ids) {
    if (this.paused || this.reducedMotion) return
    this.sequence = { ids, index: 0 }
    this.begin(byId.get(ids[0]))
  }

  clear() { this.scene = this.sequence = null; this.publish() }

  reset() {
    this.clear()
    this.score = this.streak = 0
    this.taps.length = 0
    this.lastTap = this.rapidUntil = -Infinity
    this.holdStage = -1
    this.nextDrag = 0
    this.lastInput = this.lastDecay = this.clock()
    this.publish()
  }

  setReduced(value) { this.reducedMotion = value; if (value) this.clear(); this.publish() }

  control(command) {
    if (command.type === 'play') {
      const id = command.id === 'random' ? this.pick() : command.id
      if (!byId.has(id) || this.reducedMotion) return false
      this.paused = false
      return this.start(id, true)
    }
    if (command.type === 'calm') {
      this.score = this.streak = 0
      this.taps.length = 0
      this.rapidUntil = -Infinity
      this.clear()
      if (!this.paused && !this.reducedMotion) this.start('breathe')
    } else if (command.type === 'stop') this.clear()
    else if (command.type === 'pause') { this.paused = true; this.clear() }
    else if (command.type === 'resume') this.paused = false
    else return false
    this.publish()
    return true
  }

  tap() {
    const now = this.clock()
    this.agitate(now - this.lastTap < 160 ? 12 : 8)
    this.streak = now - this.lastTap < 6000 ? Math.min(tapStages.length + 1, this.streak + 1) : 1
    this.lastTap = now
    this.holdStage = -1
    this.nextDrag = 0
    this.taps = this.taps.filter(time => now - time < 650)
    this.taps.push(now)
    if (this.taps.length > 16) this.taps.shift()
    if (this.taps.length >= 5 && now >= this.rapidUntil) {
      this.rapidUntil = now + 8500
      this.runSequence(rapidStages)
    } else if (!this.sequence) this.start(this.streak > tapStages.length ? this.pick('tap') : tapStages[this.streak - 1])
    this.publish()
  }

  hold(duration) {
    let phase = -1
    for (let i = 0; i < holdTimes.length; i++) if (duration >= holdTimes[i]) phase = i
    if (phase <= this.holdStage) return
    this.holdStage = phase
    this.agitate(2)
    this.start(holdStages[phase])
  }

  drag() {
    const now = this.clock()
    if (now < this.nextDrag) return
    this.nextDrag = now + 1800
    this.agitate(2)
    this.start(this.pick('drag'))
  }

  drop() { this.nextDrag = 0; this.start(this.pick('land')) }
  shake() { this.agitate(25); this.runSequence(shakeStart) }
  recover() { this.runSequence(shakeEnd) }
  idle() { this.start(this.pick()) }

  tick(sleeping = false) {
    const now = this.clock()
    this.sleeping = sleeping
    this.decay(now)
    if (this.scene && now - this.scene.started >= this.scene.definition.duration) {
      if (this.sequence && ++this.sequence.index < this.sequence.ids.length) this.begin(byId.get(this.sequence.ids[this.sequence.index]))
      else this.scene = this.sequence = null
    }
    this.publish()
  }

  sample(t) {
    const f = this.frame, id = this.scene.definition.id
    const e = ease(clamp(t * 7, 0, 1)) * ease(clamp((1 - t) * 7, 0, 1))
    const wave = Math.sin(t * Math.PI * 4), hop = Math.abs(Math.sin(t * Math.PI * 3))
    f.dx = f.dy = f.r = f.blush = f.yaw = f.pitch = 0
    f.sx = f.sy = f.open = 1; f.eye = null
    switch (id) {
      case 'grin': f.eye = 'happy'; f.dy = -2 * Math.sin(t * Math.PI); break
      case 'double-take': f.eye = 'wide'; f.dx = 3 * wave * e; f.sy = 1 + .05 * hop * e; break
      case 'furrow': f.eye = 'flat'; f.r = -.07 * e; break
      case 'grumble': f.eye = 'line'; f.dx = Math.sin(t * 22) * 1.3 * e; break
      case 'tomato': f.eye = 'happy'; f.blush = .9 * e; f.r = .1 * e; break
      case 'stomp': f.eye = 'flat'; f.dy = hop * 3 * e; f.r = wave * .08 * e; break
      case 'foam-bat': f.eye = 'flat'; f.r = -.1 * wave * e; break
      case 'enough-sign': f.eye = 'line'; f.sy = 1 + .035 * e; break
      case 'sulk': f.eye = 'tired'; f.r = -.12 * e; f.yaw = -.18 * e; break
      case 'eye-twitch': f.eye = 'flat'; f.open = 1 - Math.abs(Math.sin(t * 30)) * .2 * e; f.dx = Math.sin(t * 28) * .8 * e; break
      case 'rattle': f.eye = 'flat'; f.dx = Math.sin(t * 48) * 2 * e; break
      case 'steam': f.eye = 'line'; f.sy = 1 + .045 * e; break
      case 'puff-up': f.eye = 'wide'; f.sx = 1 + .075 * Math.sin(t * Math.PI); f.sy = 1 + .06 * Math.sin(t * Math.PI); break
      case 'tantrum': f.eye = 'line'; f.r = Math.sin(t * 27) * .11 * e; f.dy = -3 * hop * e; break
      case 'breathe': f.eye = 'closed'; f.sx = 1 + .035 * Math.sin(t * Math.PI * 2) * e; f.sy = 1 - .035 * Math.sin(t * Math.PI * 2) * e; break
      case 'dizzy-spin': f.eye = 'dot'; f.r = .25 * Math.sin(t * 7) * e; break
      case 'spiral-stare': f.eye = 'spiral'; f.r = .04 * wave * e; break
      case 'orbit-stars': f.eye = 'tired'; f.dx = 2 * wave * e; break
      case 'queasy': f.eye = 'tired'; f.sy = 1 - .06 * e; break
      case 'wobble': f.eye = 'dot'; f.r = wave * .21 * e; f.dx = wave * 3 * e; break
      case 'trip': f.eye = 'wide'; f.r = -.5 * Math.sin(t * Math.PI); f.dx = -4 * e; f.dy = 3 * e; break
      case 'faint': f.eye = 'closed'; f.r = -Math.PI / 2 * e; f.sy = 1 - .05 * e; break
      case 'revive': f.eye = t < .4 ? 'closed' : 'dot'; f.r = -.35 * (1 - t) * e; f.open = .35 + .65 * t; break
      case 'glare': f.eye = 'flat'; f.yaw = .25 * e; f.r = -.05 * e; break
      case 'cling': f.eye = 'wide'; f.dy = 3 * e; f.sy = 1 + .06 * e; break
      case 'scared': f.eye = 'wide'; f.sx = 1 - .04 * e; f.dx = Math.sin(t * 25) * e; break
      case 'swim': f.eye = 'happy'; f.r = wave * .1 * e; f.dy = -2 * wave * e; break
      case 'hero': f.eye = 'happy'; f.r = -.17 * e; f.dy = -3 * e; break
      case 'pendulum': f.eye = 'dot'; f.r = .22 * wave * e; f.dx = 4 * wave * e; break
      case 'panic': f.eye = 'wide'; f.r = .08 * Math.sin(t * 24) * e; break
      case 'parachute': f.eye = 'dot'; f.dy = 2 * e; f.r = .06 * wave * e; break
      case 'somersault': f.eye = 'happy'; f.r = 2 * Math.PI * ease(t); f.dy = -3 * Math.sin(t * Math.PI); break
      case 'spring-landing': f.eye = 'happy'; f.dy = -5 * hop * e; f.sy = 1 + .04 * wave * e; break
      case 'skid': f.eye = 'wide'; f.dx = (1 - t) * 4 * e; f.r = -.13 * e; break
      case 'nap': f.eye = 'closed'; f.r = .12 * e; f.sy = 1 - .025 * e; break
      case 'bored': f.eye = 'tired'; f.r = -.07 * e; break
      case 'eye-roll': f.eye = 'dot'; f.pitch = .18 * Math.sin(t * Math.PI); f.yaw = .2 * wave * e; break
      case 'pout': f.eye = 'flat'; f.sx = 1 + .04 * e; f.sy = 1 - .035 * e; break
      case 'escape': f.eye = 'dot'; f.dx = 4 * wave * e; f.dy = -2 * hop * e; break
      case 'shuffle-dance': f.eye = 'happy'; f.r = .12 * wave * e; f.dy = -2 * hop * e; break
      case 'whistle': f.eye = 'happy'; f.r = -.06 * e; break
      case 'dream-cloud': f.eye = 'closed'; f.r = .07 * e; break
      case 'huge-yawn': f.eye = 'closed'; f.sy = 1 + .065 * Math.sin(t * Math.PI); break
      case 'reading': f.eye = 'tired'; f.pitch = -.12 * e; f.r = .025 * wave * e; break
      case 'coffee-break': f.eye = 'happy'; f.r = .07 * Math.sin(t * Math.PI) * e; break
      case 'workout': f.eye = 'flat'; f.sy = 1 + .06 * hop * e; f.dy = -2 * hop * e; break
      case 'pirouette': f.eye = 'happy'; f.r = 2 * Math.PI * ease(t); break
      case 'explore': f.eye = 'dot'; f.yaw = .17 * wave * e; f.r = .07 * wave * e; break
      case 'juggle': f.eye = 'happy'; f.dy = -hop * e; break
      case 'party-hat': f.eye = 'wink'; f.r = .08 * wave * e; break
      case 'confetti': f.eye = 'happy'; f.dy = -3 * Math.sin(t * Math.PI); break
      case 'heart-gift': f.eye = 'happy'; f.blush = .6 * e; f.r = -.06 * e; break
      case 'magic': f.eye = 'wide'; f.r = -.05 * e; break
      case 'mini-disco': f.eye = 'happy'; f.r = .12 * wave * e; f.sx = 1 + .02 * wave * e; break
      case 'disguise': f.eye = 'flat'; f.r = -.04 * e; break
      case 'peek-spy': f.eye = 'dot'; f.dx = Math.sin(t * Math.PI * 2) * 4 * e; f.r = -.1 * e; break
      case 'rubber-duck': f.eye = 'happy'; f.r = -.07 * wave * e; break
      case 'paper-plane': f.eye = 'wide'; f.yaw = -.15 * wave * e; break
      case 'bubblegum': f.eye = 'dot'; f.sx = 1 + .02 * e; break
      case 'umbrella': f.eye = 'tired'; f.r = .05 * wave * e; break
      case 'accordion': f.eye = 'happy'; f.sx = 1 + .025 * wave * e; break
    }
    return e
  }

  draw(context, width, height, drawBody) {
    if (!this.scene || this.reducedMotion) { drawBody(context, width, height); return }
    const t = clamp((this.clock() - this.scene.started) / this.scene.definition.duration, 0, 1)
    const opacity = this.sample(t), f = this.frame, bot = this.bot
    const eye = bot.eyeOverride, until = bot.eyeOverrideUntil, blush = bot.blush, open = bot.open, yaw = bot.yaw, pitch = bot.pitch
    const scale = Math.min(width, height) / 120
    const cx = width / 2 + bot.ox * width * .3, cy = height / 2 + bot.oy * height * .3 + height * .018
    context.save()
    context.translate(cx + f.dx * scale, cy + f.dy * scale)
    context.rotate(f.r); context.scale(f.sx, f.sy); context.translate(-cx, -cy)
    if (f.eye) { bot.eyeOverride = f.eye; bot.eyeOverrideUntil = Infinity }
    bot.blush = Math.max(blush, f.blush); bot.open = open * f.open; bot.yaw = yaw + f.yaw; bot.pitch = pitch + f.pitch
    try {
      if (this.scene.definition.id === 'hero') {
        context.save(); context.translate(cx, cy); context.scale(scale, scale)
        cape(context, t, opacity); context.restore()
      }
      drawBody(context, width, height)
      context.translate(cx, cy); context.rotate(bot.tilt); context.scale(scale, scale)
      context.globalAlpha *= opacity
      context.lineWidth = 2; context.lineCap = 'round'; context.lineJoin = 'round'
      context.strokeStyle = outline
      paint(context, this.scene.definition.id, t)
    } finally {
      bot.eyeOverride = eye; bot.eyeOverrideUntil = until; bot.blush = blush; bot.open = open; bot.yaw = yaw; bot.pitch = pitch
      context.restore()
    }
  }
}

function line(c, x, y, xx, yy) { c.beginPath(); c.moveTo(x, y); c.lineTo(xx, yy); c.stroke() }
function oval(c, x, y, rx, ry, fill = '#fff4dc') { c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fillStyle = fill; c.fill(); c.stroke() }
function box(c, x, y, w, h, fill = '#fff4dc', r = 3) { c.beginPath(); c.roundRect(x, y, w, h, r); c.fillStyle = fill; c.fill(); c.stroke() }
function label(c, text, x, y, size = 11, color = outline) { c.font = `700 ${size}px system-ui`; c.textAlign = 'center'; c.fillStyle = color; c.fillText(text, x, y) }
function star(c, x, y, r = 5, turn = 0, fill = '#f4ce54') {
  c.beginPath()
  for (let i = 0; i < 10; i++) { const a = turn + i * Math.PI / 5 - Math.PI / 2, size = i % 2 ? r * .45 : r; const xx = x + Math.cos(a) * size, yy = y + Math.sin(a) * size; if (!i) c.moveTo(xx, yy); else c.lineTo(xx, yy) }
  c.closePath(); c.fillStyle = fill; c.fill(); c.stroke()
}
function heart(c, x, y, size) {
  c.beginPath(); c.moveTo(x, y + size * .6)
  c.bezierCurveTo(x - size * 1.3, y - size * .15, x - size * .55, y - size, x, y - size * .35)
  c.bezierCurveTo(x + size * .55, y - size, x + size * 1.3, y - size * .15, x, y + size * .6)
  c.fillStyle = '#ee6585'; c.fill(); c.stroke()
}
function cloud(c, x, y, fill = '#f5f5fa') {
  c.beginPath(); c.moveTo(x - 13, y + 5)
  c.bezierCurveTo(x - 23, y + 4, x - 19, y - 8, x - 11, y - 6)
  c.bezierCurveTo(x - 10, y - 18, x + 5, y - 17, x + 8, y - 8)
  c.bezierCurveTo(x + 20, y - 14, x + 25, y + 5, x + 13, y + 5)
  c.closePath(); c.fillStyle = fill; c.fill(); c.stroke()
}
function mouth(c, kind = 'smile', amount = 1) {
  if (kind === 'o') { oval(c, 0, 12, 3 + amount * 2, 4 + amount * 4, '#70465a'); return }
  c.beginPath(); c.moveTo(-7, 11)
  c.quadraticCurveTo(0, kind === 'frown' ? 5 : 20, 7, 11); c.stroke()
}
function brows(c, angry = true) { line(c, -19, -9, -6, angry ? -4 : -11); line(c, 6, angry ? -4 : -11, 19, -9) }
function arms(c, phase = 0, raised = false) {
  const y = raised ? -20 : 17
  line(c, -27, 5, -36, y + Math.sin(phase) * 5); oval(c, -36, y + Math.sin(phase) * 5, 4, 3)
  line(c, 27, 5, 36, y - Math.sin(phase) * 5); oval(c, 36, y - Math.sin(phase) * 5, 4, 3)
}
function feet(c, phase, energetic = false) {
  const move = Math.sin(phase) * (energetic ? 5 : 3)
  line(c, -12, 25, -16 - move, 34); oval(c, -17 - move, 35, 7, 3, '#f2c38c')
  line(c, 12, 25, 16 + move, 34); oval(c, 17 + move, 35, 7, 3, '#f2c38c')
}
function notes(c, t, x = 28, y = -26) {
  label(c, '♪', x + Math.sin(t * 6) * 3, y - t * 5, 17, '#b66c9b')
  label(c, '♫', x - 12, y - 10 + Math.sin(t * 5) * 3, 15, '#518d9e')
}
function hat(c, wizard = false) {
  c.beginPath(); c.moveTo(-18, -29); c.lineTo(wizard ? -8 : 3, -47); c.lineTo(19, -29); c.closePath()
  c.fillStyle = wizard ? '#8c76c9' : '#ee9d66'; c.fill(); c.stroke()
  if (wizard) { star(c, 0, -35, 3); line(c, -21, -28, 22, -28) }
  else { oval(c, 3, -47, 3, 3, '#f4ce54'); line(c, -7, -39, 12, -33); line(c, -13, -33, 15, -29) }
}
function cape(c, t, opacity) {
  c.save(); c.globalAlpha *= opacity; c.fillStyle = '#d95270'; c.strokeStyle = outline; c.lineWidth = 2
  c.beginPath(); c.moveTo(-23, -10); c.lineTo(-45, 25 + Math.sin(t * 11) * 4); c.lineTo(-29, 19); c.lineTo(-13, 28); c.lineTo(20, -9); c.closePath(); c.fill(); c.stroke(); c.restore()
}

function paint(c, id, t) {
  const p = t * Math.PI * 4, swing = Math.sin(p)
  switch (id) {
    case 'grin': mouth(c); arms(c, p); break
    case 'double-take': label(c, '!', -31, -31 + swing * 3, 19); label(c, '?', 31, -29 - swing * 3, 16); mouth(c, 'o', .4); break
    case 'furrow': brows(c); mouth(c, 'frown'); line(c, 28, -26, 34, -32); break
    case 'grumble': {
      brows(c); mouth(c, 'frown'); oval(c, 31, -27, 12, 9, '#e8e8ef')
      c.beginPath(); for (let i = 0; i < 16; i++) { const a = i * 2.2 + t * 2; c.lineTo(31 + Math.sin(a) * 8, -27 + Math.cos(a * 1.3) * 5) }; c.stroke(); break
    }
    case 'tomato': mouth(c); oval(c, -20, 11, 6, 3, '#f3a4ad'); oval(c, 20, 11, 6, 3, '#f3a4ad'); line(c, -32, 18, -22, 5); line(c, 32, 18, 22, 5); break
    case 'stomp': brows(c); feet(c, p * 1.7, true); c.beginPath(); c.ellipse(0, 40, 25 + swing * 3, 3, 0, 0, Math.PI * 2); c.stroke(); break
    case 'foam-bat': {
      brows(c); line(c, 27, 8, 32, -3); c.save(); c.translate(32, -3); c.rotate(-.65 + swing * .45)
      box(c, -4, -29, 8, 29, '#f0bf59', 4); c.strokeStyle = '#c35b71'; line(c, -3, -21, 3, -19); line(c, -3, -14, 3, -12); c.restore(); oval(c, 32, -3, 4, 3); break
    }
    case 'enough-sign': line(c, 28, 20, 28, -14); box(c, -32, -43, 66, 23, '#fff0bd'); label(c, 'YETER!', 1, -27, 12); oval(c, 28, 13, 4, 3); break
    case 'sulk': brows(c); mouth(c, 'frown'); line(c, -25, 8, 15, 21); line(c, 25, 8, -15, 21); oval(c, -15, 21, 5, 3); oval(c, 15, 21, 5, 3); break
    case 'eye-twitch': line(c, 21, -6, 27 + swing * 2, -11); line(c, 23, 1, 30, 0); mouth(c, 'frown'); break
    case 'rattle': box(c, -10, 8, 20, 10, '#f6f5ed'); for (let x = -5; x < 10; x += 5) line(c, x, 8, x, 18); line(c, -33, -3, -38, swing * 4); line(c, 33, -3, 38, -swing * 4); break
    case 'steam': brows(c); for (const side of [-1, 1]) { c.save(); c.translate(side * 34, -13 - Math.sin(t * Math.PI) * 9); c.scale(.5, .5); cloud(c, 0, 0); c.restore() }; mouth(c, 'frown'); break
    case 'puff-up': oval(c, -22, 4, 6, 5, '#f4b8ac'); oval(c, 22, 4, 6, 5, '#f4b8ac'); box(c, -13, -40, 26, 8, '#f5e6c7'); box(c, -10, -38, 20 * t, 4, '#db7070', 1); mouth(c, 'o', .1); break
    case 'tantrum': brows(c); arms(c, p * 3, true); feet(c, p * 2, true); label(c, '!', -32, -29, 17); label(c, '!', 32, -32, 17); mouth(c, 'o', .5); break
    case 'breathe': mouth(c, 'o', .15); for (let i = 0; i < 3; i++) oval(c, 24 + i * 7, 8 - i * 7 - swing * 2, 2 + i * .5, 2 + i * .5, '#d7e9e7'); break
    case 'dizzy-spin': c.beginPath(); c.ellipse(0, -37, 28, 6, t * .3, .2, 5.5); c.stroke(); star(c, 25 * Math.cos(t * 5), -37 + 5 * Math.sin(t * 5), 4); mouth(c, 'o', .2); break
    case 'spiral-stare': mouth(c, 'o', .15); break
    case 'orbit-stars': for (let i = 0; i < 3; i++) { const a = t * 4 + i * Math.PI * 2 / 3; star(c, Math.cos(a) * 30, -35 + Math.sin(a) * 7, 4.5, a) }; mouth(c, 'frown'); break
    case 'queasy': oval(c, -21, 12, 6, 4, '#a4c693'); oval(c, 21, 12, 6, 4, '#a4c693'); c.beginPath(); c.moveTo(-10, 12); c.bezierCurveTo(-3, 3 + swing * 2, 2, 20, 10, 11); c.stroke(); break
    case 'wobble': line(c, -38, 4, -42, 14); line(c, 38, 6, 42, 18); feet(c, p); mouth(c, 'o', .1); break
    case 'trip': feet(c, -p, true); c.strokeStyle = '#a87935'; c.lineWidth = 4; c.beginPath(); c.arc(24, 35, 10, 0, Math.PI); c.stroke(); c.strokeStyle = outline; star(c, -31, 21, 5); break
    case 'faint': label(c, '...', 0, -38, 15); line(c, -10, 13, 10, 13); arms(c, 0); break
    case 'revive': line(c, 27, 7, 23, -21); oval(c, 23, -21, 4, 3); label(c, '?', -30, -27 - t * 4, 15); mouth(c, 'o', .1); break
    case 'glare': brows(c); mouth(c, 'frown'); line(c, 25, 10, 37, 3); line(c, 37, 3, 43, 4); break
    case 'cling': line(c, -21, -45, -21, -17); line(c, 21, -45, 21, -17); line(c, -27, 5, -21, -17); line(c, 27, 5, 21, -17); oval(c, -21, -17, 4, 3); oval(c, 21, -17, 4, 3); mouth(c, 'o', .2); break
    case 'scared': arms(c, p * 2); mouth(c, 'o'); oval(c, -28, -19 - t * 5, 2, 4, '#9fcee8'); oval(c, 28, -25 - t * 4, 2, 4, '#9fcee8'); break
    case 'swim': arms(c, p * 1.5); mouth(c); for (let i = 0; i < 4; i++) oval(c, -35 + i * 23, 26 + Math.sin(p + i) * 4, 2.5, 2.5, '#d5e7ed'); break
    case 'hero': line(c, -27, 1, -35, -17); oval(c, -35, -17, 4, 4); box(c, -7, 8, 14, 11, '#f6cd5c', 2); label(c, 'H', 0, 17, 9); mouth(c); break
    case 'pendulum': line(c, 0, -49, -15, -25); line(c, 0, -49, 15, -25); oval(c, -15, -25, 3, 3); oval(c, 15, -25, 3, 3); feet(c, p); break
    case 'panic': arms(c, p * 2.5, true); mouth(c, 'o'); label(c, '?!', 0, -38, 14); oval(c, 32, -19, 2, 4, '#9fcee8'); break
    case 'parachute': {
      line(c, -29, -33, -19, 8); line(c, 29, -33, 19, 8); c.beginPath(); c.moveTo(-30, -33); c.bezierCurveTo(-29, -55, 29, -55, 30, -33); c.quadraticCurveTo(15, -41, 0, -33); c.quadraticCurveTo(-15, -41, -30, -33); c.fillStyle = '#e7a664'; c.fill(); c.stroke(); line(c, 0, -48, 0, -33); mouth(c); break
    }
    case 'somersault': star(c, -31, -18, 4, t * 5); c.beginPath(); c.arc(0, 0, 43, .3, 1.5); c.stroke(); break
    case 'spring-landing': c.beginPath(); c.moveTo(-9, 30); for (let i = 0; i < 7; i++) c.lineTo(i % 2 ? -8 : 8, 31 + i * (1.2 + t)); c.stroke(); mouth(c); break
    case 'skid': feet(c, 1); for (let i = 0; i < 3; i++) line(c, -35 + i * 5, 30 + i * 5, -23 + i * 5, 30 + i * 5); mouth(c, 'o', .3); break
    case 'nap': c.beginPath(); c.moveTo(-16, -28); c.quadraticCurveTo(0, -50, 21, -29); c.lineTo(26, -22); c.fillStyle = '#97a4d2'; c.fill(); c.stroke(); oval(c, 26, -22, 4, 4, '#f6f3e9'); label(c, 'z Z', 29, -35 - Math.sin(t * Math.PI) * 5, 12); break
    case 'bored': box(c, 25, 9, 15, 24, '#f1dca8', 1); line(c, 26, 11, 38, 31); line(c, 38, 11, 26, 31); oval(c, 32.5, 24 + t * 5, 3, 2, '#c38c50'); mouth(c, 'frown'); break
    case 'eye-roll': brows(c, false); mouth(c, 'frown'); label(c, '...', 30, -29, 12); break
    case 'pout': oval(c, 0, 13, 8, 4 + Math.sin(t * Math.PI) * 2, '#ecadad'); line(c, -27, 4, -32, 19); line(c, -32, 19, -20, 17); line(c, 27, 4, 32, 19); line(c, 32, 19, 20, 17); break
    case 'escape': feet(c, p * 2, true); line(c, -39, 20, -30, 20); line(c, -42, 27, -32, 27); label(c, '→', 33, -29, 19); break
    case 'shuffle-dance': feet(c, p * 1.5, true); arms(c, p); notes(c, t, 31, -29); mouth(c); break
    case 'whistle': mouth(c, 'o', .1); notes(c, t); line(c, 8, 11, 16, 7); line(c, 9, 15, 17, 15); break
    case 'dream-cloud': oval(c, 23, -23, 2, 2); oval(c, 29, -30, 3, 3); c.save(); c.translate(17, -39); c.scale(.65, .65); cloud(c, 0, 0); star(c, 0, -4, 5); c.restore(); break
    case 'huge-yawn': mouth(c, 'o', Math.sin(t * Math.PI)); line(c, 28, 6, 10, 18); oval(c, 10, 18, 5, 4); break
    case 'reading': {
      c.beginPath(); c.moveTo(0, 11); c.lineTo(-25, 5); c.lineTo(-25, 27); c.lineTo(0, 32); c.lineTo(25, 27); c.lineTo(25, 5); c.closePath(); c.fillStyle = '#a0bfce'; c.fill(); c.stroke(); line(c, 0, 11, 0, 32)
      for (let i = 0; i < 3; i++) { line(c, -20, 12 + i * 5, -5, 16 + i * 5); line(c, 5, 16 + i * 5, 20, 12 + i * 5) }; oval(c, -12, 7, 8, 7, '#ffffff00'); oval(c, 12, 7, 8, 7, '#ffffff00'); line(c, -4, 7, 4, 7); break
    }
    case 'coffee-break': {
      const y = 9 - Math.sin(t * Math.PI) * 6
      oval(c, 27, y + 4, 6, 5, '#f6e3c6'); box(c, 9, y - 3, 17, 16, '#f6e3c6'); label(c, 'HB', 17.5, y + 8, 7)
      for (let i = 0; i < 2; i++) { c.beginPath(); c.moveTo(14 + i * 7, y - 6); c.bezierCurveTo(8 + i * 7, y - 10, 20 + i * 7, y - 13, 14 + i * 7, y - 18); c.stroke() }; mouth(c); break
    }
    case 'workout': for (const side of [-1, 1]) { const y = 14 - (swing + 1) * 9; line(c, side * 25, 7, side * 35, y); line(c, side * 28, y, side * 43, y); box(c, side * 33 - 2, y - 7, 4, 14, '#8d9aac', 1); box(c, side * 40 - 2, y - 5, 4, 10, '#8d9aac', 1) }; mouth(c, 'frown'); break
    case 'pirouette': c.strokeStyle = '#c3659b'; c.lineWidth = 3; c.beginPath(); c.ellipse(0, 8, 41, 12, t * .5, .3, 5.7); c.stroke(); star(c, 35, 21, 4, t * 4, '#dbb2d5'); break
    case 'explore': c.save(); c.translate(25 + swing * 4, -9); oval(c, 0, 0, 11, 11, '#b8e4ec66'); line(c, 7, 8, 17, 21); c.restore(); mouth(c, 'o', .1); break
    case 'juggle': arms(c, p); for (let i = 0; i < 3; i++) { const a = t * 5 + i * Math.PI * 2 / 3; oval(c, Math.sin(a) * 30, -23 - Math.abs(Math.cos(a)) * 22, 4, 4, colors[i]) }; mouth(c); break
    case 'party-hat': hat(c); mouth(c); c.beginPath(); c.moveTo(7, 13); c.lineTo(28, 8); c.lineTo(28, 18); c.closePath(); c.fillStyle = '#8ac6b5'; c.fill(); c.stroke(); break
    case 'confetti':
      for (let i = 0; i < 14; i++) { const x = Math.sin(i * 2.4) * (15 + t * 27), y = -43 + ((i * 7 + t * 55) % 58); c.save(); c.translate(x, y); c.rotate(i + t * 2); c.fillStyle = colors[i % colors.length]; c.fillRect(-1.5, -2.5, 3, 5); c.restore() }
      box(c, -30, 21, 12, 10, '#e3b871', 1); star(c, -27, 12, 4); mouth(c); break
    case 'heart-gift': box(c, -13, 12, 26, 19, '#e6b4ca'); line(c, 0, 12, 0, 31); line(c, -13, 19, 13, 19); heart(c, 0, -33 - t * 5, 9); mouth(c); break
    case 'magic': hat(c, true); line(c, 23, 10, 37, -20); star(c, 37, -20, 5, t); oval(c, -19, 18, 8, 6, '#f9f4e9'); oval(c, -23, 7, 2.5, 8, '#f9f4e9'); oval(c, -16, 7, 2.5, 8, '#f9f4e9'); oval(c, -19, 17, 1, 1, outline); break
    case 'mini-disco': {
      c.save(); c.globalAlpha *= .13
      for (let i = 0; i < 3; i++) { c.fillStyle = colors[i]; c.beginPath(); c.moveTo(0, -39); c.lineTo(-43 + i * 30 + swing * 4, 35); c.lineTo(-27 + i * 30 + swing * 4, 35); c.closePath(); c.fill() }; c.restore()
      oval(c, 0, -40, 8, 8, '#bbc8dc'); line(c, -7, -40, 7, -40); line(c, 0, -48, 0, -32); feet(c, p); break
    }
    case 'disguise': oval(c, -12, 4, 9, 7, '#ffffff00'); oval(c, 12, 4, 9, 7, '#ffffff00'); line(c, -3, 4, 3, 4); oval(c, -5, 15, 7, 3, '#59483e'); oval(c, 5, 15, 7, 3, '#59483e'); c.beginPath(); c.moveTo(0, 23); c.lineTo(-10, 17); c.lineTo(-10, 29); c.closePath(); c.fillStyle = '#c3697d'; c.fill(); c.stroke(); c.beginPath(); c.moveTo(0, 23); c.lineTo(10, 17); c.lineTo(10, 29); c.closePath(); c.fill(); c.stroke(); break
    case 'peek-spy': box(c, -25, -6, 20, 17, '#8e9caa'); box(c, 5, -6, 20, 17, '#8e9caa'); line(c, -5, 3, 5, 3); oval(c, -15, 3, 6, 6, '#c3e0e4'); oval(c, 15, 3, 6, 6, '#c3e0e4'); line(c, -28, 8, -22, 11); line(c, 28, 8, 22, 11); break
    case 'rubber-duck': oval(c, 24, 18 + swing * 2, 12, 7, '#efd063'); oval(c, 29, 8 + swing * 2, 7, 7, '#efd063'); oval(c, 37, 10 + swing * 2, 4, 2, '#e49a53'); oval(c, 30, 6 + swing * 2, 1, 1, outline); mouth(c); break
    case 'paper-plane': { const x = -34 + t * 66, y = -35 + Math.sin(t * Math.PI) * -7; c.beginPath(); c.moveTo(x - 10, y - 4); c.lineTo(x + 12, y); c.lineTo(x - 7, y + 7); c.lineTo(x - 3, y); c.closePath(); c.fillStyle = '#dbe8ec'; c.fill(); c.stroke(); line(c, x - 3, y, x + 12, y); c.setLineDash([2, 3]); c.beginPath(); c.moveTo(-40, -28); c.quadraticCurveTo(-27, -45, x - 11, y); c.stroke(); c.setLineDash([]); break }
    case 'bubblegum': if (t < .8) oval(c, 1, 11, 5 + Math.sin(t * Math.PI * .9) * 13, 5 + Math.sin(t * Math.PI * .9) * 12, '#eab0cecc'); else for (let i = 0; i < 5; i++) star(c, Math.cos(i * 1.25) * 20, 11 + Math.sin(i * 1.25) * 17, 2.5, t, '#eab0ce'); break
    case 'umbrella': line(c, 17, -27, 17, 25); c.beginPath(); c.arc(12, 25, 5, 0, Math.PI); c.stroke(); c.beginPath(); c.moveTo(-5, -25); c.bezierCurveTo(-5, -47, 39, -47, 39, -25); c.quadraticCurveTo(28, -32, 17, -25); c.quadraticCurveTo(6, -32, -5, -25); c.fillStyle = '#8bb9bd'; c.fill(); c.stroke(); for (let i = 0; i < 3; i++) { const x = -32 + i * 8, y = -33 + ((t * 42 + i * 12) % 45); line(c, x, y, x - 2, y + 5) }; break
    case 'accordion': { const w = 23 + swing * 5; box(c, -w / 2 - 9, 9, 10, 20, '#a5b9c6'); box(c, w / 2 - 1, 9, 10, 20, '#d9b5a0'); box(c, -w / 2 + 1, 11, w - 2, 16, '#f4ddad', 1); for (let i = 0; i < 5; i++) line(c, -w / 2 + 3 + i * (w - 6) / 4, 12, -w / 2 + 3 + i * (w - 6) / 4, 26); notes(c, t, 29, -26); break }
  }
}
