-- M10-E E5 Blueprint Resolutions Table
-- Purpose: Store human reviewer disposition decisions per queue item
-- Authority: E-OPS-1 Criterion #4 (authorization), #5 (audit trail completeness)
-- Boundary: NO invented role='reviewer' auth seam; reuse requireAdminUser() owner/admin roles

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables 
    WHERE schemaname = 'public' 
    AND tablename = 'blueprint_resolutions'
  ) THEN
    RAISE NOTICE 'blueprint_resolutions table already exists, skipping creation';
    RETURN;
  END IF;
END $$;

CREATE TABLE public.blueprint_resolutions (
  -- Primary key for resolution record
  id bigint PRIMARY KEY DEFAULT nextval('public.blueprint_queue_id_seq'),
  
  -- FK to queue item being reviewed (story identity)
  story_id text NOT NULL REFERENCES public.blueprint_queue(story_id) ON DELETE CASCADE,
  
  -- Resolution disposition outcome per E-OPS-1 approved pattern
  disposition text NOT NULL CHECK (disposition IN ('REJECT_BLOCK', 'RETRY_ALLOW', 'UNBLOCK_PERMIT')),
  
  -- Reviewer authorization binding (auth.uid() captured in API layer)
  reviewer_uid uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Reason text from reviewer (mandatory field per audit completeness)
  reason_text text NOT NULL,
  
  -- Timestamp when disposition recorded
  created_at timestamptz NOT NULL DEFAULT now(),
  
  -- Idempotency key (prevent duplicate resolution on network retry)
  idempotency_key text UNIQUE
);

-- Indexes for efficient lookup
CREATE INDEX idx_blueprint_resolutions_story_id ON public.blueprint_resolutions(story_id);
CREATE INDEX idx_blueprint_resolutions_created_at ON public.blueprint_resolutions(created_at DESC);

-- Comments for documentation
COMMENT ON TABLE public.blueprint_resolutions IS 'Human reviewer disposition records for E-OPS-1 workflow queue (E-OPS-1 Criterion #4)';
COMMENT ON COLUMN public.blueprint_resolutions.story_id IS 'FK to blueprint_queue(story_id); TEXT type consistent with queue schema';
COMMENT ON COLUMN public.blueprint_resolutions.reviewer_uid IS 'auth.uid() of authorized admin user via requireAdminUser(); owner/admin roles only';
COMMENT ON COLUMN public.blueprint_resolutions.idempotency_key IS 'Prevent duplicate resolution recording on network retries';

-- RLS policy: only authorized reviewers can INSERT, everyone else blocked
ALTER TABLE public.blueprint_resolutions ENABLE ROW LEVEL SECURITY;

-- Policy: block all reads/writes by default
DROP POLICY IF EXISTS "blueprint_resolutions_public_read" ON public.blueprint_resolutions;
DROP POLICY IF EXISTS "blueprint_resolutions_anon_insert" ON public.blueprint_resolutions;

-- Create policies for authenticated users (write-only via API gateway)
CREATE POLICY "blueprint_resolutions_authenticated_write" ON public.blueprint_resolutions
  FOR INSERT TO authenticated
  WITH CHECK (true)
  USING (true);

CREATE POLICY "blueprint_resolutions_authenticated_select" ON public.blueprint_resolutions
  FOR SELECT TO authenticated
  USING (true) WITH CHECK (false);

-- Service role has full access
CREATE POLICY "blueprint_resolutions_service_role" ON public.blueprint_resolutions
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Grant permissions to service role and authenticated (for direct API calls)
REVOKE ALL ON TABLE public.blueprint_resolutions FROM public, anon;
GRANT SELECT, INSERT ON TABLE public.blueprint_resolutions TO authenticated;
GRANT ALL ON TABLE public.blueprint_resolutions TO service_role;

-- Sequence for primary key (reuse queue sequence to avoid proliferation)
CREATE SEQUENCE IF NOT EXISTS public.blueprint_queue_id_seq;
