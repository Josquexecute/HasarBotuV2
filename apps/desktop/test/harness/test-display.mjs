import { app, screen } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { boundsInsideDisplay, parseTestDisplayIndex, placeBoundsOnDisplay, selectTestDisplay } from './test-display-policy.mjs'

export const testDisplayIndex = parseTestDisplayIndex(process.env.HB_TEST_DISPLAY_INDEX)
const report = { requestedIndex: testDisplayIndex, display: null, placements: [], visibleChecks: [], violations: [], omitted: [] }
let explicitPlacement = false
export function useExplicitTestWindowPlacement() { explicitPlacement = true; report.explicitPlacement = true }
function saveReport() {
  if (testDisplayIndex === null) return
  const directory = process.env.HB_TEST_DISPLAY_EVIDENCE ?? app.getPath('userData')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, `display-${basename(process.argv[1])}-${process.pid}.json`), JSON.stringify(report, null, 2))
}
export function getTestDisplay() {
  if (testDisplayIndex === null) return screen.getPrimaryDisplay()
  const display = selectTestDisplay(screen.getAllDisplays(), testDisplayIndex)
  report.display = { id: display.id, bounds: display.bounds, workArea: display.workArea, isPrimary: display.id === screen.getPrimaryDisplay().id }
  return display
}
export function omitDisplayScenario(name, reason) { report.omitted.push({ name, reason }); saveReport() }

export function seedTestAssistantPosition() {
  if (testDisplayIndex === null) return
  const area = getTestDisplay().workArea
  const statePath = join(app.getPath('userData'), 'assistant-position.json')
  try {
    const saved = JSON.parse(readFileSync(statePath, 'utf8'))
    if (boundsInsideDisplay({ ...saved, width: 120, height: 120 }, area)) return
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(statePath, JSON.stringify({ x: area.x + area.width - 136, y: area.y + Math.round(area.height / 2) }))
}

if (testDisplayIndex !== null) {
  app.on('browser-window-created', (_event, window) => {
    const display = getTestDisplay()
    let placedOnce = false
    const place = () => {
      if (window.isDestroyed() || window.isVisible()) return
      window.setBounds(placeBoundsOnDisplay(window.getBounds(), display.workArea), false)
      placedOnce = true
      report.placements.push({ windowId: window.id, bounds: window.getBounds() })
      saveReport()
    }
    // Constructors may apply their final centering after browser-window-created.
    if (!explicitPlacement) {
      window.once('ready-to-show', place)
      window.webContents.on('did-finish-load', place)
    }
    // Validate actual native placement; do not replace screen APIs or window methods.
    window.on('show', () => {
      const bounds = window.getBounds(), pass = boundsInsideDisplay(bounds, display.bounds)
      report.visibleChecks.push({ windowId: window.id, bounds, pass })
      saveReport()
      if (!pass) { report.violations.push({ windowId: window.id, bounds }); saveReport(); app.exit(1) }
    })
    window.on('resize', () => {
      if (explicitPlacement || !placedOnce) return
      const bounds = window.getBounds()
      const area = window.isFullScreen() || bounds.height > display.workArea.height ? display.bounds : display.workArea
      const placed = placeBoundsOnDisplay(bounds, area)
      if (bounds.x !== placed.x || bounds.y !== placed.y) window.setPosition(placed.x, placed.y, false)
    })
    saveReport()
  })
  app.on('will-quit', saveReport)
  app.on('quit', saveReport)
}
