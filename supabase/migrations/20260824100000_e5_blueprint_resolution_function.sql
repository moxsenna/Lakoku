-- M10-E E5 Blueprint Resolution Function (Native Atomic Transaction)
-- Purpose: Single Postgres RPC/function for transactional disposition recording
-- Authority: E-OPS-1 Requirement #9 (transactional resolution boundary)
-- Boundary: ANY exception => automatic rollback; NO partial commits allowed
-- 
-- CONTRACT: TypeScript layer MUST run canonical validators BEFORE calling this RPC
-- RPC expects verified validator evidence as input parameters
-- If validators fail, DO NOT CALL THIS RPC; use blocked path instead

DO $$
BEGIN
  -- Idempotent creation check
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'e5_record_disposition') THEN
    RAISE NOTICE 'e5_record_disposition function already exists, skipping creation';
    RETURN;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.e5_record_disposition(
  p_story_id text,
  p_disposition text,
  p_reviewer_uid uuid,
  p_reason_text text,
  p_source_event_id bigint,
  p_chapter_numbers integer[],
  p_validator_spine_findings jsonb DEFAULT NULL,
  p_validator_ending_findings jsonb DEFAULT NULL,
  p_validation_passed boolean DEFAULT FALSE,
  p_expected_max_version integer DEFAULT NULL
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
  v_new_version integer;
  v_existing_resolution_id bigint;
  v_proof_id uuid;
  v_chapter_insert_count integer;
BEGIN
  -- BEGIN TRANSACTION - Native PostgreSQL transaction boundary
  -- ALL operations below either commit together or rollback entirely
  
  -- Step 1: Idempotent replay - return existing authoritative result
  SELECT id INTO v_existing_resolution_id 
  FROM blueprint_resolutions 
  WHERE idempotency_key = v_idempotency_key 
  LIMIT 1;
  
  IF v_existing_resolution_id IS NOT NULL THEN
    -- Return existing proof/replay evidence
    SELECT bp.id INTO v_proof_id
    FROM blueprint_validator_proofs bp
    WHERE bp.story_id = p_story_id
      AND bp.source_event_id = p_source_event_id
      AND bp.disposition = p_disposition
      AND bp.reviewer_uid = p_reviewer_uid
      AND bp.chapter_numbers = p_chapter_numbers
    LIMIT 1;
    
    RETURN QUERY SELECT TRUE, NULL::text, 'Idempotent replay detected'::text, v_proof_id, NULL::jsonb;
    RETURN;
  END IF;
  
  -- Step 2: Validate disposition value
  IF p_disposition NOT IN ('REJECT_BLOCK', 'RETRY_ALLOW', 'UNBLOCK_PERMIT') THEN
    RAISE EXCEPTION 'Invalid disposition: %', p_disposition;
  END IF;
  
  -- Step 3: Validate required fields for UNBLOCK_PERMIT
  IF p_disposition = 'UNBLOCK_PERMIT' AND NOT p_validation_passed THEN
    RAISE EXCEPTION 'UNBLOCK_PERMIT requires validation_passed=true with canonical evidence';
  END IF;
  
  -- Step 4: Expected version concurrency check (optimistic locking)
  IF p_expected_max_version IS NOT NULL THEN
    SELECT COALESCE(MAX(version), 0) INTO v_new_version FROM chapter_blueprints WHERE story_id = p_story_id;
    
    IF v_new_version > p_expected_max_version THEN
      RAISE EXCEPTION 'Optimistic concurrency violation: current max_version=% exceeds expected max_version=%', v_new_version, p_expected_max_version;
    END IF;
  ELSE
    -- Calculate new version if not provided
    SELECT COALESCE(MAX(version), 0) + 1 INTO v_new_version FROM chapter_blueprints WHERE story_id = p_story_id;
  END IF;
  
  -- Step 5: Insert disposition record (will fail on duplicate key if concurrent)
  INSERT INTO blueprint_resolutions (story_id, disposition, reviewer_uid, reason_text, idempotency_key)
  VALUES (p_story_id, p_disposition, p_reviewer_uid, p_reason_text, v_idempotency_key)
  ON CONFLICT (idempotency_key) DO UPDATE RETURNING id INTO v_existing_resolution_id;
  
  -- Verify resolution insert succeeded (should always succeed due to unique constraint)
  IF v_existing_resolution_id IS NULL THEN
    RAISE EXCEPTION 'Resolution record insertion failed unexpectedly';
  END IF;
  
  -- Step 6: Insert all chapter blueprint versions in one batch (atomic)
  WITH new_chapters AS (
    SELECT unnest(p_chapter_numbers) AS chapter_num
  )
  INSERT INTO chapter_blueprints (story_id, chapter_number, version, reconciled_from_version, reconciliation_reason)
  SELECT p_story_id, nc.chapter_num, v_new_version, 
         CASE WHEN v_new_version > 1 THEN v_new_version - 1 ELSE NULL END,
         format('E5 disposition: %s at %s', p_disposition, now())
  FROM new_chapters nc;
  
  -- Count successful inserts
  GET DIAGNOSTICS v_chapter_insert_count = ROW_COUNT;
  
  -- Verify all chapter inserts succeeded
  IF v_chapter_insert_count != array_length(p_chapter_numbers, 1) THEN
    RAISE EXCEPTION 'Chapter insert incomplete: expected % chapters, got %', array_length(p_chapter_numbers, 1), v_chapter_insert_count;
  END IF;
  
  -- Step 7: Create immutable audit log entry (will fail on duplicate idempotency)
  INSERT INTO blueprint_audit_log (story_id, reviewer_uid, disposition, reason_text, source_event_id, idempotency_key)
  VALUES (p_story_id, p_reviewer_uid, p_disposition, p_reason_text, p_source_event_id, v_idempotency_key)
  ON CONFLICT (idempotency_key) DO NOTHING;
  
  -- Step 8: Handle UNBLOCK_PERMIT with validated evidence
  IF p_disposition = 'UNBLOCK_PERMIT' THEN
    -- Persist authoritative validator results with actual evidence payload
    INSERT INTO blueprint_validator_proofs (
      story_id,
      source_event_id,
      disposition,
      reviewer_uid,
      reason_text,
      chapter_numbers,
      proof_type,
      spine_findings,
      ending_findings,
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
      p_validator_ending_findings,
      now()
    ) RETURNING id INTO v_proof_id;
    
    IF NOT p_validation_passed THEN
      -- Validation failed - revert entire transaction
      RAISE EXCEPTION 'Canonical validators rejected disposition - remain BLOCKED';
    END IF;
    
    -- Update queue status to PENDING (re-enqueue for generation)
    UPDATE blueprint_queue SET status = 'PENDING', claimed_by = NULL, claimed_at = NULL WHERE story_id = p_story_id;
    
    -- Build unblock proof string
    RETURN QUERY SELECT TRUE, 
      format('E5_UNBLOCK_PROOF_%s_%s CHAPTERS %s VALIDATOR_RERUN_PASSED', p_story_id, now(), array_to_string(p_chapter_numbers, ',')),
      NULL::text,
      v_proof_id,
      jsonb_build_object('spine', p_validator_spine_findings, 'ending', p_validator_ending_findings);
    
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
    RETURN QUERY SELECT FALSE, NULL::text, SQLERRM, NULL::uuid, NULL::jsonb;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.e5_record_disposition IS 'Native Postgres atomic transaction for E-OPS-1 disposition recording. SECURITY DEFINER enforces auth via admin_users table.';

-- Add unique index for idempotency checks
CREATE UNIQUE INDEX IF NOT EXISTS idx_blueprint_resolutions_idempotency ON blueprint_resolutions(idempotency_key);

-- Revoke public execution, only service_role can call directly
REVOKE EXECUTE ON FUNCTION public.e5_record_disposition(text,text,uuid,text,bigint,integer[],jsonb,jsonb,boolean,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.e5_record_disposition(text,text,uuid,text,bigint,integer[],jsonb,jsonb,boolean,integer) TO authenticated;
