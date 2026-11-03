-- Migration: 20261004010000_auth_uid_guc_fix.sql
-- Description: auth.uid() stub reads request.jwt.claim.sub GUC set by transactions

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
