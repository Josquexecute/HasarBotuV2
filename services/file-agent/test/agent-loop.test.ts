import { describe, expect, it, vi } from 'vitest'
import { AgentApiError, runLoop, type AgentApiClient, type AgentConfig } from '../src/index.js'

describe('File Agent runLoop recovery', () => {
  it('API başlangıçta kapalıysa ham hatayı sızdırmadan polling ile yeniden dener', async () => {
    const abort = new AbortController()
    const claim = vi.fn()
      .mockRejectedValueOnce(new AgentApiError(503, 'fetch failed at P:\\secret'))
      .mockImplementationOnce(() => {
        abort.abort()
        return Promise.resolve(null)
      })
    const client = {
      claim,
      heartbeat: vi.fn(),
      reportResult: vi.fn(),
    } as unknown as AgentApiClient
    const config: AgentConfig = {
      apiBaseUrl: 'http://127.0.0.1:3100',
      agentId: 'agent-1',
      agentSecret: 'not-logged',
      roots: { 'test-root': 'C:\\synthetic' },
      leaseSeconds: 30,
      pollIntervalMs: 1,
    }
    const errors: string[] = []

    await runLoop(client, config, { signal: abort.signal, onCycleError: (code) => errors.push(code) })

    expect(claim).toHaveBeenCalledTimes(2)
    expect(errors).toEqual(['api_unavailable'])
    expect(JSON.stringify(errors)).not.toContain('secret')
  })
})
