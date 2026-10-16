export const shorthands = undefined

export function up(pgm) {
  pgm.sql(`
    CREATE TABLE case_notice_sheets (
      organization_id uuid NOT NULL REFERENCES organizations(id),
      case_id uuid NOT NULL,
      overrides jsonb NOT NULL DEFAULT '{"fields":{},"documents":{}}',
      version integer NOT NULL CHECK (version >= 1),
      updated_by_user_id uuid NOT NULL REFERENCES users(id),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (organization_id, case_id),
      FOREIGN KEY (organization_id, case_id) REFERENCES cases(organization_id, id),
      CHECK (jsonb_typeof(overrides)='object' AND pg_column_size(overrides)<=40000)
    );
  `)
}

export function down(pgm) {
  pgm.dropTable('case_notice_sheets')
}
