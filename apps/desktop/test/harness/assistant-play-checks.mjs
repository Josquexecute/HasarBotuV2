export async function checkGazeRendering() {
  const { TOUCH_REACTIONS } = await import('/desktop-assistant-play.js')
  const { AssistantMotion } = await import('/desktop-assistant-motion.js')
  const { AssistantSkinEngine } = await import('/desktop-assistant-appearance.js')
  const descriptor = Object.getOwnPropertyDescriptor(performance, 'now')
  let now = 0, frames = 0
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 120
  const context = canvas.getContext('2d', { willReadFrequently: true })
  Object.defineProperty(performance, 'now', { configurable: true, value: () => now })
  const require = (condition, name) => { if (!condition) throw Error(name) }
  const draw = motion => {
    context.clearRect(0, 0, 120, 120); motion.draw(context, 120, 120); frames++
    return new Uint8Array(context.getImageData(0, 0, 120, 120).data)
  }
  try {
    for (const scene of TOUCH_REACTIONS) {
      now = 0
      const bot = new AssistantSkinEngine(), motion = new AssistantMotion(bot, () => now, () => .5)
      bot.nextBlink = Infinity
      motion.control({ type: 'play', id: scene.id })
      for (const fraction of [.3, .6, .93]) {
        now = scene.duration * fraction; motion.tick()
        motion.gaze(1, -1); motion.updateGaze(); bot.update(.016)
        require(bot.lookX === 0 && bot.lookY === 0, scene.id + ': cursor influenced animation')
        const first = draw(motion)
        motion.gaze(-.9, .7); motion.updateGaze()
        const second = draw(motion)
        require(first.every((value, index) => value === second[index]), scene.id + ': cursor changed rendered eyes')
        require(motion.play.frame.eye, scene.id + ': scene has no eye expression')
      }
      now = scene.duration + 1; motion.tick(); motion.updateGaze(); bot.update(.016)
      require(!motion.animating && bot.lookX === -.9 && bot.lookY === .7, scene.id + ': gaze failed to resume')
    }
    return { passed: true, reactions: TOUCH_REACTIONS.length, frames, cursorIndependentPixels: true, cachedCursorResumed: true }
  } finally {
    if (descriptor) Object.defineProperty(performance, 'now', descriptor)
    else delete performance.now
  }
}

// Rendered character artwork, never a capture of the desktop or application UI.
export async function checkPlayRendering(exportArtwork = false) {
  const { AssistantPlay, TOUCH_REACTIONS } = await import('/desktop-assistant-play.js')
  const { AssistantMotion } = await import('/desktop-assistant-motion.js')
  const { AssistantSkinEngine, drawAssistantAppearance } = await import('/desktop-assistant-appearance.js')
  const require = (condition, message) => { if (!condition) throw new Error(message) }
  const skin = document.createElement('canvas'); skin.width = 256; skin.height = 198
  const art = skin.getContext('2d'); art.fillStyle = '#15294b'; art.fillRect(0, 0, 256, 198)
  art.fillStyle = '#f3d45b'; art.fillRect(90, 0, 75, 198)
  const variants = [
    { body: '#eff2fa', eye: '#cc2277', skin: null },
    { body: '#111111', eye: '#111111', skin: null },
    { body: '#ffffff', eye: '#ffffff', skin },
  ]
  const target = document.createElement('canvas'), context = target.getContext('2d', { willReadFrequently: true })
  const pages = [], signatures = new Map(), fractions = [.08, .3, .6, .93]
  const overview = exportArtwork ? document.createElement('canvas') : null
  if (overview) { overview.width = 960; overview.height = 1160; const ink = overview.getContext('2d'); ink.fillStyle = '#e7eaf1'; ink.fillRect(0, 0, 960, 1160) }
  let frames = 0, drawingMs = 0
  const hash = bytes => { let result = 0; for (const value of bytes) result = (Math.imul(result, 31) + value) >>> 0; return result }
  for (const [variantIndex, variant] of variants.entries()) {
    const bot = new AssistantSkinEngine()
    bot.bodyColor = [1, 3, 5].map(i => parseInt(variant.body.slice(i, i + 2), 16) / 255)
    bot.eyeColor = variant.eye
    bot.nextBlink = Infinity
    const savedBody = bot.bodyColor
    let now = 0
    const play = new AssistantPlay(bot, () => now, () => .5)
    const original = (ctx, width, height) => bot.draw(ctx, width, height)
    for (const ratio of [1, 2]) {
      target.width = target.height = 120 * ratio
      const render = () => {
        context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, 120, 120)
        drawAssistantAppearance(context, 120, bot, '#635bff', variant.skin)
        const started = performance.now(); play.draw(context, 120, 120, original); drawingMs += performance.now() - started
        return context.getImageData(0, 0, target.width, target.height).data
      }
      for (const [index, definition] of TOUCH_REACTIONS.entries()) {
        const neutral = hash(render()), started = now, sampleHashes = []
        require(play.start(definition.id, true), `cannot play ${definition.id}`)
        for (const [column, fraction] of fractions.entries()) {
          now = started + definition.duration * fraction
          const pixels = render(); frames++
          for (let i = 0; i < target.width; i++) {
            for (const offset of [i, (target.height - 1) * target.width + i, i * target.width, i * target.width + target.width - 1]) {
              require(pixels[offset * 4 + 3] === 0, `scene clips at window edge: ${definition.id}, variant ${variantIndex}, ratio ${ratio}, time ${fraction}`)
            }
          }
          require(bot.bodyColor === savedBody && bot.eyeColor === variant.eye && bot.skin === variant.skin, `personal appearance changed: ${definition.id}`)
          if (variantIndex === 0 && ratio === 1) {
            sampleHashes.push(hash(pixels))
            if (exportArtwork) {
              const page = Math.floor(index / 8), row = index % 8
              if (!pages[page]) {
                const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 8 * 145
                const ink = canvas.getContext('2d'); ink.fillStyle = '#e7eaf1'; ink.fillRect(0, 0, canvas.width, canvas.height)
                pages[page] = canvas
              }
              const ink = pages[page].getContext('2d')
              ink.drawImage(target, column * 120, row * 145)
              if (column === 0) { ink.fillStyle = '#26324a'; ink.font = '12px system-ui'; ink.fillText(`${index + 1}. ${definition.name}`, 6, row * 145 + 135) }
              if (column === 2) {
                const ink = overview.getContext('2d'), x = index % 8 * 120, y = Math.floor(index / 8) * 145
                ink.drawImage(target, x, y); ink.fillStyle = '#26324a'; ink.font = '10px system-ui'; ink.fillText(`${index + 1}. ${definition.id}`, x + 2, y + 134, 116)
              }
            }
          }
        }
        if (sampleHashes.length) {
          require(new Set(sampleHashes).size >= 2, `scene has no temporal change: ${definition.id}`)
          signatures.set(definition.id, sampleHashes.join(':'))
        }
        now = started + definition.duration + 1; play.tick()
        require(!play.animating && play.sequence === null, `scene does not finish: ${definition.id}`)
        require(hash(render()) === neutral, `scene does not restore original drawing: ${definition.id}`)
      }
    }
  }
  require(TOUCH_REACTIONS.length >= 61 && new Set(signatures.values()).size === TOUCH_REACTIONS.length, 'reaction artwork is duplicated')
  let composedShakeFrames = 0
  const composed = exportArtwork ? document.createElement('canvas') : null
  if (composed) { composed.width = 360; composed.height = 435; const ink = composed.getContext('2d'); ink.fillStyle = '#e7eaf1'; ink.fillRect(0, 0, 360, 435) }
  for (const [index, definition] of TOUCH_REACTIONS.filter(item => item.group === 'shake').entries()) {
    const bot = new AssistantSkinEngine()
    bot.bodyColor = [.937, .949, .98]; bot.eyeColor = '#cc2277'; bot.nextBlink = Infinity
    bot.tilt = .14; bot.sx = 1.06; bot.sy = 1.1; bot.ox = -.02; bot.oy = .02; bot.nausea = .6
    let now = 0
    const motion = new AssistantMotion(bot, () => now, () => .5)
    bot.nausea = .6
    motion.play.start(definition.id, true)
    for (const ratio of [1, 2]) for (const fraction of fractions) {
      target.width = target.height = 120 * ratio
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      now = definition.duration * fraction
      motion.draw(context, 120, 120); composedShakeFrames++
      const pixels = context.getImageData(0, 0, target.width, target.height).data
      for (let i = 0; i < target.width; i++) for (const offset of [i, (target.height - 1) * target.width + i, i * target.width, i * target.width + target.width - 1]) {
        require(pixels[offset * 4 + 3] === 0, `legacy nausea and ${definition.id} clip together at ${fraction}, ratio ${ratio}`)
      }
      if (composed && ratio === 1 && fraction === .6) {
        const ink = composed.getContext('2d'), x = index % 3 * 120, y = Math.floor(index / 3) * 145
        ink.drawImage(target, x, y); ink.fillStyle = '#26324a'; ink.font = '10px system-ui'; ink.fillText(definition.id, x + 2, y + 134)
      }
    }
  }
  require(drawingMs / frames < 16, 'reaction rendering exceeds frame budget')
  return { passed: true, reactions: TOUCH_REACTIONS.length, frames, variants: variants.length, pixelRatios: [1, 2],
    uniqueAnimations: signatures.size, averageDrawMs: drawingMs / frames, composedShakeFrames,
    artwork: [...pages.map((page, index) => ({ name: `reaction-artwork-${index + 1}.png`, data: page.toDataURL('image/png').split(',')[1] })),
      ...(overview ? [{ name: 'reaction-overview.png', data: overview.toDataURL('image/png').split(',')[1] }] : []),
      ...(composed ? [{ name: 'reaction-composition.png', data: composed.toDataURL('image/png').split(',')[1] }] : [])] }
}
