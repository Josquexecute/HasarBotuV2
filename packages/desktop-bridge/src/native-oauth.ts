const CALLBACK = '/api/v1/google/desktop/callback'
const LIFETIME_MS = 10 * 60_000

/** Bind a native response to this loopback receiver, not merely to a server-side flow. */
export function createNativeOAuthGuard(origin: string, now = Date.now) {
  const flows = new Map<string, number>()
  const expire = () => { for (const [state, deadline] of flows) if (deadline <= now()) flows.delete(state) }
  return {
    remember(bytes: Buffer): void {
      expire()
      try {
        const body = JSON.parse(bytes.toString('utf8')) as { flowId?: unknown; url?: unknown }
        if (typeof body.flowId !== 'string' || !/^[A-Za-z0-9_-]{20,200}$/.test(body.flowId) || typeof body.url !== 'string') return
        const url = new URL(body.url)
        if (url.origin !== 'https://accounts.google.com' || url.username || url.password || url.pathname !== '/o/oauth2/v2/auth'
          || url.searchParams.getAll('state').length !== 1 || url.searchParams.getAll('redirect_uri').length !== 1
          || url.searchParams.get('state') !== body.flowId || url.searchParams.get('redirect_uri') !== origin + CALLBACK) return
        if (flows.size >= 32) flows.delete(flows.keys().next().value!)
        flows.set(body.flowId, now() + LIFETIME_MS)
      } catch { /* An invalid upstream start response cannot register a native flow. */ }
    },
    accepts(url: URL): boolean {
      expire()
      return url.pathname === CALLBACK && url.searchParams.getAll('state').length === 1 && flows.has(url.searchParams.get('state') ?? '')
    },
    complete(url: URL): void { flows.delete(url.searchParams.get('state') ?? '') },
  }
}
