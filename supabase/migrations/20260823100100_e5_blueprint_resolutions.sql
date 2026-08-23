-- M10-E E5 Blueprint Resolutions Table
-- Purpose: Store human reviewer disposition decisions per queue item
-- Authority: E-OPS-1 Criterion #4 (authorization), #5 (audit trail completeness)
-- Boundary: Reuse requireAdminUser() owner/admin roles; NO invented role='reviewer'

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'blueprint_resolutions') THEN
    RAISE NOTICE 'blueprint_resolutions table already exists, skipping creation';
    RETURN;
  END IF;
END $$;

-- Create sequence first before using it
CREATE SEQUENCE IF NOT EXISTS public.blueprint_resolutions_id_seq;

CREATE TABLE public.blueprint_resolutions (
  -- Primary key
  id bigint PRIMARY KEY DEFAULT nextval('public.blueprint_resolutions_id_seq'),
  
  -- FK to queue item being reviewed
  story_id text NOT NULL REFERENCES public.blueprint_queue(story_id) ON DELETE CASCADE,
  
  -- Resolution disposition outcome
  disposition text NOT NULL CHECK (disposition IN ('REJECT_BLOCK', 'RETRY_ALLOW', 'UNBLOCK_PERMIT')),
  
  -- Reviewer authorization (auth.uid())
  reviewer_uid uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Reason text from reviewer
  reason_text text NOT NULL,
  
  -- Timestamp
  created_at timestamptz NOT NULL DEFAULT now(),
  
  -- Idempotency key
  idempotency_key text UNIQUE
);

-- Indexes
CREATE INDEX idx_blueprint_resolutions_story_id ON public.blueprint_resolutions(story_id);
CREATE INDEX idx_blueprint_resolutions_created DESC ON public.blueprint_resolutions(created_at DESC);

-- Comments
COMMENT ON TABLE public.blueprint_resolutions IS 'Human reviewer disposition records for E-OPS-1 workflow queue (E-OPS-1 Criterion #4)';
COMMENT ON COLUMN public.blueprint_resolutions.story_id IS 'FK to blueprint_queue(story_id); TEXT type consistent';
COMMENT ON COLUMN public.blueprint_resolutions.reviewer_uid IS 'auth.uid() of authorized admin user via requireAdminUser(); owner/admin roles only';
COMMENT ON COLUMN public.blueprint_resolutions.idempotency_key IS 'Prevent duplicate resolution recording on network retries';

-- Enable RLS
ALTER TABLE public.blueprint_resolutions ENABLE ROW LEVEL SECURITY;

-- Drop any existing policies
DROP POLICY IF EXISTS "blueprint_resolutions_anon_insert" ON public.blueprint_resolutions;
DROP POLICY IF EXISTS "blueprint_resolutions_authenticated_select" ON public.blueprint_resolutions;
DROP POLICY IF EXISTS "blueprint_resolutions_service_role" ON public.blueprint_resolutions;

-- Create valid RLS policies (no NEW.* in FOR SELECT clauses)
CREATE POLICY "blueprint_resolutions_authenticated_insert" 
  ON public.blueprint_resolutions FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "blueprint_resolutions_authenticated_select" 
  ON public.blueprint_resolutions FOR SELECT TO authenticated USING (true);

CREATE POLICY "blueprint_resolutions_service_role" 
  ON public.blueprint_resolutions FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Grant permissions
REVOKE ALL ON TABLE public.blueprint_resolutions FROM public, anon;
GRANT SELECT, INSERT ON TABLE public.blueprint_resolutions TO authenticated;
GRANT ALL ON TABLE public.blueprint_resolutions TO service_role;
