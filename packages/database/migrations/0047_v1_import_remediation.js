/**
 * V1 import remediation v2: path-independent identity, source-level immutable
 * revisions, alias history, legacy-row reconciliation and historical metadata.
 *
 * This migration is additive. It does not rewrite any of the 0046 rows and it
 * does not close/backfill a case by itself; the separately approved remediation
 * runner is the only writer of migration data.
 */
export const shorthands = undefined

const HASH = "~ '^[0-9a-f]{64}$'"

export function up(pgm) {
  pgm.sql(`
    CREATE TABLE v1_import_sources (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
      stable_source_identity text NOT NULL,
      identity_kind text NOT NULL,
      identity_version text NOT NULL,
      first_discovered_at timestamptz NOT NULL DEFAULT now(),
      created_by_user_id uuid,
      CONSTRAINT v1_import_sources_creator_fk
        FOREIGN KEY (organization_id,created_by_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT v1_import_sources_identity_shape CHECK (stable_source_identity ${HASH}),
      CONSTRAINT v1_import_sources_identity_kind CHECK (identity_kind='case_key_created_at'),
      CONSTRAINT v1_import_sources_identity_version CHECK (identity_version='v1-source-identity/1.0.0'),
      CONSTRAINT v1_import_sources_org_identity_unique UNIQUE (organization_id,stable_source_identity)
    );

    CREATE TABLE v1_import_source_revisions (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      stable_source_identity text NOT NULL,
      source_file_hash text NOT NULL,
      source_schema_version integer NOT NULL,
      source_write_id text,
      source_revision integer,
      mapping_version text NOT NULL,
      raw_snapshot jsonb NOT NULL,
      discovered_at timestamptz NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT now(),
      recorded_by_user_id uuid,
      CONSTRAINT v1_import_source_revisions_source_fk
        FOREIGN KEY (organization_id,stable_source_identity)
        REFERENCES v1_import_sources(organization_id,stable_source_identity) ON DELETE RESTRICT,
      CONSTRAINT v1_import_source_revisions_recorder_fk
        FOREIGN KEY (organization_id,recorded_by_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT v1_import_source_revisions_hash_shape CHECK (source_file_hash ${HASH}),
      CONSTRAINT v1_import_source_revisions_schema CHECK (source_schema_version>=1),
      CONSTRAINT v1_import_source_revisions_mapping CHECK (mapping_version ~ '^v1-remediation/[0-9]+[.][0-9]+[.][0-9]+$'),
      CONSTRAINT v1_import_source_revisions_unique
        UNIQUE (organization_id,stable_source_identity,source_file_hash,mapping_version)
    );

    CREATE TABLE v1_import_source_aliases (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      stable_source_identity text NOT NULL,
      source_relative_path text NOT NULL,
      source_file_hash text NOT NULL,
      discovered_at timestamptz NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT now(),
      recorded_by_user_id uuid,
      CONSTRAINT v1_import_source_aliases_source_fk
        FOREIGN KEY (organization_id,stable_source_identity)
        REFERENCES v1_import_sources(organization_id,stable_source_identity) ON DELETE RESTRICT,
      CONSTRAINT v1_import_source_aliases_recorder_fk
        FOREIGN KEY (organization_id,recorded_by_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT v1_import_source_aliases_hash_shape CHECK (source_file_hash ${HASH}),
      CONSTRAINT v1_import_source_aliases_path_safe CHECK (
        source_relative_path<>'' AND left(source_relative_path,1)<>'/'
        AND source_relative_path !~ '^[A-Za-z]:'
        AND source_relative_path !~ '(^|/)[.][.](/|$)'
        AND strpos(source_relative_path,chr(92))=0
        AND source_relative_path !~ '[[:cntrl:]]'
      ),
      CONSTRAINT v1_import_source_aliases_unique
        UNIQUE (organization_id,stable_source_identity,source_relative_path)
    );

    ALTER TABLE v1_import_records
      ADD CONSTRAINT v1_import_records_org_id_unique UNIQUE (organization_id,id);

    CREATE TABLE v1_import_record_reconciliations (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
      legacy_import_record_id uuid NOT NULL,
      stable_source_identity text NOT NULL,
      stable_item_identity text NOT NULL,
      evidence jsonb NOT NULL,
      mapping_version text NOT NULL,
      reconciled_at timestamptz NOT NULL DEFAULT now(),
      reconciled_by_user_id uuid NOT NULL,
      CONSTRAINT v1_import_record_reconciliations_record_fk
        FOREIGN KEY (organization_id,legacy_import_record_id)
        REFERENCES v1_import_records(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT v1_import_record_reconciliations_actor_fk
        FOREIGN KEY (organization_id,reconciled_by_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT v1_import_record_reconciliations_source_fk
        FOREIGN KEY (organization_id,stable_source_identity)
        REFERENCES v1_import_sources(organization_id,stable_source_identity) ON DELETE RESTRICT,
      CONSTRAINT v1_import_record_reconciliations_source_shape CHECK (stable_source_identity ${HASH}),
      CONSTRAINT v1_import_record_reconciliations_item_shape CHECK (stable_item_identity ${HASH}),
      CONSTRAINT v1_import_record_reconciliations_mapping CHECK (mapping_version ~ '^v1-remediation/[0-9]+[.][0-9]+[.][0-9]+$'),
      CONSTRAINT v1_import_record_reconciliations_record_unique UNIQUE (legacy_import_record_id),
      CONSTRAINT v1_import_record_reconciliations_item_unique
        UNIQUE (organization_id,stable_source_identity,stable_item_identity)
    );

    CREATE TABLE v1_import_item_metadata (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
      case_id uuid NOT NULL,
      stable_source_identity text NOT NULL,
      stable_item_identity text NOT NULL,
      item_type text NOT NULL,
      native_item_id text NOT NULL,
      target_type text NOT NULL,
      target_id uuid NOT NULL,
      source_author_name text,
      source_assignee_name text,
      source_occurred_at timestamptz,
      source_completed_at timestamptz,
      source_item_snapshot jsonb NOT NULL,
      imported_at timestamptz NOT NULL DEFAULT now(),
      imported_by_user_id uuid NOT NULL,
      CONSTRAINT v1_import_item_metadata_case_fk
        FOREIGN KEY (organization_id,case_id) REFERENCES cases(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT v1_import_item_metadata_actor_fk
        FOREIGN KEY (organization_id,imported_by_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT v1_import_item_metadata_source_fk
        FOREIGN KEY (organization_id,stable_source_identity)
        REFERENCES v1_import_sources(organization_id,stable_source_identity) ON DELETE RESTRICT,
      CONSTRAINT v1_import_item_metadata_source_shape CHECK (stable_source_identity ${HASH}),
      CONSTRAINT v1_import_item_metadata_item_shape CHECK (stable_item_identity ${HASH}),
      CONSTRAINT v1_import_item_metadata_type CHECK (item_type IN ('note','task','follow_up','closure','vehicle_profile','field')),
      CONSTRAINT v1_import_item_metadata_target CHECK (target_type IN ('case','case_note','case_task','case_follow_up_history','case_lifecycle_history','case_vehicle_profile')),
      CONSTRAINT v1_import_item_metadata_unique
        UNIQUE (organization_id,stable_source_identity,item_type,stable_item_identity),
      CONSTRAINT v1_import_item_metadata_target_unique
        UNIQUE (organization_id,target_type,target_id)
    );

    ALTER TABLE v1_import_records
      ADD COLUMN stable_source_identity text,
      ADD COLUMN stable_item_identity text,
      ADD COLUMN source_revision_id uuid REFERENCES v1_import_source_revisions(id) ON DELETE RESTRICT;
    ALTER TABLE v1_import_records ADD CONSTRAINT v1_import_records_stable_identity_shape CHECK (
      (stable_source_identity IS NULL AND stable_item_identity IS NULL AND source_revision_id IS NULL)
      OR (stable_source_identity ${HASH} AND stable_item_identity ${HASH} AND source_revision_id IS NOT NULL)
    );
    CREATE UNIQUE INDEX v1_import_records_stable_item_unique
      ON v1_import_records(organization_id,stable_source_identity,item_type,stable_item_identity)
      WHERE stable_source_identity IS NOT NULL;

    ALTER TABLE case_follow_up_history
      DROP CONSTRAINT case_follow_up_history_source_valid,
      DROP CONSTRAINT case_follow_up_history_version_unique,
      ADD COLUMN source_identity text,
      ADD COLUMN source_evidence jsonb;
    ALTER TABLE case_follow_up_history ADD CONSTRAINT case_follow_up_history_source_valid
      CHECK (source IN ('case_create','case_update','v1_historical_import'));
    ALTER TABLE case_follow_up_history ADD CONSTRAINT case_follow_up_history_source_shape CHECK (
      (source IN ('case_create','case_update') AND source_identity IS NULL)
      OR (source='v1_historical_import' AND source_identity ${HASH} AND source_evidence IS NOT NULL)
    );
    CREATE UNIQUE INDEX case_follow_up_history_runtime_version_unique
      ON case_follow_up_history(case_id,case_version)
      WHERE source IN ('case_create','case_update');
    CREATE UNIQUE INDEX case_follow_up_history_v1_source_unique
      ON case_follow_up_history(organization_id,case_id,source_identity)
      WHERE source='v1_historical_import';

    ALTER TABLE case_task_events
      ADD COLUMN event_source text NOT NULL DEFAULT 'runtime',
      ADD COLUMN source_identity text,
      ADD COLUMN source_evidence jsonb;
    ALTER TABLE case_task_events ADD CONSTRAINT case_task_events_source_shape CHECK (
      (event_source='runtime' AND source_identity IS NULL AND source_evidence IS NULL)
      OR (event_source='v1_historical_import' AND source_identity ${HASH} AND source_evidence IS NOT NULL)
    );

    ALTER TABLE case_lifecycle_history
      ALTER COLUMN lifecycle_operation_id DROP NOT NULL,
      ADD COLUMN history_source text NOT NULL DEFAULT 'runtime',
      ADD COLUMN source_identity text,
      ADD COLUMN source_evidence jsonb,
      ADD COLUMN source_occurred_at timestamptz;
    ALTER TABLE case_lifecycle_history ADD CONSTRAINT case_lifecycle_history_source_shape CHECK (
      (history_source='runtime' AND lifecycle_operation_id IS NOT NULL AND source_identity IS NULL)
      OR (
        history_source='v1_historical_import' AND lifecycle_operation_id IS NULL
        AND operation_type='historical_close' AND previous_lifecycle_status='open'
        AND lifecycle_status='closed' AND workflow_stage='closed'
        AND source_identity ${HASH} AND source_evidence IS NOT NULL
      )
    );
    CREATE UNIQUE INDEX case_lifecycle_history_v1_source_unique
      ON case_lifecycle_history(organization_id,case_id,source_identity)
      WHERE history_source='v1_historical_import';

    CREATE INDEX v1_import_source_revisions_lookup
      ON v1_import_source_revisions(organization_id,stable_source_identity,recorded_at DESC);
    CREATE INDEX v1_import_source_aliases_path
      ON v1_import_source_aliases(organization_id,source_relative_path);
    CREATE INDEX v1_import_item_metadata_case
      ON v1_import_item_metadata(organization_id,case_id,item_type);

    CREATE TRIGGER v1_import_sources_no_update BEFORE UPDATE ON v1_import_sources
      FOR EACH ROW EXECUTE FUNCTION append_only_guard();
    CREATE TRIGGER v1_import_sources_no_delete BEFORE DELETE ON v1_import_sources
      FOR EACH ROW EXECUTE FUNCTION append_only_guard();
    CREATE TRIGGER v1_import_source_revisions_no_update BEFORE UPDATE ON v1_import_source_revisions
      FOR EACH ROW EXECUTE FUNCTION append_only_guard();
    CREATE TRIGGER v1_import_source_revisions_no_delete BEFORE DELETE ON v1_import_source_revisions
      FOR EACH ROW EXECUTE FUNCTION append_only_guard();
    CREATE TRIGGER v1_import_source_aliases_no_update BEFORE UPDATE ON v1_import_source_aliases
      FOR EACH ROW EXECUTE FUNCTION append_only_guard();
    CREATE TRIGGER v1_import_source_aliases_no_delete BEFORE DELETE ON v1_import_source_aliases
      FOR EACH ROW EXECUTE FUNCTION append_only_guard();
    CREATE TRIGGER v1_import_record_reconciliations_no_update BEFORE UPDATE ON v1_import_record_reconciliations
      FOR EACH ROW EXECUTE FUNCTION append_only_guard();
    CREATE TRIGGER v1_import_record_reconciliations_no_delete BEFORE DELETE ON v1_import_record_reconciliations
      FOR EACH ROW EXECUTE FUNCTION append_only_guard();
    CREATE TRIGGER v1_import_item_metadata_no_update BEFORE UPDATE ON v1_import_item_metadata
      FOR EACH ROW EXECUTE FUNCTION append_only_guard();
    CREATE TRIGGER v1_import_item_metadata_no_delete BEFORE DELETE ON v1_import_item_metadata
      FOR EACH ROW EXECUTE FUNCTION append_only_guard();
  `)
}

export function down(pgm) {
  pgm.sql(`
    DROP INDEX case_lifecycle_history_v1_source_unique;
    ALTER TABLE case_lifecycle_history DROP CONSTRAINT case_lifecycle_history_source_shape;
    ALTER TABLE case_lifecycle_history
      DROP COLUMN source_occurred_at,
      DROP COLUMN source_evidence,
      DROP COLUMN source_identity,
      DROP COLUMN history_source,
      ALTER COLUMN lifecycle_operation_id SET NOT NULL;

    DROP INDEX case_follow_up_history_v1_source_unique;
    DROP INDEX case_follow_up_history_runtime_version_unique;
    ALTER TABLE case_follow_up_history
      DROP CONSTRAINT case_follow_up_history_source_shape,
      DROP CONSTRAINT case_follow_up_history_source_valid,
      DROP COLUMN source_evidence,
      DROP COLUMN source_identity;
    ALTER TABLE case_follow_up_history ADD CONSTRAINT case_follow_up_history_source_valid
      CHECK (source IN ('case_create','case_update'));
    ALTER TABLE case_follow_up_history ADD CONSTRAINT case_follow_up_history_version_unique
      UNIQUE (case_id,case_version);

    ALTER TABLE case_task_events
      DROP CONSTRAINT case_task_events_source_shape,
      DROP COLUMN source_evidence,
      DROP COLUMN source_identity,
      DROP COLUMN event_source;

    DROP INDEX v1_import_records_stable_item_unique;
    ALTER TABLE v1_import_records DROP CONSTRAINT v1_import_records_stable_identity_shape;
    ALTER TABLE v1_import_records
      DROP COLUMN source_revision_id,
      DROP COLUMN stable_item_identity,
      DROP COLUMN stable_source_identity;
    DROP TABLE v1_import_item_metadata;
    DROP TABLE v1_import_record_reconciliations;
    ALTER TABLE v1_import_records DROP CONSTRAINT v1_import_records_org_id_unique;
    DROP TABLE v1_import_source_aliases;
    DROP TABLE v1_import_source_revisions;
    DROP TABLE v1_import_sources;
  `)
}
