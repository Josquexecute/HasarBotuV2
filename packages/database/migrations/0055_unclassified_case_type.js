export const shorthands = undefined
export function up(pgm) {
  // NULL means an explicit pending classification, never an inferred traffic/casco type.
  pgm.alterColumn('cases', 'case_type', { notNull: false })
}
export function down(pgm) {
  // A downgrade must fail while pending classifications exist.
  pgm.alterColumn('cases', 'case_type', { notNull: true })
}
