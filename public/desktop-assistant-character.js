import { BotEngine } from './vendor/coucou/mochi/engine.js'
import { AssistantMotion } from './desktop-assistant-motion.js'

const button = document.querySelector('#assistant')
const canvas = document.querySelector('#mochi')
const assistant = window.hasarbotuAssistant
const context = canvas.getContext('2d')

// The regular-browser preview keeps the same character but stays unavailable.
if (context && !assistant) new BotEngine().draw(context, canvas.width, canvas.height)

if (assistant && context) {
  const bot = new BotEngine()
  const neutral = new BotEngine()
  const gestures = new AssistantMotion(bot)
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  let frame
  let idleTimer
  let hoverTimer
  let previousTime = performance.now()
  let lastDraw = 0
  let disposed = false
  let personalReducedMotion = false
  let size = canvas.clientWidth
  let ratio = window.devicePixelRatio || 1
  const reduced = () => motion.matches || personalReducedMotion

  const draw = () => {
    const pixels = Math.round(size * ratio)
    if (canvas.width !== pixels || canvas.height !== pixels) {
      canvas.width = pixels
      canvas.height = pixels
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, size, size)
    const pose = reduced() ? neutral : bot
    pose.draw(context, size, size)
  }
  const sizeObserver = new ResizeObserver(() => {
    size = canvas.clientWidth
    ratio = window.devicePixelRatio || 1
    if (!document.hidden) draw()
  })
  const wake = () => {
    window.clearTimeout(idleTimer)
    idleTimer = undefined
    if (!disposed && !document.hidden && !reduced() && frame === undefined) {
      lastDraw = -Infinity
      frame = window.requestAnimationFrame(animate)
    }
  }
  const animate = (time) => {
    frame = undefined
    if (disposed || document.hidden || reduced()) return
    // The engine also starts delayed emotes internally; check those at 8 Hz while idle.
    // Only active motion uses display frames, drawing at up to 60 fps.
    const interval = 1000 / 60
    const elapsed = time - lastDraw
    // RAF timestamps are fractional. Keep the cadence instead of losing alternate
    // 60 Hz frames to rounding, or drifting below 60 fps on 144 Hz displays.
    if (elapsed >= interval - 0.5) {
      const wasBusy = bot.busy
      const previousEyes = bot.eyeOverride
      gestures.tick()
      bot.update(Math.min((time - previousTime) / 1000, 0.1))
      previousTime = time
      lastDraw = Number.isFinite(lastDraw) ? lastDraw + Math.max(1, Math.floor((elapsed + 0.5) / interval)) * interval : time
      if (wasBusy || bot.busy || bot.eyeOverride !== previousEyes) draw()
    }
    if (bot.busy) frame = window.requestAnimationFrame(animate)
    else idleTimer = window.setTimeout(wake, 125)
  }
  const pause = () => {
    if (frame !== undefined) window.cancelAnimationFrame(frame)
    frame = undefined
    window.clearTimeout(idleTimer)
    idleTimer = undefined
    window.clearTimeout(hoverTimer)
  }
  const resume = () => {
    pause()
    if (disposed || document.hidden) return
    previousTime = performance.now()
    lastDraw = 0
    if (reduced()) {
      gestures.reset()
      // Use the neutral pose so a mid-blink or squash cannot get frozen.
      draw()
      return
    }
    wake()
  }
  const unsubscribe = assistant.onGaze(({ x, y }) => {
    if (reduced() || disposed || bot.lookX === x && bot.lookY === -y) return
    bot.lookX = x
    // Screen Y grows downwards; the engine's pitch draws positive Y upwards.
    bot.lookY = -y
    wake()
  })
  const greetOnHover = () => {
    if (reduced() || disposed || document.hidden) return
    gestures.hovered = true
    gestures.activity()
    window.clearTimeout(hoverTimer)
    hoverTimer = window.setTimeout(() => { gestures.curious(); wake() }, 650)
  }
  const leave = () => { window.clearTimeout(hoverTimer); gestures.hovered = false }
  const press = (event) => {
    if (event.button === 0 && !reduced() && !disposed && !document.hidden) {
      window.clearTimeout(hoverTimer)
      gestures.press()
      wake()
    }
  }
  const unsubscribeMotion = assistant.onMotion(value => {
    if (reduced() || disposed || document.hidden) return
    if (value.type === 'drag') gestures.drag(value.x)
    else if (value.type === 'release') gestures.release()
    else if (value.type === 'success') gestures.success()
    wake()
  })
  const onVisibility = () => {
    if (document.hidden) { pause(); gestures.reset() }
    else resume()
  }
  const unsubscribeAppearance = assistant.onAppearance(({ accentColor, characterColor, reduceMotion }) => {
    personalReducedMotion = reduceMotion
    const channels = [1, 3, 5].map(i => parseInt(characterColor.slice(i, i + 2), 16) / 255)
    // Keep the chosen body color intact; adapt the eyes instead of whitening it.
    const linear = channels.map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4)
    const luminance = linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722
    bot.bodyColor = neutral.bodyColor = channels
    bot.eyeColor = neutral.eyeColor = luminance > .179 ? '#111111' : '#ffffff'
    canvas.style.filter = `drop-shadow(0 0 5px ${accentColor}80)`
    button.style.setProperty('--assistant-focus', accentColor)
    draw()
    resume()
  })
  const dispose = () => {
    disposed = true
    pause()
    unsubscribe()
    unsubscribeAppearance()
    unsubscribeMotion()
    button.removeEventListener('pointerenter', greetOnHover)
    button.removeEventListener('pointerleave', leave)
    button.removeEventListener('pointerdown', press)
    document.removeEventListener('visibilitychange', onVisibility)
    motion.removeEventListener('change', resume)
    sizeObserver.disconnect()
    window.removeEventListener('resize', resize)
  }
  const resize = () => {
    size = canvas.clientWidth
    ratio = window.devicePixelRatio || 1
    if (!document.hidden) draw()
  }

  draw()
  if (!motion.matches) bot.greet()
  button.addEventListener('pointerenter', greetOnHover)
  button.addEventListener('pointerleave', leave)
  button.addEventListener('pointerdown', press)
  document.addEventListener('visibilitychange', onVisibility)
  motion.addEventListener('change', resume)
  // Track physical pixels even when monitor changes leave the CSS size intact.
  sizeObserver.observe(canvas, { box: 'device-pixel-content-box' })
  window.addEventListener('resize', resize)
  window.addEventListener('pagehide', dispose, { once: true })
  resume()
}
