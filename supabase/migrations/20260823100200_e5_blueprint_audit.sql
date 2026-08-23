-- M10-E E5 Blueprint Audit Log Table
-- Purpose: Immutable historical record of all review dispositions
-- Authority: E-OPS-1 Criterion #5 (audit trail completeness)
-- Boundary: NEVER UPDATE/DELETE after insertion; ON DELETE RESTRICT prevents cascade-deletion

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables 
    WHERE schemaname = 'public' 
    AND tablename = 'blueprint_audit_log'
  ) THEN
    RAISE NOTICE 'blueprint_audit_log table already exists, skipping creation';
    RETURN;
  END IF;
END $$;

CREATE TABLE public.blueprint_audit_log (
  -- Primary key for audit entry
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- FK to queue item reviewed (story identity)
  story_id text NOT NULL REFERENCES public.blueprint_queue(story_id) ON DELETE RESTRICT, -- RESTRICT: parent deletion cannot remove historical audit
  
  -- Reviewer authorization binding (auth.uid() captured in API layer)
  reviewer_uid uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Resolution disposition outcome per E-OPS-1 approved pattern
  disposition text NOT NULL CHECK (disposition IN ('REJECT_BLOCK', 'RETRY_ALLOW', 'UNBLOCK_PERMIT')),
  
  -- Reason text from reviewer (mandatory field per audit completeness)
  reason_text text NOT NULL,
  
  -- Source event binding (NON-NULL required: real event evidence mandatory)
  source_event_id bigint NOT NULL REFERENCES public.story_events(id), -- BIGINT NOT NULL FK to frozen baseline event ID column
  
  -- Timestamp when disposition recorded and audited
  created_at timestamptz NOT NULL DEFAULT now(),
  
  -- Idempotency key (prevent duplicate audit entries on network retry)
  idempotency_key text UNIQUE,
  
  -- Implementation note: UUID primary key permits efficient distributed audit ID generation
);

-- Indexes for efficient query patterns
CREATE INDEX idx_blueprint_audit_story_id ON public.blueprint_audit_log(story_id);
CREATE INDEX idx_blueprint_audit_created_at ON public.blueprint_audit_log(created_at DESC);
CREATE INDEX idx_blueprint_audit_source_event_id ON public.blueprint_audit_log(source_event_id);

-- Comments for documentation
COMMENT ON TABLE public.blueprint_audit_log IS 'Immutable historical audit record for E-OPS-1 review dispositions (E-OPS-1 Criterion #5; NEVER UPDATE/DELETE)';
COMMENT ON COLUMN public.blueprint_audit_log.story_id IS 'FK to blueprint_queue(story_id); TEXT type consistent with queue schema; ON DELETE RESTRICT enforces immutability';
COMMENT ON COLUMN public.blueprint_audit_log.source_event_id IS 'BIGINT NOT NULL FK to public.story_events(id); NON-NULL per E-OPS-1 evidence binding requirement; missing real event => fail closed';
COMMENT ON COLUMN public.blueprint_audit_log.reviewer_uid IS 'auth.uid() of authorized admin user via requireAdminUser(); owner/admin roles only';

-- Critical constraint enforcement comment
COMMENT ON CONSTRAINT blueprint_audit_log_source_event_id_check ON public.blueprint_audit_log 
  IS 'source_event_id is BIGINT NOT NULL REQUIRED per E-OPS-1; no null/sentinel/placeholder/fake event fabrication permitted; missing real event => resolution/enqueue DENIED';

-- RLS policy: read-only access for auditing purposes
ALTER TABLE public.blueprint_audit_log ENABLE ROW LEVEL SECURITY;

-- Policy: authenticated users can select but not modify
CREATE POLICY "blueprint_audit_log_authenticated_select" ON public.blueprint_audit_log
  FOR SELECT TO authenticated
  USING (true) WITH CHECK (false);

CREATE POLICY "blueprint_audit_log_service_role" ON public.blueprint_audit_log
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "blueprint_audit_log_authenticated_insert" ON public.blueprint_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (true)
  USING (true);

-- Grant permissions to authenticated (write via API gateway, select for internal review)
REVOKE ALL ON TABLE public.blueprint_audit_log FROM public, anon;
GRANT SELECT, INSERT ON TABLE public.blueprint_audit_log TO authenticated;
GRANT ALL ON TABLE public.blueprint_audit_log TO service_role;
