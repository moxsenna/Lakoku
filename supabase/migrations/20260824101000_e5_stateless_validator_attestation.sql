-- M10-E E5 forward upgrade from persisted UUID attestations to stateless signed JSONB.
-- Legacy attestations remain immutable authoritative history for existing proofs.

CREATE OR REPLACE FUNCTION private.e5_reject_legacy_attestation_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'LEGACY_VALIDATOR_ATTESTATIONS_IMMUTABLE';
END;
$function$;

REVOKE ALL ON FUNCTION private.e5_reject_legacy_attestation_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER e5_reject_legacy_attestation_mutation
BEFORE INSERT OR UPDATE OR DELETE ON public.blueprint_validator_attestations
FOR EACH ROW EXECUTE FUNCTION private.e5_reject_legacy_attestation_mutation();

CREATE TRIGGER e5_reject_legacy_attestation_truncate
BEFORE TRUNCATE ON public.blueprint_validator_attestations
FOR EACH STATEMENT EXECUTE FUNCTION private.e5_reject_legacy_attestation_mutation();

COMMENT ON TABLE public.blueprint_validator_attestations IS
  'Immutable, read-inaccessible legacy UUID validator attestations retained as authoritative history for pre-stateless E5 proofs';

REVOKE ALL ON TABLE public.blueprint_validator_attestations
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.e5_reject_authoritative_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'E5_AUTHORITATIVE_HISTORY_IMMUTABLE';
END;
$function$;

REVOKE ALL ON FUNCTION private.e5_reject_authoritative_history_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE private.e5_validator_attestation_key (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  signing_key bytea NOT NULL DEFAULT extensions.gen_random_bytes(32),
  CONSTRAINT e5_validator_attestation_key_32_bytes CHECK (pg_catalog.octet_length(signing_key) = 32)
);

INSERT INTO private.e5_validator_attestation_key (singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

REVOKE ALL ON TABLE private.e5_validator_attestation_key
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE private.e5_validator_attestation_key IS
  'Private singleton HMAC key for stateless E5 validator attestations; accessible only through security-definer authorities';

DROP FUNCTION public.e5_issue_validator_attestation(text,bigint,uuid,integer[],text,jsonb,jsonb,jsonb);

CREATE FUNCTION public.e5_issue_validator_attestation(
  p_story_id text,
  p_source_event_id bigint,
  p_reviewer_uid uuid,
  p_chapter_numbers integer[],
  p_validator_version text,
  p_spine_reveal_findings jsonb,
  p_ending_results jsonb,
  p_expected_chapter_versions jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_chapters integer[];
  v_payload jsonb;
  v_signature text;
  v_signing_key bytea;
  v_expected_count bigint;
BEGIN
  SELECT pg_catalog.array_agg(c.chapter_number ORDER BY c.chapter_number)
  INTO v_chapters
  FROM (
    SELECT DISTINCT u.chapter_number
    FROM pg_catalog.unnest(p_chapter_numbers) AS u(chapter_number)
  ) AS c;

  IF p_story_id IS NULL
    OR p_source_event_id IS NULL
    OR p_reviewer_uid IS NULL
    OR p_validator_version IS DISTINCT FROM 'E5_CANONICAL_VALIDATOR_V1'
    OR p_spine_reveal_findings IS NULL
    OR pg_catalog.jsonb_typeof(p_spine_reveal_findings) <> 'array'
    OR p_ending_results IS NULL
    OR pg_catalog.jsonb_typeof(p_ending_results) <> 'object'
    OR pg_catalog.jsonb_typeof(p_ending_results -> 'mainEndingReachable') <> 'boolean'
    OR (p_ending_results ->> 'mainEndingReachable')::boolean IS DISTINCT FROM true
    OR pg_catalog.jsonb_typeof(p_ending_results -> 'secretEndingsReachable') <> 'array'
    OR p_expected_chapter_versions IS NULL
    OR pg_catalog.jsonb_typeof(p_expected_chapter_versions) <> 'array'
    OR p_chapter_numbers IS NULL
    OR pg_catalog.cardinality(v_chapters) = 0
    OR pg_catalog.cardinality(v_chapters) <> pg_catalog.cardinality(p_chapter_numbers)
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.unnest(v_chapters) AS c(chapter_number)
      WHERE c.chapter_number < 1 OR c.chapter_number > 50
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_VALIDATOR_ATTESTATION';
  END IF;

  SELECT pg_catalog.count(*)
  INTO v_expected_count
  FROM pg_catalog.jsonb_array_elements(p_expected_chapter_versions) AS e(item)
  WHERE pg_catalog.jsonb_typeof(e.item) = 'object'
    AND (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(e.item)) = 2
    AND e.item ? 'chapter'
    AND e.item ? 'expected_version'
    AND pg_catalog.jsonb_typeof(e.item -> 'chapter') = 'number'
    AND pg_catalog.jsonb_typeof(e.item -> 'expected_version') = 'number'
    AND (e.item ->> 'chapter') ~ '^[1-9][0-9]?$'
    AND (e.item ->> 'chapter')::numeric <= 50
    AND (e.item ->> 'expected_version') ~ '^[1-9][0-9]{0,9}$'
    AND (e.item ->> 'expected_version')::numeric <= 2147483647;

  IF v_expected_count <> pg_catalog.cardinality(v_chapters) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'EXPECTED_VERSION_COVERAGE_MISMATCH';
  END IF;

  IF v_expected_count <> (
      SELECT pg_catalog.count(DISTINCT (e.item ->> 'chapter')::integer)
      FROM pg_catalog.jsonb_array_elements(p_expected_chapter_versions) AS e(item)
    )
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_expected_chapter_versions) AS e(item)
      WHERE NOT ((e.item ->> 'chapter')::integer = ANY (v_chapters))
    )
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.unnest(v_chapters) AS c(chapter_number)
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(p_expected_chapter_versions) AS e(item)
        WHERE (e.item ->> 'chapter')::integer = c.chapter_number
      )
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'EXPECTED_VERSION_COVERAGE_MISMATCH';
  END IF;

  v_payload := pg_catalog.jsonb_build_object(
    'story_id', p_story_id,
    'source_event_id', p_source_event_id::text,
    'reviewer_uid', p_reviewer_uid::text,
    'chapter_numbers', pg_catalog.to_jsonb(v_chapters),
    'validator_version', p_validator_version,
    'validation_passed', true,
    'spine_reveal_findings', p_spine_reveal_findings,
    'ending_results', p_ending_results,
    'expected_chapter_versions', p_expected_chapter_versions
  );

  SELECT signing_key
  INTO STRICT v_signing_key
  FROM private.e5_validator_attestation_key
  WHERE singleton;

  v_signature := pg_catalog.encode(
    extensions.hmac(
      pg_catalog.convert_to(v_payload::text, 'UTF8'),
      v_signing_key,
      'sha256'::text
    ),
    'hex'::text
  );

  RETURN pg_catalog.jsonb_build_object(
    'payload', v_payload,
    'signature', v_signature
  );
END;
$function$;

COMMENT ON FUNCTION public.e5_issue_validator_attestation(text,bigint,uuid,integer[],text,jsonb,jsonb,jsonb) IS
  'Issues a write-free signed JSONB envelope containing complete canonical E5 pass evidence';

REVOKE ALL ON FUNCTION public.e5_issue_validator_attestation(text,bigint,uuid,integer[],text,jsonb,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.e5_issue_validator_attestation(text,bigint,uuid,integer[],text,jsonb,jsonb,jsonb)
  TO service_role;

ALTER TABLE public.blueprint_validator_proofs
  ADD COLUMN IF NOT EXISTS validator_attestation_hash text,
  ADD COLUMN IF NOT EXISTS validator_attestation jsonb;

UPDATE public.blueprint_validator_proofs AS bvp
SET validator_attestation_hash = bva.attestation_hash
FROM public.blueprint_validator_attestations AS bva
WHERE bvp.validator_attestation_id = bva.id
  AND bvp.validator_attestation_hash IS NULL;

ALTER TABLE public.blueprint_validator_proofs
  ALTER COLUMN validator_attestation_id DROP NOT NULL,
  ALTER COLUMN validator_attestation_hash SET NOT NULL;

ALTER TABLE public.blueprint_validator_proofs
  ADD CONSTRAINT blueprint_validator_proofs_attestation_hash_key
    UNIQUE (validator_attestation_hash),
  ADD CONSTRAINT blueprint_validator_proofs_attestation_evidence_check
    CHECK (
      validator_attestation_hash ~ '^[0-9a-f]{64}$'
      AND (
        (validator_attestation_id IS NOT NULL AND validator_attestation IS NULL)
        OR
        (
          validator_attestation_id IS NULL
          AND pg_catalog.jsonb_typeof(validator_attestation) = 'object'
          AND validator_attestation ?& ARRAY['payload', 'signature']
          AND validator_attestation - 'payload' - 'signature' = '{}'::jsonb
          AND validator_attestation_hash = pg_catalog.encode(
            extensions.digest(validator_attestation::text, 'sha256'::text),
            'hex'::text
          )
        )
      )
    );

COMMENT ON TABLE public.blueprint_validator_proofs IS
  'Immutable E5 proofs: legacy rows reference retained UUID attestations; new rows persist full signed JSONB envelopes and their unique hashes';
COMMENT ON COLUMN public.blueprint_validator_proofs.validator_attestation_id IS
  'Nullable legacy FK retained only for authoritative pre-stateless attestation history';
COMMENT ON COLUMN public.blueprint_validator_proofs.validator_attestation_hash IS
  'Required unique evidence identity: legacy attestation hash or SHA-256 hash of full signed JSONB envelope';
COMMENT ON COLUMN public.blueprint_validator_proofs.validator_attestation IS
  'Full signed JSONB validator envelope for stateless E5 proofs; null only on legacy UUID-backed rows';

CREATE TRIGGER e5_reject_resolution_mutation
BEFORE UPDATE OR DELETE ON public.blueprint_resolutions
FOR EACH ROW EXECUTE FUNCTION private.e5_reject_authoritative_history_mutation();
CREATE TRIGGER e5_reject_resolution_truncate
BEFORE TRUNCATE ON public.blueprint_resolutions
FOR EACH STATEMENT EXECUTE FUNCTION private.e5_reject_authoritative_history_mutation();

CREATE TRIGGER e5_reject_audit_mutation
BEFORE UPDATE OR DELETE ON public.blueprint_audit_log
FOR EACH ROW EXECUTE FUNCTION private.e5_reject_authoritative_history_mutation();
CREATE TRIGGER e5_reject_audit_truncate
BEFORE TRUNCATE ON public.blueprint_audit_log
FOR EACH STATEMENT EXECUTE FUNCTION private.e5_reject_authoritative_history_mutation();

CREATE TRIGGER e5_reject_proof_mutation
BEFORE UPDATE OR DELETE ON public.blueprint_validator_proofs
FOR EACH ROW EXECUTE FUNCTION private.e5_reject_authoritative_history_mutation();
CREATE TRIGGER e5_reject_proof_truncate
BEFORE TRUNCATE ON public.blueprint_validator_proofs
FOR EACH STATEMENT EXECUTE FUNCTION private.e5_reject_authoritative_history_mutation();

DROP FUNCTION public.e5_record_disposition(text,text,uuid,text,bigint,integer[],uuid);

CREATE FUNCTION public.e5_record_disposition(
  p_story_id text,
  p_disposition text,
  p_reviewer_uid uuid,
  p_reason_text text,
  p_source_event_id bigint,
  p_chapter_numbers integer[],
  p_validator_attestation jsonb DEFAULT NULL
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
  v_attestation_payload jsonb;
  v_attestation_signature text;
  v_expected_signature text;
  v_attestation_hash text;
  v_signing_key bytea;
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
  v_source_story_id text;
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
    IF p_validator_attestation IS NULL
      OR pg_catalog.jsonb_typeof(p_validator_attestation) <> 'object'
      OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_validator_attestation)) <> 2
      OR NOT (p_validator_attestation ? 'payload')
      OR NOT (p_validator_attestation ? 'signature')
      OR pg_catalog.jsonb_typeof(p_validator_attestation -> 'payload') <> 'object'
      OR pg_catalog.jsonb_typeof(p_validator_attestation -> 'signature') <> 'string'
    THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_VALIDATOR_ATTESTATION_SHAPE';
    END IF;

    v_attestation_payload := p_validator_attestation -> 'payload';
    v_attestation_signature := p_validator_attestation ->> 'signature';

    IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_attestation_payload)) <> 9
      OR NOT (v_attestation_payload ?& ARRAY[
        'story_id',
        'source_event_id',
        'reviewer_uid',
        'chapter_numbers',
        'validator_version',
        'validation_passed',
        'spine_reveal_findings',
        'ending_results',
        'expected_chapter_versions'
      ])
      OR pg_catalog.jsonb_typeof(v_attestation_payload -> 'story_id') <> 'string'
      OR pg_catalog.jsonb_typeof(v_attestation_payload -> 'source_event_id') <> 'string'
      OR pg_catalog.jsonb_typeof(v_attestation_payload -> 'reviewer_uid') <> 'string'
      OR pg_catalog.jsonb_typeof(v_attestation_payload -> 'chapter_numbers') <> 'array'
      OR pg_catalog.jsonb_typeof(v_attestation_payload -> 'validator_version') <> 'string'
      OR pg_catalog.jsonb_typeof(v_attestation_payload -> 'validation_passed') <> 'boolean'
      OR (v_attestation_payload ->> 'validation_passed')::boolean IS DISTINCT FROM true
      OR pg_catalog.jsonb_typeof(v_attestation_payload -> 'spine_reveal_findings') <> 'array'
      OR pg_catalog.jsonb_typeof(v_attestation_payload -> 'ending_results') <> 'object'
      OR pg_catalog.jsonb_typeof(v_attestation_payload -> 'expected_chapter_versions') <> 'array'
      OR v_attestation_signature !~ '^[0-9a-f]{64}$'
    THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_VALIDATOR_ATTESTATION_PAYLOAD';
    END IF;

    IF pg_catalog.jsonb_typeof(v_attestation_payload -> 'ending_results' -> 'mainEndingReachable') <> 'boolean'
      OR (v_attestation_payload -> 'ending_results' ->> 'mainEndingReachable')::boolean IS DISTINCT FROM true
      OR pg_catalog.jsonb_typeof(v_attestation_payload -> 'ending_results' -> 'secretEndingsReachable') <> 'array'
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(v_attestation_payload -> 'chapter_numbers') AS c(item)
        WHERE pg_catalog.jsonb_typeof(c.item) <> 'number'
          OR c.item::text !~ '^[1-9][0-9]?$'
          OR (CASE WHEN c.item::text ~ '^[1-9][0-9]?$' THEN c.item::text::numeric ELSE 51 END) > 50
      )
    THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_VALIDATOR_ATTESTATION_EVIDENCE';
    END IF;

    SELECT pg_catalog.array_agg((c.item #>> '{}')::integer ORDER BY (c.item #>> '{}')::integer)
    INTO v_chapters
    FROM pg_catalog.jsonb_array_elements(v_attestation_payload -> 'chapter_numbers') AS c(item);

    IF v_chapters IS DISTINCT FROM (
      SELECT pg_catalog.array_agg(c.chapter_number ORDER BY c.chapter_number)
      FROM pg_catalog.unnest(p_chapter_numbers) AS c(chapter_number)
    )
      OR pg_catalog.cardinality(v_chapters) <> pg_catalog.cardinality(p_chapter_numbers)
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.unnest(v_chapters) AS c(chapter_number)
        WHERE c.chapter_number < 1 OR c.chapter_number > 50
      )
    THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'VALIDATOR_ATTESTATION_BINDING_MISMATCH';
    END IF;

    SELECT pg_catalog.count(*)
    INTO v_expected_count
    FROM pg_catalog.jsonb_array_elements(v_attestation_payload -> 'expected_chapter_versions') AS e(item)
    WHERE pg_catalog.jsonb_typeof(e.item) = 'object'
      AND (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(e.item)) = 2
      AND e.item ? 'chapter'
      AND e.item ? 'expected_version'
      AND pg_catalog.jsonb_typeof(e.item -> 'chapter') = 'number'
      AND pg_catalog.jsonb_typeof(e.item -> 'expected_version') = 'number'
      AND (e.item ->> 'chapter') ~ '^[1-9][0-9]?$'
      AND (e.item ->> 'chapter')::numeric <= 50
      AND (e.item ->> 'expected_version') ~ '^[1-9][0-9]{0,9}$'
      AND (e.item ->> 'expected_version')::numeric <= 2147483647;

    IF v_expected_count <> pg_catalog.cardinality(v_chapters) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'EXPECTED_VERSION_COVERAGE_MISMATCH';
    END IF;

    IF v_expected_count <> (
        SELECT pg_catalog.count(DISTINCT (e.item ->> 'chapter')::integer)
        FROM pg_catalog.jsonb_array_elements(v_attestation_payload -> 'expected_chapter_versions') AS e(item)
      )
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(v_attestation_payload -> 'expected_chapter_versions') AS e(item)
        WHERE NOT ((e.item ->> 'chapter')::integer = ANY (v_chapters))
      )
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.unnest(v_chapters) AS c(chapter_number)
        WHERE NOT EXISTS (
          SELECT 1
          FROM pg_catalog.jsonb_array_elements(v_attestation_payload -> 'expected_chapter_versions') AS e(item)
          WHERE (e.item ->> 'chapter')::integer = c.chapter_number
        )
      )
    THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'EXPECTED_VERSION_COVERAGE_MISMATCH';
    END IF;

    SELECT signing_key
    INTO STRICT v_signing_key
    FROM private.e5_validator_attestation_key
    WHERE singleton;

    v_expected_signature := pg_catalog.encode(
      extensions.hmac(
        pg_catalog.convert_to(v_attestation_payload::text, 'UTF8'),
        v_signing_key,
        'sha256'::text
      ),
      'hex'::text
    );

    IF v_attestation_signature IS DISTINCT FROM v_expected_signature
      OR v_attestation_payload ->> 'story_id' IS DISTINCT FROM p_story_id
      OR v_attestation_payload ->> 'source_event_id' IS DISTINCT FROM p_source_event_id::text
      OR v_attestation_payload ->> 'reviewer_uid' IS DISTINCT FROM p_reviewer_uid::text
      OR v_attestation_payload ->> 'validator_version' IS DISTINCT FROM 'E5_CANONICAL_VALIDATOR_V1'
    THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'VALIDATOR_ATTESTATION_BINDING_MISMATCH';
    END IF;

    v_attestation_hash := pg_catalog.encode(
      extensions.digest(p_validator_attestation::text, 'sha256'::text),
      'hex'::text
    );
  ELSIF p_validator_attestation IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ATTESTATION_ONLY_FOR_UNBLOCK';
  END IF;

  v_created_at := pg_catalog.clock_timestamp();
  v_validator_payload := CASE
    WHEN p_disposition = 'UNBLOCK_PERMIT' THEN pg_catalog.jsonb_build_object(
      'validation_passed', v_attestation_payload -> 'validation_passed',
      'validator_attestation_hash', v_attestation_hash,
      'validator_version', v_attestation_payload ->> 'validator_version',
      'spine_reveal_findings', v_attestation_payload -> 'spine_reveal_findings',
      'ending_results', v_attestation_payload -> 'ending_results'
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
    'validator_attestation_hash', v_attestation_hash,
    'validator_version', v_attestation_payload ->> 'validator_version',
    'validation_passed', v_attestation_payload -> 'validation_passed',
    'validator_spine_findings', v_attestation_payload -> 'spine_reveal_findings',
    'validator_ending_results', v_attestation_payload -> 'ending_results',
    'expected_chapter_versions', v_attestation_payload -> 'expected_chapter_versions'
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
  INTO v_source_story_id
  FROM public.story_events AS se
  WHERE se.id = p_source_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'SOURCE_EVENT_NOT_FOUND';
  END IF;

  IF v_source_story_id IS DISTINCT FROM p_story_id
    OR v_queue.source_event_id IS DISTINCT FROM p_source_event_id
    OR (SELECT pg_catalog.array_agg(c.chapter_number ORDER BY c.chapter_number)
        FROM (SELECT DISTINCT u.chapter_number
              FROM pg_catalog.unnest(v_queue.chapter_numbers) AS u(chapter_number)) AS c)
       IS DISTINCT FROM v_chapters
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'QUEUE_SOURCE_BINDING_MISMATCH';
  END IF;

  IF v_queue.status NOT IN ('PENDING', 'CLAIMED', 'BLOCKED') THEN
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
      INTO STRICT v_expected_version
      FROM pg_catalog.jsonb_array_elements(v_attestation_payload -> 'expected_chapter_versions') AS e(item)
      WHERE (e.item ->> 'chapter')::integer = v_chapter;

      IF v_expected_version IS DISTINCT FROM v_source_version THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'STALE_BLUEPRINT_VERSION';
      END IF;

      v_version_pairs := v_version_pairs || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'chapter', v_chapter,
          'source_version', v_source_version,
          'result_version', v_source_version + 1
        )
      );
    END LOOP;

    FOREACH v_chapter IN ARRAY v_chapters LOOP
      SELECT cb.*
      INTO STRICT v_blueprint
      FROM public.chapter_blueprints AS cb
      WHERE cb.story_id = p_story_id
        AND cb.chapter_number = v_chapter
        AND cb.version = (
          SELECT (e.item ->> 'expected_version')::integer
          FROM pg_catalog.jsonb_array_elements(v_attestation_payload -> 'expected_chapter_versions') AS e(item)
          WHERE (e.item ->> 'chapter')::integer = v_chapter
        );

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
        v_blueprint.version + 1,
        v_blueprint.phase,
        v_blueprint.chapter_goal,
        v_blueprint.mandatory_beats,
        v_blueprint.forbidden_reveals,
        v_blueprint.allowed_state_delta,
        v_blueprint.introduces_characters,
        v_blueprint.version,
        pg_catalog.format('E5 %s resolution at %s', p_disposition, v_created_at),
        v_created_at
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
      validator_attestation_hash,
      validator_attestation,
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
      NULL,
      v_attestation_hash,
      p_validator_attestation,
      v_attestation_payload ->> 'validator_version',
      v_attestation_payload -> 'spine_reveal_findings',
      v_attestation_payload -> 'ending_results',
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

COMMENT ON FUNCTION public.e5_record_disposition(text,text,uuid,text,bigint,integer[],jsonb) IS
  'Atomic E5 disposition authority using signed pass evidence for unblock; validates before writes, persists full envelope, and replays exact persisted results';

REVOKE ALL ON FUNCTION public.e5_record_disposition(text,text,uuid,text,bigint,integer[],jsonb)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.e5_record_disposition(text,text,uuid,text,bigint,integer[],jsonb)
  TO authenticated;
