export type GooglePurpose = 'login' | 'mail'
export interface GoogleFlow { flowId: string; startedAt: number; url?: string; rememberMe?: boolean }
export type GoogleStatus = 'pending' | 'complete' | 'approval_required' | 'denied' | 'expired' | 'failed'
export const GOOGLE_FLOW_LIFETIME = 10 * 60_000
export type OAuthWindow = Window & {
  hasarbotuDesktop?: { isDesktopShell: boolean }
  hasarbotuOAuth?: { focus: () => Promise<void> }
}

const storageKey = (purpose: GooglePurpose) => `hb-google-${purpose}`
export function saveGoogleFlow(purpose: GooglePurpose, flow: GoogleFlow | null): void {
  try {
    // Keep only the pending, browser-bound request across a reload, never the consent URL or tokens.
    if (flow) sessionStorage.setItem(storageKey(purpose), JSON.stringify({ flowId: flow.flowId, startedAt: flow.startedAt, rememberMe: flow.rememberMe }))
    else sessionStorage.removeItem(storageKey(purpose))
  } catch { /* A blocked storage area must not prevent in-memory authorization. */ }
}
export function restoreGoogleFlow(purpose: GooglePurpose): GoogleFlow | null {
  try {
    const flow = JSON.parse(sessionStorage.getItem(storageKey(purpose)) ?? 'null') as GoogleFlow | null
    if (flow && typeof flow.flowId === 'string' && flow.flowId.length >= 20 && flow.flowId.length <= 200
      && typeof flow.startedAt === 'number' && flow.startedAt <= Date.now() && Date.now() - flow.startedAt < GOOGLE_FLOW_LIFETIME
      && (flow.rememberMe === undefined || typeof flow.rememberMe === 'boolean')) return flow
  } catch { /* Malformed or unavailable storage is discarded. */ }
  saveGoogleFlow(purpose, null)
  return null
}

export async function completeGoogleFlow(flow: GoogleFlow, signal: AbortSignal): Promise<GoogleStatus> {
  const response = await fetch('/api/v1/google/complete', {
    method: 'POST', credentials: 'include', signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ flowId: flow.flowId, ...(flow.rememberMe === undefined ? {} : { rememberMe: flow.rememberMe }) }),
  })
  if (response.status >= 500 || response.status === 429) throw new Error('Google completion temporarily unavailable')
  if (response.status === 401 || response.status === 403) return 'denied'
  let data: { status?: unknown } | null
  try { data = await response.json() as { status?: unknown } | null } catch { return 'failed' }
  const statuses: GoogleStatus[] = ['pending', 'complete', 'approval_required', 'denied', 'expired', 'failed']
  return data && statuses.includes(data.status as GoogleStatus) && (response.ok || response.status === 400) ? data.status as GoogleStatus : 'failed'
}
