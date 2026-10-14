import { BotEngine } from './vendor/coucou/mochi/engine.js'

const button = document.querySelector('#assistant')
const canvas = document.querySelector('#mochi')
const assistant = window.hasarbotuAssistant
const context = canvas.getContext('2d')

// The regular-browser preview keeps the same character but stays unavailable.
if (context && !assistant) new BotEngine().draw(context, canvas.width, canvas.height)

if (assistant && context) {
  const bot = new BotEngine()
  const neutral = new BotEngine()
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  let frame
  let hoverTimer
  let previousTime = performance.now()
  let lastDraw = 0
  let disposed = false
  let personalReducedMotion = false
  const reduced = () => motion.matches || personalReducedMotion

  const draw = () => {
    const size = canvas.clientWidth
    const ratio = window.devicePixelRatio || 1
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
    if (!document.hidden) draw()
  })
  const animate = (time) => {
    frame = undefined
    if (disposed || document.hidden || reduced()) return
    // Idle still needs occasional updates for blinks; movement gets 30 fps.
    const interval = bot.busy ? 1000 / 30 : 1000 / 8
    if (time - lastDraw >= interval) {
      bot.update(Math.min((time - previousTime) / 1000, 0.1))
      previousTime = time
      lastDraw = time
      draw()
    }
    frame = window.requestAnimationFrame(animate)
  }
  const pause = () => {
    if (frame !== undefined) window.cancelAnimationFrame(frame)
    frame = undefined
    window.clearTimeout(hoverTimer)
  }
  const resume = () => {
    pause()
    if (disposed || document.hidden) return
    previousTime = performance.now()
    if (reduced()) {
      // Use the neutral pose so a mid-blink or squash cannot get frozen.
      draw()
      return
    }
    frame = window.requestAnimationFrame(animate)
  }
  const unsubscribe = assistant.onGaze(({ x, y }) => {
    if (reduced() || disposed) return
    bot.lookX = x
    // Screen Y grows downwards; the engine's pitch draws positive Y upwards.
    bot.lookY = -y
  })
  const greetOnHover = () => {
    if (reduced()) return
    window.clearTimeout(hoverTimer)
    hoverTimer = window.setTimeout(() => bot.triggerEmote('happy'), 1200)
  }
  const leave = () => window.clearTimeout(hoverTimer)
  const press = (event) => {
    if (event.button === 0 && !reduced()) bot.squash()
  }
  const onVisibility = () => {
    if (document.hidden) pause()
    else resume()
  }
  const unsubscribeAppearance = assistant.onAppearance(({ accentColor, characterColor, reduceMotion }) => {
    personalReducedMotion = reduceMotion
    // Match the preview's pastel palette; fixed dark eyes stay visible for every choice.
    const color = characterColor.toLowerCase() === '#eff2fa' ? null : [1, 3, 5].map(i => (parseInt(characterColor.slice(i, i + 2), 16) * .4 + 153) / 255)
    bot.bodyColor = color
    neutral.bodyColor = color
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
    button.removeEventListener('pointerenter', greetOnHover)
    button.removeEventListener('pointerleave', leave)
    button.removeEventListener('pointerdown', press)
    document.removeEventListener('visibilitychange', onVisibility)
    motion.removeEventListener('change', resume)
    sizeObserver.disconnect()
    window.removeEventListener('resize', draw)
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
  window.addEventListener('resize', draw)
  window.addEventListener('pagehide', dispose, { once: true })
  resume()
}
