export const shorthands = undefined

export function up(pgm) {
  pgm.sql(`ALTER TABLE sessions ALTER COLUMN expires_at DROP NOT NULL;
    ALTER TABLE sessions ADD COLUMN persistent boolean NOT NULL DEFAULT true;
    UPDATE sessions SET expires_at=NULL
    WHERE revoked_at IS NULL AND expires_at>now()
      AND EXISTS (SELECT 1 FROM users WHERE users.id=sessions.user_id AND users.status='active');
    CREATE FUNCTION revoke_sessions_on_account_change() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      UPDATE sessions SET revoked_at=now() WHERE user_id=NEW.id AND revoked_at IS NULL;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER revoke_sessions_on_account_change
      AFTER UPDATE OF password_hash,status ON users FOR EACH ROW
      WHEN (OLD.password_hash IS DISTINCT FROM NEW.password_hash OR (OLD.status IS DISTINCT FROM NEW.status AND NEW.status<>'active'))
      EXECUTE FUNCTION revoke_sessions_on_account_change();`)
}

export function down(pgm) {
  // A rollback restores the previous timeout without reviving revoked sessions.
  pgm.sql(`DROP TRIGGER revoke_sessions_on_account_change ON users;
    DROP FUNCTION revoke_sessions_on_account_change();
    UPDATE sessions SET expires_at=now()+interval '12 hours' WHERE expires_at IS NULL;
    ALTER TABLE sessions ALTER COLUMN expires_at SET NOT NULL;
    ALTER TABLE sessions DROP COLUMN persistent;`)
}
