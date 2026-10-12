const calendar = new Intl.DateTimeFormat('en-CA',{ timeZone: 'Europe/Istanbul',year: 'numeric',month: '2-digit',day: '2-digit' })
/** Calendar dates stay dates; UTC instants are evaluated on the office's local day. */
export function toOfficeDate(value: string | Date): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  return calendar.format(typeof value === 'string' ? new Date(value) : value)
}
