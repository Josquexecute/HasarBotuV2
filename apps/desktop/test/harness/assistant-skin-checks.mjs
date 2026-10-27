// Runs in the real transparent Electron renderer, without taking screenshots.
export async function checkSkinRendering(inputs = []) {
  const { BotEngine } = await import('/vendor/coucou/mochi/engine.js')
  const { AssistantSkinEngine, drawAssistantAppearance } = await import('/desktop-assistant-appearance.js')
  const { prepareAssistantTexture } = await import('/desktop-assistant-image.js')
  const canvas = () => { const c = document.createElement('canvas'); c.width = c.height = 120; return c }
  const artwork = canvas(), ink = artwork.getContext('2d')
  ink.fillStyle = '#000'; ink.fillRect(0, 0, 120, 120)
  ink.fillStyle = '#ed3434'; ink.beginPath(); ink.arc(60, 60, 48, 0, Math.PI * 2); ink.fill()
  ink.fillStyle = '#ffe600'; ink.fillRect(25, 40, 70, 28)
  ink.fillStyle = '#001c58'; ink.fillRect(30, 70, 60, 15)
  // A black line connected to the outside must survive background separation.
  ink.fillStyle = '#000'; ink.fillRect(0, 55, 82, 3)
  const sources = [artwork.toDataURL('image/jpeg', .95), artwork.toDataURL('image/webp', .95)]
  ink.clearRect(0, 0, 10, 10)
  sources.push(artwork.toDataURL('image/png'), ...inputs)
  const checks = [], require = (name, pass) => { checks.push({ name, pass: Boolean(pass) }); if (!pass) throw new Error(name) }
  for (const [index, source] of sources.entries()) {
    const image = new Image(); image.src = source; await image.decode()
    const skin = prepareAssistantTexture(image)
    const skinPixels = skin.getContext('2d').getImageData(0, 0, skin.width, skin.height).data
    if (index < 2) {
      require(`format ${index}: black JPG/WebP exterior becomes transparent`, skinPixels[3] === 0)
      const center = ((Math.floor(skin.height / 2) - 8) * skin.width + 128) * 4
      require(`format ${index}: connected black interior detail survives`, skinPixels[center + 3] === 255 && skinPixels[center] < 40)
    }
    if (index >= 3 && source.startsWith('data:image/jpeg;')) {
      require('provided Fenerbahce JPG has no opaque black outer corners', skinPixels[3] === 0)
      const colors = { black: 0, red: 0, navy: 0, yellow: 0, green: 0 }
      for (let y = 10; y < skin.height - 10; y++) for (let x = 10; x < skin.width - 10; x++) {
        const i = (y * skin.width + x) * 4, [r, g, b, a] = skinPixels.slice(i, i + 4)
        if (a < 250) continue
        if (Math.max(r, g, b) < 40) colors.black++
        if (r > 150 && g < 100 && b < 100) colors.red++
        if (b > r + 30 && b > g) colors.navy++
        if (r > 180 && g > 150 && b < 80) colors.yellow++
        if (g > r + 20 && g > b + 20) colors.green++
      }
      for (const [color, count] of Object.entries(colors)) require(`provided JPG preserves ${color} details`, count > 100)
    }
    if (index >= 3) {
      let left = skin.width, top = skin.height, right = -1, bottom = -1
      for (let y = 0; y < skin.height; y++) for (let x = 0; x < skin.width; x++) if (skinPixels[(y * skin.width + x) * 4 + 3] >= 24) {
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y)
      }
      require(`provided format ${index}: main emblem is centered and fills the body without a rectangular matte`,
        skinPixels[3] === 0 && Math.abs(left + right + 1 - skin.width) < 4 && Math.abs(top + bottom + 1 - skin.height) < 4
        && (bottom - top) / skin.height > .97 && (right - left) / skin.width > .97)
      require(`provided format ${index}: round skin covers the body sides instead of leaving white ears`,
        [8, skin.width - 9].every(x => skinPixels[(Math.floor(skin.height / 2) * skin.width + x) * 4 + 3] === 255))
    }
    for (const pose of [{}, { sx: 1.16, sy: .78, tilt: -.14, ox: .08 }, { sx: .94, sy: 1.1, oy: -.09, yaw: .6, pitch: -.2 }, { morph: .8 }, { eyeOverride: 'happy' }, { eyeOverride: 'dot', nausea: .6 }]) {
      const base = new BotEngine(), dressed = new AssistantSkinEngine()
      for (const bot of [base, dressed]) Object.assign(bot, pose, { bodyColor: [.937, .949, .98], eyeColor: '#111111' })
      dressed.skin = skin
      const a = canvas(), b = canvas()
      base.draw(a.getContext('2d'), 120, 120); dressed.draw(b.getContext('2d'), 120, 120)
      const plain = a.getContext('2d').getImageData(0, 0, 120, 120).data
      const pixels = b.getContext('2d').getImageData(0, 0, 120, 120).data
      if (index >= 3 && !Object.keys(pose).length) {
        require(`provided format ${index}: native body has no exposed base-color bands beside the emblem`, [25, 95].every(x => {
          const i = (62 * 120 + x) * 4
          return pixels[i + 3] === 255 && [0, 1, 2].some(channel => pixels[i + channel] !== plain[i + channel])
        }))
      }
      let leaks = 0, missing = 0, changed = 0, eyes = 0, leakSample = ''
      for (let i = 0; i < plain.length; i += 4) {
        if (plain[i + 3] === 0 && pixels[i + 3] > 0) { leaks++; leakSample = `${i / 4 % 120},${Math.floor(i / 4 / 120)}:${pixels[i + 3]}` }
        if (plain[i + 3] === 255 && pixels[i + 3] !== 255) missing++
        if (plain[i + 3] === 255 && plain[i] !== pixels[i]) changed++
        if (plain[i] === 17 && plain[i + 1] === 17 && plain[i + 2] === 17 && plain[i + 3] === 255
          && pixels[i] === 17 && pixels[i + 1] === 17 && pixels[i + 2] === 17 && pixels[i + 3] === 255) eyes++
      }
      require(`format ${index}: original silhouette and facial pixels retained ${JSON.stringify(pose)} (${leaks}/${missing}/${changed}/${eyes};${leakSample})`, !leaks && !missing && changed > 200 && eyes > 5)
      for (const backdrop of ['#f5f7fa', '#101318']) {
        const target = canvas(), ctx = target.getContext('2d')
        drawAssistantAppearance(ctx, 120, dressed, '#ff0000', skin)
        dressed.draw(ctx, 120, 120)
        const output = ctx.getImageData(0, 0, 120, 120).data
        let edge = 0, halo = 0
        for (let y = 0; y < 120; y++) for (let x = 0; x < 120; x++) {
          const i = (y * 120 + x) * 4
          if ((x === 0 || y === 0 || x === 119 || y === 119) && output[i + 3]) edge++
          if (!pixels[i + 3] && output[i] > 200 && output[i + 1] < 10 && output[i + 3] > 15 && output[i + 3] < 220) halo++
        }
        require(`format ${index}: soft rear halo, transparent edges on ${backdrop}`, !edge && halo > 50)
        const desktop = canvas(), desktopContext = desktop.getContext('2d')
        desktopContext.fillStyle = backdrop; desktopContext.fillRect(0, 0, 120, 120); desktopContext.drawImage(target, 0, 0)
        const corner = desktopContext.getImageData(0, 0, 1, 1).data
        require(`format ${index}: desktop visible through window corners on ${backdrop}`, corner[0] === parseInt(backdrop.slice(1, 3), 16) && corner[3] === 255)
      }
    }
  }
  for (const bodyColor of ['#000000', '#ffffff', '#808080']) {
    for (const eyeColor of ['#000000', '#ffffff', '#808080', '#22cc88', '#ffff00']) {
      for (const skinColor of [null, '#000000', '#ffffff']) {
        const bot = new AssistantSkinEngine()
        bot.bodyColor = [1, 3, 5].map(i => parseInt(bodyColor.slice(i, i + 2), 16) / 255)
        bot.eyeColor = eyeColor
        if (skinColor) {
          bot.skin = canvas()
          const ink = bot.skin.getContext('2d'); ink.fillStyle = skinColor; ink.fillRect(0, 0, 120, 120)
        }
        for (const shape of ['pill', 'happy', 'closed', 'dot', 'line', 'flat', 'tired', 'wink', 'cup']) {
          bot.eyeOverride = shape
          const output = canvas(), blank = canvas()
          bot.draw(output.getContext('2d'), 120, 120)
          const drawEyes = bot.drawEyes
          bot.drawEyes = () => {}
          bot.draw(blank.getContext('2d'), 120, 120)
          bot.drawEyes = drawEyes
          const pixels = output.getContext('2d').getImageData(0, 0, 120, 120).data
          const base = blank.getContext('2d').getImageData(0, 0, 120, 120).data
          let visible = 0
          for (let i = 0; i < pixels.length; i += 4) {
            if (base[i + 3] === 255 && Math.max(...[0, 1, 2].map(c => Math.abs(pixels[i + c] - base[i + c]))) > 30) visible++
          }
          require(`visible ${eyeColor} eyes, body ${bodyColor}, skin ${skinColor}, expression ${shape}`, visible > 8)
        }
      }
    }
  }
  return { formats: sources.length, checks: checks.length, passed: checks.every(c => c.pass) }
}
