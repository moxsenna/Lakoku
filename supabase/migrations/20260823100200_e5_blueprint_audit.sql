-- M10-E E5 Blueprint Audit Log Table
-- Purpose: Immutable historical record of all review dispositions
-- Authority: E-OPS-1 Criterion #5 (audit trail completeness)
-- Boundary: NEVER UPDATE/DELETE after insertion; ON DELETE RESTRICT prevents cascade-deletion

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'blueprint_audit_log') THEN
    RAISE NOTICE 'blueprint_audit_log table already exists, skipping creation';
    RETURN;
  END IF;
END $$;

CREATE TABLE public.blueprint_audit_log (
  -- Primary key
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- FK to queue item reviewed (RESTRICT: parent deletion cannot remove historical audit)
  story_id text NOT NULL REFERENCES public.blueprint_queue(story_id) ON DELETE RESTRICT,
  
  -- Reviewer authorization (RESTRICT: never lose audit evidence on user deletion)
  reviewer_uid uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  
  -- Resolution disposition outcome
  disposition text NOT NULL CHECK (disposition IN ('REJECT_BLOCK', 'RETRY_ALLOW', 'UNBLOCK_PERMIT')),
  
  -- Reason text from reviewer
  reason_text text NOT NULL,
  
  -- Source event binding (NON-NULL required: real event evidence mandatory)
  source_event_id bigint NOT NULL REFERENCES public.story_events(id),
  
  -- Timestamp when disposition recorded and audited
  created_at timestamptz NOT NULL DEFAULT now(),
  
  -- Idempotency key
  idempotency_key text UNIQUE
);

-- Indexes
CREATE INDEX idx_blueprint_audit_story_id ON public.blueprint_audit_log(story_id);
CREATE INDEX idx_blueprint_audit_created ON public.blueprint_audit_log(created_at DESC);
CREATE INDEX idx_blueprint_audit_source_event_id ON public.blueprint_audit_log(source_event_id);

-- Comments
COMMENT ON TABLE public.blueprint_audit_log IS 'Immutable historical audit record for E-OPS-1 review dispositions (E-OPS-1 Criterion #5; NEVER UPDATE/DELETE)';
COMMENT ON COLUMN public.blueprint_audit_log.story_id IS 'FK to blueprint_queue(story_id); TEXT type consistent; ON DELETE RESTRICT enforces immutability';
COMMENT ON COLUMN public.blueprint_audit_log.source_event_id IS 'BIGINT NOT NULL FK to public.story_events(id); NON-NULL per E-OPS-1 evidence binding requirement';
COMMENT ON COLUMN public.blueprint_audit_log.reviewer_uid IS 'auth.uid() of authorized admin user via requireAdminUser(); owner/admin roles only';

-- Critical constraint note
COMMENT ON CONSTRAINT blueprint_audit_log_source_event_id_fkey ON public.blueprint_audit_log 
  IS 'source_event_id is BIGINT NOT NULL REQUIRED per E-OPS-1; no null/sentinel/placeholder/fake event fabrication permitted; missing real event => resolution/enqueue DENIED';

-- Enable RLS
ALTER TABLE public.blueprint_audit_log ENABLE ROW LEVEL SECURITY;

-- Drop any existing policies
DROP POLICY IF EXISTS "blueprint_audit_log_anon_select" ON public.blueprint_audit_log;
DROP POLICY IF EXISTS "blueprint_audit_log_authenticated_insert" ON public.blueprint_audit_log;
DROP POLICY IF EXISTS "blueprint_audit_log_service_role" ON public.blueprint_audit_log;

-- Create valid RLS policies
CREATE POLICY "blueprint_audit_log_anon_select" 
  ON public.blueprint_audit_log FOR SELECT TO anon USING (true);

CREATE POLICY "blueprint_audit_log_authenticated_insert" 
  ON public.blueprint_audit_log FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "blueprint_audit_log_service_role" 
  ON public.blueprint_audit_log FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Grant permissions
REVOKE ALL ON TABLE public.blueprint_audit_log FROM public, anon, authenticated;
GRANT SELECT ON TABLE public.blueprint_audit_log TO service_role;
GRANT INSERT ON TABLE public.blueprint_audit_log TO service_role;
