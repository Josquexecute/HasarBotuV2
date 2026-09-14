import { describe, expect, it } from 'vitest'
import { AgentConfigError, loadAgentConfigFromEnv } from '../src/config.js'

function environment(roots: string): NodeJS.ProcessEnv {
  return {
    HASARBOTU_AGENT_ROOTS: roots,
    HASARBOTU_API_BASE_URL: 'http://127.0.0.1:3100',
    HASARBOTU_AGENT_ID: 'synthetic-agent',
    HASARBOTU_AGENT_SECRET: 'synthetic-config-test-secret',
  }
}

describe('File Agent root configuration diagnostics', () => {
  it.each([
    'SYNTHETIC_PRIVATE_VALUE',
    '{"SYNTHETIC_PRIVATE_VALUE":',
    '{"SYNTHETIC_PRIVATE_VALUE":42}',
    '{"SYNTHETIC_PRIVATE_VALUE":""}',
    '["SYNTHETIC_PRIVATE_VALUE"]',
    'null',
  ])('rejects invalid roots without exposing the input (%#)', (roots) => {
    const load = () => loadAgentConfigFromEnv(environment(roots))
    expect(load).toThrow(AgentConfigError)
    expect(load).toThrow(
      'invalid HASARBOTU_AGENT_ROOTS: expected a JSON object with non-empty string paths',
    )
    try {
      load()
    } catch (error) {
      expect(String(error)).not.toContain('SYNTHETIC_PRIVATE_VALUE')
    }
  })

  it('preserves valid root mappings and default worker settings', () => {
    const roots = { 'synthetic-root': 'C:\\synthetic-storage' }
    const config = loadAgentConfigFromEnv(environment(JSON.stringify(roots)))
    expect(config.roots).toEqual(roots)
    expect(config.leaseSeconds).toBe(120)
    expect(config.pollIntervalMs).toBe(5000)
    expect(config.freshnessGate).toBeUndefined()
  })
})
