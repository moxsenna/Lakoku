-- M10-E E5 Blueprint Validator Proofs Table - AUTHORITATIVE EVIDENCE
-- Purpose: Persist canonical spine/reveal/ending validator results immutably
-- Authority: E-OPS-1 Criterion #5 + Static Gate fb64c47 verdict
-- Boundary: Immutable after insertion; NO CASCADE deletion for authoritative history; NO UPDATE/DELETE paths

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
  
  -- ACTUAL PERSISTENT PROOF PAYLOADS (Static Gate fb64c47 corrections):
  
  -- Spine+Reveal validator findings: single jsonb array of objects {chapter_number, finding_type, message}
  spine_reveal_findings jsonb[],  -- Array type as defined, not individual jsonb
  
  -- Ending validator result: object {main_ending_found: boolean, secret_endings_reached: string[]}
  ending_results jsonb,            -- Corrected name from ending_findings
  
  -- Authoritative proof hash (SHA-256 hex of combined findings + timestamp + chapter_nums)
  proof_hash text,                 -- Populated AFTER proof generation for integrity verification
  
  -- Exact chapter/version pairs affected by resolution (per-chapter optimistic locking)
  chapter_version_pairs jsonb[],   -- [{"chapter": N, "expected_version": M}] array
  
  -- Timestamp when proof created (immutable)
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for efficient proof queries
CREATE INDEX idx_validator_proof_story_id ON public.blueprint_validator_proofs(story_id);
CREATE INDEX idx_validator_proof_source_event ON public.blueprint_validator_proofs(source_event_id);
CREATE INDEX idx_validator_proof_created ON public.blueprint_validator_proofs(created_at DESC);
CREATE INDEX idx_validator_proof_disposition ON public.blueprint_validator_proofs(disposition);
CREATE INDEX idx_validator_proof_proof_type ON public.blueprint_validator_proofs(proof_type);
CREATE UNIQUE INDEX idx_validator_proof_unique ON public.blueprint_validator_proofs(story_id, source_event_id, disposition, reviewer_uid, chapter_numbers);

-- RLS policies (owner/admin only; NO UPDATE/DELETE for immutability)
ALTER TABLE public.blueprint_validator_proofs ENABLE ROW LEVEL SECURITY;

-- Explicit deny for anon users (DROP IF EXISTS then CREATE explicit deny)
DROP POLICY IF EXISTS "anon_select" ON public.blueprint_validator_proofs;
DROP POLICY IF EXISTS "anon_insert" ON public.blueprint_validator_proofs;
DROP POLICY IF EXISTS "anon_update" ON public.blueprint_validator_proofs;
DROP POLICY IF EXISTS "anon_delete" ON public.blueprint_validator_proofs;

-- Allow owner/admin SELECT/INSERT ONLY (NO UPDATE/DELETE for immutability)
CREATE POLICY e5_validator_proof_select
  ON public.blueprint_validator_proofs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin_users au
      WHERE au.user_id = auth.uid()
      AND au.role IN ('owner', 'admin')
    )
  );

CREATE POLICY e5_validator_proof_insert
  ON public.blueprint_validator_proofs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admin_users au
      WHERE au.user_id = auth.uid()
      AND au.role IN ('owner', 'admin')
    )
  );

-- Explicitly deny UPDATE/DELETE (immutability requirement)
CREATE POLICY e5_validator_proof_no_update
  ON public.blueprint_validator_proofs
  FOR UPDATE
  TO authenticated
  USING (false);  -- Block all updates

CREATE POLICY e5_validator_proof_no_delete
  ON public.blueprint_validator_proofs
  FOR DELETE
  TO authenticated
  USING (false);  -- Block all deletions

-- Service role bypass for internal operations (SELECT/INSERT only)
CREATE POLICY e5_validator_proof_service_role_select
  ON public.blueprint_validator_proofs
  FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY e5_validator_proof_service_role_insert
  ON public.blueprint_validator_proofs
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Comments
COMMENT ON TABLE public.blueprint_validator_proofs IS 'Authoritative persisted validator results and unblock proofs for E-OPS-1 compliance (E-OPS-1 Criterion #5; NEVER UPDATE/DELETE); Stores actual findings payloads, not just metadata';
COMMENT ON COLUMN public.blueprint_validator_proofs.story_id IS 'FK to blueprint_queue(story_id); TEXT type consistent; RESTRICT ensures immutable history';
COMMENT ON COLUMN public.blueprint_validator_proofs.source_event_id IS 'BIGINT NOT NULL FK to public.story_events(id); Evidence binding mandatory per E-OPS-1';
COMMENT ON COLUMN public.blueprint_validator_proofs.reviewer_uid IS 'auth.uid() of authorized admin user who reviewed disposition; RESTRICT preserves proof even if user deleted';
COMMENT ON COLUMN public.blueprint_validator_proofs.proof_type IS 'Type of validation proof: VALIDATOR_RERUN_PASSED, SPINE_VALIDATION, REVEAL_VALIDATION, ENDING_VALIDATION';
COMMENT ON COLUMN public.blueprint_validator_proofs.spine_reveal_findings IS 'Actual JSONB array of canonical spine+reveal validator findings per chapter (jsonb[], not individual jsonb)';
COMMENT ON COLUMN public.blueprint_validator_proofs.ending_results IS 'Actual JSONB object of main/secret ending reachability validation result; corrected name from ending_findings';
COMMENT ON COLUMN public.blueprint_validator_proofs.proof_hash IS 'SHA-256 hex digest of combined findings + timestamp + chapter_nums for immutability verification';
COMMENT ON COLUMN public.blueprint_validator_proofs.chapter_version_pairs IS 'JSONB array of {"chapter": N, "expected_version": M} objects representing exact versions locked by resolution';
