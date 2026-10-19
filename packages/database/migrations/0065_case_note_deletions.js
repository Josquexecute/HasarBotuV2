export const shorthands = undefined

export function up(pgm) {
  pgm.sql(`
    ALTER TABLE case_notes ADD CONSTRAINT case_notes_owner_unique
      UNIQUE (organization_id,case_id,id,created_by_user_id);
    CREATE TABLE case_note_deletions (
      note_id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      case_id uuid NOT NULL,
      deleted_by_user_id uuid NOT NULL,
      deleted_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT case_note_deletions_owner_fk
        FOREIGN KEY (organization_id,case_id,note_id,deleted_by_user_id)
        REFERENCES case_notes(organization_id,case_id,id,created_by_user_id) ON DELETE RESTRICT
    );
    CREATE TRIGGER case_note_deletions_append_guard BEFORE UPDATE OR DELETE ON case_note_deletions
      FOR EACH ROW EXECUTE FUNCTION case_note_append_guard();
  `)
}

export function down(pgm) {
  pgm.sql(`
    DROP TABLE case_note_deletions;
    ALTER TABLE case_notes DROP CONSTRAINT case_notes_owner_unique;
  `)
}
