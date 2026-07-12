/**
 * Paket 06 — kullanicilar, roller, sunucu tarafli oturumlar ve audit olaylari.
 *
 * - Kimlikler uygulamada UUIDv7 uretilir (HB-2026-009).
 * - E-posta kucuk-harf benzersizdir (global).
 * - Oturumlar iptal edilebilir: ham token SAKLANMAZ, yalniz SHA-256 hash'i.
 * - audit_events append-only kullanilir; guncelleme/silme uygulama politikasidir.
 */
export const shorthands = undefined

export function up(pgm) {
  pgm.createTable('users', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    email: { type: 'text', notNull: true },
    display_name: { type: 'text', notNull: true },
    password_hash: { type: 'text', notNull: true },
    status: { type: 'text', notNull: true, default: 'active' },
    failed_login_count: { type: 'integer', notNull: true, default: 0 },
    locked_until: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    version: { type: 'integer', notNull: true, default: 1 },
  })
  pgm.addConstraint('users', 'users_status_valid', { check: "status IN ('active','disabled')" })
  pgm.addConstraint('users', 'users_version_positive', { check: 'version >= 1' })
  pgm.addConstraint('users', 'users_failed_login_nonnegative', { check: 'failed_login_count >= 0' })
  pgm.sql('CREATE UNIQUE INDEX users_email_lower_unique ON users (lower(email))')

  pgm.createTable('roles', {
    id: { type: 'uuid', primaryKey: true },
    code: { type: 'text', notNull: true, unique: true },
    name: { type: 'text', notNull: true },
  })
  pgm.sql(
    "INSERT INTO roles (id, code, name) VALUES " +
      "(gen_random_uuid(), 'admin', 'Yonetici')," +
      "(gen_random_uuid(), 'expert', 'Eksper')," +
      "(gen_random_uuid(), 'case_manager', 'Dosya Sorumlusu')," +
      "(gen_random_uuid(), 'secretary', 'Sekreter')," +
      "(gen_random_uuid(), 'accounting', 'Muhasebe')," +
      "(gen_random_uuid(), 'read_only', 'Salt Okunur')",
  )

  pgm.createTable('user_roles', {
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    role_id: { type: 'uuid', notNull: true, references: 'roles', onDelete: 'RESTRICT' },
    granted_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('user_roles', 'user_roles_pk', { primaryKey: ['user_id', 'role_id'] })

  pgm.createTable('sessions', {
    id: { type: 'uuid', primaryKey: true },
    token_hash: { type: 'text', notNull: true, unique: true },
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    expires_at: { type: 'timestamptz', notNull: true },
    revoked_at: { type: 'timestamptz' },
  })
  pgm.createIndex('sessions', 'user_id')

  pgm.createTable('audit_events', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', references: 'organizations', onDelete: 'RESTRICT' },
    actor_user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    action: { type: 'text', notNull: true },
    resource_type: { type: 'text' },
    resource_id: { type: 'text' },
    request_id: { type: 'text' },
    occurred_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    details: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
  })
  pgm.createIndex('audit_events', ['action', 'occurred_at'])
}

export function down(pgm) {
  // Yalniz gelistirme/test ortami icindir.
  pgm.dropTable('audit_events')
  pgm.dropTable('sessions')
  pgm.dropTable('user_roles')
  pgm.dropTable('roles')
  pgm.dropTable('users')
}
