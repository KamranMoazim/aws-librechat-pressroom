#!/usr/bin/env bash
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v writer_password="$AUDIT_WRITER_PASSWORD" <<'SQL'
CREATE TABLE IF NOT EXISTS approved_actions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  user_oid text NOT NULL,
  upn text NOT NULL,
  tool text NOT NULL,
  target text NOT NULL,
  summary text NOT NULL,
  args_sha256 char(64) NOT NULL,
  before jsonb,
  after jsonb,
  conversation_id text,
  result text NOT NULL
);
CREATE INDEX IF NOT EXISTS approved_actions_user_at ON approved_actions (user_oid, at);

CREATE OR REPLACE FUNCTION approved_actions_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'approved_actions is append-only (% refused)', TG_OP;
END;
$$;
DROP TRIGGER IF EXISTS approved_actions_no_change ON approved_actions;
CREATE TRIGGER approved_actions_no_change BEFORE UPDATE OR DELETE ON approved_actions
  FOR EACH ROW EXECUTE FUNCTION approved_actions_append_only();
DROP TRIGGER IF EXISTS approved_actions_no_truncate ON approved_actions;
CREATE TRIGGER approved_actions_no_truncate BEFORE TRUNCATE ON approved_actions
  FOR EACH STATEMENT EXECUTE FUNCTION approved_actions_append_only();

SELECT format('CREATE ROLE audit_writer LOGIN PASSWORD %L', :'writer_password')
  WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'audit_writer') \gexec
ALTER ROLE audit_writer PASSWORD :'writer_password';
REVOKE ALL ON approved_actions FROM PUBLIC;
GRANT INSERT, SELECT ON approved_actions TO audit_writer;
SQL
