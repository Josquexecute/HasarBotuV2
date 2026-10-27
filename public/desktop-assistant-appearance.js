import { BotEngine } from './vendor/coucou/mochi/engine.js'

function luminance(channels) {
  const linear = channels.map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4)
  return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722
}
const channels = color => [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255)
export function assistantEyeColor(characterColor, eyeColor) {
  return eyeColor ?? (luminance(channels(characterColor)) > .179 ? '#111111' : '#ffffff')
}

// The original engine owns the silhouette, transforms, face, hands and particles.
export class AssistantSkinEngine extends BotEngine {
  skin = null
  skinFill = null

  drawBody(context, body, radius, rx, ry) {
    super.drawBody(context, body, radius, rx, ry)
    if (!this.skin) return
    const fit = Math.min(2 * rx / this.skin.width, 2 * ry / this.skin.height)
    const width = this.skin.width * fit, height = this.skin.height * fit
    if (this.skinFill?.image !== this.skin || this.skinFill.context !== context || this.skinFill.fit !== fit) {
      const pattern = context.createPattern(this.skin, 'no-repeat')
      if (!pattern) throw new Error('Touch kaplaması çizilemedi.')
      pattern.setTransform({ a: fit, d: fit, e: -width / 2, f: -height / 2 })
      this.skinFill = { image: this.skin, context, fit, pattern }
    }
    // Fill the very same path instead of applying a second independently
    // rasterized clip, which can extend the antialiased edge on Chromium.
    context.save()
    context.fillStyle = this.skinFill.pattern
    context.fill(body)
    context.restore()
  }

  drawEyes(context, ...args) {
    context.save()
    const eye = luminance(channels(this.eyeColor || '#111111'))
    const body = luminance(this.bodyColor || [1, 1, 1])
    if (this.skin || (Math.max(eye, body) + .05) / (Math.min(eye, body) + .05) < 3) {
      context.shadowColor = eye > .179 ? '#111111' : '#ffffff'
      context.shadowBlur = args[1] * .08
    }
    super.drawEyes(context, ...args)
    context.restore()
  }
}

export function drawAssistantAppearance(context, size, pose, accent, image) {
  pose.skin = image || null
  const radius = size * .3
  const cx = Math.max(size * .44, Math.min(size * .56, size / 2 + pose.ox * radius))
  const cy = Math.max(size * .44, Math.min(size * .56, size / 2 + pose.oy * radius + radius * .06))
  // Fade to zero inside the transparent window, even during extreme poses.
  const outer = Math.min(cx, size - cx, cy, size - cy) - 1
  context.save()
  const glow = context.createRadialGradient(cx, cy, radius * .55, cx, cy, outer)
  glow.addColorStop(0, `${accent}00`)
  glow.addColorStop(.45, `${accent}a0`)
  glow.addColorStop(.72, `${accent}60`)
  glow.addColorStop(1, `${accent}00`)
  context.fillStyle = glow
  context.fillRect(0, 0, size, size)
  context.restore()
}
