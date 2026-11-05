export const shorthands = undefined

export function up(pgm) {
  pgm.addColumn('google_oauth_states', { desktop_redirect_uri: { type: 'text' } })
  pgm.addConstraint('google_oauth_states', 'google_desktop_login_only', {
    check: "desktop_redirect_uri IS NULL OR (client='desktop' AND purpose='login' AND desktop_redirect_uri ~ '^http://127[.]0[.]0[.]1:[0-9]{4,5}/api/v1/google/desktop/callback$')",
  })
}

export function down(pgm) {
  pgm.dropConstraint('google_oauth_states', 'google_desktop_login_only')
  pgm.dropColumn('google_oauth_states', 'desktop_redirect_uri')
}
