/**
 * Paket 66 Commit #2 - versioned gercek piyasa deger kaybi revision'i.
 *
 * 0042 Dosya Envanteri icin ayrilmistir. Mevcut revision tablolari yeterli
 * oldugundan yalniz immutable rule identity allowlist'i additive genisletilir.
 */
export const shorthands = undefined

export function up(pgm) {
  pgm.sql(`
    ALTER TABLE traffic_value_loss_versions
      DROP CONSTRAINT traffic_value_loss_versions_rule_locked;
    ALTER TABLE traffic_value_loss_versions
      ADD CONSTRAINT traffic_value_loss_versions_rule_locked CHECK (
        (
          rule_set_id='traffic-value-loss-market-difference'
          AND rule_version='2026.07.01.1'
          AND effective_from=DATE '2026-07-01'
        )
        OR
        (
          rule_set_id='real-market-analysis'
          AND rule_version='real-market-analysis/2026-07-01/1.0.0'
          AND effective_from=DATE '2026-07-01'
        )
      );
  `)
}

export function down(pgm) {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM traffic_value_loss_versions
        WHERE rule_set_id='real-market-analysis'
          OR rule_version='real-market-analysis/2026-07-01/1.0.0'
      ) THEN
        RAISE EXCEPTION 'real market value loss revisions must be removed before rollback'
          USING ERRCODE='restrict_violation';
      END IF;
    END $$;
    ALTER TABLE traffic_value_loss_versions
      DROP CONSTRAINT traffic_value_loss_versions_rule_locked;
    ALTER TABLE traffic_value_loss_versions
      ADD CONSTRAINT traffic_value_loss_versions_rule_locked CHECK (
        rule_set_id='traffic-value-loss-market-difference'
        AND rule_version='2026.07.01.1'
        AND effective_from=DATE '2026-07-01'
      );
  `)
}
