import type { AgentApiClient } from './api-client.js'

export interface JobLease {
  readonly signal: AbortSignal
  check(): void
  heartbeat(phase?: Parameters<AgentApiClient['heartbeat']>[1]): Promise<void>
  stop(): void
}

/** Fail closed on an uncertain renewal; never start another storage mutation. */
export function maintainJobLease(client: AgentApiClient, jobId: string, leaseExpiresAt: string): JobLease {
  const controller = new AbortController()
  let expiresAt = Date.parse(leaseExpiresAt)
  let renewal: ReturnType<typeof setTimeout> | undefined
  let expiry: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  let pending: Promise<void> | undefined
  const lost = () => {
    controller.abort(new Error('job_lease_lost'))
    clearTimeout(renewal)
    clearTimeout(expiry)
  }
  const check = () => {
    if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) lost()
    controller.signal.throwIfAborted()
  }
  const schedule = () => {
    clearTimeout(renewal)
    clearTimeout(expiry)
    if (stopped || controller.signal.aborted) return
    const remaining = expiresAt - Date.now()
    if (!(remaining > 0)) { lost(); return }
    expiry = setTimeout(lost, remaining)
    renewal = setTimeout(() => { void heartbeat().catch(lost) }, Math.max(1, Math.floor(remaining / 3)))
  }
  const heartbeat = async (phase?: Parameters<AgentApiClient['heartbeat']>[1]): Promise<void> => {
    check()
    // Phase updates wait for an in-flight renewal, then send their own update.
    if (pending !== undefined) {
      await pending
      if (phase === undefined) return
    }
    check()
    const task = (async () => {
      try {
        const response = await client.heartbeat(jobId, phase)
        check()
        if (response === false) throw new Error('job_lease_lost')
        expiresAt = Date.parse(response.leaseExpiresAt)
        check()
        schedule()
      } catch (error) { lost(); throw error }
    })()
    pending = task
    try { await task } finally { if (pending === task) pending = undefined }
  }
  schedule()
  return {
    signal: controller.signal,
    check,
    heartbeat,
    stop() { stopped = true; clearTimeout(renewal); clearTimeout(expiry) },
  }
}
