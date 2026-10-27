export type TouchPlayCommand = { type: 'play'; id: string } | { type: 'calm' | 'stop' | 'pause' | 'resume' | 'sleep' | 'wake' }
export interface TouchPlayState {
  mood: 'happy' | 'surprised' | 'bothered' | 'angry'
  reaction: string | null
  paused: boolean
  reducedMotion: boolean
  sleeping: boolean
}
const identity = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(value)

export function parseTouchPlayCommand(value: unknown): TouchPlayCommand | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const data = value as Record<string, unknown>
  if (data.type === 'play' && Object.keys(data).length === 2 && identity(data.id)) return { type: 'play', id: data.id }
  if (Object.keys(data).length !== 1) return
  if (data.type === 'calm' || data.type === 'stop' || data.type === 'pause' || data.type === 'resume' || data.type === 'sleep' || data.type === 'wake') return { type: data.type }
}

export function parseTouchPlayState(value: unknown): TouchPlayState | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const data = value as Record<string, unknown>
  if (typeof data.mood !== 'string' || !['happy', 'surprised', 'bothered', 'angry'].includes(data.mood) || data.reaction !== null && !identity(data.reaction)
    || typeof data.paused !== 'boolean' || typeof data.reducedMotion !== 'boolean' || typeof data.sleeping !== 'boolean') return
  return { mood: data.mood as TouchPlayState['mood'], reaction: data.reaction, paused: data.paused, reducedMotion: data.reducedMotion, sleeping: data.sleeping }
}
