/**
 * Paket 41 — kullanıcı kontrollü e-posta taslakları ve Gmail web handoff geçmişi.
 *
 * E-posta gövdesi yalnız vaka-kapsamlı sürüm tablosunda tutulur; audit'e
 * kopyalanmaz. Handoff, gönderim kanıtı değildir ve yalnız `not_sent`
 * semantiğinin append-only operasyon kaydıdır. OAuth tokenı, provider secret,
 * mutlak yol veya dosya içeriği saklanmaz.
 */
export const shorthands = undefined

const DRAFT_TYPES = [
  'repair_approval_request',
  'missing_document_request',
  'preliminary_report_notice',
  'service_change_notice',
  'deductible_service_part_notice',
  'portal_deductible_note',
  'closure_documents_request',
  'case_status_update',
  'recourse_documents_request',
  'pert_evaluation_notice',
  'custom_instruction',
].map((value) => `'${value}'`).join(',')

export function up(pgm) {
  pgm.addConstraint('photos', 'photos_org_case_id_unique', {
    unique: ['organization_id', 'case_id', 'id'],
  })

  pgm.createTable('email_drafts', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    case_id: { type: 'uuid', notNull: true },
    draft_type: { type: 'text', notNull: true },
    current_version_id: { type: 'uuid' },
    version: { type: 'integer', notNull: true, default: 1 },
    created_by_user_id: { type: 'uuid', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('email_drafts', 'email_drafts_case_fk', {
    foreignKeys: {
      columns: ['organization_id', 'case_id'],
      references: 'cases (organization_id, id)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('email_drafts', 'email_drafts_creator_fk', {
    foreignKeys: {
      columns: ['organization_id', 'created_by_user_id'],
      references: 'users (organization_id, id)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('email_drafts', 'email_drafts_org_case_id_unique', {
    unique: ['organization_id', 'case_id', 'id'],
  })
  pgm.addConstraint('email_drafts', 'email_drafts_type_valid', {
    check: `draft_type IN (${DRAFT_TYPES})`,
  })
  pgm.addConstraint('email_drafts', 'email_drafts_version_positive', {
    check: 'version >= 1',
  })
  pgm.createIndex('email_drafts', ['organization_id', 'case_id', 'updated_at'])

  pgm.createTable('email_draft_versions', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    case_id: { type: 'uuid', notNull: true },
    draft_id: { type: 'uuid', notNull: true },
    draft_version: { type: 'integer', notNull: true },
    previous_version_id: { type: 'uuid' },
    subject: { type: 'text', notNull: true },
    body: { type: 'text', notNull: true },
    template_version: { type: 'text', notNull: true },
    source_type: { type: 'text', notNull: true },
    preview_hash: { type: 'text', notNull: true },
    revision_reason: { type: 'text' },
    created_by_user_id: { type: 'uuid', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('email_draft_versions', 'email_draft_versions_draft_fk', {
    foreignKeys: {
      columns: ['organization_id', 'case_id', 'draft_id'],
      references: 'email_drafts (organization_id, case_id, id)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('email_draft_versions', 'email_draft_versions_creator_fk', {
    foreignKeys: {
      columns: ['organization_id', 'created_by_user_id'],
      references: 'users (organization_id, id)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('email_draft_versions', 'email_draft_versions_org_case_id_unique', {
    unique: ['organization_id', 'case_id', 'id'],
  })
  pgm.addConstraint('email_draft_versions', 'email_draft_versions_org_case_draft_id_unique', {
    unique: ['organization_id', 'case_id', 'draft_id', 'id'],
  })
  pgm.addConstraint('email_draft_versions', 'email_draft_versions_number_unique', {
    unique: ['draft_id', 'draft_version'],
  })
  pgm.addConstraint('email_draft_versions', 'email_draft_versions_previous_fk', {
    foreignKeys: {
      columns: ['organization_id', 'case_id', 'draft_id', 'previous_version_id'],
      references: 'email_draft_versions (organization_id, case_id, draft_id, id)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('email_draft_versions', 'email_draft_versions_text_valid', {
    check: `length(subject) BETWEEN 1 AND 240
      AND subject ~ '[^[:space:]]'
      AND subject !~ '[[:cntrl:]]'
      AND length(body) BETWEEN 1 AND 20000
      AND body ~ '[^[:space:]]'`,
  })
  pgm.addConstraint('email_draft_versions', 'email_draft_versions_static_valid', {
    check: `template_version='email-draft-template/1.0.0'
      AND source_type IN ('deterministic_template','manual_revision')
      AND preview_hash ~ '^[a-f0-9]{64}$'
      AND draft_version >= 1`,
  })
  pgm.addConstraint('email_draft_versions', 'email_draft_versions_shape_valid', {
    check: `(draft_version=1 AND previous_version_id IS NULL
        AND source_type='deterministic_template' AND revision_reason IS NULL)
      OR (draft_version>1 AND previous_version_id IS NOT NULL
        AND source_type='manual_revision'
        AND length(revision_reason) BETWEEN 1 AND 500
        AND revision_reason ~ '[^[:space:]]'
        AND revision_reason !~ '[[:cntrl:]]')`,
  })
  pgm.createIndex('email_draft_versions', ['organization_id', 'case_id', 'created_at'])

  pgm.addConstraint('email_drafts', 'email_drafts_current_version_fk', {
    foreignKeys: {
      columns: ['organization_id', 'case_id', 'id', 'current_version_id'],
      references: 'email_draft_versions (organization_id, case_id, draft_id, id)',
      onDelete: 'RESTRICT',
    },
  })

  pgm.createTable('email_draft_recipients', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    case_id: { type: 'uuid', notNull: true },
    draft_id: { type: 'uuid', notNull: true },
    draft_version_id: { type: 'uuid', notNull: true },
    recipient_kind: { type: 'text', notNull: true },
    address: { type: 'text', notNull: true },
    ordinal: { type: 'integer', notNull: true },
  })
  pgm.addConstraint('email_draft_recipients', 'email_draft_recipients_version_fk', {
    foreignKeys: {
      columns: ['organization_id', 'case_id', 'draft_id', 'draft_version_id'],
      references: 'email_draft_versions (organization_id, case_id, draft_id, id)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('email_draft_recipients', 'email_draft_recipients_draft_fk', {
    foreignKeys: {
      columns: ['organization_id', 'case_id', 'draft_id'],
      references: 'email_drafts (organization_id, case_id, id)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('email_draft_recipients', 'email_draft_recipients_kind_ordinal_unique', {
    unique: ['draft_version_id', 'recipient_kind', 'ordinal'],
  })
  pgm.addConstraint('email_draft_recipients', 'email_draft_recipients_address_unique', {
    unique: ['draft_version_id', 'address'],
  })
  pgm.addConstraint('email_draft_recipients', 'email_draft_recipients_valid', {
    check: `recipient_kind IN ('to','cc')
      AND ordinal BETWEEN 1 AND 10
      AND length(address) BETWEEN 3 AND 254
      AND address=lower(address)
      AND address ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'`,
  })

  pgm.createTable('email_draft_attachments', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    case_id: { type: 'uuid', notNull: true },
    draft_id: { type: 'uuid', notNull: true },
    draft_version_id: { type: 'uuid', notNull: true },
    resource_type: { type: 'text', notNull: true },
    document_version_id: { type: 'uuid' },
    photo_id: { type: 'uuid' },
    ordinal: { type: 'integer', notNull: true },
  })
  pgm.addConstraint('email_draft_attachments', 'email_draft_attachments_version_fk', {
    foreignKeys: {
      columns: ['organization_id', 'case_id', 'draft_id', 'draft_version_id'],
      references: 'email_draft_versions (organization_id, case_id, draft_id, id)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('email_draft_attachments', 'email_draft_attachments_draft_fk', {
    foreignKeys: {
      columns: ['organization_id', 'case_id', 'draft_id'],
      references: 'email_drafts (organization_id, case_id, id)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('email_draft_attachments', 'email_draft_attachments_document_fk', {
    foreignKeys: {
      columns: ['organization_id', 'case_id', 'document_version_id'],
      references: 'document_versions (organization_id, case_id, id)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('email_draft_attachments', 'email_draft_attachments_photo_fk', {
    foreignKeys: {
      columns: ['organization_id', 'case_id', 'photo_id'],
      references: 'photos (organization_id, case_id, id)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('email_draft_attachments', 'email_draft_attachments_ordinal_unique', {
    unique: ['draft_version_id', 'ordinal'],
  })
  pgm.addConstraint('email_draft_attachments', 'email_draft_attachments_shape_valid', {
    check: `ordinal BETWEEN 1 AND 20
      AND ((resource_type='document_version' AND document_version_id IS NOT NULL AND photo_id IS NULL)
        OR (resource_type='photo' AND document_version_id IS NULL AND photo_id IS NOT NULL))`,
  })
  pgm.createIndex('email_draft_attachments', ['draft_version_id', 'document_version_id'], {
    name: 'email_draft_attachments_document_unique',
    unique: true,
    where: 'document_version_id IS NOT NULL',
  })
  pgm.createIndex('email_draft_attachments', ['draft_version_id', 'photo_id'], {
    name: 'email_draft_attachments_photo_unique',
    unique: true,
    where: 'photo_id IS NOT NULL',
  })

  pgm.createTable('email_handoffs', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    case_id: { type: 'uuid', notNull: true },
    draft_id: { type: 'uuid', notNull: true },
    draft_version_id: { type: 'uuid', notNull: true },
    handoff_sequence: { type: 'integer', notNull: true },
    provider: { type: 'text', notNull: true },
    prepared_by_user_id: { type: 'uuid', notNull: true },
    request_id: { type: 'text' },
    prepared_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('email_handoffs', 'email_handoffs_version_fk', {
    foreignKeys: {
      columns: ['organization_id', 'case_id', 'draft_id', 'draft_version_id'],
      references: 'email_draft_versions (organization_id, case_id, draft_id, id)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('email_handoffs', 'email_handoffs_draft_fk', {
    foreignKeys: {
      columns: ['organization_id', 'case_id', 'draft_id'],
      references: 'email_drafts (organization_id, case_id, id)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('email_handoffs', 'email_handoffs_actor_fk', {
    foreignKeys: {
      columns: ['organization_id', 'prepared_by_user_id'],
      references: 'users (organization_id, id)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('email_handoffs', 'email_handoffs_sequence_unique', {
    unique: ['draft_id', 'handoff_sequence'],
  })
  pgm.addConstraint('email_handoffs', 'email_handoffs_shape_valid', {
    check: "handoff_sequence >= 1 AND provider='gmail_web'",
  })
  pgm.createIndex('email_handoffs', ['organization_id', 'case_id', 'prepared_at'])

  pgm.sql(`
    CREATE FUNCTION email_draft_version_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
      aggregate_version integer;
      aggregate_current_version_id uuid;
    BEGIN
      SELECT version,current_version_id
        INTO aggregate_version,aggregate_current_version_id
        FROM email_drafts
       WHERE organization_id=NEW.organization_id
         AND case_id=NEW.case_id
         AND id=NEW.draft_id
       FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'email draft aggregate missing' USING ERRCODE='foreign_key_violation';
      END IF;
      IF NEW.draft_version=1 THEN
        IF aggregate_version<>1 OR aggregate_current_version_id IS NOT NULL
          OR NEW.previous_version_id IS NOT NULL THEN
          RAISE EXCEPTION 'email draft first version is invalid' USING ERRCODE='check_violation';
        END IF;
      ELSIF NEW.draft_version<>aggregate_version+1
        OR NEW.previous_version_id IS DISTINCT FROM aggregate_current_version_id THEN
        RAISE EXCEPTION 'email draft version chain is invalid' USING ERRCODE='check_violation';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER email_draft_version_insert_guard
      BEFORE INSERT ON email_draft_versions
      FOR EACH ROW EXECUTE FUNCTION email_draft_version_insert_guard();

    CREATE FUNCTION email_draft_aggregate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP='DELETE' THEN
        RAISE EXCEPTION 'email draft cannot be deleted' USING ERRCODE='restrict_violation';
      END IF;
      IF OLD.organization_id<>NEW.organization_id OR OLD.case_id<>NEW.case_id
        OR OLD.draft_type<>NEW.draft_type OR OLD.created_by_user_id<>NEW.created_by_user_id
        OR OLD.created_at<>NEW.created_at THEN
        RAISE EXCEPTION 'email draft identity is immutable' USING ERRCODE='restrict_violation';
      END IF;
      IF OLD.current_version_id IS NULL AND NEW.current_version_id IS NOT NULL
        AND OLD.version=1 AND NEW.version=1 THEN
        RETURN NEW;
      END IF;
      IF NEW.version<>OLD.version+1 OR NEW.current_version_id IS NOT DISTINCT FROM OLD.current_version_id THEN
        RAISE EXCEPTION 'email draft version must increment once' USING ERRCODE='check_violation';
      END IF;
      PERFORM 1
        FROM email_draft_versions
       WHERE organization_id=NEW.organization_id
         AND case_id=NEW.case_id
         AND draft_id=NEW.id
         AND id=NEW.current_version_id
         AND draft_version=NEW.version;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'email draft current version is invalid' USING ERRCODE='check_violation';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER email_draft_aggregate_guard
      BEFORE UPDATE OR DELETE ON email_drafts
      FOR EACH ROW EXECUTE FUNCTION email_draft_aggregate_guard();
  `)

  for (const table of [
    'email_draft_versions',
    'email_draft_recipients',
    'email_draft_attachments',
    'email_handoffs',
  ]) {
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
  pgm.dropTrigger('email_draft_versions', 'email_draft_version_insert_guard')
  pgm.dropFunction('email_draft_version_insert_guard')
  for (const table of [
    'email_handoffs',
    'email_draft_attachments',
    'email_draft_recipients',
    'email_draft_versions',
  ]) {
    pgm.dropTrigger(table, `${table}_no_delete`)
    pgm.dropTrigger(table, `${table}_no_update`)
  }
  pgm.dropTrigger('email_drafts', 'email_draft_aggregate_guard')
  pgm.dropFunction('email_draft_aggregate_guard')
  pgm.dropTable('email_handoffs')
  pgm.dropTable('email_draft_attachments')
  pgm.dropTable('email_draft_recipients')
  pgm.dropConstraint('email_drafts', 'email_drafts_current_version_fk')
  pgm.dropTable('email_draft_versions')
  pgm.dropTable('email_drafts')
  pgm.dropConstraint('photos', 'photos_org_case_id_unique')
}
