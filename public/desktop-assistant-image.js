// Protect the artwork's convex envelope, including internal black/white lines
// connected to the exterior. Only a uniform neutral matte is eligible.
function removeBackdrop(data, width, height, allowWhite) {
  const white = allowWhite && Math.min(data[0], data[1], data[2]) > 238
  const backdrop = i => data[i + 3] === 255 && (white
    ? Math.min(data[i], data[i + 1], data[i + 2]) > 230 && Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]) < 18
    : Math.max(data[i], data[i + 1], data[i + 2]) < 64)
  const border = []
  for (let x = 0; x < width; x++) border.push(x, (height - 1) * width + x)
  for (let y = 1; y < height - 1; y++) border.push(y * width, y * width + width - 1)
  if (border.some(p => data[p * 4 + 3] !== 255) || border.filter(p => backdrop(p * 4)).length < border.length * .98) return
  const foreground = data.slice()
  for (let p = 0; p < width * height; p++) if (backdrop(p * 4)) foreground[p * 4 + 3] = 0
  removeStrayPixels(foreground, width, height)
  const points = []
  for (let y = 0; y < height; y++) {
    let left = width, right = -1
    for (let x = 0; x < width; x++) if (foreground[(y * width + x) * 4 + 3] >= 24) { left = Math.min(left, x); right = x }
    if (right >= 0) points.push([left, y], [right, y])
  }
  if (points.length < 6) return
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const half = values => {
    const result = []
    for (const p of values) { while (result.length > 1 && cross(result.at(-2), result.at(-1), p) <= 0) result.pop(); result.push(p) }
    return result.slice(0, -1)
  }
  const hull = [...half(points), ...half([...points].reverse())]
  if (hull.length < 3) return
  const outside = p => hull.some((a, i) => {
    const b = hull[(i + 1) % hull.length]
    return cross(a, b, p) < -1.5 * Math.hypot(b[0] - a[0], b[1] - a[1])
  })
  const visited = new Uint8Array(width * height), queue = new Int32Array(width * height)
  let start = 0, end = 0
  const visit = p => {
    if (visited[p]) return
    visited[p] = 1
    if (backdrop(p * 4) && outside([p % width, Math.floor(p / width)])) queue[end++] = p
  }
  border.forEach(visit)
  while (start < end) {
    const p = queue[start++], x = p % width, y = Math.floor(p / width)
    data[p * 4 + 3] = 0
    if (x) visit(p - 1)
    if (x + 1 < width) visit(p + 1)
    if (y) visit(p - width)
    if (y + 1 < height) visit(p + width)
  }
  return true
}

export function removeDarkBackdrop(data, width, height) {
  removeBackdrop(data, width, height, false)
}

// Match BotEngine's neutral body aspect and superellipse (exponent 2.7).
// Texture coordinates stay isotropic when mapped onto the original body path.
const TEXTURE_WIDTH = 256, TEXTURE_HEIGHT = 198, BODY_EXPONENT = 2.7

function removeStrayPixels(data, width, height) {
  const visited = new Uint8Array(width * height), queue = new Int32Array(width * height), components = []
  let end = 0, largest = 0
  const visit = p => {
    if (visited[p] || data[p * 4 + 3] < 24) return
    visited[p] = 1; queue[end++] = p
  }
  for (let p = 0; p < visited.length; p++) {
    const start = end
    visit(p)
    for (let cursor = start; cursor < end; cursor++) {
      const point = queue[cursor], x = point % width, y = Math.floor(point / width)
      if (x) visit(point - 1)
      if (x + 1 < width) visit(point + 1)
      if (y) visit(point - width)
      if (y + 1 < height) visit(point + width)
    }
    if (end > start) { components.push([start, end]); largest = Math.max(largest, end - start) }
  }
  // Ignore tiny detached export artifacts, retaining separate logo lettering.
  const minimum = Math.max(4, largest * .001)
  for (const [start, finish] of components) if (finish - start < minimum && finish - start < largest) {
    for (let i = start; i < finish; i++) data[queue[i] * 4 + 3] = 0
  }
}

function removeNestedDarkMatte(data, width, height) {
  let left = width, right = -1, top = height, bottom = -1, visible = 0
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4
    if (data[i + 3] < 24) continue
    visible++
    if (Math.max(data[i], data[i + 1], data[i + 2]) >= 64) continue
    left = Math.min(left, x); right = Math.max(right, x)
    top = Math.min(top, y); bottom = Math.max(bottom, y)
  }
  const w = right - left + 1, h = bottom - top + 1
  if (w < 4 || h < 4 || w * h < visible * .6) return
  const panel = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) panel.set(data.subarray(((y + top) * width + left) * 4, ((y + top) * width + right + 1) * 4), y * w * 4)
  // A light export canvas can contain a second, rectangular black logo matte.
  // Only discard the surrounding canvas if that panel passes the same strict
  // uniform-border and protected-artwork checks as an ordinary black upload.
  if (!removeBackdrop(panel, w, h, false)) return
  data.fill(0)
  for (let y = 0; y < h; y++) data.set(panel.subarray(y * w * 4, (y + 1) * w * 4), ((y + top) * width + left) * 4)
}

function contentPlacement(data, width, height) {
  let left = width, right = -1, top = height, bottom = -1, transparent = false
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const alpha = data[(y * width + x) * 4 + 3]
    if (alpha < 24) { transparent = true; continue }
    left = Math.min(left, x); right = Math.max(right, x)
    top = Math.min(top, y); bottom = Math.max(bottom, y)
  }
  if (right < left) throw new Error('Görselde görünür bir figür bulunamadı.')
  if (!transparent) {
    // Photographs have no separable matte: cover the rounded body rather than
    // showing a rectangular letterbox. Never change the source aspect ratio.
    return { cx: width / 2, cy: height / 2, scale: Math.max(TEXTURE_WIDTH / width, TEXTURE_HEIGHT / height) }
  }
  const cx = (left + right + 1) / 2, cy = (top + bottom + 1) / 2
  let extent = 0
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
    if (data[(y * width + x) * 4 + 3] < 24) continue
    // Include each pixel's outer corner so thin borders stay inside the body.
    const dx = (Math.abs(x + .5 - cx) + .5) / (TEXTURE_WIDTH / 2)
    const dy = (Math.abs(y + .5 - cy) + .5) / (TEXTURE_HEIGHT / 2)
    extent = Math.max(extent, (dx ** BODY_EXPONENT + dy ** BODY_EXPONENT) ** (1 / BODY_EXPONENT))
  }
  // A round emblem is a skin for the whole body, rather than a circular sticker
  // contained inside its wider silhouette. Check the alpha envelope so square
  // icons, lettering and photographs keep their ordinary aspect-preserving fit.
  const w = right - left + 1, h = bottom - top + 1
  let inside = 0, filled = 0, outside = 0, exterior = 0
  if (Math.abs(w / h - 1) < .08) {
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      const r = Math.hypot((x + .5 - cx) / (w / 2), (y + .5 - cy) / (h / 2))
      const visible = data[(y * width + x) * 4 + 3] >= 24
      if (r < .9) { inside++; if (visible) filled++ }
      if (r > 1.06) { exterior++; if (visible) outside++ }
    }
  }
  const round = inside > 0 && filled / inside > .98 && exterior > 0 && outside / exterior < .02
  return { cx, cy, scale: .94 / extent, ...(round ? { round: { width: w, height: h } } : {}) }
}

function fitRoundSkin(output, pixels, placement) {
  const result = output.createImageData(TEXTURE_WIDTH, TEXTURE_HEIGHT)
  const { data, width, height } = pixels
  // Map concentric circles onto the engine's superellipse. The complete emblem
  // reaches the body edge without clipping its top/bottom or leaving white ears.
  for (let y = 0; y < TEXTURE_HEIGHT; y++) for (let x = 0; x < TEXTURE_WIDTH; x++) {
    const u = (x + .5) / (TEXTURE_WIDTH / 2) - 1, v = (y + .5) / (TEXTURE_HEIGHT / 2) - 1
    const edge = (Math.abs(u) ** BODY_EXPONENT + Math.abs(v) ** BODY_EXPONENT) ** (1 / BODY_EXPONENT)
    if (edge > 1) continue
    const radial = .98 * edge / (Math.hypot(u, v) || 1)
    const sx = placement.cx + u * radial * placement.round.width / 2 - .5
    const sy = placement.cy + v * radial * placement.round.height / 2 - .5
    const left = Math.floor(sx), top = Math.floor(sy), dx = sx - left, dy = sy - top
    const target = (y * TEXTURE_WIDTH + x) * 4
    // Bilinear, premultiplied-alpha sampling avoids jagged logo lines and matte
    // fringes at subpixel boundaries; upload processing runs only once.
    let alpha = 0, red = 0, green = 0, blue = 0
    for (const [ox, oy, weight] of [[0, 0, (1 - dx) * (1 - dy)], [1, 0, dx * (1 - dy)], [0, 1, (1 - dx) * dy], [1, 1, dx * dy]]) {
      const px = Math.max(0, Math.min(width - 1, left + ox)), py = Math.max(0, Math.min(height - 1, top + oy))
      const source = (py * width + px) * 4, a = data[source + 3] / 255 * weight
      alpha += a
      red += data[source] * a; green += data[source + 1] * a; blue += data[source + 2] * a
    }
    if (alpha) {
      result.data[target] = red / alpha; result.data[target + 1] = green / alpha; result.data[target + 2] = blue / alpha
    }
    result.data[target + 3] = alpha * 255
  }
  output.putImageData(result, 0, 0)
}

export function prepareAssistantTexture(image) {
  const canvas = document.createElement('canvas')
  // Analyze before shrinking to the final texture; padded logos retain detail.
  const scale = Math.min(1, 1024 / image.width, 1024 / image.height)
  canvas.width = Math.max(1, Math.round(image.width * scale))
  canvas.height = Math.max(1, Math.round(image.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Görsel işlenemedi.')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
  const lightMatte = Math.min(pixels.data[0], pixels.data[1], pixels.data[2]) > 238
  const separated = removeBackdrop(pixels.data, canvas.width, canvas.height, true)
  removeStrayPixels(pixels.data, canvas.width, canvas.height)
  if (lightMatte && separated) removeNestedDarkMatte(pixels.data, canvas.width, canvas.height)
  const placement = contentPlacement(pixels.data, canvas.width, canvas.height)
  context.putImageData(pixels, 0, 0)
  const texture = document.createElement('canvas')
  texture.width = TEXTURE_WIDTH; texture.height = TEXTURE_HEIGHT
  const output = texture.getContext('2d')
  if (!output) throw new Error('Görsel işlenemedi.')
  if (placement.round) {
    fitRoundSkin(output, pixels, placement)
    return texture
  }
  output.imageSmoothingQuality = 'high'
  output.drawImage(canvas, TEXTURE_WIDTH / 2 - placement.cx * placement.scale, TEXTURE_HEIGHT / 2 - placement.cy * placement.scale, canvas.width * placement.scale, canvas.height * placement.scale)
  return texture
}
