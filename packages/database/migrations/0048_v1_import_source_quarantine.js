/**
 * V1 remediation source quarantine: deterministic olmayan tek bir source'un
 * guvenli source'lari global olarak bloke etmesini onler. Kayitlar append-only;
 * daha sonra bulunan kanit ayri resolution satiridir.
 */
export const shorthands = undefined

const HASH = "~ '^[0-9a-f]{64}$'"

export function up(pgm) {
  pgm.sql(`
    ALTER TABLE v1_import_source_revisions
      ADD CONSTRAINT v1_import_source_revisions_org_id_unique UNIQUE (organization_id,id);

    CREATE TABLE v1_import_source_quarantines (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
      quarantine_identity text NOT NULL,
      stable_source_identity text,
      source_revision_id uuid,
      source_path_token text NOT NULL,
      source_relative_path text NOT NULL,
      source_file_hash text NOT NULL,
      mapping_version text NOT NULL,
      reason text NOT NULL,
      reason_code text NOT NULL,
      evidence jsonb NOT NULL,
      raw_source_text text,
      quarantined_at timestamptz NOT NULL DEFAULT now(),
      quarantined_by_user_id uuid NOT NULL,
      CONSTRAINT v1_import_source_quarantines_actor_fk
        FOREIGN KEY (organization_id,quarantined_by_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT v1_import_source_quarantines_source_fk
        FOREIGN KEY (organization_id,stable_source_identity)
        REFERENCES v1_import_sources(organization_id,stable_source_identity) ON DELETE RESTRICT,
      CONSTRAINT v1_import_source_quarantines_revision_fk
        FOREIGN KEY (organization_id,source_revision_id)
        REFERENCES v1_import_source_revisions(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT v1_import_source_quarantines_identity_shape CHECK (quarantine_identity ${HASH}),
      CONSTRAINT v1_import_source_quarantines_path_token_shape CHECK (source_path_token ~ '^[0-9a-f]{16}$'),
      CONSTRAINT v1_import_source_quarantines_hash_shape CHECK (source_file_hash ${HASH}),
      CONSTRAINT v1_import_source_quarantines_mapping CHECK (mapping_version ~ '^v1-remediation/[0-9]+[.][0-9]+[.][0-9]+$'),
      CONSTRAINT v1_import_source_quarantines_reason CHECK (
        reason IN ('claim_type_unresolved','ambiguous_target','genuine_evidence_conflict','malformed_source')
      ),
      CONSTRAINT v1_import_source_quarantines_reason_code CHECK (reason_code ~ '^[a-z0-9_]{1,96}$'),
      CONSTRAINT v1_import_source_quarantines_path_safe CHECK (
        source_relative_path<>'' AND left(source_relative_path,1)<>'/'
        AND source_relative_path !~ '^[A-Za-z]:'
        AND source_relative_path !~ '(^|/)[.][.](/|$)'
        AND strpos(source_relative_path,chr(92))=0
        AND source_relative_path !~ '[[:cntrl:]]'
      ),
      CONSTRAINT v1_import_source_quarantines_payload_shape CHECK (
        (
          stable_source_identity ${HASH} AND source_revision_id IS NOT NULL
          AND raw_source_text IS NULL
        ) OR (
          stable_source_identity IS NULL AND source_revision_id IS NULL
          AND raw_source_text IS NOT NULL
        )
      ),
      CONSTRAINT v1_import_source_quarantines_org_id_unique UNIQUE (organization_id,id),
      CONSTRAINT v1_import_source_quarantines_unique
        UNIQUE (organization_id,quarantine_identity,source_file_hash,mapping_version,reason)
    );

    CREATE TABLE v1_import_quarantine_resolutions (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
      quarantine_id uuid NOT NULL,
      target_case_id uuid NOT NULL,
      resolved_case_type text NOT NULL,
      resolution_kind text NOT NULL,
      resolution_evidence jsonb NOT NULL,
      mapping_version text NOT NULL,
      resolved_at timestamptz NOT NULL DEFAULT now(),
      resolved_by_user_id uuid NOT NULL,
      CONSTRAINT v1_import_quarantine_resolutions_quarantine_fk
        FOREIGN KEY (organization_id,quarantine_id)
        REFERENCES v1_import_source_quarantines(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT v1_import_quarantine_resolutions_case_fk
        FOREIGN KEY (organization_id,target_case_id) REFERENCES cases(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT v1_import_quarantine_resolutions_actor_fk
        FOREIGN KEY (organization_id,resolved_by_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT v1_import_quarantine_resolutions_case_type CHECK (resolved_case_type IN ('traffic','casco')),
      CONSTRAINT v1_import_quarantine_resolutions_kind CHECK (
        resolution_kind IN ('deterministic_replan','explicit_reconciliation')
      ),
      CONSTRAINT v1_import_quarantine_resolutions_mapping CHECK (mapping_version ~ '^v1-remediation/[0-9]+[.][0-9]+[.][0-9]+$'),
      CONSTRAINT v1_import_quarantine_resolutions_quarantine_unique UNIQUE (quarantine_id)
    );

    CREATE INDEX v1_import_source_quarantines_status
      ON v1_import_source_quarantines(organization_id,reason,quarantined_at DESC);
    CREATE INDEX v1_import_source_quarantines_source
      ON v1_import_source_quarantines(organization_id,stable_source_identity);

    CREATE VIEW v1_import_quarantine_status AS
      SELECT q.organization_id,q.quarantine_identity,q.source_path_token,q.reason,q.reason_code,
             q.evidence,q.mapping_version,q.quarantined_at,
             (r.id IS NOT NULL) AS resolved,r.target_case_id,r.resolved_case_type,r.resolution_kind,r.resolved_at
        FROM v1_import_source_quarantines q
        LEFT JOIN v1_import_quarantine_resolutions r
          ON r.organization_id=q.organization_id AND r.quarantine_id=q.id;

    CREATE TRIGGER v1_import_source_quarantines_no_update BEFORE UPDATE ON v1_import_source_quarantines
      FOR EACH ROW EXECUTE FUNCTION append_only_guard();
    CREATE TRIGGER v1_import_source_quarantines_no_delete BEFORE DELETE ON v1_import_source_quarantines
      FOR EACH ROW EXECUTE FUNCTION append_only_guard();
    CREATE TRIGGER v1_import_quarantine_resolutions_no_update BEFORE UPDATE ON v1_import_quarantine_resolutions
      FOR EACH ROW EXECUTE FUNCTION append_only_guard();
    CREATE TRIGGER v1_import_quarantine_resolutions_no_delete BEFORE DELETE ON v1_import_quarantine_resolutions
      FOR EACH ROW EXECUTE FUNCTION append_only_guard();
  `)
}

export function down(pgm) {
  pgm.sql(`
    DROP VIEW v1_import_quarantine_status;
    DROP TABLE v1_import_quarantine_resolutions;
    DROP TABLE v1_import_source_quarantines;
    ALTER TABLE v1_import_source_revisions DROP CONSTRAINT v1_import_source_revisions_org_id_unique;
  `)
}
