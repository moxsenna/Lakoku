-- M10-E E5 Blueprint Validator Proofs Table
-- Purpose: Persist authoritative validator results and unblock proofs
-- Authority: E-OPS-1 Criterion #5 (proof persistence)
-- Boundary: Immutable after insertion; referenced by resolution flow

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'blueprint_validator_proofs') THEN
    RAISE NOTICE 'blueprint_validator_proofs table already exists, skipping creation';
    RETURN;
  END IF;
END $$;

CREATE TABLE public.blueprint_validator_proofs (
  -- Primary key
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- FK to story queue item
  story_id text NOT NULL REFERENCES public.blueprint_queue(story_id) ON DELETE CASCADE,
  
  -- FK to source event (non-null evidence binding)
  source_event_id bigint NOT NULL REFERENCES public.story_events(id),
  
  -- Resolution disposition this proof supports
  disposition text NOT NULL CHECK (disposition IN ('REJECT_BLOCK', 'RETRY_ALLOW', 'UNBLOCK_PERMIT')),
  
  -- Reviewer who approved disposition
  reviewer_uid uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Reason text from reviewer
  reason_text text NOT NULL,
  
  -- Chapters validated
  chapter_numbers integer[] NOT NULL,
  
  -- Proof type identifier
  proof_type text NOT NULL CHECK (proof_type IN ('VALIDATOR_RERUN_PASSED', 'SPINE_VALIDATION', 'REVEAL_VALIDATION', 'ENDING_VALIDATION')),
  
  -- Timestamp when proof created
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_validator_proof_story_id ON public.blueprint_validator_proofs(story_id);
CREATE INDEX idx_validator_proof_source_event ON public.blueprint_validator_proofs(source_event_id);
CREATE INDEX idx_validator_proof_created ON public.blueprint_validator_proofs(created_at DESC);
CREATE INDEX idx_validator_proof_disposition ON public.blueprint_validator_proofs(disposition);

-- RLS policies (owner/admin only)
ALTER TABLE public.blueprint_validator_proofs ENABLE ROW LEVEL SECURITY;

-- No access for anon users
DROP POLICY IF EXISTS "anon_select" ON public.blueprint_validator_proofs;
DROP POLICY IF EXISTS "anon_insert" ON public.blueprint_validator_proofs;

-- Allow owner/admin via authenticated context ONLY
CREATE POLICY e5_validator_proof_authenticated
  ON public.blueprint_validator_proofs
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin_users au
      WHERE au.user_id = auth.uid()
      AND au.story_id = story_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admin_users au
      WHERE au.user_id = auth.uid()
      AND au.story_id = story_id
    )
  );

-- Comments
COMMENT ON TABLE public.blueprint_validator_proofs IS 'Authoritative persisted validator results and unblock proofs for E-OPS-1 compliance (E-OPS-1 Criterion #5; NEVER UPDATE/DELETE)';
COMMENT ON COLUMN public.blueprint_validator_proofs.story_id IS 'FK to blueprint_queue(story_id); TEXT type consistent';
COMMENT ON COLUMN public.blueprint_validator_proofs.source_event_id IS 'BIGINT NOT NULL FK to public.story_events(id); Evidence binding mandatory per E-OPS-1';
COMMENT ON COLUMN public.blueprint_validator_proofs.reviewer_uid IS 'auth.uid() of authorized admin user who reviewed disposition';
COMMENT ON COLUMN public.blueprint_validator_proofs.proof_type IS 'Type of validation proof: VALIDATOR_RERUN_PASSED, SPINE_VALIDATION, REVEAL_VALIDATION, ENDING_VALIDATION';
