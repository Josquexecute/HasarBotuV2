/**
 * Paket 12 — depolama referansı ve güvenli göreli yol temeli.
 *
 * Kaynak doğruluk yalnız MANTIKSAL `root_key` + POSIX göreli yoldur. Mutlak
 * `P:\`, sürücü harfi veya UNC yolu veritabanına YAZILMAZ (cihaz→mutlak eşlemesi
 * yalnız yerel File Agent/config'te tutulur). `relative_path` üzerindeki CHECK
 * kısıtları uygulama doğrulamasına EK bir veritabanı savunma katmanıdır:
 * traversal (`..`), absolute, sürücü ön eki, backslash/UNC, kontrol karakteri ve
 * Windows yasak karakterleri reddedilir.
 */
export const shorthands = undefined

// relative_path için veritabanı seviyesinde güvenlik kısıtı (savunma-derinliği).
const SAFE_RELATIVE_PATH_CHECK = `
  relative_path <> ''
  AND left(relative_path, 1) <> '/'
  AND relative_path !~ '^[A-Za-z]:'
  AND relative_path !~ '(^|/)[.][.](/|$)'
  AND relative_path !~ '[<>:"|?*]'
  AND relative_path !~ '[[:cntrl:]]'
  AND strpos(relative_path, chr(92)) = 0
`

export function up(pgm) {
  // Mantıksal depolama kökleri (org bazlı). Mutlak yol kolonu YOKTUR.
  pgm.createTable('storage_roots', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    root_key: { type: 'text', notNull: true },
    label: { type: 'text', notNull: true },
    is_active: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('storage_roots', 'storage_roots_org_key_unique', { unique: ['organization_id', 'root_key'] })
  pgm.addConstraint('storage_roots', 'storage_roots_key_format', {
    check: "root_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(root_key) <= 64",
  })

  // Vaka güncel konumu: vaka başına tek satır; optimistic locking.
  pgm.createTable('case_locations', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    case_id: { type: 'uuid', notNull: true, references: 'cases', onDelete: 'CASCADE' },
    storage_root_key: { type: 'text', notNull: true },
    relative_path: { type: 'text', notNull: true },
    verification_status: { type: 'text', notNull: true, default: 'pending' },
    source: { type: 'text', notNull: true, default: 'manual' },
    version: { type: 'integer', notNull: true, default: 1 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('case_locations', 'case_locations_case_unique', { unique: ['organization_id', 'case_id'] })
  pgm.addConstraint('case_locations', 'case_locations_path_unique', {
    unique: ['organization_id', 'storage_root_key', 'relative_path'],
  })
  pgm.addConstraint('case_locations', 'case_locations_version_positive', { check: 'version >= 1' })
  pgm.addConstraint('case_locations', 'case_locations_status_valid', {
    check: "verification_status IN ('pending','verified','missing')",
  })
  pgm.addConstraint('case_locations', 'case_locations_source_valid', {
    check: "source IN ('manual','system','imported')",
  })
  pgm.addConstraint('case_locations', 'case_locations_relative_path_safe', { check: SAFE_RELATIVE_PATH_CHECK })
  // Kök, aynı organizasyonda tanımlı olmalıdır (composite FK).
  pgm.addConstraint('case_locations', 'case_locations_root_fk', {
    foreignKeys: {
      columns: ['organization_id', 'storage_root_key'],
      references: 'storage_roots (organization_id, root_key)',
      onDelete: 'RESTRICT',
    },
  })

  // Konum değişiklik geçmişi (append-only).
  pgm.createTable('case_location_history', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    case_id: { type: 'uuid', notNull: true, references: 'cases', onDelete: 'CASCADE' },
    storage_root_key: { type: 'text', notNull: true },
    relative_path: { type: 'text', notNull: true },
    previous_relative_path: { type: 'text' },
    verification_status: { type: 'text', notNull: true },
    source: { type: 'text', notNull: true },
    changed_by_user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    request_id: { type: 'text' },
    occurred_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.createIndex('case_location_history', ['organization_id', 'case_id', 'occurred_at'])
  pgm.addConstraint('case_location_history', 'case_location_history_relative_path_safe', {
    check: SAFE_RELATIVE_PATH_CHECK,
  })

  // Geçmiş append-only: UPDATE/DELETE veritabanı seviyesinde reddedilir.
  pgm.createFunction(
    'append_only_guard',
    [],
    { returns: 'trigger', language: 'plpgsql' },
    `BEGIN
       RAISE EXCEPTION '% is append-only: % is not permitted', TG_TABLE_NAME, TG_OP
         USING ERRCODE = 'restrict_violation';
     END;`,
  )
  pgm.createTrigger('case_location_history', 'case_location_history_no_update', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'append_only_guard',
  })
  pgm.createTrigger('case_location_history', 'case_location_history_no_delete', {
    when: 'BEFORE',
    operation: 'DELETE',
    level: 'ROW',
    function: 'append_only_guard',
  })
}

export function down(pgm) {
  // Yalniz gelistirme/test ortami icindir.
  pgm.dropTrigger('case_location_history', 'case_location_history_no_delete')
  pgm.dropTrigger('case_location_history', 'case_location_history_no_update')
  pgm.dropFunction('append_only_guard', [])
  pgm.dropTable('case_location_history')
  pgm.dropTable('case_locations')
  pgm.dropTable('storage_roots')
}
