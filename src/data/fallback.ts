import type { CaseRecord } from '../types/case'
import type { CasesDataPort } from './ports'

export interface FallbackResult {
  readonly cases: readonly CaseRecord[]
  /** true ise birincil kaynak basarisiz oldu ve guvenli mock verisi kullanildi. */
  readonly usedFallback: boolean
}

/**
 * Guvenli fallback: birincil kaynak (API) herhangi bir nedenle basarisiz olursa
 * UI kirilmaz; mock verisiyle calismaya devam eder. Hata ayrintisi kullaniciya
 * tasinmaz; konsola yalniz bilgi seviyesinde not dusulur.
 */
export function createFallbackCasesAdapter(
  primary: CasesDataPort,
  fallback: CasesDataPort,
): { listCases(): Promise<FallbackResult> } {
  return {
    async listCases(): Promise<FallbackResult> {
      try {
        return { cases: await primary.listCases(), usedFallback: false }
      } catch {
        console.info('Cases API kullanılamıyor; mock veriye dönüldü.')
        return { cases: await fallback.listCases(), usedFallback: true }
      }
    },
  }
}
