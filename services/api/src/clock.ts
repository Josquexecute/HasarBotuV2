/**
 * Zaman kaynagi adaptoru. Health yaniti gibi zaman ureten yollar bu arayuzu
 * kullanir; testler sabit clock enjekte ederek deterministik calisir.
 */
export interface Clock {
  /** Kanonik `Z` sonekli UTC ISO tarih-saat dondurur (contracts uyumlu). */
  nowUtcIso(): string
}

/** Gercek sistem saati; her cagride guncel UTC uretir. */
export const systemClock: Clock = {
  nowUtcIso: () => new Date().toISOString(),
}

/** Testler icin sabit clock. */
export function fixedClock(isoUtc: string): Clock {
  return { nowUtcIso: () => isoUtc }
}
