-- Forward migration: Atomic Runtime Review Enqueue
-- Service-role transactional RPC to atomically emit GENERATION_ATTEMPT and enqueue/rearm blueprint_queue.

CREATE OR REPLACE FUNCTION public.enqueue_runtime_review_v1(
  p_story_id text,
  p_chapter_number integer,
  p_repair_attempts integer,
  p_findings jsonb,
  p_idempotency_key text,
  p_correlation_id text DEFAULT NULL,
  p_provider_call_id text DEFAULT NULL,
  p_brand_scan_hash text DEFAULT NULL,
  p_lease_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_scope CONSTANT text := 'enqueue_runtime_review_v1';
  v_act_boundary text;
  v_normalized_findings jsonb;
  v_finding_codes jsonb;
  v_critical_count integer := 0;
  v_major_count integer := 0;
  v_minor_count integer := 0;
  v_request_payload jsonb;
  v_request_hash text;
  v_existing_story_id text;
  v_existing_scope text;
  v_existing_result jsonb;
  v_existing_queue public.blueprint_queue%ROWTYPE;
  v_queue_exists boolean := false;
  v_story_status text;
  v_seq integer;
  v_event_attempt integer := 0;
  v_event_id bigint;
  v_event_payload jsonb;
  v_safe_result jsonb;
  v_idempotency_ledger jsonb;
BEGIN
  -- 1. Input validations
  IF p_story_id IS NULL OR pg_catalog.btrim(p_story_id) = '' THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'INVALID_STORY_ID';
  END IF;

  IF p_chapter_number IS NULL OR p_chapter_number < 1 OR p_chapter_number > 50 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'INVALID_CHAPTER_NUMBER';
  END IF;

  IF p_repair_attempts IS NULL OR p_repair_attempts < 0 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'INVALID_REPAIR_ATTEMPTS';
  END IF;

  IF p_idempotency_key IS NULL
    OR p_idempotency_key <> pg_catalog.btrim(p_idempotency_key)
    OR pg_catalog.char_length(p_idempotency_key) < 1
    OR pg_catalog.char_length(p_idempotency_key) > 200 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'INVALID_IDEMPOTENCY_KEY';
  END IF;

  IF p_findings IS NULL OR pg_catalog.jsonb_typeof(p_findings) <> 'array' THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'INVALID_FINDINGS_ARRAY';
  END IF;
  IF pg_catalog.jsonb_array_length(p_findings) > 12 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'TOO_MANY_FINDINGS';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_findings) AS item(value)
    WHERE pg_catalog.jsonb_typeof(item.value) <> 'object'
      OR NOT (item.value ? 'code')
      OR NOT (item.value ? 'severity')
      OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(item.value)) <> 2
      OR pg_catalog.jsonb_typeof(item.value->'code') <> 'string'
      OR pg_catalog.jsonb_typeof(item.value->'severity') <> 'string'
      OR pg_catalog.btrim(item.value->>'code') = ''
      OR pg_catalog.char_length(item.value->>'code') > 80
      OR item.value->>'severity' NOT IN ('CRITICAL', 'MAJOR', 'MINOR')
  ) THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'INVALID_FINDING';
  END IF;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'code', item.value->>'code',
        'severity', item.value->>'severity'
      ) ORDER BY item.ordinality
    ),
    '[]'::jsonb
  )
  INTO v_normalized_findings
  FROM pg_catalog.jsonb_array_elements(p_findings) WITH ORDINALITY AS item(value, ordinality);

  -- Keep queue's three-act identity aligned with existing 50-chapter production mapping.
  IF p_chapter_number <= 15 THEN
    v_act_boundary := 'ACT_1';
  ELSIF p_chapter_number <= 35 THEN
    v_act_boundary := 'ACT_2';
  ELSE
    v_act_boundary := 'ACT_3';
  END IF;

  SELECT
    COALESCE(pg_catalog.count(*) FILTER (WHERE elem->>'severity' = 'CRITICAL'), 0)::integer,
    COALESCE(pg_catalog.count(*) FILTER (WHERE elem->>'severity' = 'MAJOR'), 0)::integer,
    COALESCE(pg_catalog.count(*) FILTER (WHERE elem->>'severity' = 'MINOR'), 0)::integer,
    COALESCE(
      pg_catalog.jsonb_agg(
        pg_catalog.concat_ws(':', elem->>'severity', elem->>'code') ORDER BY ordinality
      ),
      '[]'::jsonb
    )
  INTO
    v_critical_count,
    v_major_count,
    v_minor_count,
    v_finding_codes
  FROM pg_catalog.jsonb_array_elements(v_normalized_findings)
    WITH ORDINALITY AS f(elem, ordinality);

  -- Build canonical request payload and hash
  v_request_payload := pg_catalog.jsonb_build_object(
    'story_id', p_story_id,
    'chapter_number', p_chapter_number,
    'repair_attempts', p_repair_attempts,
    'findings', v_normalized_findings,
    'correlation_id', p_correlation_id,
    'provider_call_id', p_provider_call_id,
    'brand_scan_hash', p_brand_scan_hash
  );
  v_request_hash := pg_catalog.encode(
    extensions.digest(v_request_payload::text, 'sha256'::text),
    'hex'::text
  );

  -- 2. Fast-path replay check (unlocked)
  SELECT i.story_id, i.scope, i.result
    INTO v_existing_story_id, v_existing_scope, v_existing_result
  FROM public.idempotency_keys AS i
  WHERE i.key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing_story_id IS DISTINCT FROM p_story_id
      OR v_existing_scope IS DISTINCT FROM v_scope
      OR v_existing_result->>'requestHash' IS DISTINCT FROM v_request_hash
      OR v_existing_result->'request' IS DISTINCT FROM v_request_payload
    THEN
      RAISE EXCEPTION USING errcode = '23505', message = 'IDEMPOTENCY_CONFLICT';
    END IF;
    IF v_existing_result ? 'safeResult' THEN
      RETURN v_existing_result->'safeResult';
    END IF;
  END IF;

  -- 3. Acquire transactional story advisory lock (seed 120712)
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_story_id, 120712)
  );

  -- 4. Re-check idempotency under lock
  SELECT i.story_id, i.scope, i.result
    INTO v_existing_story_id, v_existing_scope, v_existing_result
  FROM public.idempotency_keys AS i
  WHERE i.key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_story_id IS DISTINCT FROM p_story_id
      OR v_existing_scope IS DISTINCT FROM v_scope
      OR v_existing_result->>'requestHash' IS DISTINCT FROM v_request_hash
      OR v_existing_result->'request' IS DISTINCT FROM v_request_payload
    THEN
      RAISE EXCEPTION USING errcode = '23505', message = 'IDEMPOTENCY_CONFLICT';
    END IF;
    IF v_existing_result ? 'safeResult' THEN
      RETURN v_existing_result->'safeResult';
    END IF;
  END IF;

  -- 5. Lock queue before story, matching E5 disposition lock order.
  SELECT bq.*
    INTO v_existing_queue
  FROM public.blueprint_queue AS bq
  WHERE bq.story_id = p_story_id
  FOR UPDATE;
  v_queue_exists := FOUND;

  IF v_queue_exists AND v_existing_queue.status IN ('PENDING', 'CLAIMED', 'BLOCKED') THEN
    RAISE EXCEPTION USING errcode = 'P0001', message = 'BLUEPRINT_QUEUE_ACTIVE_CONFLICT';
  END IF;

  -- 6. Lock story admission state after queue in the same transaction.
  SELECT story.generation_status
    INTO v_story_status
  FROM public.stories AS story
  WHERE story.id = p_story_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = '23503', message = 'STORY_NOT_FOUND';
  END IF;

  -- 7. Atomically insert GENERATION_ATTEMPT event
  v_event_payload := pg_catalog.jsonb_build_object(
    'chapter_number', p_chapter_number,
    'outcome', 'REVIEW_REQUIRED',
    'repair_attempts', p_repair_attempts,
    'critical_remaining', v_critical_count,
    'major_remaining', v_major_count,
    'minor_remaining', v_minor_count,
    'finding_codes', v_finding_codes,
    'findings', v_normalized_findings
  );
  IF p_correlation_id IS NOT NULL THEN
    v_event_payload := v_event_payload || pg_catalog.jsonb_build_object('correlation_id', p_correlation_id);
  END IF;

  LOOP
    v_event_attempt := v_event_attempt + 1;
    SELECT COALESCE(pg_catalog.max(event.seq), 0) + 1
      INTO v_seq
    FROM public.story_events AS event
    WHERE event.story_id = p_story_id;

    BEGIN
      INSERT INTO public.story_events (story_id, seq, type, payload)
      VALUES (
        p_story_id,
        v_seq,
        'GENERATION_ATTEMPT',
        v_event_payload
      )
      RETURNING id INTO v_event_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_event_attempt >= 5 THEN
        RAISE EXCEPTION USING errcode = '40001', message = 'EVENT_SEQUENCE_RETRY_EXHAUSTED';
      END IF;
    END;
  END LOOP;

  -- 8. Insert or rearm blueprint_queue bound to the source_event_id
  IF v_queue_exists AND v_existing_queue.status = 'RESOLVED' THEN
    UPDATE public.blueprint_queue
    SET
      status = 'PENDING',
      chapter_numbers = ARRAY[p_chapter_number],
      act_boundary = v_act_boundary,
      findings = v_normalized_findings,
      claimed_by = NULL,
      claimed_at = NULL,
      provider_call_id = p_provider_call_id,
      retry_count = p_repair_attempts,
      brand_scan_hash = p_brand_scan_hash,
      lease_id = p_lease_id,
      source_event_id = v_event_id,
      created_at = pg_catalog.clock_timestamp()
    WHERE story_id = p_story_id;
  ELSE
    INSERT INTO public.blueprint_queue (
      story_id,
      status,
      chapter_numbers,
      act_boundary,
      findings,
      claimed_by,
      claimed_at,
      provider_call_id,
      retry_count,
      brand_scan_hash,
      lease_id,
      source_event_id,
      created_at
    ) VALUES (
      p_story_id,
      'PENDING',
      ARRAY[p_chapter_number],
      v_act_boundary,
      v_normalized_findings,
      NULL,
      NULL,
      p_provider_call_id,
      p_repair_attempts,
      p_brand_scan_hash,
      p_lease_id,
      v_event_id,
      pg_catalog.clock_timestamp()
    );
  END IF;

  UPDATE public.stories
  SET generation_status = 'needs_review'
  WHERE id = p_story_id;

  -- 9. Persist idempotency record
  v_safe_result := pg_catalog.jsonb_build_object(
    'ok', true,
    'story_id', p_story_id,
    'chapter_number', p_chapter_number,
    'source_event_id', v_event_id::text,
    'status', 'PENDING'
  );

  v_idempotency_ledger := pg_catalog.jsonb_build_object(
    'requestHash', v_request_hash,
    'request', v_request_payload,
    'safeResult', v_safe_result
  );

  INSERT INTO public.idempotency_keys (key, story_id, scope, result)
  VALUES (
    p_idempotency_key,
    p_story_id,
    v_scope,
    v_idempotency_ledger
  );

  RETURN v_safe_result;
END;
$function$;

COMMENT ON FUNCTION public.enqueue_runtime_review_v1(text, integer, integer, jsonb, text, text, text, text, uuid) IS
  'Atomically emits GENERATION_ATTEMPT and enqueues or rearms blueprint_queue with source event binding and idempotency.';

REVOKE ALL ON FUNCTION public.enqueue_runtime_review_v1(text, integer, integer, jsonb, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_runtime_review_v1(text, integer, integer, jsonb, text, text, text, text, uuid) TO service_role;

CREATE FUNCTION private.e5_sync_generation_admission_from_queue_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_disposition text;
BEGIN
  SELECT resolution.disposition
    INTO v_disposition
  FROM public.blueprint_resolutions AS resolution
  WHERE resolution.story_id = NEW.story_id
    AND resolution.source_event_id = NEW.source_event_id
  ORDER BY resolution.created_at DESC, resolution.id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_disposition IN ('RETRY_ALLOW', 'UNBLOCK_PERMIT') THEN
    NEW.status := 'RESOLVED';
    UPDATE public.stories
    SET generation_status = 'ready'
    WHERE id = NEW.story_id
      AND generation_status = 'needs_review';
  ELSIF v_disposition = 'REJECT_BLOCK' THEN
    NEW.status := 'BLOCKED';
    UPDATE public.stories
    SET generation_status = 'needs_review'
    WHERE id = NEW.story_id;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER e5_sync_generation_admission_from_queue_v1
BEFORE UPDATE OF status ON public.blueprint_queue
FOR EACH ROW
EXECUTE FUNCTION private.e5_sync_generation_admission_from_queue_v1();

COMMENT ON FUNCTION private.e5_sync_generation_admission_from_queue_v1() IS
  'Normalizes resolved E5 queue state and story generation admission for the exact source event using queue-before-story lock order.';
