export const shorthands = undefined

export function up(pgm) {
  // Retain foreign-key and immutable history references when excluding fixtures.
  pgm.addColumns('cases', { is_archived: { type: 'boolean', notNull: true, default: false } })
}

export function down(pgm) {
  pgm.dropColumns('cases', ['is_archived'])
}
