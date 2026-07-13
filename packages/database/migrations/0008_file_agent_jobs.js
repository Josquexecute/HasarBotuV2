/**
 * Paket 14 — File Agent kontrol katmanı ve iş kuyruğu.
 *
 * - `agents`: cihaz/agent kimliği (kullanıcı oturumlarından AYRI). Ham secret
 *   ASLA saklanmaz; yalnız SHA-256 hash'i tutulur.
 * - `jobs`: PostgreSQL tabanlı iş kuyruğu. Claim `FOR UPDATE SKIP LOCKED` ile
 *   yapılır (aynı işi iki agent alamaz). Payload YALNIZ güvenli alanlar taşır:
 *   `storage_root_key` + göreli yol + beyan hash/size; MUTLAK YOL ASLA yazılmaz
 *   (CHECK ile de engellenir). Lease/heartbeat/timeout ile geri kazanım,
 *   attempt sınırı ve `dead_letter` durumu.
 */
export const shorthands = undefined

export function up(pgm) {
  pgm.createTable('agents', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    name: { type: 'text', notNull: true },
    secret_hash: { type: 'text', notNull: true },
    status: { type: 'text', notNull: true, default: 'active' },
    last_seen_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('agents', 'agents_org_name_unique', { unique: ['organization_id', 'name'] })
  pgm.addConstraint('agents', 'agents_status_valid', { check: "status IN ('active','disabled')" })
  pgm.addConstraint('agents', 'agents_secret_hash_unique', { unique: ['secret_hash'] })

  pgm.createTable('jobs', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    type: { type: 'text', notNull: true },
    status: { type: 'text', notNull: true, default: 'pending' },
    target_type: { type: 'text', notNull: true },
    target_id: { type: 'uuid', notNull: true },
    target_version: { type: 'integer', notNull: true, default: 0 },
    payload: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    attempt_count: { type: 'integer', notNull: true, default: 0 },
    max_attempts: { type: 'integer', notNull: true, default: 5 },
    leased_by_agent_id: { type: 'uuid', references: 'agents', onDelete: 'SET NULL' },
    lease_expires_at: { type: 'timestamptz' },
    heartbeat_at: { type: 'timestamptz' },
    next_attempt_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    last_error_code: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('jobs', 'jobs_type_valid', {
    check: "type IN ('verify_document','verify_photo','verify_case_location')",
  })
  pgm.addConstraint('jobs', 'jobs_status_valid', {
    check: "status IN ('pending','leased','succeeded','failed','dead_letter')",
  })
  pgm.addConstraint('jobs', 'jobs_target_type_valid', {
    check: "target_type IN ('document_version','photo','case_location')",
  })
  pgm.addConstraint('jobs', 'jobs_attempt_nonnegative', { check: 'attempt_count >= 0 AND max_attempts >= 1' })
  // Payload'da mutlak yol/sürücü/backslash bulunamaz (savunma-derinliği).
  pgm.addConstraint('jobs', 'jobs_payload_no_absolute_path', {
    check: `payload::text !~ '[A-Za-z]:'
      AND strpos(payload::text, chr(92)) = 0
      AND (payload->>'relativePath') !~ '(^|/)[.][.](/|$)'`,
  })
  // Claim sıralaması için: uygun (pending/expired-lease) işleri hızlı bul.
  pgm.createIndex('jobs', ['organization_id', 'status', 'next_attempt_at'])
  pgm.createIndex('jobs', ['status', 'lease_expires_at'])
}

export function down(pgm) {
  // Yalniz gelistirme/test ortami icindir.
  pgm.dropTable('jobs')
  pgm.dropTable('agents')
}
