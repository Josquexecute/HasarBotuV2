/**
 * Paket 43 — kullanıcı kontrollü İşçilik (parça ve işçilik) çekirdeği.
 *
 * Her case için tek bir İşçilik föyü aggregate'i tutulur; sürümler immutable ve
 * append-only'dir. Satır kalemleri bir onarım işleminin parça ve işçilik bedelini
 * minor birimde (bigint kuruş) taşır. AI, Excel yazımı, dosya içeriği veya mutlak
 * yol yoktur; tutar dağıtımı ve öğrenme sözlüğü sonraki dilimlere bırakılmıştır.
 */
export const shorthands = undefined

const MAX_AMOUNT_MINOR = 100_000_000_00

export function up(pgm) {
  pgm.createTable('labor_sheets', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    case_id: { type: 'uuid', notNull: true },
    current_version_id: { type: 'uuid' },
    version: { type: 'integer', notNull: true, default: 1 },
    created_by_user_id: { type: 'uuid', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('labor_sheets', 'labor_sheets_case_fk', {
    foreignKeys: {
      columns: ['organization_id', 'case_id'],
      references: 'cases (organization_id, id)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('labor_sheets', 'labor_sheets_creator_fk', {
    foreignKeys: {
      columns: ['organization_id', 'created_by_user_id'],
      references: 'users (organization_id, id)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('labor_sheets', 'labor_sheets_case_unique', {
    unique: ['organization_id', 'case_id'],
  })
  pgm.addConstraint('labor_sheets', 'labor_sheets_org_case_id_unique', {
    unique: ['organization_id', 'case_id', 'id'],
  })
  pgm.addConstraint('labor_sheets', 'labor_sheets_version_positive', {
    check: 'version >= 1',
  })
  pgm.createIndex('labor_sheets', ['organization_id', 'case_id', 'updated_at'])

  pgm.createTable('labor_sheet_versions', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    case_id: { type: 'uuid', notNull: true },
    sheet_id: { type: 'uuid', notNull: true },
    sheet_version: { type: 'integer', notNull: true },
    previous_version_id: { type: 'uuid' },
    source_type: { type: 'text', notNull: true },
    currency: { type: 'text', notNull: true },
    revision_reason: { type: 'text' },
    created_by_user_id: { type: 'uuid', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('labor_sheet_versions', 'labor_sheet_versions_sheet_fk', {
    foreignKeys: {
      columns: ['organization_id', 'case_id', 'sheet_id'],
      references: 'labor_sheets (organization_id, case_id, id)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('labor_sheet_versions', 'labor_sheet_versions_creator_fk', {
    foreignKeys: {
      columns: ['organization_id', 'created_by_user_id'],
      references: 'users (organization_id, id)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('labor_sheet_versions', 'labor_sheet_versions_org_case_id_unique', {
    unique: ['organization_id', 'case_id', 'id'],
  })
  pgm.addConstraint('labor_sheet_versions', 'labor_sheet_versions_org_case_sheet_id_unique', {
    unique: ['organization_id', 'case_id', 'sheet_id', 'id'],
  })
  pgm.addConstraint('labor_sheet_versions', 'labor_sheet_versions_number_unique', {
    unique: ['sheet_id', 'sheet_version'],
  })
  pgm.addConstraint('labor_sheet_versions', 'labor_sheet_versions_previous_fk', {
    foreignKeys: {
      columns: ['organization_id', 'case_id', 'sheet_id', 'previous_version_id'],
      references: 'labor_sheet_versions (organization_id, case_id, sheet_id, id)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('labor_sheet_versions', 'labor_sheet_versions_static_valid', {
    check: `currency='TRY'
      AND source_type IN ('user_entered','manual_revision')
      AND sheet_version >= 1`,
  })
  pgm.addConstraint('labor_sheet_versions', 'labor_sheet_versions_shape_valid', {
    check: `(sheet_version=1 AND previous_version_id IS NULL
        AND source_type='user_entered' AND revision_reason IS NULL)
      OR (sheet_version>1 AND previous_version_id IS NOT NULL
        AND source_type='manual_revision'
        AND length(revision_reason) BETWEEN 1 AND 500
        AND revision_reason ~ '[^[:space:]]'
        AND revision_reason !~ '[[:cntrl:]]')`,
  })
  pgm.createIndex('labor_sheet_versions', ['organization_id', 'case_id', 'created_at'])

  pgm.addConstraint('labor_sheets', 'labor_sheets_current_version_fk', {
    foreignKeys: {
      columns: ['organization_id', 'case_id', 'id', 'current_version_id'],
      references: 'labor_sheet_versions (organization_id, case_id, sheet_id, id)',
      onDelete: 'RESTRICT',
    },
  })

  pgm.createTable('labor_sheet_items', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    case_id: { type: 'uuid', notNull: true },
    sheet_id: { type: 'uuid', notNull: true },
    sheet_version_id: { type: 'uuid', notNull: true },
    ordinal: { type: 'integer', notNull: true },
    description: { type: 'text', notNull: true },
    action: { type: 'text', notNull: true },
    part_amount_minor: { type: 'bigint', notNull: true },
    labor_amount_minor: { type: 'bigint', notNull: true },
  })
  pgm.addConstraint('labor_sheet_items', 'labor_sheet_items_version_fk', {
    foreignKeys: {
      columns: ['organization_id', 'case_id', 'sheet_id', 'sheet_version_id'],
      references: 'labor_sheet_versions (organization_id, case_id, sheet_id, id)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('labor_sheet_items', 'labor_sheet_items_sheet_fk', {
    foreignKeys: {
      columns: ['organization_id', 'case_id', 'sheet_id'],
      references: 'labor_sheets (organization_id, case_id, id)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('labor_sheet_items', 'labor_sheet_items_ordinal_unique', {
    unique: ['sheet_version_id', 'ordinal'],
  })
  pgm.addConstraint('labor_sheet_items', 'labor_sheet_items_shape_valid', {
    check: `ordinal BETWEEN 1 AND 200
      AND length(description) BETWEEN 1 AND 160
      AND description ~ '[^[:space:]]'
      AND description !~ '[[:cntrl:]]'
      AND length(action) BETWEEN 1 AND 80
      AND action ~ '[^[:space:]]'
      AND action !~ '[[:cntrl:]]'
      AND part_amount_minor BETWEEN 0 AND ${MAX_AMOUNT_MINOR}
      AND labor_amount_minor BETWEEN 0 AND ${MAX_AMOUNT_MINOR}
      AND (part_amount_minor + labor_amount_minor) > 0`,
  })
  pgm.createIndex('labor_sheet_items', ['sheet_version_id', 'ordinal'])

  pgm.sql(`
    CREATE FUNCTION labor_sheet_version_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
      aggregate_version integer;
      aggregate_current_version_id uuid;
    BEGIN
      SELECT version,current_version_id
        INTO aggregate_version,aggregate_current_version_id
        FROM labor_sheets
       WHERE organization_id=NEW.organization_id
         AND case_id=NEW.case_id
         AND id=NEW.sheet_id
       FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'labor sheet aggregate missing' USING ERRCODE='foreign_key_violation';
      END IF;
      IF NEW.sheet_version=1 THEN
        IF aggregate_version<>1 OR aggregate_current_version_id IS NOT NULL
          OR NEW.previous_version_id IS NOT NULL THEN
          RAISE EXCEPTION 'labor sheet first version is invalid' USING ERRCODE='check_violation';
        END IF;
      ELSIF NEW.sheet_version<>aggregate_version+1
        OR NEW.previous_version_id IS DISTINCT FROM aggregate_current_version_id THEN
        RAISE EXCEPTION 'labor sheet version chain is invalid' USING ERRCODE='check_violation';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER labor_sheet_version_insert_guard
      BEFORE INSERT ON labor_sheet_versions
      FOR EACH ROW EXECUTE FUNCTION labor_sheet_version_insert_guard();

    CREATE FUNCTION labor_sheet_aggregate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP='DELETE' THEN
        RAISE EXCEPTION 'labor sheet cannot be deleted' USING ERRCODE='restrict_violation';
      END IF;
      IF OLD.organization_id<>NEW.organization_id OR OLD.case_id<>NEW.case_id
        OR OLD.created_by_user_id<>NEW.created_by_user_id
        OR OLD.created_at<>NEW.created_at THEN
        RAISE EXCEPTION 'labor sheet identity is immutable' USING ERRCODE='restrict_violation';
      END IF;
      IF OLD.current_version_id IS NULL AND NEW.current_version_id IS NOT NULL
        AND OLD.version=1 AND NEW.version=1 THEN
        RETURN NEW;
      END IF;
      IF NEW.version<>OLD.version+1 OR NEW.current_version_id IS NOT DISTINCT FROM OLD.current_version_id THEN
        RAISE EXCEPTION 'labor sheet version must increment once' USING ERRCODE='check_violation';
      END IF;
      PERFORM 1
        FROM labor_sheet_versions
       WHERE organization_id=NEW.organization_id
         AND case_id=NEW.case_id
         AND sheet_id=NEW.id
         AND id=NEW.current_version_id
         AND sheet_version=NEW.version;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'labor sheet current version is invalid' USING ERRCODE='check_violation';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER labor_sheet_aggregate_guard
      BEFORE UPDATE OR DELETE ON labor_sheets
      FOR EACH ROW EXECUTE FUNCTION labor_sheet_aggregate_guard();
  `)

  for (const table of ['labor_sheet_versions', 'labor_sheet_items']) {
    pgm.createTrigger(table, `${table}_no_update`, {
      when: 'BEFORE',
      operation: 'UPDATE',
      level: 'ROW',
      function: 'append_only_guard',
    })
    pgm.createTrigger(table, `${table}_no_delete`, {
      when: 'BEFORE',
      operation: 'DELETE',
      level: 'ROW',
      function: 'append_only_guard',
    })
  }
}

export function down(pgm) {
  pgm.dropTrigger('labor_sheet_versions', 'labor_sheet_version_insert_guard')
  pgm.dropFunction('labor_sheet_version_insert_guard')
  for (const table of ['labor_sheet_items', 'labor_sheet_versions']) {
    pgm.dropTrigger(table, `${table}_no_delete`)
    pgm.dropTrigger(table, `${table}_no_update`)
  }
  pgm.dropTrigger('labor_sheets', 'labor_sheet_aggregate_guard')
  pgm.dropFunction('labor_sheet_aggregate_guard')
  pgm.dropTable('labor_sheet_items')
  pgm.dropConstraint('labor_sheets', 'labor_sheets_current_version_fk')
  pgm.dropTable('labor_sheet_versions')
  pgm.dropTable('labor_sheets')
}
