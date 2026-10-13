const officeDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' })
const clock = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' })
const calendar = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', year: 'numeric' })

export function notificationDay(timestamp: string, now = new Date()): string {
  const date = new Date(timestamp)
  const key = officeDay.format(date)
  if (key === officeDay.format(now)) return 'Bugün'
  if (key === officeDay.format(new Date(now.getTime() - 86_400_000))) return 'Dün'
  return calendar.format(date)
}

export function notificationTime(timestamp: string, now = new Date()): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(timestamp)) return calendar.format(new Date(timestamp))
  const date = new Date(timestamp)
  const minutes = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60_000))
  if (officeDay.format(date) === officeDay.format(now)) {
    if (minutes < 1) return 'Az önce'
    if (minutes < 60) return `${minutes} dk önce`
    return clock.format(date)
  }
  return `${notificationDay(timestamp, now)} · ${clock.format(date)}`
}

export function groupNotifications<T>(items: readonly T[], timestamp: (item: T) => string, now = new Date()): Array<{ title: string; items: T[] }> {
  const groups = new Map<string, T[]>()
  for (const item of [...items].sort((a, b) => Date.parse(timestamp(b)) - Date.parse(timestamp(a)))) {
    const title = notificationDay(timestamp(item), now)
    const values = groups.get(title) ?? []
    values.push(item)
    groups.set(title, values)
  }
  return Array.from(groups, ([title, values]) => ({ title, items: values }))
}
