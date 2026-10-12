export const shorthands = undefined

export function up(pgm) {
  pgm.dropConstraint('users','users_status_valid')
  pgm.addConstraint('users','users_status_valid',{ check: "status IN ('active','disabled','pending')" })
  // Google-only identities have no local password; no fabricated credential is issued.
  pgm.alterColumn('users','password_hash',{ notNull: false })
}

export function down(pgm) {
  // Downgrade must fail rather than discard pending accounts or invent passwords.
  pgm.alterColumn('users','password_hash',{ notNull: true })
  pgm.dropConstraint('users','users_status_valid')
  pgm.addConstraint('users','users_status_valid',{ check: "status IN ('active','disabled')" })
}
