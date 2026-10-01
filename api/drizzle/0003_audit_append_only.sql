-- R6 (NBR enlistment): the audit trail is append-only at the database level, not just by application convention.
-- UPDATE and DELETE are rejected, except the one-time sealing of rows written before the hash chain existed
-- (hash NULL -> value, every other column unchanged). TRUNCATE is rejected too. The demo re-seed sets
-- `dizivat.reseed = on` for its own transaction only. The SHA-256 chain (prev_hash/hash) makes any change made
-- around these guards (e.g. by a superuser) detectable through GET /api/v1/audit/verify.
CREATE OR REPLACE FUNCTION audit_events_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('dizivat.reseed', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.hash IS NULL AND NEW.hash IS NOT NULL
     AND NEW.id = OLD.id AND NEW.at = OLD.at AND NEW.day = OLD.day AND NEW.actor = OLD.actor
     AND NEW.actor_id IS NOT DISTINCT FROM OLD.actor_id AND NEW.entity = OLD.entity
     AND NEW.entity_id IS NOT DISTINCT FROM OLD.entity_id AND NEW.ref = OLD.ref AND NEW.action = OLD.action
     AND NEW.changes IS NOT DISTINCT FROM OLD.changes AND NEW.note IS NOT DISTINCT FROM OLD.note THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_events is append-only (% blocked)', TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION audit_events_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit_events_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('dizivat.reseed', true) = 'on' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'audit_events is append-only (TRUNCATE blocked)' USING ERRCODE = 'insufficient_privilege';
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_events_no_truncate ON audit_events;
--> statement-breakpoint
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events FOR EACH STATEMENT EXECUTE FUNCTION audit_events_no_truncate();
