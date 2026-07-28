import { describe, expect, it } from 'vitest'
import { describeReadiness, runStartupGate, type GateChoice } from '../src/main/gate.js'
import type { ReadinessResult } from '../src/main/readiness.js'

const ready: ReadinessResult = { outcome: 'ready', ready: true, apiVersion: '0.0.0' }
const unreachable: ReadinessResult = { outcome: 'unreachable', ready: false }

function scriptedProbe(results: readonly ReadinessResult[]): () => Promise<ReadinessResult> {
  let index = 0
  return async () => {
    const result = results[Math.min(index, results.length - 1)] as ReadinessResult
    index += 1
    return result
  }
}

describe('runStartupGate', () => {
  it('API hazır ve uyumluysa hiç soru sormadan devam eder', async () => {
    let prompted = 0
    const outcome = await runStartupGate({
      probe: scriptedProbe([ready]),
      prompt: async () => { prompted += 1; return 'close' },
    })
    expect(outcome).toBe('proceed')
    expect(prompted).toBe(0)
  })

  it('kullanıcı yeniden denerse yeniden sorgular ve sonunda devam eder', async () => {
    // Sunucu geçici olarak kapalıyken kullanıcı mahsur kalmaz.
    const prompts: string[] = []
    const outcome = await runStartupGate({
      probe: scriptedProbe([unreachable, unreachable, ready]),
      prompt: async (message) => { prompts.push(message.title); return 'retry' },
    })
    expect(outcome).toBe('proceed')
    expect(prompts).toEqual(['Sunucuya ulaşılamıyor', 'Sunucuya ulaşılamıyor'])
  })

  it('kullanıcı kapatmayı seçerse pencere açılmaz', async () => {
    const outcome = await runStartupGate({
      probe: scriptedProbe([unreachable]),
      prompt: async () => 'close',
    })
    expect(outcome).toBe('abort')
  })

  it('sonsuz döngüye girmez', async () => {
    let attempts = 0
    const outcome = await runStartupGate({
      probe: async () => { attempts += 1; return unreachable },
      prompt: async (): Promise<GateChoice> => 'retry',
      maximumAttempts: 4,
    })
    expect(outcome).toBe('abort')
    expect(attempts).toBe(4)
  })

  it('uyumsuz sürümde de pencere açılmaz', async () => {
    const incompatible: ReadinessResult = { outcome: 'incompatible_minor', ready: false, apiVersion: '0.9.1' }
    let shown = ''
    const outcome = await runStartupGate({
      probe: scriptedProbe([incompatible]),
      prompt: async (message) => { shown = message.detail; return 'close' },
    })
    expect(outcome).toBe('abort')
    expect(shown).toContain('0.9.1')
  })
})

describe('describeReadiness', () => {
  it('her sonuç için Türkçe ve ayırt edici bir mesaj üretir', () => {
    const outcomes: ReadinessResult[] = [
      { outcome: 'ready', ready: true },
      { outcome: 'unreachable', ready: false },
      { outcome: 'api_degraded', ready: false },
      { outcome: 'invalid_response', ready: false },
      { outcome: 'unknown_service', ready: false },
      { outcome: 'unparseable_version', ready: false },
      { outcome: 'incompatible_major', ready: false, apiVersion: '9.0.0' },
      { outcome: 'incompatible_minor', ready: false, apiVersion: '0.9.0' },
    ]
    const titles = outcomes.map((result) => describeReadiness(result).title)
    for (const [index, result] of outcomes.entries()) {
      const message = describeReadiness(result)
      expect(message.title.length).toBeGreaterThan(0)
      expect(message.detail.length).toBeGreaterThan(0)
      // Mesaj ham hata metni, dosya yolu veya yapılandırma değeri taşımaz.
      expect(message.detail).not.toContain('http://')
      expect(message.detail).not.toContain('Error')
      expect(titles[index]).toBe(message.title)
    }
    // `incompatible_major` ve `incompatible_minor` kullanıcı için aynı
    // eylemi gerektirir; diğer sonuçların hepsi ayrı başlık taşır.
    expect(new Set(titles).size).toBe(outcomes.length - 1)
  })

  it('sürüm bilinmiyorsa mesaj uydurmaz', () => {
    const message = describeReadiness({ outcome: 'incompatible_major', ready: false })
    expect(message.detail).toContain('bilinmiyor')
  })
})
