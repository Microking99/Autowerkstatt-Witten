-- Das Audit-Protokoll ist nur anfügbar (docs/rollen-und-rechte.md Abschnitt 5).
-- UPDATE, DELETE und TRUNCATE werden abgewiesen.
CREATE OR REPLACE FUNCTION audit_log_prevent_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log ist nur anfügbar (% nicht erlaubt)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_prevent_change();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_prevent_change();
