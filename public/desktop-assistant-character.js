import { AssistantSkinEngine as BotEngine } from './desktop-assistant-appearance.js'
import { AssistantMotion } from './desktop-assistant-motion.js'
import { drawAssistantAppearance, assistantEyeColor } from './desktop-assistant-appearance.js'

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
  let working = false
  let accent = '#635bff'
  let customImage
  let customImageSource
  let imageGeneration = 0
  const defaultTitle = button.title
  const defaultLabel = button.getAttribute('aria-label') || 'HasarBotu yardımcı menüsünü aç'
  let size = canvas.clientWidth
  let ratio = window.devicePixelRatio || 1
  const reduced = () => motion.matches || personalReducedMotion
  const still = () => reduced() || gestures.play.paused
  gestures.play.onChange = state => {
    button.dataset.mood = state.mood
    button.dataset.reaction = state.reaction || ''
    button.dataset.paused = String(state.paused)
    assistant.playState(state)
  }

  const draw = () => {
    const pixels = Math.round(size * ratio)
    if (canvas.width !== pixels || canvas.height !== pixels) {
      canvas.width = pixels
      canvas.height = pixels
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, size, size)
    const pose = still() ? neutral : bot
    if (still()) {
      neutral.eyeOverride = gestures.sleeping ? 'closed' : null
      neutral.eyeOverrideUntil = gestures.sleeping ? Infinity : 0
    }
    button.dataset.sleeping = String(gestures.sleeping)
    button.dataset.reducedMotion = String(reduced())
    drawAssistantAppearance(context, size, pose, accent, customImage)
    if (still()) pose.draw(context, size, size)
    else gestures.draw(context, size, size)
  }
  const sizeObserver = new ResizeObserver(() => {
    size = canvas.clientWidth
    ratio = window.devicePixelRatio || 1
    if (!document.hidden) draw()
  })
  const wake = () => {
    window.clearTimeout(idleTimer)
    idleTimer = undefined
    if (!disposed && !document.hidden && !still() && frame === undefined) {
      lastDraw = -Infinity
      frame = window.requestAnimationFrame(animate)
    }
  }
  const animate = (time) => {
    frame = undefined
    if (disposed || document.hidden || still()) return
    // The engine also starts delayed emotes internally; check those at 8 Hz while idle.
    // Only active motion uses display frames, drawing at up to 60 fps.
    const interval = 1000 / 60
    const elapsed = time - lastDraw
    // RAF timestamps are fractional. Keep the cadence instead of losing alternate
    // 60 Hz frames to rounding, or drifting below 60 fps on 144 Hz displays.
    if (elapsed >= interval - 0.5) {
      const wasBusy = bot.busy
      const wasPlaying = gestures.animating
      const previousEyes = bot.eyeOverride
      gestures.tick()
      gestures.updateGaze()
      button.dataset.sleeping = String(gestures.sleeping)
      bot.update(Math.min((time - previousTime) / 1000, 0.1))
      previousTime = time
      lastDraw = Number.isFinite(lastDraw) ? lastDraw + Math.max(1, Math.floor((elapsed + 0.5) / interval)) * interval : time
      if (wasBusy || bot.busy || wasPlaying || gestures.animating || bot.eyeOverride !== previousEyes) draw()
    }
    if (bot.busy || gestures.animating) frame = window.requestAnimationFrame(animate)
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
    gestures.play.setReduced(reduced())
    pause()
    if (disposed || document.hidden) return
    previousTime = performance.now()
    lastDraw = 0
    if (still()) {
      gestures.reset(true)
      // Use the neutral pose so a mid-blink or squash cannot get frozen.
      draw()
      return
    }
    gestures.work(working)
    wake()
  }
  const unsubscribe = assistant.onGaze(({ x, y }) => {
    if (disposed) return
    // Screen Y grows downwards; the engine's pitch draws positive Y upwards.
    gestures.gaze(x, -y)
    if (still() || document.hidden || gestures.sleeping) return
    wake()
  })
  const greetOnHover = () => {
    if (still() || disposed || document.hidden || gestures.sleeping) return
    gestures.hovered = true
    gestures.activity()
    window.clearTimeout(hoverTimer)
    hoverTimer = window.setTimeout(() => { gestures.curious(); wake() }, 650)
  }
  const leave = () => { window.clearTimeout(hoverTimer); gestures.hovered = false }
  const press = (event) => {
    if (event.button === 0 && still() && !disposed && !document.hidden) {
      gestures.activity(true)
      gestures.reset()
      draw()
      return
    }
    if (event.button === 0 && !still() && !disposed && !document.hidden) {
      window.clearTimeout(hoverTimer)
      gestures.press()
      button.dataset.sleeping = 'false'
      wake()
    }
  }
  const activate = (event) => {
    if (event.detail !== 0 || disposed || document.hidden) return
    if (still()) { gestures.activity(true); gestures.reset(); draw(); return }
    gestures.press()
    button.dataset.sleeping = 'false'
    gestures.release()
    wake()
  }
  const unsubscribeMotion = assistant.onMotion(value => {
    if (disposed) return
    if (value.type === 'working') working = value.active
    if (value.type === 'error') {
      button.title = value.active ? 'Son işlem tamamlanamadı · Açıklama için tıkla' : defaultTitle
      button.setAttribute('aria-label', value.active ? 'Son işlem hatasının açıklamasını aç' : defaultLabel)
    }
    if (still() || disposed || document.hidden) return
    if (value.type === 'drag') gestures.drag(value.x, value)
    else if (value.type === 'release') gestures.release()
    else if (value.type === 'success') gestures.success()
    else if (value.type === 'working') gestures.work(value.active)
    else if (value.type === 'edge') gestures.edge(value.x)
    else if (value.type === 'error' && value.active) gestures.react('error')
    else if (value.type === 'notification' || value.type === 'celebrate') gestures.react(value.type)
    wake()
  })
  const unsubscribePlay = assistant.onPlay(command => {
    if (disposed) return
    gestures.play.setReduced(reduced())
    if (gestures.control(command)) { draw(); resume() }
  })
  const onVisibility = () => {
    if (document.hidden) { pause(); gestures.reset(true) }
    else resume()
  }
  const unsubscribeAppearance = assistant.onAppearance(({ accentColor, characterColor, eyeColor, reduceMotion, customImage: imageSource }) => {
    accent = accentColor
    if (imageSource !== customImageSource) {
      customImageSource = imageSource
      const generation = ++imageGeneration
      customImage = undefined
      button.dataset.customImage = 'false'
      if (imageSource) {
        const image = new Image()
        image.onload = () => {
          if (disposed || generation !== imageGeneration || image.naturalWidth > 256 || image.naturalHeight > 256) return
          customImage = image
          button.dataset.customImage = 'true'
          draw()
        }
        image.src = imageSource
      }
    }
    personalReducedMotion = reduceMotion
    const channels = [1, 3, 5].map(i => parseInt(characterColor.slice(i, i + 2), 16) / 255)
    bot.bodyColor = neutral.bodyColor = channels
    bot.eyeColor = neutral.eyeColor = assistantEyeColor(characterColor, eyeColor)
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
    unsubscribePlay()
    button.removeEventListener('pointerenter', greetOnHover)
    button.removeEventListener('pointerleave', leave)
    button.removeEventListener('pointerdown', press)
    button.removeEventListener('click', activate)
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
  button.addEventListener('click', activate)
  document.addEventListener('visibilitychange', onVisibility)
  motion.addEventListener('change', resume)
  // Track physical pixels even when monitor changes leave the CSS size intact.
  sizeObserver.observe(canvas, { box: 'device-pixel-content-box' })
  window.addEventListener('resize', resize)
  window.addEventListener('pagehide', dispose, { once: true })
  resume()
}
