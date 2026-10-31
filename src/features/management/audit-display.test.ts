import { describe, expect, it } from 'vitest'
import { AUDIT_ACTION_CODES, auditActionLabel, auditCategory, auditResult, auditEventSchema } from '@hasarbotu/contracts'
import { auditChanges, groupAuditEvents, safeTechnicalRecord } from './audit-display'

const event = auditEventSchema.parse({ id: 'test', actorUserId: 'actor', organizationId: 'org', entityType: 'case', entityId: 'case', requestId: null, occurredAt: '2026-10-29T09:00:00Z', action: 'access.viewed', details: { method: 'GET', route: '/cases/:caseId', statusCode: 200 } })
describe('audit presentation without modifying source records', () => {
  it('labels the current vocabulary in Turkish and leaves unknown future actions explicit', () => {
    expect(AUDIT_ACTION_CODES.length).toBeGreaterThan(140)
    for (const code of AUDIT_ACTION_CODES) expect(auditActionLabel(code), code).not.toBe('Diğer işlem kaydı')
    expect(auditActionLabel('future.unknown')).toBe('Diğer işlem kaydı')
    expect(auditActionLabel('case.updated')).toBe('Dosya bilgileri güncellendi')
    expect(auditCategory('permissions.updated')).toBe('permissions')
    expect(auditCategory('file_operation.finalized')).toBe('files')
  })
  it('distinguishes transport failures, rejections, cancellation and unconfirmed outcomes', () => {
    expect(auditResult('request.completed', { statusCode: 503 })).toBe('failed')
    expect(auditResult('access.viewed', { statusCode: 403 })).toBe('rejected')
    expect(auditResult('file_operation.queued')).toBe('pending')
    expect(auditResult('file_operation.cancelled')).toBe('cancelled')
    expect(auditResult('email_ai_suggestion.outcome_unknown')).toBe('pending')
    expect(auditResult('future.unknown')).toBe('recorded')
  })
  it('groups only identical read/transport records inside a bounded minute and retains originals', () => {
    const items = [event, { ...event, id: '2', occurredAt: '2026-10-29T09:00:30Z' }, { ...event, id: '3', occurredAt: '2026-10-29T09:01:01Z' }, { ...event, id: '4', actorUserId: 'other' }, { ...event, id: '5', action: 'request.rejected' }, { ...event, id: '6', action: 'request.rejected' }].map(item => auditEventSchema.parse(item))
    const before = JSON.stringify(items)
    const groups = groupAuditEvents(items, true)
    expect(groups.map(group => group.items.length)).toEqual([2, 1, 1, 1, 1])
    expect(groups.flatMap(group => group.items)).toHaveLength(items.length)
    expect(groupAuditEvents(items, false)).toHaveLength(items.length)
    expect(JSON.stringify(items)).toBe(before)
  })
  it('uses recorded old/new values and supports legacy role and permission changes', () => {
    expect(auditChanges({ before: { caseType: 'traffic', workflowStage: null }, after: { caseType: 'casco', workflowStage: 'reporting' } })).toEqual([
      { field: 'Dosya türü', before: 'Trafik', after: 'Kasko' }, { field: 'İş akışı aşaması', before: 'Boş', after: 'Rapor hazırlanıyor' },
    ])
    expect(auditChanges({ previousRoles: ['read_only'], newRoles: ['expert'] })).toEqual([{ field: 'Roller', before: 'Okuyucu', after: 'Eksper' }])
    expect(auditChanges({ changedFields: ['caseType'] })).toEqual([])
    expect(auditChanges({ before: {}, after: { displayName: 'Yeni' } })[0]?.before).toBe('Kaydedilmemiş')
  })
  it('hides secrets and content from changes and the technical viewer', () => {
    const details = { before: { password: 'old', token: 'old', content: 'private' }, after: { password: 'new', token: 'new', content: 'private2' } }
    expect(auditChanges(details)).toEqual([])
    const raw = JSON.stringify(safeTechnicalRecord(details))
    expect(raw).not.toContain('private')
    expect(raw).not.toContain('old')
    expect(raw).toContain('[redacted]')
  })
})
