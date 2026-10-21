import { describe, expect, it } from 'vitest'
import type pg from 'pg'
import { createNoticeSheetStore } from '../src/notice-sheets/store.js'
import { loadServiceProfiles } from '../src/service-agreements/service.js'

const organizationId = '019f7000-0000-7000-8000-000000000101'
const caseId = '019f7000-0000-7000-8000-000000000102'
const userId = '019f7000-0000-7000-8000-000000000103'
const serviceId = '019f7000-0000-7000-8000-000000000104'
const context = { key: caseId, serviceId, insurerId: null, evaluationDate: '2026-10-20', dateSource: 'loss_date', operation: 'repair_authorization' } as const

function guardedConnection(rows: (sql: string) => readonly unknown[], activity = { active: 0, peak: 0 }) {
  let executing = false
  return {
    async query(sql: string) {
      if (executing) throw new Error('client is already executing a query')
      executing = true
      activity.active += 1
      activity.peak = Math.max(activity.peak, activity.active)
      try {
        await Promise.resolve()
        return { rows: rows(sql) }
      } finally {
        executing = false
        activity.active -= 1
      }
    },
    release() {},
  }
}

function serviceRows(sql: string) {
  return sql.includes('FROM service_centers')
    ? [{ id: serviceId, name: 'Synthetic service', service_type: 'private', is_active: true }]
    : []
}

describe('PostgreSQL client query serialization', () => {
  it('reads and saves notice sheets without overlapping queries on their transaction client', async () => {
    let saved = false
    const client = guardedConnection(sql => {
      if (sql.includes('INSERT INTO case_notice_sheets')) saved = true
      if (sql.includes('FROM cases c JOIN organizations')) return [{
        case_type: 'traffic', lifecycle_status: 'open', plate: '34 TEST 123', office_number: '2026/1',
        insurer_claim_number: null, notification_form_number: null, notification_date: '2026-10-20',
        loss_date: null, closure_date: null, organization_name: 'Synthetic office', insurer_name: null,
        expert_name: null, service_name: null, service_phone: null,
      }]
      if (sql.startsWith('SELECT overrides,version') && saved) return [{
        overrides: { fields: {}, documents: {} }, version: 1, updated_at: new Date('2026-10-20T10:00:00Z'),
      }]
      return []
    })
    const pool = { connect: async () => client } as unknown as pg.Pool
    const store = createNoticeSheetStore(pool)
    const actor = { organizationId, userId, requestId: 'query-serialization' }
    expect((await store.read(actor, caseId, true)).version).toBeNull()
    expect((await store.save(actor, caseId, { expectedVersion: null, overrides: { fields: {}, documents: {} }, confirmed: true })).version).toBe(1)
  })

  it('loads a service profile without overlapping queries on a transaction client', async () => {
    const client = guardedConnection(serviceRows) as unknown as pg.PoolClient
    expect((await loadServiceProfiles(client, organizationId, [context])).get(caseId))
      .toMatchObject({ id: serviceId, serviceType: 'private', isActive: true })
  })

  it('allows concurrent reads backed by independent pool connections', async () => {
    const activity = { active: 0, peak: 0 }
    const pool = {
      query: (sql: string) => guardedConnection(serviceRows, activity).query(sql),
    } as unknown as pg.Pool
    const results = await Promise.all([
      loadServiceProfiles(pool, organizationId, [context]),
      loadServiceProfiles(pool, organizationId, [context]),
    ])
    expect(results.map(result => result.get(caseId)?.id)).toEqual([serviceId, serviceId])
    expect(activity.peak).toBeGreaterThanOrEqual(2)
  })
})
