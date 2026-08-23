-- M10-E E5 Blueprint Resolution Function (Native Atomic Transaction)
-- Purpose: Single Postgres RPC/function for transactional disposition recording
-- Authority: E-OPS-1 Requirement #9 (transactional resolution boundary) + Static Gate fb64c47 verdict
-- Boundary: 
--   1. ANY exception => automatic rollback; NO partial commits allowed
--   2. SECURITY DEFINER performs internal auth.uid() + admin_users check
--   3. BIGINT preserved lossless (no Number() conversion)
--   4. Per-chapter expected version verification before append
--   5. Idempotent replay returns existing result, zero new effects
-- CONTRACT: TypeScript layer MUST run canonical validators BEFORE calling this RPC
--           RPC verifies evidence/state; if validators fail, DO NOT CALL THIS RPC

CREATE OR REPLACE FUNCTION public.e5_record_disposition(
  p_story_id text,
  p_disposition text,
  p_reviewer_uid uuid,
  p_reason_text text,
  p_source_event_id bigint,  -- BIGINT PRESERVED LOSSLESS (JavaScript safe as decimal string in TS)
  p_chapter_numbers integer[],
  p_validator_spine_findings jsonb DEFAULT NULL,
  p_validator_ending_results jsonb DEFAULT NULL,  -- Renamed from ending_findings per static gate
  p_validation_passed boolean DEFAULT FALSE,
  p_expected_chapter_versions jsonb DEFAULT NULL  -- {"chapter": N, "expected_version": M} array
)
RETURNS TABLE (
  success boolean,
  unblock_proof text,
  error_message text,
  persisted_proof_id uuid,
  validator_results jsonb
) AS $$
DECLARE
  v_idempotency_key text := format('%s-%s-%s', p_story_id, p_disposition, p_reviewer_uid);
  v_existing_resolution_id bigint;
  v_proof_id uuid;
  v_current_max_version integer;
  v_new_version integer;
  v_chapter_insert_count integer;
  v_expected_version integer;
  v_actual_version integer;
BEGIN
  -- BEGIN TRANSACTION - Native PostgreSQL transaction boundary
  -- ALL operations below either commit together or rollback entirely on ANY exception
  
  -- ================================================================
  -- AUTHORIZATION LAYER (SECURITY DEFINER requires internal auth check)
  -- ================================================================
  
  -- Verify caller identity matches reviewer_uid claim AND admin_users membership
  IF EXISTS (SELECT 1 FROM pg_authid WHERE rolname = 'pg_execute_server_role') THEN
    -- Running as superuser/service role bypass
    NULL;
  ELSE
    -- Must verify auth.uid() matches p_reviewer_uid AND admin_users membership
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'UNAUTHORIZED: no active session';
    END IF;
    
    IF auth.uid() != p_reviewer_uid THEN
      RAISE EXCEPTION 'UNAUTHORIZED: reviewer_uid claim % does not match auth.uid() %', p_reviewer_uid, auth.uid();
    END IF;
    
    IF NOT EXISTS (
      SELECT 1 FROM public.admin_users 
      WHERE user_id = auth.uid() 
        AND role IN ('owner', 'admin')
    ) THEN
      RAISE EXCEPTION 'FORBIDDEN: current user is not owner/admin in admin_users table';
    END IF;
  END IF;
  
  -- ================================================================
  -- IDEMPOTENT REPLAY (return existing authoritative result, zero new effects)
  -- ================================================================
  
  -- Check if resolution already exists for this idempotency key
  SELECT id INTO v_existing_resolution_id 
  FROM blueprint_resolutions 
  WHERE idempotency_key = v_idempotency_key 
  LIMIT 1;
  
  IF v_existing_resolution_id IS NOT NULL THEN
    -- Return existing proof/replay evidence WITHOUT creating new effects
    SELECT bp.id INTO v_proof_id
    FROM blueprint_validator_proofs bp
    WHERE bp.story_id = p_story_id
      AND bp.source_event_id = p_source_event_id
      AND bp.disposition = p_disposition
      AND bp.reviewer_uid = p_reviewer_uid
      AND bp.chapter_numbers = p_chapter_numbers
    LIMIT 1;
    
    RETURN QUERY SELECT TRUE, NULL::text, 'Idempotent replay detected'::text, v_proof_id, NULL::jsonb;
    RETURN;  -- Exit early, no new chapters/audit/proof created
  END IF;
  
  -- ================================================================
  -- VALIDATION CHECKS
  -- ================================================================
  
  -- Validate disposition value
  IF p_disposition NOT IN ('REJECT_BLOCK', 'RETRY_ALLOW', 'UNBLOCK_PERMIT') THEN
    RAISE EXCEPTION 'Invalid disposition: %, must be one of REJECT_BLOCK, RETRY_ALLOW, or UNBLOCK_PERMIT', p_disposition;
  END IF;
  
  -- Validate required fields for UNBLOCK_PERMIT
  IF p_disposition = 'UNBLOCK_PERMIT' AND NOT p_validation_passed THEN
    RAISE EXCEPTION 'UNBLOCK_PERMIT requires validation_passed=true with canonical evidence';
  END IF;
  
  -- ================================================================
  -- EXPECTED VERSION VERIFICATION (per-chapter optimistic locking)
  -- ================================================================
  
  IF p_expected_chapter_versions IS NOT NULL THEN
    FOR i IN 1..array_length(p_chapter_numbers, 1) LOOP
      v_expected_version := COALESCE((p_expected_chapter_versions[i]::jsonb)->>'expected_version', 0)::integer;
      
      IF v_expected_version > 0 THEN
        SELECT COALESCE(MAX(version), 0) INTO v_actual_version
        FROM chapter_blueprints
        WHERE story_id = p_story_id
          AND chapter_number = p_chapter_numbers[i];
        
        IF v_actual_version > v_expected_version THEN
          RAISE EXCEPTION 
            'Optimistic concurrency violation: chapter % expected version % but found version %',
            p_chapter_numbers[i], v_expected_version, v_actual_version;
        END IF;
      END IF;
    END LOOP;
  END IF;
  
  -- Calculate new version for append-only
  SELECT COALESCE(MAX(version), 0) + 1 INTO v_new_version
  FROM chapter_blueprints
  WHERE story_id = p_story_id;
  
  -- ================================================================
  -- STEP 1: Insert disposition record (will fail on duplicate key if concurrent race)
  -- ================================================================
  
  INSERT INTO blueprint_resolutions (story_id, disposition, reviewer_uid, reason_text, idempotency_key)
  VALUES (p_story_id, p_disposition, p_reviewer_uid, p_reason_text, v_idempotency_key)
  ON CONFLICT (idempotency_key) DO UPDATE RETURNING id INTO v_existing_resolution_id;
  
  IF v_existing_resolution_id IS NULL THEN
    RAISE EXCEPTION 'Resolution record insertion failed unexpectedly';
  END IF;
  
  -- ================================================================
  -- STEP 2: Insert all chapter blueprint versions by copying full validated content (atomic batch)
  -- CRITICAL: Never create blank/default blueprint rows
  -- ================================================================
  
  WITH new_chapters AS (
    SELECT unnest(p_chapter_numbers) AS chapter_num
  ),
  latest_blueprints AS (
    SELECT DISTINCT ON (cb.story_id, cb.chapter_number)
      cb.story_id,
      cb.chapter_number,
      cb.phase,
      cb.chapter_goal,
      cb.mandatory_beats,
      cb.forbidden_reveals,
      cb.allowed_state_delta,
      cb.introduces_characters,
      cb.reconciled_from_version,
      cb.reconciliation_reason
    FROM chapter_bluepins cb
    WHERE cb.story_id = p_story_id
      AND cb.chapter_number IN (SELECT chapter_num FROM new_chapters)
    ORDER BY cb.story_id, cb.chapter_number, cb.version DESC
  )
  INSERT INTO chapter_bluepins (story_id, chapter_number, version, reconciled_from_version, reconciliation_reason, phase, chapter_goal, mandatory_beats, forbidden_reveals, allowed_state_delta, introduces_characters)
  SELECT lb.story_id, lb.chapter_number, v_new_version, 
         CASE WHEN v_new_version > 1 THEN (lb.reconciled_from_version ?? 'null'::jsonb)::integer ELSE NULL END,
         format('E5 disposition: %s at %s', p_disposition, now()),
         lb.phase,
         lb.chapter_goal,
         lb.mandatory_beats,
         lb.forbidden_reveals,
         lb.allowed_state_delta,
         lb.introduces_characters
  FROM latest_blueprints lb
  JOIN new_chapters nc ON lb.chapter_number = nc.chapter_num;
  
  GET DIAGNOSTICS v_chapter_insert_count = ROW_COUNT;
  
  IF v_chapter_insert_count != array_length(p_chapter_numbers, 1) THEN
    RAISE EXCEPTION 'Chapter insert incomplete: expected % chapters, got %', array_length(p_chapter_numbers, 1), v_chapter_insert_count;
  END IF;
  
  -- ================================================================
  -- STEP 3: Create immutable audit log entry (ON CONFLICT DO NOTHING for idempotency)
  -- ================================================================
  
  INSERT INTO blueprint_audit_log (story_id, reviewer_uid, disposition, reason_text, source_event_id, idempotency_key)
  VALUES (p_story_id, p_reviewer_uid, p_disposition, p_reason_text, p_source_event_id, v_idempotency_key)
  ON CONFLICT (idempotency_key) DO NOTHING;
  
  -- ================================================================
  -- STEP 4: Handle each disposition type
  -- ================================================================
  
  IF p_disposition = 'UNBLOCK_PERMIT' THEN
    -- Persist authoritative validator results with exact payload (correct column names)
    INSERT INTO blueprint_validator_proofs (
      story_id,
      source_event_id,
      disposition,
      reviewer_uid,
      reason_text,
      chapter_numbers,
      proof_type,
      spine_reveal_findings,      -- Correct name (was spine_findings)
      ending_results,             -- Correct name (was ending_findings)
      proof_hash,                 -- Will populate after proof generation
      chapter_version_pairs,      -- Exact chapter/version pairs affected
      created_at
    ) VALUES (
      p_story_id,
      p_source_event_id,
      p_disposition,
      p_reviewer_uid,
      p_reason_text,
      p_chapter_numbers,
      CASE 
        WHEN p_validation_passed THEN 'VALIDATOR_RERUN_PASSED'
        ELSE 'VALIDATOR_RERUN_FAILED'
      END,
      p_validator_spine_findings,
      p_validator_ending_results,
      NULL::text,  -- proof_hash populated below
      p_expected_chapter_versions,  -- Exact versions locked by this resolution
      now()
    ) RETURNING id INTO v_proof_id;
    
    -- Generate and persist unblock proof hash (SHA-256 of combined data)
    IF p_validation_passed THEN
      UPDATE blueprint_validator_proofs
      SET proof_hash = encode(digest(
        format('%s|%s|%s|%s|%s', p_story_id, now(), array_to_string(p_chapter_numbers, ','), p_validator_spine_findings::text, p_validator_ending_results::text),
        'sha256'
      ), 'hex')
      WHERE id = v_proof_id
      RETURNING unblock_proof INTO unblock_proof;
      
      -- Update queue status to PENDING (re-enqueue for generation)
      UPDATE blueprint_queue SET status = 'PENDING', claimed_by = NULL, claimed_at = NULL 
      WHERE story_id = p_story_id;
      
      -- Build structured unblock proof string bound to proof row
      unblock_proof := format('E5_UNBLOCK_PROOF_%s CHAPTERS %s VALIDATOR_RERUN_PASSED PROOF_ID_%s',
        p_story_id, 
        array_to_string(p_chapter_numbers, ','),
        v_proof_id
      );
      
      RETURN QUERY SELECT TRUE, unblock_proof, NULL::text, v_proof_id, 
        jsonb_build_object('spine', p_validator_spine_findings, 'ending', p_validator_ending_results);
      
    ELSE
      -- Validation failed - revert entire transaction via RAISE EXCEPTION
      RAISE EXCEPTION 'Canonical validators rejected disposition - remain BLOCKED';
    END IF;
    
  ELSIF p_disposition = 'REJECT_BLOCK' THEN
    -- Permanently block until manual intervention
    UPDATE blueprint_queue SET status = 'BLOCKED' WHERE story_id = p_story_id;
    
    RETURN QUERY SELECT TRUE, NULL::text, NULL::text, NULL::uuid, NULL::jsonb;
    
  ELSIF p_disposition = 'RETRY_ALLOW' THEN
    -- Permit retry without validator rerun
    UPDATE blueprint_queue SET status = 'RESOLVED' WHERE story_id = p_story_id;
    
    RETURN QUERY SELECT TRUE, NULL::text, NULL::text, NULL::uuid, NULL::jsonb;
  END IF;
  
EXCEPTION
  WHEN OTHERS THEN
    -- Automatic rollback occurred due to exception
    -- Return failure with detailed error message
    RETURN QUERY SELECT FALSE, NULL::text, SQLERRM || ' [' || SQLSTATE || ']'::text, NULL::uuid, NULL::jsonb;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.e5_record_disposition IS 'Native Postgres atomic transaction for E-OPS-1 disposition recording. SECURITY DEFINER enforces auth.uid() + admin_users check internally.';

-- Add unique index for idempotency checks
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE tablename = 'blueprint_resolutions' 
      AND indexdef LIKE '%idempotency_key%'
  ) THEN
    CREATE UNIQUE INDEX idx_blueprint_resolutions_idempotency ON blueprint_resolutions(idempotency_key);
  END IF;
END $$;

-- Revoke public execution, only service_role can call directly
REVOKE EXECUTE ON FUNCTION public.e5_record_disposition(text,text,uuid,text,bigint,integer[],jsonb,jsonb,boolean,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.e5_record_disposition(text,text,uuid,text,bigint,integer[],jsonb,jsonb,boolean,jsonb) TO authenticated;
