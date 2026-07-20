import { LABOR_ALLOCATION_CATEGORIES } from '@hasarbotu/domain'
import type { LaborAllocationLineRecord } from '../../data/laborAllocationPort.js'

/**
 * Paket 64 — kategori paneli için saf yardımcılar.
 *
 * Bileşenden ayrı durur: bunlar test edilebilir kurallardır ve bir React
 * component dosyasında yaşamaları fast-refresh sınırını bozar.
 */
export type CategoryLine = LaborAllocationLineRecord
export type CategoryAmounts =
  readonly { readonly category: string; readonly amountMinor: number }[]

export const CATEGORY_LABELS: Record<string, string> = {
  bodywork: 'Kaporta',
  mechanical: 'Mekanik',
  electrical: 'Elektrik',
  upholstery_lock: 'Döşeme/Kilit',
  glass: 'Cam',
  calibration: 'Kalibrasyon',
  repair: 'Onarım',
  paint: 'Boya',
}

export const formatMinor = (value: number): string => `${(value / 100).toFixed(2)} ₺`

/** Kategori paylarını yüzdeye çevirir; toplam sıfırsa pay hesaplanamaz. */
export function sharePercent(amounts: CategoryAmounts, category: string): number | null {
  const total = amounts.reduce((sum, item) => sum + item.amountMinor, 0)
  if (total === 0) return null
  const amount = amounts.find((item) => item.category === category)?.amountMinor ?? 0
  return (amount / total) * 100
}

/**
 * Kullanıcı girdisini kuruşa çevirir.
 *
 * Sayı olmayan, negatif ve TAM KURUŞA oturmayan değerler reddedilir; küsuratlı
 * kuruş gerçek bir tutar değildir ve sessizce yuvarlanmaz.
 */
export function parseCategoryMinor(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return 0
  const parsed = Number(trimmed.replace(',', '.'))
  if (!Number.isFinite(parsed) || parsed < 0) return null
  const minor = parsed * 100
  if (!Number.isInteger(Math.round(minor * 1000) / 1000)) return null
  return Math.round(minor)
}

export interface CategoryDraftEntry { readonly [category: string]: string }

/** Satırın yürürlükteki kategori tutarları: kullanıcı düzeltmesi varsa o. */
export function effectiveCategoryAmounts(
  line: CategoryLine,
  draft: CategoryDraftEntry | undefined,
): CategoryAmounts | null {
  if (line.categoryAllocation === null) return null
  if (draft === undefined) return line.categoryAllocation.amounts
  const parsed = LABOR_ALLOCATION_CATEGORIES.map((category) => ({
    category,
    amountMinor: parseCategoryMinor(draft[category] ?? ''),
  }))
  if (parsed.some((item) => item.amountMinor === null)) return null
  return parsed as CategoryAmounts
}

