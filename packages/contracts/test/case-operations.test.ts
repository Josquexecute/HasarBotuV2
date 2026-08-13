import { describe, expect, it } from 'vitest'
import {
  CASE_NOTES_ROUTE,
  CASE_OPERATIONS_ROUTE,
  CASE_TASK_CANCEL_ROUTE,
  CASE_TASK_COMPLETE_ROUTE,
  CASE_TASKS_ROUTE,
  caseNoteCreateRequestSchema,
  caseOperationsResponseSchema,
  caseTaskCompleteRequestSchema,
  caseTaskCreateRequestSchema,
} from '../src/index.js'

const id = '019f7000-0000-7000-8000-000000000001'
const userId = '019f7000-0000-7000-8000-000000000002'

describe('case operations contracts', () => {
  it('route ve strict komut şemalarını sürümlü biçimde taşır', () => {
    expect(CASE_OPERATIONS_ROUTE).toBe('/api/v1/cases/:caseId/operations')
    expect(CASE_NOTES_ROUTE).toBe('/api/v1/cases/:caseId/notes')
    expect(CASE_TASKS_ROUTE).toBe('/api/v1/cases/:caseId/tasks')
    expect(CASE_TASK_COMPLETE_ROUTE).toContain('/:taskId/complete')
    expect(CASE_TASK_CANCEL_ROUTE).toContain('/:taskId/cancel')
    expect(caseNoteCreateRequestSchema.parse({ noteType: 'internal', body: 'Kontrol notu.' })).toEqual({
      noteType: 'internal',
      subject: null,
      body: 'Kontrol notu.',
    })
    expect(caseTaskCreateRequestSchema.parse({
      title: 'Servis formunu al',
      dueDate: '2026-07-18',
    })).toEqual({
      title: 'Servis formunu al',
      priority: 'normal',
      assignedUserId: null,
      dueDate: '2026-07-18',
    })
    expect(caseTaskCompleteRequestSchema.safeParse({ expectedVersion: 1, resultNote: ' ' }).success).toBe(false)
  })

  it('workspace response not, görev ve takip geçmişini strict doğrular', () => {
    const response = {
      caseId: id,
      asOfDate: '2026-07-16',
      notes: [{
        id,
        noteType: 'contact',
        subject: 'Servis',
        body: 'Sentetik görüşme notu.',
        createdByUserId: userId,
        createdByDisplayName: 'Sentetik Kullanıcı',
        createdAt: '2026-07-16T10:00:00.000Z',
        legacySource: null,
      }],
      tasks: [{
        id,
        title: 'Servis formunu al',
        priority: 'high',
        status: 'open',
        assignedUserId: userId,
        assignedUserDisplayName: 'Sentetik Kullanıcı',
        dueDate: '2026-07-15',
        dueStatus: 'overdue',
        resolutionNote: null,
        resolvedByUserId: null,
        resolvedByDisplayName: null,
        resolvedAt: null,
        version: 1,
        createdByUserId: userId,
        createdByDisplayName: 'Sentetik Kullanıcı',
        createdAt: '2026-07-16T10:00:00.000Z',
        updatedAt: '2026-07-16T10:00:00.000Z',
        legacySource: null,
      }],
      followUpHistory: [{
        id,
        previousFollowUpDate: null,
        newFollowUpDate: '2026-07-20',
        source: 'case_create',
        caseVersion: 1,
        actorUserId: userId,
        actorDisplayName: 'Sentetik Kullanıcı',
        changedAt: '2026-07-16T10:00:00.000Z',
      }],
      permissions: { canWrite: true, canCompleteTasks: true },
    }
    expect(caseOperationsResponseSchema.parse(response)).toEqual(response)
    expect(caseOperationsResponseSchema.safeParse({ ...response, absolutePath: 'P:\\müşteri' }).success).toBe(false)
  })
})
