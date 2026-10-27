export const shorthands = undefined

export function up(pgm) {
  pgm.addColumn('case_file_operations', { file_lock: { type: 'jsonb', check: "file_lock IS NULL OR jsonb_typeof(file_lock)='object'" } })
}

export function down(pgm) {
  pgm.dropColumn('case_file_operations', 'file_lock')
}
