export function parseTestDisplayIndex(value) {
  if (value === undefined) return null
  if (!/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('HB_TEST_DISPLAY_INDEX must be a zero-based display index')
  return Number(value)
}

export function selectTestDisplay(displays, index) {
  const display = displays[index]
  if (!display) throw new Error(`HB_TEST_DISPLAY_INDEX ${index} is unavailable (${displays.length} displays)`)
  return display
}

export function boundsInsideDisplay(bounds, area) {
  return bounds.x >= area.x && bounds.y >= area.y && bounds.x + bounds.width <= area.x + area.width && bounds.y + bounds.height <= area.y + area.height
}

export function placeBoundsOnDisplay(bounds, area) {
  if (bounds.width > area.width || bounds.height > area.height) throw new Error('Test window does not fit the selected display')
  return { ...bounds, x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - bounds.width)), y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - bounds.height)) }
}
