import { readFileSync } from 'node:fs'
import {
  REAL_MARKET_VALUE_LOSS_SNAPSHOT_SHA256,
  hashValueLossRuleSnapshot,
  validateValueLossRuleSnapshot,
  type ValueLossRuleSnapshot,
} from '@hasarbotu/domain'

const SNAPSHOT_URL = new URL(
  '../../../../reference-data/value-loss/real-market-analysis/2026-07-01/1.0.0/snapshot.json',
  import.meta.url,
)

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

export function assertRealMarketValueLossRuleSnapshot(parsed: unknown): ValueLossRuleSnapshot {
  const snapshot = parsed as ValueLossRuleSnapshot
  const validation = validateValueLossRuleSnapshot(snapshot)
  if (!validation.ok) {
    throw new Error(`VALUE_LOSS_RULE_SNAPSHOT_INVALID:${validation.errors.join(',')}`)
  }
  if (hashValueLossRuleSnapshot(snapshot) !== REAL_MARKET_VALUE_LOSS_SNAPSHOT_SHA256) {
    throw new Error('VALUE_LOSS_RULE_SNAPSHOT_HASH_MISMATCH')
  }
  return deepFreeze(snapshot)
}

function loadSnapshot(): ValueLossRuleSnapshot {
  const parsed = JSON.parse(readFileSync(SNAPSHOT_URL, 'utf8')) as unknown
  return assertRealMarketValueLossRuleSnapshot(parsed)
}

export const realMarketValueLossRuleSnapshot = loadSnapshot()
