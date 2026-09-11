-- M10-E E5 Blueprint Audit Log
-- Immutable historical record. Writes occur only through RPC/service role.

CREATE TABLE public.blueprint_audit_log (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  story_id text NOT NULL REFERENCES public.blueprint_queue(story_id) ON DELETE RESTRICT,
  resolution_id bigint NOT NULL UNIQUE
    REFERENCES public.blueprint_resolutions(id) ON DELETE RESTRICT,
  reviewer_uid uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  disposition text NOT NULL
    CHECK (disposition IN ('REJECT_BLOCK', 'RETRY_ALLOW', 'UNBLOCK_PERMIT')),
  reason_text text NOT NULL,
  source_event_id bigint NOT NULL REFERENCES public.story_events(id) ON DELETE RESTRICT,
  request_fingerprint text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL
);

CREATE INDEX idx_blueprint_audit_story_id
  ON public.blueprint_audit_log(story_id);
CREATE INDEX idx_blueprint_audit_created
  ON public.blueprint_audit_log(created_at DESC);
CREATE INDEX idx_blueprint_audit_source_event_id
  ON public.blueprint_audit_log(source_event_id);

COMMENT ON TABLE public.blueprint_audit_log IS
  'Immutable historical audit record for E-OPS-1 dispositions; no update/delete access';
COMMENT ON CONSTRAINT blueprint_audit_log_source_event_id_fkey
  ON public.blueprint_audit_log IS
  'Required real source event; historical evidence cannot cascade-delete';

ALTER TABLE public.blueprint_audit_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.blueprint_audit_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.blueprint_audit_log TO service_role;
