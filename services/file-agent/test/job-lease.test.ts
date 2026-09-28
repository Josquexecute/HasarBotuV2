import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentApiClient } from '../src/api-client.js'
import { maintainJobLease } from '../src/job-lease.js'

afterEach(() => vi.useRealTimers())
describe('job lease ownership', () => {
  it('renews from server expiry, updates the deadline, and stops on 409', async () => {
    vi.useFakeTimers()
    const start = Date.now()
    const heartbeat = vi.fn().mockResolvedValueOnce({ leaseExpiresAt: new Date(start + 180_000).toISOString() }).mockResolvedValue(false)
    const lease = maintainJobLease({ heartbeat } as unknown as AgentApiClient, 'job', new Date(start + 120_000).toISOString())
    await vi.advanceTimersByTimeAsync(39_999)
    expect(heartbeat).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(heartbeat).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(46_666)
    expect(lease.signal.aborted).toBe(true)
    expect(lease.check).toThrow('job_lease_lost')
    lease.stop()
  })

  it.each(['reject', 'hang'])('fails closed when heartbeat %s', async mode => {
    vi.useFakeTimers()
    const heartbeat = mode === 'reject' ? vi.fn().mockRejectedValue(new Error('offline')) : vi.fn(() => new Promise(() => {}))
    const lease = maintainJobLease({ heartbeat } as unknown as AgentApiClient, 'job', new Date(Date.now() + 3000).toISOString())
    await vi.advanceTimersByTimeAsync(mode === 'reject' ? 1000 : 3000)
    expect(lease.check).toThrow('job_lease_lost')
    expect(heartbeat).toHaveBeenCalledTimes(1)
    lease.stop()
  })
})
