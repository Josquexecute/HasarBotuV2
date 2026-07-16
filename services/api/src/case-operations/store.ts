import type pg from 'pg'
import {
  caseNoteResponseSchema,
  caseNoteSchema,
  caseOperationsResponseSchema,
  caseTaskResponseSchema,
  caseTaskSchema,
  type CaseNoteCreateRequest,
  type CaseNoteDto,
  type CaseOperationsResponse,
  type CaseTaskCancelRequest,
  type CaseTaskCompleteRequest,
  type CaseTaskCreateRequest,
  type CaseTaskDto,
} from '@hasarbotu/contracts'
import { classifyCaseTaskDueDate } from '@hasarbotu/domain'
import { uuidv7 } from '@hasarbotu/database'
import { createAuditService } from '../audit/service.js'
import {
  findIdempotent,
  insertIdempotent,
  isIdempotencyRace,
  type IdempotentRecord,
} from '../db/idempotency.js'

interface ActorContext {
  readonly organizationId: string
  readonly actorUserId: string
  readonly requestId: string
}

interface CommandIdempotency {
  readonly scope: string
  readonly key: string
  readonly requestHash: string
}

interface NoteRow {
  id: string
  note_type: 'internal' | 'contact'
  subject: string | null
  body: string
  created_by_user_id: string
  created_by_display_name: string
  created_at: Date
}

interface TaskRow {
  id: string
  title: string
  priority: 'low' | 'normal' | 'high'
  status: 'open' | 'completed' | 'cancelled'
  assigned_user_id: string | null
  assigned_user_display_name: string | null
  due_date: Date | string
  resolution_note: string | null
  resolved_by_user_id: string | null
  resolved_by_display_name: string | null
  resolved_at: Date | null
  version: number
  created_by_user_id: string
  created_by_display_name: string
  created_at: Date
  updated_at: Date
}

interface FollowUpRow {
  id: string
  previous_follow_up_date: Date | string | null
  new_follow_up_date: Date | string | null
  source: 'case_create' | 'case_update'
  case_version: number
  actor_user_id: string
  actor_display_name: string
  changed_at: Date
}

export type CaseOperationCommandOutcome<T> =
  | { readonly kind: 'ok'; readonly item: T }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'case_closed' }
  | { readonly kind: 'version_conflict' }
  | { readonly kind: 'invalid_status' }
  | { readonly kind: 'idempotency_race' }

export class CaseOperationReferenceError extends Error {
  readonly field: string
  readonly code: string

  constructor(field: string, code: string) {
    super('case operation reference invalid')
    this.name = 'CaseOperationReferenceError'
    this.field = field
    this.code = code
  }
}

const NOTE_SELECT = `
  n.id,n.note_type,n.subject,n.body,n.created_by_user_id,
  creator.display_name AS created_by_display_name,n.created_at`

const TASK_SELECT = `
  t.id,t.title,t.priority,t.status,t.assigned_user_id,
  assignee.display_name AS assigned_user_display_name,t.due_date,t.resolution_note,
  t.resolved_by_user_id,resolver.display_name AS resolved_by_display_name,t.resolved_at,
  t.version,t.created_by_user_id,creator.display_name AS created_by_display_name,
  t.created_at,t.updated_at`

function localDate(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10)
  const year = String(value.getFullYear()).padStart(4, '0')
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function nullableLocalDate(value: Date | string | null): string | null {
  return value === null ? null : localDate(value)
}

function noteDto(row: NoteRow): CaseNoteDto {
  return caseNoteSchema.parse({
    id: row.id,
    noteType: row.note_type,
    subject: row.subject,
    body: row.body,
    createdByUserId: row.created_by_user_id,
    createdByDisplayName: row.created_by_display_name,
    createdAt: row.created_at.toISOString(),
  })
}

function taskDto(row: TaskRow, asOfDate: string): CaseTaskDto {
  return caseTaskSchema.parse({
    id: row.id,
    title: row.title,
    priority: row.priority,
    status: row.status,
    assignedUserId: row.assigned_user_id,
    assignedUserDisplayName: row.assigned_user_display_name,
    dueDate: localDate(row.due_date),
    dueStatus: classifyCaseTaskDueDate(localDate(row.due_date), asOfDate),
    resolutionNote: row.resolution_note,
    resolvedByUserId: row.resolved_by_user_id,
    resolvedByDisplayName: row.resolved_by_display_name,
    resolvedAt: row.resolved_at?.toISOString() ?? null,
    version: row.version,
    createdByUserId: row.created_by_user_id,
    createdByDisplayName: row.created_by_display_name,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  })
}

async function lockWritableCase(
  client: pg.PoolClient,
  organizationId: string,
  caseId: string,
): Promise<'ok' | 'not_found' | 'case_closed'> {
  const result = await client.query(
    'SELECT lifecycle_status FROM cases WHERE organization_id=$1 AND id::text=$2 FOR UPDATE',
    [organizationId, caseId],
  )
  const row = result.rows[0] as { lifecycle_status: 'open' | 'closed' } | undefined
  if (row === undefined) return 'not_found'
  return row.lifecycle_status === 'open' ? 'ok' : 'case_closed'
}

async function assertActiveAssignee(
  client: pg.PoolClient,
  organizationId: string,
  assignedUserId: string | null,
): Promise<void> {
  if (assignedUserId === null) return
  const result = await client.query(
    "SELECT status='active' AS allowed FROM users WHERE organization_id=$1 AND id::text=$2",
    [organizationId, assignedUserId],
  )
  if (result.rowCount === 0) throw new CaseOperationReferenceError('assignedUserId', 'unknown_reference')
  if ((result.rows[0] as { allowed: boolean }).allowed !== true) {
    throw new CaseOperationReferenceError('assignedUserId', 'inactive_reference')
  }
}

export function createCaseOperationsStore(pool: pg.Pool) {
  const audit = createAuditService()

  return {
    findIdempotent(
      organizationId: string,
      scope: string,
      key: string,
    ): Promise<IdempotentRecord | undefined> {
      return findIdempotent(pool, organizationId, scope, key)
    },

    async read(
      organizationId: string,
      caseId: string,
      asOfDate: string,
      canWrite: boolean,
    ): Promise<CaseOperationsResponse | undefined> {
      const exists = await pool.query(
        'SELECT lifecycle_status FROM cases WHERE organization_id=$1 AND id::text=$2',
        [organizationId, caseId],
      )
      if (exists.rowCount === 0) return undefined
      const lifecycleStatus = (exists.rows[0] as { lifecycle_status: 'open' | 'closed' }).lifecycle_status

      const [notesResult, tasksResult, followUpsResult] = await Promise.all([
        pool.query(
          `SELECT ${NOTE_SELECT}
           FROM case_notes n
           JOIN users creator ON creator.organization_id=n.organization_id AND creator.id=n.created_by_user_id
           WHERE n.organization_id=$1 AND n.case_id::text=$2
           ORDER BY n.created_at DESC,n.id DESC LIMIT 1000`,
          [organizationId, caseId],
        ),
        pool.query(
          `SELECT ${TASK_SELECT}
           FROM case_tasks t
           JOIN users creator ON creator.organization_id=t.organization_id AND creator.id=t.created_by_user_id
           LEFT JOIN users assignee ON assignee.organization_id=t.organization_id AND assignee.id=t.assigned_user_id
           LEFT JOIN users resolver ON resolver.organization_id=t.organization_id AND resolver.id=t.resolved_by_user_id
           WHERE t.organization_id=$1 AND t.case_id::text=$2
           ORDER BY CASE t.status WHEN 'open' THEN 0 ELSE 1 END,t.due_date,t.created_at DESC,t.id
           LIMIT 1000`,
          [organizationId, caseId],
        ),
        pool.query(
          `SELECT h.id,h.previous_follow_up_date,h.new_follow_up_date,h.source,h.case_version,
                  h.actor_user_id,actor.display_name AS actor_display_name,h.changed_at
           FROM case_follow_up_history h
           JOIN users actor ON actor.organization_id=h.organization_id AND actor.id=h.actor_user_id
           WHERE h.organization_id=$1 AND h.case_id::text=$2
           ORDER BY h.changed_at DESC,h.id DESC LIMIT 1000`,
          [organizationId, caseId],
        ),
      ])

      return caseOperationsResponseSchema.parse({
        caseId,
        asOfDate,
        notes: (notesResult.rows as NoteRow[]).map(noteDto),
        tasks: (tasksResult.rows as TaskRow[]).map((row) => taskDto(row, asOfDate)),
        followUpHistory: (followUpsResult.rows as FollowUpRow[]).map((row) => ({
          id: row.id,
          previousFollowUpDate: nullableLocalDate(row.previous_follow_up_date),
          newFollowUpDate: nullableLocalDate(row.new_follow_up_date),
          source: row.source,
          caseVersion: row.case_version,
          actorUserId: row.actor_user_id,
          actorDisplayName: row.actor_display_name,
          changedAt: row.changed_at.toISOString(),
        })),
        permissions: {
          canWrite: canWrite && lifecycleStatus === 'open',
          canCompleteTasks: canWrite && lifecycleStatus === 'open',
        },
      })
    },

    async createNote(
      actor: ActorContext,
      caseId: string,
      input: CaseNoteCreateRequest,
      idempotency: CommandIdempotency,
    ): Promise<CaseOperationCommandOutcome<CaseNoteDto>> {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const writable = await lockWritableCase(client, actor.organizationId, caseId)
        if (writable !== 'ok') {
          await client.query('ROLLBACK')
          return { kind: writable }
        }
        const noteId = uuidv7()
        const result = await client.query(
          `WITH inserted AS (
             INSERT INTO case_notes
               (id,organization_id,case_id,note_type,subject,body,created_by_user_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             RETURNING *
           )
           SELECT ${NOTE_SELECT}
           FROM inserted n
           JOIN users creator ON creator.organization_id=n.organization_id AND creator.id=n.created_by_user_id`,
          [
            noteId,
            actor.organizationId,
            caseId,
            input.noteType,
            input.subject,
            input.body,
            actor.actorUserId,
          ],
        )
        const note = noteDto(result.rows[0] as NoteRow)
        const responseBody = caseNoteResponseSchema.parse({ note })
        await audit.record(client, {
          organizationId: actor.organizationId,
          actorUserId: actor.actorUserId,
          requestId: actor.requestId,
          action: 'case_note.created',
          entityType: 'case_note',
          entityId: note.id,
          details: {
            caseId,
            noteType: note.noteType,
            hasSubject: note.subject !== null,
          },
        })
        await insertIdempotent(client, {
          organizationId: actor.organizationId,
          scope: idempotency.scope,
          key: idempotency.key,
          requestHash: idempotency.requestHash,
          responseStatus: 201,
          responseBody,
          caseId,
        })
        await client.query('COMMIT')
        return { kind: 'ok', item: note }
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        if (isIdempotencyRace(error)) return { kind: 'idempotency_race' }
        throw error
      } finally {
        client.release()
      }
    },

    async createTask(
      actor: ActorContext,
      caseId: string,
      input: CaseTaskCreateRequest,
      idempotency: CommandIdempotency,
      asOfDate: string,
    ): Promise<CaseOperationCommandOutcome<CaseTaskDto>> {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const writable = await lockWritableCase(client, actor.organizationId, caseId)
        if (writable !== 'ok') {
          await client.query('ROLLBACK')
          return { kind: writable }
        }
        await assertActiveAssignee(client, actor.organizationId, input.assignedUserId)
        const taskId = uuidv7()
        const inserted = await client.query(
          `INSERT INTO case_tasks
             (id,organization_id,case_id,title,priority,assigned_user_id,due_date,created_by_user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            taskId,
            actor.organizationId,
            caseId,
            input.title,
            input.priority,
            input.assignedUserId,
            input.dueDate,
            actor.actorUserId,
          ],
        )
        if (inserted.rowCount !== 1) throw new Error('case_task_insert_failed')
        await client.query(
          `INSERT INTO case_task_events
             (id,organization_id,case_id,task_id,event_type,task_version,actor_user_id)
           VALUES ($1,$2,$3,$4,'created',1,$5)`,
          [uuidv7(), actor.organizationId, caseId, taskId, actor.actorUserId],
        )
        const result = await client.query(
          `SELECT ${TASK_SELECT}
           FROM case_tasks t
           JOIN users creator ON creator.organization_id=t.organization_id AND creator.id=t.created_by_user_id
           LEFT JOIN users assignee ON assignee.organization_id=t.organization_id AND assignee.id=t.assigned_user_id
           LEFT JOIN users resolver ON resolver.organization_id=t.organization_id AND resolver.id=t.resolved_by_user_id
           WHERE t.organization_id=$1 AND t.case_id=$2 AND t.id=$3`,
          [actor.organizationId, caseId, taskId],
        )
        const task = taskDto(result.rows[0] as TaskRow, asOfDate)
        const responseBody = caseTaskResponseSchema.parse({ task })
        await audit.record(client, {
          organizationId: actor.organizationId,
          actorUserId: actor.actorUserId,
          requestId: actor.requestId,
          action: 'case_task.created',
          entityType: 'case_task',
          entityId: task.id,
          details: {
            caseId,
            priority: task.priority,
            dueDate: task.dueDate,
            assigned: task.assignedUserId !== null,
          },
        })
        await insertIdempotent(client, {
          organizationId: actor.organizationId,
          scope: idempotency.scope,
          key: idempotency.key,
          requestHash: idempotency.requestHash,
          responseStatus: 201,
          responseBody,
          caseId,
        })
        await client.query('COMMIT')
        return { kind: 'ok', item: task }
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        if (isIdempotencyRace(error)) return { kind: 'idempotency_race' }
        throw error
      } finally {
        client.release()
      }
    },

    async transitionTask(
      actor: ActorContext,
      caseId: string,
      taskId: string,
      status: 'completed' | 'cancelled',
      input: CaseTaskCompleteRequest | CaseTaskCancelRequest,
      idempotency: CommandIdempotency,
      asOfDate: string,
    ): Promise<CaseOperationCommandOutcome<CaseTaskDto>> {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const writable = await lockWritableCase(client, actor.organizationId, caseId)
        if (writable !== 'ok') {
          await client.query('ROLLBACK')
          return { kind: writable }
        }
        const current = await client.query(
          `SELECT status,version FROM case_tasks
           WHERE organization_id=$1 AND case_id::text=$2 AND id::text=$3 FOR UPDATE`,
          [actor.organizationId, caseId, taskId],
        )
        const currentTask = current.rows[0] as { status: string; version: number } | undefined
        if (currentTask === undefined) {
          await client.query('ROLLBACK')
          return { kind: 'not_found' }
        }
        if (currentTask.version !== input.expectedVersion) {
          await client.query('ROLLBACK')
          return { kind: 'version_conflict' }
        }
        if (currentTask.status !== 'open') {
          await client.query('ROLLBACK')
          return { kind: 'invalid_status' }
        }
        const resolutionNote = status === 'completed'
          ? (input as CaseTaskCompleteRequest).resultNote
          : (input as CaseTaskCancelRequest).reason
        const nextVersion = currentTask.version + 1
        await client.query(
          `UPDATE case_tasks
           SET status=$1,resolution_note=$2,resolved_by_user_id=$3,resolved_at=now(),
               version=$4,updated_at=now()
           WHERE organization_id=$5 AND case_id::text=$6 AND id::text=$7`,
          [status, resolutionNote, actor.actorUserId, nextVersion, actor.organizationId, caseId, taskId],
        )
        await client.query(
          `INSERT INTO case_task_events
             (id,organization_id,case_id,task_id,event_type,task_version,actor_user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [uuidv7(), actor.organizationId, caseId, taskId, status, nextVersion, actor.actorUserId],
        )
        const result = await client.query(
          `SELECT ${TASK_SELECT}
           FROM case_tasks t
           JOIN users creator ON creator.organization_id=t.organization_id AND creator.id=t.created_by_user_id
           LEFT JOIN users assignee ON assignee.organization_id=t.organization_id AND assignee.id=t.assigned_user_id
           LEFT JOIN users resolver ON resolver.organization_id=t.organization_id AND resolver.id=t.resolved_by_user_id
           WHERE t.organization_id=$1 AND t.case_id::text=$2 AND t.id::text=$3`,
          [actor.organizationId, caseId, taskId],
        )
        const task = taskDto(result.rows[0] as TaskRow, asOfDate)
        const responseBody = caseTaskResponseSchema.parse({ task })
        await audit.record(client, {
          organizationId: actor.organizationId,
          actorUserId: actor.actorUserId,
          requestId: actor.requestId,
          action: status === 'completed' ? 'case_task.completed' : 'case_task.cancelled',
          entityType: 'case_task',
          entityId: task.id,
          details: {
            caseId,
            fromVersion: input.expectedVersion,
            toVersion: task.version,
            status: task.status,
          },
        })
        await insertIdempotent(client, {
          organizationId: actor.organizationId,
          scope: idempotency.scope,
          key: idempotency.key,
          requestHash: idempotency.requestHash,
          responseStatus: 200,
          responseBody,
          caseId,
        })
        await client.query('COMMIT')
        return { kind: 'ok', item: task }
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        if (isIdempotencyRace(error)) return { kind: 'idempotency_race' }
        throw error
      } finally {
        client.release()
      }
    },
  }
}

export type CaseOperationsStore = ReturnType<typeof createCaseOperationsStore>
