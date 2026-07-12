import { describe, expect, it } from 'vitest'
import { isUuidV7, uuidv7 } from '../src/index.js'

describe('uuidv7', () => {
  it('RFC 9562 bicimine uyar: surum 7 ve varyant 10', () => {
    for (let index = 0; index < 200; index += 1) {
      const id = uuidv7()
      expect(isUuidV7(id)).toBe(true)
      expect(id[14]).toBe('7')
      expect(['8', '9', 'a', 'b']).toContain(id[19])
    }
  })

  it('zaman damgasi gercek saate yakindir', () => {
    const before = Date.now()
    const id = uuidv7()
    const after = Date.now()
    const tsHex = id.slice(0, 8) + id.slice(9, 13)
    const ts = Number.parseInt(tsHex, 16)
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
  })

  it('farkli milisaniyelerde leksikografik siralidir', async () => {
    const first = uuidv7()
    await new Promise((resolve) => setTimeout(resolve, 3))
    const second = uuidv7()
    expect(first < second).toBe(true)
  })

  it('benzersizdir (10k ornek)', () => {
    const seen = new Set<string>()
    for (let index = 0; index < 10_000; index += 1) seen.add(uuidv7())
    expect(seen.size).toBe(10_000)
  })

  it('isUuidV7 v4 ve bozuk degerleri reddeder', () => {
    expect(isUuidV7('a3bb189e-8bf9-4888-9912-ace4e6543002')).toBe(false)
    expect(isUuidV7('not-a-uuid')).toBe(false)
    expect(isUuidV7('')).toBe(false)
  })
})
