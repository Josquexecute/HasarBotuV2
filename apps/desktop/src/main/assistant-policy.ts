export const ASSISTANT_SIZE = 64
export const ASSISTANT_MARGIN = 8

export interface Point { readonly x: number; readonly y: number }
export interface WorkArea extends Point { readonly width: number; readonly height: number }

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
