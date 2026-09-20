import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentApiClient } from '../src/api-client.js'
import type { AgentConfig } from '../src/config.js'

// HB-2026-171: agent.ts'in KENDİ dispatch mantığının, kritik (yazan)
// işlemleri gerçekten çalıştırmadan ÖNCE freshness gate'i doğru
// çağırdığını ve NOT-READY durumunda gerçek executor'ı HİÇ çağırmadığını
// (yalnız errorCode döndürdüğünü değil, workspace'in GERÇEKTEN diskte
// oluşmadığını da) kanıtlar. checkCaseFreshness mock'lanır -- kendi
// gerçek uçtan uca davranışı freshness-gate-client.test.ts'de zaten
// ayrı, gerçek bir spawn ile kanıtlandı; burada yalnız DISPATCH
// KATMANI test edilir.
vi.mock('../src/freshness-gate-client.js', () => ({
  checkCaseFreshness: vi.fn(),
}))

const { checkCaseFreshness } = await import('../src/freshness-gate-client.js')
const { runOnce } = await import('../src/agent.js')

describe('agent.ts kritik islem freshness gate dispatch', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-freshness-dispatch-'))
    vi.mocked(checkCaseFreshness).mockReset()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  function baseConfig(): AgentConfig {
    return {
      apiBaseUrl: 'http://127.0.0.1:3100',
      agentId: 'agent-1',
      agentSecret: 'not-logged',
      roots: { 'test-root': root },
      leaseSeconds: 30,
      pollIntervalMs: 1,
      freshnessGate: {
        toolPath: 'unused-in-this-mocked-test.mjs',
        pcloudLocalDatabasePath: 'unused.db',
        topLevelFolderName: 'KAYNAK',
        attestationStoreDirectory: 'unused-store',
      },
    }
  }

  it('workspace isi: freshness NOT-READY ise provisionCaseWorkspace HIC calismaz (klasor GERCEKTEN olusmaz), case_not_fresh raporlanir', async () => {
    vi.mocked(checkCaseFreshness).mockResolvedValue({ ready: false, caseStatus: 'unknown', reason: 'case_status_unknown' })
    const job = {
      id: 'job-1',
      payload: {
        kind: 'workspace',
        storageRootKey: 'test-root',
        relativePath: '00AAA000',
        requiredSubdirectories: ['EVRAK', 'HASAR', 'OLAY YERİ', 'ONARIM', 'DEĞER KAYBI'],
      },
    }
    const reportResult = vi.fn().mockResolvedValue({ acknowledged: true })
    const client = {
      claim: vi.fn().mockResolvedValue(job),
      heartbeat: vi.fn(),
      reportResult,
    } as unknown as AgentApiClient

    const result = await runOnce(client, baseConfig())

    expect(checkCaseFreshness).toHaveBeenCalledWith(baseConfig().freshnessGate, root, '00AAA000', { operation: 'workspace' })
    expect(result.kind).toBe('reported')
    expect(reportResult).toHaveBeenCalledWith('job-1', expect.objectContaining({ outcome: 'failed', errorCode: 'case_not_fresh' }))
    // Gercek, bagimsiz dogrulama: workspace klasoru GERCEKTEN olusmadi.
    await expect(stat(join(root, '00AAA000'))).rejects.toThrow()
  })

  it('workspace isi: freshness READY ise provisionCaseWorkspace GERCEKTEN calisir, klasor GERCEKTEN olusur', async () => {
    vi.mocked(checkCaseFreshness).mockResolvedValue({ ready: true, caseStatus: 'ready' })
    const job = {
      id: 'job-2',
      payload: {
        kind: 'workspace',
        storageRootKey: 'test-root',
        relativePath: '00BBB000',
        requiredSubdirectories: ['EVRAK', 'HASAR', 'OLAY YERİ', 'ONARIM', 'DEĞER KAYBI'],
      },
    }
    const client = {
      claim: vi.fn().mockResolvedValue(job),
      heartbeat: vi.fn(),
      reportResult: vi.fn().mockResolvedValue({ acknowledged: true }),
    } as unknown as AgentApiClient

    await runOnce(client, baseConfig())

    const created = await stat(join(root, '00BBB000'))
    expect(created.isDirectory()).toBe(true)
  })

  it('freshnessGate yapilandirilmamis (undefined) olsa bile gercek checkCaseFreshness cagirilir -- dispatch, konfigurasyon eksikligini KENDI basina varsaymaz', async () => {
    vi.mocked(checkCaseFreshness).mockResolvedValue({ ready: false, caseStatus: 'unknown', reason: 'freshness_gate_not_configured' })
    const config: AgentConfig = { ...baseConfig(), freshnessGate: undefined }
    const job = {
      id: 'job-3',
      payload: {
        kind: 'workspace',
        storageRootKey: 'test-root',
        relativePath: '00CCC000',
        requiredSubdirectories: ['EVRAK', 'HASAR', 'OLAY YERİ', 'ONARIM', 'DEĞER KAYBI'],
      },
    }
    const reportResult = vi.fn().mockResolvedValue({ acknowledged: true })
    const client = {
      claim: vi.fn().mockResolvedValue(job),
      heartbeat: vi.fn(),
      reportResult,
    } as unknown as AgentApiClient

    await runOnce(client, config)

    expect(checkCaseFreshness).toHaveBeenCalledWith(undefined, root, '00CCC000', { operation: 'workspace' })
    expect(reportResult).toHaveBeenCalledWith('job-3', expect.objectContaining({ outcome: 'failed', errorCode: 'case_not_fresh' }))
    await expect(stat(join(root, '00CCC000'))).rejects.toThrow()
  })

  it('file_operation isi: kaynak VEYA hedeften biri not-ready ise executeFileOperation calismaz (her iki taraf da kontrol edilir)', async () => {
    vi.mocked(checkCaseFreshness).mockImplementation(async (_config, _rootAbsolute, relativePath) => {
      // Kaynak ready, hedef DEGIL -- ikisi de kontrol edildigini kanitlar.
      if (relativePath === 'kaynak-vaka') return { ready: true, caseStatus: 'ready' }
      return { ready: false, caseStatus: 'unknown', reason: 'case_status_unknown' }
    })
    await mkdir(join(root, 'kaynak-vaka'), { recursive: true })
    const job = {
      id: 'job-4',
      payload: {
        kind: 'file_operation',
        operationId: 'op-1',
        operationVersion: 1,
        operationType: 'move_case_workspace',
        source: { storageRootKey: 'test-root', relativePath: 'kaynak-vaka' },
        destination: { storageRootKey: 'test-root', relativePath: 'hedef-vaka' },
        strategy: 'atomic_rename',
        plannedAt: new Date().toISOString(),
        stagingRelativePath: 'staging',
        temporaryRelativePath: 'temp',
      },
    }
    const reportResult = vi.fn().mockResolvedValue({ acknowledged: true })
    const client = {
      claim: vi.fn().mockResolvedValue(job),
      heartbeat: vi.fn(),
      reportResult,
    } as unknown as AgentApiClient

    await runOnce(client, baseConfig())

    expect(checkCaseFreshness).toHaveBeenCalledTimes(2)
    expect(reportResult).toHaveBeenCalledWith('job-4', expect.objectContaining({ outcome: 'failed', errorCode: 'case_not_fresh' }))
    // Gercek, bagimsiz dogrulama: kaynak klasoru YERINDE KALDI, tasinmadi.
    const sourceStillThere = await stat(join(root, 'kaynak-vaka'))
    expect(sourceStillThere.isDirectory()).toBe(true)
  })
})
