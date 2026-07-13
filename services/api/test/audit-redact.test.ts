import { describe, expect, it } from 'vitest'
import {
  MAX_AUDIT_STRING_LENGTH,
  REDACTED,
  redactValue,
  summarizeChange,
} from '../src/audit/index.js'

/**
 * Redaksiyon birim testleri (DB'siz). Audit details'e parola/token/cerez/tam
 * metin sizmadigini ve derinlik/uzunluk sinirlarini dogrular.
 */
describe('redactValue', () => {
  it('hassas ADli alanlari [redacted] yapar (deger tipinden bagimsiz)', () => {
    const out = redactValue({
      password: 'sirr',
      passwordHash: 'x',
      tokenHash: 'y',
      sessionToken: 'z',
      cookie: 'c=1',
      authorization: 'Bearer t',
      apiKey: 'k',
      note: 'gorunur',
    }) as Record<string, unknown>
    expect(out.password).toBe(REDACTED)
    expect(out.passwordHash).toBe(REDACTED)
    expect(out.tokenHash).toBe(REDACTED)
    expect(out.sessionToken).toBe(REDACTED)
    expect(out.cookie).toBe(REDACTED)
    expect(out.authorization).toBe(REDACTED)
    expect(out.apiKey).toBe(REDACTED)
    expect(out.note).toBe('gorunur')
  })

  it('ic ice nesnelerde ve dizilerde de redaksiyon uygular', () => {
    const out = redactValue({ level1: { secret: 's', keep: 1 }, list: [{ token: 't', ok: true }] }) as {
      level1: Record<string, unknown>
      list: Record<string, unknown>[]
    }
    expect(out.level1.secret).toBe(REDACTED)
    expect(out.level1.keep).toBe(1)
    expect(out.list[0]!.token).toBe(REDACTED)
    expect(out.list[0]!.ok).toBe(true)
  })

  it('asiri uzun metni kirpar (tam poliçe metni gibi hacim engellenir)', () => {
    const out = redactValue({ policyText: 'A'.repeat(5000), body: 'B'.repeat(5000) }) as Record<string, string>
    // policyText anahtari hassas kalibina girer -> tamamen redakte
    expect(out.policyText).toBe(REDACTED)
    // body hassas degil ama uzunluk sinirlanir
    expect(out.body.length).toBeLessThanOrEqual(MAX_AUDIT_STRING_LENGTH + 16)
    expect(out.body.endsWith('[truncated]')).toBe(true)
  })

  it('undefined/fonksiyon atlanir; sonlu olmayan sayi null olur; bigint string olur', () => {
    const out = redactValue({ a: undefined, b: () => 1, c: Number.POSITIVE_INFINITY, d: 10n, e: 'ok' }) as Record<
      string,
      unknown
    >
    expect('a' in out).toBe(false)
    expect('b' in out).toBe(false)
    expect(out.c).toBeNull()
    expect(out.d).toBe('10')
    expect(out.e).toBe('ok')
  })

  it('derinlik sinirinda daha derini [redacted] yapar', () => {
    let nested: Record<string, unknown> = { value: 'deep' }
    for (let i = 0; i < 10; i += 1) nested = { child: nested }
    const out = JSON.stringify(redactValue(nested))
    expect(out).toContain(REDACTED)
    expect(out).not.toContain('deep')
  })
})

describe('summarizeChange', () => {
  it('yalniz degisen alanlarin adlarini ve redakteli eski/yeni degerini tasir', () => {
    const summary = summarizeChange(
      { workflowStage: 'new_notification', note: 'a', password: 'old' },
      { workflowStage: 'reporting', note: 'a', password: 'new' },
    )
    expect(summary.changedFields.sort()).toEqual(['password', 'workflowStage'])
    expect(summary.before.workflowStage).toBe('new_notification')
    expect(summary.after.workflowStage).toBe('reporting')
    // Degisti ama hassas ADli -> deger redakte
    expect(summary.before.password).toBe(REDACTED)
    expect(summary.after.password).toBe(REDACTED)
  })

  it('fields verildiginde yalniz o alanlari karsilastirir', () => {
    const summary = summarizeChange({ a: 1, b: 2 }, { a: 9, b: 8 }, ['a'])
    expect(summary.changedFields).toEqual(['a'])
    expect(summary.after.a).toBe(9)
    expect('b' in summary.after).toBe(false)
  })
})
