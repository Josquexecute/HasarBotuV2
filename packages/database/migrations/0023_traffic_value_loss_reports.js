/**
 * Paket 34 - Onaylı Trafik değer kaybı sürümünden kullanıcı kontrollü,
 * immutable nihai rapor snapshot'ı ve doğrulanmış PDF çıktı özeti.
 */
export const shorthands = undefined

export function up(pgm) {
  pgm.sql(`
    CREATE TABLE traffic_value_loss_reports (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      case_id uuid NOT NULL,
      assessment_id uuid NOT NULL,
      assessment_version_id uuid NOT NULL,
      assessment_version integer NOT NULL,
      status text NOT NULL DEFAULT 'ready',
      format text NOT NULL DEFAULT 'pdf',
      schema_version text NOT NULL,
      template_version text NOT NULL,
      rule_version text NOT NULL,
      content_snapshot jsonb NOT NULL,
      content_hash text NOT NULL,
      pdf_hash text NOT NULL,
      pdf_byte_size integer NOT NULL,
      generated_by_user_id uuid NOT NULL,
      generated_at timestamptz NOT NULL DEFAULT now(),
      version integer NOT NULL DEFAULT 1,
      CONSTRAINT traffic_value_loss_reports_assessment_fk
        FOREIGN KEY (organization_id,case_id,assessment_id)
        REFERENCES traffic_value_loss_assessments(organization_id,case_id,id) ON DELETE RESTRICT,
      CONSTRAINT traffic_value_loss_reports_assessment_version_fk
        FOREIGN KEY (organization_id,case_id,assessment_version_id)
        REFERENCES traffic_value_loss_versions(organization_id,case_id,id) ON DELETE RESTRICT,
      CONSTRAINT traffic_value_loss_reports_generator_fk
        FOREIGN KEY (organization_id,generated_by_user_id)
        REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT traffic_value_loss_reports_version_unique UNIQUE (assessment_version_id),
      CONSTRAINT traffic_value_loss_reports_tenant_id_unique UNIQUE (organization_id,case_id,id),
      CONSTRAINT traffic_value_loss_reports_status_valid CHECK (status='ready'),
      CONSTRAINT traffic_value_loss_reports_format_valid CHECK (format='pdf'),
      CONSTRAINT traffic_value_loss_reports_versions_valid CHECK (
        schema_version='traffic-value-loss-final-report/1.0.0'
        AND template_version='traffic-value-loss-final-report-tr/1.0.0'
        AND rule_version='2026.07.01.1'
      ),
      CONSTRAINT traffic_value_loss_reports_hashes_valid CHECK (
        content_hash ~ '^[a-f0-9]{64}$' AND pdf_hash ~ '^[a-f0-9]{64}$'
      ),
      CONSTRAINT traffic_value_loss_reports_size_valid CHECK (
        pdf_byte_size BETWEEN 1 AND 10000000 AND version>=1 AND assessment_version>=1
      ),
      CONSTRAINT traffic_value_loss_reports_snapshot_valid CHECK (
        jsonb_typeof(content_snapshot)='object'
        AND pg_column_size(content_snapshot)<=1000000
        AND content_snapshot->>'schemaVersion'=schema_version
        AND content_snapshot->>'templateVersion'=template_version
        AND content_snapshot#>>'{assessment,assessmentId}'=assessment_id::text
        AND content_snapshot#>>'{assessment,versionId}'=assessment_version_id::text
        AND (content_snapshot#>>'{assessment,assessmentVersion}')::integer=assessment_version
        AND content_snapshot#>>'{rule,ruleVersion}'=rule_version
        AND content_snapshot#>>'{caseReference,caseId}'=case_id::text
        AND content_snapshot#>>'{caseReference,caseType}'='traffic'
      ),
      CONSTRAINT traffic_value_loss_reports_no_absolute_path CHECK (
        content_snapshot::text !~ '(^|["[:space:]])[A-Za-z]:[\\\\/]'
        AND position(chr(92) || chr(92) in content_snapshot::text)=0
      )
    );
    CREATE INDEX traffic_value_loss_reports_case_idx
      ON traffic_value_loss_reports(organization_id,case_id,generated_at DESC);

    CREATE FUNCTION traffic_value_loss_report_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE source_status text; approval_status text; source_assessment uuid; source_number integer;
    BEGIN
      SELECT status,human_approval_status,assessment_id,assessment_version
        INTO source_status,approval_status,source_assessment,source_number
        FROM traffic_value_loss_versions
        WHERE organization_id=NEW.organization_id AND case_id=NEW.case_id AND id=NEW.assessment_version_id;
      IF source_status NOT IN ('approved','superseded') OR approval_status<>'approved'
        OR source_assessment<>NEW.assessment_id OR source_number<>NEW.assessment_version THEN
        RAISE EXCEPTION 'traffic value loss report requires approved immutable source'
          USING ERRCODE='check_violation';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER traffic_value_loss_report_insert_guard
      BEFORE INSERT ON traffic_value_loss_reports
      FOR EACH ROW EXECUTE FUNCTION traffic_value_loss_report_insert_guard();

    CREATE FUNCTION traffic_value_loss_report_append_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'traffic value loss final report is append-only'
        USING ERRCODE='restrict_violation';
    END $$;
    CREATE TRIGGER traffic_value_loss_report_append_guard
      BEFORE UPDATE OR DELETE ON traffic_value_loss_reports
      FOR EACH ROW EXECUTE FUNCTION traffic_value_loss_report_append_guard();
  `)
}

export function down(pgm) {
  pgm.sql(`
    DROP TRIGGER traffic_value_loss_report_append_guard ON traffic_value_loss_reports;
    DROP FUNCTION traffic_value_loss_report_append_guard();
    DROP TRIGGER traffic_value_loss_report_insert_guard ON traffic_value_loss_reports;
    DROP FUNCTION traffic_value_loss_report_insert_guard();
    DROP TABLE traffic_value_loss_reports;
  `)
}
