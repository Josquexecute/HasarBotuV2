import { describe, expect, it } from 'vitest'
import snapshotJson from '../../../reference-data/value-loss/real-market-analysis/2026-07-01/1.0.0/snapshot.json' with { type: 'json' }
import {
  assertRealMarketValueLossRuleSnapshot,
  realMarketValueLossRuleSnapshot,
} from '../src/traffic-value-loss/rule-source.js'

function clone(): unknown {
  return structuredClone(snapshotJson)
}

describe('Değer kaybı immutable rule source', () => {
  it('runtime kaynağını beklenen identity/hash ile derin dondurur', () => {
    expect(realMarketValueLossRuleSnapshot.identity)
      .toBe('real-market-analysis/2026-07-01/1.0.0')
    expect(realMarketValueLossRuleSnapshot.source.workbookSha256)
      .toBe('81d3ae870cd5569b13371ec8b4de081a9a4e3e15098f7454f5d0cdcd3708c424')
    expect(Object.isFrozen(realMarketValueLossRuleSnapshot)).toBe(true)
    expect(Object.isFrozen(realMarketValueLossRuleSnapshot.partRules)).toBe(true)
    expect(Object.isFrozen(realMarketValueLossRuleSnapshot.partRules[0])).toBe(true)
  })

  it.each([
    ['identity', (value: Record<string, unknown>) => { value.identity = 'mutated' }],
    ['workbook hash', (value: Record<string, unknown>) => {
      ;(value.source as Record<string, unknown>).workbookSha256 = 'f'.repeat(64)
    }],
    ['provenance', (value: Record<string, unknown>) => {
      const mappings = value.vehicleMappings as Array<Record<string, unknown>>
      const productDecision = mappings.find((item) => item.provenance === 'product_decision')
      if (productDecision === undefined) throw new Error('TEST_PRODUCT_DECISION_REQUIRED')
      productDecision.provenance = 'source_workbook'
    }],
    ['part rule', (value: Record<string, unknown>) => {
      const rules = value.partRules as Array<Record<string, unknown>>
      rules[0]!.sourceLabel = 'mutated'
    }],
    ['anomaly', (value: Record<string, unknown>) => {
      value.anomalies = (value.anomalies as unknown[]).slice(1)
    }],
  ])('%s kasıtlı kırılmasını fail-closed reddeder', (_name, mutate) => {
    const value = clone() as Record<string, unknown>
    mutate(value)
    expect(() => assertRealMarketValueLossRuleSnapshot(value)).toThrow(
      /VALUE_LOSS_RULE_SNAPSHOT_(?:INVALID|HASH_MISMATCH)/,
    )
  })
})
