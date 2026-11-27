export const shorthands = undefined

export function up(pgm) {
  pgm.sql(`
    CREATE TABLE case_value_loss_calculation_history (
      LIKE case_value_loss_calculations,
      history_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      FOREIGN KEY (organization_id, case_id) REFERENCES cases (organization_id, id) ON DELETE RESTRICT
    );
    CREATE INDEX case_value_loss_calculation_history_case_idx
      ON case_value_loss_calculation_history (organization_id, case_id, updated_at DESC);

    CREATE FUNCTION archive_case_value_loss_calculation() RETURNS trigger
      LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO case_value_loss_calculation_history
        (organization_id, case_id, input, result, updated_by_user_id,
         updated_at, result_breakdown, result_breakdown_updated_at)
      VALUES (OLD.organization_id, OLD.case_id, OLD.input, OLD.result, OLD.updated_by_user_id,
              OLD.updated_at, OLD.result_breakdown, OLD.result_breakdown_updated_at);
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER case_value_loss_calculation_archive
      BEFORE UPDATE ON case_value_loss_calculations
      FOR EACH ROW EXECUTE FUNCTION archive_case_value_loss_calculation();
  `)
}

export function down() {
  throw new Error('Calculation history must be retained. Roll back API binaries while keeping migration 0079 applied.')
}
