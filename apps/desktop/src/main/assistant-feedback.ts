export type AssistantMotionEvent =
  | { type: 'drag'; x: number; dx: number; dy: number; elapsed: number }
  | { type: 'edge'; x: number }
  | { type: 'working' | 'error'; active: boolean }
  | { type: 'release' | 'success' | 'notification' | 'celebrate' }

/** Main owns operation lifetimes; the isolated character receives cosmetic state only. */
export class AssistantFeedbackState {
  private readonly operations = new Map<number, Set<string>>()
  private errorOwner: number | undefined
  error: string | undefined

  get working(): boolean { return this.operations.size > 0 }

  clear(senderId: number): AssistantMotionEvent[] {
    this.operations.delete(senderId)
    if (this.errorOwner === senderId) { this.error = undefined; this.errorOwner = undefined }
    return [{ type: 'working', active: this.working }, { type: 'error', active: Boolean(this.error) }]
  }

  accept(senderId: number, value: unknown): AssistantMotionEvent[] {
    if (typeof value !== 'object' || value === null) return []
    const { type, id, phase, message } = value as Record<string, unknown>
    if (type === 'notification') return [{ type: 'notification' }]
    if (type === 'completed') {
      this.error = undefined
      this.errorOwner = undefined
      return [{ type: 'error', active: false }, { type: 'celebrate' }]
    }
    if (type !== 'activity' || typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(id)
      || typeof phase !== 'string' || !['start', 'finish', 'fail'].includes(phase)) return []
    if (phase === 'fail' && (typeof message !== 'string' || !message.trim() || message.length > 500)) return []
    const pending = this.operations.get(senderId) ?? new Set<string>()
    if (phase === 'start') {
      if (pending.size >= 64 || pending.has(id)) return []
      pending.add(id)
      this.operations.set(senderId, pending)
      this.error = undefined
      this.errorOwner = undefined
      return [{ type: 'error', active: false }, { type: 'working', active: true }]
    }
    if (!pending.delete(id)) return []
    if (!pending.size) this.operations.delete(senderId)
    const events: AssistantMotionEvent[] = [{ type: 'working', active: this.working }]
    if (phase === 'fail') {
      this.error = (message as string).trim()
      this.errorOwner = senderId
      events.push({ type: 'error', active: true })
    }
    return events
  }
}
