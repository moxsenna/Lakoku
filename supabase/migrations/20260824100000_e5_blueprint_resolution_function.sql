-- M10-E E5 atomic disposition RPC.
-- Exception handler runs after PL/pgSQL exception subtransaction rollback, so false
-- results cannot retain partial resolution, audit, proof, blueprint, or queue writes.

CREATE OR REPLACE FUNCTION public.e5_record_disposition(
  p_story_id text,
  p_disposition text,
  p_reviewer_uid uuid,
  p_reason_text text,
  p_source_event_id bigint,
  p_chapter_numbers integer[],
  p_validator_attestation_id uuid DEFAULT NULL
)
RETURNS TABLE (
  success boolean,
  unblock_proof text,
  error_message text,
  persisted_proof_id uuid,
  validator_results jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_uid uuid;
  v_created_at timestamptz;
  v_chapters integer[];
  v_queue public.blueprint_queue%ROWTYPE;
  v_existing public.blueprint_resolutions%ROWTYPE;
  v_existing_validator_payload jsonb;
  v_attestation public.blueprint_validator_attestations%ROWTYPE;
  v_request_payload jsonb;
  v_request_fingerprint text;
  v_validator_payload jsonb;
  v_version_pairs jsonb := '[]'::jsonb;
  v_expected_version integer;
  v_source_version integer;
  v_chapter integer;
  v_blueprint public.chapter_blueprints%ROWTYPE;
  v_resolution_id bigint;
  v_proof_id uuid;
  v_proof_hash text;
  v_proof_value text;
  v_queue_status text;
  v_expected_count bigint;
BEGIN
  v_actor_uid := auth.uid();

  IF v_actor_uid IS NULL OR v_actor_uid IS DISTINCT FROM p_reviewer_uid THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UNAUTHORIZED_REVIEWER';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.admin_users AS au
    WHERE au.user_id = v_actor_uid
      AND au.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'OWNER_ADMIN_REQUIRED';
  END IF;

  IF p_story_id IS NULL
    OR p_source_event_id IS NULL
    OR p_reason_text IS NULL
    OR pg_catalog.btrim(p_reason_text) = ''
    OR p_disposition IS NULL
    OR p_disposition NOT IN ('REJECT_BLOCK', 'RETRY_ALLOW', 'UNBLOCK_PERMIT')
    OR p_chapter_numbers IS NULL
    OR pg_catalog.cardinality(p_chapter_numbers) = 0
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_DISPOSITION_REQUEST';
  END IF;

  SELECT pg_catalog.array_agg(c.chapter_number ORDER BY c.chapter_number)
  INTO v_chapters
  FROM (
    SELECT DISTINCT u.chapter_number
    FROM pg_catalog.unnest(p_chapter_numbers) AS u(chapter_number)
  ) AS c;

  IF pg_catalog.cardinality(v_chapters) <> pg_catalog.cardinality(p_chapter_numbers)
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.unnest(v_chapters) AS c(chapter_number)
      WHERE c.chapter_number < 1 OR c.chapter_number > 50
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_CHAPTER_SET';
  END IF;

  IF p_disposition = 'UNBLOCK_PERMIT' THEN
    IF p_validator_attestation_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'VALIDATOR_ATTESTATION_REQUIRED';
    END IF;

    SELECT bva.*
    INTO v_attestation
    FROM public.blueprint_validator_attestations AS bva
    WHERE bva.id = p_validator_attestation_id
    FOR UPDATE;

    IF NOT FOUND
      OR v_attestation.story_id IS DISTINCT FROM p_story_id
      OR v_attestation.source_event_id IS DISTINCT FROM p_source_event_id
      OR v_attestation.reviewer_uid IS DISTINCT FROM p_reviewer_uid
      OR v_attestation.chapter_numbers IS DISTINCT FROM v_chapters
      OR v_attestation.validator_version IS DISTINCT FROM 'E5_CANONICAL_VALIDATOR_V1'
    THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'VALIDATOR_ATTESTATION_BINDING_MISMATCH';
    END IF;

    SELECT pg_catalog.count(*)
    INTO v_expected_count
    FROM pg_catalog.jsonb_array_elements(v_attestation.expected_chapter_versions) AS e(item)
    WHERE pg_catalog.jsonb_typeof(e.item) = 'object'
      AND e.item ? 'chapter'
      AND e.item ? 'expected_version'
      AND (e.item ->> 'chapter') ~ '^[0-9]+$'
      AND (e.item ->> 'expected_version') ~ '^[1-9][0-9]*$';

    IF v_expected_count <> pg_catalog.cardinality(v_chapters)
      OR v_expected_count <> (
        SELECT pg_catalog.count(DISTINCT (e.item ->> 'chapter')::integer)
        FROM pg_catalog.jsonb_array_elements(v_attestation.expected_chapter_versions) AS e(item)
      )
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(v_attestation.expected_chapter_versions) AS e(item)
        WHERE NOT ((e.item ->> 'chapter')::integer = ANY (v_chapters))
      )
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.unnest(v_chapters) AS c(chapter_number)
        WHERE NOT EXISTS (
          SELECT 1
          FROM pg_catalog.jsonb_array_elements(v_attestation.expected_chapter_versions) AS e(item)
          WHERE (e.item ->> 'chapter')::integer = c.chapter_number
        )
      )
    THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'EXPECTED_VERSION_COVERAGE_MISMATCH';
    END IF;
  ELSIF p_validator_attestation_id IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ATTESTATION_ONLY_FOR_UNBLOCK';
  END IF;

  v_created_at := pg_catalog.clock_timestamp();
  v_validator_payload := CASE
    WHEN p_disposition = 'UNBLOCK_PERMIT' THEN pg_catalog.jsonb_build_object(
      'validation_passed', true,
      'validator_attestation_id', v_attestation.id,
      'validator_version', v_attestation.validator_version,
      'spine_reveal_findings', v_attestation.spine_reveal_findings,
      'ending_results', v_attestation.ending_results
    )
    ELSE NULL
  END;
  v_request_payload := pg_catalog.jsonb_build_object(
    'story_id', p_story_id,
    'source_event_id', p_source_event_id::text,
    'reviewer_uid', p_reviewer_uid::text,
    'disposition', p_disposition,
    'reason_text', p_reason_text,
    'chapter_numbers', pg_catalog.to_jsonb(v_chapters),
    'validator_attestation_id', p_validator_attestation_id,
    'validator_version', v_attestation.validator_version,
    'validator_spine_findings', v_attestation.spine_reveal_findings,
    'validator_ending_results', v_attestation.ending_results,
    'expected_chapter_versions', v_attestation.expected_chapter_versions
  );
  v_request_fingerprint := pg_catalog.encode(
    extensions.digest(v_request_payload::text, 'sha256'::text),
    'hex'::text
  );

  SELECT br.*
  INTO v_existing
  FROM public.blueprint_resolutions AS br
  WHERE br.request_fingerprint = v_request_fingerprint;

  IF FOUND THEN
    SELECT bp.validator_payload
    INTO v_existing_validator_payload
    FROM public.blueprint_validator_proofs AS bp
    WHERE bp.resolution_id = v_existing.id;

    RETURN QUERY SELECT
      true,
      v_existing.result_unblock_proof,
      NULL::text,
      v_existing.result_proof_id,
      v_existing_validator_payload;
    RETURN;
  END IF;

  SELECT bq.*
  INTO v_queue
  FROM public.blueprint_queue AS bq
  WHERE bq.story_id = p_story_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'BLUEPRINT_QUEUE_NOT_FOUND';
  END IF;

  SELECT br.*
  INTO v_existing
  FROM public.blueprint_resolutions AS br
  WHERE br.request_fingerprint = v_request_fingerprint;

  IF FOUND THEN
    SELECT bp.validator_payload
    INTO v_existing_validator_payload
    FROM public.blueprint_validator_proofs AS bp
    WHERE bp.resolution_id = v_existing.id;

    RETURN QUERY SELECT
      true,
      v_existing.result_unblock_proof,
      NULL::text,
      v_existing.result_proof_id,
      v_existing_validator_payload;
    RETURN;
  END IF;

  SELECT se.story_id
  INTO v_queue_status
  FROM public.story_events AS se
  WHERE se.id = p_source_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'SOURCE_EVENT_NOT_FOUND';
  END IF;

  IF v_queue_status IS DISTINCT FROM p_story_id
    OR v_queue.source_event_id IS DISTINCT FROM p_source_event_id
    OR (SELECT pg_catalog.array_agg(c.chapter_number ORDER BY c.chapter_number)
        FROM (SELECT DISTINCT u.chapter_number
              FROM pg_catalog.unnest(v_queue.chapter_numbers) AS u(chapter_number)) AS c)
       IS DISTINCT FROM v_chapters
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'QUEUE_SOURCE_BINDING_MISMATCH';
  END IF;

  IF (p_disposition = 'UNBLOCK_PERMIT' AND v_queue.status NOT IN ('PENDING', 'CLAIMED', 'BLOCKED'))
    OR (p_disposition <> 'UNBLOCK_PERMIT' AND v_queue.status NOT IN ('PENDING', 'CLAIMED', 'BLOCKED'))
  THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'QUEUE_STATUS_NOT_REVIEWABLE';
  END IF;

  IF p_disposition = 'UNBLOCK_PERMIT' THEN
    FOREACH v_chapter IN ARRAY v_chapters LOOP
      SELECT cb.*
      INTO v_blueprint
      FROM public.chapter_blueprints AS cb
      WHERE cb.story_id = p_story_id
        AND cb.chapter_number = v_chapter
      ORDER BY cb.version DESC
      LIMIT 1
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'LATEST_BLUEPRINT_NOT_FOUND';
      END IF;

      v_source_version := v_blueprint.version;

      SELECT (e.item ->> 'expected_version')::integer
      INTO v_expected_version
      FROM pg_catalog.jsonb_array_elements(v_attestation.expected_chapter_versions) AS e(item)
      WHERE (e.item ->> 'chapter')::integer = v_chapter;

      IF v_expected_version IS NULL OR v_expected_version IS DISTINCT FROM v_source_version THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'STALE_BLUEPRINT_VERSION';
      END IF;

      INSERT INTO public.chapter_blueprints (
        story_id,
        chapter_number,
        version,
        phase,
        chapter_goal,
        mandatory_beats,
        forbidden_reveals,
        allowed_state_delta,
        introduces_characters,
        reconciled_from_version,
        reconciliation_reason,
        created_at
      ) VALUES (
        v_blueprint.story_id,
        v_blueprint.chapter_number,
        v_source_version + 1,
        v_blueprint.phase,
        v_blueprint.chapter_goal,
        v_blueprint.mandatory_beats,
        v_blueprint.forbidden_reveals,
        v_blueprint.allowed_state_delta,
        v_blueprint.introduces_characters,
        v_source_version,
        pg_catalog.format('E5 %s resolution at %s', p_disposition, v_created_at),
        v_created_at
      );

      v_version_pairs := v_version_pairs || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'chapter', v_chapter,
          'source_version', v_source_version,
          'result_version', v_source_version + 1
        )
      );
    END LOOP;


    v_proof_id := pg_catalog.gen_random_uuid();
    v_proof_hash := pg_catalog.encode(
      extensions.digest(
        pg_catalog.jsonb_build_object(
          'request_fingerprint', v_request_fingerprint,
          'created_at', v_created_at,
          'validator_payload', v_validator_payload,
          'chapter_version_pairs', v_version_pairs
        )::text,
        'sha256'::text
      ),
      'hex'::text
    );
    v_proof_value := pg_catalog.format('E5_UNBLOCK_PROOF_%s', v_proof_hash);
  END IF;

  INSERT INTO public.blueprint_resolutions (
    story_id,
    source_event_id,
    disposition,
    reviewer_uid,
    reason_text,
    chapter_numbers,
    request_fingerprint,
    result_unblock_proof,
    result_proof_id,
    result_chapter_version_pairs,
    created_at
  ) VALUES (
    p_story_id,
    p_source_event_id,
    p_disposition,
    p_reviewer_uid,
    p_reason_text,
    v_chapters,
    v_request_fingerprint,
    v_proof_value,
    v_proof_id,
    v_version_pairs,
    v_created_at
  )
  RETURNING id INTO v_resolution_id;

  INSERT INTO public.blueprint_audit_log (
    story_id,
    resolution_id,
    reviewer_uid,
    disposition,
    reason_text,
    source_event_id,
    request_fingerprint,
    created_at
  ) VALUES (
    p_story_id,
    v_resolution_id,
    p_reviewer_uid,
    p_disposition,
    p_reason_text,
    p_source_event_id,
    v_request_fingerprint,
    v_created_at
  );

  IF p_disposition = 'UNBLOCK_PERMIT' THEN
    INSERT INTO public.blueprint_validator_proofs (
      id,
      story_id,
      resolution_id,
      source_event_id,
      disposition,
      reviewer_uid,
      reason_text,
      chapter_numbers,
      proof_type,
      validator_attestation_id,
      validator_version,
      spine_reveal_findings,
      ending_results,
      validator_payload,
      proof_hash,
      proof_value,
      chapter_version_pairs,
      request_fingerprint,
      created_at
    ) VALUES (
      v_proof_id,
      p_story_id,
      v_resolution_id,
      p_source_event_id,
      p_disposition,
      p_reviewer_uid,
      p_reason_text,
      v_chapters,
      'VALIDATOR_RERUN_PASSED',
      v_attestation.id,
      v_attestation.validator_version,
      v_attestation.spine_reveal_findings,
      v_attestation.ending_results,
      v_validator_payload,
      v_proof_hash,
      v_proof_value,
      v_version_pairs,
      v_request_fingerprint,
      v_created_at
    );
  END IF;

  UPDATE public.blueprint_queue AS bq
  SET status = CASE p_disposition
      WHEN 'REJECT_BLOCK' THEN 'BLOCKED'
      WHEN 'RETRY_ALLOW' THEN 'RESOLVED'
      WHEN 'UNBLOCK_PERMIT' THEN 'PENDING'
    END,
    claimed_by = NULL,
    claimed_at = NULL
  WHERE bq.story_id = p_story_id;

  RETURN QUERY SELECT
    true,
    v_proof_value,
    NULL::text,
    v_proof_id,
    v_validator_payload;
EXCEPTION
  WHEN OTHERS THEN
    RETURN QUERY SELECT
      false,
      NULL::text,
      pg_catalog.format('%s [%s]', SQLERRM, SQLSTATE),
      NULL::uuid,
      NULL::jsonb;
END;
$function$;

COMMENT ON FUNCTION public.e5_record_disposition(text,text,uuid,text,bigint,integer[],uuid) IS
  'Atomic E5 disposition: authorization, server-issued validator attestation, source binding, optimistic locking, append-only history, immutable proof, and replay';

REVOKE ALL ON FUNCTION public.e5_record_disposition(text,text,uuid,text,bigint,integer[],uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.e5_record_disposition(text,text,uuid,text,bigint,integer[],uuid)
  TO authenticated;
