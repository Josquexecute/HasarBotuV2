import { createHash } from 'node:crypto'
import type pg from 'pg'
import { casesQuerySchema, type CasesQuery } from '@hasarbotu/contracts'
import { parsePlateNumber, plateSearchKey } from '@hasarbotu/domain'
import { createCasesStore, type CaseListResult } from './store.js'

interface IntegrityRow {
  id: string
  plate: string
  plate_normalized: string
  case_type: string | null
  lifecycle_status: string
  responsible_user_id: string | null
  version: number
}
type ListPage = (query: CasesQuery) => Promise<CaseListResult>
const fingerprint = (rows: readonly IntegrityRow[]) => createHash('sha256')
  .update(JSON.stringify(rows.map(row => [row.id, row.version]))).digest('hex')
const baselineSql = `SELECT id,plate,plate_normalized,case_type,lifecycle_status,responsible_user_id,version
  FROM cases WHERE organization_id=$1 AND NOT is_archived ORDER BY id`

/** Read-only independent row oracle versus every page of the real listing query.
 * An optional authenticated HTTP reader also checks the route/serialization layer.
 * Reports contain counts only; concurrent external writes cannot produce a false PASS.
 */
export async function inspectCaseListIntegrity(pool: pg.Pool, organizationId: string, readPage?: ListPage) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const rows = (await client.query<IntegrityRow>(baselineSql, [organizationId])).rows
    const list = readPage ?? ((query: CasesQuery) => createCasesStore(client as unknown as pg.Pool).list(organizationId, query))
    const scopes: Partial<CasesQuery>[] = [{}, { status: 'open' }, { status: 'closed' },
      { caseType: 'traffic' }, { caseType: 'casco' }, { caseType: 'unclassified' },
      ...[...new Set(rows.flatMap(row => row.responsible_user_id === null ? [] : [row.responsible_user_id]))]
        .map(responsibleUserId => ({ responsibleUserId }))]
    const result = { status: 'PASS' as 'PASS' | 'FAIL' | 'INCONCLUSIVE', checkedCases: rows.length,
      checkedScopes: 0, checkedPages: 0, missingItems: 0, unexpectedItems: 0, duplicateItems: 0,
      countMismatches: 0, normalizationMismatches: rows.filter(row => {
        const parsed = parsePlateNumber(row.plate)
        return !parsed.ok || plateSearchKey(parsed.value) !== row.plate_normalized
      }).length,
      concurrentChanges: false }
    for (const scope of scopes) {
      const expected = new Set(rows.filter(row =>
        (scope.status === undefined || row.lifecycle_status === scope.status)
        && (scope.caseType === undefined || row.case_type === (scope.caseType === 'unclassified' ? null : scope.caseType))
        && (scope.responsibleUserId === undefined || row.responsible_user_id === scope.responsibleUserId)).map(row => row.id))
      for (const sort of [{ sortBy: 'officeCaseNumber', sortDirection: 'asc' }, { sortBy: 'updatedAt', sortDirection: 'desc' }] as const) {
        result.checkedScopes++
        const seen = new Set<string>()
        for (let page = 1; page <= Math.max(1, Math.ceil(expected.size / 50)); page++) {
          const actual = await list(casesQuerySchema.parse({ ...scope, ...sort, page, pageSize: 50 }))
          result.checkedPages++
          if (actual.totalItems !== expected.size) result.countMismatches++
          for (const item of actual.items) {
            if (seen.has(item.id)) result.duplicateItems++
            if (!expected.has(item.id)) result.unexpectedItems++
            seen.add(item.id)
          }
        }
        result.missingItems += [...expected].filter(id => !seen.has(id)).length
      }
    }
    await client.query('COMMIT')
    if (readPage) result.concurrentChanges = fingerprint(rows) !== fingerprint((await client.query<IntegrityRow>(baselineSql, [organizationId])).rows)
    if (result.missingItems + result.unexpectedItems + result.duplicateItems + result.countMismatches + result.normalizationMismatches > 0) result.status = 'FAIL'
    if (result.concurrentChanges) result.status = 'INCONCLUSIVE'
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}
