/**
 * Paket 45 — kullanıcı kontrollü PERT / Ağır Hasar değerlendirme çekirdeği.
 *
 * Her case için tek değerlendirme aggregate'i; sürümler immutable ve
 * append-only'dir. AI önerisi, eksper kanaati ve merkez kararı ayrı alanlardır
 * (DOMAIN_RULES/PERT); bu migration AI alanı içermez, eşik veya otomatik karar
 * kodlamaz. Tutarlar bigint minor birimdedir; oran türetilmiş bilgidir ve
 * saklanmaz.
 */
export const shorthands = undefined

const MAX_AMOUNT_MINOR = 100_000_000_00

export function up(pgm) {
  pgm.createTable('pert_assessments', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    case_id: { type: 'uuid', notNull: true },
    current_version_id: { type: 'uuid' },
    version: { type: 'integer', notNull: true, default: 1 },
    created_by_user_id: { type: 'uuid', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('pert_assessments', 'pert_assessments_case_fk', {
    foreignKeys: {
      columns: ['organization_id', 'case_id'],
      references: 'cases (organization_id, id)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('pert_assessments', 'pert_assessments_creator_fk', {
    foreignKeys: {
      columns: ['organization_id', 'created_by_user_id'],
      references: 'users (organization_id, id)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('pert_assessments', 'pert_assessments_case_unique', {
    unique: ['organization_id', 'case_id'],
  })
  pgm.addConstraint('pert_assessments', 'pert_assessments_org_case_id_unique', {
    unique: ['organization_id', 'case_id', 'id'],
  })
  pgm.addConstraint('pert_assessments', 'pert_assessments_version_positive', {
    check: 'version >= 1',
  })
  pgm.createIndex('pert_assessments', ['organization_id', 'case_id', 'updated_at'])

  pgm.createTable('pert_assessment_versions', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    case_id: { type: 'uuid', notNull: true },
    assessment_id: { type: 'uuid', notNull: true },
    assessment_version: { type: 'integer', notNull: true },
    previous_version_id: { type: 'uuid' },
    workflow_status: { type: 'text', notNull: true },
    estimated_damage_minor: { type: 'bigint' },
    market_value_minor: { type: 'bigint' },
    structural_note: { type: 'text' },
    expert_opinion: { type: 'text' },
    expert_rationale: { type: 'text' },
    center_decision: { type: 'text' },
    center_note: { type: 'text' },
    source_type: { type: 'text', notNull: true },
    currency: { type: 'text', notNull: true },
    revision_reason: { type: 'text' },
    created_by_user_id: { type: 'uuid', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('pert_assessment_versions', 'pert_assessment_versions_assessment_fk', {
    foreignKeys: {
      columns: ['organization_id', 'case_id', 'assessment_id'],
      references: 'pert_assessments (organization_id, case_id, id)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('pert_assessment_versions', 'pert_assessment_versions_creator_fk', {
    foreignKeys: {
      columns: ['organization_id', 'created_by_user_id'],
      references: 'users (organization_id, id)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('pert_assessment_versions', 'pert_assessment_versions_org_case_id_unique', {
    unique: ['organization_id', 'case_id', 'id'],
  })
  pgm.addConstraint('pert_assessment_versions', 'pert_assessment_versions_org_case_assessment_id_unique', {
    unique: ['organization_id', 'case_id', 'assessment_id', 'id'],
  })
  pgm.addConstraint('pert_assessment_versions', 'pert_assessment_versions_number_unique', {
    unique: ['assessment_id', 'assessment_version'],
  })
  pgm.addConstraint('pert_assessment_versions', 'pert_assessment_versions_previous_fk', {
    foreignKeys: {
      columns: ['organization_id', 'case_id', 'assessment_id', 'previous_version_id'],
      references: 'pert_assessment_versions (organization_id, case_id, assessment_id, id)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('pert_assessment_versions', 'pert_assessment_versions_static_valid', {
    check: `currency='TRY'
      AND source_type IN ('user_entered','manual_revision')
      AND assessment_version >= 1
      AND workflow_status IN (
        'review_not_started','data_missing','under_review','repair_indicated','pert_candidate',
        'expert_opinion_issued','center_decision_pending','repair_decided','pert_decided'
      )
      AND (estimated_damage_minor IS NULL OR estimated_damage_minor BETWEEN 0 AND ${MAX_AMOUNT_MINOR})
      AND (market_value_minor IS NULL OR market_value_minor BETWEEN 0 AND ${MAX_AMOUNT_MINOR})
      AND (structural_note IS NULL OR (length(structural_note) BETWEEN 1 AND 500
        AND structural_note ~ '[^[:space:]]' AND structural_note !~ '[[:cntrl:]]'))
      AND (expert_rationale IS NULL OR (length(expert_rationale) BETWEEN 1 AND 500
        AND expert_rationale ~ '[^[:space:]]' AND expert_rationale !~ '[[:cntrl:]]'))
      AND (center_note IS NULL OR (length(center_note) BETWEEN 1 AND 500
        AND center_note ~ '[^[:space:]]' AND center_note !~ '[[:cntrl:]]'))`,
  })
  pgm.addConstraint('pert_assessment_versions', 'pert_assessment_versions_decision_valid', {
    check: `(expert_opinion IS NULL OR expert_opinion IN ('repair','pert'))
      AND (center_decision IS NULL OR center_decision IN ('repair','pert'))
      AND ((expert_opinion IS NULL) = (expert_rationale IS NULL))
      AND (
        (expert_opinion IS NULL AND workflow_status IN (
          'review_not_started','data_missing','under_review','repair_indicated','pert_candidate'))
        OR
        (expert_opinion IS NOT NULL AND workflow_status IN (
          'expert_opinion_issued','center_decision_pending','repair_decided','pert_decided'))
      )
      AND (
        (center_decision IS NULL AND workflow_status NOT IN ('repair_decided','pert_decided'))
        OR (center_decision='repair' AND workflow_status='repair_decided')
        OR (center_decision='pert' AND workflow_status='pert_decided')
      )`,
  })
  pgm.addConstraint('pert_assessment_versions', 'pert_assessment_versions_shape_valid', {
    check: `(assessment_version=1 AND previous_version_id IS NULL
        AND source_type='user_entered' AND revision_reason IS NULL)
      OR (assessment_version>1 AND previous_version_id IS NOT NULL
        AND source_type='manual_revision'
        AND length(revision_reason) BETWEEN 1 AND 500
        AND revision_reason ~ '[^[:space:]]'
        AND revision_reason !~ '[[:cntrl:]]')`,
  })
  pgm.createIndex('pert_assessment_versions', ['organization_id', 'case_id', 'created_at'])

  pgm.addConstraint('pert_assessments', 'pert_assessments_current_version_fk', {
    foreignKeys: {
      columns: ['organization_id', 'case_id', 'id', 'current_version_id'],
      references: 'pert_assessment_versions (organization_id, case_id, assessment_id, id)',
      onDelete: 'RESTRICT',
    },
  })

  pgm.sql(`
    CREATE FUNCTION pert_assessment_version_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
      aggregate_version integer;
      aggregate_current_version_id uuid;
    BEGIN
      SELECT version,current_version_id
        INTO aggregate_version,aggregate_current_version_id
        FROM pert_assessments
       WHERE organization_id=NEW.organization_id
         AND case_id=NEW.case_id
         AND id=NEW.assessment_id
       FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'pert assessment aggregate missing' USING ERRCODE='foreign_key_violation';
      END IF;
      IF NEW.assessment_version=1 THEN
        IF aggregate_version<>1 OR aggregate_current_version_id IS NOT NULL
          OR NEW.previous_version_id IS NOT NULL THEN
          RAISE EXCEPTION 'pert assessment first version is invalid' USING ERRCODE='check_violation';
        END IF;
      ELSIF NEW.assessment_version<>aggregate_version+1
        OR NEW.previous_version_id IS DISTINCT FROM aggregate_current_version_id THEN
        RAISE EXCEPTION 'pert assessment version chain is invalid' USING ERRCODE='check_violation';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER pert_assessment_version_insert_guard
      BEFORE INSERT ON pert_assessment_versions
      FOR EACH ROW EXECUTE FUNCTION pert_assessment_version_insert_guard();

    CREATE FUNCTION pert_assessment_aggregate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP='DELETE' THEN
        RAISE EXCEPTION 'pert assessment cannot be deleted' USING ERRCODE='restrict_violation';
      END IF;
      IF OLD.organization_id<>NEW.organization_id OR OLD.case_id<>NEW.case_id
        OR OLD.created_by_user_id<>NEW.created_by_user_id
        OR OLD.created_at<>NEW.created_at THEN
        RAISE EXCEPTION 'pert assessment identity is immutable' USING ERRCODE='restrict_violation';
      END IF;
      IF OLD.current_version_id IS NULL AND NEW.current_version_id IS NOT NULL
        AND OLD.version=1 AND NEW.version=1 THEN
        RETURN NEW;
      END IF;
      IF NEW.version<>OLD.version+1 OR NEW.current_version_id IS NOT DISTINCT FROM OLD.current_version_id THEN
        RAISE EXCEPTION 'pert assessment version must increment once' USING ERRCODE='check_violation';
      END IF;
      PERFORM 1
        FROM pert_assessment_versions
       WHERE organization_id=NEW.organization_id
         AND case_id=NEW.case_id
         AND assessment_id=NEW.id
         AND id=NEW.current_version_id
         AND assessment_version=NEW.version;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'pert assessment current version is invalid' USING ERRCODE='check_violation';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER pert_assessment_aggregate_guard
      BEFORE UPDATE OR DELETE ON pert_assessments
      FOR EACH ROW EXECUTE FUNCTION pert_assessment_aggregate_guard();
  `)

  pgm.createTrigger('pert_assessment_versions', 'pert_assessment_versions_no_update', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'append_only_guard',
  })
  pgm.createTrigger('pert_assessment_versions', 'pert_assessment_versions_no_delete', {
    when: 'BEFORE',
    operation: 'DELETE',
    level: 'ROW',
    function: 'append_only_guard',
  })
}

export function down(pgm) {
  pgm.dropTrigger('pert_assessment_versions', 'pert_assessment_version_insert_guard')
  pgm.dropFunction('pert_assessment_version_insert_guard')
  pgm.dropTrigger('pert_assessment_versions', 'pert_assessment_versions_no_delete')
  pgm.dropTrigger('pert_assessment_versions', 'pert_assessment_versions_no_update')
  pgm.dropTrigger('pert_assessments', 'pert_assessment_aggregate_guard')
  pgm.dropFunction('pert_assessment_aggregate_guard')
  pgm.dropConstraint('pert_assessments', 'pert_assessments_current_version_fk')
  pgm.dropTable('pert_assessment_versions')
  pgm.dropTable('pert_assessments')
}
