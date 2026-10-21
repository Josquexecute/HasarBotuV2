export const shorthands = undefined

export function up(pgm) {
  pgm.addColumn('google_oauth_states', { client: { type: 'text', notNull: true, default: 'web', check: "client IN ('web','field','desktop')" } })
}

export function down(pgm) {
  pgm.dropColumn('google_oauth_states', 'client')
}
