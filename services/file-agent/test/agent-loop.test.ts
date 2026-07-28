import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentApiError, runLoop, type AgentApiClient, type AgentConfig } from '../src/index.js'

describe('File Agent runLoop recovery', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-agent-loop-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

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
      // D4: kök GERÇEK ve erişilebilir olmalı; aksi hâlde fail-closed kapı
      // claim'i hiç çağırmadan devreye girer (bkz. aşağıdaki ayrı test).
      roots: { 'test-root': root },
      leaseSeconds: 30,
      pollIntervalMs: 1,
    }
    const errors: string[] = []

    await runLoop(client, config, { signal: abort.signal, onCycleError: (code) => errors.push(code) })

    expect(claim).toHaveBeenCalledTimes(2)
    expect(errors).toEqual(['api_unavailable'])
    expect(JSON.stringify(errors)).not.toContain('secret')
  })

  it('D4: yapılandırılmış kök erişilemezken YENİ iş claim ETMEZ (fail-closed)', async () => {
    const abort = new AbortController()
    const claim = vi.fn().mockResolvedValue(null)
    const client = {
      claim,
      heartbeat: vi.fn(),
      reportResult: vi.fn(),
    } as unknown as AgentApiClient
    const config: AgentConfig = {
      apiBaseUrl: 'http://127.0.0.1:3100',
      agentId: 'agent-1',
      agentSecret: 'not-logged',
      // Var olmayan kök: gerçek P:\ kesintisinin sentetik karşılığı.
      roots: { 'test-root': join(root, 'yok-boyle-bir-klasor') },
      leaseSeconds: 30,
      pollIntervalMs: 1,
    }
    const errors: string[] = []
    setTimeout(() => abort.abort(), 20)

    await runLoop(client, config, { signal: abort.signal, onCycleError: (code) => errors.push(code) })

    // Kök hiç erişilemediği için `claim` HİÇ çağrılmadı: attempt bütçesi
    // tüketilmedi, işler `pending` kaldı (PENDING_STORAGE).
    expect(claim).not.toHaveBeenCalled()
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.every((code) => code === 'storage_unavailable')).toBe(true)
  })

  it('D4: birden çok kökten biri erişilemezse yine yeni iş claim ETMEZ', async () => {
    const abort = new AbortController()
    const claim = vi.fn().mockResolvedValue(null)
    const client = { claim, heartbeat: vi.fn(), reportResult: vi.fn() } as unknown as AgentApiClient
    const config: AgentConfig = {
      apiBaseUrl: 'http://127.0.0.1:3100',
      agentId: 'agent-1',
      agentSecret: 'not-logged',
      roots: {
        'healthy-root': root,
        'unhealthy-root': join(root, 'yok-boyle-bir-klasor'),
      },
      leaseSeconds: 30,
      pollIntervalMs: 1,
    }
    const errors: string[] = []
    setTimeout(() => abort.abort(), 20)

    await runLoop(client, config, { signal: abort.signal, onCycleError: (code) => errors.push(code) })

    expect(claim).not.toHaveBeenCalled()
    expect(errors.every((code) => code === 'storage_unavailable')).toBe(true)
  })
})
