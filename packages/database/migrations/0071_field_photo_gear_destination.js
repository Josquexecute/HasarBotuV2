export const shorthands = undefined
export function up(pgm) {
  pgm.sql(`ALTER TABLE field_photo_uploads DROP CONSTRAINT field_photo_uploads_kind_check;
    ALTER TABLE field_photo_uploads ADD CONSTRAINT field_photo_uploads_kind_check CHECK(kind IN ('damage','chassis','odometer','gear'));
    ALTER TABLE field_photo_uploads ADD COLUMN output_subdirectory text NOT NULL DEFAULT 'HASAR' CHECK(output_subdirectory IN ('','HASAR'));
    -- Preserve published files and reservations from interrupted old workers in their original namespace.
    UPDATE field_photo_uploads SET output_subdirectory='' WHERE output_file_name IS NOT NULL OR status='processing';
  `)
}
export function down(pgm) {
  pgm.sql(`DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM field_photo_uploads WHERE kind='gear' OR output_subdirectory='HASAR' AND output_file_name IS NOT NULL)
      THEN RAISE EXCEPTION 'field_photo_destination_rollback_would_lose_data'; END IF;
    END $$;
    ALTER TABLE field_photo_uploads DROP COLUMN output_subdirectory;
    ALTER TABLE field_photo_uploads DROP CONSTRAINT field_photo_uploads_kind_check;
    ALTER TABLE field_photo_uploads ADD CONSTRAINT field_photo_uploads_kind_check CHECK(kind IN ('damage','chassis','odometer'));
  `)
}
