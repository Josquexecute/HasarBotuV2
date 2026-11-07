const EVENT = 'hasarbotu:case-fault-changed'
const sender = crypto.getRandomValues(new Uint32Array(4)).join('-')
const channelName = (userId: string) => `hasarbotu:case-fault:${userId}`

/** Invalidation carries identity only; every window re-reads the authenticated API. */
export function publishCaseFaultChange(userId: string, caseId: string): void {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { userId, caseId } }))
  if (typeof BroadcastChannel === 'undefined') return
  const channel = new BroadcastChannel(channelName(userId))
  channel.postMessage({ caseId, sender })
  channel.close()
}

export function subscribeCaseFaultChanges(userId: string, caseId: string, refresh: () => void): () => void {
  const local = (event: Event) => {
    const detail = (event as CustomEvent<{ userId: string; caseId: string }>).detail
    if (detail?.userId === userId && detail.caseId === caseId) refresh()
  }
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(channelName(userId))
  if (channel) channel.onmessage = event => {
    if (event.data?.caseId === caseId && event.data.sender !== sender) refresh()
  }
  window.addEventListener(EVENT, local)
  window.addEventListener('focus', refresh)
  return () => {
    channel?.close()
    window.removeEventListener(EVENT, local)
    window.removeEventListener('focus', refresh)
  }
}
