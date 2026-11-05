import type { CaseRecord } from '../../types/case'

/** Accept one complete Turkish mobile number, never a landline or mixed contact text. */
export function serviceMobile(item: CaseRecord): string | null {
  const phone = item.serviceDetails === undefined
    ? item.serviceProfile?.id === item.serviceId ? item.serviceProfile?.phone : null
    : item.serviceDetails?.phone
  if (!phone || !/^\+?[\d\s().-]+$/.test(phone.trim())) return null
  const digits = phone.replace(/\D/g, '').replace(/^(?:0090|90|0)(?=5\d{9}$)/, '')
  if (!/^5\d{9}$/.test(digits)) return null
  return `0${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 8)} ${digits.slice(8)}`
}

export function notificationDate(value: string | null | undefined): string {
  if (!value) return '—'
  const [year, month, day] = value.split('-')
  return `${day}.${month}.${year}`
}
