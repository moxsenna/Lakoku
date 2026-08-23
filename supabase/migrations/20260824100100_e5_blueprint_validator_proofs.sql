-- M10-E E5 Blueprint Validator Proofs Table - AUTHORITATIVE EVIDENCE
-- Purpose: Persist canonical spine/reveal/ending validator results immutably
-- Authority: E-OPS-1 Criterion #5 (proof persistence) + Reviewer verdict E5
-- Boundary: Immutable after insertion; NO CASCADE deletion for authoritative history
-- CONTRACT: Must store actual findings payload, not just metadata

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
  
  -- FK to story queue item (RESTRICT: immutable historical record)
  story_id text NOT NULL REFERENCES public.blueprint_queue(story_id) ON DELETE RESTRICT,
  
  -- FK to source event (non-null evidence binding per E-OPS-1)
  source_event_id bigint NOT NULL REFERENCES public.story_events(id),
  
  -- Resolution disposition this proof supports
  disposition text NOT NULL CHECK (disposition IN ('REJECT_BLOCK', 'RETRY_ALLOW', 'UNBLOCK_PERMIT')),
  
  -- Reviewer who approved disposition (RESTRICT: never lose proof on user deletion)
  reviewer_uid uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  
  -- Reason text from reviewer
  reason_text text NOT NULL,
  
  -- Chapters validated (canonical chapter numbers)
  chapter_numbers integer[] NOT NULL,
  
  -- Proof type identifier (VALIDATOR_RERUN_PASSED for final gate)
  proof_type text NOT NULL CHECK (proof_type IN ('VALIDATOR_RERUN_PASSED', 'SPINE_VALIDATION', 'REVEAL_VALIDATION', 'ENDING_VALIDATION')),
  
  -- ACTUAL PERSISTENT PROOF PAYLOADS (Reviewer Requirement #3):
  
  -- Spine+Reveal validator findings: array of objects {chapter_number, finding_type, message}
  spine_reveal_findings jsonb[],
  
  -- Ending validator result: object {main_ending_found: boolean, secret_endings: string[]}
  ending_results jsonb,
  
  -- Authoritative proof hash (SHA-256 hex of combined findings)
  proof_hash text,
  
  -- Exact chapter/version pairs affected by resolution
  chapter_version_pairs jsonb[],
  
  -- Timestamp when proof created (immutable)
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for efficient proof queries
CREATE INDEX idx_validator_proof_story_id ON public.blueprint_validator_proofs(story_id);
CREATE INDEX idx_validator_proof_source_event ON public.blueprint_validator_proofs(source_event_id);
CREATE INDEX idx_validator_proof_created ON public.blueprint_validator_proofs(created_at DESC);
CREATE INDEX idx_validator_proof_disposition ON public.blueprint_validator_proofs(disposition);
CREATE INDEX idx_validator_proof_proof_type ON public.blueprint_validator_proofs(proof_type);

-- RLS policies (owner/admin only)
ALTER TABLE public.blueprint_validator_proofs ENABLE ROW LEVEL SECURITY;

-- No access for anon users (explicit deny)
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
      AND au.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admin_users au
      WHERE au.user_id = auth.uid()
      AND au.role IN ('owner', 'admin')
    )
  );

-- Service role bypass for internal operations
CREATE POLICY e5_validator_proof_service_role
  ON public.blueprint_validator_proofs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Comments
COMMENT ON TABLE public.blueprint_validator_proofs IS 'Authoritative persisted validator results and unblock proofs for E-OPS-1 compliance (E-OPS-1 Criterion #5; NEVER UPDATE/DELETE); Stores actual findings payloads, not just metadata';
COMMENT ON COLUMN public.blueprint_validator_proofs.story_id IS 'FK to blueprint_queue(story_id); TEXT type consistent; RESTRICT ensures immutable history';
COMMENT ON COLUMN public.blueprint_validator_proofs.source_event_id IS 'BIGINT NOT NULL FK to public.story_events(id); Evidence binding mandatory per E-OPS-1';
COMMENT ON COLUMN public.blueprint_validator_proofs.reviewer_uid IS 'auth.uid() of authorized admin user who reviewed disposition; RESTRICT preserves proof even if user deleted';
COMMENT ON COLUMN public.blueprint_validator_proofs.proof_type IS 'Type of validation proof: VALIDATOR_RERUN_PASSED, SPINE_VALIDATION, REVEAL_VALIDATION, ENDING_VALIDATION';
COMMENT ON COLUMN public.blueprint_validator_proofs.spine_reveal_findings IS 'Actual JSONB array of canonical spine+reveal validator findings per chapter';
COMMENT ON COLUMN public.blueprint_validator_proofs.ending_results IS 'Actual JSONB object of main/secret ending reachability validation result';
COMMENT ON COLUMN public.blueprint_validator_proofs.proof_hash IS 'SHA-256 hex digest of combined findings for immutability verification';
COMMENT ON COLUMN public.blueprint_validator_proofs.chapter_version_pairs IS 'JSONB array of {"chapter": N, "version": M} objects representing exact versions affected';
