/**
 * Cekirdek organizasyon (firma) kabugu — Paket 05.
 *
 * Kimlik uygulamada UUIDv7 olarak uretilir (DB tarafinda default yok; HB-2026-009).
 * Firma kaydi silinmez (DATABASE_MODEL_PLAN §4); bu kural uygulama/politika
 * katmanindadir, Paket 05 DB kisiti eklemez.
 */
export const shorthands = undefined

export function up(pgm) {
  pgm.createTable('organizations', {
    id: { type: 'uuid', primaryKey: true },
    code: { type: 'text', notNull: true },
    name: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    version: { type: 'integer', notNull: true, default: 1 },
  })
  pgm.addConstraint('organizations', 'organizations_code_unique', { unique: ['code'] })
  pgm.addConstraint('organizations', 'organizations_version_positive', { check: 'version >= 1' })
  pgm.addConstraint('organizations', 'organizations_code_format', {
    check: "code ~ '^[a-z0-9][a-z0-9_-]{0,62}[a-z0-9]$'",
  })
  pgm.addConstraint('organizations', 'organizations_name_not_blank', {
    check: "length(btrim(name)) > 0",
  })
}

export function down(pgm) {
  // Yalniz gelistirme/test ortami icindir; uretimde veri kayipli down yerine
  // onaylı ileri duzeltme kullanilir.
  pgm.dropTable('organizations')
}
