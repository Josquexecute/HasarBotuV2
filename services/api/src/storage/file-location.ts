import type { Queryable } from '../db/executor.js'

interface RegisteredFileLocation {
  readonly case_id: string
  readonly storage_root_key: string
  readonly relative_path: string
  readonly created_at: Date
}

interface MoveRow {
  case_id: string
  previous_storage_root_key: string
  previous_relative_path: string
  storage_root_key: string
  relative_path: string
  occurred_at: Date
}

/** Keep registered evidence immutable; follow only committed, physical workspace moves. */
export async function resolveFileLocations<T extends RegisteredFileLocation>(
  exec: Queryable,
  organizationId: string,
  files: readonly T[],
): Promise<T[]> {
  if (files.length === 0) return []
  const moves = await exec.query<MoveRow>(
    `SELECT case_id,previous_storage_root_key,previous_relative_path,storage_root_key,relative_path,occurred_at
     FROM case_location_history
     WHERE organization_id=$1 AND case_id=ANY($2::uuid[]) AND source='system'
       AND previous_storage_root_key IS NOT NULL AND previous_relative_path IS NOT NULL
     ORDER BY occurred_at,id`,
    [organizationId, [...new Set(files.map(file => file.case_id))]],
  )
  return files.map(file => {
    let root = file.storage_root_key
    let path = file.relative_path
    for (const move of moves.rows) {
      if (move.case_id !== file.case_id || move.occurred_at < file.created_at || root !== move.previous_storage_root_key) continue
      const prefix = `${move.previous_relative_path}/`
      if (!path.toLowerCase().startsWith(prefix.toLowerCase())) continue
      path = `${move.relative_path}/${path.slice(prefix.length)}`
      root = move.storage_root_key
    }
    return { ...file, storage_root_key: root, relative_path: path }
  })
}
