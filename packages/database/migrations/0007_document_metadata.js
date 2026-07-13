/**
 * Paket 13 — belge, belge sürümü ve fotoğraf META VERİSİ temeli.
 *
 * Yalnız metadata; fiziksel dosya YOK. Konum yalnız mantıksal `storage_root_key`
 * + POSIX göreli yol (mutlak yol yok, aynı güvenlik CHECK'i). `status` modeli
 * pending|ready|failed|missing; `ready` ancak güvenilir doğrulama (hash+size+
 * verified_at) ile mümkündür — bu CHECK ile ZORLANIR. Sürüm kayıtları ve
 * fotoğraflar APPEND-ONLY'dir: kayıtlı gerçekler değişmez, DELETE yasak; yalnız
 * doğrulama alanları (status/hash_verified/size_verified/verified_at) ileride
 * File Agent tarafından güncellenebilir (public API bu alanları set edemez).
 */
export const shorthands = undefined

const SAFE_RELATIVE_PATH_CHECK = `
  relative_path <> ''
  AND left(relative_path, 1) <> '/'
  AND relative_path !~ '^[A-Za-z]:'
  AND relative_path !~ '(^|/)[.][.](/|$)'
  AND relative_path !~ '[<>:"|?*]'
  AND relative_path !~ '[[:cntrl:]]'
  AND strpos(relative_path, chr(92)) = 0
`
const READY_REQUIRES_VERIFICATION =
  "status <> 'ready' OR (hash_verified AND size_verified AND verified_at IS NOT NULL)"
const STATUS_VALID = "status IN ('pending','ready','failed','missing')"
const SOURCE_VALID = "source_type IN ('upload','email','scan','imported','manual')"
const HASH_FORMAT = "content_hash ~ '^[a-f0-9]{64}$'"

export function up(pgm) {
  // Mantıksal belge slotu (mutable aggregate; optimistic locking).
  pgm.createTable('documents', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    case_id: { type: 'uuid', notNull: true, references: 'cases', onDelete: 'CASCADE' },
    document_type: { type: 'text', notNull: true },
    current_version_id: { type: 'uuid' },
    current_version_number: { type: 'integer', notNull: true, default: 0 },
    status: { type: 'text', notNull: true, default: 'pending' },
    version: { type: 'integer', notNull: true, default: 1 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('documents', 'documents_type_format', {
    check: "document_type ~ '^[a-z0-9_]+$' AND length(document_type) <= 64",
  })
  pgm.addConstraint('documents', 'documents_status_valid', { check: STATUS_VALID })
  pgm.addConstraint('documents', 'documents_version_positive', { check: 'version >= 1' })
  pgm.addConstraint('documents', 'documents_current_version_nonnegative', { check: 'current_version_number >= 0' })
  pgm.createIndex('documents', ['organization_id', 'case_id'])

  // Belge sürümü (append-only kayıtlı gerçek + doğrulama durumu).
  pgm.createTable('document_versions', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    document_id: { type: 'uuid', notNull: true, references: 'documents', onDelete: 'CASCADE' },
    case_id: { type: 'uuid', notNull: true, references: 'cases', onDelete: 'CASCADE' },
    version_number: { type: 'integer', notNull: true },
    previous_version_id: { type: 'uuid', references: 'document_versions', onDelete: 'SET NULL' },
    original_file_name: { type: 'text', notNull: true },
    display_name: { type: 'text', notNull: true },
    extension: { type: 'text' },
    mime_type: { type: 'text', notNull: true },
    byte_size: { type: 'bigint', notNull: true },
    content_hash: { type: 'text', notNull: true },
    storage_root_key: { type: 'text', notNull: true },
    relative_path: { type: 'text', notNull: true },
    source_type: { type: 'text', notNull: true },
    status: { type: 'text', notNull: true, default: 'pending' },
    hash_verified: { type: 'boolean', notNull: true, default: false },
    size_verified: { type: 'boolean', notNull: true, default: false },
    verified_at: { type: 'timestamptz' },
    registered_by_user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    request_id: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('document_versions', 'document_versions_version_unique', {
    unique: ['document_id', 'version_number'],
  })
  pgm.addConstraint('document_versions', 'document_versions_path_unique', {
    unique: ['organization_id', 'storage_root_key', 'relative_path'],
  })
  pgm.addConstraint('document_versions', 'document_versions_version_positive', { check: 'version_number >= 1' })
  pgm.addConstraint('document_versions', 'document_versions_byte_size_nonnegative', { check: 'byte_size >= 0' })
  pgm.addConstraint('document_versions', 'document_versions_status_valid', { check: STATUS_VALID })
  pgm.addConstraint('document_versions', 'document_versions_source_valid', { check: SOURCE_VALID })
  pgm.addConstraint('document_versions', 'document_versions_hash_format', { check: HASH_FORMAT })
  pgm.addConstraint('document_versions', 'document_versions_ready_requires_verification', {
    check: READY_REQUIRES_VERIFICATION,
  })
  pgm.addConstraint('document_versions', 'document_versions_relative_path_safe', { check: SAFE_RELATIVE_PATH_CHECK })
  pgm.createIndex('document_versions', ['organization_id', 'case_id'])
  pgm.createIndex('document_versions', ['organization_id', 'content_hash'])

  // documents.current_version_id -> document_versions (döngüsel; şimdi eklenir).
  pgm.addConstraint('documents', 'documents_current_version_fk', {
    foreignKeys: { columns: 'current_version_id', references: 'document_versions', onDelete: 'SET NULL' },
  })

  // Fotoğraf (bağımsız append-only metadata kaydı).
  pgm.createTable('photos', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    case_id: { type: 'uuid', notNull: true, references: 'cases', onDelete: 'CASCADE' },
    original_file_name: { type: 'text', notNull: true },
    display_name: { type: 'text', notNull: true },
    extension: { type: 'text' },
    mime_type: { type: 'text', notNull: true },
    byte_size: { type: 'bigint', notNull: true },
    content_hash: { type: 'text', notNull: true },
    storage_root_key: { type: 'text', notNull: true },
    relative_path: { type: 'text', notNull: true },
    source_type: { type: 'text', notNull: true },
    status: { type: 'text', notNull: true, default: 'pending' },
    hash_verified: { type: 'boolean', notNull: true, default: false },
    size_verified: { type: 'boolean', notNull: true, default: false },
    verified_at: { type: 'timestamptz' },
    registered_by_user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    request_id: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('photos', 'photos_path_unique', {
    unique: ['organization_id', 'storage_root_key', 'relative_path'],
  })
  pgm.addConstraint('photos', 'photos_byte_size_nonnegative', { check: 'byte_size >= 0' })
  pgm.addConstraint('photos', 'photos_status_valid', { check: STATUS_VALID })
  pgm.addConstraint('photos', 'photos_source_valid', { check: SOURCE_VALID })
  pgm.addConstraint('photos', 'photos_hash_format', { check: HASH_FORMAT })
  pgm.addConstraint('photos', 'photos_ready_requires_verification', { check: READY_REQUIRES_VERIFICATION })
  pgm.addConstraint('photos', 'photos_relative_path_safe', { check: SAFE_RELATIVE_PATH_CHECK })
  pgm.createIndex('photos', ['organization_id', 'case_id'])
  pgm.createIndex('photos', ['organization_id', 'content_hash'])

  // Append-only + immutable kayıtlı gerçekler: DELETE yasak; UPDATE yalnız
  // doğrulama alanlarını (status/hash_verified/size_verified/verified_at)
  // değiştirebilir. Generic: to_jsonb ile izin verilenler dışındaki her alan
  // değişikliği reddedilir (File Agent doğrulama damgası için yol).
  pgm.createFunction(
    'metadata_append_guard',
    [],
    { returns: 'trigger', language: 'plpgsql' },
    `BEGIN
       IF TG_OP = 'DELETE' THEN
         RAISE EXCEPTION '% is append-only: DELETE is not permitted', TG_TABLE_NAME
           USING ERRCODE = 'restrict_violation';
       END IF;
       IF (to_jsonb(NEW) - 'status' - 'hash_verified' - 'size_verified' - 'verified_at')
          IS DISTINCT FROM
          (to_jsonb(OLD) - 'status' - 'hash_verified' - 'size_verified' - 'verified_at') THEN
         RAISE EXCEPTION '% registered fields are immutable', TG_TABLE_NAME
           USING ERRCODE = 'restrict_violation';
       END IF;
       RETURN NEW;
     END;`,
  )
  for (const table of ['document_versions', 'photos']) {
    pgm.createTrigger(table, `${table}_no_delete`, {
      when: 'BEFORE',
      operation: 'DELETE',
      level: 'ROW',
      function: 'metadata_append_guard',
    })
    pgm.createTrigger(table, `${table}_immutable_update`, {
      when: 'BEFORE',
      operation: 'UPDATE',
      level: 'ROW',
      function: 'metadata_append_guard',
    })
  }
}

export function down(pgm) {
  // Yalniz gelistirme/test ortami icindir.
  for (const table of ['document_versions', 'photos']) {
    pgm.dropTrigger(table, `${table}_immutable_update`)
    pgm.dropTrigger(table, `${table}_no_delete`)
  }
  pgm.dropFunction('metadata_append_guard', [])
  pgm.dropTable('photos')
  pgm.dropConstraint('documents', 'documents_current_version_fk')
  pgm.dropTable('document_versions')
  pgm.dropTable('documents')
}
