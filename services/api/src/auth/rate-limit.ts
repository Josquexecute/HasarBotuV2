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
  /** Test enjeksiyonu icin zaman kaynagi. */
  readonly now?: () => number
}

export function createFixedWindowLimiter(options: FixedWindowOptions): FixedWindowLimiter {
  const now = options.now ?? Date.now
  const windows = new Map<string, { start: number; count: number }>()

  return {
    consume(key: string): RateLimitDecision {
      const current = now()
      const window = windows.get(key)
      if (window === undefined || current - window.start >= options.windowMs) {
        windows.set(key, { start: current, count: 1 })
        return { allowed: true, retryAfterMs: 0 }
      }
      window.count += 1
      if (window.count > options.limit) {
        return { allowed: false, retryAfterMs: options.windowMs - (current - window.start) }
      }
      return { allowed: true, retryAfterMs: 0 }
    },
  }
}
