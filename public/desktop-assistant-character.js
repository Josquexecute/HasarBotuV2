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
    const pose = motion.matches ? neutral : bot
    pose.draw(context, size, size)
  }
  const sizeObserver = new ResizeObserver(() => {
    if (!document.hidden) draw()
  })
  const animate = (time) => {
    frame = undefined
    if (disposed || document.hidden || motion.matches) return
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
    if (motion.matches) {
      // Use the neutral pose so a mid-blink or squash cannot get frozen.
      draw()
      return
    }
    frame = window.requestAnimationFrame(animate)
  }
  const unsubscribe = assistant.onGaze(({ x, y }) => {
    if (motion.matches || disposed) return
    bot.lookX = x
    bot.lookY = y
  })
  const greetOnHover = () => {
    if (motion.matches) return
    window.clearTimeout(hoverTimer)
    hoverTimer = window.setTimeout(() => bot.triggerEmote('happy'), 1200)
  }
  const leave = () => window.clearTimeout(hoverTimer)
  const press = (event) => {
    if (event.button === 0 && !motion.matches) bot.squash()
  }
  const onVisibility = () => {
    if (document.hidden) pause()
    else resume()
  }
  const dispose = () => {
    disposed = true
    pause()
    unsubscribe()
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
