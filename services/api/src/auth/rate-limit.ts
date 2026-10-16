/**
 * Kucuk, bagimliliksiz sabit-pencere hiz sinirlayici (tek dugum icin).
 * Login yolunu IP bazinda korur; hesap bazli brute-force korumasi ayrica
 * veritabanindaki kilitleme sayaciyla yapilir (yeniden baslatmada kalicidir).
 */
export interface RateLimitDecision {
  readonly allowed: boolean
  readonly retryAfterMs: number
}

export interface FixedWindowLimiter {
  consume(key: string): RateLimitDecision
}

export interface FixedWindowOptions {
  readonly limit: number
  readonly windowMs: number
  /** New keys are rejected at capacity; active limits are never evicted. */
  readonly maximumKeys?: number
  /** Test enjeksiyonu icin zaman kaynagi. */
  readonly now?: () => number
}

export function createFixedWindowLimiter(options: FixedWindowOptions): FixedWindowLimiter {
  const maximumKeys = options.maximumKeys ?? 10_000
  for (const value of [options.limit, options.windowMs, maximumKeys]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('Rate limits must be positive safe integers.')
  }
  const now = options.now ?? Date.now
  const windows = new Map<string, { start: number; count: number }>()

  return {
    consume(key: string): RateLimitDecision {
      const current = now()
      // Entries stay in window-start order. Cleanup is amortized and bounded,
      // without a timer that would keep the process alive after shutdown.
      for (const [expiredKey, expired] of windows) {
        if (current - expired.start < options.windowMs) break
        windows.delete(expiredKey)
      }
      const window = windows.get(key)
      if (window === undefined) {
        if (windows.size >= maximumKeys) {
          const oldest = windows.values().next().value!
          return { allowed: false, retryAfterMs: Math.max(1, options.windowMs - (current - oldest.start)) }
        }
        windows.set(key, { start: current, count: 1 })
        return { allowed: true, retryAfterMs: 0 }
      }
      if (window.count >= options.limit) {
        return { allowed: false, retryAfterMs: options.windowMs - (current - window.start) }
      }
      window.count += 1
      return { allowed: true, retryAfterMs: 0 }
    },
  }
}
