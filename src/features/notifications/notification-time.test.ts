import { describe, expect, it } from 'vitest'
import { groupNotifications, notificationDay, notificationTime } from './notification-time'

describe('notification calendar in office time', () => {
  const now = new Date('2026-10-13T00:15:00Z')
  it('groups midnight using Istanbul dates rather than UTC dates', () => {
    expect(notificationDay('2026-10-12T21:00:00Z', now)).toBe('Bugün')
    expect(notificationDay('2026-10-12T20:59:00Z', now)).toBe('Dün')
    expect(notificationTime('2026-10-13T00:10:00Z', now)).toBe('5 dk önce')
    expect(notificationTime('2026-10-12', now)).toBe('12 Ekim 2026')
  })
  it('orders events within their dates without mutating the API snapshot', () => {
    const items = [{ id: 'yesterday', date: '2026-10-12T20:59:00Z' }, { id: 'today', date: '2026-10-13T00:10:00Z' }, { id: 'midnight', date: '2026-10-12T21:00:00Z' }]
    expect(groupNotifications(items, item => item.date, now).map(group => ({ title: group.title, ids: group.items.map(item => item.id) }))).toEqual([{ title: 'Bugün', ids: ['today', 'midnight'] }, { title: 'Dün', ids: ['yesterday'] }])
    expect(items.map(item => item.id)).toEqual(['yesterday', 'today', 'midnight'])
  })
})
