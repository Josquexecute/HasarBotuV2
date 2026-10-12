export const ASSISTANT_SIZE = 120
export const ASSISTANT_MENU_ACTIONS = ['open','note','cases','notifications','settings','hide','reset','quit','close'] as const
export type AssistantMenuAction = typeof ASSISTANT_MENU_ACTIONS[number]
export const isAssistantMenuAction = (value: unknown): value is AssistantMenuAction => typeof value === 'string' && (ASSISTANT_MENU_ACTIONS as readonly string[]).includes(value)

export function assistantMenuBounds(position: Point,area: WorkArea) {
  const width = Math.min(360,area.width),height = Math.min(366,area.height)
  return { x: Math.round(Math.max(area.x,Math.min(position.x-width-8,area.x+area.width-width))),y: Math.round(Math.max(area.y,Math.min(position.y,area.y+area.height-height))),width,height }
}
export const ASSISTANT_MARGIN = 8

export interface Point { readonly x: number; readonly y: number }
export interface WorkArea extends Point { readonly width: number; readonly height: number }

/** Publish only relative gaze, never global desktop coordinates. */
export function assistantGaze(cursor: Point, position: Point): Point {
  const center = { x: position.x + ASSISTANT_SIZE / 2, y: position.y + ASSISTANT_SIZE / 2 }
  const dx = cursor.x - center.x
  const dy = cursor.y - center.y
  const scale = Math.max(ASSISTANT_SIZE, Math.hypot(dx, dy))
  return { x: dx / scale, y: dy / scale }
}

export function parseAssistantPosition(value: unknown): Point | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { x, y } = value as Record<string, unknown>
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return undefined
  return { x, y }
}

/** Electron screen coordinates and window bounds both use DIP, including negative monitors. */
export function clampAssistantPosition(point: Point, area: WorkArea): Point {
  const marginX = Math.min(ASSISTANT_MARGIN, Math.max(0, (area.width - ASSISTANT_SIZE) / 2))
  const marginY = Math.min(ASSISTANT_MARGIN, Math.max(0, (area.height - ASSISTANT_SIZE) / 2))
  return {
    x: Math.round(Math.min(Math.max(point.x, area.x + marginX), area.x + Math.max(marginX, area.width - ASSISTANT_SIZE - marginX))),
    y: Math.round(Math.min(Math.max(point.y, area.y + marginY), area.y + Math.max(marginY, area.height - ASSISTANT_SIZE - marginY))),
  }
}

export type AssistantCommand = 'press' | 'drag' | 'release' | 'cancel' | 'menu' | 'left' | 'right' | 'up' | 'down'

export function isAssistantCommand(value: unknown): value is AssistantCommand {
  return typeof value === 'string' && ['press', 'drag', 'release', 'cancel', 'menu', 'left', 'right', 'up', 'down'].includes(value)
}
