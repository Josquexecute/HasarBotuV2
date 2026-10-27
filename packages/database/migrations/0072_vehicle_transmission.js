export const shorthands = undefined
export function up(pgm) {
  pgm.sql(`ALTER TABLE cases ADD COLUMN transmission text NOT NULL DEFAULT 'unknown'
      CHECK(transmission IN ('unknown','manual','automatic','semi_automatic'));
    ALTER TABLE case_vehicle_profile_versions ADD COLUMN transmission text NOT NULL DEFAULT 'unknown'
      CHECK(transmission IN ('unknown','manual','automatic','semi_automatic'));
  `)
}
export function down(pgm) {
  pgm.sql(`DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM cases WHERE transmission<>'unknown') OR EXISTS(SELECT 1 FROM case_vehicle_profile_versions WHERE transmission<>'unknown')
      THEN RAISE EXCEPTION 'vehicle_transmission_rollback_would_lose_data'; END IF;
    END $$;
    ALTER TABLE case_vehicle_profile_versions DROP COLUMN transmission;
    ALTER TABLE cases DROP COLUMN transmission;
  `)
}
