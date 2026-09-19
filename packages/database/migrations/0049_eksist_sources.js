export const shorthands = undefined
export function up(pgm) {
  pgm.sql(`
    CREATE TABLE eksist_sources (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      case_id uuid,
      request_reference text,
      input_kind text NOT NULL CHECK (input_kind IN ('text','image','pdf')),
      display_name text NOT NULL,
      mime_type text NOT NULL,
      source_bytes bytea,
      source_hash text NOT NULL,
      raw_text text NOT NULL,
      extraction_method text NOT NULL,
      extracted_fields jsonb NOT NULL,
      reviewed_fields jsonb NOT NULL DEFAULT '{}',
      created_by_user_id uuid NOT NULL REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (organization_id,case_id) REFERENCES cases(organization_id,id),
      CHECK ((case_id IS NULL) = (request_reference IS NULL))
    );
    CREATE UNIQUE INDEX eksist_request_unique ON eksist_sources(organization_id,request_reference) WHERE case_id IS NOT NULL;
    CREATE UNIQUE INDEX eksist_source_content_unique ON eksist_sources(organization_id,source_hash) WHERE case_id IS NOT NULL;
    CREATE INDEX eksist_case_sources ON eksist_sources(organization_id,case_id);
  `)
}
export function down(pgm) { pgm.dropTable('eksist_sources') }
